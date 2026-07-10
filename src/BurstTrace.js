import { useRef } from 'react';


function BurstTrace({ trace, playT, onScrub, scrubbingRef }) {
  const svgRef = useRef(null);

  if (!trace || !trace.points.length) return null;

  const W = 560, H = 240, m = { t: 10, r: 12, b: 40, l: 44 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;

  const ts = trace.points.map(p => p.t_s);
  const xmax = Math.max(10, ...ts);
  const ys = trace.points.map(p => p.dist).filter(v => v != null);
  const ymax = Math.max(0.01, ...ys);
  const X = t => m.l + (t / xmax) * iw;
  const Y = v => m.t + ih - (v / ymax) * ih;

  // inverse of X(): pixel (in the SVG's own viewBox coords) -> t_s, clamped to plot
  const pxToT = (clientX) => {
    const rect = svgRef.current.getBoundingClientRect();
    const vbX = (clientX - rect.left) / rect.width * W;     // account for CSS scaling
    const t = (vbX - m.l) / iw * xmax;
    return Math.min(xmax, Math.max(0, t));
  };

  const onDown = (e) => {
    if (scrubbingRef) scrubbingRef.current = true;
    onScrub?.(pxToT(e.clientX));
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (scrubbingRef?.current) onScrub?.(pxToT(e.clientX));
  };
  const onUp = (e) => {
    if (scrubbingRef) scrubbingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  
  // build the polyline, breaking at nulls (NaN = retracted, don't bridge)
  const segs = [];
  let cur = [];
  trace.points.forEach(p => {
    if (p.dist == null) { if (cur.length) { segs.push(cur); cur = []; } }
    else cur.push(`${X(p.t_s).toFixed(1)},${Y(p.dist).toFixed(1)}`);
  });
  if (cur.length) segs.push(cur);

  const laneY = m.t + ih + 10;      // bout duration bars
  const gapY  = m.t + ih + 24;      // inter-bout gap brackets

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
         style={{ width: '100%', height: 'auto', cursor: 'ew-resize', touchAction: 'none' }}
         onPointerDown={onDown} onPointerMove={onMove}
         onPointerUp={onUp} onPointerLeave={onUp}>

      {/* axes */}
      <line x1={m.l} y1={m.t} x2={m.l} y2={m.t + ih} stroke="#999" />
      <line x1={m.l} y1={m.t + ih} x2={m.l + iw} y2={m.t + ih} stroke="#999" />
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

      {/* playhead */}
      {playT != null && playT >= 0 && playT <= xmax && (
        <line x1={X(playT)} y1={m.t} x2={X(playT)} y2={m.t + ih}
              stroke="#d62728" strokeWidth="1.5" />
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
  );
}

export default  BurstTrace;