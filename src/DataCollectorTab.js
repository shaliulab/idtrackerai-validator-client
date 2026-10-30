// "Data collector" tab (Ctrl+0): new recordings from cv2, from fetching to checked settings.
//   0. Running now: every imgstore-crop-arenas / preprocess-sample on this computer with its
//      progress (/api/collector/running), polled every 10 s; a row selects its experiment.
//   1. Fetch from cv2: the experiments of a date on cv2 and what a fetch copies (chunks before
//      ZT `zt_limit`, fh-collector-zt), rsync as a job (/api/collector/*, data_collector.py).
//   2. Segmentation settings: roi-proposer + the editor (SegmentationEditor.js).
//   3. Crop arenas: imgstore-crop-arenas once arenas.toml is saved (recordings split into arenas),
//      through the GPU queue (GpuQueue.js, below "Running now").
//   4. preprocess-sample: started / stopped here, its preprocess_sample.csv as a table and a
//      per-chunk strip; a row opens the frame in the editor with the CSV's centroids.
// "analyzed" badges: the folder (or one of its arenas) has a database, as the index lists them.
// The experiment edited is kept in fh-collector-experiment, the date in fh-collector-date.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from './api';
import { useConsole } from './MessageConsole';
import SegmentationEditor from './SegmentationEditor';
import GpuQueueCard from './GpuQueue';

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);
const errorOf = (err) => err.response?.data?.error ?? err.message;
const gb = (bytes) => (bytes == null ? '–' : `${(bytes / 1e9).toFixed(bytes < 1e10 ? 1 : 0)} GB`);

function stored(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function store(key, value) {
  try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* ignore */ }
}

function fetchState(e) {
  if (e.fetching) return ['fetching', 'dm-warn'];
  if (e.wanted_files && e.here_files === e.wanted_files) return ['here', 'dm-ok'];
  if (e.here_files > 0) return [`${e.here_files}/${e.wanted_files} files here`, 'dm-warn'];
  return ['not here', 'dm-none'];
}

// Analyzed = a database (*db other than index.db) in the folder; a whole recording also counts
// its arenas' (paths arenas/K/…). `databases` from /api/collector/date or /settings.
function AnalyzedBadge({ databases }) {
  if (!databases) return null;
  const arenas = [...new Set(databases.filter((d) => d.path.includes('/')).map((d) => d.path.split('/')[1]))];
  const own = databases.some((d) => !d.path.includes('/'));
  const title = databases.length
    ? databases.map((d) => `${d.path} · ${(d.size / 1e6).toFixed(0)} MB · ${new Date(d.mtime * 1000).toLocaleString()}`).join('\n')
    : 'No database yet (*db other than index.db): the pipeline has not tracked it';
  const [text, cls] = own ? ['analyzed', 'dm-ok']
    : arenas.length ? [`arena${arenas.length > 1 ? 's' : ''} ${arenas.join(', ')} analyzed`, 'dm-ok']
      : ['not analyzed', 'dm-none'];
  return <span className={`dm-status ${cls}`} title={title}>{text}</span>;
}

// ── 0. Running now ─────────────────────────────────────────────────────────
const TOOLS = { crop_arenas: 'imgstore-crop-arenas', preprocess_sample: 'preprocess-sample' };

function hms(text) {
  // tqdm's "1:53:51" / "53:51" → seconds
  if (!text || !/^[\d:]+$/.test(text)) return null;
  return text.split(':').reduce((s, part) => s * 60 + Number(part), 0);
}
function duration(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '–';
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ${m % 60} min` : `${(h / 24).toFixed(1)} d`;
}

function RunningCard({ active, selected, onSelect }) {
  const { log } = useConsole();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    try {
      setData(unwrap((await api.get('/api/collector/running')).data));
      setError(null);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    fetchRuns();
    const timer = setInterval(fetchRuns, 10000);
    return () => clearInterval(timer);
  }, [active, fetchRuns]);

  const stop = async (run) => {
    if (!window.confirm(`Stop ${TOOLS[run.tool]} on ${run.experiment}?`
        + (run.tool === 'crop_arenas' ? ' The chunks being encoded are left incomplete (Resume crops them again).' : ' The CSV keeps the chunks checked so far.'))) return;
    try {
      await api.post(`/api/collector/${run.tool}/stop`, { experiment: run.experiment });
      log('info', `${TOOLS[run.tool]} stopped on ${run.experiment}`);
      setTimeout(fetchRuns, 1000);
    } catch (err) {
      log('error', `Stop: ${errorOf(err)}`);
    }
  };

  const runs = data?.runs || [];
  const now = data?.now ?? Date.now() / 1000;
  const counts = Object.keys(TOOLS).map((tool) => [tool, runs.filter((r) => r.tool === tool).length]).filter(([, n]) => n);

  return (
    <section className="card">
      <div className="card-header">
        Running now
        <span className="spacer" />
        <span className="ov-normal">
          {counts.map(([tool, n]) => <span key={tool} className="sc-badge sc-rec" style={{ marginLeft: 6 }}>{n} × {TOOLS[tool]}</span>)}
          <button style={{ marginLeft: 8 }} onClick={fetchRuns} title="Refresh (also every 10 s while this tab is shown)">
            <i className={`fa fa-refresh ${loading ? 'fa-spin' : ''}`} />
          </button>
        </span>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {error && <div className="ov-warn">{error}</div>}
        {data && !runs.length && <div className="sc-muted">No imgstore-crop-arenas or preprocess-sample running.</div>}
        {runs.length > 0 && (
          <div className="ov-scroll">
            <table className="ov-table">
              <thead>
                <tr><th>Tool</th><th>Experiment</th><th style={{ minWidth: 180 }}>Progress</th><th>Running for</th><th>Time left</th><th>Log</th><th /></tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const p = run.progress;
                  const fraction = p && p.total > 0 ? p.done / p.total : null;
                  let left = null;
                  let leftTitle = '';
                  if (run.tool === 'crop_arenas' && p) {
                    // tqdm's estimate when it last wrote the bar
                    left = hms(p.remaining);
                    if (left != null && run.log_mtime) left = Math.max(0, left - (now - run.log_mtime));
                    leftTitle = `tqdm's estimate (${p.remaining} at ${run.log_mtime ? new Date(run.log_mtime * 1000).toLocaleTimeString() : '?'})`;
                  } else if (fraction > 0) {
                    left = (now - run.started) * (1 - fraction) / fraction;
                    leftTitle = 'From the pace since the start';
                  }
                  const logAge = run.log_mtime ? now - run.log_mtime : null;
                  const otherLine = run.last_line && !run.last_line.startsWith('Cropping chunks') ? run.last_line : null;
                  return (
                    <tr key={`${run.tool} ${run.folder}`} className={selected && run.experiment === selected ? 'sc-row-on' : ''}>
                      <td className="mono">{TOOLS[run.tool]}{run.resume ? ' --resume' : ''}</td>
                      <td>
                        <span className="mono">{run.experiment || run.folder}</span>
                        {otherLine && <div className="mono sc-small ov-warn" title="Last line of crop_arenas.log">{otherLine}</div>}
                      </td>
                      <td>
                        {p ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div className="sc-progress" style={{ flex: 1 }}><div style={{ width: `${(100 * (fraction || 0)).toFixed(1)}%` }} /></div>
                            <span className="mono sc-small" style={{ whiteSpace: 'nowrap' }}>
                              {p.done}/{p.total} chunks{run.tool === 'preprocess_sample' && run.current_chunk != null ? ` · ${run.current_chunk}` : ''}
                            </span>
                          </div>
                        ) : <span className="sc-muted">no progress yet</span>}
                      </td>
                      <td title={`Started ${new Date(run.started * 1000).toLocaleString()} · pid ${run.pid}`}>{duration(now - run.started)}</td>
                      <td title={leftTitle}>
                        {left != null ? <>{duration(left)} <span className="sc-muted sc-small">({new Date((now + left) * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })})</span></> : '–'}
                      </td>
                      <td className={logAge != null && logAge > 3600 ? 'ov-warn' : ''}
                          title={run.log_mtime ? `Log written ${new Date(run.log_mtime * 1000).toLocaleString()}` : 'No log'}>
                        {logAge != null ? `${duration(logAge)} ago` : '–'}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {run.experiment && (
                          <button onClick={() => onSelect(run.experiment, run.tool)} title="Choose this experiment: its card below shows the log">Show</button>
                        )}
                        {run.experiment && (
                          <button style={{ marginLeft: 4 }} onClick={() => stop(run)} title={`Stop ${TOOLS[run.tool]}`}><i className="fa fa-stop" /></button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

// ── 1. Fetch from cv2 ──────────────────────────────────────────────────────
function FetchCard({ active, onEdit, editing, onOpenExperiment }) {
  const { log, trackJob } = useConsole();
  const [dates, setDates] = useState(null);
  const [remote, setRemote] = useState(null);       // {host, http, remote_root}
  const [date, setDate] = useState(() => stored('fh-collector-date', ''));
  const [ztLimit, setZtLimit] = useState(() => Number(stored('fh-collector-zt', 30)) || 30);
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [fetching, setFetching] = useState(false);

  useEffect(() => store('fh-collector-date', date || null), [date]);
  useEffect(() => store('fh-collector-zt', String(ztLimit)), [ztLimit]);

  const fetchDates = useCallback(async () => {
    try {
      const data = unwrap((await api.get('/api/collector/dates')).data);
      setDates(data.dates);
      setRemote(data);
      setError(null);
      setDate((d) => (d && data.dates.some((x) => x.date === d) ? d : data.dates[0]?.date || ''));
    } catch (err) {
      setError(`cv2: ${errorOf(err)}`);
    }
  }, []);

  const shown = useRef(false);
  useEffect(() => {
    if (active && !shown.current) { shown.current = true; fetchDates(); }
  }, [active, fetchDates]);

  const fetchDate = useCallback(async () => {
    if (!date) return;
    setLoading(true);
    try {
      const data = unwrap((await api.get(`/api/collector/date/${date}`, { params: { zt_limit: ztLimit } })).data);
      setListing(data);
      setError(null);
      setSelected(new Set(data.experiments.filter((e) => e.missing_bytes > 0 && !e.fetching).map((e) => e.experiment)));
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setLoading(false);
    }
  }, [date, ztLimit]);

  useEffect(() => { if (active) fetchDate(); }, [date, ztLimit]); // eslint-disable-line react-hooks/exhaustive-deps

  const startFetch = async () => {
    setFetching(true);
    try {
      const job = unwrap((await api.post('/api/collector/fetch', { experiments: [...selected], zt_limit: ztLimit })).data);
      fetchDate();
      const done = await trackJob(job);
      if (done.status === 'done') log('success', `Fetched ${done.items.length} experiment(s) from ${remote?.host}`);
      fetchDate();
      fetchDates();
    } catch (err) {
      log('error', `Fetch: ${errorOf(err)}`);
    } finally {
      setFetching(false);
    }
  };

  const experiments = listing?.experiments || [];
  const selectedBytes = experiments.filter((e) => selected.has(e.experiment)).reduce((s, e) => s + e.missing_bytes, 0);
  const toggle = (name) => setSelected((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });

  return (
    <section className="card">
      <div className="card-header">
        Fetch from {remote?.host || 'cv2'}
        <span className="spacer" />
        {remote && (
          <span className="ov-normal" title={`${remote.host}:${remote.remote_root}`}>
            <a href={remote.http} target="_blank" rel="noreferrer">{remote.http}</a>
          </span>
        )}
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="toolbar">
          <label className="field">Recorded on
            <select value={date} onChange={(e) => setDate(e.target.value)}>
              {!dates && <option value="">loading…</option>}
              {(dates || []).map((d) => (
                <option key={d.date} value={d.date}>
                  {d.date} · {d.experiments.length} exp. · {d.experiments.filter((e) => e.local).length} here
                </option>
              ))}
            </select>
          </label>
          <label className="field" title="Chunks starting at or after this ZT are not copied (the first 24 h and a buffer are enough)">
            Up to ZT
            <input type="number" min={1} max={200} value={ztLimit} onChange={(e) => Number(e.target.value) > 0 && setZtLimit(Number(e.target.value))} />
          </label>
          <button onClick={() => { fetchDates(); fetchDate(); }} disabled={loading}>
            <i className={`fa fa-refresh ${loading ? 'fa-spin' : ''}`} style={{ marginRight: 6 }} />Refresh
          </button>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="btn-primary" disabled={!selected.size || fetching} onClick={startFetch}
                  title="rsync the selected experiments (only missing or different files)">
            <i className="fa fa-download" style={{ marginRight: 6 }} />Fetch {selected.size} selected ({gb(selectedBytes)})
          </button>
        </div>
        {error && <div className="ov-warn">{error}</div>}
        {listing && (
          <div className="ov-scroll">
            <table className="ov-table">
              <thead>
                <tr>
                  <th style={{ cursor: 'default' }}>
                    <input type="checkbox" checked={experiments.length > 0 && experiments.every((e) => selected.has(e.experiment))}
                           onChange={(e) => setSelected(new Set(e.target.checked ? experiments.map((x) => x.experiment) : []))} />
                  </th>
                  <th>Experiment</th>
                  <th title="created_utc of metadata.yaml">Started (UTC)</th>
                  <th title="ZT at the start; ZT0 from the reference_hour of the metadata sheets, else 12">ZT at start</th>
                  <th title="Chunks on cv2">On {remote?.host}</th>
                  <th title={`Chunks starting before ZT${listing.zt_limit} (+ the other files of the folder)`}>Up to ZT{listing.zt_limit}</th>
                  <th>Here</th>
                  <th>To fetch</th>
                  <th title="Has a database: idtrackerai has tracked it (or some of its arenas)">Analyzed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {experiments.map((e) => {
                  const [state, cls] = fetchState(e);
                  return (
                    <tr key={e.experiment} className={editing?.startsWith(e.experiment) ? 'sc-row-on' : ''}>
                      <td><input type="checkbox" checked={selected.has(e.experiment)} onChange={() => toggle(e.experiment)} /></td>
                      <td className="mono">{e.experiment}</td>
                      <td>{e.created_utc?.replace('T', ' ') ?? '–'}</td>
                      <td title={`ZT0 at ${e.reference_hour}:00 (${e.reference_hour_source === 'sheet' ? 'metadata sheet' : 'no sheet row yet: default'})`}>
                        {e.zt_start != null ? `ZT${e.zt_start.toFixed(1)}` : '–'}
                        {e.reference_hour_source === 'default' && <span className="sc-muted"> *</span>}
                      </td>
                      <td>
                        {e.remote_chunks} chunks · {e.remote_hours ?? '–'} h
                        {e.recording && <span className="sc-badge sc-rec" title="Files modified in the last 10 min: still recording">● rec</span>}
                      </td>
                      <td>{e.wanted_chunks} chunks{e.wanted_last_chunk != null ? ` (≤ ${e.wanted_last_chunk})` : ''} · {gb(e.wanted_bytes)}</td>
                      <td><span className={`dm-status ${cls}`}>{state}</span></td>
                      <td>{e.missing_bytes ? gb(e.missing_bytes) : '–'}</td>
                      <td>{e.local ? <AnalyzedBadge databases={e.databases} /> : '–'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button disabled={!e.local} onClick={() => onEdit(e.experiment)} title="Edit its idtrackerai settings below">Settings ▸</button>{' '}
                        <button disabled={!e.local} onClick={() => onOpenExperiment(e.experiment)} title="Open it in the Group viewer">Open</button>
                        {e.arenas.map((a) => (
                          <button key={a} style={{ marginLeft: 4 }} onClick={() => onEdit(`${e.experiment}/arenas/${a}`)}
                                  title={`Edit the settings of arena ${a} (cropped out of this recording)`}>arena {a}</button>
                        ))}
                      </td>
                    </tr>
                  );
                })}
                {!experiments.length && <tr><td colSpan={10} className="sc-muted">No experiment recorded on {listing.date}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        {listing && (
          <div className="sc-muted">
            Free here: {Object.entries(listing.free).map(([h, free]) => `${h} ${gb(free)}`).join(' · ')}
            {' '}(a fetch keeps {gb(listing.margin)} free). * ZT0 at 12:00 until the metadata sheets have the experiment.
          </div>
        )}
      </div>
    </section>
  );
}

// ── 3. preprocess-sample ───────────────────────────────────────────────────
function PerChunkStrip({ frames, start, end, onChunk }) {
  const counts = useMemo(() => {
    const c = new Map();
    frames.forEach((f) => c.set(f.chunk, (c.get(f.chunk) || 0) + 1));
    return c;
  }, [frames]);
  if (start == null || end == null || end < start) return null;
  const n = end - start + 1;
  const max = Math.max(1, ...counts.values());
  return (
    <svg className="sc-strip" viewBox={`0 0 ${n} 30`} preserveAspectRatio="none">
      {Array.from({ length: n }, (_, i) => {
        const chunk = start + i;
        const v = counts.get(chunk) || 0;
        return (
          <rect key={chunk} x={i} y={30 - (v ? 4 + (26 * v) / max : 1)} width={0.9} height={v ? 4 + (26 * v) / max : 1}
                fill={v ? '#e07b00' : 'var(--border-strong)'} style={{ cursor: v ? 'pointer' : 'default' }}
                onClick={() => v && onChunk(chunk)}>
            <title>chunk {chunk}: {v} problematic frame{v === 1 ? '' : 's'}</title>
          </rect>
        );
      })}
    </svg>
  );
}

function PreprocessCard({ experiment, active, refreshKey, onShowFrame, shownFrame }) {
  const { log } = useConsole();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [range, setRange] = useState({ start: '', end: '', samples: '' });
  const [showLog, setShowLog] = useState(false);

  const fetchStatus = useCallback(async () => {
    if (!experiment) { setStatus(null); return; }
    try {
      const data = unwrap((await api.get('/api/collector/preprocess_sample', { params: { experiment } })).data);
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(errorOf(err));
    }
  }, [experiment]);

  useEffect(() => { setRange({ start: '', end: '', samples: '' }); }, [experiment]);
  useEffect(() => { if (active) fetchStatus(); }, [active, fetchStatus, refreshKey]);
  useEffect(() => {
    if (!active || !status?.running) return undefined;
    const timer = setInterval(fetchStatus, 10000);
    return () => clearInterval(timer);
  }, [active, status?.running, fetchStatus]);

  const start = async () => {
    try {
      const data = unwrap((await api.post('/api/collector/preprocess_sample', {
        experiment, start_chunk: range.start, end_chunk: range.end, samples_per_chunk: range.samples,
      })).data);
      log('info', `preprocess-sample started on chunks ${data.start_chunk}–${data.end_chunk} (${data.samples_per_chunk} frames per chunk, pid ${data.pid})`);
      setTimeout(fetchStatus, 1500);
    } catch (err) {
      log('error', `preprocess-sample: ${errorOf(err)}`);
    }
  };
  const stop = async () => {
    if (!window.confirm('Stop preprocess-sample? The CSV keeps the chunks checked so far.')) return;
    try {
      await api.post('/api/collector/preprocess_sample/stop', { experiment });
      log('info', 'preprocess-sample stopped');
      setTimeout(fetchStatus, 1000);
    } catch (err) {
      log('error', `Stop: ${errorOf(err)}`);
    }
  };

  const frames = status?.csv?.frames || [];
  const expected = status?.number_of_animals;
  const def = status?.default_range;
  const runStart = status?.running ? status.start_chunk : Number(range.start || def?.[0]);
  const runEnd = status?.running ? status.end_chunk - 1 : Number(range.end || def?.[1]);
  const byN = useMemo(() => {
    const c = {};
    frames.forEach((f) => { c[f.n] = (c[f.n] || 0) + 1; });
    return Object.entries(c).sort((a, b) => Number(a[0]) - Number(b[0]));
  }, [frames]);
  const progress = status?.running && status.current_chunk != null && status.end_chunk > status.start_chunk
    ? Math.max(0, (status.current_chunk - status.start_chunk) / (status.end_chunk - status.start_chunk)) : null;

  return (
    <section className="card">
      <div className="card-header">
        preprocess-sample
        <span className="spacer" />
        {status?.running && <span className="ov-normal sc-badge sc-rec">running · chunk {status.current_chunk ?? '…'} of {status.start_chunk}–{status.end_chunk - 1}</span>}
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!experiment && <div className="sc-muted">Choose an experiment above.</div>}
        {error && <div className="ov-warn">{error}</div>}
        {status && (
          <>
            <div className="sc-muted">
              Samples frames of each chunk and lists those where the segmentation (the <code>.conf</code>) does not find
              the number of animals. It runs in the background for hours and keeps running if the server restarts.
              {status.arena && <> In this arena it reads <code>{experiment.split('/').pop()}.conf</code>, a copy of <code>{status.conf}</code> made when the toml is saved and before each run.</>}
            </div>
            <div className="toolbar">
              <label className="field">Chunks
                <input type="number" value={range.start} placeholder={def ? String(def[0]) : ''} onChange={(e) => setRange({ ...range, start: e.target.value })} />
                –
                <input type="number" value={range.end} placeholder={def ? String(def[1]) : ''} onChange={(e) => setRange({ ...range, end: e.target.value })} />
              </label>
              <label className="field">Frames per chunk
                <input type="number" min={1} value={range.samples} placeholder={String(status.samples_per_chunk_default)} onChange={(e) => setRange({ ...range, samples: e.target.value })} />
              </label>
              {status.running ? (
                <button onClick={stop}><i className="fa fa-stop" style={{ marginRight: 6 }} />Stop</button>
              ) : (
                <button className="btn-primary" onClick={start} disabled={!status.has_conf}
                        title={status.has_conf ? 'Starts preprocess-sample (idtrackeraiv4) on these chunks' : `Save the main toml first: it writes ${status.conf}, the .conf preprocess-sample reads`}>
                  <i className="fa fa-play" style={{ marginRight: 6 }} />Run preprocess-sample
                </button>
              )}
              <button onClick={fetchStatus}><i className="fa fa-refresh" style={{ marginRight: 6 }} />Refresh</button>
              {status.range_error && <span className="ov-warn">{status.range_error}</span>}
            </div>
            {progress != null && (
              <div className="sc-progress"><div style={{ width: `${Math.min(100, 100 * progress).toFixed(1)}%` }} /></div>
            )}
            {status.error && <div className="ov-warn">Last run failed: {status.error}</div>}
            {status.log && (
              <div>
                <button className="ov-more" style={{ border: 'none', padding: 0, background: 'none' }} onClick={() => setShowLog((v) => !v)}>
                  {showLog ? '▾' : '▸'} preprocess_sample.log {status.total_line ? `· ${status.total_line}` : ''}
                </button>
                {showLog && <pre className="sc-log">{status.log.tail.join('\n')}</pre>}
              </div>
            )}

            {status.csv ? (
              <>
                <div className="readout">
                  <span>Problematic frames <b>{frames.length}</b></span>
                  {expected != null && <span>Expected animals <b>{expected}</b></span>}
                  {byN.map(([n, c]) => <span key={n}>{n} found <b>{c}</b></span>)}
                  <span>CSV updated <b>{new Date(status.csv.mtime * 1000).toLocaleString()}</b></span>
                </div>
                <PerChunkStrip frames={frames} start={Number.isFinite(runStart) ? runStart : null} end={Number.isFinite(runEnd) ? runEnd : null}
                               onChunk={(chunk) => { const f = frames.find((x) => x.chunk === chunk); if (f) onShowFrame(f); }} />
                <div className="ov-scroll sc-csv">
                  <table className="ov-table">
                    <thead>
                      <tr><th>Frame</th><th>Chunk</th><th>Video</th><th>Frame in video</th><th>Blobs found</th><th>Centroids</th></tr>
                    </thead>
                    <tbody>
                      {frames.map((f) => (
                        <tr key={f.frame_number} className={shownFrame === f.frame_number ? 'sc-row-on' : ''}
                            style={{ cursor: 'pointer' }} onClick={() => onShowFrame(f)} title="Show this frame in the editor">
                          <td className="mono">{f.frame_number}</td>
                          <td>{f.chunk}</td>
                          <td className="mono">{f.video}</td>
                          <td>{f.frame_idx}</td>
                          <td className={expected != null && f.n !== expected ? 'ov-warn' : ''}>{f.n}{expected != null ? ` / ${expected}` : ''}</td>
                          <td className="mono sc-small">{f.points.map(([x, y]) => `(${Math.round(x)}, ${Math.round(y)})`).join(' ') || 'none'}</td>
                        </tr>
                      ))}
                      {!frames.length && <tr><td colSpan={6} className="sc-muted">No problematic frame{status.running ? ' so far' : ''}</td></tr>}
                    </tbody>
                  </table>
                </div>
              </>
            ) : <div className="sc-muted">No preprocess_sample.csv yet.</div>}
          </>
        )}
      </div>
    </section>
  );
}

// imgstore-crop-arenas on the recording once its arenas.toml is saved: arenas/1, 2, ...
function CropArenasCard({ experiment, active, refreshKey, onEdit }) {
  const { log } = useConsole();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [showLog, setShowLog] = useState(false);

  const fetchStatus = useCallback(async () => {
    if (!experiment) { setStatus(null); return; }
    try {
      setStatus(unwrap((await api.get('/api/collector/crop_arenas', { params: { experiment } })).data));
      setError(null);
    } catch (err) {
      setStatus(null);
      setError(errorOf(err));
    }
  }, [experiment]);

  useEffect(() => { if (active) fetchStatus(); }, [active, fetchStatus, refreshKey]);
  const busy = Boolean(status?.running || status?.queue);
  useEffect(() => {
    if (!active || !busy) return undefined;
    const timer = setInterval(fetchStatus, 10000);
    return () => clearInterval(timer);
  }, [active, busy, fetchStatus]);

  const start = async (resume = false) => {
    if (!resume && status.arenas.length && !window.confirm(`arenas/ already holds ${status.arenas.length} arena folder${status.arenas.length === 1 ? '' : 's'}: `
        + 'crop them again from arenas.toml? Their videos and metadata.yaml are overwritten and roi-proposer proposes their tomls again.'
        + ' (Resume only crops the chunks that are not done.)')) return;
    try {
      unwrap((await api.post('/api/collector/crop_arenas', { experiment, resume })).data);
      log('info', `imgstore-crop-arenas${resume ? ' --resume' : ''} on ${experiment} queued: it starts when the GPU has room`);
      setShowLog(true);
      setTimeout(fetchStatus, 1500);
    } catch (err) {
      log('error', `imgstore-crop-arenas: ${errorOf(err)}`);
    }
  };
  const stop = async () => {
    const waiting = status.queue?.status === 'queued';
    if (!window.confirm(waiting ? 'Take imgstore-crop-arenas out of the GPU queue?'
      : 'Stop imgstore-crop-arenas? The chunks being encoded are left incomplete.')) return;
    try {
      await api.post('/api/collector/crop_arenas/stop', { experiment });
      log('info', waiting ? 'imgstore-crop-arenas taken out of the GPU queue' : 'imgstore-crop-arenas stopped');
      setTimeout(fetchStatus, 1000);
    } catch (err) {
      log('error', `Stop: ${errorOf(err)}`);
    }
  };

  if (status?.arena) return null;
  const progress = status?.progress;
  const waiting = status?.queue?.status === 'queued' ? status.queue : null;
  // arena folders of a run that did not end with exit code 0 (stopped, killed or failed)
  const canResume = Boolean(status?.arenas.length && status.has_arenas_toml);
  const unfinished = canResume && status.exit_code !== 0;
  return (
    <section className="card">
      <div className="card-header">
        Crop arenas
        <span className="spacer" />
        {status?.running && (
          <span className="ov-normal sc-badge sc-rec">
            running{progress ? ` · ${progress.done}/${progress.total} chunks` : ''}
          </span>
        )}
        {waiting && <span className="ov-normal sc-badge">GPU queue #{waiting.position}</span>}
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!experiment && <div className="sc-muted">Choose an experiment above.</div>}
        {error && <div className="ov-warn">{error}</div>}
        {status && (
          <>
            <div className="sc-muted">
              Splits the recording into one recording per arena of <code>arenas.toml</code> (<code>arenas/1</code>, <code>arenas/2</code>, …),
              then proposes their settings with roi-proposer: <code className="mono">{status.command}</code>.
              It runs in the background and keeps running if the server restarts.
            </div>
            <div className="toolbar">
              {waiting ? (
                <>
                  <span>Waiting in the GPU queue (#{waiting.position}): {waiting.reason || 'starting…'}</span>
                  <button onClick={stop}><i className="fa fa-times" style={{ marginRight: 6 }} />Cancel</button>
                </>
              ) : status.running ? (
                <button onClick={stop}><i className="fa fa-stop" style={{ marginRight: 6 }} />Stop</button>
              ) : (
                <>
                  <button className={unfinished ? undefined : 'btn-primary'} onClick={() => start(false)} disabled={!status.has_arenas_toml}
                          title={status.has_arenas_toml ? 'Crop the arenas of arenas.toml out of every chunk (GPU, 4 at once), once the GPU queue has room'
                            : 'Make arenas.toml first ("Split into N arenas" in the editor above) and save it'}>
                    <i className="fa fa-crop" style={{ marginRight: 6 }} />Crop arenas
                  </button>
                  {canResume && (
                    <button className={unfinished ? 'btn-primary' : undefined} onClick={() => start(true)}
                            title="imgstore-crop-arenas --resume: skips the chunks already cropped for every arena, deletes the files of the chunks left incomplete and crops them again">
                      <i className="fa fa-play" style={{ marginRight: 6 }} />Resume
                    </button>
                  )}
                </>
              )}
              <button onClick={fetchStatus}><i className="fa fa-refresh" style={{ marginRight: 6 }} />Refresh</button>
              {!status.has_arenas_toml && <span className="sc-muted">No arenas.toml saved yet</span>}
              {status.arenas.length > 0 && (
                <span>
                  Arenas:
                  {status.arenas.map((a) => (
                    <button key={a} style={{ marginLeft: 4 }} onClick={() => onEdit(`${experiment}/arenas/${a}`)}
                            title={`Edit the settings of arenas/${a}`}>{a}</button>
                  ))}
                </span>
              )}
            </div>
            {status.running && progress && progress.total > 0 && (
              <div className="sc-progress"><div style={{ width: `${(100 * progress.done / progress.total).toFixed(1)}%` }} /></div>
            )}
            {status.running && !status.log && <div className="sc-muted">Started outside the validator: no crop_arenas.log to follow.</div>}
            {status.exit_code != null && status.exit_code !== 0 && <div className="ov-warn">Last run failed (exit code {status.exit_code}): see the log.</div>}
            {status.exit_code === 0 && <div className="sc-muted">Last run finished.</div>}
            {status.log && (
              <div>
                <button className="ov-more" style={{ border: 'none', padding: 0, background: 'none' }} onClick={() => setShowLog((v) => !v)}>
                  {showLog ? '▾' : '▸'} crop_arenas.log · {new Date(status.log.mtime * 1000).toLocaleString()}
                </button>
                {showLog && <pre className="sc-log">{status.log.tail.join('\n')}</pre>}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export default function DataCollectorTab({ active, onOpenExperiment }) {
  const [experiment, setExperiment] = useState(() => stored('fh-collector-experiment', null));
  const [highlight, setHighlight] = useState(null);    // CSV frame shown in the editor
  const [savedKey, setSavedKey] = useState(0);
  const [info, setInfo] = useState(null);              // /api/collector/settings of the experiment
  const editorRef = useRef(null);
  const cropRef = useRef(null);
  const preprocessRef = useRef(null);

  useEffect(() => store('fh-collector-experiment', experiment), [experiment]);

  const edit = (name) => {
    setExperiment(name);
    setHighlight(null);
    setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  const showRun = (name, tool) => {
    setExperiment(name);
    setHighlight(null);
    const ref = tool === 'crop_arenas' ? cropRef : preprocessRef;
    setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
  };
  const showFrame = (frame) => {
    setHighlight({ ...frame });
    editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="sc-tab">
      <RunningCard active={active} selected={experiment} onSelect={showRun} />

      <GpuQueueCard active={active} />

      <FetchCard active={active} onEdit={edit} editing={experiment} onOpenExperiment={onOpenExperiment} />

      <section className="card" ref={editorRef}>
        <div className="card-header">
          Segmentation settings
          <span className="spacer" />
          {info && info.experiment === experiment?.replace(/^\/+|\/+$/g, '') && (
            <span className="ov-normal" style={{ marginRight: 8 }}><AnalyzedBadge databases={info.databases} /></span>
          )}
          <span className="ov-normal">
            <input type="text" className="mono" style={{ width: 300 }} placeholder="FlyHostelN/NX/YYYY-MM-DD_HH-MM-SS[/arenas/K]"
                   value={experiment || ''} onChange={(e) => setExperiment(e.target.value.trim() || null)} />
          </span>
        </div>
        <SegmentationEditor experiment={experiment} active={active} highlight={highlight} frameRequest={highlight}
                            onSaved={() => setSavedKey((k) => k + 1)} onInfo={setInfo} />
      </section>

      <div ref={cropRef}><CropArenasCard experiment={experiment} active={active} refreshKey={savedKey} onEdit={edit} /></div>

      <div ref={preprocessRef}>
        <PreprocessCard experiment={experiment} active={active} refreshKey={savedKey}
                        onShowFrame={showFrame} shownFrame={highlight?.frame_number} />
      </div>
    </div>
  );
}
