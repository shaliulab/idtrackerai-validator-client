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

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import api from './api';
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

const flyLabel = (f) => `Fly ${f.identity}`;
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

function EachFlyChart({ rows, bin, domain, cycle, width }) {
  const ROW_H = 64, GAP = 10, TOP = 6, LEFT = 110;
  const { x, inv, ticks } = useScales(width, domain, LEFT);
  const [hover, setHover] = useState(null);     // t (s)
  const height = TOP + rows.length * (ROW_H + GAP) + 22;
  if (!width) return null;
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = inv(e.clientX - r.left);
    setHover(t >= domain[0] && t <= domain[1] ? t : null);
  };
  const k = hover == null ? null : Math.floor(hover / bin);
  return (
    <div className="es-chart">
      <svg width={width} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img"
        aria-label="Fraction of time asleep per bin, one row per fly">
        {rows.map((row, i) => {
          const top = TOP + i * (ROW_H + GAP);
          const y = (v) => top + ROW_H - v * ROW_H;
          const pts = binPoints(row.binned, bin, x, y);
          const area = bandPath(pts.map(([px, py]) => [px, py == null ? null : y(0), py]));
          const v = k != null && row.binned ? row.binned.values[k - row.binned.first] : undefined;
          return (
            <g key={row.fly.identity}>
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
        {hover != null && <line className="es-crosshair" x1={x(hover)} x2={x(hover)} y1={TOP} y2={height - 22} />}
        <XAxis ticks={ticks} x={x} y={height - 22} />
      </svg>
      <div className="es-xlabel">ZT (h) {hover != null && <b>· {fmtZt(Math.floor(hover / bin) * bin)}–{fmtZt((Math.floor(hover / bin) + 1) * bin)}</b>}</div>
    </div>
  );
}

function AverageChart({ groups, bin, domain, cycle, width }) {
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
        aria-label="Mean fraction of time asleep per bin, ± SEM">
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
        </div>
      )}
      <div className="es-xlabel">ZT (h) · line = mean, band = ± SEM</div>
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
  const [selected, setSelected] = useState(null);   // Set of identities, null = all
  const [params, setParams] = useState(null);       // applied scoring parameters
  const [draft, setDraft] = useState(null);
  const [showParams, setShowParams] = useState(false);
  const [el, setEl] = useState(null);
  const { width } = useElementSize(el);

  useEffect(() => store.set('fh-ethoscope-view', view), [view]);
  useEffect(() => store.set('fh-ethoscope-bin', bin), [bin]);
  useEffect(() => store.set('fh-ethoscope-group', groupBy), [groupBy]);

  // new experiment: forget everything
  useEffect(() => { setInfo(null); setData(null); setSelected(null); }, [currentExperiment]);

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
      const { data: d } = await api.get('/api/ethoscope/sleep', { params: p });
      setData(unwrap(d));
    } catch (err) {
      log('error', `Ethoscope sleep: ${err.response?.data?.error || err.message}`);
    } finally {
      setLoading(false);
    }
  }, [log]);

  useEffect(() => {
    if (active && info?.available && params && !data && !loading) load(params);
  }, [active, info, params, data, loading, load]);

  const flies = useMemo(() => (data?.flies || []).filter((f) => f.trace && f.trace.t0 != null), [data]);
  const missing = useMemo(() => (data?.flies || info?.flies || []).filter((f) => !f.path || (data && (!f.trace || f.trace.t0 == null))), [data, info]);
  const tw = data?.params?.time_window_length || 10;
  const binS = bin * 60;
  const isSelected = useCallback((f) => selected == null || selected.has(f.identity), [selected]);
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
  const summaries = useMemo(() => new Map(flies.map((f) => [f.identity, summarize(f.trace, tw)])), [flies, tw]);

  const runs = useMemo(() => {
    const m = new Map();
    (data?.flies || info?.flies || []).filter((f) => f.path).forEach((f) => {
      const k = `${f.machine_name} · ${f.run}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(f.region_id);
    });
    return [...m.entries()];
  }, [data, info]);

  const toggle = (identity) => setSelected((s) => {
    const next = new Set(s == null ? flies.map((f) => f.identity) : s);
    if (next.has(identity)) next.delete(identity); else next.add(identity);
    return next.size === flies.length ? null : next;
  });
  const selectWhere = (pred) => setSelected(new Set(flies.filter(pred).map((f) => f.identity)));
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
  const exportCsv = () => {
    const lines = ['identity,genotype,sex,machine_name,region_id,bin_start_zt_s,bin_min,fraction_asleep'];
    rows.forEach(({ fly, binned }) => binned?.values.forEach((v, k) => {
      if (v != null) lines.push([fly.identity, fly.genotype || '', fly.sex || '', fly.machine_name, fly.region_id, (binned.first + k) * binS, bin, v.toFixed(4)].join(','));
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
              <label key={f.identity} className={`chip es-fly ${isSelected(f) ? 'on' : ''}`} title={`${f.machine_name} ROI ${f.region_id}`}>
                <input type="checkbox" checked={isSelected(f)} onChange={() => toggle(f.identity)} />
                {f.identity}{f.genotype ? <span className="es-muted"> {f.genotype}</span> : null}{f.sex ? <span className="es-muted"> {f.sex}</span> : null}
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
              Without ethoscope data: {missing.map((f) => `fly ${f.identity} (${f.error || 'too little data'})`).join('; ')}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="es-title">{view === 'each' ? 'Sleep of each fly' : 'Average sleep'}</span>
          <span className="es-muted">% of time asleep per {bin} min · {cycle === 'LD' ? 'shaded: dark phase (ZT 12–24)' : cycle === 'DD' ? 'DD (shaded: constant darkness)' : cycle}</span>
          <span className="spacer" />
          {view === 'average' && groups.length > 1 && (
            <span className="es-legend">
              {groups.map((g) => <span key={g.key}><span className="es-swatch" style={{ background: `var(--eth-series-${g.slot})` }} />{g.label}</span>)}
            </span>
          )}
        </div>
        <div className="card-body" ref={setEl}>
          {!data && <div className="es-muted">Scoring sleep…</div>}
          {data && !rows.length && <div className="es-muted">No fly selected.</div>}
          {data && rows.length > 0 && view === 'each' && <EachFlyChart rows={rows} bin={binS} domain={domain} cycle={cycle} width={width} />}
          {data && rows.length > 0 && view === 'average' && <AverageChart groups={groups} bin={binS} domain={domain} cycle={cycle} width={width} />}
        </div>
      </div>

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
                  const s = summaries.get(f.identity);
                  return (
                    <tr key={f.identity} className={isSelected(f) ? '' : 'es-off'}>
                      <td>{f.identity}</td><td>{f.genotype || ''}</td><td>{f.sex || ''}</td><td>{f.machine_name}</td><td>{f.region_id}</td>
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
