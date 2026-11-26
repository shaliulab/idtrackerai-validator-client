// "idtrackerai pipeline" card of the Data collector tab: the experiment's rows in the idtrackerai pipeline's
// idtrackerai.csv (basedir,mark,note; rows marked 1 are taken by the next run), with Add / Edit / Remove.
// Every change goes through a dialog: fields, the server's checks, a preview of the lines changed, Confirm
// (sent with the sig of the file previewed: 409 when it changed since). Server: pipeline_csv.py.
import React, { useCallback, useEffect, useState } from 'react';
import api from './api';
import { useConsole } from './MessageConsole';
import './IdtrackeraiCsv.css';

const errorOf = (err) => err.response?.data?.error ?? err.message;
const ICON = { ok: '✓', warn: '!', error: '✕' };
const MARK_HELP = {
  1: 'taken by the next idtrackerai run',
  NEXT: 'planned, not taken by a run',
  LATER: 'planned, not taken by a run',
  '?': 'undecided, not taken by a run',
};

function Checks({ checks }) {
  if (!checks?.length) return null;
  return (
    <ul className="ic-checks" data-ic-checks>
      {checks.map((c, i) => (
        <li key={i} className={`ic-${c.level}`}>
          <span className="ic-icon">{ICON[c.level]}</span>
          <b>{c.what}</b>{c.detail ? <span className="ic-detail"> {c.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function Diff({ diff }) {
  return (
    <div className="ic-diff mono" data-ic-diff>
      {diff.map((d) => (
        <React.Fragment key={`${d.line}-${d.old}-${d.new}`}>
          {d.old != null && <div className="ic-del"><span className="ic-ln">{d.line}</span>- {d.old}</div>}
          {d.new != null && <div className="ic-add"><span className="ic-ln">{d.line}</span>+ {d.new}</div>}
        </React.Fragment>
      ))}
    </div>
  );
}

function EditDialog({ info, action, onClose, onDone }) {
  const { log } = useConsole();
  const row = action.row;
  const [mark, setMark] = useState(row?.mark ?? info.default.mark);
  const [note, setNote] = useState(row?.note ?? info.default.note);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const body = { op: action.op, experiment: info.experiment, mark, note, line: row?.line, expect: row?.text };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // the preview follows the fields (debounced): diff, checks with this mark, sig
  useEffect(() => {
    let live = true;
    setPreview(null);
    const timer = setTimeout(async () => {
      try {
        const data = (await api.post('/api/collector/idtrackerai_csv/preview', body)).data;
        if (live) { setPreview(data); setError(null); }
      } catch (err) {
        if (live) setError(errorOf(err));
      }
    }, 250);
    return () => { live = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mark, note, action]);

  const confirm = async () => {
    setBusy(true);
    try {
      const data = (await api.post('/api/collector/idtrackerai_csv/apply', { ...body, sig: preview.sig })).data;
      const what = { add: 'added to', update: 'updated in', remove: 'removed from' }[action.op];
      log('info', `${info.experiment} ${what} idtrackerai.csv (backup ${data.backup})`);
      onDone(data);
    } catch (err) {
      setError(errorOf(err));
      setBusy(false);
    }
  };

  const title = { add: 'Add to idtrackerai.csv', update: `Edit line ${row?.line}`, remove: `Remove line ${row?.line}` }[action.op];
  const blocked = !preview || preview.blocking > 0 || !preview.can_edit;
  return (
    <div className="md-overlay ic-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card md-dialog ic-dialog" role="dialog" aria-label={title} data-ic-dialog={action.op}>
        <header className="card-header">
          <span>{title}</span>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="ov-x" title="Close (Esc)" onClick={onClose}>×</button>
        </header>
        <div className="card-body md-body">
          <div className="ic-path mono">{info.basedir}</div>
          {action.op !== 'remove' && (
            <div className="ic-fields">
              <label className="field">
                Mark
                <select value={info.marks.includes(mark) ? mark : '__other'} data-ic-mark
                        onChange={(e) => setMark(e.target.value === '__other' ? '' : e.target.value)}>
                  {info.marks.map((m) => <option key={m} value={m}>{m}</option>)}
                  <option value="__other">other…</option>
                </select>
              </label>
              {!info.marks.includes(mark) && (
                <label className="field">
                  <input type="text" value={mark} placeholder="e.g. 2026-11-26" spellCheck={false}
                         onChange={(e) => setMark(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
                </label>
              )}
              <label className="field">
                Note
                <input type="text" value={note} spellCheck={false} data-ic-note
                       onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
              </label>
              <div className="ic-help">{MARK_HELP[mark] || 'not taken by a run (only rows marked 1 are)'}</div>
            </div>
          )}
          {preview && <Checks checks={preview.checks} />}
          {preview && <Diff diff={preview.diff} />}
          {preview && !preview.can_edit && <div className="ic-error">Not allowed: {preview.permission}</div>}
          {preview?.blocking > 0 && (
            <div className="ic-error">A row marked 1 with these problems would stop the whole idtrackerai run: fix them, or use NEXT.</div>
          )}
          {error && <div className="ic-error" data-ic-error>{error}</div>}
          {!preview && !error && <div className="sc-muted">Checking…</div>}
        </div>
        <footer className="md-footer ic-footer">
          <span className="sc-muted ic-file mono" title={info.file}>{info.file}</span>
          <span className="spacer" style={{ flex: 1 }} />
          <button onClick={onClose}>Cancel</button>
          <button className={action.op === 'remove' ? 'btn-danger solid' : 'btn-primary'} disabled={blocked || busy}
                  data-action="ic-confirm" onClick={confirm}>
            {busy ? 'Writing…' : { add: 'Add row', update: 'Save row', remove: 'Remove row' }[action.op]}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default function IdtrackeraiCsvCard({ experiment, active, refreshKey }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [action, setAction] = useState(null);     // {op, row}

  const fetchInfo = useCallback(async () => {
    if (!experiment) { setInfo(null); return; }
    try {
      const data = (await api.get('/api/collector/idtrackerai_csv', { params: { experiment } })).data;
      setInfo(data);
      setError(null);
    } catch (err) {
      setInfo(null);
      setError(errorOf(err));
    }
  }, [experiment]);

  useEffect(() => { if (active) fetchInfo(); }, [active, fetchInfo, refreshKey]);

  const issues = (info?.checks || []).filter((c) => c.level !== 'ok' && c.what !== 'Already listed');
  return (
    <section className="card ic-card" data-ic-card>
      <div className="card-header">
        idtrackerai pipeline
        <span className="spacer" />
        {info && !info.rows.length && (
          <button className="btn-primary" data-action="ic-add" onClick={() => setAction({ op: 'add' })}>
            + Add to idtrackerai.csv
          </button>
        )}
        <button className="icon-btn" title="Read again" onClick={fetchInfo}>↻</button>
      </div>
      <div className="card-body">
        {!experiment && <div className="sc-muted">Choose an experiment above.</div>}
        {error && <div className="ic-error">{error}</div>}
        {info && (
          <>
            {info.rows.length ? (
              <div className="ic-rows">
                {info.rows.map((r) => (
                  <div key={r.line} className="ic-row" data-ic-row={r.line}>
                    <span className="sc-muted">line {r.line}</span>
                    <span className={`ic-mark${r.mark === '1' ? ' ic-mark-run' : ''}`}>{r.mark ?? '–'}</span>
                    <span>{r.note || ''}</span>
                    <span className="spacer" style={{ flex: 1 }} />
                    <button data-action="ic-edit" onClick={() => setAction({ op: 'update', row: r })}>Edit</button>
                    <button className="btn-danger" data-action="ic-remove" onClick={() => setAction({ op: 'remove', row: r })}>Remove</button>
                  </div>
                ))}
              </div>
            ) : <div className="sc-muted">Not in idtrackerai.csv.</div>}
            {issues.length > 0 && <Checks checks={issues} />}
            <div className="ic-foot sc-muted">
              {info.selected.length} row{info.selected.length === 1 ? '' : 's'} marked 1 in {info.n_rows} ·{' '}
              {info.can_edit ? `you may change it (${info.permission})` : `read only: ${info.permission}`}
            </div>
          </>
        )}
      </div>
      {action && info && (
        <EditDialog info={info} action={action} onClose={() => setAction(null)}
                    onDone={(data) => { setAction(null); setInfo(data); }} />
      )}
    </section>
  );
}
