// RestoreFromDropbox.js  —  "Restore from Dropbox" card of the Data management tab
//
// Experiment folders that are on Dropbox but not in the videos drives (see
// idtrackerai_validator_server/restore.py), with the deepethogram (DEG) videos made
// from them: labelled = with a *labels*.csv. "List Dropbox" is a job (~30 s): it lists
// the folders on Dropbox, reads the DEG projects and inspects (size, files, database)
// the candidates with labelled videos; ⓘ inspects one more. Restoring copies the
// selected experiments with rclone, one at a time per drive, into their usual folder;
// an interrupted restore is resumed by restoring again ("partial").

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import api from './api';
import CardResizer from './CardResizer';
import { useConsole } from './MessageConsole';
import { formatBytes } from './DataManagementTab';

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);

const ago = (seconds) => {
  if (!seconds) return 'never';
  const d = (Date.now() / 1000 - seconds) / 86400;
  if (d < 1 / 24) return 'just now';
  if (d < 1) return `${Math.round(d * 24)} h ago`;
  return `${Math.round(d)} d ago`;
};

const SHOW = {
  labelled: ['with labelled DEG videos', (r) => r.deg?.labelled > 0],
  deg: ['with DEG videos', (r) => r.deg?.videos > 0],
  all: ['all', () => true],
};

const COLUMNS = [
  ['experiment', 'Experiment'],
  ['labelled', 'DEG labelled'],
  ['videos', 'DEG videos'],
  ['bytes', 'Size on Dropbox'],
  ['n_chunks', 'Raw chunks'],
  ['has_database', 'Database'],
  ['free', 'Drive free'],
];

const sortValue = (r, key) => {
  if (key === 'labelled' || key === 'videos') return r.deg?.[key] ?? -1;
  if (key === 'bytes' || key === 'n_chunks') return r.dropbox?.[key] ?? -1;
  if (key === 'has_database') return r.dropbox ? Number(r.dropbox.has_database) : -1;
  if (key === 'free') return r.freeBytes ?? -1;
  return r[key];
};

const projectsTitle = (deg) => deg && Object.entries(deg.projects)
  .map(([p, [videos, labelled]]) => `${p}: ${labelled} labelled of ${videos}`).join('\n');

function useStoredFlag(key, initial) {
  const [value, setValue] = useState(() => {
    try { const v = localStorage.getItem(key); return v == null ? initial : v === 'true'; } catch { return initial; }
  });
  const set = (v) => {
    setValue(v);
    try { localStorage.setItem(key, String(v)); } catch { /* ignore */ }
  };
  return [value, set];
}

function RestoreDialog({ records, drives, margin, onClose, onRestore }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const byDrive = drives.map((d) => {
    const mine = records.filter((r) => r.drive === d.device);
    const needed = mine.reduce((acc, r) => acc + (r.dropbox?.bytes || 0), 0);
    return { ...d, mine, needed, left: d.free - needed };
  }).filter((d) => d.mine.length > 0);
  const total = records.reduce((acc, r) => acc + (r.dropbox?.bytes || 0), 0);
  const uninspected = records.filter((r) => !r.dropbox);
  const noDatabase = records.filter((r) => r.dropbox && !r.dropbox.has_database);
  const tooFull = byDrive.filter((d) => d.left < margin);

  return (
    <div className="md-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card md-dialog dm-restore-dialog" role="dialog" aria-label="Restore from Dropbox">
        <header className="card-header">
          <span>Restore from Dropbox</span>
          <span className="ov-count">{records.length} experiment{records.length === 1 ? '' : 's'}, {formatBytes(total)}</span>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="ov-x" title="Close (Esc)" onClick={onClose}>×</button>
        </header>
        <div className="card-body md-body">
          <p>
            Each experiment is copied with rclone into its usual folder of the videos drives (first into{' '}
            <span className="mono">FlyHostel&lt;N&gt;/.restoring/</span>, renamed when every file is there),
            its database is added to <span className="mono">index.txt</span> and it is scanned.
            One experiment at a time per drive; nothing on Dropbox is changed.
          </p>
          <table className="pe-table ov-table dm-restore-plan">
            <thead><tr><th>Drive</th><th>Experiments</th><th>To copy</th><th>Free now</th><th>Free after</th></tr></thead>
            <tbody>
              {byDrive.map((d) => (
                <tr key={d.device}>
                  <td className="mono">{d.path}</td>
                  <td className="mono">{d.mine.map((r) => <div key={r.experiment}>{r.experiment}{r.partial ? ' (resume)' : ''}</div>)}</td>
                  <td>{formatBytes(d.needed)}</td>
                  <td>{formatBytes(d.free)}</td>
                  <td className={d.left < margin ? 'dm-restore-short' : undefined}>{formatBytes(d.left)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {tooFull.length > 0 && (
            <div className="banner-danger dm-banner">
              <div>
                <b>Not enough space</b> on {tooFull.map((d) => d.path).join(', ')}: the server keeps at least{' '}
                {formatBytes(margin)} free and will refuse the experiments that do not fit.
              </div>
            </div>
          )}
          {uninspected.length > 0 && (
            <p><b>Size not known yet</b> for {uninspected.map((r) => r.experiment).join(', ')}: the server lists it before copying.</p>
          )}
          {noDatabase.length > 0 && (
            <p><b>No database on Dropbox</b> for {noDatabase.map((r) => r.experiment).join(', ')}: only the recording comes back.</p>
          )}
        </div>
        <footer className="md-footer">
          <span className="spacer" style={{ flex: 1 }} />
          <button onClick={onClose}>Cancel</button>
          <button className="solid" autoFocus onClick={() => onRestore(records.map((r) => r.experiment))}>
            <i className="fa fa-cloud-download" style={{ marginRight: 6 }} />Restore {formatBytes(total)}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default function RestoreFromDropbox({ onRestored }) {
  const { log, trackJob } = useConsole();
  const [open, setOpen] = useStoredFlag('fh-dm-restore-open', true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [listing, setListing] = useState(false);
  const [inspecting, setInspecting] = useState(new Set());
  const [restoring, setRestoring] = useState(new Set());
  const [selected, setSelected] = useState(new Set());
  const [show, setShow] = useState('labelled');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: 'labelled', desc: true });
  const [confirm, setConfirm] = useState(null);

  const fetchData = useCallback(() => api.get('/api/data_management/restore')
    .then((r) => { setData(unwrap(r.data)); setError(null); })
    .catch((err) => {
      const msg = err.response?.data?.error || err.message;
      setError(msg);
      log('error', `Could not load the Dropbox restore candidates: ${msg}`);
    }), [log]);

  useEffect(() => { if (open && !data && !error) fetchData(); }, [open, data, error, fetchData]);

  const list = useCallback((inspect) => {
    if (inspect) setInspecting((s) => new Set([...s, ...inspect])); else setListing(true);
    api.post('/api/data_management/restore/list', inspect ? { inspect } : {})
      .then((r) => trackJob(unwrap(r.data)))
      .then((job) => {
        if (job?.status !== 'done') return;
        const { remote, inspected, errors } = job.result;
        log(errors.length ? 'warning' : 'success',
          `${remote} experiment folders on Dropbox, ${inspected} inspected${errors.length ? `, ${errors.length} failed` : ''}`);
        errors.forEach((e) => log('warning', `  ${e}`));
      })
      .catch((err) => log('error', `Could not list Dropbox: ${err.response?.data?.error || err.message}`))
      .finally(() => {
        if (inspect) setInspecting((s) => new Set([...s].filter((e) => !inspect.includes(e)))); else setListing(false);
        fetchData();
      });
  }, [trackJob, log, fetchData]);

  const restore = useCallback((experiments) => {
    setConfirm(null);
    setRestoring(new Set(experiments));
    api.post('/api/data_management/restore', { experiments })
      .then((r) => trackJob(unwrap(r.data)))
      .then((job) => {
        if (!job?.result) return;
        job.result.restored.forEach((r) => log('success',
          `Restored ${r.experiment} from Dropbox: ${formatBytes(r.bytes)}, ${r.n_files} files (${r.path})`));
        job.result.errors.forEach((e) => log('error', `Could not restore ${e}`));
      })
      .catch((err) => log('error', `Could not restore: ${err.response?.data?.error || err.message}`))
      .finally(() => {
        setRestoring(new Set());
        setSelected(new Set());
        fetchData();
        onRestored?.();
      });
  }, [trackJob, log, fetchData, onRestored]);

  const records = useMemo(() => {
    const free = Object.fromEntries((data?.drives ?? []).map((d) => [d.device, d.free]));
    return (data?.candidates ?? []).map((r) => ({ ...r, freeBytes: free[r.drive] }));
  }, [data]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const keep = SHOW[show][1];
    const rows = records.filter((r) => keep(r) && (!q || r.experiment.toLowerCase().includes(q)));
    const { key, desc } = sort;
    rows.sort((a, b) => {
      const va = sortValue(a, key);
      const vb = sortValue(b, key);
      const c = typeof va === 'number' || typeof vb === 'number'
        ? (va ?? -1) - (vb ?? -1)
        : String(va ?? '').localeCompare(String(vb ?? ''));
      return (desc ? -c : c) || a.experiment.localeCompare(b.experiment);
    });
    return rows;
  }, [records, show, search, sort]);

  const chosen = records.filter((r) => selected.has(r.experiment));
  const chosenBytes = chosen.reduce((acc, r) => acc + (r.dropbox?.bytes || 0), 0);
  const busy = restoring.size > 0 || data?.restoring;
  const toggle = (experiment) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(experiment)) next.delete(experiment); else next.add(experiment);
    return next;
  });
  const allShown = shown.length > 0 && shown.every((r) => selected.has(r.experiment));

  const header = (key, label) => (
    <th key={key} onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'experiment' }))}>
      {label}{sort.key === key ? (sort.desc ? ' ▼' : ' ▲') : ''}
    </th>
  );

  return (
    <section className="card ov-table-card">
      <header className="card-header" style={{ cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <i className={`fa fa-caret-${open ? 'down' : 'right'}`} />
        <span>Restore from Dropbox</span>
        {data && <span className="ov-count">{shown.length} of {records.length} only on Dropbox · listed {ago(data.listed_at)}</span>}
      </header>
      {open && (
        <>
          <div className="toolbar dm-restore-toolbar">
            <label className="field">
              <i className="fa fa-search" />
              <input type="text" placeholder="Search experiments" value={search}
                     onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.stopPropagation()}
                     style={{ width: 220 }} />
            </label>
            <label className="field">
              Show
              <select value={show} onChange={(e) => setShow(e.target.value)}>
                {Object.entries(SHOW).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
            <span className="spacer" style={{ flex: 1 }} />
            {data && <span className="ov-count" title="DEG projects read">DEG: <span className="mono">{data.deg_root}</span></span>}
            <button onClick={() => list(null)} disabled={listing || data?.listing}
                    title="List the experiment folders on Dropbox and the DEG projects again, and inspect the candidates with labelled DEG videos (~30 s)">
              <i className={`fa ${listing ? 'fa-spinner fa-spin' : 'fa-cloud'}`} style={{ marginRight: 6 }} />List Dropbox
            </button>
            <button className="solid" disabled={chosen.length === 0 || busy} onClick={() => setConfirm(chosen)}
                    title="Copy the selected experiments back from Dropbox (asks for confirmation)">
              <i className={`fa ${busy ? 'fa-spinner fa-spin' : 'fa-cloud-download'}`} style={{ marginRight: 6 }} />
              Restore {chosen.length || ''} selected{chosenBytes ? ` (${formatBytes(chosenBytes)})` : ''}
            </button>
          </div>

          {error && <div className="banner-danger dm-banner"><div>Could not load: {error}</div></div>}
          {data && !data.listed_at && (
            <div className="dm-restore-note">Dropbox has not been listed yet: press <b>List Dropbox</b>.</div>
          )}
          {data?.deg_not_found?.length > 0 && (
            <div className="banner-danger dm-banner">
              <div>
                <b>DEG videos of experiments found neither here nor on Dropbox:</b>{' '}
                {data.deg_not_found.map((x) => `${x.experiment} (${x.deg.labelled} labelled${x.in_backup ? ', in backup' : ''})`).join(', ')}
              </div>
            </div>
          )}

          <div className="ov-scroll dm-table-scroll">
            <table className="pe-table ov-table">
              <thead>
                <tr>
                  <th><input type="checkbox" checked={allShown} disabled={busy}
                             onChange={() => setSelected((s) => {
                               const next = new Set(s);
                               shown.forEach((r) => (allShown ? next.delete(r.experiment) : next.add(r.experiment)));
                               return next;
                             })} /></th>
                  {COLUMNS.map(([k, l]) => header(k, l))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const going = restoring.has(r.experiment) || r.restoring;
                  return (
                    <tr key={r.experiment} className={selected.has(r.experiment) ? 'selected' : undefined}>
                      <td><input type="checkbox" checked={selected.has(r.experiment)} disabled={busy}
                                 onChange={() => toggle(r.experiment)} /></td>
                      <td className="mono">
                        {r.experiment}
                        {r.partial && <span className="ov-badge" title="An earlier restore was interrupted: restoring again resumes it">partial</span>}
                        {r.in_backup && <span className="ov-badge" title="Its critical files are in the local backup (not the whole folder)">in backup</span>}
                        {going && <span className="ov-badge ov-badge-loaded">restoring</span>}
                      </td>
                      <td title={projectsTitle(r.deg)}>{r.deg ? r.deg.labelled : ''}</td>
                      <td title={projectsTitle(r.deg)}>{r.deg ? r.deg.videos : ''}</td>
                      <td title={r.dropbox ? `${r.dropbox.n_files} files, inspected ${ago(r.dropbox.inspected_at)}` : 'Not inspected: ⓘ'}>
                        {r.dropbox ? formatBytes(r.dropbox.bytes) : ''}
                      </td>
                      <td title={r.dropbox?.chunks}>{r.dropbox ? r.dropbox.n_chunks : ''}</td>
                      <td title={r.dropbox?.databases?.join('\n')}>
                        {r.dropbox ? (r.dropbox.has_database ? '✓' : '✗') : ''}
                        {r.dropbox?.has_pose && <span className="ov-badge" title="Pose (flyhostel/single_animal) included">pose</span>}
                      </td>
                      <td>{formatBytes(r.freeBytes)}</td>
                      <td className="ov-actions">
                        <button disabled={inspecting.has(r.experiment) || listing}
                                onClick={() => list([r.experiment])} title="Size, files and database of this experiment on Dropbox (~10 s)">
                          <i className={`fa ${inspecting.has(r.experiment) ? 'fa-spinner fa-spin' : 'fa-info-circle'}`} />
                        </button>
                        <button disabled={busy} onClick={() => setConfirm([r])} title="Copy this experiment back from Dropbox (asks for confirmation)">
                          <i className="fa fa-cloud-download" style={{ marginRight: 4 }} />Restore
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <CardResizer id="dm-restore" />
        </>
      )}

      {confirm && data && (
        <RestoreDialog records={confirm} drives={data.drives} margin={data.margin}
                       onClose={() => setConfirm(null)} onRestore={restore} />
      )}
    </section>
  );
}
