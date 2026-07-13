// ConfidenceTrace.js
//
// A trace panel that plots the SLEAP proboscis-node CONFIDENCE for every frame in the
// burst, sharing the same x-axis (time within burst) and playhead as BurstTrace. It's a
// near-twin of BurstTrace: same ResizeObserver sizing, same two-way scrubbing, same
// span/gap annotations — only the y-signal differs (conf in [0,1] instead of distance).
//
// Requires each trace point to carry `conf` (the proboscis confidence). See the backend
// note in the integration instructions: add `conf` to /api/pe/trace points.

import { useRef, useState, useLayoutEffect } from 'react';

const CONF_THRESH = 0.5;   // draw a reference line here (your pipeline's PROD_THRESH)

function ConfidenceTrace({ trace, playT, onScrub, scrubbingRef }) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const [size, setSize] = useState({ W: 560, H: 240 });

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

  // hooks above; bail after
  if (!trace || !trace.points.length) {
    return <div ref={wrapRef} style={{ width: '100%', height: '100%' }} />;
  }

  const { W, H } = size;
  const m = { t: 10, r: 12, b: 40, l: 44 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;

  const ts = trace.points.map(p => p.t_s);
  const xmax = Math.max(10, ...ts);
  // confidence is normalized; fix the y-domain to [0, 1] (allow >1 just in case)
  const confs = trace.points.map(p => p.conf).filter(v => v != null);
  const ymax = Math.max(1, ...confs);

  const X = t => m.l + (t / xmax) * iw;
  const Y = v => m.t + ih - (v / ymax) * ih;

  const pxToT = (clientX) => {
    const rect = svgRef.current.getBoundingClientRect();
    const vbX = (clientX - rect.left) / rect.width * W;
    const t = (vbX - m.l) / iw * xmax;
    return Math.min(xmax, Math.max(0, t));
  };
  const onDown = (e) => {
    if (scrubbingRef) scrubbingRef.current = true;
    onScrub?.(pxToT(e.clientX));
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => { if (scrubbingRef?.current) onScrub?.(pxToT(e.clientX)); };
  const onUp = (e) => {
    if (scrubbingRef) scrubbingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  // polyline, breaking at nulls (missing conf = undetected node)
  const segs = [];
  let cur = [];
  trace.points.forEach(p => {
    if (p.conf == null) { if (cur.length) { segs.push(cur); cur = []; } }
    else cur.push(`${X(p.t_s).toFixed(1)},${Y(p.conf).toFixed(1)}`);
  });
  if (cur.length) segs.push(cur);

  const laneY = m.t + ih + 10;
  const gapY  = m.t + ih + 24;

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%' }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
           style={{ width: '100%', height: '100%', display: 'block',
                    cursor: 'ew-resize', touchAction: 'none' }}
           onPointerDown={onDown} onPointerMove={onMove}
           onPointerUp={onUp} onPointerLeave={onUp}>

        {/* axes */}
        <line x1={m.l} y1={m.t} x2={m.l} y2={m.t + ih} stroke="#999" />
        <line x1={m.l} y1={m.t + ih} x2={m.l + iw} y2={m.t + ih} stroke="#999" />
        {/* y-axis min/max labels */}
        <text x={m.l - 4} y={Y(0)} textAnchor="end" dominantBaseline="middle"
              fontSize="9" fill="#666">0</text>
        <text x={m.l - 4} y={Y(ymax)} textAnchor="end" dominantBaseline="middle"
              fontSize="9" fill="#666">{ymax.toFixed(2)}</text>
              
        <text x={m.l + iw / 2} y={H - 4} textAnchor="middle" fontSize="11">time within burst (s)</text>
        <text x={12} y={m.t + ih / 2} textAnchor="middle" fontSize="11"
              transform={`rotate(-90 12 ${m.t + ih / 2})`}>proboscis confidence</text>

        {/* confidence threshold reference line */}
        {CONF_THRESH <= ymax && (
          <>
            <line x1={m.l} y1={Y(CONF_THRESH)} x2={m.l + iw} y2={Y(CONF_THRESH)}
                  stroke="#bbb" strokeDasharray="4 3" />
            <text x={m.l + iw} y={Y(CONF_THRESH) - 2} textAnchor="end"
                  fontSize="8" fill="#999">{CONF_THRESH}</text>
          </>
        )}

        {/* confidence trace */}
        {segs.map((pts, i) => (
          <polyline key={i} points={pts.join(' ')} fill="none" stroke="#8c564b" strokeWidth="1.6" />
        ))}

        {/* peak dots */}
        {trace.points.filter(p => p.is_peak && p.conf != null).map((p, i) => (
          <circle key={i} cx={X(p.t_s)} cy={Y(p.conf)} r="3" fill="#d62728" />
        ))}

        {/* bout duration bars + labels */}
        {trace.spans.map(s => (
          <g key={`s${s.bout_in_burst}`}>
            <line x1={X(s.t0)} y1={laneY} x2={X(s.t1)} y2={laneY}
                  stroke="#8c564b" strokeWidth="4" strokeLinecap="butt" />
            <text x={X((s.t0 + s.t1) / 2)} y={laneY + 11} textAnchor="middle"
                  fontSize="9" fill="#8c564b">{s.dur.toFixed(2)}s</text>
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

        {/* playhead: visible line + wide invisible grab target */}
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

export default ConfidenceTrace;
