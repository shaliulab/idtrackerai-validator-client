// DataManagementTab.js  —  disk usage and backup status of every experiment folder
//
// Lists every $FLYHOSTEL_VIDEOS/FlyHostel<N>/<X>X/<date>/ folder with the space it
// takes and whether flyhostel's backup copied its critical files to
// /flyhostel_data/backup (see idtrackerai_validator_server/data_management.py).
// The server keeps the last scan; "Scan all" (a background job of minutes) or the
// per-row ↻ refreshes it. "Delete" is only offered for experiments whose backup is
// complete: the dialog needs the experiment name typed, and the server rescans the
// experiment before deleting its folder. Chunks that are not consecutive (tracking or
// raw recording) are listed as problems: ⚠ next to the name, details under ▸.
// Below the table, "Restore from Dropbox" (RestoreFromDropbox.js) brings back
// experiments that are only on Dropbox.

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import api from './api';
import CardResizer from './CardResizer';
import { useConsole } from './MessageConsole';
import RestoreFromDropbox from './RestoreFromDropbox';

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);

const STATUS = {
  ok: { label: 'backed up', cls: 'ok', title: 'Every critical file has an identical copy in the backup' },
  outdated: { label: 'outdated', cls: 'warn', title: 'Some critical files changed since they were backed up' },
  incomplete: { label: 'incomplete', cls: 'bad', title: 'Some critical files have no copy in the backup' },
  none: { label: 'no backup', cls: 'bad', title: 'There is no folder for this experiment in the backup' },
};
const NOT_SCANNED = { label: 'not scanned', cls: 'none', title: 'Not scanned yet: press "Scan all" or ↻' };

export function formatBytes(bytes) {
  if (bytes == null) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1000 && i < units.length - 1) { value /= 1000; i += 1; }
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

const ago = (seconds) => {
  if (!seconds) return '';
  const d = (Date.now() / 1000 - seconds) / 86400;
  if (d < 1 / 24) return 'just now';
  if (d < 1) return `${Math.round(d * 24)} h ago`;
  return `${Math.round(d)} d ago`;
};

const sameExperiment = (a, b) => !!a && !!b && a.replace(/\//g, '_') === b.replace(/\//g, '_');

const COLUMNS = [
  ['experiment', 'Experiment'],
  ['local_bytes', 'On disk'],
  ['backup_bytes', 'In backup'],
  ['local_only_bytes', 'Not in backup'],
  ['status', 'Backup'],
  ['in_dropbox_index', 'Dropbox index'],
  ['scanned_at', 'Scanned'],
];

function Stat({ label, value, sub }) {
  return (
    <div className="card ov-stat">
      <div className="ov-stat-label">{label}</div>
      <div className="ov-stat-value">{value}</div>
      {sub && <div className="ov-stat-sub">{sub}</div>}
    </div>
  );
}

function StatusBadge({ record }) {
  const s = record.status ? STATUS[record.status] : NOT_SCANNED;
  let title = s.title;
  if (record.status === 'incomplete' || record.status === 'none') title += ` (${record.n_missing} of ${record.n_critical} missing)`;
  if (record.status === 'outdated') title += ` (${record.n_changed} of ${record.n_critical})`;
  return <span className={`dm-status dm-${s.cls}`} title={title}>{s.label}</span>;
}

function Details({ record, backupChunks }) {
  return (
    <div className="dm-details">
      {record.problems?.length > 0 && (
        <div className="dm-problems">
          <b>⚠ Chunks are not consecutive:</b>
          <ul>{record.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      <div>
        <b>Folder</b> <span className="mono">{record.path}</span>
        {record.backup_path && <> &nbsp;·&nbsp; <b>Backup</b> <span className="mono">{record.backup_path}</span></>}
      </div>
      <div>
        {record.n_files} files, {record.n_chunks} raw chunks
        {record.chunks_after_backup > 0 && ` (${record.chunks_after_backup} from chunk ${backupChunks} on, never backed up here)`}
        {' · '}{record.n_critical} critical files ({formatBytes(record.critical_bytes)})
        {record.has_database
          ? (record.tracked_chunks ? ` · tracked chunks ${record.tracked_chunks[0]}–${record.tracked_chunks[1]}` : ' · no tracking in the database')
          : ' · no database'}
      </div>
      {Object.keys(record.local_only || {}).length > 0 && (
        <div>
          <b>Not in the backup:</b>{' '}
          {Object.entries(record.local_only).map(([k, v]) => `${k} ${formatBytes(v)}`).join(' · ')}
        </div>
      )}
      {record.n_missing > 0 && (
        <div className="dm-files">
          <b>Critical files missing from the backup ({record.n_missing}):</b>{' '}
          <span className="mono">{record.missing.join(', ')}{record.n_missing > record.missing.length ? ', …' : ''}</span>
        </div>
      )}
      {record.n_changed > 0 && (
        <div className="dm-files">
          <b>Critical files that differ from their copy ({record.n_changed}):</b>{' '}
          <span className="mono">{record.changed.join(', ')}{record.n_changed > record.changed.length ? ', …' : ''}</span>
        </div>
      )}
    </div>
  );
}

function DeleteDialog({ record, backupChunks, onClose, onDelete }) {
  const [typed, setTyped] = useState('');
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="md-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card md-dialog dm-dialog" role="dialog" aria-label="Delete experiment">
        <header className="card-header">
          <span>Delete experiment</span>
          <span className="ov-count mono">{record.experiment}</span>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="ov-x" title="Close (Esc)" onClick={onClose}>×</button>
        </header>
        <div className="card-body md-body">
          <p>
            This permanently deletes <span className="mono">{record.path}</span> ({formatBytes(record.local_bytes)},{' '}
            {record.n_files} files) and removes its database from <span className="mono">index.txt</span>.
            The copy in <span className="mono">{record.backup_path}</span> is not touched.
          </p>
          <p>
            Its {record.n_critical} critical files are in the backup
            {record.scanned_at ? ` (scanned ${ago(record.scanned_at)}; the server checks again before deleting)` : ''}.
          </p>
          {record.local_only_bytes > 0 && (
            <div className="banner-danger dm-banner">
              <div>
                <b>{formatBytes(record.local_only_bytes)} exist only here and will be lost</b>
                {record.chunks_after_backup > 0 && <> — including {record.chunks_after_backup} raw chunks
                  from chunk {backupChunks} on (only on Dropbox, if at all)</>}:
                <div className="dm-lost">
                  {Object.entries(record.local_only).map(([k, v]) => `${k} ${formatBytes(v)}`).join(' · ')}
                </div>
                {record.in_dropbox_index === false && <div><b>This experiment is not in the Dropbox index.</b></div>}
              </div>
            </div>
          )}
          <label className="field dm-confirm">
            Type <b className="mono">{record.experiment}</b> to confirm
            <input type="text" value={typed} autoFocus spellCheck={false}
                   onChange={(e) => setTyped(e.target.value.trim())} onKeyDown={(e) => e.stopPropagation()}
                   style={{ width: 320 }} />
          </label>
        </div>
        <footer className="md-footer">
          <span className="spacer" style={{ flex: 1 }} />
          <button onClick={onClose}>Cancel</button>
          <button className="btn-danger solid" disabled={typed !== record.experiment}
                  onClick={() => onDelete(record.experiment)}>
            <i className="fa fa-trash" style={{ marginRight: 6 }} />Delete {formatBytes(record.local_bytes)}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default function DataManagementTab({ active, currentExperiment }) {
  const { log, trackJob } = useConsole();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [scanning, setScanning] = useState(new Set());   // experiments being scanned ('*' = all)
  const [deleting, setDeleting] = useState(new Set());
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [hostelFilter, setHostelFilter] = useState('');
  const [sort, setSort] = useState({ key: 'local_bytes', desc: true });
  const [expanded, setExpanded] = useState(null);
  const [toDelete, setToDelete] = useState(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);
    return api.get('/api/data_management')
      .then((r) => setData(unwrap(r.data)))
      .catch((err) => {
        const msg = err.response?.data?.error || err.message;
        setError(msg);
        log('error', `Could not load the data management table: ${msg}`);
      })
      .finally(() => setLoading(false));
  }, [log]);

  useEffect(() => {
    if (active && !data && !loading && !error) fetchData();
  }, [active, data, loading, error, fetchData]);

  const setBusy = (setter, key, on) => setter((s) => {
    const next = new Set(s);
    if (on) next.add(key); else next.delete(key);
    return next;
  });

  const scan = useCallback((experiments) => {
    const key = experiments ? experiments[0] : '*';
    setBusy(setScanning, key, true);
    api.post('/api/data_management/scan', { experiments })
      .then((r) => trackJob(unwrap(r.data)))
      .then((job) => {
        if (job?.status !== 'done') return;
        const { scanned, errors } = job.result;
        log(errors.length ? 'warning' : 'success', `Scanned ${scanned} experiment${scanned === 1 ? '' : 's'}`
          + (errors.length ? `, ${errors.length} failed` : ''));
        errors.forEach((e) => log('warning', `  ${e}`));
        return fetchData();
      })
      .catch((err) => log('error', `Could not scan: ${err.response?.data?.error || err.message}`))
      .finally(() => setBusy(setScanning, key, false));
  }, [trackJob, log, fetchData]);

  const remove = useCallback((experiment) => {
    setToDelete(null);
    setBusy(setDeleting, experiment, true);
    api.post('/api/data_management/delete', { experiment, confirm: experiment })
      .then((r) => trackJob(unwrap(r.data)))
      .then((job) => {
        if (job?.status !== 'done') return fetchData();
        log('success', `Deleted ${experiment}: ${formatBytes(job.result.freed)} freed (${job.result.path})`);
        return fetchData();
      })
      .catch((err) => log('error', `Could not delete ${experiment}: ${err.response?.data?.error || err.message}`))
      .finally(() => setBusy(setDeleting, experiment, false));
  }, [trackJob, log, fetchData]);

  const records = useMemo(() => data?.experiments ?? [], [data]);
  const hostels = useMemo(() => [...new Set(records.map((r) => r.flyhostel))].sort(), [records]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = records.filter((r) => (!q || r.experiment.toLowerCase().includes(q))
      && (!hostelFilter || r.flyhostel === hostelFilter)
      && (!statusFilter || (statusFilter === 'problems' ? r.problems?.length > 0 : (r.status ?? 'unscanned') === statusFilter)));
    const { key, desc } = sort;
    list.sort((a, b) => {
      const va = a[key];
      const vb = b[key];
      const c = typeof va === 'number' || typeof vb === 'number'
        ? (va ?? -1) - (vb ?? -1)
        : String(va ?? '').localeCompare(String(vb ?? ''));
      return desc ? -c : c;
    });
    return list;
  }, [records, search, hostelFilter, statusFilter, sort]);

  const stats = useMemo(() => {
    const scanned = shown.filter((r) => r.status);
    const ok = scanned.filter((r) => r.status === 'ok');
    const sum = (list, k) => list.reduce((acc, r) => acc + (r[k] || 0), 0);
    return {
      scanned: scanned.length,
      total: sum(scanned, 'local_bytes'),
      ok: ok.length,
      okBytes: sum(ok, 'local_bytes'),
      okLocalOnly: sum(ok, 'local_only_bytes'),
      notOk: scanned.length - ok.length,
      notOkBytes: sum(scanned, 'local_bytes') - sum(ok, 'local_bytes'),
      oldest: scanned.reduce((m, r) => Math.min(m, r.scanned_at), Infinity),
      problems: scanned.filter((r) => r.problems?.length > 0).length,
    };
  }, [shown]);

  const header = (key, label) => (
    <th key={key} onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'experiment' }))}>
      {label}{sort.key === key ? (sort.desc ? ' ▼' : ' ▲') : ''}
    </th>
  );

  if (!data) {
    return (
      <div className="ov">
        <div className="card ov-controls toolbar">
          {loading ? 'Listing the experiment folders…' : error ? `Could not load: ${error}` : ''}
          {error && <button onClick={fetchData}>Retry</button>}
        </div>
      </div>
    );
  }

  const scanningAll = scanning.has('*') || data.scanning;

  return (
    <div className="ov">
      <div className="card ov-controls toolbar">
        <label className="field">
          <i className="fa fa-search" />
          <input type="text" placeholder="Search experiments" value={search}
                 onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.stopPropagation()}
                 style={{ width: 240 }} />
        </label>
        <label className="field">
          FlyHostel
          <select value={hostelFilter} onChange={(e) => setHostelFilter(e.target.value)}>
            <option value="">all</option>
            {hostels.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </label>
        <label className="field">
          Backup
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">all</option>
            {Object.entries(STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            <option value="unscanned">not scanned</option>
            <option value="problems">⚠ chunk gaps</option>
          </select>
        </label>
        <span className="spacer" style={{ flex: 1 }} />
        <span className="ov-count" title="Compared with the backup">
          Backup: <span className="mono">{data.backup_root}</span>
        </span>
        <button onClick={fetchData} disabled={loading} title="Reload the last scan and the free space of each drive">
          <i className={`fa fa-refresh${loading ? ' fa-spin' : ''}`} style={{ marginRight: 6 }} />Reload
        </button>
        <button onClick={() => scan(null)} disabled={scanningAll}
                title="Walk every experiment folder and its backup again (several minutes on the HDDs; runs in the background)">
          <i className={`fa ${scanningAll ? 'fa-spinner fa-spin' : 'fa-hdd-o'}`} style={{ marginRight: 6 }} />Scan all
        </button>
      </div>

      <div className="ov-stats">
        <Stat label="Experiments" value={shown.length}
              sub={`${stats.scanned} scanned${stats.scanned ? `, oldest ${ago(stats.oldest)}` : ''}`} />
        <Stat label="On disk" value={formatBytes(stats.total)} sub="scanned experiments shown" />
        <Stat label="Backed up" value={formatBytes(stats.okBytes)}
              sub={`${stats.ok} experiments, can be deleted (${formatBytes(stats.okLocalOnly)} of it not in the backup)`} />
        <Stat label="Not backed up" value={formatBytes(stats.notOkBytes)} sub={`${stats.notOk} experiments`} />
        <Stat label="Chunk gaps" value={stats.problems}
              sub="experiments whose tracked or raw chunks are not consecutive (Backup: ⚠ chunk gaps)" />
        {data.disks.map((d) => (
          <Stat key={d.path} label={`${d.role === 'backup' ? 'Backup drive' : 'Drive'} ${d.path.split('/').filter(Boolean).slice(-2, -1)[0] ?? d.path}`}
                value={`${formatBytes(d.free)} free`}
                sub={`${Math.round((100 * d.used) / d.total)}% of ${formatBytes(d.total)} · ${d.hostels.join(', ')}`} />
        ))}
      </div>

      <section className="card ov-table-card">
        <header className="card-header">
          <span>Experiment folders</span>
          <span className="ov-count">{shown.length}</span>
        </header>
        <div className="ov-scroll dm-table-scroll">
          <table className="pe-table ov-table">
            <thead>
              <tr>{COLUMNS.map(([k, l]) => header(k, l))}<th /></tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const loaded = sameExperiment(r.experiment, data.loaded || currentExperiment);
                const busy = scanning.has(r.experiment) || deleting.has(r.experiment);
                const deletable = r.status === 'ok' && !loaded && !busy;
                return (
                  <React.Fragment key={r.experiment}>
                    <tr className={expanded === r.experiment ? 'selected' : undefined}>
                      <td className="mono">
                        <button className="ov-link dm-expand" disabled={!r.status}
                                onClick={() => setExpanded((x) => (x === r.experiment ? null : r.experiment))}
                                title="Show what is and is not backed up">
                          {expanded === r.experiment ? '▾' : '▸'}
                        </button>
                        {r.experiment}
                        {loaded && <span className="ov-badge" title="Loaded in the viewer">loaded</span>}
                        {r.status && !r.has_database && <span className="ov-badge" title="No database (not analyzed)">no db</span>}
                        {r.problems?.length > 0 && (
                          <span className="dm-problem-badge" title={`Chunks are not consecutive:\n${r.problems.join('\n')}`}>⚠ gaps</span>
                        )}
                      </td>
                      <td>{formatBytes(r.local_bytes)}</td>
                      <td>{r.status && r.status !== 'none' ? formatBytes(r.backup_bytes) : ''}</td>
                      <td title={r.local_only ? Object.entries(r.local_only).map(([k, v]) => `${k} ${formatBytes(v)}`).join('\n') : undefined}>
                        {formatBytes(r.local_only_bytes)}
                      </td>
                      <td><StatusBadge record={r} /></td>
                      <td title="Listed in <FlyHostel>_dropbox_index.txt (a snapshot, may be old)">
                        {r.in_dropbox_index == null ? '' : r.in_dropbox_index ? '✓' : '✗'}
                      </td>
                      <td>{ago(r.scanned_at)}</td>
                      <td className="ov-actions">
                        <button disabled={busy || scanningAll} onClick={() => scan([r.experiment])}
                                title="Scan this experiment again">
                          <i className={`fa fa-refresh${scanning.has(r.experiment) ? ' fa-spin' : ''}`} />
                        </button>
                        <button className="btn-danger" disabled={!deletable} onClick={() => setToDelete(r)}
                                title={loaded ? 'Loaded in the viewer: load another experiment first'
                                  : r.status === 'ok' ? 'Delete this experiment folder (asks for confirmation)'
                                    : 'Only experiments whose backup is complete can be deleted'}>
                          <i className={`fa ${deleting.has(r.experiment) ? 'fa-spinner fa-spin' : 'fa-trash'}`} style={{ marginRight: 4 }} />
                          Delete
                        </button>
                      </td>
                    </tr>
                    {expanded === r.experiment && r.status && (
                      <tr className="dm-details-row">
                        <td colSpan={COLUMNS.length + 1}><Details record={r} backupChunks={data.backup_chunks} /></td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <CardResizer id="dm-table" />
      </section>

      <RestoreFromDropbox onRestored={fetchData} />

      {toDelete && (
        <DeleteDialog record={toDelete} backupChunks={data.backup_chunks}
                      onClose={() => setToDelete(null)} onDelete={remove} />
      )}
    </div>
  );
}
