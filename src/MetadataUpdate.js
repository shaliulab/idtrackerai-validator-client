// MetadataUpdate.js  —  refresh an experiment's ethoscope_metadata from the Google sheets
//
// Dialog opened from the Overview tab. It starts a preview job on the server
// (POST /api/metadata/preview; see idtrackerai_validator_server/metadata_sync.py),
// which uses the predownloaded metadata when there is some ("Predownload sheet
// metadata" in the experiments table), else runs download_flyhostel_metadata
// (~10 s); "Download again" forces a new download. It shows the checks and the new
// rows (cells that change are highlighted, hover shows the old value) and also
// prints them to the console. Nothing is written until "Write to database"
// (POST /api/metadata/apply); failed checks need "Write anyway".

import React, { useEffect, useState } from 'react';
import api from './api';
import { useConsole } from './MessageConsole';

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);
const ICONS = { ok: '✓', warning: '⚠', error: '✗' };

export default function MetadataUpdate({ experiment, onClose, onWritten }) {
  const { log, trackJob } = useConsole();
  const [job, setJob] = useState(null);           // finished preview job
  const [failed, setFailed] = useState(null);
  const [allColumns, setAllColumns] = useState(false);
  const [confirmForce, setConfirmForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(0);          // > 0: download again instead of the predownloaded copy

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setJob(null);
    setFailed(null);
    setConfirmForce(false);
    api.post('/api/metadata/preview', { experiment, fresh: fresh > 0 })
      .then((r) => trackJob(unwrap(r.data)))
      .then((done) => {
        if (cancelled) return;
        if (done?.status !== 'done') { setFailed(done?.error || 'the download failed'); return; }
        setJob(done);
        const res = done.result;
        log('info', `New metadata of ${experiment} from the sheets (${res.rows.length} row${res.rows.length === 1 ? '' : 's'}, `
          + `${res.n_previous} in the database now):`);
        res.rows.forEach((row) => log('info', '  ' + res.key_columns.map((c) => `${c}=${row[c] ?? '—'}`).join(' · ')));
        res.checks.filter((c) => c.level !== 'ok').forEach((c) => log(c.level, `  ${c.text}`));
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err.response?.data?.error || err.message;
        setFailed(msg);
        log('error', `Could not download the metadata of ${experiment}: ${msg}`);
      });
    return () => { cancelled = true; };
  }, [experiment, fresh, trackJob, log]);

  const res = job?.result;
  const errors = res ? res.checks.filter((c) => c.level === 'error') : [];
  const columns = res ? (allColumns ? res.columns : res.key_columns) : [];

  const write = async (force) => {
    setBusy(true);
    try {
      const out = unwrap((await api.post('/api/metadata/apply', { experiment, job_id: job.id, force })).data);
      log('success', `Metadata of ${experiment} written to its database (${out.rows} rows${out.forced ? ', despite failed checks' : ''}). `
        + `Old value saved to ${out.backup}${out.metadata_csv ? '; metadata.csv replaced too' : ''}`);
      onWritten?.();
      onClose();
    } catch (err) {
      log('error', `Could not write the metadata of ${experiment}: ${err.response?.data?.error || err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="md-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card md-dialog" role="dialog" aria-label="Update metadata from the sheets">
        <header className="card-header">
          <span>Update metadata from the Google sheets</span>
          <span className="ov-count mono">{experiment}</span>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="ov-x" title="Close (Esc)" onClick={onClose}>×</button>
        </header>

        <div className="card-body md-body">
          {!res && !failed && <p className="ov-note">Loading the rows of this experiment from the sheets (about 10 s unless predownloaded)…</p>}
          {failed && <p className="md-error">Download failed: {failed}</p>}

          {res && (
            <>
              <p className="ov-note">
                {res.predownloaded ? 'Predownloaded' : 'Downloaded'}{' '}
                {new Date(res.downloaded_at * 1000).toLocaleString()}.{' '}
                <button className="ov-link" onClick={() => setFresh((n) => n + 1)}
                        title="Download this experiment's rows from the sheets now (about 10 s), e.g. after fixing the sheet">
                  Download again
                </button>
              </p>
              <ul className="md-checks">
                {res.checks.map((c) => (
                  <li key={c.text} className={`md-${c.level}`}><span>{ICONS[c.level]}</span> {c.text}</li>
                ))}
              </ul>
              <p className="ov-note">
                {res.unchanged ? 'Identical to the metadata in the database: nothing to write.'
                  : <>{res.rows.length} row{res.rows.length === 1 ? '' : 's'} ({res.n_previous} in the database now).
                    {' '}Changes in: {res.changed_columns.length ? res.changed_columns.join(', ') : 'formatting only'}.
                    {' '}Highlighted cells change; hover for the current value.</>}
              </p>
              {res.rows.length > 0 && (
                <div className="ov-scroll md-table-scroll">
                  <table className="pe-table ov-table md-table">
                    <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                    <tbody>
                      {res.rows.map((row, i) => {
                        const old = res.previous[i];
                        return (
                          <tr key={i}>
                            {columns.map((c) => {
                              const before = old ? old[c] : undefined;
                              const changed = !old || (row[c] ?? null) !== (before ?? null);
                              return (
                                <td key={c} className={changed ? 'md-changed' : undefined}
                                    title={changed ? `now in the database: ${old ? (before ?? '(empty)') : '(no matching row)'}` : undefined}>
                                  {row[c] ?? ''}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        <footer className="md-footer">
          {res && (
            <label className="field">
              <input type="checkbox" checked={allColumns} onChange={(e) => setAllColumns(e.target.checked)} />
              all {res.columns.length} columns
            </label>
          )}
          <span className="spacer" style={{ flex: 1 }} />
          {res && errors.length > 0 && (
            <label className="field md-error">
              <input type="checkbox" checked={confirmForce} onChange={(e) => setConfirmForce(e.target.checked)} />
              write despite {errors.length} failed check{errors.length === 1 ? '' : 's'}
            </label>
          )}
          <button onClick={onClose}>Cancel</button>
          <button className="icon-btn primary"
                  disabled={!res || busy || res.unchanged || (errors.length > 0 && !confirmForce)}
                  onClick={() => write(errors.length > 0)}
                  title="Replace ethoscope_metadata in the experiment's database (the old value is backed up)">
            {busy ? 'Writing…' : 'Write to database'}
          </button>
        </footer>
      </div>
    </div>
  );
}
