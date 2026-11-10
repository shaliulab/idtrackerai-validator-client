// CvatLaunch.js  —  send an experiment to CVAT for validation (manual/validation/main.sh)
//
// Dialog opened from the experiments table of the Overview tab. It runs the checks on
// the server (POST /api/cvat_launch/check, a job: ~30-60 s, it reads the whole database;
// see idtrackerai_validator_server/cvat_launch.py) and shows them. "Send to CVAT" starts
// main.sh in the background on the server (POST /api/cvat_launch/start); failed checks
// need "send despite …". While a run is going, or after it finished, the dialog shows its
// steps and the end of main.log (GET /api/cvat_launch/status, polled).

import React, { useCallback, useEffect, useState } from 'react';
import api from './api';
import { useConsole } from './MessageConsole';

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);
const ICONS = { ok: '✓', warning: '⚠', error: '✗' };
const POLL_MS = 5000;

export const STATE_LABELS = {
  running: 'running', done: 'in CVAT', failed: 'failed', stopped: 'stopped',
};

function RunStatus({ status }) {
  if (!status || status.state === 'none') return null;
  const started = status.started ? new Date(status.started * 1000).toLocaleString() : '?';
  return (
    <div className="cl-run">
      <p className="ov-note">
        <b className={`cl-state cl-${status.state}`}>{STATE_LABELS[status.state] || status.state}</b>
        {' '}· started {started}{status.forced ? ' despite failed checks' : ''}
        {' '}· step {status.stages?.length ?? 0} of {status.n_stages}
        {status.stages?.length ? ` (last: ${status.stages[status.stages.length - 1]})` : ''}
        {' '}· {status.free_gb} GB free on the disk
      </p>
      {status.stopped && <p className="md-error">{status.stopped}</p>}
      <p className="ov-note mono">{status.log}</p>
      <pre className="cl-tail">{(status.tail || []).join('\n')}</pre>
    </div>
  );
}

export default function CvatLaunch({ experiment, onClose, onStarted }) {
  const { log, trackJob } = useConsole();
  const [job, setJob] = useState(null);          // finished check job
  const [failed, setFailed] = useState(null);
  const [status, setStatus] = useState(null);
  const [confirmForce, setConfirmForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recheck, setRecheck] = useState(0);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const fetchStatus = useCallback(() => (
    api.get('/api/cvat_launch/status', { params: { experiment } })
      .then((r) => setStatus(unwrap(r.data)))
      .catch(() => { /* shown by the checks */ })
  ), [experiment]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // poll while running
  useEffect(() => {
    if (status?.state !== 'running') return undefined;
    const timer = setInterval(fetchStatus, POLL_MS);
    return () => clearInterval(timer);
  }, [status?.state, fetchStatus]);

  useEffect(() => {
    let cancelled = false;
    setJob(null);
    setFailed(null);
    setConfirmForce(false);
    api.post('/api/cvat_launch/check', { experiment })
      .then((r) => trackJob(unwrap(r.data)))
      .then((done) => {
        if (cancelled) return;
        if (done?.status !== 'done') { setFailed(done?.error || 'the checks failed'); return; }
        setJob(done);
        const bad = done.result.checks.filter((c) => c.level !== 'ok');
        log(bad.some((c) => c.level === 'error') ? 'warning' : 'info',
          `Checks of ${experiment} before validation: ${bad.length ? `${bad.length} to look at` : 'all fine'}`);
        bad.forEach((c) => log(c.level, `  ${c.text}`));
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err.response?.data?.error || err.message;
        setFailed(msg);
        log('error', `Could not check ${experiment}: ${msg}`);
      });
    return () => { cancelled = true; };
  }, [experiment, recheck, trackJob, log]);

  const res = job?.result;
  const errors = res ? res.checks.filter((c) => c.level === 'error') : [];
  const running = status?.state === 'running';

  const send = async () => {
    setBusy(true);
    try {
      const out = unwrap((await api.post('/api/cvat_launch/start',
        { experiment, job_id: job.id, force: errors.length > 0 })).data);
      log('success', `Validation of ${experiment} started (main.sh, pid ${out.pid}${out.forced ? ', despite failed checks' : ''}). Log: ${out.log}`);
      onStarted?.();
      await fetchStatus();
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      log('error', `Could not start the validation of ${experiment}: ${msg}`);
      if (/too old/.test(msg)) setRecheck((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="md-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card md-dialog" role="dialog" aria-label="Send to CVAT for validation">
        <header className="card-header">
          <span>Send to CVAT for validation</span>
          <span className="ov-count mono">{experiment}</span>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="ov-x" title="Close (Esc)" onClick={onClose}>×</button>
        </header>

        <div className="card-body md-body">
          <RunStatus status={status} />

          {!res && !failed && (
            <p className="ov-note">
              <i className="fa fa-spinner fa-spin" /> Checking the tracking database, CVAT and the disk (30-60 s)…
            </p>
          )}
          {failed && <p className="md-error">Checks failed: {failed}</p>}
          {res && (
            <>
              <p className="ov-note">
                {res.facts.identifier} · {res.facts.number_of_animals ?? '?'} animals
                {res.facts.frames ? ` · ${res.facts.frames.toLocaleString()} frames` : ''}
                {' '}· checked {new Date(res.checked_at * 1000).toLocaleTimeString()}{' '}
                <button className="ov-link" onClick={() => setRecheck((n) => n + 1)}>Check again</button>
              </p>
              <ul className="md-checks cl-checks">
                {res.checks.map((c, i) => (
                  <li key={i} className={`md-${c.level}`} title={c.name}><span>{ICONS[c.level]}</span> {c.text}</li>
                ))}
              </ul>
              <p className="ov-note">
                Runs make-identogram, auto-annotate-qc and export-images, uploads the images to CVAT into a project
                named after the experiment and pre-populates it with yolov7 (one experiment at a time uploads / uses the GPU).
                It keeps running if this server restarts; while the server runs, it is stopped if the disk falls below 30 GB free.
              </p>
            </>
          )}
        </div>

        <footer className="md-footer">
          <span className="spacer" style={{ flex: 1 }} />
          {res && errors.length > 0 && !running && (
            <label className="field md-error">
              <input type="checkbox" checked={confirmForce} onChange={(e) => setConfirmForce(e.target.checked)} />
              send despite {errors.length} failed check{errors.length === 1 ? '' : 's'}
            </label>
          )}
          <button onClick={onClose}>Close</button>
          <button className="icon-btn primary"
                  disabled={!res || busy || running || (errors.length > 0 && !confirmForce)}
                  onClick={send}
                  title="Start manual/validation/main.sh for this experiment on the server">
            {busy ? 'Starting…' : running ? 'Running…' : 'Send to CVAT'}
          </button>
        </footer>
      </div>
    </div>
  );
}
