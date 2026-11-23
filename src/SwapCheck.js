// SwapCheck.js  —  "Identity swaps" section of the QC tab
//
// Reads /api/qc/swaps (idtrackerai_validator_server/swaps.py): places where a fly's identity may have jumped onto
// another fly's track — two flies exchanging places (exchange), a fly taking the place of another that is gone
// (takeover) or landing on one still there (onto). Nothing is corrected: these are to be looked at. Computed by a
// job per tracking source (machine = ROI_0 + IDENTITY, flies as local identities of the chunk; validated =
// ROI_0_VAL + IDENTITY_VAL, flies as identities), kept by the server until the database changes. Each event
// opens the Group viewer or the Annotate tab at its frame.

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import api from './api';
import CardResizer from './CardResizer';
import { useConsole } from './MessageConsole';

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);
const fmt = (n) => (n == null ? '' : n.toLocaleString());
const TYPES = [
  ['exchange', 'Exchange', 'Two flies exchanged places: each identity continues where the other fly was'],
  ['takeover', 'Takeover', 'An identity jumped to where another fly was, that fly is gone (missing or moved away)'],
  ['onto', 'Onto', 'An identity jumped onto another fly that is still detected there (split blob, missed fly…)'],
];
const PARAMS = [
  ['body_mm', 'Body length (mm)', 'Unit of the thresholds below; px from METADATA pixels_per_cm'],
  ['jump_bl', 'Jump ≥ (body lengths)', 'An identity moving less is never flagged (jitter of flies touching)'],
  ['step_factor', 'Jump ≥ × usual step', '… nor less than this × the chunk\'s 99th percentile one-frame step'],
  ['near_bl', 'Lands within (body lengths)', 'of the other fly\'s last place'],
  ['ratio', '… and ≤ × own jump', 'closer to the other fly\'s place than to its own, by this ratio'],
  ['max_gap_s', 'Unseen at most (s)', 'A fly missing for longer is not compared with its old place'],
  ['pair_s', 'Exchange within (s)', 'The other fly\'s jump to A\'s place within this: exchange'],
  ['merge_s', 'Merge within (s)', 'Jumps of the same two flies closer than this are one event'],
  ['encounter_bl', 'Encounter ≤ (body lengths)', 'Flies this close before: close encounter'],
  ['gap_tau_s', 'Score decay (s)', 'The score halves about every 0.7 × this of the fly unseen'],
];
const ZT0_KEY = 'fh-annotate-zt0';
const readZt0 = () => { try { const v = localStorage.getItem(ZT0_KEY); return v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : 12; } catch { return 12; } };
const fmtZt = (clock, zt0) => {
  if (clock == null) return '';
  const zt = clock / 3600 - zt0;
  return zt.toFixed(3);
};

const COLUMNS = [
  ['score', 'Score', (e) => e.score],
  ['start', 'Frame', (e) => e.frame],
  ['zt', 'ZT', (e) => e.clock ?? -Infinity],
  ['chunk', 'Chunk', (e) => e.chunk],
  ['flies', 'Flies', (e) => e.a * 1000 + e.b],
  ['type', 'Type', (e) => e.type],
  ['n_transitions', 'Jumps', (e) => e.n_transitions],
  ['d_own', 'Jump (px)', (e) => e.d_own],
  ['d_other', 'To other (px)', (e) => e.d_other],
  ['gap', 'Unseen (frames)', (e) => e.gap],
  ['reason', 'Reason', (e) => e.reason],
];

function ParamsEditor({ params, defaults, onChange }) {
  return (
    <div className="qc-swap-params">
      {PARAMS.map(([key, label, title]) => (
        <label key={key} className="field" title={title}>
          <span>{label}</span>
          <input type="number" step="any" value={params[key] ?? ''} style={{ width: 70 }}
                 onChange={(e) => onChange({ ...params, [key]: e.target.value === '' ? null : Number(e.target.value) })} />
          {defaults && params[key] !== defaults[key] && <span className="qc-muted">({defaults[key]})</span>}
        </label>
      ))}
      <button onClick={() => onChange({ ...defaults })} disabled={!defaults}>Defaults</button>
    </div>
  );
}

export default function SwapCheck({ active, currentExperiment, useVal, onOpenFrame, onOpenAnnotate }) {
  const { log, trackJob } = useConsole();
  const [source, setSource] = useState(null);       // null: the server picks (validated when "Validated tracking")
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [params, setParams] = useState(null);
  const [showParams, setShowParams] = useState(false);
  const [types, setTypes] = useState({ exchange: true, takeover: true, onto: true });
  const [netOnly, setNetOnly] = useState(false);
  const [minScore, setMinScore] = useState(0);
  const [sort, setSort] = useState(['score', -1]);
  const [zt0] = useState(readZt0);
  const tracked = useRef(new Set());
  const loadedFor = useRef(null);

  const fetchData = useCallback((src) => api.get('/api/qc/swaps', { params: src ? { source: src } : {} })
    .then((r) => { const d = unwrap(r.data); setData(d); setError(null); setParams((p) => p || d.params); return d; })
    .catch((err) => { setError(err.response?.data?.error || err.message); return null; }), []);

  const follow = useCallback((job, src) => {
    if (!job || tracked.current.has(job.id)) return;
    tracked.current.add(job.id);
    setRunning(true);
    trackJob(job)
      .then((done) => {
        if (done?.status === 'failed') log('error', `Swap check failed: ${done.error}`);
        return fetchData(src);
      })
      .finally(() => setRunning(false));
  }, [trackJob, log, fetchData]);

  const compute = useCallback(() => {
    const src = source || data?.source;
    setRunning(true);
    api.post('/api/qc/swaps', { source: src, params })
      .then((r) => follow(unwrap(r.data), src))
      .catch((err) => { setRunning(false); log('error', `Could not start the swap check: ${err.response?.data?.error || err.message}`); });
  }, [source, data, params, follow, log]);

  useEffect(() => {
    if (!active) return;
    const key = `${currentExperiment}|${useVal}|${source}`;
    if (loadedFor.current === key) return;
    if (loadedFor.current && !loadedFor.current.startsWith(`${currentExperiment}|`)) setParams(null);
    loadedFor.current = key;
    fetchData(source).then((d) => { if (d?.job) follow(d.job, d.source); });
  }, [active, currentExperiment, useVal, source, fetchData, follow]);

  const result = data?.result;
  const events = useMemo(() => {
    if (!result) return [];
    const col = COLUMNS.find((c) => c[0] === sort[0]) || COLUMNS[0];
    return result.events
      .filter((e) => types[e.type] && (!netOnly || e.net_swap) && e.score >= minScore)
      .sort((a, b) => {
        const x = col[2](a); const y = col[2](b);
        return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sort[1] || a.frame - b.frame;
      });
  }, [result, types, netOnly, minScore, sort]);

  if (!data) {
    return <div className="card ov-controls">{error ? `Swap check not available: ${error}` : 'Loading…'}</div>;
  }
  const src = data.source;
  const csvUrl = `${api.defaults.baseURL || ''}/api/qc/swaps.csv?source=${src}`;
  const keyName = result?.key === 'identity' ? 'identity' : 'local identity';
  const shown = events.slice(0, 1000);

  return (
    <section className="card">
      <header className="card-header">
        <span>Identity swaps</span>
        {result && <span className="ov-count">{fmt(result.events.length)}</span>}
        <span className="spacer" />
        <label className="field" title="Tracking checked: machine = ROI_0 + IDENTITY (flies as local identities of each chunk), validated = ROI_0_VAL + IDENTITY_VAL">
          <span>Tracking</span>
          <select value={src} onChange={(e) => setSource(e.target.value)}>
            <option value="machine">machine (IDENTITY)</option>
            <option value="validated" disabled={!data.sources.includes('validated')}>validated (IDENTITY_VAL)</option>
          </select>
        </label>
        <button onClick={() => setShowParams((v) => !v)} title="Thresholds of the check">
          <i className="fa fa-sliders" style={{ marginRight: 6 }} />Thresholds
        </button>
        <button onClick={compute} disabled={running || data.n_animals < 2}
                title="Read the tracking again (background job, ~0.3–3 s per chunk depending on the disk cache)">
          <i className={`fa ${running ? 'fa-spinner fa-spin' : 'fa-refresh'}`} style={{ marginRight: 6 }} />
          {running ? 'Checking…' : result ? 'Recompute' : 'Check swaps'}
        </button>
        {result && <a className="btn" href={csvUrl} download title="Every event as CSV"><i className="fa fa-download" style={{ marginRight: 6 }} />CSV</a>}
      </header>
      <div className="card-body">
        {showParams && params && <ParamsEditor params={params} defaults={data.defaults} onChange={setParams} />}
        {data.n_animals < 2 && <div className="qc-muted">One fly: no identity to swap with.</div>}
        {data.n_animals >= 2 && !result && (
          <div className="qc-muted">
            {running ? 'Following every fly frame by frame… (progress in the console)'
              : 'Not checked yet. Flags frames where a fly’s identity jumps to where another fly was (exchanges, takeovers): '
                + 'they can be real, look at them. Runs as a background job (minutes for a long experiment).'}
          </div>
        )}
        {result && (
          <>
            <div className="qc-swap-summary">
              <span className="qc-muted">
                {result.table} · body {result.body_px} px · lands within {result.near_px} px ·
                chunks {result.first_chunk}–{result.last_chunk} · {result.seconds} s
                {result.params && JSON.stringify(result.params) !== JSON.stringify(data.defaults) && ' · custom thresholds'}
              </span>
            </div>
            <div className="toolbar qc-swap-filters">
              {TYPES.map(([key, label, title]) => (
                <label key={key} title={title}>
                  <input type="checkbox" checked={types[key]} onChange={(e) => setTypes({ ...types, [key]: e.target.checked })} />
                  {' '}{label} <span className="qc-muted">{result.counts[key]}</span>
                </label>
              ))}
              <label title="Leave out flickers: identities that went back and forth between two flies and ended where they started">
                <input type="checkbox" checked={netOnly} onChange={(e) => setNetOnly(e.target.checked)} /> Net swaps only
              </label>
              <label className="field" title="Score 0–1: how close to the other fly's place, how big the jump, how short the time unseen">
                <span>Score ≥</span>
                <input type="number" min={0} max={1} step={0.05} value={minScore} style={{ width: 60 }}
                       onChange={(e) => setMinScore(Number(e.target.value) || 0)} />
              </label>
              <span className="qc-muted">{fmt(events.length)} shown · flies as {result.key === 'identity' ? 'identities' : 'local identities of the chunk'} · ZT0 at {zt0} h (Annotate tab)</span>
            </div>
            {events.length > 0 && (
              <div className="ov-scroll qc-scroll">
                <table className="pe-table ov-table">
                  <thead>
                    <tr>
                      {COLUMNS.map(([key, label]) => (
                        <th key={key} onClick={() => setSort(([k, d]) => [key, k === key ? -d : (key === 'score' ? -1 : 1)])}>
                          {label}{sort[0] === key ? (sort[1] > 0 ? ' ▲' : ' ▼') : ''}
                        </th>
                      ))}
                      <th>Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((e) => (
                      <tr key={`${e.chunk}-${e.start}-${e.a}-${e.b}`}>
                        <td className="qc-num">{e.score.toFixed(2)}</td>
                        <td className="qc-num" title={e.start === e.end ? '' : `frames ${e.start}–${e.end}`}>{fmt(e.frame)}</td>
                        <td className="qc-num">{fmtZt(e.clock, zt0)}</td>
                        <td className="qc-num">{e.chunk}</td>
                        <td className="qc-num" title={e.b ? `${keyName} ${e.a} jumped to where ${keyName} ${e.b} was` : `${keyName} ${e.a} jumped to where a fly without identity was`}>{e.a} → {e.b || '?'}</td>
                        <td>
                          <span className={`qc-swap-type qc-swap-${e.type}`}>{e.type}</span>
                          {e.encounter && <span className="qc-muted" title="The two flies were close before (crossing)"> ⨯</span>}
                          {!e.net_swap && <span className="qc-muted" title="Went back: an even number of swaps"> ↺</span>}
                        </td>
                        <td className="qc-num">{e.n_transitions}</td>
                        <td className="qc-num">{e.d_own}</td>
                        <td className="qc-num">{e.d_other}</td>
                        <td className="qc-num">{e.gap}</td>
                        <td className="ov-wrap">{e.reason}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button className="ov-link" onClick={() => onOpenFrame(Math.max(0, e.frame - 1))} title={`Open the Group viewer at frame ${e.frame - 1}, just before the jump`}>
                            <i className="fa fa-external-link" style={{ marginRight: 4 }} />viewer
                          </button>
                          {onOpenAnnotate && (
                            <button className="ov-link" onClick={() => onOpenAnnotate(e.frame)} title={`Open frame ${e.frame} in the Annotate tab`}>
                              <i className="fa fa-pencil-square-o" style={{ marginRight: 4 }} />annotate
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {events.length > shown.length && <div className="qc-muted qc-pad">The first {shown.length} of {fmt(events.length)} (CSV: all)</div>}
              </div>
            )}
          </>
        )}
      </div>
      {result && <CardResizer id="qc-swaps" />}
    </section>
  );
}
