// PoseTab.js  —  "Pose" tab: the pose of one fly, frame by frame
//
// The frame (/api/frame/<n>) cropped around the fly, with the body parts of
// /api/pose/<fly>/frame/<n> (idtrackerai_validator_server/pose.py) coloured by their
// confidence; hovering a part (or its table row) shows its name, confidence and
// position. Below, the per-frame parts detected / confidence / pose score of the
// frames around (/api/pose/<fly>/trace); click to go there. Its `request` prop
// ({fly, frameNumber}) opens a fly at a frame: used by the QC tab's pose charts.

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import api, { apiUrl } from './api';
import { useElementSize, useStoredNumber } from './layout';
import { SKELETON } from './FrameWithSquare';
import { METRICS } from './PoseQc';

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);
const fix = (v, d = 2) => (v == null ? '–' : v.toFixed(d));

// Confidence bands (status colours, always shown with the number)
const BANDS = [
  { min: 0.8, color: '#0ca30c', label: '≥ 0.8' },
  { min: 0.5, color: '#e07b00', label: '0.5–0.8' },
  { min: 0, color: '#d03b3b', label: '< 0.5' },
];
const bandOf = (c) => BANDS.find((b) => (c ?? 0) >= b.min);
const ZOOMS = [1, 1.5, 2, 3];
const WINDOWS = [2, 10, 60];      // seconds each side of the frame in the traces

function PoseCanvas({ pose, image, zoom, hovered, setHovered, showLabels, size }) {
  const canvasRef = useRef(null);
  const [tip, setTip] = useState(null);
  const ok = pose && pose.centroid && image;
  const crop = ok ? Math.max(pose.square[0], pose.square[1]) * zoom : 0;
  const origin = ok ? [pose.centroid[0] - crop / 2, pose.centroid[1] - crop / 2] : [0, 0];
  const scale = ok ? size / crop : 1;
  const toDisplay = useCallback(([x, y]) => [(x - origin[0]) * scale, (y - origin[1]) * scale], [origin, scale]);
  const points = useMemo(() => (ok ? pose.nodes.filter((n) => n.xy).map((n) => ({ ...n, d: toDisplay(n.xy) })) : []),
    [ok, pose, toDisplay]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    if (!ok) return;
    ctx.imageSmoothingEnabled = zoom * scale < 4;
    ctx.drawImage(image, origin[0], origin[1], crop, crop, 0, 0, size, size);
    // the square the pose was estimated on
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.setLineDash([4, 4]);
    const [sx, sy] = toDisplay([pose.centroid[0] - pose.square[0] / 2, pose.centroid[1] - pose.square[1] / 2]);
    ctx.strokeRect(sx, sy, pose.square[0] * scale, pose.square[1] * scale);
    ctx.setLineDash([]);
    const byName = Object.fromEntries(points.map((p) => [p.name, p]));
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    for (const [a, b] of SKELETON) {
      if (!byName[a] || !byName[b]) continue;
      ctx.beginPath();
      ctx.moveTo(...byName[a].d);
      ctx.lineTo(...byName[b].d);
      ctx.stroke();
    }
    for (const p of points) {
      const r = p.name === hovered ? 9 : p.scored ? 6 : 4;
      ctx.beginPath();
      ctx.arc(p.d[0], p.d[1], r, 0, 2 * Math.PI);
      ctx.fillStyle = bandOf(p.confidence).color;
      ctx.fill();
      ctx.lineWidth = p.name === hovered ? 3 : 2;
      ctx.strokeStyle = p.name === hovered ? '#fff' : 'rgba(0,0,0,0.8)';
      ctx.stroke();
      if (showLabels || p.name === hovered) {
        ctx.font = '12px sans-serif';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(p.name, p.d[0] + 9, p.d[1] - 7);
        ctx.fillStyle = '#fff';
        ctx.fillText(p.name, p.d[0] + 9, p.d[1] - 7);
      }
    }
  }, [ok, image, size, zoom, scale, origin, crop, points, pose, hovered, showLabels, toDisplay]);

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best = null;
    for (const p of points) {
      const d = Math.hypot(p.d[0] - x, p.d[1] - y);
      if (d < 14 && (!best || d < best.dist)) best = { ...p, dist: d };
    }
    setHovered(best?.name ?? null);
    setTip(best ? { x, y, node: best } : null);
  };

  return (
    <div className="pose-canvas-wrap" style={{ width: size, height: size }}>
      <canvas ref={canvasRef} style={{ width: size, height: size, display: 'block' }}
              onMouseMove={onMove} onMouseLeave={() => { setHovered(null); setTip(null); }} />
      {pose && !pose.centroid && !pose.error && <div className="pose-canvas-msg">The fly is not tracked in this frame: no position to draw its pose at</div>}
      {pose?.error && <div className="pose-canvas-msg">{pose.error}</div>}
      {tip && (
        <div className="eth-tooltip qc-tooltip" style={{ left: Math.min(tip.x + 14, size - 170), top: tip.y + 14 }}>
          <b>{tip.node.name}</b>
          <div><span className="qc-swatch" style={{ background: bandOf(tip.node.confidence).color }} />confidence <b>{fix(tip.node.confidence, 3)}</b></div>
          <div>x {fix(tip.node.xy[0], 1)} · y {fix(tip.node.xy[1], 1)}</div>
          {!tip.node.scored && <div className="qc-hint">not counted in the pose score</div>}
        </div>
      )}
    </div>
  );
}

// Per-frame traces of the frames around the cursor: one small panel per metric
function Traces({ trace, frame, windowFrames, framerate, onSeek, nScored }) {
  const [el, setEl] = useState(null);
  const { width } = useElementSize(el);
  const canvasRef = useRef(null);
  const [hoverFrame, setHoverFrame] = useState(null);
  const panelH = 46;
  const gapH = 18;
  const left = 34;
  const w = Math.max(0, width - left);
  const start = frame - windowFrames;
  const end = frame + windowFrames;
  const xOf = useCallback((f) => left + ((f - start) / (end - start)) * w, [start, end, w]);
  const totalH = METRICS.length * (panelH + gapH);
  const max = (m) => (m.key === 'n_detected' ? nScored : 1);
  const valueAt = (m, f) => (trace && f >= trace.start && f < trace.start + trace[m.key].length ? trace[m.key][f - trace.start] : null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(totalH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, totalH);
    const css = getComputedStyle(canvas);
    const sub = css.getPropertyValue('--subtext') || '#64748b';
    const grid = css.getPropertyValue('--border') || '#dbe1e8';
    const line = css.getPropertyValue('--accent') || '#2563eb';
    METRICS.forEach((m, k) => {
      const top = k * (panelH + gapH) + 14;
      const mx = max(m);
      const y = (v) => top + panelH - (panelH * Math.min(v, mx)) / mx;
      ctx.fillStyle = sub;
      ctx.font = '11px sans-serif';
      ctx.fillText(m.label, left, top - 4);
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      [0, mx].forEach((v) => {
        ctx.beginPath(); ctx.moveTo(left, y(v)); ctx.lineTo(width, y(v)); ctx.stroke();
        ctx.textAlign = 'right';
        ctx.fillText(m.digits === 1 ? String(v) : v.toFixed(1), left - 4, y(v) + 4);
        ctx.textAlign = 'left';
      });
      if (!trace) return;
      const values = trace[m.key];
      // one vertex per pixel column at most: min and max of the frames it covers
      const perPx = (end - start) / Math.max(w, 1);
      ctx.strokeStyle = line;
      ctx.lineWidth = perPx > 1 ? 1 : 2;
      ctx.beginPath();
      let pen = false;
      if (perPx <= 1) {
        values.forEach((v, i) => {
          if (v == null) { pen = false; return; }
          const x = xOf(trace.start + i);
          if (pen) ctx.lineTo(x, y(v)); else ctx.moveTo(x, y(v));
          pen = true;
        });
      } else {
        for (let px = 0; px < w; px++) {
          const a = Math.floor(start + px * perPx) - trace.start;
          const b = Math.floor(start + (px + 1) * perPx) - trace.start;
          let lo = Infinity, hi = -Infinity;
          for (let i = Math.max(0, a); i < Math.min(values.length, b); i++) {
            const v = values[i];
            if (v == null) continue;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
          if (lo === Infinity) { pen = false; continue; }
          if (pen) ctx.lineTo(left + px, y(hi)); else ctx.moveTo(left + px, y(hi));
          ctx.lineTo(left + px, y(lo));
          pen = true;
        }
      }
      ctx.stroke();
      if (m.low) {
        ctx.strokeStyle = '#d03b3b';
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(left, y(0.5)); ctx.lineTo(width, y(0.5)); ctx.stroke();
        ctx.setLineDash([]);
      }
    });
    const cursor = (f, color, dash) => {
      ctx.strokeStyle = color;
      ctx.setLineDash(dash);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(xOf(f), 0); ctx.lineTo(xOf(f), totalH); ctx.stroke();
      ctx.setLineDash([]);
    };
    cursor(frame, css.getPropertyValue('--text') || '#000', []);
    if (hoverFrame != null) cursor(hoverFrame, sub, [2, 3]);
  }, [trace, width, w, frame, start, end, xOf, totalH, hoverFrame, nScored]); // eslint-disable-line react-hooks/exhaustive-deps

  const frameAt = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - left;
    if (x < 0 || x > w) return null;
    return Math.round(start + (x / w) * (end - start));
  };

  return (
    <div className="qc-timeline" ref={setEl}>
      <canvas ref={canvasRef} style={{ width: width || 0, height: totalH, display: 'block', cursor: 'pointer' }}
              onMouseMove={(e) => setHoverFrame(frameAt(e))} onMouseLeave={() => setHoverFrame(null)}
              onClick={(e) => { const f = frameAt(e); if (f != null) onSeek(f); }} />
      {hoverFrame != null && (
        <div className="eth-tooltip qc-tooltip" style={{ left: Math.min(xOf(hoverFrame) + 12, width - 200), top: 0 }}>
          <b>Frame {hoverFrame.toLocaleString()}</b> <span className="qc-muted">({hoverFrame >= frame ? '+' : ''}{((hoverFrame - frame) / framerate).toFixed(2)} s)</span>
          {METRICS.map((m) => <div key={m.key}>{m.label}: <b>{fix(valueAt(m, hoverFrame), m.key === 'n_detected' ? 0 : 2)}</b></div>)}
          <div className="qc-hint">Click: go to this frame</div>
        </div>
      )}
    </div>
  );
}

export default function PoseTab({ active, currentExperiment, request, viewerFrame, framerate, chunksize: viewerChunksize,
                                  ethogramFlies = [], onOpenInViewer, onOpenInEthogram }) {
  const [flies, setFlies] = useState([]);
  const [fly, setFly] = useState(null);
  const [frame, setFrame] = useState(null);
  const [frameInput, setFrameInput] = useState('');
  const [pose, setPose] = useState(null);
  const [image, setImage] = useState(null);
  const [trace, setTrace] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [zoom, setZoom] = useStoredNumber('fh-pose-zoom', 1.5);
  const [windowSeconds, setWindowSeconds] = useStoredNumber('fh-pose-window', 10);
  const [showLabels, setShowLabels] = useState(false);
  const [showJoints, setShowJoints] = useState(true);
  const [viewEl, setViewEl] = useState(null);
  const { width: viewWidth } = useElementSize(viewEl);
  const latest = useRef(0);
  const fps = framerate || 150;
  const chunksize = pose?.chunksize || viewerChunksize || 45000;
  const windowFrames = Math.round(windowSeconds * fps);

  useEffect(() => {
    if (!currentExperiment) return;
    api.get('/api/pose/flies').then((r) => {
      const list = unwrap(r.data);
      setFlies(list);
      setFly((f) => (list.some((x) => x.fly === f) ? f : (list.find((x) => x.available) || list[0])?.fly ?? null));
    }).catch(() => setFlies([]));
  }, [currentExperiment]);

  useEffect(() => {
    if (!request) return;
    setFly(request.fly);
    if (request.frameNumber != null) setFrame(request.frameNumber);
  }, [request]);

  // First shown: the Group viewer's frame
  useEffect(() => {
    if (active && frame == null && viewerFrame != null) setFrame(viewerFrame);
  }, [active, frame, viewerFrame]);

  useEffect(() => { if (frame != null) setFrameInput(String(frame)); }, [frame]);

  // Pose + image of the frame; the latest request wins
  useEffect(() => {
    if (!active || !fly || frame == null) return;
    const id = ++latest.current;
    api.get(`/api/pose/${fly}/frame/${frame}`)
      .then((r) => { if (id === latest.current) setPose(unwrap(r.data)); })
      .catch((err) => { if (id === latest.current) setPose({ error: err.response?.data?.error || err.message, nodes: [] }); });
    const img = new Image();
    img.onload = () => { if (id === latest.current) setImage(img); };
    img.src = apiUrl(`/api/frame/${frame}`);
  }, [active, fly, frame]);

  // Traces: fetched again when the window leaves what was fetched
  useEffect(() => {
    if (!active || !fly || frame == null) return;
    const lo = frame - windowFrames;
    const hi = frame + windowFrames;
    if (trace && trace.fly === fly && lo >= trace.from && hi <= trace.to) return;
    const from = lo - windowFrames;
    const to = hi + windowFrames;
    api.get(`/api/pose/${fly}/trace`, { params: { start: Math.max(0, from), end: to } })
      .then((r) => setTrace({ ...unwrap(r.data), fly, from, to }))
      .catch(() => setTrace(null));
  }, [active, fly, frame, windowFrames]); // eslint-disable-line react-hooks/exhaustive-deps

  const seek = useCallback((f) => {
    if (!pose || pose.first_frame == null) { setFrame(Math.max(0, f)); return; }
    setFrame(Math.max(pose.first_frame, Math.min(pose.last_frame, f)));
  }, [pose]);

  const stepFly = useCallback((d) => {
    if (!flies.length) return;
    const i = flies.findIndex((f) => f.fly === fly);
    setFly(flies[(i + d + flies.length) % flies.length].fly);
  }, [flies, fly]);

  // ←/→ one frame (Shift: 10), ↑/↓ previous / next fly
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      const n = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') { e.preventDefault(); setFrame((f) => (f == null ? f : f - n)); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setFrame((f) => (f == null ? f : f + n)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); stepFly(-1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); stepFly(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, stepFly]);

  const size = Math.max(240, Math.min(560, (viewWidth || 900) - 460));
  const shownPose = useMemo(() => (pose && !showJoints ? { ...pose, nodes: pose.nodes.filter((n) => n.scored) } : pose), [pose, showJoints]);
  const nodes = shownPose?.nodes || [];
  const steps = [[-chunksize, '⇤ chunk'], [-Math.round(fps), '−1 s'], [-10, '−10'], [-1, '−1'], [1, '+1'], [10, '+10'], [Math.round(fps), '+1 s'], [chunksize, 'chunk ⇥']];

  if (!flies.length) {
    return <div className="ov"><div className="card ov-controls toolbar">No flies with pose in the loaded experiment.</div></div>;
  }

  return (
    <div className="ov" ref={setViewEl}>
      <div className="card ov-controls toolbar">
        <button onClick={() => stepFly(-1)} title="Previous fly (↑)">◀</button>
        <label className="field">
          Fly
          <select value={fly || ''} onChange={(e) => setFly(e.target.value)}>
            {flies.map((f) => <option key={f.fly} value={f.fly}>{f.fly}{f.available ? '' : ' (no pose file yet)'}</option>)}
          </select>
        </label>
        <button onClick={() => stepFly(1)} title="Next fly (↓)">▶</button>
        <span className="toolbar-sep" />
        {steps.map(([d, label]) => (
          <button key={label} onClick={() => frame != null && seek(frame + d)} title={`${d > 0 ? '+' : ''}${d} frames`}>{label}</button>
        ))}
        <label className="field">
          Frame
          <input type="number" value={frameInput} style={{ width: 110 }}
                 onChange={(e) => setFrameInput(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter' && frameInput !== '') seek(Number(frameInput)); }}
                 onBlur={() => frameInput !== '' && Number(frameInput) !== frame && seek(Number(frameInput))} />
        </label>
        <button onClick={() => frame != null && onOpenInViewer(frame)} title="Show this frame in the Group viewer">Open in Group viewer</button>
        <button onClick={() => frame != null && onOpenInEthogram(fly, frame)}
                disabled={!ethogramFlies.some((f) => f.fly === fly && f.available)}
                title={ethogramFlies.some((f) => f.fly === fly && f.available)
                  ? "Show this fly's ethogram at this frame, and move the Group viewer to it too"
                  : 'This fly has no ethogram'}>
          Open in Ethograms + Group viewer
        </button>
      </div>

      <div className="pose-main">
        <section className="card pose-view">
          <header className="card-header">
            <span>Frame {frame?.toLocaleString()}</span>
            {frame != null && <span className="ov-count">chunk {Math.floor(frame / chunksize)}</span>}
            <span className="spacer" />
            <label className="field">
              Zoom
              <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))} title="Area shown, in squares of the pose">
                {ZOOMS.map((z) => <option key={z} value={z}>{z}×</option>)}
              </select>
            </label>
            <label className="field"><input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />Labels</label>
            <label className="field" title="Leg joints (*J), not counted in the pose score"><input type="checkbox" checked={showJoints} onChange={(e) => setShowJoints(e.target.checked)} />Joints</label>
          </header>
          <div className="card-body">
            <PoseCanvas pose={shownPose} image={image} zoom={zoom} size={size}
                        hovered={hovered} setHovered={setHovered} showLabels={showLabels} />
            <div className="qc-legend pose-bands">
              Confidence {BANDS.map((b) => <span key={b.label}><span className="qc-swatch" style={{ background: b.color }} />{b.label}</span>)}
            </div>
          </div>
        </section>

        <section className="card pose-side">
          <header className="card-header"><span>Body parts</span></header>
          {pose && !pose.error && (
            <div className="pose-summary">
              <div><span className="ov-stat-label">Detected</span><b>{pose.n_detected}</b> of {pose.n_scored}</div>
              <div><span className="ov-stat-label">Confidence</span><b>{fix(pose.confidence)}</b></div>
              <div title="Σ confidence of the detected parts / number of scored parts"><span className="ov-stat-label">Pose score</span>
                <b className={pose.score != null && pose.score < 0.5 ? 'qc-bad-text' : undefined}>{fix(pose.score)}</b></div>
              <div title="instance_scores of the SLEAP file (sum over every node, also the joints)"><span className="ov-stat-label">SLEAP instance</span><b>{fix(pose.instance_score)}</b></div>
            </div>
          )}
          <div className="ov-scroll">
            <table className="pe-table ov-table pose-table">
              <thead><tr><th>Body part</th><th>Confidence</th><th>x</th><th>y</th></tr></thead>
              <tbody>
                {nodes.map((n) => (
                  <tr key={n.name} className={`${n.name === hovered ? 'pose-selected' : ''}${n.detected ? '' : ' qc-muted'}`}
                      onMouseEnter={() => setHovered(n.name)} onMouseLeave={() => setHovered(null)}>
                    <td>{n.name}{!n.scored && <span className="qc-muted" title="Not counted in the pose score"> *</span>}</td>
                    <td>
                      {n.detected ? (
                        <span className="pose-conf">
                          <span className="pose-conf-bar"><span style={{ width: `${Math.min(100, 100 * n.confidence)}%`, background: bandOf(n.confidence).color }} /></span>
                          <span className="qc-num">{fix(n.confidence, 3)}</span>
                        </span>
                      ) : 'not detected'}
                    </td>
                    <td className="qc-num">{n.xy ? fix(n.xy[0], 1) : n.rel ? `(${fix(n.rel[0], 1)})` : ''}</td>
                    <td className="qc-num">{n.xy ? fix(n.xy[1], 1) : n.rel ? `(${fix(n.rel[1], 1)})` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {nodes.some((n) => !n.scored) && <div className="qc-muted qc-pad">* not counted in the pose score{pose && !pose.centroid ? ' · (x, y) in the square: the fly has no position here' : ''}</div>}
        </section>
      </div>

      <section className="card">
        <header className="card-header">
          <span>Frames around</span>
          <span className="spacer" />
          <label className="field">
            Window
            <select value={windowSeconds} onChange={(e) => setWindowSeconds(Number(e.target.value))}>
              {WINDOWS.map((s) => <option key={s} value={s}>± {s} s</option>)}
            </select>
          </label>
        </header>
        <div className="card-body">
          {frame != null && (
            <Traces trace={trace && trace.fly === fly ? trace : null} frame={frame} windowFrames={windowFrames}
                    framerate={fps} onSeek={seek} nScored={pose?.n_scored || 12} />
          )}
        </div>
      </section>
    </div>
  );
}
