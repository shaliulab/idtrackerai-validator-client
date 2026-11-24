// Pre-download of the Annotate tab (server: annotate_pack.py). Every frame of the scenes, a chunk at a time: the
// chunk's scene frames as one H.264 stream (decoded here with WebCodecs) and the gzip of every frame's
// /api/annotate/frame answer, kept in IndexedDB, so stepping through the scenes asks the server nothing.
//
// What is kept per experiment and chunk (store `video`: index + Blob of the stream; store `data`: sig + Blob of the
// gzip) is used while it is what the server has now: the stream's `vkey` (frames + encoding), the data's `sig`
// (database, scene_qc.csv, solver run, the chunk's saved frames). Saves made here mark the frames they change as
// stale (markStale / staleChunk / staleAfter, called where AnnotateTab drops its cached boxes): those are read from
// the server as before; the chunk's data is fetched again the next time the status is read (refresh).
import api from './api';

const DB_NAME = 'fh-annotate-pack';
const DATA_CHUNKS = 6;       // chunks of frame data parsed in memory
const PARALLEL = 3;          // chunks downloaded at once

let dbPromise = null;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('this browser has no IndexedDB')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('video')) db.createObjectStore('video');
        if (!db.objectStoreNames.contains('data')) db.createObjectStore('data');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('IndexedDB transaction aborted'));
  }));
}

const keyOf = (experiment, chunk) => `${experiment}|${String(chunk).padStart(6, '0')}`;
const rangeOf = (experiment) => IDBKeyRange.bound(`${experiment}|`, `${experiment}|￿`);

// every record of an experiment in a store, without reading the Blobs
function readAll(store, experiment) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const out = [];
    const req = db.transaction(store, 'readonly').objectStore(store).openCursor(rangeOf(experiment));
    req.onsuccess = () => {
      const c = req.result;
      if (!c) { resolve(out); return; }
      out.push(c.value);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  }));
}

export const supportsVideo = () => typeof window !== 'undefined' && 'VideoDecoder' in window && 'EncodedVideoChunk' in window
  && typeof Worker !== 'undefined';
const supportsGzip = () => typeof DecompressionStream !== 'undefined';

async function gunzipJson(blob) {
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).json();
}

// Decoding happens in a Web Worker (packWorker.js: decoding and the YUV -> RGB conversion of a 2100 px frame
// would hold the page's thread ~25 ms a frame); one worker for the page
let worker = null;
let workerId = 0;
const workerCalls = new Map();   // id -> {resolve, reject}
function packWorker() {
  if (!worker) {
    worker = new Worker(new URL('./packWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const call = workerCalls.get(e.data.id);
      if (!call) { e.data.bitmap?.close(); return; }
      workerCalls.delete(e.data.id);
      if (e.data.error) call.reject(new Error(e.data.error));
      else call.resolve(e.data.bitmap);
    };
    worker.onerror = (e) => {
      for (const call of workerCalls.values()) call.reject(new Error(e.message || 'pre-download worker failed'));
      workerCalls.clear();
    };
  }
  return worker;
}
function decodeInWorker(experiment, chunk, fn) {
  return new Promise((resolve, reject) => {
    const id = ++workerId;
    workerCalls.set(id, { resolve, reject });
    packWorker().postMessage({ id, type: 'frame', experiment, chunk, fn });
  });
}
function dropInWorker(experiment, chunk) {
  if (worker) worker.postMessage(chunk == null ? { type: 'dropAll', experiment } : { type: 'drop', experiment, chunk });
}

// The pre-download of one experiment
export class Pack {
  constructor(experiment, onChange) {
    this.experiment = experiment;
    this.onChange = onChange || (() => {});
    this.status = null;          // GET /api/annotate/pack
    this.video = new Map();      // chunk -> {vkey, index (frames, offsets, sizes, keys, codec, width, height), bytes}
    this.data = new Map();       // chunk -> {sig, bytes}
    this.frameChunk = new Map(); // frame -> chunk (frames of the streams kept)
    this.parsed = new Map();     // chunk -> Promise<{sig, frames}> (LRU)
    this.stale = new Map();      // frame -> seq: changed here since its data was fetched
    this.after = new Map();      // chunk -> [frame, seq]: continuity proposals after frame changed
    this.chunkStale = new Map(); // chunk -> seq: every frame changed
    this.allStale = 0;           // seq of the last "everything changed" (boxes cleared): until the status is read again
    this.seq = 1;
    this.videoOk = supportsVideo();
    this.gzipOk = supportsGzip();
    this.run = null;             // the download going on: {cancelled, ...progress}
    this.loaded = false;         // what IndexedDB holds is listed
    this.ready = this.load();
  }

  async load() {
    try {
      const [videos, datas] = await Promise.all([readAll('video', this.experiment), readAll('data', this.experiment)]);
      for (const v of videos) this.addVideo(v);
      for (const d of datas) this.data.set(d.chunk, { sig: d.sig, bytes: d.blob.size });
    } catch (err) {
      this.error = String(err?.message || err);
    }
    this.loaded = true;
    this.onChange();
  }

  addVideo(v) {
    this.video.set(v.chunk, { vkey: v.vkey, index: v.index, bytes: v.blob?.size ?? v.bytes });
    for (const fn of v.index.frames) this.frameChunk.set(fn, v.chunk);
  }

  serverChunk(chunk) { return this.status?.chunks?.find((c) => c.chunk === chunk); }

  // the status of now (which chunks are built, their vkey / sig): kept data with another sig is fetched again
  async refresh({ refetch = true } = {}) {
    const startSeq = this.seq;
    const r = await api.get('/api/annotate/pack');
    this.status = r.data;
    this.byChunk = new Map(r.data.chunks.map((c) => [c.chunk, c]));
    if (this.allStale && this.allStale < startSeq) this.allStale = 0;
    this.onChange();
    if (refetch && !this.run) {
      const old = [...this.data.entries()].filter(([c, d]) => { const s = this.byChunk.get(c); return s && s.built && s.sig !== d.sig; });
      for (const [c] of old) {
        try { await this.fetchData(c); } catch { /* kept stale: frames come from the server */ }
      }
    }
    return r.data;
  }

  // -- reading ------------------------------------------------------------------------------------------------
  usableVideo(chunk) {
    const v = this.video.get(chunk);
    const s = this.byChunk?.get(chunk);
    return v && this.videoOk && (!s || (s.built && s.vkey === v.vkey));
  }

  hasImage(fn) {
    const c = this.frameChunk.get(fn);
    return c != null && this.usableVideo(c);
  }

  // ImageBitmap of the frame (decoded in the worker), or null when it is not in the pre-download
  image(fn) {
    if (!this.hasImage(fn)) return null;
    return decodeInWorker(this.experiment, this.frameChunk.get(fn), fn);
  }

  parsedOf(chunk) {
    let p = this.parsed.get(chunk);
    if (p) { this.parsed.delete(chunk); this.parsed.set(chunk, p); return p; }
    p = tx('data', 'readonly', (s) => s.get(keyOf(this.experiment, chunk)))
      .then((rec) => gunzipJson(rec.blob).then((d) => ({ sig: rec.sig, frames: d.frames })));
    p.catch(() => this.parsed.delete(chunk));
    this.parsed.set(chunk, p);
    while (this.parsed.size > DATA_CHUNKS) this.parsed.delete(this.parsed.keys().next().value);
    return p;
  }

  // the frame's /api/annotate/frame answer as fetched, or null (not in the pre-download, or changed since)
  frameData(fn) {
    const c = this.frameChunk.get(fn);
    if (c == null || this.allStale) return null;
    const d = this.data.get(c);
    const s = this.byChunk?.get(c);
    if (!d || !this.gzipOk || (s && s.sig !== d.sig) || this.stale.has(fn) || this.chunkStale.has(c)) return null;
    const after = this.after.get(c);
    return this.parsedOf(c).then((p) => {
      const v = p.frames[String(fn)];
      if (!v || this.stale.has(fn) || this.chunkStale.has(c) || this.allStale) return null;
      if (after && fn > after[0] && v.source === 'continuity') return null;
      return { ...v, fromPack: true };
    }, () => null);
  }

  // -- what saves change (AnnotateTab calls these where it drops its cached boxes) ------------------------------
  markStale(fn) { if (this.frameChunk.has(fn)) this.stale.set(fn, this.seq++); }
  staleChunk(chunk) { if (this.data.has(chunk)) this.chunkStale.set(chunk, this.seq++); }
  staleAfter(chunk, fn) {
    if (!this.data.has(chunk)) return;
    const a = this.after.get(chunk);
    this.after.set(chunk, [a ? Math.min(a[0], fn) : fn, this.seq++]);
  }
  markAllStale() { this.allStale = this.seq++; }

  // fresh data of the chunk fetched at seq: what was marked stale before it is in it
  clearStale(chunk, seq) {
    for (const [fn, s] of [...this.stale]) if (s < seq && this.frameChunk.get(fn) === chunk) this.stale.delete(fn);
    if ((this.chunkStale.get(chunk) ?? Infinity) < seq) this.chunkStale.delete(chunk);
    if ((this.after.get(chunk)?.[1] ?? Infinity) < seq) this.after.delete(chunk);
  }

  // -- downloading --------------------------------------------------------------------------------------------
  async fetchVideo(chunk, { signal, onBytes } = {}) {
    const index = (await api.get(`/api/annotate/pack/${chunk}/index`, { signal })).data;
    const r = await api.get(`/api/annotate/pack/${chunk}/video`, {
      responseType: 'blob', signal, onDownloadProgress: onBytes && ((e) => onBytes(e.loaded)),
    });
    if (r.data.size !== index.bytes) throw new Error(`chunk ${chunk}: ${r.data.size} bytes received, ${index.bytes} sent`);
    const rec = { experiment: this.experiment, chunk, vkey: index.vkey, index, blob: r.data };
    await tx('video', 'readwrite', (s) => s.put(rec, keyOf(this.experiment, chunk)));
    dropInWorker(this.experiment, chunk);
    this.addVideo(rec);
    return r.data.size;
  }

  async fetchData(chunk, { signal } = {}) {
    const seq = this.seq++;
    const r = await api.get(`/api/annotate/pack/${chunk}/data`, { responseType: 'blob', signal });
    const sig = r.headers['x-data-sig'];
    const blob = new Blob([r.data], { type: 'application/gzip' });
    await tx('data', 'readwrite', (s) => s.put({ experiment: this.experiment, chunk, sig, blob }, keyOf(this.experiment, chunk)));
    this.data.set(chunk, { sig, bytes: blob.size });
    this.parsed.delete(chunk);
    this.clearStale(chunk, seq);
    const s = this.byChunk?.get(chunk);
    if (s) s.sig = sig;     // as fetched: saves made since are marked stale here
    return blob.size;
  }

  // what is kept here of `chunks` (stream of now, data of now)
  stored(chunk) {
    const s = this.byChunk?.get(chunk);
    const v = this.video.get(chunk);
    const d = this.data.get(chunk);
    return {
      video: !!(s && v && s.built && v.vkey === s.vkey) || (!this.videoOk && !!s),
      data: !!(s && d && d.sig === s.sig),
    };
  }

  // the bytes kept for this experiment
  keptBytes() {
    let n = 0;
    for (const v of this.video.values()) n += v.bytes || 0;
    for (const d of this.data.values()) n += d.bytes || 0;
    return n;
  }

  // Fetch the chunks (in this order): asks the server to build what it has not, then downloads each chunk as soon
  // as it is built. onProgress({frames, total, bytes, phase, ...}). Resumable: what is kept is not fetched again.
  async download(chunks, onProgress) {
    if (this.run) return this.run.promise;
    const run = { cancelled: false, abort: new AbortController() };
    this.run = run;
    const t0 = performance.now();
    run.promise = (async () => {
      let status = await this.refresh({ refetch: false });
      const want = chunks.filter((c) => this.byChunk.has(c));
      const total = want.reduce((n, c) => n + this.byChunk.get(c).frames, 0);
      const need = () => want.filter((c) => { const st = this.stored(c); return !st.video || !st.data; });
      if (need().some((c) => !this.byChunk.get(c).built || !this.byChunk.get(c).data_ready)) {
        await api.post('/api/annotate/pack', { chunks: need() });
      }
      let bytes = 0;
      const inflight = new Map();   // chunk -> bytes of its stream received so far
      // what is left to fetch (streams not built yet: ~21 kB a frame)
      const toFetch = need().reduce((n, c) => {
        const s = this.byChunk.get(c);
        const st = this.stored(c);
        return n + (st.video || !this.videoOk ? 0 : s.bytes ?? s.frames * 21000) + (st.data ? 0 : s.data_bytes ?? s.frames * 400);
      }, 0);
      const failed = [];
      let lastReport = 0;
      const report = (phase) => {
        lastReport = performance.now();
        const done = want.filter((c) => { const st = this.stored(c); return st.video && st.data; });
        const frames = done.reduce((n, c) => n + this.byChunk.get(c).frames, 0);
        const secs = (performance.now() - t0) / 1000;
        const now = bytes + [...inflight.values()].reduce((a, b) => a + b, 0);
        const rate = now / Math.max(secs, 0.001);
        onProgress?.({
          phase, frames, total, chunks: done.length, nChunks: want.length, bytes: now, toFetch, seconds: secs,
          eta: rate > 0 && now > 0 ? Math.max(0, toFetch - now) / rate : null,
          serverBuilt: want.filter((c) => this.byChunk.get(c).built).length,
          serverJob: status.job, failed: failed.length,
        });
      };
      report('starting');
      while (!run.cancelled) {
        const left = need();
        if (!left.length) break;
        // built, with their data made (else, while the job makes it, the request would make it a second time)
        const ready = left.filter((c) => { const s = this.byChunk.get(c); return s.built && (s.data_ready || !status.job); });
        if (!ready.length) {
          report('waiting');
          if (!status.job) {   // nothing being built (stopped, or failed): ask again
            await api.post('/api/annotate/pack', { chunks: left });
          }
          await new Promise((r) => setTimeout(r, 3000));
          status = await this.refresh({ refetch: false });
          continue;
        }
        // PARALLEL chunks at a time, in the order asked
        let at = 0;
        const { signal } = run.abort;
        const onBytes = (c) => (n) => {
          inflight.set(c, n);
          if (performance.now() - lastReport > 500) report('downloading');
        };
        const worker = async () => {
          while (!run.cancelled && at < ready.length) {
            const c = ready[at++];
            try {
              // (not `bytes += await …`: bytes would be read before the await, losing the other fetches' bytes)
              if (!this.stored(c).video && this.videoOk) { const n = await this.fetchVideo(c, { signal, onBytes: onBytes(c) }); bytes += n; }
              inflight.delete(c);
              if (!this.stored(c).data && this.gzipOk) { const n = await this.fetchData(c, { signal }); bytes += n; }
            } catch (err) {
              inflight.delete(c);
              if (run.cancelled) return;
              failed.push([c, err]);      // tried again in the next round, at most twice
            }
            report('downloading');
          }
        };
        await Promise.all(Array.from({ length: PARALLEL }, worker));
        const again = new Map();
        for (const [c] of failed) again.set(c, (again.get(c) || 0) + 1);
        if ([...again.values()].some((n) => n > 2)) {
          const [c, err] = failed[failed.length - 1];
          throw new Error(`chunk ${c}: ${err?.response?.data?.error || err.message}`);
        }
        status = await this.refresh({ refetch: false });
      }
      report(run.cancelled ? 'cancelled' : 'done');
      return { cancelled: run.cancelled, bytes, seconds: (performance.now() - t0) / 1000 };
    })().finally(() => { this.run = null; this.onChange(); });
    this.onChange();
    return run.promise;
  }

  cancel() {
    if (!this.run) return;
    this.run.cancelled = true;
    this.run.abort.abort();
  }

  async clear() {
    this.cancel();
    dropInWorker(this.experiment);
    this.parsed.clear();
    this.video.clear();
    this.data.clear();
    this.frameChunk.clear();
    const db = await openDb();
    await Promise.all(['video', 'data'].map((store) => new Promise((resolve, reject) => {
      const t = db.transaction(store, 'readwrite');
      t.objectStore(store).delete(rangeOf(this.experiment));
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    })));
    this.onChange();
  }

  close() {
    this.cancel();
    dropInWorker(this.experiment);
  }
}

// Every experiment kept in this browser: {experiment: bytes}
export async function keptExperiments() {
  const out = {};
  for (const store of ['video', 'data']) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) { resolve(); return; }
        out[c.value.experiment] = (out[c.value.experiment] || 0) + (c.value.blob?.size || 0);
        c.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }
  return out;
}

export async function storageEstimate() {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { usage: e.usage, quota: e.quota } : null;
  } catch { return null; }
}

export async function persistStorage() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}
