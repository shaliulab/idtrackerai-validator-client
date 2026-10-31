// GpuQueue.js  —  "GPU queue" card (/api/gpu_queue, gpu_queue.py): GPU-demanding jobs
// (imgstore-crop-arenas, sleap-train) wait until the GPU has room for their memory estimate:
// estimate ≤ total − used − reserved (running jobs' estimate − their use now) − margin.
// Shows that budget as a bar, the running jobs (GPU memory now / peak / estimate, progress),
// the queue in order with why its head waits (Run next, Cancel), jobs of these kinds started
// outside the queue, and the last finished ones. Polled every 10 s while shown; `kinds`
// limits the lists to some kinds (the budget is always the whole GPU's). Running jobs whose kind
// can pause (`pause_state` not null: imgstore-crop-arenas runs started with pause support) get
// Pause / Play: pausing lets the chunks being encoded finish and starts no new one ("pausing"
// until they are done, then "paused", which reserves no GPU memory).
import React, { useCallback, useEffect, useState } from 'react';
import api from './api';
import { useConsole } from './MessageConsole';

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);
const errorOf = (err) => err.response?.data?.error ?? err.message;
const gb = (mb) => (mb == null ? '–' : `${(mb / 1024).toFixed(1)} GB`);
function duration(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '–';
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ${m % 60} min` : `${(h / 24).toFixed(1)} d`;
}
const STATUS_CLASS = { done: 'dm-ok', failed: 'dm-bad', cancelled: 'dm-none' };

function PauseButton({ job, onToggle }) {
  if (job.pause_state == null) return null;
  const paused = job.pause_state !== 'running';
  return (
    <button onClick={() => onToggle(job, !paused)} style={{ marginRight: 4 }}
            title={paused ? 'Resume: start new chunks again'
              : 'Pause: the chunks being encoded finish, no new chunk starts until you press play'}>
      <i className={`fa ${paused ? 'fa-play' : 'fa-pause'}`} />
    </button>
  );
}

function PauseBadge({ state }) {
  if (state === 'pausing') return <span className="sc-badge" style={{ marginLeft: 6 }} title="Paused: the chunks being encoded finish, then nothing runs">pausing…</span>;
  if (state === 'paused') return <span className="sc-badge" style={{ marginLeft: 6 }} title="No chunk is being encoded; reserves no GPU memory">paused</span>;
  return null;
}

function Budget({ gpu }) {
  if (!gpu) return <div className="ov-warn">No GPU visible (nvidia-smi).</div>;
  const pct = (mb) => `${Math.max(0, (100 * mb) / gpu.total_mb).toFixed(2)}%`;
  const available = Math.max(0, gpu.available_mb);
  return (
    <div>
      <div className="gq-bar" title="GPU memory: used now · reserved for running GPU jobs · margin · available to the queue">
        <div className="gq-used" style={{ width: pct(gpu.used_mb) }} />
        <div className="gq-reserved" style={{ width: pct(gpu.reserved_mb) }} />
        <div className="gq-margin" style={{ width: pct(gpu.margin_mb) }} />
      </div>
      <div className="readout sc-small">
        <span><i className="gq-key gq-used" />Used <b>{gb(gpu.used_mb)}</b></span>
        <span><i className="gq-key gq-reserved" />Reserved <b>{gb(gpu.reserved_mb)}</b></span>
        <span><i className="gq-key gq-margin" />Margin <b>{gb(gpu.margin_mb)}</b></span>
        <span><i className="gq-key" />Available <b>{gb(available)}</b> of {gb(gpu.total_mb)}</span>
        {gpu.util != null && <span>Utilization <b>{gpu.util} %</b></span>}
      </div>
    </div>
  );
}

function Progress({ progress }) {
  if (!progress) return <span className="sc-muted">–</span>;
  const fraction = progress.total > 0 ? progress.done / progress.total : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 160 }}>
      <div className="sc-progress" style={{ flex: 1 }}><div style={{ width: `${(100 * fraction).toFixed(1)}%` }} /></div>
      <span className="mono sc-small" style={{ whiteSpace: 'nowrap' }}
            title={progress.val_loss != null ? `best val_loss ${progress.val_loss.toExponential(3)}${progress.run ? ` · ${progress.run}` : ''}` : undefined}>
        {progress.done}/{progress.total} {progress.unit}
      </span>
    </div>
  );
}

export default function GpuQueueCard({ active, kinds: only }) {
  const { log } = useConsole();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [showDone, setShowDone] = useState(false);

  const fetchQueue = useCallback(async () => {
    try {
      setData(unwrap((await api.get('/api/gpu_queue')).data));
      setError(null);
    } catch (err) {
      setError(errorOf(err));
    }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    fetchQueue();
    const timer = setInterval(fetchQueue, 10000);
    return () => clearInterval(timer);
  }, [active, fetchQueue]);

  const act = async (entry, action) => {
    const label = data.kinds[entry.kind]?.label || entry.kind;
    if (action === 'cancel' && !window.confirm(entry.status === 'running'
      ? `Stop ${label} on ${entry.what}?` : `Take ${label} on ${entry.what} out of the queue?`)) return;
    try {
      await api.post(`/api/gpu_queue/${entry.id}/${action}`);
      log('info', `${label} on ${entry.what}: ${action === 'front' ? 'runs next' : entry.status === 'running' ? 'stopped' : 'taken out of the queue'}`);
      setTimeout(fetchQueue, 800);
    } catch (err) {
      log('error', `GPU queue: ${errorOf(err)}`);
    }
  };

  const togglePause = async (job, paused) => {
    const id = job.id ?? `external-${job.pid}`;
    const label = data.kinds[job.kind]?.label || job.kind;
    try {
      await api.post(`/api/gpu_queue/${id}/pause`, { paused });
      log('info', `${label} on ${job.what}: ${paused ? 'pausing (the chunks being encoded finish, no new chunk starts)' : 'resumed'}`);
      setTimeout(fetchQueue, 800);
    } catch (err) {
      log('error', `GPU queue: ${errorOf(err)}`);
    }
  };

  const shown = (e) => !only || only.includes(e.kind);
  const entries = (data?.entries || []).filter(shown);
  const running = entries.filter((e) => e.status === 'running');
  const queued = entries.filter((e) => e.status === 'queued');
  const finished = entries.filter((e) => ['done', 'failed', 'cancelled'].includes(e.status)).reverse();
  const external = (data?.external || []).filter(shown);
  const allQueued = (data?.entries || []).filter((e) => e.status === 'queued');
  const now = data?.now ?? Date.now() / 1000;
  const label = (kind) => data?.kinds[kind]?.label || kind;

  return (
    <section className="card">
      <div className="card-header">
        GPU queue
        <span className="spacer" />
        <span className="ov-normal">
          {queued.length > 0 && <span className="sc-badge" style={{ marginLeft: 6 }}>{queued.length} waiting</span>}
          {running.length > 0 && <span className="sc-badge sc-rec" style={{ marginLeft: 6 }}>{running.length} running</span>}
          <button style={{ marginLeft: 8 }} onClick={fetchQueue} title="Refresh (also every 10 s while shown)"><i className="fa fa-refresh" /></button>
        </span>
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {error && <div className="ov-warn">{error}</div>}
        {data && (
          <>
            <div className="sc-muted">
              A job starts when its GPU memory estimate fits in what is available: total − used now − what running GPU jobs
              may still take (their estimate − their use) − a margin. First in, first out.
              {data.kinds && ` Estimates: ${Object.values(data.kinds).map((k) => `${k.label} ${gb(k.estimate_mb)}${k.max_running ? ` (≤ ${k.max_running} at once)` : ''}`).join(', ')}.`}
              {!data.scheduling && ' Another server instance starts the jobs.'}
            </div>
            <Budget gpu={data.gpu} />
            {data.ticked && now - data.ticked > 60 && (
              <div className="ov-warn">Not updated for {duration(now - data.ticked)}: no server is running the queue, nothing starts.</div>
            )}

            {(running.length > 0 || external.length > 0) && (
              <table className="ov-table">
                <thead><tr><th>Running</th><th>On</th><th>Progress</th><th>For</th><th title="GPU memory of its processes now / peak / estimate">GPU memory</th><th /></tr></thead>
                <tbody>
                  {running.map((e) => (
                    <tr key={e.id}>
                      <td className="mono">{label(e.kind)}</td>
                      <td className="mono">{e.what}</td>
                      <td><Progress progress={e.progress} /><PauseBadge state={e.pause_state} /></td>
                      <td title={`Started ${new Date(e.started * 1000).toLocaleString()} · pid ${e.pid} · log ${e.log}`}>{duration(now - e.started)}</td>
                      <td className="mono sc-small">{gb(e.mem_mb)} / {gb(e.peak_mb)} / {gb(e.estimate_mb)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <PauseButton job={e} onToggle={togglePause} />
                        <button onClick={() => act(e, 'cancel')} title="Stop"><i className="fa fa-stop" /></button>
                      </td>
                    </tr>
                  ))}
                  {external.map((e) => (
                    <tr key={`x${e.pid}`} title="Started outside the queue: counted in the budget">
                      <td className="mono">{label(e.kind)} <span className="sc-muted">(outside the queue)</span></td>
                      <td className="mono">{e.what}</td>
                      <td className="sc-muted">–<PauseBadge state={e.pause_state} /></td>
                      <td>{duration(now - e.started)}</td>
                      <td className="mono sc-small">{gb(e.mem_mb)}</td>
                      <td><PauseButton job={e} onToggle={togglePause} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {queued.length > 0 ? (
              <table className="ov-table">
                <thead><tr><th>#</th><th>Waiting</th><th>On</th><th>Queued</th><th>Estimate</th><th>Why it waits</th><th /></tr></thead>
                <tbody>
                  {queued.map((e) => {
                    const position = allQueued.indexOf(e);
                    return (
                      <tr key={e.id}>
                        <td>{position + 1}</td>
                        <td className="mono">{label(e.kind)}</td>
                        <td className="mono">{e.what}</td>
                        <td title={new Date(e.submitted * 1000).toLocaleString()}>{duration(now - e.submitted)} ago</td>
                        <td className="mono sc-small">{gb(e.estimate_mb)}</td>
                        <td className="sc-small">{position === 0 ? (data.blocked || 'Starting…') : 'Waits for the jobs ahead'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {position > 0 && <button onClick={() => act(e, 'front')} title="Move to the head of the queue">Run next</button>}
                          <button style={{ marginLeft: 4 }} onClick={() => act(e, 'cancel')} title="Take out of the queue"><i className="fa fa-times" /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <div className="sc-muted">Nothing waiting.</div>}

            {finished.length > 0 && (
              <div>
                <button className="ov-more" style={{ border: 'none', padding: 0, background: 'none' }} onClick={() => setShowDone((v) => !v)}>
                  {showDone ? '▾' : '▸'} {finished.length} finished
                </button>
                {showDone && (
                  <table className="ov-table">
                    <thead><tr><th>Job</th><th>On</th><th>Ended</th><th>Ran</th><th>Peak GPU memory</th><th>Result</th></tr></thead>
                    <tbody>
                      {finished.map((e) => (
                        <tr key={e.id}>
                          <td className="mono">{label(e.kind)}</td>
                          <td className="mono">{e.what}</td>
                          <td>{e.ended ? new Date(e.ended * 1000).toLocaleString() : '–'}</td>
                          <td>{e.started ? duration(e.ended - e.started) : '–'}</td>
                          <td className="mono sc-small">{gb(e.peak_mb)}</td>
                          <td title={e.error || e.log}>
                            <span className={`dm-status ${STATUS_CLASS[e.status]}`}>{e.status}</span>
                            {e.exit_code != null && e.exit_code !== 0 ? ` exit code ${e.exit_code}` : ''}{e.error ? ` ${e.error}` : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
