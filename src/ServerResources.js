// ServerResources.js  —  "Server resources" card of the Monitor tab
//
// How busy this computer is, from /api/monitor/resources
// (idtrackerai_validator_server/resources.py, sampled every 5 s by the server, last
// hour kept): one tile each for RAM, CPU and every GPU with a meter (amber from
// BUSY %, red from FULL %) and a sparkline of the last hour (hover for the value at
// a time); the CPU tile also has one cell per core. "Busiest processes" lists the
// processes using the most CPU / RAM and every GPU process, sortable by column.
// Polled every sample_s while the tab is shown and "Auto refresh" is ticked.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from './api';

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);
const BUSY = 80;
const FULL = 95;
const PROCESSES_KEY = 'fh-monitor-processes';

const GiB = 1024 ** 3;
const gib = (bytes) => (bytes == null ? '–' : `${(bytes / GiB).toFixed(bytes < 10 * GiB ? 1 : 0)} GiB`);
const mibGib = (mib) => (mib == null ? '–' : `${(mib / 1024).toFixed(1)} GiB`);
const pct = (v) => (v == null ? '–' : `${Math.round(v)} %`);
const level = (v) => (v == null ? '' : v >= FULL ? 'res-full' : v >= BUSY ? 'res-busy' : '');
const levelText = (v) => (v == null ? '' : v >= FULL ? 'full' : v >= BUSY ? 'busy' : '');

function Meter({ value, label }) {
  return (
    <div className="res-meter-row">
      {label && <span className="res-meter-label">{label}</span>}
      <span className="res-meter" title={pct(value)}>
        <span className={`res-meter-fill ${level(value)}`} style={{ width: `${Math.min(100, value ?? 0)}%` }} />
      </span>
      <span className="res-meter-value">{pct(value)}</span>
    </div>
  );
}

// last hour of one series (0–100 %), hover shows the value at that time
function Sparkline({ points, now, span = 3600, height = 36 }) {
  const [hover, setHover] = useState(null);
  const ref = useRef(null);
  const width = 300;
  const x = (t) => width - ((now - t) / span) * width;
  const y = (v) => height - 1 - (v / 100) * (height - 2);
  const valid = points.filter((p) => p.v != null && now - p.t <= span);
  let path = '';
  valid.forEach((p, i) => {
    const gap = i > 0 && p.t - valid[i - 1].t > 30;    // sampler stopped (server restart)
    path += `${i === 0 || gap ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
  });
  const onMove = (e) => {
    const box = ref.current.getBoundingClientRect();
    const t = now - (1 - (e.clientX - box.left) / box.width) * span;
    let best = null;
    valid.forEach((p) => { if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p; });
    setHover(best && Math.abs(best.t - t) < 60 ? best : null);
  };
  return (
    <div className="res-spark" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg ref={ref} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" width="100%" height={height}>
        <line x1="0" x2={width} y1={y(BUSY)} y2={y(BUSY)} className="res-spark-busy" vectorEffect="non-scaling-stroke" />
        <path d={path} className="res-spark-line" vectorEffect="non-scaling-stroke" />
        {hover && <line x1={x(hover.t)} x2={x(hover.t)} y1="0" y2={height} className="res-spark-cursor" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="res-spark-axis">
        <span>{hover ? `${new Date(hover.t * 1000).toLocaleTimeString()}: ${pct(hover.v)}` : `last ${span / 60} min`}</span>
        <span>now</span>
      </div>
    </div>
  );
}

function Tile({ title, value, sub, children }) {
  return (
    <div className={`card res-tile ${level(value)}`}>
      <div className="ov-stat-label">{title}</div>
      <div className="res-head">
        <span className="ov-stat-value">{pct(value)}</span>
        {levelText(value) && <span className={`res-badge ${level(value)}`}>{levelText(value)}</span>}
      </div>
      <div className="ov-stat-sub">{sub}</div>
      {children}
    </div>
  );
}

function Cores({ cores }) {
  return (
    <div className="res-cores" title="One cell per logical CPU">
      {cores.map((v, i) => (
        <span key={i} className="res-core" title={`CPU ${i}: ${pct(v)}`}
              style={{ background: `color-mix(in srgb, var(--mon-running) ${Math.round(v)}%, var(--surface-2))` }} />
      ))}
    </div>
  );
}

const COLUMNS = [
  ['cpu', 'CPU', (p) => `${(p.cpu / 100).toFixed(1)} cores`],
  ['rss', 'RAM', (p) => gib(p.rss)],
  ['gpu_mem', 'GPU mem', (p) => (p.gpu_mem == null ? '' : mibGib(p.gpu_mem))],
];

function Processes({ processes }) {
  const [sort, setSort] = useState('cpu');
  const rows = [...processes].sort((a, b) => (b[sort] ?? -1) - (a[sort] ?? -1));
  return (
    <div className="mon-scroll res-processes">
      <table className="ov-table mon-table">
        <thead>
          <tr>
            {COLUMNS.map(([k, label]) => (
              <th key={k} className={`res-sortable${sort === k ? ' on' : ''}`} onClick={() => setSort(k)}>
                {label}{sort === k ? ' ▼' : ''}
              </th>
            ))}
            <th>PID</th><th>User</th><th>Command</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.pid}>
              {COLUMNS.map(([k, , fmt]) => <td key={k} className="res-num">{fmt(p)}</td>)}
              <td className="res-num">{p.pid}</td>
              <td>{p.user}</td>
              <td className="mono res-command" title={p.command}>{p.command}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ServerResources({ active, auto }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [showProcesses, setShowProcesses] = useState(() => {
    try { return localStorage.getItem(PROCESSES_KEY) === '1'; } catch { return false; }
  });

  const fetchData = useCallback(() => api.get('/api/monitor/resources')
    .then((r) => { setData(unwrap(r.data)); setError(null); })
    .catch((err) => setError(err.response?.data?.error || err.message)), []);

  const interval = (data?.sample_s ?? 5) * 1000;
  useEffect(() => {
    if (!active) return undefined;
    fetchData();
    if (!auto) return undefined;
    const id = setInterval(fetchData, interval);
    return () => clearInterval(id);
  }, [active, auto, interval, fetchData]);

  const toggleProcesses = () => {
    setShowProcesses((on) => {
      try { localStorage.setItem(PROCESSES_KEY, on ? '0' : '1'); } catch { /* not stored */ }
      return !on;
    });
  };

  if (!data) {
    return (
      <section className="card">
        <header className="card-header"><span>Server resources</span></header>
        <div className={`card-body ${error ? 'ov-warn' : 'ov-loading'}`}>{error ? `Could not read: ${error}` : 'Reading…'}</div>
      </section>
    );
  }

  const { cpu, memory, gpus, history, now } = data;
  const series = (get) => history.map((h) => ({ t: h.t, v: get(h) }));
  const busyCores = cpu.percent == null ? null : (cpu.percent / 100) * cpu.logical;

  return (
    <section className="card mon-card">
      <header className="card-header">
        <span>Server resources</span>
        <span className="ov-count">
          {new Date(data.t * 1000).toLocaleTimeString()}
          {error && <span className="ov-warn"> · could not refresh: {error}</span>}
        </span>
      </header>
      <div className="card-body res-tiles">
        <Tile title="RAM" value={memory.percent}
              sub={<>{gib(memory.used)} used of {gib(memory.total)} · <b>{gib(memory.available)} available</b></>}>
          <Meter value={memory.percent} />
          {memory.swap_total > 0 && (
            <Meter label="swap" value={(100 * memory.swap_used) / memory.swap_total} />
          )}
          <div className="ov-stat-sub">
            {gib(memory.cache)} cache (freed when needed){memory.swap_total > 0 && ` · swap ${gib(memory.swap_used)} of ${gib(memory.swap_total)}`}
          </div>
          <Sparkline points={series((h) => h.mem)} now={now} />
        </Tile>

        <Tile title={`CPU · ${cpu.logical} threads (${cpu.physical} cores)`} value={cpu.percent}
              sub={<>≈ <b>{busyCores?.toFixed(1)}</b> of {cpu.logical} busy · load {cpu.load.map((l) => l.toFixed(1)).join(' / ')}{cpu.iowait != null && ` · I/O wait ${pct(cpu.iowait)}`}</>}>
          <Cores cores={cpu.cores} />
          <Sparkline points={series((h) => h.cpu)} now={now} />
        </Tile>

        {gpus.length === 0 && (
          <div className="card res-tile">
            <div className="ov-stat-label">GPU</div>
            <div className="ov-stat-sub">No GPU found (nvidia-smi gave nothing)</div>
          </div>
        )}
        {gpus.map((g, i) => {
          const memPct = g.mem_total ? (100 * g.mem_used) / g.mem_total : null;
          return (
            <Tile key={g.uuid} title={`GPU ${g.index} · ${g.name}`} value={g.util}
                  sub={<>{mibGib(g.mem_used)} of {mibGib(g.mem_total)} memory · {g.processes.length} processes
                    {g.temperature != null && ` · ${g.temperature} °C`}
                    {g.power != null && ` · ${Math.round(g.power)}${g.power_limit ? ` / ${Math.round(g.power_limit)}` : ''} W`}</>}>
              <Meter label="compute" value={g.util} />
              <Meter label="memory" value={memPct} />
              <Sparkline points={series((h) => h.gpus[i]?.util)} now={now} />
            </Tile>
          );
        })}
      </div>
      <h4 className="mon-h res-toggle" onClick={toggleProcesses}>
        {showProcesses ? '▾' : '▸'} Busiest processes <span className="ov-count">({data.processes.length})</span>
      </h4>
      {showProcesses && <Processes processes={data.processes} />}
    </section>
  );
}
