// recordBurst.js
//
// Record the composite burst visualization (video + pose overlay + plain pose + both
// trace SVGs) to a .webm by compositing all panels onto one canvas while the burst plays
// once from start to end.
//
// Reads the LIVE DOM nodes already on screen, so the capture matches what you see —
// including the moving playhead the SVGs redraw as the video advances.
//
// KEY ROBUSTNESS POINTS (a 110-byte header-only file means frames never flowed):
//   * rec.start(TIMESLICE): emit chunks continuously, not only at stop()
//   * wait for readyState >= 2 (a decodable frame 0) before drawing/priming
//   * prime one composite frame BEFORE play(), so the stream has content
//   * refuse to stop until at least a few frames were captured

const TIMESLICE_MS = 100;
const MIN_FRAMES = 3;

// Serialize an <svg> element to an HTMLImageElement at an explicit pixel size.
function svgToImage(svgEl, outW, outH) {
  return new Promise((resolve) => {
    if (!svgEl) { resolve(null); return; }
    const clone = svgEl.cloneNode(true);
    clone.setAttribute('width', outW);
    clone.setAttribute('height', outH);
    const xml = new XMLSerializer().serializeToString(clone);
    const svg64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);   // never fail a whole frame over one panel
    img.src = svg64;
  });
}

/**
 * @param {Object} refs
 *   videoEl   – the <video> element (whole-burst clip)               [required]
 *   overlayEl – the pose-overlay <canvas> over the video             [optional]
 *   plainEl   – the plain-pose <canvas> on white                     [optional]
 *   distSvgEl – the distance-trace <svg>                             [optional]
 *   confSvgEl – the confidence-trace <svg>                           [optional]
 * @param {Object} opts  { filename, fps, panel, traceH }
 * @returns {Promise<void>} resolves after the .webm has been downloaded
 */
export async function recordBurst(refs, opts = {}) {
  const { videoEl, overlayEl, plainEl, distSvgEl, confSvgEl } = refs;
  if (!videoEl) throw new Error('no video element to record');

  const fps      = opts.fps      || 30;
  const PANEL    = opts.panel    || 280;
  const traceH   = opts.traceH   || 140;
  const filename = opts.filename || 'burst.webm';

  const hasPlain  = !!plainEl;
  const W = PANEL * 2;
  const traceRows = (distSvgEl ? 1 : 0) + (confSvgEl ? 1 : 0);
  const H = PANEL + traceH * traceRows;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const stream = canvas.captureStream(fps);
  // VP8 is the most universally playable MediaRecorder output; prefer it.
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
    ? 'video/webm;codecs=vp8'
    : (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9' : 'video/webm');
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  const done = new Promise((resolve) => {
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      console.log('[recordBurst] webm size:', blob.size, 'chunks:', chunks.length);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      resolve();
    };
  });

  // offscreen trace buffers, refreshed on their own timer (not every frame)
    let distBuf = null, confBuf = null;
    let rasterizing = false;

    async function refreshTraces() {
      if (rasterizing) return;
      rasterizing = true;
      const [d, c] = await Promise.all([
        distSvgEl ? svgToImage(distSvgEl, W, traceH) : null,
        confSvgEl ? svgToImage(confSvgEl, W, traceH) : null,
      ]);
      if (d) distBuf = d;
      if (c) confBuf = c;
      rasterizing = false;
    }

    // fast, SYNCHRONOUS composite — never awaits, so it can't flicker
    function drawComposite() {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      try { ctx.drawImage(videoEl, 0, 0, PANEL, PANEL); } catch (_) {}
      if (overlayEl) { try { ctx.drawImage(overlayEl, 0, 0, PANEL, PANEL); } catch (_) {} }
      if (hasPlain)  { try { ctx.drawImage(plainEl, PANEL, 0, PANEL, PANEL); } catch (_) {} }
      let y = PANEL;
      if (distBuf) { ctx.drawImage(distBuf, 0, y, W, traceH); y += traceH; }
      if (confBuf) { ctx.drawImage(confBuf, 0, y, W, traceH); y += traceH; }
    }
  // ---- run --------------------------------------------------------------------
  const hadLoop = videoEl.loop;
  videoEl.loop = false;

  // wait for a DECODABLE frame (readyState >= 2), not just metadata (>= 1),
  // or drawImage(video) paints nothing and the stream starts empty.
  await new Promise((res) => {
    if (videoEl.readyState >= 2) res();
    else videoEl.addEventListener('canplay', res, { once: true });
  });
  videoEl.currentTime = 0;

  rec.start(TIMESLICE_MS);
  await refreshTraces();          // prime the trace buffers once
  drawComposite();                // prime one full frame

  let frames = 0, stopped = false;
  const traceTimer = setInterval(refreshTraces, 100);   // ~10 Hz trace updates

  const step = () => {            // NOTE: no longer async
    if (stopped) return;
    drawComposite();
    frames++;
    if (videoEl.requestVideoFrameCallback) videoEl.requestVideoFrameCallback(step);
    else requestAnimationFrame(step);
  };

  const finish = () => {
    if (stopped) return;
    if (frames < MIN_FRAMES) { setTimeout(finish, 50); return; }
    stopped = true;
    clearInterval(traceTimer);   // stop refreshing traces
    try { rec.stop(); } catch (_) {}
    videoEl.loop = hadLoop;
    videoEl.removeEventListener('ended', finish);
  };
  videoEl.addEventListener('ended', finish);

  await videoEl.play();
  step();

  return done;
}