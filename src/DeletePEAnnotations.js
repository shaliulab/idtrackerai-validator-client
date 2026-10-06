// DeletePEAnnotations.js  —  wipe the loaded experiment's human PE annotations
//
// Button + confirmation banner. The banner lists what will go (counts from
// GET /api/pe/human_annotations) and only enables the delete once the
// experiment name has been typed; the server checks that name again.

import React, { useEffect, useState } from 'react';
import api from './api';
import { useConsole } from './MessageConsole';

const API = '/api/pe/human_annotations';

const TABLE_LABELS = {
  pe_annotations: 'bout verdicts',
  gt_segments: 'ground-truth segments',
  gt_windows: 'bursts marked "segmentation done"',
};

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);

export default function DeletePEAnnotations({ onDeleted }) {
  const [summary, setSummary] = useState(null);   // {experiment, counts}; banner open when set
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const { log } = useConsole();

  const close = () => { setSummary(null); setTyped(''); };

  useEffect(() => {
    if (!summary) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [summary]);

  const open = async () => {
    try {
      setSummary(unwrap((await api.get(API)).data));
    } catch (e) {
      log('error', `Could not count PE annotations: ${e.response?.data?.error || e.message}`);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const { data } = await api.delete(API, { data: { experiment: summary.experiment } });
      const res = unwrap(data);
      const total = Object.values(res.deleted).reduce((a, b) => a + b, 0);
      log('success', `Deleted ${total} human PE annotations of ${res.experiment}`
        + (res.backup ? ` (backup: ${res.backup})` : ''));
      close();
      onDeleted?.();
    } catch (e) {
      log('error', `Delete failed: ${e.response?.data?.error || e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const total = summary ? Object.values(summary.counts).reduce((a, b) => a + b, 0) : 0;
  const confirmed = summary && typed.trim() === summary.experiment;

  return (
    <>
      <button className="btn-danger" onClick={open} disabled={!!summary}
              title="Delete every verdict and ground-truth segment entered for the loaded experiment">
        <i className="fa fa-trash-o" style={{ marginRight: 6 }} />
        Delete human annotations…
      </button>

      {summary && (
        <div className="banner-danger" role="alertdialog" onKeyDown={(e) => e.stopPropagation()}>
          <i className="fa fa-exclamation-triangle" style={{ fontSize: 20, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            {total === 0 ? (
              <>
                <strong>Nothing to delete.</strong>
                <div>No human annotations are stored for <code>{summary.experiment}</code>.</div>
                <div className="banner-actions"><button onClick={close}>Close</button></div>
              </>
            ) : (
              <>
                <strong>Delete all human annotations of <code>{summary.experiment}</code>?</strong>
                <ul>
                  {Object.entries(summary.counts).filter(([, n]) => n > 0).map(([t, n]) => (
                    <li key={t}><b>{n}</b> {TABLE_LABELS[t] ?? t}</li>
                  ))}
                </ul>
                <div>
                  All flies of the experiment are affected. Automatic segmentation is kept.
                  The deleted rows are saved as JSON in <code>pe_annotations_deleted/</code> next to the database.
                </div>
                <div className="banner-actions">
                  <label className="field" style={{ color: 'inherit' }}>
                    Type the experiment name to confirm
                    <input
                      type="text"
                      autoFocus
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && confirmed && !busy) remove(); }}
                      placeholder={summary.experiment}
                      style={{ width: 300, fontFamily: 'monospace' }}
                    />
                  </label>
                  <button className="btn-danger solid" onClick={remove} disabled={!confirmed || busy}>
                    {busy ? 'Deleting…' : `Delete ${total} entries`}
                  </button>
                  <button onClick={close} disabled={busy}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
