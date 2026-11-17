// EthoscopeTab.js  —  sleep of the loaded experiment's flies in the ethoscope they lived in
//
// /api/ethoscope/flies (idtrackerai_validator_server/ethoscope.py) finds each fly's ethoscope
// run from its metadata row (machine_name, date, region_id); /api/ethoscope/sleep scores
// sleep as FSLRetho (sleepr's max velocity detector, 5 min rule) and returns per fly one
// character per window ('1' asleep, '0' awake, '-' no data) on the ZT clock (t = seconds
// since ZT0 of the day the run started). Binning, averages and SEM are done here, so
// changing the bin, the flies or the grouping does not ask the server again.
//
// Views: "Each fly" (small multiples, one row per fly) and "Average" (mean ± SEM of the
// selected flies, optionally one line per genotype / sex). Dark phases of LD are shaded.
// The tab is disabled by App.js when no fly of the experiment has an ethoscope run.
//
// Snapshots: the run's IMG_SNAPSHOTS (whole frame every ~5 min), from /api/ethoscope/snapshots on
// the traces' clock. "Snapshots on hover" shows, over the chart, the snapshot nearest the pointer
// cropped to the fly's ROI (Each fly: the row's fly; Average: the selected flies); a click opens it in
// the "Snapshots" card, which steps through them (◀ ▶, ← →, slider) and marks its time on the chart.

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import api, { apiUrl } from './api';
import { useConsole } from './MessageConsole';
import { useElementSize } from './layout';
import './EthoscopeTab.css';

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);
const BINS = [5, 10, 15, 30, 60, 120];
const SERIES = 8;                           // categorical slots (index.css --eth-series-N)
const PARAMS = [
  ['velocity_correction_coef', 'Movement threshold', 0.0001, 'Velocity correction coefficient (FSLRetho: 0.0048)'],
  ['min_time_immobile', 'Min. immobile (s)', 10, 'Immobile for at least this long = asleep (5 min rule: 300)'],
  ['time_window_length', 'Window (s)', 5, 'Window length of the motion detector'],
  ['masking_duration', 'Masking (s)', 1, 'Movement ignored after an interaction (sleep deprivation)'],
];

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const flyLabel = (f) => f.label || `Fly ${f.identity}`;
const SCOPES = [
  ['experiment', 'This experiment', "The loaded experiment's flies"],
  ['run', 'Whole ethoscope run', 'Every ROI of the ethoscope runs these flies were in'],
  ['batch', 'Same-date batch', 'Every ROI of every ethoscope run started on the same date as these flies\' runs'],
];
const fmtZt = (s) => `ZT ${(s / 3600).toFixed(Math.abs(s % 3600) < 1 ? 0 : 1)}`;
const fmtHours = (s) => (!s ? '0 h' : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);
const fmtPct = (v) => (v == null ? '–' : `${(100 * v).toFixed(0)}%`);

// fraction asleep per bin of `bin` s: { start, values: [v or null] } on bins k*bin
function binTrace(trace, tw, bin) {
  if (!trace || trace.t0 == null || !trace.asleep) return null;
  const s = trace.asleep;
  const first = Math.floor(trace.t0 / bin);
  const last = Math.floor((trace.t0 + (s.length - 1) * tw) / bin);
  const asleep = new Float64Array(last - first + 1);
  const count = new Float64Array(last - first + 1);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 45) continue;                 // '-' no data
    const k = Math.floor((trace.t0 + i * tw) / bin) - first;
    count[k] += 1;
    if (c === 49) asleep[k] += 1;
  }
  const values = Array.from(count, (n, k) => (n ? asleep[k] / n : null));
  return { first, values };
}

// whole-run summary of one fly: % asleep overall / in light / in dark (ZT 0–12 / 12–24), minutes per day
function summarize(trace, tw) {
  if (!trace || trace.t0 == null) return null;
  const s = trace.asleep;
  let n = 0, a = 0, nl = 0, al = 0, nd = 0, ad = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 45) continue;
    const zt = ((((trace.t0 + i * tw) / 3600) % 24) + 24) % 24;
    const sl = c === 49 ? 1 : 0;
    n += 1; a += sl;
    if (zt < 12) { nl += 1; al += sl; } else { nd += 1; ad += sl; }
  }
  return {
    hours: (n * tw) / 3600,
    all: n ? a / n : null, light: nl ? al / nl : null, dark: nd ? ad / nd : null,
    minPerDay: n ? (a / n) * 1440 : null,
  };
}

function lightCycleOf(flies) {
  const counts = {};
  flies.forEach((f) => { const lc = (f.light_cycle || 'LD').toUpperCase(); counts[lc] = (counts[lc] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'LD';
}

// ── snapshots ────────────────────────────────────────────────────────────────

const SNAP_MAX_GAP = 600;
const MAX_TIP_FLIES = 6;                  // Average: thumbnails in the tooltip                  // s: no snapshot shown farther than this from the pointer
const snapUrl = (key, id, crop = 'roi', w = 400) => apiUrl(`/api/ethoscope/snapshot?fly=${encodeURIComponent(key)}&id=${id}&crop=${crop}&w=${w}`);

// index of the snapshot nearest t in [[id, t], ...] sorted by t, or -1
function nearestSnap(list, t) {
  if (!list || !list.length) return -1;
  let lo = 0, hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid][1] < t) lo = mid + 1; else hi = mid;
  }
  if (lo > 0 && Math.abs(list[lo - 1][1] - t) <= Math.abs(list[lo][1] - t)) lo -= 1;
  return lo;
}

// state of a fly's trace at t: 'asleep' | 'awake' | 'no data' | null (outside the trace)
function stateAt(trace, tw, t) {
  if (!trace || trace.t0 == null) return null;
  const i = Math.floor((t - trace.t0) / tw);
  if (i < 0 || i >= trace.asleep.length) return null;
  const c = trace.asleep[i];
  return c === '1' ? 'asleep' : c === '0' ? 'awake' : 'no data';
}

// thumbnails over the chart: one per fly, the snapshot nearest t (none beyond SNAP_MAX_GAP)
function SnapTip({ items, t, left, top, flipX, flipY, inline }) {
  const shown = items.map(({ fly, snaps }) => {
    const list = snaps?.snapshots;
    const k = nearestSnap(list, t);
    if (k < 0 || Math.abs(list[k][1] - t) > SNAP_MAX_GAP) return null;
    return { fly, id: list[k][0], st: list[k][1], after: snaps.moved_t != null && list[k][1] > snaps.moved_t };
  }).filter(Boolean);
  if (!shown.length) return null;
  return (
    <div className={inline ? 'es-snaptip es-snaptip-inline' : 'es-snaptip'} style={inline ? undefined : { left, top, transform: `translate(${flipX ? '-100%' : '0'}, ${flipY ? '-100%' : '0'})` }}>
      {shown.map(({ fly, id, st, after }) => (
        <div key={fly.key} className="es-snaptip-item">
          <div className="es-snaptip-label">
            {flyLabel(fly)} · snapshot {fmtZt(st)}{Math.abs(st - t) >= 60 ? ` (${Math.round((st - t) / 60) > 0 ? '+' : ''}${Math.round((st - t) / 60)} min)` : ''}
            {after && <span className="es-warn"> · after the move</span>}
          </div>
          <img src={snapUrl(fly.key, id)} alt={`${flyLabel(fly)} at ${fmtZt(st)}`} width={360} />
        </div>
      ))}
    </div>
  );
}

// ── chart pieces ─────────────────────────────────────────────────────────────

const M = { left: 52, right: 16 };

function useScales(width, domain, left = M.left) {
  return useMemo(() => {
    const [t0, t1] = domain;
    const w = Math.max(10, width - left - M.right);
    const x = (t) => left + ((t - t0) / Math.max(1, t1 - t0)) * w;
    const inv = (px) => t0 + ((px - left) / w) * (t1 - t0);
    const step = (t1 - t0) / 3600 > 72 ? 12 : 6;
    const ticks = [];
    for (let h = Math.ceil(t0 / 3600 / step) * step; h * 3600 <= t1; h += step) ticks.push(h * 3600);
    return { x, inv, ticks };
  }, [width, domain, left]);
}

function Shading({ domain, x, top, height, cycle }) {
  if (cycle === 'LL') return null;
  const [t0, t1] = domain;
  const rects = [];
  for (let d = Math.floor(t0 / 86400); d * 86400 < t1; d++) {
    // LD: ZT 12–24 dark; DD: everything after the first day is subjective (shade lightly)
    const a = Math.max(t0, d * 86400 + (cycle === 'DD' ? 0 : 43200));
    const b = Math.min(t1, (d + 1) * 86400);
    if (b > a) rects.push(<rect key={d} x={x(a)} y={top} width={x(b) - x(a)} height={height} className={cycle === 'DD' ? 'es-dd' : 'es-dark'} />);
  }
  return <g>{rects}</g>;
}

function XAxis({ ticks, x, y, labels = true }) {
  return (
    <g className="es-axis">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={y} y2={y + 4} />
          {labels && <text x={x(t)} y={y + 16} textAnchor="middle">{t / 3600}</text>}
        </g>
      ))}
    </g>
  );
}

// path of a binned series with gaps where values are null
function linePath(points) {
  let d = '';
  let pen = false;
  points.forEach(([px, py]) => {
    if (py == null) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`;
    pen = true;
  });
  return d;
}

function bandPath(points) {
  // points: [px, lo, hi] with nulls → one closed polygon per contiguous run
  const runs = [];
  let cur = [];
  points.forEach((p) => { if (p[1] == null) { if (cur.length) runs.push(cur); cur = []; } else cur.push(p); });
  if (cur.length) runs.push(cur);
  return runs.map((r) => `M${r.map(([px, lo]) => `${px.toFixed(1)},${lo.toFixed(1)}`).join('L')}L${r.slice().reverse().map(([px, , hi]) => `${px.toFixed(1)},${hi.toFixed(1)}`).join('L')}Z`).join('');
}

// Bin centres → step-free line; value plotted at the bin's middle
function binPoints(binned, bin, x, y) {
  if (!binned) return [];
  return binned.values.map((v, k) => [x((binned.first + k + 0.5) * bin), v == null ? null : y(v)]);
}

function EachFlyChart({ rows, bin, domain, cycle, width, snaps, snapHover, onPick, marker }) {
  const ROW_H = 64, GAP = 10, TOP = 6, LEFT = 110;
  const { x, inv, ticks } = useScales(width, domain, LEFT);
  const [hover, setHover] = useState(null);     // t (s)
  const [hoverRow, setHoverRow] = useState(null);
  const height = TOP + rows.length * (ROW_H + GAP) + 22;
  if (!width) return null;
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = inv(e.clientX - r.left);
    setHover(t >= domain[0] && t <= domain[1] ? t : null);
    const i = Math.floor((e.clientY - r.top - TOP) / (ROW_H + GAP));
    setHoverRow(i >= 0 && i < rows.length ? i : null);
  };
  const k = hover == null ? null : Math.floor(hover / bin);
  const hoverFly = hoverRow == null ? null : rows[hoverRow]?.fly;
  const rowTop = (i) => TOP + i * (ROW_H + GAP);
  return (
    <div className="es-chart" style={{ position: 'relative' }}>
      <svg width={width} height={height} onMouseMove={onMove} onMouseLeave={() => { setHover(null); setHoverRow(null); }} role="img"
        aria-label="Fraction of time asleep per bin, one row per fly"
        className={onPick ? 'es-clickable' : undefined}
        onClick={() => { if (onPick && hover != null && hoverFly) onPick(hoverFly.key, hover); }}>
        {rows.map((row, i) => {
          const top = TOP + i * (ROW_H + GAP);
          const y = (v) => top + ROW_H - v * ROW_H;
          const pts = binPoints(row.binned, bin, x, y);
          const area = bandPath(pts.map(([px, py]) => [px, py == null ? null : y(0), py]));
          const v = k != null && row.binned ? row.binned.values[k - row.binned.first] : undefined;
          return (
            <g key={row.fly.key}>
              <Shading domain={domain} x={x} top={top} height={ROW_H} cycle={cycle} />
              <line className="es-grid" x1={LEFT} x2={width - M.right} y1={y(0)} y2={y(0)} />
              <line className="es-grid es-grid-faint" x1={LEFT} x2={width - M.right} y1={y(1)} y2={y(1)} />
              <path d={area} className="es-area" />
              <path d={linePath(pts)} className="es-line" style={{ stroke: 'var(--eth-series-1)' }} />
              <text x={LEFT - 8} y={top + ROW_H / 2 - 2} textAnchor="end" className="es-row-label">{flyLabel(row.fly)}</text>
              <text x={LEFT - 8} y={top + ROW_H / 2 + 12} textAnchor="end" className="es-row-sub">{[row.fly.genotype, row.fly.sex].filter(Boolean).join(' · ').slice(0, 18)}</text>
              {hover != null && v !== undefined && (
                <text x={Math.min(x(hover) + 6, width - M.right - 40)} y={top + 12} className="es-hover-value">{fmtPct(v)}</text>
              )}
            </g>
          );
        })}
        {marker && rows.map((row, i) => (row.fly.key === marker.key && marker.t >= domain[0] && marker.t <= domain[1] ? (
          <line key="marker" className="es-snap-marker" x1={x(marker.t)} x2={x(marker.t)} y1={rowTop(i) - 3} y2={rowTop(i) + ROW_H + 3} />
        ) : null))}
        {hover != null && <line className="es-crosshair" x1={x(hover)} x2={x(hover)} y1={TOP} y2={height - 22} />}
        <XAxis ticks={ticks} x={x} y={height - 22} />
      </svg>
      {snapHover && hover != null && hoverFly && (
        <SnapTip items={[{ fly: hoverFly, snaps: snaps?.[hoverFly.key] }]} t={hover}
          left={x(hover) > width * 0.6 ? x(hover) - 14 : x(hover) + 14} flipX={x(hover) > width * 0.6}
          // under the row, or above it for the last rows (stays inside the chart)
          top={hoverRow >= 2 && hoverRow >= rows.length - 2 ? rowTop(hoverRow) - 4 : rowTop(hoverRow) + ROW_H + 4}
          flipY={hoverRow >= 2 && hoverRow >= rows.length - 2} />
      )}
      <div className="es-xlabel">ZT (h) {hover != null && <b>· {fmtZt(Math.floor(hover / bin) * bin)}–{fmtZt((Math.floor(hover / bin) + 1) * bin)}</b>}
        {onPick && <span className="es-muted"> · click: open the snapshot below</span>}</div>
    </div>
  );
}

function AverageChart({ groups, bin, domain, cycle, width, flies, snaps, snapHover, onPick, marker }) {
  const H = 300, TOP = 10, BOTTOM = 24;
  const { x, inv, ticks } = useScales(width, domain);
  const [hover, setHover] = useState(null);
  if (!width) return null;
  const y = (v) => TOP + (1 - v) * (H - TOP - BOTTOM);
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = inv(e.clientX - r.left);
    setHover(t >= domain[0] && t <= domain[1] ? t : null);
  };
  const k = hover == null ? null : Math.floor(hover / bin);
  const tipLeft = hover == null ? 0 : x(hover) > width * 0.65 ? x(hover) - 12 : x(hover) + 12;
  return (
    <div className="es-chart" style={{ position: 'relative' }}>
      <svg width={width} height={H} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img"
        aria-label="Mean fraction of time asleep per bin, ± SEM" className={onPick ? 'es-clickable' : undefined}
        onClick={() => { if (onPick && hover != null && flies.length) onPick(flies[0].key, hover); }}>
        <Shading domain={domain} x={x} top={TOP} height={H - TOP - BOTTOM} cycle={cycle} />
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v} className="es-axis">
            <line className={v === 0 ? 'es-grid' : 'es-grid es-grid-faint'} x1={M.left} x2={width - M.right} y1={y(v)} y2={y(v)} />
            <text x={M.left - 8} y={y(v) + 4} textAnchor="end">{v * 100}%</text>
          </g>
        ))}
        {groups.map((g) => {
          const pts = g.mean.map((m, i) => [x((g.first + i + 0.5) * bin), m == null ? null : y(m)]);
          const band = g.mean.map((m, i) => [x((g.first + i + 0.5) * bin),
            m == null || g.n[i] < 2 ? null : y(Math.max(0, m - g.sem[i])), m == null || g.n[i] < 2 ? null : y(Math.min(1, m + g.sem[i]))]);
          return (
            <g key={g.key}>
              <path d={bandPath(band)} className="es-band" style={{ fill: `var(--eth-series-${g.slot})` }} />
              <path d={linePath(pts)} className="es-line" style={{ stroke: `var(--eth-series-${g.slot})` }} />
            </g>
          );
        })}
        {marker && marker.t >= domain[0] && marker.t <= domain[1] && (
          <line className="es-snap-marker" x1={x(marker.t)} x2={x(marker.t)} y1={TOP} y2={H - BOTTOM} />
        )}
        {hover != null && <line className="es-crosshair" x1={x(hover)} x2={x(hover)} y1={TOP} y2={H - BOTTOM} />}
        {hover != null && groups.map((g) => {
          const i = k - g.first;
          const m = g.mean[i];
          return m == null ? null : <circle key={g.key} cx={x((k + 0.5) * bin)} cy={y(m)} r={4} className="es-dot" style={{ fill: `var(--eth-series-${g.slot})` }} />;
        })}
        <XAxis ticks={ticks} x={x} y={H - BOTTOM} />
      </svg>
      {hover != null && (
        <div className="es-tooltip" style={{ left: tipLeft, transform: x(hover) > width * 0.65 ? 'translateX(-100%)' : 'none' }}>
          <div className="es-tooltip-title">{fmtZt(k * bin)}–{fmtZt((k + 1) * bin)}</div>
          {groups.map((g) => {
            const i = k - g.first;
            const m = g.mean[i];
            return (
              <div key={g.key} className="es-tooltip-row">
                <span className="es-swatch" style={{ background: `var(--eth-series-${g.slot})` }} />
                <span>{g.label}</span>
                <b>{m == null ? '–' : `${(100 * m).toFixed(1)}%`}</b>
                <span className="es-muted">{m == null ? '' : `± ${(100 * g.sem[i]).toFixed(1)} · n=${g.n[i]}`}</span>
              </div>
            );
          })}
          {snapHover && (
            <SnapTip items={flies.slice(0, MAX_TIP_FLIES).map((fly) => ({ fly, snaps: snaps?.[fly.key] }))} t={hover} left={0} top={0} inline />
          )}
          {snapHover && flies.length > MAX_TIP_FLIES && <div className="es-muted">snapshots of the first {MAX_TIP_FLIES} selected flies</div>}
        </div>
      )}
      <div className="es-xlabel">ZT (h) · line = mean, band = ± SEM{onPick && flies.length ? <span className="es-muted"> · click: open {flyLabel(flies[0])}'s snapshot below</span> : null}</div>
    </div>
  );
}

// "Snapshots" card: one fly's snapshots, stepped with ◀ ▶ / ← → / the slider; ±1 h jumps 12 of them
function SnapshotBrowser({ active, flies, snaps, browse, setBrowse, tw }) {
  const [crop, setCrop] = useState(() => store.get('fh-ethoscope-snap-crop', 'full'));
  useEffect(() => store.set('fh-ethoscope-snap-crop', crop), [crop]);
  const [el, setEl] = useState(null);
  const { width } = useElementSize(el);
  const fly = flies.find((f) => f.key === browse?.key) || flies[0];
  const info = fly ? snaps?.[fly.key] : null;
  const list = info?.snapshots || [];
  const idx = Math.min(Math.max(0, browse?.idx ?? 0), Math.max(0, list.length - 1));
  const snap = list[idx];
  const go = useCallback((i) => {
    if (!fly || !list.length) return;
    setBrowse({ key: fly.key, idx: Math.min(Math.max(0, i), list.length - 1) });
  }, [fly, list.length, setBrowse]);
  // keys: ← → one snapshot, Shift ±12 (1 h), while the tab is shown (subscribed once, state in a ref)
  const keyRef = useRef({});
  keyRef.current = { active, go, idx };
  useEffect(() => {
    const onKey = (e) => {
      const { active: on, go: step, idx: i } = keyRef.current;
      if (!on || e.ctrlKey || e.metaKey || e.altKey) return;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target?.tagName) && e.target.type !== 'range') return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        step(i + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 12 : 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const imgW = Math.max(200, Math.min(Math.round(width || 800), crop === 'full' ? 1000 : 1200));
  // preload the neighbours
  useEffect(() => {
    if (!fly) return;
    [idx - 1, idx + 1, idx + 2].forEach((i) => {
      if (list[i]) { const im = new Image(); im.src = snapUrl(fly.key, list[i][0], crop, imgW); }
    });
  }, [fly, list, idx, crop, imgW]);
  if (!fly) return <div className="es-muted">No fly with an ethoscope run.</div>;
  const state = snap ? stateAt(fly.trace, tw, snap[1]) : null;
  const after = snap && info?.moved_t != null && snap[1] > info.moved_t;
  return (
    <div className="es-browser" ref={setEl}>
      <div className="toolbar es-toolbar">
        <label className="field">Fly
          <select value={fly.key} onChange={(e) => {
            const id = e.target.value;
            const next = snaps?.[id]?.snapshots;
            // keep the time when switching fly
            setBrowse({ key: id, idx: snap && next ? Math.max(0, nearestSnap(next, snap[1])) : 0 });
          }}>
            {flies.map((f) => <option key={f.key} value={f.key}>{flyLabel(f)}{f.in_experiment ? ` · ${f.machine_name} ROI ${f.region_id}` : ''}</option>)}
          </select>
        </label>
        <div className="ov-seg" role="group" aria-label="Snapshot crop">
          <button className={crop === 'full' ? 'on' : ''} onClick={() => setCrop('full')}>Whole frame</button>
          <button className={crop === 'roi' ? 'on' : ''} onClick={() => setCrop('roi')}>Fly's ROI</button>
        </div>
        <button onClick={() => go(idx - 12)} disabled={!list.length || idx === 0} title="1 h back (Shift+←)">−1 h</button>
        <button onClick={() => go(idx - 1)} disabled={!list.length || idx === 0} title="Previous snapshot (←)">◀</button>
        <button onClick={() => go(idx + 1)} disabled={!list.length || idx >= list.length - 1} title="Next snapshot (→)">▶</button>
        <button onClick={() => go(idx + 12)} disabled={!list.length || idx >= list.length - 1} title="1 h on (Shift+→)">+1 h</button>
        {snap && (
          <span className="es-muted">
            {idx + 1} / {list.length} · <b className="es-snap-time">{fmtZt(snap[1])}</b>
            {state && <> · <span className={`es-state es-state-${state.replace(' ', '-')}`}>{state}</span></>}
            {after && <span className="es-warn"> · after the fly went into the FlyHostel</span>}
          </span>
        )}
      </div>
      {list.length > 0 && (
        <input type="range" className="es-snap-slider" min={0} max={list.length - 1} value={idx}
          onChange={(e) => go(Number(e.target.value))} aria-label="Snapshot" />
      )}
      {info?.error && <div className="es-warn">{info.error}</div>}
      {!info && <div className="es-muted">Reading the snapshots…</div>}
      {info && !list.length && !info.error && <div className="es-muted">This run has no snapshots (IMG_SNAPSHOTS is empty).</div>}
      {snap && (
        <img className="es-snap-img" src={snapUrl(fly.key, snap[0], crop, imgW)} alt={`${flyLabel(fly)} at ${fmtZt(snap[1])}`}
          style={{ maxWidth: imgW }} />
      )}
    </div>
  );
}

// ── the tab ──────────────────────────────────────────────────────────────────

export default function EthoscopeTab({ active, currentExperiment }) {
  const { log, trackJob } = useConsole();
  const [info, setInfo] = useState(null);           // /api/ethoscope/flies
  const [downloading, setDownloading] = useState(false);
  const [data, setData] = useState(null);           // /api/ethoscope/sleep
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState(() => store.get('fh-ethoscope-view', 'each'));
  const [bin, setBin] = useState(() => store.get('fh-ethoscope-bin', 30));
  const [groupBy, setGroupBy] = useState(() => store.get('fh-ethoscope-group', 'none'));
  const [selected, setSelected] = useState(null);   // Set of fly keys, null = all
  const [scope, setScope] = useState(() => store.get('fh-ethoscope-scope', 'experiment'));
  const [params, setParams] = useState(null);       // applied scoring parameters
  const [draft, setDraft] = useState(null);
  const [showParams, setShowParams] = useState(false);
  const [el, setEl] = useState(null);
  const { width } = useElementSize(el);
  const [snapHover, setSnapHover] = useState(() => store.get('fh-ethoscope-snap-hover', true));
  const [browserOpen, setBrowserOpen] = useState(() => store.get('fh-ethoscope-snap-open', false));
  const [snaps, setSnaps] = useState(null);         // /api/ethoscope/snapshots: fly key -> {snapshots, roi, moved_t}
  const [browse, setBrowse] = useState(null);       // {key, idx} of the Snapshots card
  const browserRef = useRef(null);

  useEffect(() => store.set('fh-ethoscope-snap-hover', snapHover), [snapHover]);
  useEffect(() => store.set('fh-ethoscope-snap-open', browserOpen), [browserOpen]);
  useEffect(() => store.set('fh-ethoscope-view', view), [view]);
  useEffect(() => store.set('fh-ethoscope-scope', scope), [scope]);
  // other flies: score again, list their snapshots again
  const changeScope = (v) => { setScope(v); setData(null); setSnaps(null); setSelected(null); setBrowse(null); };
  useEffect(() => store.set('fh-ethoscope-bin', bin), [bin]);
  useEffect(() => store.set('fh-ethoscope-group', groupBy), [groupBy]);

  // new experiment: forget everything
  useEffect(() => { setInfo(null); setData(null); setSelected(null); setSnaps(null); setBrowse(null); }, [currentExperiment]);

  // snapshots: listed once per experiment, when they are first wanted (hover or the card)
  useEffect(() => {
    if (!active || !info?.available || snaps || !(snapHover || browserOpen)) return undefined;
    let stale = false;
    api.get('/api/ethoscope/snapshots', { params: { scope } }).then(({ data: d }) => {
      if (!stale) setSnaps(unwrap(d).flies || {});
    }).catch((err) => { if (!stale) { setSnaps({}); log('error', `Ethoscope snapshots: ${err.response?.data?.error || err.message}`); } });
    return () => { stale = true; };
  }, [active, info, snaps, snapHover, browserOpen, log, scope]);

  useEffect(() => {
    if (!active || info) return;
    let stale = false;
    api.get('/api/ethoscope/flies').then(({ data: d }) => {
      if (stale) return;
      const v = unwrap(d);
      setInfo(v);
      setParams((p) => p || v.defaults);
      setDraft((p) => p || v.defaults);
    }).catch((err) => log('error', `Ethoscope flies: ${err.message}`));
    return () => { stale = true; };
  }, [active, info, log]);

  const load = useCallback(async (p) => {
    setLoading(true);
    try {
      const { data: d } = await api.get('/api/ethoscope/sleep', { params: { ...p, scope } });
      setData(unwrap(d));
    } catch (err) {
      log('error', `Ethoscope sleep: ${err.response?.data?.error || err.message}`);
    } finally {
      setLoading(false);
    }
  }, [log, scope]);

  useEffect(() => {
    if (active && info?.available && params && !data && !loading) load(params);
  }, [active, info, params, data, loading, load]);

  const flies = useMemo(() => (data?.flies || []).filter((f) => f.trace && f.trace.t0 != null), [data]);
  const missing = useMemo(() => (data?.flies || info?.flies || []).filter((f) => !f.path || (data && (!f.trace || f.trace.t0 == null))), [data, info]);
  const tw = data?.params?.time_window_length || 10;
  const binS = bin * 60;
  const isSelected = useCallback((f) => selected == null || selected.has(f.key), [selected]);
  const shown = useMemo(() => flies.filter(isSelected), [flies, isSelected]);

  const rows = useMemo(() => shown.map((fly) => ({ fly, binned: binTrace(fly.trace, tw, binS) })), [shown, tw, binS]);
  const domain = useMemo(() => {
    let a = Infinity, b = -Infinity;
    rows.forEach(({ fly }) => {
      a = Math.min(a, fly.trace.t0);
      b = Math.max(b, fly.trace.t0 + fly.trace.asleep.length * tw);
    });
    if (!Number.isFinite(a)) return [0, 86400];
    return [Math.floor(a / 3600) * 3600, Math.ceil(b / 3600) * 3600];
  }, [rows, tw]);

  // group values in fixed order (first appearance by identity), so colours follow the group
  const groupKeys = useMemo(() => {
    if (groupBy === 'none') return ['all'];
    const keys = [];
    flies.forEach((f) => { const k = f[groupBy] || '(none)'; if (!keys.includes(k)) keys.push(k); });
    return keys;
  }, [flies, groupBy]);

  const groups = useMemo(() => groupKeys.map((key, gi) => {
    const members = rows.filter(({ fly }) => groupBy === 'none' || (fly[groupBy] || '(none)') === key);
    if (!members.length) return null;
    const first = Math.min(...members.map((m) => m.binned?.first ?? Infinity));
    const last = Math.max(...members.map((m) => (m.binned ? m.binned.first + m.binned.values.length - 1 : -Infinity)));
    const mean = [], sem = [], n = [];
    for (let k = first; k <= last; k++) {
      const vs = members.map((m) => m.binned?.values[k - m.binned.first]).filter((v) => v != null);
      n.push(vs.length);
      if (!vs.length) { mean.push(null); sem.push(null); continue; }
      const mu = vs.reduce((s, v) => s + v, 0) / vs.length;
      const sd = vs.length > 1 ? Math.sqrt(vs.reduce((s, v) => s + (v - mu) ** 2, 0) / (vs.length - 1)) : 0;
      mean.push(mu); sem.push(sd / Math.sqrt(vs.length));
    }
    return {
      key, first, mean, sem, n, slot: (gi % SERIES) + 1, flies: members.length,
      label: groupBy === 'none' ? `All selected (${members.length})` : `${key} (${members.length})`,
    };
  }).filter(Boolean), [groupKeys, rows, groupBy]);

  const cycle = useMemo(() => lightCycleOf(shown.length ? shown : flies), [shown, flies]);
  const summaries = useMemo(() => new Map(flies.map((f) => [f.key, summarize(f.trace, tw)])), [flies, tw]);

  const runs = useMemo(() => {
    const m = new Map();
    (data?.flies || info?.flies || []).filter((f) => f.path).forEach((f) => {
      const k = `${f.machine_name} · ${f.run}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(f.region_id);
    });
    return [...m.entries()];
  }, [data, info]);

  const toggle = (key) => setSelected((s) => {
    const next = new Set(s == null ? flies.map((f) => f.key) : s);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next.size === flies.length ? null : next;
  });
  const selectWhere = (pred) => setSelected(new Set(flies.filter(pred).map((f) => f.key)));
  const genotypes = useMemo(() => [...new Set(flies.map((f) => f.genotype).filter(Boolean))], [flies]);
  const sexes = useMemo(() => [...new Set(flies.map((f) => f.sex).filter(Boolean))], [flies]);

  // runs only on cv1 (one per run, with its ROIs)
  const remoteRuns = useMemo(() => {
    const m = new Map();
    (info?.flies || []).filter((f) => !f.path && f.remote).forEach((f) => {
      const r = f.remote;
      if (!m.has(r.relpath)) m.set(r.relpath, { ...r, machine_name: f.machine_name, rois: [] });
      m.get(r.relpath).rois.push(f.region_id);
    });
    return [...m.values()];
  }, [info]);
  const download = async () => {
    setDownloading(true);
    try {
      const { data: d } = await api.post('/api/ethoscope/download', { experiment: currentExperiment });
      const job = await trackJob(unwrap(d));
      if (job?.status === 'done') log('success', `Ethoscope: copied ${job.items.length} run(s) from ${info.remote_host}`);
      setData(null);
      setInfo(null);                 // look again: the copied runs are now local
    } catch (err) {
      log('error', `Ethoscope download: ${err.response?.data?.error || err.message}`);
    } finally {
      setDownloading(false);
    }
  };
  const downloadCard = remoteRuns.length > 0 && (
    <div className="es-remote">
      <div>
        {info.available ? 'Some flies have their run' : 'The ethoscope run of these flies is'} only on <b>{info.remote_host}</b>, not in <code>{info.results_dir}</code>:
        <ul>
          {remoteRuns.map((r) => (
            <li key={r.relpath}>
              {r.machine_name} · {r.run} (ROI {r.rois.join(', ')}) · {(r.size / 1e6).toFixed(0)} MB
              {r.recording && <span className="es-warn"> · still being written: the copy will end where the run is now</span>}
            </li>
          ))}
        </ul>
      </div>
      <button className="btn-primary" onClick={download} disabled={downloading}>
        {downloading ? <><i className="fa fa-spinner fa-spin" /> Copying…</> : `Download from ${info.remote_host}`}
      </button>
    </div>
  );

  const applyParams = () => { setParams(draft); setData(null); };
  // a click on the chart: that fly's snapshot nearest t in the Snapshots card
  const pickSnapshot = useCallback((key, t) => {
    const k = nearestSnap(snaps?.[key]?.snapshots, t);
    if (k < 0) { log('info', `${key}: no snapshot`); return; }
    setBrowse({ key, idx: k });
    setBrowserOpen(true);
    setTimeout(() => browserRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  }, [snaps, log]);
  const marker = useMemo(() => {
    if (!browserOpen || !browse || !snaps) return null;
    const s = snaps[browse.key]?.snapshots?.[browse.idx];
    return s ? { key: browse.key, t: s[1] } : null;
  }, [browserOpen, browse, snaps]);
  const exportCsv = () => {
    const lines = ['identity,in_experiment,experiment,genotype,sex,machine_name,run,region_id,bin_start_zt_s,bin_min,fraction_asleep'];
    rows.forEach(({ fly, binned }) => binned?.values.forEach((v, k) => {
      if (v != null) lines.push([fly.identity ?? '', fly.in_experiment ? 1 : 0, fly.experiment || '', fly.genotype || '', fly.sex || '', fly.machine_name, fly.run, fly.region_id, (binned.first + k) * binS, bin, v.toFixed(4)].join(','));
    }));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = `${(currentExperiment || 'experiment').replaceAll('/', '_')}_ethoscope_sleep_${bin}min.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!info) return <div className="es-tab"><div className="card"><div className="card-body">Looking for ethoscope data…</div></div></div>;
  if (!info.available) {
    return (
      <div className="es-tab"><div className="card">
        <div className="card-header"><span className="es-title">Ethoscope sleep</span></div>
        <div className="card-body">
          {downloadCard || (
            <>No ethoscope run found for the flies of this experiment (their metadata needs <code>machine_name</code>, <code>date</code> and <code>region_id</code>, and the run must be in <code>{info.results_dir}</code>{info.remote_host ? <> or on {info.remote_host}</> : null}).</>
          )}
          {info.remote_error && <div className="es-warn">Could not look on {info.remote_host}: {info.remote_error}</div>}
        </div>
      </div></div>
    );
  }

  return (
    <div className="es-tab">
      <div className="card">
        <div className="card-header">
          <span className="es-title">Ethoscope sleep</span>
          <span className="es-muted">{runs.map(([k, rois]) => `${k} (ROI ${rois.join(', ')})`).join(' · ')}</span>
          <span className="spacer" />
          {loading && <span className="es-muted"><i className="fa fa-spinner fa-spin" /> scoring…</span>}
        </div>
        <div className="card-body">
          <div className="toolbar es-toolbar">
            <div className="ov-seg" role="group" aria-label="View">
              <button className={view === 'each' ? 'on' : ''} onClick={() => setView('each')}>Each fly</button>
              <button className={view === 'average' ? 'on' : ''} onClick={() => setView('average')}>Average</button>
            </div>
            <label className="field">Bin
              <select value={bin} onChange={(e) => setBin(Number(e.target.value))}>
                {BINS.map((b) => <option key={b} value={b}>{b} min</option>)}
              </select>
            </label>
            {view === 'average' && (
              <label className="field">One line per
                <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                  <option value="none">— (all selected flies)</option>
                  <option value="genotype">genotype</option>
                  <option value="sex">sex</option>
                </select>
              </label>
            )}
            <label className="field" title="Plot also the other flies of the ethoscope runs (their genotype / sex from the metadata sheets when listed there)">Flies from
              <select value={scope} onChange={(e) => changeScope(e.target.value)} disabled={loading}>
                {SCOPES.map(([v, label, title]) => <option key={v} value={v} title={title}>{label}</option>)}
              </select>
            </label>
            <button onClick={() => setShowParams((s) => !s)} aria-expanded={showParams}>Scoring {showParams ? '▴' : '▾'}</button>
            <button onClick={exportCsv} disabled={!rows.length} title="Fraction asleep per bin of the selected flies">CSV</button>
          </div>
          {showParams && draft && (
            <div className="toolbar es-toolbar">
              {PARAMS.map(([k, label, step, title]) => (
                <label key={k} className="field" title={title}>{label}
                  <input type="number" step={step} value={draft[k]} style={{ width: 84 }}
                    onChange={(e) => setDraft({ ...draft, [k]: Number(e.target.value) })} />
                </label>
              ))}
              <button className="btn-primary" onClick={applyParams} disabled={loading}>Apply</button>
              <button onClick={() => { setDraft(info.defaults); setParams(info.defaults); setData(null); }}>FSLRetho defaults</button>
            </div>
          )}
          <div className="es-flies">
            <span className="es-muted">Flies:</span>
            {flies.map((f) => (
              <label key={f.key} className={`chip es-fly ${isSelected(f) ? 'on' : ''}${f.in_experiment ? '' : ' es-extra'}`}
                title={`${f.machine_name} ROI ${f.region_id}${f.in_experiment ? '' : f.experiment ? ` · went to ${f.experiment}` : f.in_sheet ? ' · stayed in the ethoscope' : ' · not in the metadata sheets'}`}>
                <input type="checkbox" checked={isSelected(f)} onChange={() => toggle(f.key)} />
                {f.in_experiment ? f.identity : flyLabel(f)}{f.genotype ? <span className="es-muted"> {f.genotype}</span> : null}{f.sex ? <span className="es-muted"> {f.sex}</span> : null}
              </label>
            ))}
            <button className="es-link" onClick={() => setSelected(null)}>all</button>
            <button className="es-link" onClick={() => setSelected(new Set())}>none</button>
            {genotypes.length > 1 && genotypes.map((g) => <button key={g} className="es-link" onClick={() => selectWhere((f) => f.genotype === g)}>only {g}</button>)}
            {sexes.length > 1 && sexes.map((s) => <button key={s} className="es-link" onClick={() => selectWhere((f) => f.sex === s)}>only {s}</button>)}
          </div>
          {downloadCard}
          {missing.length > 0 && (
            <div className="es-muted es-missing">
              Without ethoscope data: {missing.map((f) => `${f.in_experiment ? `fly ${f.identity}` : flyLabel(f)} (${f.error || 'too little data'})`).join('; ')}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="es-title">{view === 'each' ? 'Sleep of each fly' : 'Average sleep'}</span>
          <span className="es-muted">% of time asleep per {bin} min · {cycle === 'LD' ? 'shaded: dark phase (ZT 12–24)' : cycle === 'DD' ? 'DD (shaded: constant darkness)' : cycle}</span>
          <span className="spacer" />
          <label className="field es-switch" title="Show the ethoscope snapshot nearest the pointer (cropped to the fly's ROI) while hovering the chart">
            <input type="checkbox" checked={snapHover} onChange={(e) => setSnapHover(e.target.checked)} /> Snapshots on hover
          </label>
          {view === 'average' && groups.length > 1 && (
            <span className="es-legend">
              {groups.map((g) => <span key={g.key}><span className="es-swatch" style={{ background: `var(--eth-series-${g.slot})` }} />{g.label}</span>)}
            </span>
          )}
        </div>
        <div className="card-body" ref={setEl}>
          {!data && <div className="es-muted">Scoring sleep…</div>}
          {data && !rows.length && <div className="es-muted">No fly selected.</div>}
          {data && rows.length > 0 && view === 'each' && (
            <EachFlyChart rows={rows} bin={binS} domain={domain} cycle={cycle} width={width}
              snaps={snaps} snapHover={snapHover} onPick={snaps ? pickSnapshot : null} marker={marker} />
          )}
          {data && rows.length > 0 && view === 'average' && (
            <AverageChart groups={groups} bin={binS} domain={domain} cycle={cycle} width={width} flies={shown}
              snaps={snaps} snapHover={snapHover} onPick={snaps ? pickSnapshot : null} marker={marker} />
          )}
        </div>
      </div>

      {flies.length > 0 && (
        <div className="card" ref={browserRef}>
          <div className="card-header es-header-toggle" onClick={() => setBrowserOpen((o) => !o)}>
            <span className="es-title">{browserOpen ? '▾' : '▸'} Snapshots</span>
            <span className="es-muted">the ethoscope's picture of the whole frame, every ~5 min (IMG_SNAPSHOTS); its time is marked on the chart</span>
          </div>
          {browserOpen && (
            <div className="card-body">
              <SnapshotBrowser active={active} flies={flies} snaps={snaps} browse={browse} setBrowse={setBrowse} tw={tw} />
            </div>
          )}
        </div>
      )}

      {flies.length > 0 && (
        <div className="card">
          <div className="card-header"><span className="es-title">Per fly</span>
            <span className="es-muted">light = ZT 0–12, dark = ZT 12–24; windows without data left out; each trace ends at the fly's last movement before it went into the FlyHostel</span></div>
          <div className="card-body es-scroll">
            <table className="es-table">
              <thead>
                <tr><th>Fly</th><th>Genotype</th><th>Sex</th><th>Ethoscope</th><th>ROI</th><th>Run</th><th>Recorded</th>
                  <th>Asleep</th><th>Light</th><th>Dark</th><th>Sleep / 24 h</th>
                  <th title="Left out: after the fly went into the FlyHostel, and the immobile end after its last movement (empty tube)">Cut at the end</th></tr>
              </thead>
              <tbody>
                {flies.map((f) => {
                  const s = summaries.get(f.key);
                  return (
                    <tr key={f.key} className={isSelected(f) ? '' : 'es-off'}>
                      <td title={f.experiment ? `went to ${f.experiment}` : undefined}>{f.in_experiment ? f.identity : flyLabel(f)}</td><td>{f.genotype || ''}</td><td>{f.sex || ''}</td><td>{f.machine_name}</td><td>{f.region_id}</td>
                      <td>{f.run}{f.trace.zt_aligned ? '' : ' (no reference_hour: t since start)'}</td>
                      <td>{s ? `${s.hours.toFixed(1)} h` : ''}</td>
                      <td>{fmtPct(s?.all)}</td><td>{fmtPct(s?.light)}</td><td>{fmtPct(s?.dark)}</td>
                      <td>{s?.minPerDay == null ? '–' : `${Math.round(s.minPerDay)} min`}</td>
                      <td title={`${fmtHours(f.trace.cut_after_move)} after the move to the FlyHostel${f.moved_at ? ` (${new Date(f.moved_at * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC)` : ''}, ${fmtHours(f.trace.trimmed_tail)} immobile before it`}>
                        {fmtHours((f.trace.cut_after_move || 0) + (f.trace.trimmed_tail || 0))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
