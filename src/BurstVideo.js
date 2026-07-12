// BurstVideo.js
import React, { useRef, useEffect, useState } from 'react';

const POSE_ALPHA = 0.55;
const NODE_R = 1.8;

// draw one pose frame onto a 2d context. `bg` = optional white fill (plain panel).
function drawPose(ctx, pose, fr, w, h, { alpha = 1, bg = null } = {}) {
  ctx.clearRect(0, 0, w, h);
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  if (!fr || !fr.pts) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#00c8c8';
  ctx.lineWidth = 1;
  for (const [a, b] of pose.edges) {
    const pa = fr.pts[a], pb = fr.pts[b];
    if (pa && pb) { ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke(); }
  }
  for (let i = 0; i < fr.pts.length; i++) {
    const p = fr.pts[i];
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(p[0], p[1], NODE_R, 0, 2 * Math.PI);
    ctx.fillStyle = (i === pose.prob_idx) ? (fr.in_bout ? '#ff2d2d' : '#ff9d9d') : '#00e5e5';
    ctx.fill();
  }
  ctx.restore();
}

export default function BurstVideo({ src, poseUrl, videoRef, width = 320, height, onError, clipStart, traceFps }) {
  const overlayRef = useRef(null);
  const plainRef = useRef(null);
  const [pose, setPose] = useState(null);
  const [videoReady, setVideoReady] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const showRef = useRef(showOverlay);
  useEffect(() => { showRef.current = showOverlay; }, [showOverlay]);

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

  // only start playback once BOTH the video is ready AND the pose is loaded, so the
  // frame callback is subscribed before any frames are presented
  useEffect(() => {
    const vid = videoRef.current;
    if (videoReady && pose && vid) {
      vid.play().catch(() => {});
    }
  }, [videoReady, pose]);

  // drive the pose overlay from the video's presented frames
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !pose || !vid.requestVideoFrameCallback) return;
    let handle;
    const tick = (now, meta) => {
      const vw = vid.videoWidth, vh = vid.videoHeight;
      // global frame = clipStart + mediaTime * fps; pose is 0-indexed from its start_frame
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
      handle = vid.requestVideoFrameCallback(tick);
    };
    handle = vid.requestVideoFrameCallback(tick);
    return () => vid.cancelVideoFrameCallback?.(handle);
  }, [pose, videoRef, clipStart, traceFps]);

  return (
    <>
      {/* panel 1: video + pose overlay */}
      <div style={{ position: 'relative', width, height, flexShrink: 0 }}>
        <video ref={videoRef} src={src} controls loop muted playsInline
               style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
               onError={onError} />
        <canvas ref={overlayRef}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                         pointerEvents: 'none' }} />
        <label style={{ position: 'absolute', top: 4, left: 4, fontSize: 11,
                        background: 'rgba(255,255,255,0.8)', padding: '1px 4px', borderRadius: 3 }}>
          <input type="checkbox" checked={showOverlay}
                 onChange={e => setShowOverlay(e.target.checked)} /> pose
        </label>
      </div>

      {/* panel 2: pose on white */}
      <div style={{ width, height, flexShrink: 0 }}>
        <canvas ref={plainRef}
                style={{ width: '100%', height: '100%', display: 'block',
                         border: '1px solid #ddd', objectFit: 'contain' }} />
      </div>
    </>
  );
}