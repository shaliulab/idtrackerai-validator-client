// QcTab.js  —  frames of the loaded experiment that do not track the expected number of flies
//
// Reads /api/qc (idtrackerai_validator_server/qc.py), computed by a background job the
// first time the tab is shown for an experiment and tracking table (IDENTITY or
// IDENTITY_VAL, as the "Validated tracking" box), then kept by the server until the
// database changes. A frame is ok when it has exactly N rows, each a different
// non-zero identity; with a single fly, identity 0 is the fly (flyhostel's convention),
// so one row of any identity is ok. Bad frames: not detected (fewer flies than
// expected), unidentified (groups only: a fly with identity 0, e.g. chunks after a
// broken concatenation) or other (extra rows, an identity twice). Every chart and table jumps the Group viewer to its
// frame on click. Below, the pose quality of every fly (PoseQc.js), which opens the Pose tab.

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import api from './api';
import CardResizer from './CardResizer';
import { useConsole } from './MessageConsole';
import { useElementSize } from './layout';
import PoseQc from './PoseQc';

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);

// Bad-frame reasons, in stacking order (validated categorical slots 1–3)
const REASONS = [
  ['unidentified', 'Unidentified', 'A fly detected but without identity (identity 0)'],
  ['not_detected', 'Not detected', 'Fewer rows than flies, none without identity'],
  ['other', 'Other', 'Extra rows, or the same identity twice'],
];

const fmt = (n) => (n == null ? '' : n.toLocaleString());
const pct = (a, b) => (b ? (100 * a) / b : 0);
const fmtPct = (p) => (p === 0 ? '0%' : p < 0.1 ? '<0.1%' : p > 99.9 && p < 100 ? '>99.9%' : `${p.toFixed(1)}%`);
const fmtDuration = (seconds) => {
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
};
const ago = (seconds) => {
  const m = (Date.now() / 1000 - seconds) / 60;
  if (m < 1) return 'just now';
  if (m < 60) return `${Math.round(m)} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 60 / 24)} d ago`;
};
const flies = (n) => `${n} fl${n === 1 ? 'y' : 'ies'}`;

function Stat({ label, value, sub, tone }) {
  return (
    <div className={`card ov-stat${tone ? ` qc-tone-${tone}` : ''}`}>
      <div className="ov-stat-label">{label}</div>
      <div className="ov-stat-value">{value}</div>
      {sub && <div className="ov-stat-sub">{sub}</div>}
    </div>
  );
}

function Verdict({ result }) {
  const { totals, n_animals: n, boundaries } = result;
  const bad = totals.frames - totals.ok;
  const share = pct(bad, totals.frames);
  if (bad === 0) {
    return (
      <div className="card qc-verdict qc-verdict-ok">
        <i className="fa fa-check-circle" />
        <div>
          <div className="qc-verdict-title">Every frame tracks {flies(n)}</div>
          <div className="qc-verdict-sub">
            {fmt(totals.frames)} frames checked, each with {n === 1 ? 'one row of the fly' : `${n} different non-zero identities`}.
          </div>
        </div>
      </div>
    );
  }
  const tone = share >= 5 ? 'bad' : 'warn';
  const main = REASONS.reduce((best, r) => (totals[r[0]] > totals[best[0]] ? r : best), REASONS[0]);
  return (
    <div className={`card qc-verdict qc-verdict-${tone}`}>
      <i className={`fa ${tone === 'bad' ? 'fa-times-circle' : 'fa-exclamation-triangle'}`} />
      <div>
        <div className="qc-verdict-title">
          {fmtPct(share)} of frames do not track {flies(n)}
          <span className="qc-verdict-count"> ({fmt(bad)} of {fmt(totals.frames)})</span>
        </div>
        <div className="qc-verdict-sub">
          Mostly <b>{main[1].toLowerCase()}</b> ({fmtPct(pct(totals[main[0]], bad))} of them)
          {boundaries.length > 0 && <> · {boundaries.length} chunk boundar{boundaries.length === 1 ? 'y' : 'ies'} without every fly identified on both sides</>}
        </div>
      </div>
    </div>
  );
}

// Stacked % of bad frames per chunk, with the 10 s bins strip below and marks on the
// boundaries where a fly was not identified on either side.
function Timeline({ result, onOpenFrame }) {
  const [el, setEl] = useState(null);
  const { width } = useElementSize(el);
  const [hover, setHover] = useState(null);   // { chunk, x, y }
  const canvasRef = useRef(null);
  const { chunks, n_animals: n, bins_per_chunk: perChunk, bin_size: binSize, chunksize, framerate } = result;
  const boundaryChunks = useMemo(() => new Set(result.boundaries.map((b) => b.next)), [result]);

  const plotH = 140;
  const stripH = 22;
  const marksH = 10;
  const left = 34;
  const w = Math.max(0, width - left);
  const step = chunks.length ? w / chunks.length : 0;
  const gap = step > 4 ? 1 : 0;
  const y = (p) => plotH - (plotH * p) / 100;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !w) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(stripH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, stripH);
    const binW = step / perChunk;
    chunks.forEach((c, i) => {
      c.bins.forEach((b, j) => {
        if (b == null) return;
        ctx.fillStyle = b === 0 ? 'rgba(12, 163, 12, 0.35)' : `rgba(208, 59, 59, ${0.25 + 0.75 * (b / 100)})`;
        ctx.fillRect(i * step + j * binW, 0, Math.max(binW, 0.5), stripH);
      });
    });
  }, [chunks, w, step, perChunk]);

  const at = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const i = Math.floor(x / step);
    if (i < 0 || i >= chunks.length) return null;
    return { i, x, y: e.clientY - rect.top, bin: Math.min(perChunk - 1, Math.floor(((x - i * step) / step) * perChunk)) };
  };

  const hovered = hover ? chunks[hover.i] : null;
  const ticks = useMemo(() => {
    if (!chunks.length || !step) return [];
    const every = Math.max(1, Math.ceil(50 / step / 10) * 10);
    return chunks.filter((c) => c.chunk % every === 0).map((c) => c.chunk);
  }, [chunks, step]);

  return (
    <div className="qc-timeline" ref={setEl}>
      {w > 0 && (
        <>
          <svg width={width} height={plotH + marksH + 16} className="qc-svg"
               onMouseMove={(e) => {
                 const rect = e.currentTarget.getBoundingClientRect();
                 const x = e.clientX - rect.left - left;
                 const i = Math.floor(x / step);
                 setHover(i >= 0 && i < chunks.length ? { i, x: x + left, y: e.clientY - rect.top, strip: false } : null);
               }}
               onMouseLeave={() => setHover(null)}
               onClick={() => {
                 if (!hovered) return;
                 onOpenFrame(hovered.first_bad ?? hovered.chunk * chunksize);
               }}>
            {[0, 50, 100].map((p) => (
              <g key={p}>
                <line x1={left} x2={width} y1={y(p)} y2={y(p)} className="qc-grid" />
                <text x={left - 4} y={y(p) + 4} className="qc-axis" textAnchor="end">{p}%</text>
              </g>
            ))}
            {chunks.map((c, i) => {
              let acc = 0;
              const x = left + i * step;
              return (
                <g key={c.chunk} className={hover?.i === i ? 'qc-hovered' : undefined}>
                  <rect x={x} y={0} width={step} height={plotH} className="qc-hit" />
                  {REASONS.map(([key]) => {
                    const p = pct(c[key], c.frames);
                    if (!p) return null;
                    const r = <rect key={key} x={x + gap / 2} y={y(acc + p)} width={Math.max(step - gap, 0.6)}
                                    height={Math.max((plotH * p) / 100, 0.8)} className={`qc-${key}`} />;
                    acc += p;
                    return r;
                  })}
                  {boundaryChunks.has(c.chunk) && (
                    <path d={`M${x - 4},${plotH + marksH} L${x + 4},${plotH + marksH} L${x},${plotH + 2} Z`} className="qc-mark" />
                  )}
                </g>
              );
            })}
            {ticks.map((chunk) => {
              const x = left + (chunk - chunks[0].chunk) * step;
              return <text key={chunk} x={x} y={plotH + marksH + 13} className="qc-axis" textAnchor="middle">{chunk}</text>;
            })}
          </svg>
          <div className="qc-strip-row">
            <span className="qc-strip-label" title="Share of bad frames in each 10 s bin">{Math.round(binSize / framerate)} s</span>
            <canvas ref={canvasRef} className="qc-strip" style={{ width: w, height: stripH }}
                    onMouseMove={(e) => { const h = at(e); setHover(h && { ...h, x: h.x + left, y: plotH + marksH + 16 + h.y, strip: true }); }}
                    onMouseLeave={() => setHover(null)}
                    onClick={(e) => { const h = at(e); if (h) onOpenFrame(chunks[h.i].chunk * chunksize + h.bin * binSize); }} />
          </div>
        </>
      )}
      {hovered && (
        <div className="eth-tooltip qc-tooltip" style={{ left: Math.min(hover.x + 12, width - 270), top: hover.y + 12 }}>
          <b>Chunk {hovered.chunk}</b>
          {hover.strip && hovered.bins[hover.bin] != null && (
            <> · {fmtDuration((hover.bin * binSize) / framerate)}–{fmtDuration(((hover.bin + 1) * binSize) / framerate)}: <b>{hovered.bins[hover.bin]}%</b> bad</>
          )}
          <div>{fmtPct(pct(hovered.ok, hovered.frames))} ok of {fmt(hovered.frames)} frames</div>
          {REASONS.map(([key, label]) => hovered[key] > 0 && (
            <div key={key}><span className={`qc-swatch qc-${key}`} />{label}: {fmt(hovered[key])}</div>
          ))}
          <div>Flies identified on its first / last frame: {hovered.first} / {hovered.last} of {n}</div>
          {hovered.concatenation?.broken > 0 && <div className="qc-bad-text">Concatenation broken ({hovered.concatenation.broken} of {hovered.concatenation.rows})</div>}
          {hovered.concatenation == null && <div className="qc-bad-text">No concatenation rows</div>}
          <div className="qc-hint">Click: open {hover.strip ? 'this bin' : hovered.first_bad != null ? 'its first bad frame' : 'it'} in the Group viewer</div>
        </div>
      )}
    </div>
  );
}

function Histogram({ result }) {
  const { hist, totals, n_animals: n } = result;
  const max = Math.max(...hist, 1);
  return (
    <table className="qc-hist">
      <tbody>
        {hist.map((count, k) => (
          <tr key={k} title={`${fmt(count)} frames with ${flies(k)} identified`}>
            <td className="qc-hist-label">{k}{k === n ? ' ✓' : ''}</td>
            <td className="qc-hist-bar">
              <div className={k === n ? 'qc-ok-bar' : 'qc-bad-bar'} style={{ width: `${(100 * count) / max}%` }} />
            </td>
            <td className="qc-num">{fmt(count)}</td>
            <td className="qc-num qc-muted">{fmtPct(pct(count, totals.frames))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OpenButton({ frame, onOpenFrame }) {
  return (
    <button className="ov-link" onClick={() => onOpenFrame(frame)} title={`Open frame ${frame} in the Group viewer`}>
      <i className="fa fa-external-link" style={{ marginRight: 4 }} />{fmt(frame)}
    </button>
  );
}

function Runs({ result, onOpenFrame }) {
  const { runs, run_bins: bins, n_runs: total, framerate } = result;
  const label = (b) => (b.hi == null ? `≥ ${fmtDuration(b.lo)}` : b.lo === 0 ? `< ${fmtDuration(b.hi)}` : `${fmtDuration(b.lo)} – ${fmtDuration(b.hi)}`);
  return (
    <>
      <div className="qc-run-bins">
        {bins.map((b) => (
          <div key={b.lo} className={`qc-run-bin${b.runs ? '' : ' qc-muted'}`}>
            <div className="qc-run-bin-label">{label(b)}</div>
            <div className="qc-run-bin-value">{fmt(b.runs)}</div>
            <div className="qc-muted">{fmt(b.frames)} frames</div>
          </div>
        ))}
      </div>
      {runs.length > 0 && (
        <div className="ov-scroll qc-scroll">
          <table className="pe-table ov-table">
            <thead>
              <tr><th>First frame</th><th>Last frame</th><th>Frames</th><th>Duration</th><th>Fewest flies identified</th></tr>
            </thead>
            <tbody>
              {runs.map(([start, end, length, fewest]) => (
                <tr key={start}>
                  <td><OpenButton frame={start} onOpenFrame={onOpenFrame} /></td>
                  <td><OpenButton frame={end} onOpenFrame={onOpenFrame} /></td>
                  <td className="qc-num">{fmt(length)}</td>
                  <td className="qc-num">{fmtDuration(length / framerate)}</td>
                  <td className="qc-num">{fewest} of {result.n_animals}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > runs.length && <div className="qc-muted qc-pad">The {runs.length} longest of {fmt(total)} runs</div>}
        </div>
      )}
    </>
  );
}

function Chunks({ result, onOpenFrame }) {
  const [all, setAll] = useState(false);
  const { n_animals: n, chunksize } = result;
  const boundaryChunks = useMemo(() => new Set(result.boundaries.map((b) => b.next)), [result]);
  const shown = result.chunks.filter((c) => all || c.ok < c.frames || boundaryChunks.has(c.chunk) || c.concatenation?.broken > 0);
  const hasConcatFlags = result.chunks.some((c) => c.concatenation?.broken != null);
  return (
    <>
      <div className="toolbar qc-pad">
        <label className="field">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          Show every chunk
        </label>
        <span className="qc-muted">{shown.length} of {result.chunks.length} chunks{all ? '' : ' with problems'}</span>
      </div>
      {shown.length > 0 && (
        <div className="ov-scroll qc-scroll">
          <table className="pe-table ov-table">
            <thead>
              <tr>
                <th>Chunk</th><th>Frames</th><th>Ok</th>
                {REASONS.map(([key, label, title]) => <th key={key} title={title}><span className={`qc-swatch qc-${key}`} />{label}</th>)}
                <th title="Flies identified on the first / last frame of the chunk (the concatenation links them)">First / last frame</th>
                <th>Longest run</th>
                {hasConcatFlags && <th title="CONCATENATION rows of the chunk marked is_broken / is_inferred">Concatenation</th>}
                <th>First bad frame</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const okShare = pct(c.ok, c.frames);
                return (
                  <tr key={c.chunk}>
                    <td><button className="ov-link" onClick={() => onOpenFrame(c.chunk * chunksize)} title="Open the start of the chunk">{c.chunk}</button></td>
                    <td className="qc-num">{fmt(c.frames)}</td>
                    <td className={`qc-num ${okShare === 100 ? 'qc-ok-text' : okShare < 95 ? 'qc-bad-text' : ''}`}>{fmtPct(okShare)}</td>
                    {REASONS.map(([key]) => <td key={key} className="qc-num">{c[key] ? fmt(c[key]) : ''}</td>)}
                    <td className="qc-num">
                      <span className={c.first < n ? 'qc-bad-text' : undefined}>{c.first}</span>
                      {' / '}
                      <span className={c.last < n ? 'qc-bad-text' : undefined}>{c.last}</span>
                    </td>
                    <td className="qc-num">{c.longest_run ? fmtDuration(c.longest_run / result.framerate) : ''}</td>
                    {hasConcatFlags && (
                      <td>
                        {c.concatenation == null ? <span className="qc-bad-text">missing</span> : (
                          <>
                            {c.concatenation.broken > 0 && <span className="qc-flag qc-flag-bad">broken {c.concatenation.broken}</span>}
                            {c.concatenation.inferred > 0 && <span className="qc-flag">inferred {c.concatenation.inferred}</span>}
                          </>
                        )}
                      </td>
                    )}
                    <td>{c.first_bad != null && <OpenButton frame={c.first_bad} onOpenFrame={onOpenFrame} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function QcTab({ active, currentExperiment, useVal, onOpenFrame, onOpenPose }) {
  const { log, trackJob } = useConsole();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const loadedFor = useRef(null);   // experiment + table the shown data belongs to
  const tracked = useRef(new Set());

  const fetchData = useCallback(() => api.get('/api/qc')
    .then((r) => { const d = unwrap(r.data); setData(d); setError(null); return d; })
    .catch((err) => { setError(err.response?.data?.error || err.message); return null; }), []);

  const follow = useCallback((job) => {
    if (!job || tracked.current.has(job.id)) return;
    tracked.current.add(job.id);
    setRunning(true);
    trackJob(job)
      .then((done) => {
        if (done?.status === 'failed') log('error', `QC failed: ${done.error}`);
        return fetchData();
      })
      .finally(() => setRunning(false));
  }, [trackJob, log, fetchData]);

  const compute = useCallback(() => {
    setRunning(true);
    api.post('/api/qc')
      .then((r) => follow(unwrap(r.data)))
      .catch((err) => { setRunning(false); log('error', `Could not start the QC: ${err.response?.data?.error || err.message}`); });
  }, [follow, log]);

  // Fetch when shown, and again when the experiment or the tracking table changes;
  // compute it the first time
  useEffect(() => {
    if (!active) return;
    const key = `${currentExperiment}|${useVal}`;
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    fetchData().then((d) => {
      if (!d) return;
      if (d.job) follow(d.job);
      else if (!d.result) compute();
    });
  }, [active, currentExperiment, useVal, fetchData, follow, compute]);

  const result = data?.result;

  if (!data) {
    return (
      <div className="ov">
        <div className="card ov-controls toolbar">
          {error ? `QC not available: ${error}` : 'Loading…'}
        </div>
      </div>
    );
  }

  const { totals } = result || {};
  return (
    <div className="ov">
      <div className="card ov-controls toolbar">
        <span className="mono">{data.experiment}</span>
        <span className="ov-badge" title="Tracking table checked (the “Validated tracking” box)">{data.table}</span>
        <span className="ov-count">expecting {flies(data.n_animals)} per frame</span>
        <span className="spacer" style={{ flex: 1 }} />
        {result && <span className="ov-count" title={new Date(result.computed_at * 1000).toLocaleString()}>computed {ago(result.computed_at)}</span>}
        <button onClick={compute} disabled={running} title="Read the tracking table again (runs in the background, ~0.1 s per chunk)">
          <i className={`fa ${running ? 'fa-spinner fa-spin' : 'fa-refresh'}`} style={{ marginRight: 6 }} />
          {running ? 'Computing…' : 'Recompute'}
        </button>
      </div>

      {!result && (
        <div className="card ov-controls">
          {running ? 'Checking every frame of the tracking table… (progress in the console)' : 'No QC yet.'}
        </div>
      )}

      {result && (
        <>
          <Verdict result={result} />

          <div className="ov-stats">
            <Stat label="Frames checked" value={fmt(totals.frames)}
                  sub={`chunks ${result.first_chunk}–${result.last_chunk} · ${fmtDuration(totals.frames / result.framerate)}`} />
            <Stat label={`Tracking ${flies(result.n_animals)}`} value={fmtPct(pct(totals.ok, totals.frames))}
                  sub={`${fmt(totals.ok)} frames`} tone={totals.ok === totals.frames ? 'ok' : 'bad'} />
            {REASONS.map(([key, label, title]) => (
              <Stat key={key} label={<><span className={`qc-swatch qc-${key}`} />{label}</>}
                    value={fmt(totals[key])} sub={`${fmtPct(pct(totals[key], totals.frames))} · ${title.toLowerCase()}`} />
            ))}
            <Stat label="Chunk boundaries" value={result.boundaries.length}
                  sub="without every fly identified on the last frame of a chunk and the first of the next"
                  tone={result.boundaries.length ? 'bad' : undefined} />
          </div>

          <section className="card">
            <header className="card-header">
              <span>Bad frames per chunk</span>
              <span className="spacer" />
              <span className="qc-legend">
                {REASONS.map(([key, label]) => <span key={key}><span className={`qc-swatch qc-${key}`} />{label}</span>)}
                <span><span className="qc-mark-legend">▲</span>Boundary without every fly</span>
              </span>
            </header>
            <div className="card-body">
              <Timeline result={result} onOpenFrame={onOpenFrame} />
            </div>
          </section>

          <div className="qc-row">
            <section className="card">
              <header className="card-header"><span>Flies identified per frame</span></header>
              <div className="card-body"><Histogram result={result} /></div>
            </section>
            <section className="card">
              <header className="card-header">
                <span>Runs of bad frames</span>
                <span className="ov-count">{fmt(result.n_runs)}</span>
              </header>
              <div className="card-body"><Runs result={result} onOpenFrame={onOpenFrame} /></div>
              <CardResizer id="qc-runs" />
            </section>
          </div>

          <section className="card">
            <header className="card-header"><span>Chunks</span></header>
            <Chunks result={result} onOpenFrame={onOpenFrame} />
            <CardResizer id="qc-chunks" />
          </section>
        </>
      )}

      <div className="qc-section-title">Pose</div>
      <PoseQc active={active} currentExperiment={currentExperiment} onOpenPose={onOpenPose} />
    </div>
  );
}
