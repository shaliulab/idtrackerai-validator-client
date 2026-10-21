// DropboxFiles.js  —  "Files on Dropbox" card of the Data management tab
//
// Every file of a Dropbox folder (path relative to $DROPBOX_REMOTE, usually an
// experiment folder; ☁ in the experiments table opens one) next to its local copy in
// $FLYHOSTEL_VIDEOS (see idtrackerai_validator_server/dropbox_files.py). Files are
// selected with a glob (*.slp, flyhostel/**/0000*.mp4; without a / it is matched
// against the file name) or a regex on their path in the folder; "Delete on Dropbox" removes the
// selected files that have a local copy of the same size, and the server deletes a
// file only after hashing its local copy and finding the Dropbox content hash. With
// "Safe mode" unticked (it is ticked on every page load) every selected file is
// deleted, also those with no or another local copy.

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import api from './api';
import CardResizer from './CardResizer';
import { useConsole } from './MessageConsole';
import { formatBytes } from './DataManagementTab';

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);

// rows rendered at most (the counts and the deletion cover every match)
const MAX_ROWS = 1000;

const STATUS = {
  verified: { cls: 'ok', title: 'The local copy has the same Dropbox content hash (hashed earlier)' },
  'same size': { cls: 'ok', title: 'The local copy has the same size; its contents are hashed before deleting' },
  'different size': { cls: 'bad', title: 'The local copy has another size: not deleted' },
  'different content': { cls: 'bad', title: 'The local copy has the same size but other contents: not deleted' },
  'no local copy': { cls: 'none', title: 'Only on Dropbox: not deleted' },
  'local copy in backup': { cls: 'warn', title: 'The local path leads into the backup drive: not deleted (it would leave one copy)' },
};
const DELETABLE = new Set(['verified', 'same size']);

const LOCAL = {
  any: ['any', () => true],
  deletable: ['same size or verified', (f) => DELETABLE.has(f.status)],
  other: ['missing or different', (f) => !DELETABLE.has(f.status)],
};

// glob -> regex: * any characters but /, ** anything, ? one character but /, [...] kept;
// without a / the glob is matched against the file name in any subfolder
export function globToRegex(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i += 1;
        if (glob[i + 1] === '/') { i += 1; out += '(?:.*/)?'; } else out += '.*';
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else if (c === '[') {
      const end = glob.indexOf(']', i + 2);
      if (end < 0) out += '\\[';
      else { out += `[${glob.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`; i = end; }
    } else out += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return `${glob.includes('/') ? '^' : '(?:^|/)'}${out}$`;
}

const storedMode = () => { try { return localStorage.getItem('fh-dbx-pattern-mode') || 'glob'; } catch { return 'glob'; } };

function DeleteDialog({ folder, pattern, files, safe, onClose, onDelete }) {
  const [typed, setTyped] = useState('');
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const bytes = files.reduce((acc, f) => acc + f.size, 0);
  const word = String(files.length);
  const unbacked = files.filter((f) => !DELETABLE.has(f.status));
  const unbackedBytes = unbacked.reduce((acc, f) => acc + f.size, 0);

  return (
    <div className="md-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card md-dialog dm-dialog" role="dialog" aria-label="Delete files on Dropbox">
        <header className="card-header">
          <span>Delete files on Dropbox</span>
          <span className="ov-count mono">{folder}</span>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="ov-x" title="Close (Esc)" onClick={onClose}>×</button>
        </header>
        <div className="card-body md-body">
          <p>
            Deletes <b>{files.length} files ({formatBytes(bytes)})</b> on Dropbox
            {pattern ? <> matching <span className="mono">{pattern}</span></> : ''}. The local copies are not touched.
          </p>
          {safe ? (
            <p>
              The server lists the folder on Dropbox, hashes each local copy (~150 MB/s, {formatBytes(bytes)} to read)
              and deletes only the files whose Dropbox content hash it finds again; the others are kept and listed in
              the console. Deleted files go to Dropbox's deleted files, where they can be restored for a while.
            </p>
          ) : (
            <div className="banner-danger dm-banner">
              <div>
                <b>Safe mode is off:</b> local copies are not checked.
                {unbacked.length > 0
                  ? <> <b>{unbacked.length} of these files ({formatBytes(unbackedBytes)}) have no local copy of the same
                    size</b> and will only remain in Dropbox's deleted files, for a limited time.</>
                  : ' Every one of these files has a local copy of the same size (not hashed).'}
              </div>
            </div>
          )}
          <div className="dm-files mono dbx-preview">
            {files.slice(0, 20).map((f) => <div key={f.path}>{f.path}</div>)}
            {files.length > 20 && <div>… {files.length - 20} more</div>}
          </div>
          <label className="field dm-confirm">
            Type the number of files, <b className="mono">{word}</b>, to confirm
            <input type="text" value={typed} autoFocus spellCheck={false}
                   onChange={(e) => setTyped(e.target.value.trim())} onKeyDown={(e) => e.stopPropagation()}
                   style={{ width: 120 }} />
          </label>
        </div>
        <footer className="md-footer">
          <span className="spacer" style={{ flex: 1 }} />
          <button onClick={onClose}>Cancel</button>
          <button className="btn-danger solid" disabled={typed !== word}
                  onClick={() => onDelete(files.map((f) => f.path))}>
            <i className="fa fa-trash" style={{ marginRight: 6 }} />Delete {formatBytes(bytes)} on Dropbox{safe ? '' : ' (safe mode off)'}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default function DropboxFiles({ request }) {
  const { log, trackJob } = useConsole();
  const ref = useRef(null);
  const [folder, setFolder] = useState('');
  const [listing, setListing] = useState(null);
  const [remote, setRemote] = useState('');
  const [busy, setBusy] = useState(null);            // 'list' | 'delete'
  const [pattern, setPattern] = useState('');
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [mode, setModeState] = useState(storedMode);   // 'glob' | 'regex'
  const setMode = (m) => {
    setModeState(m);
    try { localStorage.setItem('fh-dbx-pattern-mode', m); } catch { /* ignore */ }
  };
  const [local, setLocal] = useState('any');
  const [confirm, setConfirm] = useState(null);
  const [safe, setSafe] = useState(true);

  const fetchListing = useCallback((f) => api.get('/api/dropbox/files', { params: { folder: f } })
    .then((r) => {
      const data = unwrap(r.data);
      setRemote(data.remote);
      setListing(data.listing);
      return data.listing;
    })
    .catch((err) => log('error', `Could not read the Dropbox listing of ${f}: ${err.response?.data?.error || err.message}`)), [log]);

  const list = useCallback((f) => {
    const target = f.trim().replace(/^\/+|\/+$/g, '');
    if (!target) return;
    setBusy('list');
    api.post('/api/dropbox/files/list', { folder: target })
      .then((r) => trackJob(unwrap(r.data)))
      .then((job) => {
        if (job?.status === 'done') log('success', `${job.result.files} files in ${target} on Dropbox`);
        return fetchListing(target);
      })
      .catch((err) => log('error', `Could not list ${target} on Dropbox: ${err.response?.data?.error || err.message}`))
      .finally(() => setBusy(null));
  }, [trackJob, log, fetchListing]);

  // ☁ in the experiments table: show that folder (its last listing, or list it)
  const handled = useRef(null);
  useEffect(() => {
    if (!request?.folder || handled.current === request) return;
    handled.current = request;
    setFolder(request.folder);
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    fetchListing(request.folder).then((l) => { if (l === null) list(request.folder); });
  }, [request, fetchListing, list]);

  const regex = useMemo(() => {
    if (!pattern) return { test: () => true };
    try {
      return new RegExp(mode === 'glob' ? globToRegex(pattern) : pattern, ignoreCase ? 'i' : '');
    } catch (e) { return { error: e.message }; }
  }, [pattern, ignoreCase, mode]);

  const matched = useMemo(() => {
    if (!listing || regex.error) return [];
    const keep = LOCAL[local][1];
    return listing.files.filter((f) => regex.test(f.path) && keep(f));
  }, [listing, regex, local]);

  const summary = useMemo(() => {
    const byStatus = {};
    matched.forEach((f) => {
      const s = byStatus[f.status] ?? (byStatus[f.status] = { n: 0, bytes: 0 });
      s.n += 1;
      s.bytes += f.size;
    });
    const deletable = safe ? matched.filter((f) => DELETABLE.has(f.status)) : matched;
    return { byStatus, deletable, bytes: matched.reduce((acc, f) => acc + f.size, 0) };
  }, [matched, safe]);

  const remove = useCallback((paths, safeMode) => {
    const target = listing.folder;
    setConfirm(null);
    setBusy('delete');
    api.post('/api/dropbox/files/delete', { folder: target, paths, safe: safeMode })
      .then((r) => trackJob(unwrap(r.data)))
      .then((job) => {
        if (!job?.result) return;
        const { deleted, freed, kept, errors } = job.result;
        log(deleted === paths.length ? 'success' : 'warning',
          `Deleted ${deleted} of ${paths.length} files of ${target} on Dropbox (${formatBytes(freed)}${safeMode ? '' : ', safe mode off'}), log in ${job.result.log}`);
        Object.entries(kept).forEach(([reason, names]) => log('warning',
          `  kept ${names.length} (${reason}): ${names.slice(0, 10).join(', ')}${names.length > 10 ? ', …' : ''}`));
        errors.forEach((e) => log('error', `  rclone: ${e}`));
      })
      .catch((err) => log('error', `Could not delete on Dropbox: ${err.response?.data?.error || err.message}`))
      .finally(() => { setBusy(null); fetchListing(target); });
  }, [listing, trackJob, log, fetchListing]);

  return (
    <section className="card ov-table-card" ref={ref}>
      <header className="card-header">
        <span>Files on Dropbox</span>
        {listing && (
          <span className="ov-count">
            {matched.length} of {listing.files.length} files · <span className="mono">{listing.remote}</span>
            {' '}· listed {new Date(listing.listed_at * 1000).toLocaleString()}
          </span>
        )}
      </header>
      <div className="toolbar dm-restore-toolbar">
        <label className="field">
          Folder
          <input type="text" className="mono" placeholder="FlyHostel1/6X/2025-10-08_16-00-00" value={folder}
                 spellCheck={false} style={{ width: 300 }}
                 onChange={(e) => setFolder(e.target.value)}
                 onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') list(folder); }} />
        </label>
        <button onClick={() => list(folder)} disabled={!folder.trim() || busy}
                title={`List this folder of ${remote || 'Dropbox'} (recursively) and compare each file with its local copy (~6 s per 3000 files)`}>
          <i className={`fa ${busy === 'list' ? 'fa-spinner fa-spin' : 'fa-cloud'}`} style={{ marginRight: 6 }} />List
        </button>
        <label className="field" title={mode === 'glob'
          ? 'Glob on the path in the folder: * = any characters but /, ** = any subfolders, ? = one character, [0-4] = a set. Without a / it is matched against the file name, in any subfolder (empty = every file)'
          : 'JavaScript regular expression searched in the path in the folder, e.g. ^0000[0-4]\\d\\.(mp4|npz)$ (empty = every file)'}>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="glob">Glob</option>
            <option value="regex">Regex</option>
          </select>
          <input type="text" className={`mono${regex.error ? ' dbx-invalid' : ''}`} value={pattern} spellCheck={false}
                 placeholder={mode === 'glob' ? 'e.g. *.slp or 0000[0-4]?.mp4' : 'e.g. ^00\\d{4}\\.mp4$'} style={{ width: 260 }}
                 onChange={(e) => setPattern(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </label>
        <label className="field">
          <input type="checkbox" checked={ignoreCase} onChange={(e) => setIgnoreCase(e.target.checked)} />ignore case
        </label>
        <label className="field">
          Local copy
          <select value={local} onChange={(e) => setLocal(e.target.value)}>
            {Object.entries(LOCAL).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <span className="spacer" style={{ flex: 1 }} />
        <label className="field" title="Ticked: only files with a local copy of the same contents are deleted. Unticked: every selected file, also those only on Dropbox">
          <input type="checkbox" checked={safe} onChange={(e) => setSafe(e.target.checked)} />Safe mode
        </label>
        <button className="btn-danger solid" disabled={!summary.deletable.length || !!busy}
                onClick={() => setConfirm({ files: summary.deletable, safe })}
                title={safe ? 'Delete on Dropbox the matching files that have a local copy of the same size (asks for confirmation; local copies are hashed first)'
                  : 'Delete on Dropbox every matching file, whatever is here (asks for confirmation)'}>
          <i className={`fa ${busy === 'delete' ? 'fa-spinner fa-spin' : 'fa-trash'}`} style={{ marginRight: 6 }} />
          Delete {summary.deletable.length || ''} on Dropbox
          {summary.deletable.length ? ` (${formatBytes(summary.deletable.reduce((acc, f) => acc + f.size, 0))})` : ''}
        </button>
      </div>

      {!safe && (
        <div className="banner-danger dm-banner">
          <div><b>Safe mode is off:</b> the delete button removes every matching file on Dropbox, also those with no local copy.</div>
        </div>
      )}
      {regex.error && (
        <div className="banner-danger dm-banner">
          <div>
            Invalid {mode}: {regex.error}
            {mode === 'regex' && /(^|[^\\.\])])[*?]/.test(pattern) && (
              <> — this looks like a glob: <button className="ov-link" onClick={() => setMode('glob')}>match it as a glob</button></>
            )}
          </div>
        </div>
      )}
      {!listing && <div className="dm-restore-note">Type a folder and press <b>List</b>, or ☁ on an experiment above.</div>}
      {listing && (
        <div className="dm-restore-note">
          {matched.length} files match ({formatBytes(summary.bytes)}):{' '}
          {Object.entries(summary.byStatus).map(([s, { n, bytes }]) => `${n} ${s} (${formatBytes(bytes)})`).join(' · ') || 'none'}
          {matched.length > MAX_ROWS && ` — showing the first ${MAX_ROWS}`}
        </div>
      )}

      {listing && (
        <div className="ov-scroll dm-table-scroll">
          <table className="pe-table ov-table">
            <thead><tr><th>Path</th><th>On Dropbox</th><th>Local</th><th>Local copy</th></tr></thead>
            <tbody>
              {matched.slice(0, MAX_ROWS).map((f) => {
                const s = STATUS[f.status] ?? { cls: 'none', title: '' };
                return (
                  <tr key={f.path}>
                    <td className="mono">{f.path}</td>
                    <td>{formatBytes(f.size)}</td>
                    <td>{formatBytes(f.local_size)}</td>
                    <td><span className={`dm-status dm-${s.cls}`} title={s.title}>{f.status}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <CardResizer id="dm-dropbox-files" />

      {confirm && listing && (
        <DeleteDialog folder={listing.folder} pattern={pattern && `${mode} ${pattern}`} files={confirm.files} safe={confirm.safe}
                      onClose={() => setConfirm(null)} onDelete={(paths) => remove(paths, confirm.safe)} />
      )}
    </section>
  );
}
