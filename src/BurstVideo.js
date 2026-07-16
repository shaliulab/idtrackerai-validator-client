// BurstVideo.js
import React, { useRef, useEffect, useState } from 'react';

const POSE_ALPHA = 0.55;
const NODE_R = 1.8;
const IN_BOUT_SCALE = 1.5;   // proboscis node radius multiplier while the frame is in a bout

// Confidence -> opacity of a fully-saturated red proboscis dot.
//   c >= 1.0  -> fully opaque (as red as possible)
//   0 < c < 1 -> that fraction of red (linear); c -> 0 fades to invisible
//   c == 0    -> invisible
//   c == null (unknown) -> a faint fallback so the node isn't lost entirely
const PROB_RED = '#ff0000';
const confToAlpha = (c) => {
  if (c == null) return 0.35;                 // unknown confidence -> faint
  return Math.max(0, Math.min(1, c));         // clamp: >=1 opaque, <=0 invisible
};

// draw one pose frame onto a 2d context. `bg` = optional white fill (plain panel).
function drawPose(ctx, pose, fr, w, h, { alpha = 1, bg = null } = {}) {
  ctx.clearRect(0, 0, w, h);
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  if (!fr || !fr.pts) return;
  ctx.save();
  ctx.globalAlpha = alpha;

  // edges
  ctx.strokeStyle = '#00c8c8';
  ctx.lineWidth = 1;
  for (const [a, b] of pose.edges) {
    const pa = fr.pts[a], pb = fr.pts[b];
    if (pa && pb) { ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke(); }
  }

  // nodes
  for (let i = 0; i < fr.pts.length; i++) {
    const p = fr.pts[i];
    if (!p) continue;
    if (i === pose.prob_idx) {
      const c = fr.conf ? fr.conf[i] : null;
      const r = fr.in_bout ? NODE_R * IN_BOUT_SCALE : NODE_R;
      ctx.globalAlpha = alpha * confToAlpha(c);
      ctx.fillStyle = PROB_RED;
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.globalAlpha = alpha;
    } else {
      ctx.fillStyle = '#00e5e5';
      ctx.beginPath();
      ctx.arc(p[0], p[1], NODE_R, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  ctx.restore();
}

// small centered message shown in place of a panel when the video can't be displayed
function PanelMessage({ width, height, title, path }) {
  return (
    <div style={{
      width, height, flexShrink: 0,
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      alignItems: 'center', textAlign: 'center', padding: 8, boxSizing: 'border-box',
      border: '1px dashed #ccc', color: '#999', fontSize: 12, background: '#fafafa',
    }}>
      <div style={{ fontWeight: 'bold', marginBottom: 4 }}>{title}</div>
      <div style={{ wordBreak: 'break-all', fontSize: 10, color: '#bbb' }}>{path}</div>
    </div>
  );
}


export default function BurstVideo({ src, poseUrl, videoRef, width = 320, height,
                                     onError, clipStart, traceFps,
                                     overlayExportRef, plainExportRef }) {
                                      
  const overlayRef = useRef(null);
  const plainRef = useRef(null);
  const [pose, setPose] = useState(null);
  const [videoReady, setVideoReady] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [videoError, setVideoError] = useState(null);   // null | 'notfound' | 'unreadable'
  const showRef = useRef(showOverlay);

  // around the pose fetch
  useEffect(() => {
    if (!poseUrl) { setPose(null); return; }
    const t0 = performance.now();
    let cancelled = false;
    fetch(poseUrl).then(r => r.ok ? r.json() : null).then(p => {
      console.log('[pose] fetch+parse ms:', (performance.now() - t0).toFixed(0),
                  'frames:', p?.frames?.length, 'bytes~:', JSON.stringify(p).length);
      if (!cancelled) setPose(p);
    });
    return () => { cancelled = true; };
  }, [poseUrl]);


  useEffect(() => { showRef.current = showOverlay; }, [showOverlay]);

  // reset error/ready state whenever the clip source changes
  useEffect(() => { setVideoError(null); setVideoReady(false); }, [src]);

  // classify a video error: HEAD the URL to tell "missing" from "present-but-corrupt"
  const classifyError = () => {
    if (!src) { setVideoError('notfound'); return; }
    fetch(src, { method: 'HEAD' })
      .then(r => setVideoError(r.ok ? 'unreadable' : 'notfound'))
      .catch(() => setVideoError('notfound'));   // can't reach -> treat as missing
  };

  // fetch the burst-level pose whenever the burst changes
  useEffect(() => {
    if (!poseUrl) { setPose(null); return; }
    let cancelled = false;
    fetch(poseUrl).then(r => (r.ok ? r.json() : null))
      .then(p => { if (!cancelled) setPose(p); })
      .catch(() => { if (!cancelled) setPose(null); });
    return () => { cancelled = true; };
  }, [poseUrl]);

  // when the video src changes, hold playback until metadata is loaded
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    setVideoReady(false);
    const onReady = () => {
      vid.pause();
      vid.currentTime = 0;
      setVideoReady(true);
    };
    vid.addEventListener('loadedmetadata', onReady, { once: true });
    return () => vid.removeEventListener('loadedmetadata', onReady);
  }, [src, videoRef]);

  // only start playback once BOTH the video is ready AND the pose is loaded
  useEffect(() => {
    const vid = videoRef.current;
    if (videoReady && pose && vid && !videoError) {
      vid.play().catch(() => {});
    }
  }, [videoReady, pose, videoError]);


  // drive the pose overlay from the video's presented frames
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !pose || !vid.requestVideoFrameCallback) return;
    let handle;
    const tick = (now, meta) => {
      const d0 = performance.now();

      const vw = vid.videoWidth, vh = vid.videoHeight;
      const globalFrame = clipStart + meta.mediaTime * traceFps;
      const k = Math.round(globalFrame - pose.start_frame);
      const fr = pose.frames[k];

      const oc = overlayRef.current;
      if (oc) {
        if (oc.width !== vw || oc.height !== vh) { oc.width = vw; oc.height = vh; }
        const ctx = oc.getContext('2d');
        if (showRef.current) drawPose(ctx, pose, fr, vw, vh, { alpha: POSE_ALPHA });
        else ctx.clearRect(0, 0, vw, vh);
      }
      const pc = plainRef.current;
      if (pc) {
        if (pc.width !== vw || pc.height !== vh) { pc.width = vw; pc.height = vh; }
        drawPose(pc.getContext('2d'), pose, fr, vw, vh, { alpha: 1, bg: '#ffffff' });
      }
      const dt = performance.now() - d0;  

      if (!window.__poseStats) window.__poseStats = { n: 0, sum: 0, max: 0, over: 0 };
      const st = window.__poseStats;
      st.n++; st.sum += dt; st.max = Math.max(st.max, dt);
      if (dt > 4) st.over++;
      if (st.n % 60 === 0) console.log('[pose] avg draw ms:', (st.sum/st.n).toFixed(2),
                                       'max:', st.max.toFixed(1), 'over-4ms:', st.over, '/', st.n);
      handle = vid.requestVideoFrameCallback(tick);
    };
    handle = vid.requestVideoFrameCallback(tick);
    return () => vid.cancelVideoFrameCallback?.(handle);
  }, [pose, videoRef, clipStart, traceFps]);

  const msg = videoError === 'notfound'
    ? { title: 'video not found', path: src }
    : videoError === 'unreadable'
      ? { title: 'video is unreadable', path: src }
      : null;

  return (
    <>
      {/* panel 1: video + pose overlay, OR a message if the clip can't be shown */}
      {msg ? (
        <PanelMessage width={width} height={height} title={msg.title} path={msg.path} />
      ) : (
        <div style={{ position: 'relative', width, height, flexShrink: 0 }}>
          <video ref={videoRef} src={src} controls loop muted playsInline crossOrigin="anonymous"
                 style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                 onError={(e) => { classifyError(); onError?.(e); }} />
          <canvas ref={(el) => { overlayRef.current = el; if (overlayExportRef) overlayExportRef.current = el; }}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                           pointerEvents: 'none' }} />
          <label style={{ position: 'absolute', top: 4, left: 4, fontSize: 11,
                          background: 'rgba(255,255,255,0.8)', padding: '1px 4px', borderRadius: 3 }}>
            <input type="checkbox" checked={showOverlay}
                   onChange={e => setShowOverlay(e.target.checked)} /> pose
          </label>
        </div>
      )}

      {/* panel 2: pose on white — needs presented video frames, so it also shows the
          message when the video failed (no frames -> nothing would be drawn). */}
      {msg ? (
        <PanelMessage width={width} height={height}
                      title="pose needs the video" path={msg.path} />
      ) : (
        <div style={{ width, height, flexShrink: 0 }}>
          <canvas ref={(el) => { plainRef.current = el; if (plainExportRef) plainExportRef.current = el; }}
                  style={{ width: '100%', height: '100%', display: 'block',
                           border: '1px solid #ddd', objectFit: 'contain' }} />
        </div>
      )}
    </>
  );
}