// BurstTrace.js

import { useRef, useState, useLayoutEffect } from 'react';

// segments: { auto: [{t0,t1,start_frame,end_frame}], gt: [...], done, params } | null
// onAddGt(t0, t1)   — called after a Shift+drag, times in trace seconds
// onDeleteGt(seg)   — called after clicking a GT bar and confirming
function BurstTrace({ trace, playT, onScrub, scrubbingRef, svgExportRef,
                      segments, onAddGt, onDeleteGt }) {

  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const [size, setSize] = useState({ W: 560, H: 240 });   // sane defaults pre-measure
  const [draft, setDraft] = useState(null);               // {t0, t1} while Shift+dragging

  // measure the container; redraw the viewBox at its true pixel size (no stretch)
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ W: Math.round(width), H: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // hooks must run every render — bail AFTER them
  if (!trace || !trace.points.length) {
    return <div ref={wrapRef} style={{ width: '100%', height: '100%' }} />;
  }

  const ts = trace.points.map(p => p.t_s);
  const xmax = Math.max(10, ...ts);
  const ys = trace.points.map(p => p.dist).filter(v => v != null);
  const ymax = Math.max(0.01, ...ys);
  const ymin = Math.min(0, ...ys);        // usually 0 since dist is min-subtracted

  const autoSegs = segments?.auto ?? [];
  const gtSegs = segments?.gt ?? [];
  const showSegLanes = segments != null;

  const { W, H } = size;
  // extra bottom margin only when the segmentation lanes are drawn
  const m = { t: 10, r: 12, b: showSegLanes ? 64 : 40, l: 44 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;

  const X = t => m.l + (t / xmax) * iw;
  const Y = v => m.t + ih - (v / ymax) * ih;

  // inverse of X(): pixel (in the SVG's own viewBox coords) -> t_s, clamped to plot
  const pxToT = (clientX) => {
    const rect = svgRef.current.getBoundingClientRect();
    const vbX = (clientX - rect.left) / rect.width * W;     // account for CSS scaling
    const t = (vbX - m.l) / iw * xmax;
    return Math.min(xmax, Math.max(0, t));
  };

  // plain drag scrubs; Shift+drag draws a ground-truth event
  const onDown = (e) => {
    if (e.shiftKey && onAddGt) {
      const t = pxToT(e.clientX);
      setDraft({ t0: t, t1: t });
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;                                   // no scrubbing while drawing
    }
    if (scrubbingRef) scrubbingRef.current = true;
    onScrub?.(pxToT(e.clientX));
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (draft) { const t = pxToT(e.clientX); setDraft(d => d && { ...d, t1: t }); return; }
    if (scrubbingRef?.current) onScrub?.(pxToT(e.clientX));
  };
  const onUp = (e) => {
    if (draft) {
      const { t0, t1 } = draft;
      setDraft(null);
      // ignore accidental Shift+clicks: require at least 2 frames
      if (Math.abs(t1 - t0) * (trace.fps || 150) >= 2) onAddGt?.(t0, t1);
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      return;
    }
    if (scrubbingRef) scrubbingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };
  // leaving the plot ends a scrub, but never commits a half-drawn event
  const onLeave = (e) => { if (!draft) onUp(e); };

  // build the polyline, breaking at nulls (NaN = retracted, don't bridge)
  const segs = [];
  let cur = [];
  trace.points.forEach(p => {
    if (p.dist == null) { if (cur.length) { segs.push(cur); cur = []; } }
    else cur.push(`${X(p.t_s).toFixed(1)},${Y(p.dist).toFixed(1)}`);
  });
  if (cur.length) segs.push(cur);

  const laneY = m.t + ih + 10;      // pipeline bout duration bars
  const gapY  = m.t + ih + 24;      // inter-bout gap brackets
  const autoY = m.t + ih + 42;      // automatic resegmentation
  const gtY   = m.t + ih + 52;      // human ground truth

  return (
<div ref={wrapRef} style={{ width: '100%', height: '100%' }}>
      <svg ref={(el) => { svgRef.current = el; if (svgExportRef) svgExportRef.current = el; }}
        viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%', display: 'block',
         cursor: 'ew-resize', touchAction: 'none', userSelect: 'none' }}
           onPointerDown={onDown} onPointerMove={onMove}
           onPointerUp={onUp} onPointerLeave={onLeave}>

      {/* ground-truth bands BEHIND the trace, so you can judge boundaries against it */}
      {gtSegs.map((s, i) => (
        <rect key={`gtb${i}`} x={X(s.t0)} y={m.t} width={Math.max(1, X(s.t1) - X(s.t0))}
              height={ih} fill="#2ca02c" opacity="0.12" pointerEvents="none" />
      ))}
      {/* the event being drawn right now */}
      {draft && (
        <rect x={X(Math.min(draft.t0, draft.t1))} y={m.t}
              width={Math.max(1, Math.abs(X(draft.t1) - X(draft.t0)))} height={ih}
              fill="#2ca02c" opacity="0.25" stroke="#2ca02c" strokeDasharray="3 2"
              pointerEvents="none" />
      )}

      {/* axes */}
      <line x1={m.l} y1={m.t} x2={m.l} y2={m.t + ih} stroke="#999" />
      <line x1={m.l} y1={m.t + ih} x2={m.l + iw} y2={m.t + ih} stroke="#999" />
      {/* y-axis min/max labels */}
          <text x={m.l - 4} y={Y(ymin)} textAnchor="end" dominantBaseline="middle"
                fontSize="9" fill="#666">{ymin.toFixed(2)}</text>
          <text x={m.l - 4} y={Y(ymax)} textAnchor="end" dominantBaseline="middle"
                fontSize="9" fill="#666">{ymax.toFixed(2)}</text>

      <text x={m.l + iw / 2} y={H - 4} textAnchor="middle" fontSize="11">time within burst (s)</text>
      <text x={12} y={m.t + ih / 2} textAnchor="middle" fontSize="11"
            transform={`rotate(-90 12 ${m.t + ih / 2})`}>Δ head–proboscis (mm)</text>

      {/* trace */}
      {segs.map((pts, i) => (
        <polyline key={i} points={pts.join(' ')} fill="none" stroke="#1f77b4" strokeWidth="1.6" />
      ))}

      {/* peak dots */}
      {trace.points.filter(p => p.is_peak && p.dist != null).map((p, i) => (
        <circle key={i} cx={X(p.t_s)} cy={Y(p.dist)} r="3" fill="#d62728" />
      ))}

      {/* bout duration bars + labels */}
      {trace.spans.map(s => (
        <g key={`s${s.bout_in_burst}`}>
          <line x1={X(s.t0)} y1={laneY} x2={X(s.t1)} y2={laneY}
                stroke="#1f77b4" strokeWidth="4" strokeLinecap="butt" />
          <text x={X((s.t0 + s.t1) / 2)} y={laneY + 11} textAnchor="middle"
                fontSize="9" fill="#1f77b4">{s.dur.toFixed(2)}s</text>
        </g>
      ))}

      {/* inter-bout gap brackets + labels */}
      {trace.gaps.map((g, i) => (
        <g key={`g${i}`} stroke="#888" fill="#888">
          <line x1={X(g.g0)} y1={gapY} x2={X(g.g1)} y2={gapY} strokeWidth="1" />
          <line x1={X(g.g0)} y1={gapY - 3} x2={X(g.g0)} y2={gapY + 3} strokeWidth="1" />
          <line x1={X(g.g1)} y1={gapY - 3} x2={X(g.g1)} y2={gapY + 3} strokeWidth="1" />
          <text x={X((g.g0 + g.g1) / 2)} y={gapY + 12} textAnchor="middle"
                fontSize="8" stroke="none">{g.gap.toFixed(2)}s</text>
        </g>
      ))}

      {/* ---- segmentation lanes ---- */}
      {showSegLanes && (
        <>
          <text x={m.l - 4} y={autoY} textAnchor="end" dominantBaseline="middle"
                fontSize="8" fill="#ff7f0e">auto</text>
          <text x={m.l - 4} y={gtY} textAnchor="end" dominantBaseline="middle"
                fontSize="8" fill="#2ca02c">GT{segments?.done ? ' ✓' : ''}</text>

          {/* automatic segments: read-only */}
          {autoSegs.map((s, i) => (
            <line key={`au${i}`} x1={X(s.t0)} y1={autoY} x2={Math.max(X(s.t1), X(s.t0) + 1)}
                  y2={autoY} stroke="#ff7f0e" strokeWidth="5" strokeLinecap="butt">
              <title>{`auto ${(s.t1 - s.t0).toFixed(2)}s`}</title>
            </line>
          ))}

          {/* ground-truth segments: click to delete */}
          {gtSegs.map((s, i) => (
            <line key={`gt${i}`} x1={X(s.t0)} y1={gtY} x2={Math.max(X(s.t1), X(s.t0) + 1)}
                  y2={gtY} stroke="#2ca02c" strokeWidth="7" strokeLinecap="butt"
                  style={{ cursor: 'pointer' }}
                  onPointerDown={e => e.stopPropagation()}          // don't scrub
                  onClick={e => {
                    e.stopPropagation();
                    if (window.confirm(`Delete GT event ${(s.t1 - s.t0).toFixed(2)}s?`))
                      onDeleteGt?.(s);
                  }}>
              <title>{`GT ${(s.t1 - s.t0).toFixed(2)}s — click to delete`}</title>
            </line>
          ))}
        </>
      )}

      {/* playhead: visible line + a wide invisible grab target */}
      {playT != null && playT >= 0 && playT <= xmax && (
        <>
          <line x1={X(playT)} y1={m.t} x2={X(playT)} y2={m.t + ih}
                stroke="#d62728" strokeWidth="1.5" />
          <line x1={X(playT)} y1={m.t} x2={X(playT)} y2={m.t + ih}
                stroke="transparent" strokeWidth="14" />
        </>
      )}
      </svg>
    </div>
  );
}

export default BurstTrace;