// PoseQc.js  —  pose quality of every fly of the loaded experiment (QC tab)
//
// Reads /api/pose/qc (idtrackerai_validator_server/pose.py), computed by a background
// job (one item per fly) the first time the QC tab is shown, then kept by the server
// until the fly's pose file changes. Per frame: body parts detected (of the scored
// ones, leg joints left out), their mean confidence and the pose score (SLEAP's
// instance score, the sum of the confidences, divided by the number of parts). Charts
// show per-chunk means with a 10 s strip below; everything opens the Pose tab there.

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import api from './api';
import CardResizer from './CardResizer';
import { useConsole } from './MessageConsole';
import { useElementSize } from './layout';

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);
const fmt = (n) => (n == null ? '' : n.toLocaleString());
const fmtPct = (p) => (p == null ? '' : p === 0 ? '0%' : p < 0.1 ? '<0.1%' : p > 99.9 && p < 100 ? '>99.9%' : `${p.toFixed(1)}%`);
const pct = (a, b) => (b ? (100 * a) / b : 0);
const fix = (v, d = 2) => (v == null ? '–' : v.toFixed(d));
const shortFly = (fly) => `fly ${fly.split('__').pop()}`;

// Sequential blue ramp (light = low), poor bins in the critical status colour
const RAMP = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281'];
const ramp = (t) => RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.round(t * (RAMP.length - 1))))];
const POOR = '#d03b3b';

export const METRICS = [
  { key: 'n_detected', label: 'Body parts detected', unit: 'parts', max: (r) => r.scored.length, digits: 1,
    title: 'Mean number of scored body parts SLEAP found per frame' },
  { key: 'confidence', label: 'Confidence of the detected parts', max: () => 1, digits: 2,
    title: 'Mean confidence of the body parts found in a frame (SLEAP keeps peaks ≥ 0.2)' },
  { key: 'score', label: 'Pose score', max: () => 1, digits: 2, low: true,
    title: 'Sum of the confidences of the detected parts / number of scored parts (SLEAP instance score, normalized)' },
];

// One metric: per-chunk mean bars, 10 s bins strip below (poor bins in red for the score)
function MetricTimeline({ result, metric, onOpen }) {
  const [el, setEl] = useState(null);
  const { width } = useElementSize(el);
  const [hover, setHover] = useState(null);
  const canvasRef = useRef(null);
  const { chunks, bins_per_chunk: perChunk, bin_size: binSize, chunksize, low_score: low } = result;
  const max = metric.max(result);
  const plotH = 70;
  const stripH = 14;
  const left = 34;
  const w = Math.max(0, width - left);
  const step = chunks.length ? w / chunks.length : 0;
  const gap = step > 4 ? 1 : 0;
  const y = (v) => plotH - (plotH * Math.min(v, max)) / max;

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
      c.bins[metric.key].forEach((v, j) => {
        if (v == null) return;
        ctx.fillStyle = metric.low && v < low ? POOR : ramp(v / max);
        ctx.fillRect(i * step + j * binW, 0, Math.max(binW, 0.5), stripH);
      });
    });
  }, [chunks, w, step, perChunk, metric, max, low]);

  const at = (e, strip) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - (strip ? 0 : left);
    const i = Math.floor(x / step);
    if (i < 0 || i >= chunks.length) return null;
    return { i, x: x + left, y: e.clientY - rect.top + (strip ? plotH + 4 : 0), strip,
             bin: Math.min(perChunk - 1, Math.floor(((x - i * step) / step) * perChunk)) };
  };
  const hovered = hover ? chunks[hover.i] : null;
  const ticks = useMemo(() => {
    if (!chunks.length || !step) return [];
    const every = Math.max(1, Math.ceil(50 / step / 10) * 10);
    return chunks.filter((c) => c.chunk % every === 0).map((c) => c.chunk);
  }, [chunks, step]);
  const binValue = hovered && hover.strip ? hovered.bins[metric.key][hover.bin] : null;

  return (
    <div className="qc-timeline pose-metric" ref={setEl}>
      <div className="pose-metric-title" title={metric.title}>{metric.label}</div>
      {w > 0 && (
        <>
          <svg width={width} height={plotH + 14} className="qc-svg"
               onMouseMove={(e) => setHover(at(e, false))} onMouseLeave={() => setHover(null)}
               onClick={() => hovered && onOpen(hovered.chunk * chunksize)}>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={left} x2={width} y1={y(f * max)} y2={y(f * max)} className="qc-grid" />
                <text x={left - 4} y={y(f * max) + 4} className="qc-axis" textAnchor="end">{metric.digits === 1 ? Math.round(f * max) : f.toFixed(1)}</text>
              </g>
            ))}
            {metric.low && <line x1={left} x2={width} y1={y(low)} y2={y(low)} className="pose-low-line" />}
            {chunks.map((c, i) => {
              const v = c[metric.key];
              const x = left + i * step;
              return (
                <g key={c.chunk} className={hover?.i === i ? 'qc-hovered' : undefined}>
                  <rect x={x} y={0} width={step} height={plotH} className="qc-hit" />
                  {v != null && <rect x={x + gap / 2} y={y(v)} width={Math.max(step - gap, 0.6)} height={Math.max(plotH - y(v), 0.8)}
                                      className={metric.low && v < low ? 'pose-bar-poor' : 'pose-bar'} />}
                </g>
              );
            })}
            {ticks.map((chunk) => (
              <text key={chunk} x={left + (chunk - chunks[0].chunk) * step} y={plotH + 12} className="qc-axis" textAnchor="middle">{chunk}</text>
            ))}
          </svg>
          <div className="qc-strip-row">
            <span className="qc-strip-label" title={`Mean of each ${Math.round(binSize / result.framerate)} s bin`}>{Math.round(binSize / result.framerate)} s</span>
            <canvas ref={canvasRef} className="qc-strip" style={{ width: w, height: stripH }}
                    onMouseMove={(e) => setHover(at(e, true))} onMouseLeave={() => setHover(null)}
                    onClick={(e) => { const h = at(e, true); if (h) onOpen(chunks[h.i].chunk * chunksize + h.bin * binSize); }} />
          </div>
        </>
      )}
      {hovered && (
        <div className="eth-tooltip qc-tooltip" style={{ left: Math.min(hover.x + 12, width - 260), top: hover.y + 30 }}>
          <b>Chunk {hovered.chunk}</b>
          {binValue != null && <> · bin {hover.bin + 1}: <b>{fix(binValue, metric.digits)}</b></>}
          <div>{metric.label}: <b>{fix(hovered[metric.key], metric.digits)}</b>{metric.unit ? ` of ${max} ${metric.unit}` : ''}</div>
          {metric.low && <div>Pose score 10th percentile: {fix(hovered.score_p10)}</div>}
          <div>Poor frames (score &lt; {low}): {fmtPct(pct(hovered.low, hovered.frames - hovered.missing))}</div>
          {hovered.missing > 0 && <div className="qc-bad-text">{fmt(hovered.missing)} frames without pose</div>}
          <div className="qc-hint">Click: open {hover.strip ? 'this bin' : 'the chunk'} in the Pose tab</div>
        </div>
      )}
    </div>
  );
}

// Body part × chunk: % of frames where the part is detected
function NodeHeatmap({ result, onOpen }) {
  const [el, setEl] = useState(null);
  const { width } = useElementSize(el);
  const [hover, setHover] = useState(null);
  const canvasRef = useRef(null);
  const { chunks, nodes, scored, chunksize } = result;
  const rowH = 12;
  const left = 70;
  const w = Math.max(0, width - left);
  const step = chunks.length ? w / chunks.length : 0;
  const h = nodes.length * rowH;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !w) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    chunks.forEach((c, i) => {
      c.nodes.detected.forEach((v, k) => {
        if (v == null) return;
        ctx.fillStyle = ramp(v / 100);
        ctx.fillRect(i * step, k * rowH, Math.max(step, 0.5), rowH - 1);
      });
    });
  }, [chunks, w, h, step]);

  const at = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const i = Math.floor(x / step);
    const k = Math.floor((e.clientY - rect.top) / rowH);
    if (i < 0 || i >= chunks.length || k < 0 || k >= nodes.length) return null;
    return { i, k, x: x + left, y: e.clientY - rect.top };
  };
  const c = hover ? chunks[hover.i] : null;

  return (
    <div className="qc-timeline" ref={setEl}>
      <div className="pose-heat">
        <div className="pose-heat-labels" style={{ width: left }}>
          {nodes.map((name) => (
            <div key={name} style={{ height: rowH }} className={scored.includes(name) ? undefined : 'qc-muted'}
                 title={scored.includes(name) ? 'Counted in the pose score' : 'Not counted in the pose score'}>{name}</div>
          ))}
        </div>
        {w > 0 && <canvas ref={canvasRef} className="qc-strip" style={{ width: w, height: h }}
                          onMouseMove={(e) => setHover(at(e))} onMouseLeave={() => setHover(null)}
                          onClick={(e) => { const p = at(e); if (p) onOpen(chunks[p.i].chunk * chunksize); }} />}
      </div>
      <div className="pose-heat-scale">
        <span>0%</span>{RAMP.map((color) => <span key={color} style={{ background: color }} className="pose-heat-step" />)}<span>100% of frames detected</span>
      </div>
      {c && (
        <div className="eth-tooltip qc-tooltip" style={{ left: Math.min(hover.x + 12, width - 240), top: hover.y + 12 }}>
          <b>{nodes[hover.k]}</b> · chunk {c.chunk}
          <div>Detected in {fmtPct(c.nodes.detected[hover.k])} of frames</div>
          <div>Mean confidence when detected: {fix(c.nodes.confidence[hover.k])}</div>
          <div className="qc-hint">Click: open the chunk in the Pose tab</div>
        </div>
      )}
    </div>
  );
}

function Bars({ rows }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  const total = rows.reduce((a, r) => a + r.count, 0);
  return (
    <table className="qc-hist">
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} title={`${fmt(r.count)} frames`}>
            <td className="qc-hist-label">{r.label}</td>
            <td className="qc-hist-bar"><div className={r.poor ? 'qc-bad-bar' : 'pose-hist-bar'} style={{ width: `${(100 * r.count) / max}%` }} /></td>
            <td className="qc-num">{fmt(r.count)}</td>
            <td className="qc-num qc-muted">{fmtPct(pct(r.count, total))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FlyPoseQc({ result, onOpen }) {
  const { totals, mean } = result;
  const valid = totals.frames - totals.missing;
  const n = result.scored.length;
  const scoreRows = result.score_hist.map((count, k) => {
    const lo = k / result.score_hist.length;
    return { label: k === result.score_hist.length - 1 ? `≥${lo.toFixed(2)}` : lo.toFixed(2), count, poor: lo < result.low_score };
  }).reverse();
  return (
    <>
      <div className="ov-stats">
        <div className="card ov-stat">
          <div className="ov-stat-label">Body parts detected</div>
          <div className="ov-stat-value">{fix(mean.n_detected, 1)} <span className="qc-muted">of {n}</span></div>
          <div className="ov-stat-sub">all {n} in {fmtPct(pct(totals.complete, valid))} of frames</div>
        </div>
        <div className="card ov-stat">
          <div className="ov-stat-label">Confidence</div>
          <div className="ov-stat-value">{fix(mean.confidence)}</div>
          <div className="ov-stat-sub">mean of the detected parts</div>
        </div>
        <div className="card ov-stat">
          <div className="ov-stat-label">Pose score</div>
          <div className="ov-stat-value">{fix(mean.score)}</div>
          <div className="ov-stat-sub">Σ confidence / {n} parts</div>
        </div>
        <div className={`card ov-stat${totals.low ? ' qc-tone-bad' : ' qc-tone-ok'}`}>
          <div className="ov-stat-label">Poor frames</div>
          <div className="ov-stat-value">{fmtPct(pct(totals.low, valid))}</div>
          <div className="ov-stat-sub">{fmt(totals.low)} with score &lt; {result.low_score}</div>
        </div>
        <div className={`card ov-stat${totals.missing || totals.empty ? ' qc-tone-bad' : ''}`}>
          <div className="ov-stat-label">Without pose</div>
          <div className="ov-stat-value">{fmt(totals.missing + totals.empty)}</div>
          <div className="ov-stat-sub">{fmt(totals.missing)} not in the pose file · {fmt(totals.empty)} no part found</div>
        </div>
      </div>

      <section className="card">
        <header className="card-header">
          <span>Pose quality per chunk</span>
          <span className="spacer" />
          <span className="qc-legend">
            <span><span className="qc-swatch pose-swatch" />Mean per chunk</span>
            <span><span className="qc-swatch" style={{ background: POOR }} />Pose score &lt; {result.low_score}</span>
          </span>
        </header>
        <div className="card-body">
          {METRICS.map((m) => <MetricTimeline key={m.key} result={result} metric={m} onOpen={onOpen} />)}
        </div>
      </section>

      <section className="card">
        <header className="card-header"><span>Body parts detected per chunk</span></header>
        <div className="card-body"><NodeHeatmap result={result} onOpen={onOpen} /></div>
      </section>

      <div className="qc-row pose-row">
        <section className="card">
          <header className="card-header"><span>Body parts detected per frame</span></header>
          <div className="card-body">
            <Bars rows={result.hist.map((count, k) => ({ label: `${k}${k === n ? ' ✓' : ''}`, count })).reverse()} />
          </div>
        </section>
        <section className="card">
          <header className="card-header"><span>Pose score per frame</span></header>
          <div className="card-body"><Bars rows={scoreRows} /></div>
        </section>
        <section className="card">
          <header className="card-header"><span>Body parts</span></header>
          <div className="ov-scroll qc-scroll">
            <table className="pe-table ov-table">
              <thead><tr><th>Body part</th><th>Detected</th><th>Confidence</th></tr></thead>
              <tbody>
                {result.nodes.map((name, k) => (
                  <tr key={name} className={result.scored.includes(name) ? undefined : 'qc-muted'}>
                    <td>{name}</td>
                    <td className="qc-num">{fmtPct(result.node_totals.detected[k])}</td>
                    <td className="qc-num">{fix(result.node_totals.confidence[k])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CardResizer id="pose-qc-nodes" />
        </section>
      </div>

      <section className="card">
        <header className="card-header">
          <span>Worst {Math.round(result.bin_size / result.framerate)} s bins</span>
          <span className="ov-count">lowest mean pose score</span>
        </header>
        <div className="ov-scroll qc-scroll">
          <table className="pe-table ov-table">
            <thead><tr><th>First frame</th><th>Chunk</th><th>Mean pose score</th></tr></thead>
            <tbody>
              {result.worst_bins.map(([frame, score]) => (
                <tr key={frame}>
                  <td>
                    <button className="ov-link" onClick={() => onOpen(frame)} title={`Open frame ${frame} in the Pose tab`}>
                      <i className="fa fa-external-link" style={{ marginRight: 4 }} />{fmt(frame)}
                    </button>
                  </td>
                  <td className="qc-num">{Math.floor(frame / result.chunksize)}</td>
                  <td className="qc-num">{fix(score)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <CardResizer id="pose-qc-worst" />
      </section>
    </>
  );
}

export default function PoseQc({ active, currentExperiment, onOpenPose }) {
  const { log, trackJob } = useConsole();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState(null);
  const loadedFor = useRef(null);
  const tracked = useRef(new Set());

  const fetchData = useCallback(() => api.get('/api/pose/qc')
    .then((r) => { const d = unwrap(r.data); setData(d); setError(null); return d; })
    .catch((err) => { setError(err.response?.data?.error || err.message); return null; }), []);

  const follow = useCallback((job) => {
    if (!job || tracked.current.has(job.id)) return;
    tracked.current.add(job.id);
    setRunning(true);
    trackJob(job)
      .then((done) => {
        if (done?.status === 'failed') log('error', `Pose QC failed: ${done.error}`);
        return fetchData();
      })
      .finally(() => setRunning(false));
  }, [trackJob, log, fetchData]);

  const compute = useCallback(() => {
    setRunning(true);
    api.post('/api/pose/qc')
      .then((r) => follow(unwrap(r.data)))
      .catch((err) => { setRunning(false); log('error', `Could not start the pose QC: ${err.response?.data?.error || err.message}`); });
  }, [follow, log]);

  // Fetch when shown and when the experiment changes; compute it the first time for
  // the flies whose pose file exists (missing ones are compiled only on request)
  useEffect(() => {
    if (!active || loadedFor.current === currentExperiment) return;
    loadedFor.current = currentExperiment;
    setSelected(null);
    fetchData().then((d) => {
      if (!d) return;
      if (d.job) follow(d.job);
      else if (d.flies.some((f) => f.available && !f.result)) compute();
    });
  }, [active, currentExperiment, fetchData, follow, compute]);

  const flies = data?.flies || [];
  const shown = flies.find((f) => f.fly === selected && f.result) || flies.find((f) => f.result);

  return (
    <>
      <section className="card">
        <header className="card-header">
          <span>Pose quality per fly</span>
          <span className="spacer" />
          <button onClick={compute} disabled={running || !data}
                  title="Read every fly's pose file again (runs in the background, ~20 s per fly; missing pose files are compiled from the chunks first, minutes)">
            <i className={`fa ${running ? 'fa-spinner fa-spin' : 'fa-refresh'}`} style={{ marginRight: 6 }} />
            {running ? 'Computing…' : 'Recompute pose QC'}
          </button>
        </header>
        {error && <div className="qc-pad">Pose QC not available: {error}</div>}
        {flies.length > 0 && (
          <div className="ov-scroll">
            <table className="pe-table ov-table pose-flies">
              <thead>
                <tr>
                  <th>Fly</th><th>Chunks</th><th>Frames</th><th title="Mean body parts detected per frame">Parts detected</th>
                  <th title="Mean confidence of the detected body parts">Confidence</th><th title="Mean pose score">Pose score</th>
                  <th title="Frames with pose score below the threshold">Poor frames</th><th>Without pose</th><th />
                </tr>
              </thead>
              <tbody>
                {flies.map((f) => {
                  const r = f.result;
                  const valid = r ? r.totals.frames - r.totals.missing : 0;
                  return (
                    <tr key={f.fly} className={shown?.fly === f.fly ? 'pose-selected' : undefined}
                        onClick={() => r && setSelected(f.fly)} style={{ cursor: r ? 'pointer' : undefined }}>
                      <td className="mono">{shortFly(f.fly)}</td>
                      {r ? (
                        <>
                          <td className="qc-num">{r.first_chunk}–{r.last_chunk}</td>
                          <td className="qc-num">{fmt(r.totals.frames)}</td>
                          <td className="qc-num">{fix(r.mean.n_detected, 1)} / {r.scored.length}</td>
                          <td className="qc-num">{fix(r.mean.confidence)}</td>
                          <td className="qc-num">{fix(r.mean.score)}</td>
                          <td className="qc-num">{fmtPct(pct(r.totals.low, valid))}</td>
                          <td className={`qc-num${r.totals.missing + r.totals.empty ? ' qc-bad-text' : ''}`}>{fmt(r.totals.missing + r.totals.empty)}</td>
                        </>
                      ) : (
                        <td colSpan={7} className="qc-muted">
                          {f.available ? (running ? 'computing…' : 'not computed yet') : 'no pose file (Recompute compiles it from the chunks)'}
                        </td>
                      )}
                      <td>
                        <button className="ov-link" onClick={(e) => { e.stopPropagation(); onOpenPose(f.fly, null); }}
                                disabled={!f.available} title="Open this fly in the Pose tab">Pose tab</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {shown && (
        <>
          <div className="pose-qc-title">{shortFly(shown.fly)} <span className="qc-muted">{shown.fly}</span></div>
          <FlyPoseQc result={shown.result} onOpen={(frame) => onOpenPose(shown.fly, frame)} />
        </>
      )}
    </>
  );
}
