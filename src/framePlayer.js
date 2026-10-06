// framePlayer.js  —  fetches viewer frames so that they play like a movie
//
// A "bundle" is everything drawn for one frame: image, tracking rows and contours,
// loaded together so they always belong to the same frame.
//
// seek(n)     show frame n as soon as possible. Only the latest seek matters: while
//             scrolling fast, intermediate frames are skipped, and frames are shown
//             in the order they were asked for — never stale or out of order.
// play(...)   play at `step` frames every `intervalMs` (a wall-clock speed), always
//             forward and prefetching ahead. Like a video player under load, frames
//             are dropped when the server cannot deliver them in time, so the
//             playback speed is kept; frames are never shown out of order.
// invalidate  drop every cached frame (experiment, tracking table or pose changed).

const CACHE_SIZE = 150;      // bundles kept in memory (images are ~20-50 kB each)
const MAX_PREFETCH = 1;      // prefetch requests in flight on top of the current one
const PREFETCH_AHEAD = 1;    // frames loaded ahead of the playhead during playback: the server is
                             // serial, so more would delay the frame actually needed

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default class FramePlayer {
  /**
   * @param load      async (frameNumber) => bundle  ({ url, ... }; url is an object URL owned by the player)
   * @param onDisplay (bundle) => void               called with each frame to show
   * @param onError   (frameNumber, error) => void
   */
  constructor({ load, onDisplay, onError }) {
    this.load = load;
    this.onDisplay = onDisplay;
    this.onError = onError || (() => {});
    this.cache = new Map();        // frameNumber -> { promise, bundle }
    this.target = null;
    this.displayed = null;
    this.displayedBundle = null;
    this.pumping = false;
    this.inFlight = 0;
    this.generation = 0;
    this.playToken = 0;
  }

  // ── loading ──

  get(frameNumber) {
    let entry = this.cache.get(frameNumber);
    if (!entry) {
      const generation = this.generation;
      this.inFlight += 1;
      entry = {
        bundle: null,
        promise: this.load(frameNumber)
          .then((bundle) => {
            if (generation !== this.generation) {
              if (bundle?.url) URL.revokeObjectURL(bundle.url);
              throw new Error('stale');
            }
            entry.bundle = bundle;
            return bundle;
          })
          .catch((error) => {
            // forget failures, so the frame can be retried
            if (this.cache.get(frameNumber) === entry) this.cache.delete(frameNumber);
            throw error;
          })
          .finally(() => { this.inFlight -= 1; }),
      };
      entry.promise.catch(() => {});   // handled by whoever awaits it
      this.cache.set(frameNumber, entry);
      this.evict();
    } else {
      // refresh LRU position
      this.cache.delete(frameNumber);
      this.cache.set(frameNumber, entry);
    }
    return entry.promise;
  }

  prefetch(frameNumber) {
    if (this.cache.has(frameNumber) || this.inFlight > MAX_PREFETCH) return;
    this.get(frameNumber).catch(() => {});
  }

  evict() {
    for (const [frameNumber, entry] of this.cache) {
      if (this.cache.size <= CACHE_SIZE) break;
      if (frameNumber === this.displayed || frameNumber === this.target || !entry.bundle) continue;
      if (entry.bundle.url) URL.revokeObjectURL(entry.bundle.url);
      this.cache.delete(frameNumber);
    }
  }

  // ── seeking ──

  seek(frameNumber) {
    this.target = frameNumber;
    this.pump();
  }

  async pump() {
    if (this.pumping) return;        // the running loop will pick up the new target
    this.pumping = true;
    try {
      while (this.target !== null && this.target !== this.displayed) {
        const frameNumber = this.target;
        const generation = this.generation;
        try {
          const bundle = await this.get(frameNumber);
          if (generation !== this.generation) continue;
          this.show(frameNumber, bundle);
        } catch (error) {
          if (generation !== this.generation || error.message === 'stale') continue;
          this.onError(frameNumber, error);
          if (this.target === frameNumber) break;   // do not retry in a loop
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  show(frameNumber, bundle) {
    const previous = this.displayedBundle;
    this.displayed = frameNumber;
    this.displayedBundle = bundle;
    this.onDisplay(bundle);
    // A bundle dropped from the cache while on screen is freed once replaced.
    if (previous && previous !== bundle && previous.url
        && ![...this.cache.values()].some((entry) => entry.bundle === previous)) {
      URL.revokeObjectURL(previous.url);
    }
  }

  // ── playback ──

  /**
   * @param from        frame to start from
   * @param step        frames advanced per displayed frame when the server keeps up
   * @param intervalMs  wall-clock time per `step` frames: speed = step / intervalMs
   * @param min,max     playback wraps from max back to min
   * @param onAdvance   (frameNumber) => void   called when the playhead moves
   */
  async play({ from, step, intervalMs, min, max, onAdvance }) {
    const token = ++this.playToken;
    const speed = step / intervalMs;                       // frames per ms
    let origin = from;                                     // frame at clock time 0
    let t0 = performance.now();
    let current = from;
    let loadMs = intervalMs;                               // running estimate of a frame's load time
    // Frames are picked on a grid of `step` from the origin, so prefetched frames get used.
    const onGrid = (n) => origin + Math.ceil((n - origin) / step) * step;

    while (token === this.playToken) {
      // Aim where the clock will be once the frame has loaded; at least one step ahead.
      const clock = origin + speed * (performance.now() - t0);
      let next = Math.max(current + step, onGrid(clock + speed * loadMs));
      if (max != null && next > max) {                     // wrap around
        origin = min ?? from;
        t0 = performance.now();
        next = origin;
      }
      const stride = Math.max(step, next - current);
      for (let k = 1; k <= PREFETCH_AHEAD; k++) {
        const ahead = next + k * stride;
        if (max == null || ahead <= max) this.prefetch(ahead);
      }

      const requested = performance.now();
      const cached = this.cache.get(next)?.bundle != null;
      try {
        await this.get(next);
      } catch (error) {
        if (token !== this.playToken) return;
        this.onError(next, error);
        current = next;                                    // skip it, keep playing
        continue;
      }
      if (!cached) loadMs = 0.7 * loadMs + 0.3 * (performance.now() - requested);

      // Do not run ahead of the clock.
      const wait = (next - origin) / speed - (performance.now() - t0);
      if (wait > 0) await sleep(wait);
      if (token !== this.playToken) return;
      current = next;
      onAdvance(next);                                     // -> seek(next): cached, shown at once
    }
  }

  stop() {
    this.playToken += 1;
  }

  // ── cache ──

  // `target`: frame to load next instead of reloading the current one (e.g. the
  // first frame of a newly loaded experiment).
  invalidate(target = this.target) {
    this.generation += 1;
    for (const [frameNumber, entry] of this.cache) {
      if (entry.bundle?.url && frameNumber !== this.displayed) URL.revokeObjectURL(entry.bundle.url);
    }
    this.cache.clear();
    this.displayed = null;
    this.target = target;
    if (this.target !== null) this.pump();
  }
}
