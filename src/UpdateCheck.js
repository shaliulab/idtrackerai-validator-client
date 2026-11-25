// UpdateCheck.js  —  "Updates" section of the How to use tab: Check for updates / Update.
//
// GitHub is asked only when the button is pressed (GET /api/update/check): no check on load, no polling.
// Applying (POST /api/update/apply) restarts the server for everyone, so the server allows it only to an
// admin (a browser on the server itself, or one unlocked with the admin password); others are told to ask
// their admin. While an update runs, /api/update/status is polled (the server goes away during the
// restart); when the new version answers, the page reloads.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from './api';

const KIND = {
  git: 'git checkout (updated in place)',
  windows: 'Windows install',
  docker: 'Docker image',
  pip: 'pip install',
};
const FINAL = { done: 'Updated', failed: 'Not updated', rolled_back: 'Rolled back', rollback_failed: 'Rollback failed' };

function errorText(error) {
  return error?.response?.data?.error || error?.message || String(error);
}

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

function Commands({ lines }) {
  if (!lines?.length) return null;
  const text = lines.join('\n');
  return (
    <div className="upd-commands">
      <pre>{text}</pre>
      <button type="button" onClick={() => navigator.clipboard?.writeText(text)} title="Copy the commands">
        <i className="fa fa-copy" /> Copy
      </button>
    </div>
  );
}

function Progress({ status }) {
  const logRef = useRef(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [status?.log?.length]);
  if (!status) return null;
  const running = status.state === 'running';
  return (
    <div className="upd-progress" data-update-state={status.state}>
      <div className={`upd-banner upd-${running ? 'running' : status.state}`}>
        {running ? <><i className="fa fa-spinner fa-spin" /> Updating {status.from?.version} → {status.to?.version}…</>
          : <><b>{FINAL[status.state] || status.state}:</b> {status.message}</>}
      </div>
      {status.steps?.length > 0 && (
        <ol className="upd-steps">
          {status.steps.map((s) => (
            <li key={s.name} className={`upd-step-${s.state}`}>
              <span className="upd-step-icon">{s.state === 'done' ? '✓' : s.state === 'failed' ? '✗' : '…'}</span>
              {s.name}{s.detail ? <span className="upd-detail"> — {s.detail}</span> : null}
            </li>
          ))}
        </ol>
      )}
      {status.log?.length > 0 && (
        <details open={running}>
          <summary>Log ({status.log.length} lines)</summary>
          <pre ref={logRef} className="upd-log">{status.log.join('\n')}</pre>
        </details>
      )}
    </div>
  );
}

export default function UpdateCheck() {
  const [check, setCheck] = useState(null);       // answer of /api/update/check
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);     // status.json of the update running / last one
  const [polling, setPolling] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [password, setPassword] = useState('');
  const [reloadIn, setReloadIn] = useState(null);

  // the last update (local file, GitHub is not asked): shows one that is running when the page opens
  useEffect(() => {
    api.get('/api/update/status').then((r) => {
      if (r.data.status) {
        setStatus(r.data.status);
        if (r.data.status.state === 'running') setPolling(true);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!polling) return undefined;
    let stop = false;
    const tick = async () => {
      try {
        const r = await api.get('/api/update/status', { timeout: 4000 });
        if (stop) return;
        setRestarting(false);
        const st = r.data.status;
        setStatus(st);
        if (st && st.state !== 'running') {
          setPolling(false);
          // the new version answers: reload the page so the browser runs its web interface
          if (st.state === 'done' && r.data.current?.version === st.to?.version) setReloadIn(3);
        }
      } catch (e) {
        if (!stop) setRestarting(true);          // the server is restarting
      }
      if (!stop) setTimeout(tick, 2000);
    };
    const t = setTimeout(tick, 500);
    return () => { stop = true; clearTimeout(t); };
  }, [polling]);

  useEffect(() => {
    if (reloadIn == null) return undefined;
    if (reloadIn <= 0) { window.location.reload(); return undefined; }
    const t = setTimeout(() => setReloadIn(reloadIn - 1), 1000);
    return () => clearTimeout(t);
  }, [reloadIn]);

  const doCheck = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const r = await api.get('/api/update/check', { timeout: 60000 });
      setCheck(r.data);
    } catch (e) {
      setError(errorText(e));
      if (e?.response?.data?.current) setCheck({ current: e.response.data.current, install: e.response.data.install });
    } finally {
      setChecking(false);
    }
  }, []);

  const unlock = async () => {
    try {
      await api.post('/api/update/admin', { password });
      setPassword('');
      await doCheck();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const apply = async (force = false) => {
    const jobs = check?.busy?.jobs || [];
    const survives = check?.busy?.survives || [];
    const lines = [
      `Update the server from ${check.current.version} to ${check.latest.version}?`,
      '',
      'The server restarts: everyone using it loses the connection for a minute or two, and unsaved work in their browser may be lost (ask them to save first).',
      'If the new version does not start, the previous one is put back automatically.',
    ];
    if (!force && jobs.length) lines.push('', `Running jobs that the restart would stop (${jobs.length}): ${jobs.map((j) => j.title).join(', ')}`);
    if (survives.length) lines.push('', `Keeps running across the restart: ${survives.join(', ')}`);
    if (!force && !window.confirm(lines.join('\n'))) return;
    setError(null);
    try {
      await api.post('/api/update/apply', { version: check.latest.version, force });
      setStatus({ state: 'running', from: { version: check.current.version }, to: { version: check.latest.version }, steps: [], log: [] });
      setPolling(true);
    } catch (e) {
      const data = e?.response?.data;
      if (e?.response?.status === 409 && data?.jobs?.length && !force) {
        if (window.confirm(`${data.error}.\n\nStop them and update anyway?`)) apply(true);
        return;
      }
      setError(errorText(e));
    }
  };

  const running = status?.state === 'running';
  const latest = check?.latest;
  const current = check?.current;

  return (
    <div className="upd" data-update-check={check?.state || ''}>
      <div className="upd-row">
        <button type="button" className="primary" onClick={doCheck} disabled={checking || running}
          data-action="update-check" title="Ask GitHub for the latest release (only now: the app never checks by itself)">
          {checking ? <><i className="fa fa-spinner fa-spin" /> Checking…</> : <><i className="fa fa-refresh" /> Check for updates</>}
        </button>
        {current && (
          <span className="upd-current">
            Running <b>{current.version || '?'}</b>
            {current.commit ? <> (commit <code>{current.commit}{current.dirty ? '*' : ''}</code>)</> : null}
            {check?.install ? <>, {KIND[check.install.kind] || check.install.kind}</> : null}
          </span>
        )}
      </div>

      {error && <div className="upd-banner upd-failed">{error}</div>}

      {latest && (
        <div className="upd-result">
          <div className={`upd-banner upd-${check.state}`}>
            {check.state === 'update_available' && <>Version <b>{latest.version}</b> is available (you run {current.version}).</>}
            {check.state === 'up_to_date' && <>Up to date: {current.version} is the latest release.</>}
            {check.state === 'ahead' && <>This server ({current.version}) is newer than the latest release ({latest.version}).</>}
          </div>
          <div className="upd-release">
            <a href={latest.url} target="_blank" rel="noreferrer"><b>{latest.name}</b></a>
            {latest.published_at ? <span className="upd-detail"> — {when(latest.published_at)}</span> : null}
            {latest.summary && (
              <details open={check.state === 'update_available'}>
                <summary>Release notes</summary>
                <pre className="upd-notes">{latest.summary}</pre>
                <a href={latest.url} target="_blank" rel="noreferrer">Full release notes on GitHub</a>
              </details>
            )}
          </div>

          {check.state === 'update_available' && (
            check.admin ? (
              <>
                {check.blockers?.length > 0 && (
                  <ul className="upd-blockers">{check.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
                )}
                {check.can_apply ? (
                  <div className="upd-row">
                    <button type="button" className="primary" onClick={() => apply(false)} disabled={running}
                      data-action="update-apply">
                      <i className="fa fa-download" /> Update to {latest.version} and restart
                    </button>
                    {check.busy?.jobs?.length > 0 && (
                      <span className="upd-warn">{check.busy.jobs.length} job(s) running: {check.busy.jobs.map((j) => j.title).join(', ')}</span>
                    )}
                  </div>
                ) : check.commands?.length > 0 && (
                  <>
                    <p>Update it by hand:</p>
                    <Commands lines={check.commands} />
                  </>
                )}
              </>
            ) : (
              <div className="upd-notadmin">
                <p>
                  <b>Ask your admin to update the server.</b> Updating restarts it for everyone, so only an admin
                  can do it: from a browser on the server itself{check.admin_password ? ', or with the admin password' : ''}.
                </p>
                {check.admin_password && (
                  <form className="upd-row" onSubmit={(e) => { e.preventDefault(); unlock(); }}>
                    <input type="password" autoComplete="current-password" placeholder="Admin password"
                      value={password} onChange={(e) => setPassword(e.target.value)} />
                    <button type="submit" disabled={!password}>I am the admin</button>
                  </form>
                )}
              </div>
            )
          )}
        </div>
      )}

      {restarting && running && <div className="upd-banner upd-running"><i className="fa fa-spinner fa-spin" /> The server is restarting…</div>}
      <Progress status={status} />
      {reloadIn != null && <div className="upd-banner upd-done">Reloading the page in {reloadIn} s…</div>}
    </div>
  );
}
