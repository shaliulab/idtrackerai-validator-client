// MonitorTab.js  —  what the nextflow pipelines of this computer are doing
//
// One card per pipeline (idtrackerai, pose estimation, behavior prediction) from
// /api/monitor (idtrackerai_validator_server/monitor.py): the nextflow run going on in
// its folder (tasks per process, per experiment, the tasks running now, failures), the
// rows of its CSV being processed and those waiting in the queue (marked 1, picked up
// by run_queue.sh when the run ends), the last batches and the end of run_queue.log.
// "Relaunch failed tasks" (RelaunchFailed) lists, per batch, the failed tasks whose rows
// were not re-queued since, why they failed, a Re-queue button (POST
// /api/monitor/<pipeline>/requeue: marks their rows 1 again for run_queue.sh) and the
// command running the batch again by hand.
// Refreshed every REFRESH_MS while the tab is shown and "Auto refresh" is ticked.

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from './api';
import { useConsole } from './MessageConsole';
import { copyText } from './utils';

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);
const REFRESH_MS = 10000;
const AUTO_KEY = 'fh-monitor-auto';

const duration = (seconds) => {
  if (seconds == null || seconds < 0) return '';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`;
  return `${Math.floor(seconds / 86400)} d ${Math.round((seconds % 86400) / 3600)} h`;
};
const clock = (t) => (t ? new Date(t * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

const SEGMENTS = [
  ['completed', 'done'],
  ['cached', 'cached'],
  ['running', 'running'],
  ['failed', 'failed'],
];

function TaskBar({ counts, width = 160 }) {
  const total = SEGMENTS.reduce((acc, [k]) => acc + (counts[k] || 0), 0);
  return (
    <span className="mon-bar" style={{ width }}
          title={SEGMENTS.filter(([k]) => counts[k]).map(([k, l]) => `${counts[k]} ${l}`).join(', ') || 'no tasks'}>
      {total > 0 && SEGMENTS.map(([k]) => (counts[k] ? (
        <span key={k} className={`mon-seg mon-${k}`} style={{ width: `${(100 * counts[k]) / total}%` }} />
      ) : null))}
    </span>
  );
}

function Counts({ counts }) {
  return (
    <span className="mon-counts">
      {SEGMENTS.filter(([k]) => counts[k]).map(([k, l]) => (
        <span key={k} className={`mon-count-${k}`}>{counts[k]} {l}</span>
      ))}
    </span>
  );
}

function StateBadge({ p }) {
  if (p.error) return <span className="dm-status dm-bad">error</span>;
  if (p.running) return <span className="dm-status mon-running-badge"><i className="fa fa-circle-o-notch fa-spin" /> running</span>;
  if (p.queued.length && p.has_queue && !p.queue_runner?.pids.length) return <span className="dm-status dm-warn">queue stopped</span>;
  return <span className="dm-status dm-none">idle</span>;
}

// rows of the CSV, one line per experiment (per-fly pipelines list the identities)
function groupRows(rows) {
  const groups = new Map();
  rows.forEach((r) => {
    if (!groups.has(r.experiment)) groups.set(r.experiment, { ...r, identities: [], flies: [], lines: [], unstamped: false });
    const g = groups.get(r.experiment);
    if (r.identity != null) g.identities.push(r.identity);
    if (r.fly) g.flies.push(r);
    g.lines.push(r.line);
    g.unstamped = g.unstamped || r.unstamped;
  });
  return [...groups.values()];
}

// behavior_prediction: state of a fly from its outputs on disk (monitor.fly_outputs)
const FLY_STATE = {
  done: { label: 'done', cls: 'mon-fly-done', title: 'Ethogram figure and sleep written by this batch: the fly went through the whole pipeline' },
  explorable: { label: 'explorable', cls: 'mon-fly-explorable',
    title: 'Behavior predictions written by this batch: the Ethograms tab shows them. The ethogram figure and sleep are still to come' },
  pending: { label: 'pending', cls: 'mon-fly-pending', title: 'No behavior predictions from this batch yet' },
};

function stageTitle(stage, o, meta, now) {
  const what = meta?.description ?? stage;
  if (!o) return `${what}: missing`;
  return `${what}: ${o.new ? 'written by this batch' : 'older output'}, ${clock(o.mtime)} (${duration(now - o.mtime)} ago)`;
}

function FlyLine({ f, meta, now, queued, onOpenFly }) {
  const state = FLY_STATE[f.state];
  return (
    <div className="mon-fly">
      <span className="mono mon-fly-id">{f.identity}</span>
      {!queued && <span className={`mon-fly-state ${state.cls}`} title={state.title}>{state.label}</span>}
      <span className="mon-stages">
        {(meta ? meta.map((m) => m.stage) : Object.keys(f.outputs)).map((stage) => {
          const o = f.outputs[stage];
          const m = meta?.find((x) => x.stage === stage);
          return (
            <span key={stage} className={`mon-stage${o ? (o.new ? ' new' : ' old') : ''}`}
                  title={stageTitle(stage, o, m, now)}>{stage}</span>
          );
        })}
      </span>
      <button className="mon-fly-btn" disabled={!f.outputs.behavior && !f.outputs.ethogram}
              onClick={() => onOpenFly(f.experiment, f.fly, 'ethogram')}
              title={f.outputs.behavior || f.outputs.ethogram
                ? `Load ${f.experiment} and show ${f.fly} in the Ethograms tab`
                  + (f.outputs.behavior && !f.outputs.behavior.new && !queued ? ' (older predictions: this batch has not written its own yet)' : '')
                : 'No behavior predictions yet'}>
        <i className="fa fa-bar-chart" /> Ethogram
      </button>
      <button className="mon-fly-btn" disabled={!f.outputs.pose}
              onClick={() => onOpenFly(f.experiment, f.fly, 'pose')}
              title={f.outputs.pose ? `Load ${f.experiment} and show ${f.fly} in the Pose tab` : 'No compiled pose yet'}>
        Pose
      </button>
    </div>
  );
}

function RowsTable({ rows, perFly, run, now, onOpenExperiment, onOpenFly, flyMeta, queued, emptyText }) {
  const groups = useMemo(() => groupRows(rows), [rows]);
  if (!groups.length) return <div className="ov-note">{emptyText}</div>;
  const withTasks = !!run?.experiments;
  return (
    <table className="pe-table ov-table mon-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Experiment</th>
          {perFly && <th>Flies</th>}
          {withTasks && <th>Tasks</th>}
          {withTasks && <th />}
          {withTasks && <th>Running now</th>}
          <th>Note</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {groups.map((g, i) => {
          const e = run?.experiments?.[g.experiment];
          const running = (run?.running_tasks || []).filter((t) => t.experiment === g.experiment);
          const done = run?.completed?.includes(g.experiment);
          return (
            <tr key={g.experiment}>
              <td className="mon-dim">{i + 1}</td>
              <td className="mono" title={`${g.basedir}\nline ${g.lines.join(', ')} of the CSV`}>
                {g.experiment}
                {g.unstamped && (
                  <span className="dm-problem-badge"
                        title={'Processed by this run, but its row is still marked 1 (the batch stamp was lost, e.g. the CSV was saved '
                          + 'over by an editor). run_queue.sh will run it again in its next round (cached with -resume).'}>
                    still marked 1
                  </span>
                )}
                {done && <span className="ov-badge" title="Listed in completed/<batch>.txt: every chunk went through the pipeline">complete</span>}
              </td>
              {perFly && (
                <td>
                  {g.flies.length
                    ? g.flies.map((f) => <FlyLine key={f.fly} f={f} meta={flyMeta} now={now} queued={queued} onOpenFly={onOpenFly} />)
                    : <span className="mono">{g.identities.join(' ')}</span>}
                </td>
              )}
              {withTasks && <td>{e ? <TaskBar counts={e.summary} width={120} /> : <span className="mon-dim">no task yet</span>}</td>}
              {withTasks && <td>{e && <Counts counts={e.summary} />}</td>}
              {withTasks && (
                <td className="mon-running">
                  {[...new Set(running.map((t) => t.process))].map((proc) => {
                    const ts = running.filter((t) => t.process === proc);
                    const ages = ts.map((t) => now - t.submitted);
                    return (
                      <div key={proc} title={ts.map((t) => `${t.name} [${t.hash}] ${duration(now - t.submitted)}`).join('\n')}>
                        {proc.split(':').pop()}{ts.length > 1 ? ` ×${ts.length}` : ''}{' '}
                        <span className="mon-dim">
                          {ts.length > 1 ? `${duration(Math.min(...ages))}–${duration(Math.max(...ages))}` : duration(ages[0])}
                        </span>
                      </div>
                    );
                  })}
                </td>
              )}
              <td className="ov-wrap mon-dim">{g.note}</td>
              <td className="ov-actions">
                <button onClick={() => onOpenExperiment(g.experiment)} title="Load this experiment in the viewer">Open</button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CopyCommand({ command }) {
  const { log } = useConsole();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await copyText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      log('warning', `Could not copy: ${err.message}; select the command instead`);
    }
  };
  return (
    <div className="mon-command">
      <pre className="mono">{command}</pre>
      <button onClick={copy} title="Copy to the clipboard">{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

// Failed tasks still to be finished and how to run them again (monitor.relaunch_info).
function RelaunchFailed({ p, relaunch, now, onChanged }) {
  const { log } = useConsole();
  const [open, setOpen] = useState({});      // work dir -> traceback shown
  const [armed, setArmed] = useState(false);   // same-cause warning acknowledged once
  const [busy, setBusy] = useState(false);
  const sameCause = relaunch.batches.some((b) => b.same_error);
  const requeue = async () => {
    if (sameCause && !armed) { setArmed(true); return; }
    setBusy(true);
    try {
      const { data } = await api.post(`/api/monitor/${p.id}/requeue`, {});
      const r = unwrap(data);
      log('success', `${p.label}: re-queued ${r.rows} row${r.rows === 1 ? '' : 's'} of ${r.csv} (lines ${r.lines.join(', ')})`
        + (!r.queue_running ? ': start run_queue.sh to run them'
          : r.next_check ? `: run_queue.sh takes them at its next check, ${clock(r.next_check)} (or press "Check now")`
            : ': run_queue.sh takes them when the current run ends'));
      onChanged();
    } catch (err) {
      log('error', `${p.label}: could not re-queue: ${err.response?.data?.error || err.message}`);
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };
  const csv = p.csv_path.split('/').pop();
  const runner = p.queue_runner;
  const nFlies = relaunch.batches.reduce((n, b) => n + b.flies.length, 0);
  const what = p.per_fly ? 'fl' + (nFlies === 1 ? 'y' : 'ies') : 'experiment' + (nFlies === 1 ? '' : 's');
  return (
    <div className="mon-relaunch">
      <div className="mon-relaunch-head">
        <b>Relaunch failed tasks</b> — {nFlies} {what} stopped at a failed task. nextflow ignores failures
        (<span className="mono">errorStrategy "ignore"</span>), so the run ended normally and the rest of the pipeline never
        ran for them.
      </div>
      {relaunch.batches.map((b) => (
        <div key={b.batch} className="mon-relaunch-batch">
          <div>
            Batch <b className="mono">{b.batch}</b> · run <span className="mono">{b.run_name}</span>
            {b.ended ? <> · ended {clock(b.ended)}</> : null} · {b.n_failed} failed task{b.n_failed === 1 ? '' : 's'}
          </div>
          {b.same_error && (
            <div className="banner-danger mon-relaunch-cause">
              <div>
                All of them failed with the same error. That looks like one cause: relaunching will fail the same way until it is fixed.
                <pre className="mono mon-exception">{b.same_error}</pre>
                {b.tasks[0]?.where && <div className="mono mon-dim">{b.tasks[0].where.join('  →  ')}</div>}
              </div>
            </div>
          )}
          <table className="pe-table ov-table mon-table">
            <thead><tr><th>{p.per_fly ? 'Fly' : 'Experiment'}</th><th>Failed task</th><th>Error</th></tr></thead>
            <tbody>
              {b.tasks.map((t) => (
                <tr key={t.work_dir || t.name}>
                  <td className="mono">{t.experiment ? `${t.experiment}${t.identity ? `__${t.identity}` : ''}` : <span className="mon-dim">?</span>}</td>
                  <td className="mono">{t.name} <span className="mon-dim">exit {t.exit}</span></td>
                  <td>
                    <span className="mono mon-exception">{t.exception || t.error[t.error.length - 1] || <span className="mon-dim">no output</span>}</span>
                    {t.where && <div className="mono mon-dim">{t.where[0]}</div>}
                    {t.error.length > 0 && (
                      <button className="ov-link" onClick={() => setOpen((o) => ({ ...o, [t.work_dir]: !o[t.work_dir] }))}>
                        {open[t.work_dir] ? '▾' : '▸'} end of .command.err
                      </button>
                    )}
                    {open[t.work_dir] && (
                      <>
                        <pre className="mon-log">{t.error.join('\n')}</pre>
                        <div className="mono mon-dim">{t.work_dir}</div>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {b.command && (
            <div className="mon-relaunch-option">
              <div>
                <b>Run batch {b.batch} again now</b>, resuming its nextflow session (
                <span className="mono">{b.session.slice(0, 8)}</span>): the tasks it completed are taken from the cache and
                only the failed ones and those after them run.
                {relaunch.live
                  ? <span className="ov-warn"> A run is going on in this folder: wait for it to end (two runs cannot share the folder), or re-queue instead.</span>
                  : null}
              </div>
              <CopyCommand command={b.command} />
            </div>
          )}
        </div>
      ))}
      <div className="mon-relaunch-option">
        <div className="mon-requeue">
          <button className={armed ? 'mon-requeue-armed' : ''} onClick={requeue} disabled={busy}>
            {busy ? 'Re-queueing…' : armed ? `Re-queue anyway (same error everywhere)` : `Re-queue ${nFlies === 1 ? 'it' : `the ${nFlies}`}`}
          </button>
          {armed && <button onClick={() => setArmed(false)}>Cancel</button>}
          <span>
            marks {nFlies === 1 ? 'its row' : 'their rows'} of <span className="mono">{csv}</span> 1 again (under the same
            lock as run_queue.sh), so{' '}
            {p.has_queue && runner?.pids.length
              ? (runner.next_check
                ? <>run_queue.sh takes them at its next check, {clock(runner.next_check)} (<NextCheck p={p} now={now} onChanged={onChanged} />)</>
                : 'run_queue.sh takes them when the current run ends')
              : <span className="ov-warn">run_queue.sh would take them, but it is not running (start it with <span className="mono">nohup ./run_queue.sh &gt; run_queue.log 2&gt;&amp;1 &amp;</span>)</span>}
            , as a new batch launched with <span className="mono">-resume</span>, which reuses what completed.
          </span>
        </div>
        {relaunch.requeue && (
          <details className="mon-dim">
            <summary>Same as a shell command</summary>
            <CopyCommand command={relaunch.requeue} />
          </details>
        )}
      </div>
    </div>
  );
}

// "run_queue.sh checks again at …" with a button ending its wait (POST /api/monitor/<pipeline>/check_now)
function NextCheck({ p, now, onChanged }) {
  const { log } = useConsole();
  const [busy, setBusy] = useState(false);
  const next = p.queue_runner?.next_check;
  if (!next) return null;
  const checkNow = async () => {
    setBusy(true);
    try {
      await api.post(`/api/monitor/${p.id}/check_now`);
      log('info', `${p.label}: run_queue.sh is looking at the queue now`);
      setTimeout(onChanged, 3000);
    } catch (err) {
      log('error', `${p.label}: ${err.response?.data?.error || err.message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span>
      · next check of the queue {clock(next)} ({next > now ? `in ${duration(next - now)}` : 'now'}){' '}
      <button className="ov-link" onClick={checkNow} disabled={busy}
              title="End run_queue.sh's wait between checks, so it starts the rows marked 1 now">
        {busy ? 'waking…' : 'Check now'}
      </button>
    </span>
  );
}

function Pipeline({ p, now, onOpenExperiment, onOpenFly, onChanged }) {
  const [showLog, setShowLog] = useState(false);
  const [showBatches, setShowBatches] = useState(false);
  const [showTasks, setShowTasks] = useState(false);

  if (p.error) {
    return (
      <section className="card">
        <header className="card-header"><span>{p.label}</span><StateBadge p={p} /></header>
        <div className="card-body ov-warn">{p.error}</div>
      </section>
    );
  }
  const { run } = p;
  const live = !!run?.pid;
  const runner = p.queue_runner;
  const unassigned = run?.experiments?.[''];

  return (
    <section className="card mon-card">
      <header className="card-header">
        <span>{p.label}</span>
        <StateBadge p={p} />
        {run && (
          <span className="ov-count mono" title={`nextflow ${run.args}`}>
            {run.run_name}{run.batch && run.batch !== '1' ? ` · batch ${run.batch}` : ''}
          </span>
        )}
        <span className="spacer" />
        <span className="ov-count mono" title="Pipeline folder">{p.folder}</span>
      </header>

      <div className="card-body mon-body">
        <div className="mon-meta">
          {live ? (
            <span>
              <b>Running</b> since {clock(run.started)} ({duration(now - run.started)}), pid {run.pid}
              {run.last_activity && <> · last log line {duration(now - run.last_activity)} ago</>}
            </span>
          ) : run ? (
            <span>
              Last run {clock(run.log_started || run.started)}
              {run.ended ? <> – {clock(run.ended)} ({duration(run.ended - (run.log_started || run.started))})</>
                : <> – stopped without finishing (last log line {clock(run.last_activity)})</>}
            </span>
          ) : <span>No run found</span>}
          {run && <span className="mono mon-dim" title="Command">nextflow {run.args}</span>}
          {p.runs.length > 1 && <span className="ov-warn">{p.runs.length} nextflow runs in this folder</span>}
          {run?.log_stale && <span className="ov-warn">.nextflow.log is of an older run</span>}
        </div>

        <div className="mon-meta">
          {p.has_queue ? (
            runner.pids.length
              ? <span><i className="fa fa-check mon-ok" /> run_queue.sh running (pid {runner.pids.join(', ')}): rows marked 1 start when the run ends
                  {' '}<NextCheck p={p} now={now} onChanged={onChanged} /></span>
              : <span className="ov-warn"><i className="fa fa-exclamation-triangle" /> run_queue.sh is not running: rows marked 1 wait until it is started
                  (<span className="mono">nohup ./run_queue.sh &gt; run_queue.log 2&gt;&amp;1 &amp;</span>)</span>
          ) : (
            <span className="mon-dim">No queue: the rows marked 1 in <span className="mono">{p.csv_path.split('/').pop()}</span> are
              {live ? ' the experiments of this run (as read when it started)' : ' processed by the next run started by hand'}</span>
          )}
        </div>

        {run?.processes?.length > 0 && (
          <div className="mon-processes">
            {run.processes.map((pr) => (
              <div key={pr.process} className="mon-process">
                <span className="mono mon-process-name" title={pr.process}>{pr.process.split(':').pop()}</span>
                <TaskBar counts={pr} />
                <Counts counts={pr} />
              </div>
            ))}
            <div className="mon-process mon-total">
              <span className="mon-process-name">all tasks</span>
              <TaskBar counts={run.summary} />
              <Counts counts={run.summary} />
            </div>
          </div>
        )}

        {run?.failed_tasks?.length > 0 && (
          <div className="banner-danger mon-failed">
            <div>
              <b>{run.summary.failed} failed task{run.summary.failed === 1 ? '' : 's'}</b> (ignored by nextflow: their experiment does not finish)
              <ul>
                {run.failed_tasks.map((t) => (
                  <li key={t.work_dir || t.name}><span className="mono">{t.name}</span> exit {t.exit}{' '}
                    <span className="mono mon-dim">{t.work_dir}</span></li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {p.relaunch && <RelaunchFailed p={p} relaunch={p.relaunch} now={now} onChanged={onChanged} />}
      </div>

      <h4 className="mon-h">{live ? 'In this run' : 'Last run'}<span className="ov-count"> {groupRows(live ? p.in_run : []).length || ''}</span></h4>
      {live ? (
        <RowsTable rows={p.in_run} perFly={p.per_fly} run={run} now={now} onOpenExperiment={onOpenExperiment}
                   onOpenFly={onOpenFly} flyMeta={p.fly_outputs}
                   emptyText={run?.batch === '1' ? 'Rows marked 1 when the run started' : `No row of ${p.csv_path.split('/').pop()} holds batch ${run?.batch}`} />
      ) : run?.experiments && Object.keys(run.experiments).some(Boolean) ? (
        <div className="mon-last">
          {Object.entries(run.experiments).filter(([k]) => k).map(([k, e]) => (
            <div key={k} className="mon-process">
              <span className="mono mon-process-name mon-wide" title={k}>{k}</span>
              <TaskBar counts={e.summary} width={120} />
              <Counts counts={e.summary} />
            </div>
          ))}
        </div>
      ) : <div className="ov-note">Nothing running</div>}
      {live && p.per_fly && (
        <div className="ov-note">
          Per fly, from its files on disk: <span className="mon-fly-state mon-fly-done">done</span> = ethogram figure and sleep
          written by this batch; <span className="mon-fly-state mon-fly-explorable">explorable</span> = behavior predictions written
          (the Ethograms tab works); the boxes are its outputs in pipeline order (filled = written by this batch, outlined = older).
        </div>
      )}
      {live && unassigned && (
        <div className="ov-note">{unassigned.summary.running + unassigned.summary.completed + unassigned.summary.failed + unassigned.summary.cached} tasks
          not attributed to an experiment (their script names none: {unassigned.processes.map((x) => x.process).join(', ')})</div>
      )}

      <h4 className="mon-h">Queued<span className="ov-count"> {groupRows(p.queued).length || ''}</span>
        {p.has_queue && p.queued.length > 0 && <span className="ov-count mon-dim"> — marked 1, taken by the next round of run_queue.sh, in this order</span>}
      </h4>
      <RowsTable rows={p.queued} perFly={p.per_fly} now={now} onOpenExperiment={onOpenExperiment}
                 onOpenFly={onOpenFly} flyMeta={p.fly_outputs} queued
                 emptyText={p.has_queue ? 'No row marked 1' : (live ? 'No queue' : 'No row marked 1')} />

      <div className="mon-foot">
        {run?.running_tasks?.length > 0 && (
          <button className="ov-link" onClick={() => setShowTasks((x) => !x)}>
            {showTasks ? '▾' : '▸'} Running tasks ({run.n_running_tasks})
          </button>
        )}
        {p.recent_batches.length > 0 && (
          <button className="ov-link" onClick={() => setShowBatches((x) => !x)}>
            {showBatches ? '▾' : '▸'} Recent batches
          </button>
        )}
        {runner && (
          <button className="ov-link" onClick={() => setShowLog((x) => !x)}>
            {showLog ? '▾' : '▸'} run_queue.log{runner.log_mtime ? ` (${duration(now - runner.log_mtime)} ago)` : ''}
          </button>
        )}
      </div>
      {showTasks && run?.running_tasks && (
        <div className="ov-scroll mon-scroll">
          <table className="pe-table ov-table mon-table">
            <thead><tr><th>Task</th><th>Experiment</th><th>Running for</th><th>Hash</th></tr></thead>
            <tbody>
              {run.running_tasks.map((t) => (
                <tr key={t.hash}>
                  <td className="mono">{t.name}</td>
                  <td className="mono">{t.experiment || <span className="mon-dim">?</span>}</td>
                  <td>{duration(now - t.submitted)}</td>
                  <td className="mono mon-dim">{t.hash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showBatches && (
        <div className="ov-scroll mon-scroll">
          <table className="pe-table ov-table mon-table">
            <thead><tr><th>Batch</th><th>Experiments</th></tr></thead>
            <tbody>
              {p.recent_batches.map((b) => (
                <tr key={b.batch}>
                  <td className="mono">{b.batch}</td>
                  <td className="mono"><div className="mon-batch">
                    {groupRows(b.rows).map((g) => (
                      <span key={g.experiment} className={b.completed?.includes(g.experiment) ? 'mon-ok' : undefined}
                            title={b.completed ? (b.completed.includes(g.experiment) ? 'complete' : 'not in completed/<batch>.txt') : undefined}>
                        {g.experiment}
                        {g.flies.length > 0 ? (
                          <> ({g.flies.map((f, k) => (
                            <React.Fragment key={f.fly}>
                              {k > 0 && ' '}
                              <span className={FLY_STATE[f.state].cls} title={`${f.fly}: ${FLY_STATE[f.state].title}`}>{f.identity}</span>
                            </React.Fragment>
                          ))})</>
                        ) : p.per_fly ? ` (${g.identities.join(' ')})` : ''}
                      </span>
                    ))}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showLog && runner && <pre className="mon-log">{runner.log.join('\n') || '(empty)'}</pre>}
    </section>
  );
}

export default function MonitorTab({ active, onOpenExperiment, onOpenFly }) {
  const { log } = useConsole();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [auto, setAuto] = useState(() => {
    try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch { return true; }
  });
  const [now, setNow] = useState(Date.now() / 1000);
  const errorLogged = useRef(false);

  const fetchData = useCallback(() => {
    setLoading(true);
    return api.get('/api/monitor')
      .then((r) => {
        const d = unwrap(r.data);
        setData(d);
        setNow(d.now);
        setError(null);
        errorLogged.current = false;
      })
      .catch((err) => {
        const msg = err.response?.data?.error || err.message;
        setError(msg);
        if (!errorLogged.current) log('error', `Could not read the pipelines: ${msg}`);
        errorLogged.current = true;
      })
      .finally(() => setLoading(false));
  }, [log]);

  useEffect(() => {
    if (!active) return undefined;
    fetchData();
    if (!auto) return undefined;
    const id = setInterval(fetchData, REFRESH_MS);
    return () => clearInterval(id);
  }, [active, auto, fetchData]);

  const toggleAuto = (on) => {
    setAuto(on);
    try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch { /* not stored */ }
  };

  const pipelines = data?.pipelines ?? [];

  return (
    <div className="ov">
      <div className="card ov-controls toolbar">
        <label className="field check">
          <input type="checkbox" checked={auto} onChange={(e) => toggleAuto(e.target.checked)} />
          Auto refresh ({REFRESH_MS / 1000} s)
        </label>
        <button onClick={fetchData} disabled={loading}>
          <i className={`fa fa-refresh${loading ? ' fa-spin' : ''}`} style={{ marginRight: 6 }} />Refresh
        </button>
        {data && <span className="ov-count">Updated {new Date(data.now * 1000).toLocaleTimeString()}</span>}
        {error && <span className="ov-warn">Could not load: {error}</span>}
        <span className="spacer" style={{ flex: 1 }} />
        {data && <span className="ov-count">Pipelines: <span className="mono">{data.pipelines_dir}</span></span>}
      </div>

      {data && (
        <div className="ov-stats">
          {pipelines.map((p) => (
            <div key={p.id} className={`card ov-stat${p.running ? ' mon-stat-running' : ''}`}>
              <div className="ov-stat-label">{p.label}</div>
              <div className="ov-stat-value">{p.error ? 'error' : p.running ? 'running' : 'idle'}</div>
              {!p.error && (
                <div className="ov-stat-sub">
                  {p.running && `${groupRows(p.in_run).length} experiments, ${p.run?.n_running_tasks ?? 0} tasks running · `}
                  {p.per_fly && p.running && (() => {
                    const n = (s) => p.in_run.filter((r) => r.state === s).length;
                    return `${n('done')} flies done, ${n('explorable')} explorable · `;
                  })()}
                  {groupRows(p.queued).length} queued
                  {p.has_queue && !p.queue_runner?.pids.length ? ' (queue not running)' : ''}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!data && !error && <div className="ov-loading">Reading the pipelines…</div>}
      {pipelines.map((p) => <Pipeline key={p.id} p={p} now={now} onOpenExperiment={onOpenExperiment} onOpenFly={onOpenFly} onChanged={fetchData} />)}
    </div>
  );
}
