// Web Worker of the Annotate tab's pre-download (annotatePack.js): decodes the chunks' H.264 streams kept in
// IndexedDB with WebCodecs and hands each frame to the page as an ImageBitmap (transferred, no copy). Decoding and
// the YUV -> RGB conversion (~20 ms a 2100 px frame) stay off the page's thread, which only draws.
//
// Messages: {id, type: 'frame', experiment, chunk, fn} -> {id, bitmap} | {id, error};
//           {type: 'drop', experiment, chunk} (stream fetched again) / {type: 'dropAll', experiment}.
const DB_NAME = 'fh-annotate-pack';
const DECODERS = 3;          // chunks with decoders (and their stream in memory)
const LANES = 2;             // decoders per chunk (positions decoded)
const OUTPUT_WAIT_MS = 200;  // + 30 ms a frame decoded: the frame not out by then, the decoder is flushed (Chrome's
                             // decoders give each frame out at once without B-frames: a flush would only cost an IDR)
const FLUSH_WAIT_MS = 2000;  // ... and still not out after this: given up (the page reads it from the server)

let dbPromise = null;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
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

const keyOf = (experiment, chunk) => `${experiment}|${String(chunk).padStart(6, '0')}`;

function readVideo(experiment, chunk) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const req = db.transaction('video', 'readonly').objectStore('video').get(keyOf(experiment, chunk));
    req.onsuccess = () => (req.result ? resolve(req.result) : reject(new Error(`chunk ${chunk} is not kept`)));
    req.onerror = () => reject(req.error);
  }));
}

// One position decoded in a chunk's stream: frames in order (a step forward = one frame decoded), else from the
// IDR frame before
class Lane {
  constructor(stream) {
    this.stream = stream;
    this.next = -1;           // index of the frame the decoder expects next (-1: needs an IDR frame)
    this.waiters = new Map(); // frame index -> {resolve, reject}
    this.decoder = null;
    this.chain = Promise.resolve();
    this.used = 0;
  }

  open() {
    if (this.decoder && this.decoder.state !== 'closed') return;
    const { index } = this.stream;
    this.decoder = new VideoDecoder({
      output: (vf) => {
        const w = this.waiters.get(vf.timestamp);
        if (!w) { vf.close(); return; }
        this.waiters.delete(vf.timestamp);
        createImageBitmap(vf).then((bm) => { vf.close(); w.resolve(bm); }, (err) => { vf.close(); w.reject(err); });
      },
      error: (err) => {
        for (const w of this.waiters.values()) w.reject(err);
        this.waiters.clear();
        this.next = -1;
      },
    });
    this.decoder.configure({ codec: index.codec, codedWidth: index.width, codedHeight: index.height, optimizeForLatency: true });
    this.next = -1;
  }

  // frames decoded to reach index i from where this lane is (Infinity: from an IDR frame)
  cost(i) {
    const k = this.stream.keyBefore(i);
    return this.next > k && this.next <= i ? i - this.next : Infinity;
  }

  frame(i) {
    this.used = performance.now();
    const p = this.chain.then(() => this.decode(i));
    this.chain = p.catch(() => {});
    return p;
  }

  async decode(i) {
    this.open();
    const { keys, offsets, sizes } = this.stream.index;
    const k = this.stream.keyBefore(i);
    const from = this.next > k && this.next <= i ? this.next : k;
    const out = new Promise((resolve, reject) => this.waiters.set(i, { resolve, reject }));
    for (let j = from; j <= i; j += 1) {
      this.decoder.decode(new EncodedVideoChunk({
        type: keys[j] ? 'key' : 'delta', timestamp: j, data: this.stream.bytes.subarray(offsets[j], offsets[j] + sizes[j]),
      }));
    }
    this.next = i + 1;
    let timer;
    const late = await Promise.race([out.then(() => false, () => false),
      new Promise((r) => { timer = setTimeout(() => r(true), OUTPUT_WAIT_MS + 30 * (i - from + 1)); })]);
    clearTimeout(timer);
    if (late && this.waiters.has(i)) {
      // a decoder keeping frames back: flush it (it then needs an IDR frame)
      await Promise.race([this.decoder.flush().catch(() => {}), new Promise((r) => setTimeout(r, FLUSH_WAIT_MS))]);
      this.next = -1;
      const w = this.waiters.get(i);
      if (w) {     // never came out: start afresh
        this.waiters.delete(i);
        w.reject(new Error(`frame ${this.stream.index.frames[i]} not decoded`));
        try { this.decoder.close(); } catch { /* closed */ }
      }
    }
    return out;
  }

  close() {
    for (const w of this.waiters.values()) w.reject(new Error('closed'));
    this.waiters.clear();
    try { if (this.decoder && this.decoder.state !== 'closed') this.decoder.close(); } catch { /* closed */ }
  }
}

// A chunk's stream with LANES decoders: the frames ahead and the next scene's first frames are decoded at two
// places without making each other start again from an IDR frame
class ChunkDecoder {
  constructor(index, buffer) {
    this.index = index;
    this.bytes = new Uint8Array(buffer);
    this.pos = new Map(index.frames.map((fn, i) => [fn, i]));
    this.lanes = [];
  }

  keyBefore(i) {
    const { keys } = this.index;
    let k = i;
    while (k > 0 && !keys[k]) k -= 1;
    return k;
  }

  frame(fn) {
    const i = this.pos.get(fn);
    if (i == null) return Promise.reject(new Error(`frame ${fn} is not in the pre-download`));
    let best = null;
    for (const lane of this.lanes) if (!best || lane.cost(i) < best.cost(i)) best = lane;
    if (!best || best.cost(i) === Infinity) {
      if (this.lanes.length < LANES) { best = new Lane(this); this.lanes.push(best); }
      else best = this.lanes.reduce((a, b) => (a.used <= b.used ? a : b));   // the one used longest ago
    }
    return best.frame(i);
  }

  close() { for (const lane of this.lanes) lane.close(); }
}

const decoders = new Map();   // key -> Promise<ChunkDecoder>, most recently used last

function decoderOf(experiment, chunk) {
  const key = keyOf(experiment, chunk);
  let p = decoders.get(key);
  if (p) { decoders.delete(key); decoders.set(key, p); return p; }
  p = readVideo(experiment, chunk).then((rec) => rec.blob.arrayBuffer().then((buf) => new ChunkDecoder(rec.index, buf)));
  p.catch(() => { if (decoders.get(key) === p) decoders.delete(key); });
  decoders.set(key, p);
  while (decoders.size > DECODERS) {
    const [oldKey, old] = decoders.entries().next().value;
    decoders.delete(oldKey);
    old.then((d) => d.close(), () => {});
  }
  return p;
}

function drop(key) {
  const p = decoders.get(key);
  decoders.delete(key);
  if (p) p.then((d) => d.close(), () => {});
}

self.onmessage = async (e) => {
  const { id, type, experiment, chunk, fn } = e.data;
  if (type === 'frame') {
    try {
      if (typeof VideoDecoder === 'undefined') throw new Error('no VideoDecoder in workers of this browser');
      const bitmap = await (await decoderOf(experiment, chunk)).frame(fn);
      self.postMessage({ id, bitmap }, [bitmap]);
    } catch (err) {
      self.postMessage({ id, error: String(err?.message || err) });
    }
  } else if (type === 'drop') {
    drop(keyOf(experiment, chunk));
  } else if (type === 'dropAll') {
    for (const key of [...decoders.keys()]) if (key.startsWith(`${experiment}|`)) drop(key);
  }
};
