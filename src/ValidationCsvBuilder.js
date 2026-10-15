// ValidationCsvBuilder.js  —  "Validation CSV" card of the Group viewer
//
// Builds rows of <basedir>/flyhostel/validation/validation.csv, the manual
// corrections flyhostel applies when it rebuilds the validated tables
// (flyhostel/data/human_validation/cvat/validation_csv.py). In that file
// `fragment` is the fragment of the RAW ROI_0 table, whose ids restart in every
// chunk, and `local_identity` is the fly's local identity in the row's chunk, so
// every row stays within one chunk. The card shows the raw blobs of the displayed
// frame for that reason, and turns "fly N" into the chunk's local identity
// (GET /api/validation/frame/<n>, /api/validation/lid_map).
//
// Entries wait in a list (kept per experiment in localStorage) until they are
// downloaded or appended to the experiment's file (POST /api/validation/csv,
// which keeps a copy of the previous file).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from './api';
import { useConsole } from './MessageConsole';

const COLUMNS = [
  'frame_number', 'first_frame_number', 'last_frame_number',
  'x', 'y', 'fragment', 'local_identity', 'by_identity', 'replace',
];

const MODES = {
  assign: {
    label: 'Assign blob',
    help: 'Every blob of the picked raw fragment between From and To becomes the target fly. '
      + 'Fixes a wrong or missing identity (fly shown as 0, or as another fly).',
  },
  swap: {
    label: 'Swap blobs',
    help: 'Two blobs whose identities are exchanged: pick both on the same frame (click the frame twice). '
      + 'Writes one "assign" row for each.',
  },
  add: {
    label: 'Add missing fly',
    help: 'Adds the target fly at the picked point in every frame of the range, without touching its other blobs. '
      + 'For a fly that was not detected (hidden, or merged with another fly).',
  },
  pin: {
    label: 'Pin fly to point',
    help: 'Removes the target fly\'s blobs in the range and places it at the picked point instead. '
      + 'For a still fly whose track jumps around or onto another fly.',
  },
};
const BLOB_MODES = new Set(['assign', 'swap']);

// Pixels (native frame) within which a click picks a blob.
const PICK_RADIUS = 40;

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);
const fmt = (v) => (v == null ? 'NaN' : typeof v === 'boolean' ? (v ? 'True' : 'False') : String(v));
const today = () => new Date().toISOString().slice(0, 10);
const storageKey = (experiment) => `fh-vcsv-pending:${experiment}`;

function loadPending(experiment) {
  try { return JSON.parse(localStorage.getItem(storageKey(experiment))) || []; }
  catch { return []; }
}

export function entriesToCsv(entries, withHeader = true) {
  const lines = withHeader ? [COLUMNS.join(',')] : [];
  entries.forEach((entry) => {
    lines.push(`# ${entry.comment}`);
    entry.rows.forEach((row) => lines.push(COLUMNS.map((c) => fmt(row[c])).join(',')));
  });
  return `${lines.join('\n')}\n`;
}

// The validated blob drawn closest to (x, y): which fly the viewer shows there.
function shownAs(val, x, y) {
  let best = null;
  (val || []).forEach((b) => {
    const d = Math.hypot(b.x - x, b.y - y);
    if (d < 15 && (!best || d < best.d)) best = { d, identity: b.identity };
  });
  return best?.identity ?? null;
}

const toInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

export default function ValidationCsvBuilder({ frameNumber, isPlaying, numberOfAnimals, frameClick, setFrameNumber }) {
  const { log } = useConsole();
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem('fh-vcsv-open') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('fh-vcsv-open', open ? '1' : '0'); } catch { /* ignore */ }
  }, [open]);

  const [info, setInfo] = useState(null);       // /api/validation/frame/<n>
  const [error, setError] = useState(null);
  const experiment = info?.experiment ?? null;

  const [mode, setMode] = useState('assign');
  const [picks, setPicks] = useState([]);       // raw blobs picked, with the frame they were picked on
  const [point, setPoint] = useState(null);     // {x, y}
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [targets, setTargets] = useState(['', '']);   // fly identities (swap: one per pick)
  const [lidOverride, setLidOverride] = useState('');
  const [breakFragment, setBreakFragment] = useState(false);
  const [comment, setComment] = useState('');

  const [pending, setPending] = useState([]);
  const [showFile, setShowFile] = useState(null);     // {path, text} of the current file
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  // ── Frame data: raw blobs of the displayed frame (not while playing) ──
  useEffect(() => {
    if (!open || isPlaying || !Number.isFinite(frameNumber)) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const data = unwrap((await api.get(`/api/validation/frame/${frameNumber}`)).data);
        if (!cancelled) { setInfo(data); setError(null); }
      } catch (e) {
        if (!cancelled) setError(e.response?.data?.error || e.message);
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, isPlaying, frameNumber]);

  // Pending entries belong to one experiment: reload them when it changes.
  useEffect(() => {
    if (!experiment) return;
    setPending(loadPending(experiment));
    setPicks([]);
    setPoint(null);
    setShowFile(null);
  }, [experiment]);

  const savePending = useCallback((next) => {
    setPending(next);
    if (!experiment) return;
    try {
      if (next.length) localStorage.setItem(storageKey(experiment), JSON.stringify(next));
      else localStorage.removeItem(storageKey(experiment));
    } catch { /* ignore */ }
  }, [experiment]);

  const resetForm = () => {
    setPicks([]); setPoint(null); setFrom(''); setTo('');
    setTargets(['', '']); setLidOverride(''); setComment('');
  };

  // ── Picking ──
  const pickBlob = useCallback((blob) => {
    if (!info || blob.fragment == null) return;
    const pick = {
      ...blob,
      frame: info.frame_number,
      chunk: info.chunk,
      shown: shownAs(info.val, blob.x, blob.y),
    };
    let next = [pick];
    if (mode === 'swap') {
      const others = picks.filter((p) => !(p.frame === pick.frame && p.in_frame_index === pick.in_frame_index));
      next = [...(others.length >= 2 ? [] : others), pick];
    }
    setPicks(next);
    // Range: from this frame to the end of the (shortest) picked fragment.
    const ends = next.map((p) => p.fragment_frames?.[1]).filter((v) => v != null);
    setFrom(String(Math.min(...next.map((p) => p.frame))));
    if (ends.length) setTo(String(Math.min(...ends)));
    // A swap gives each blob the fly the other one is shown as.
    if (mode === 'swap' && next.length === 2) {
      setTargets([String(next[1].shown ?? ''), String(next[0].shown ?? '')]);
    }
  }, [info, mode, picks]);

  // Clicks on the frame: nearest raw blob in blob modes, the point otherwise.
  useEffect(() => {
    if (!open || !frameClick || !info) return;
    if (BLOB_MODES.has(mode)) {
      let best = null;
      info.raw.forEach((b) => {
        const d = Math.hypot(b.x - frameClick.x, b.y - frameClick.y);
        if (d <= PICK_RADIUS && (!best || d < best.d)) best = { d, b };
      });
      if (best) pickBlob(best.b);
    } else {
      setPoint({ x: frameClick.x, y: frameClick.y });
      if (from === '') setFrom(String(info.frame_number));
      if (to === '') setTo(String(info.frame_number));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameClick]);

  const changeMode = (m) => {
    setMode(m);
    setPicks([]);
    setPoint(null);
    setTargets(['', '']);
  };

  // ── Rows ──
  const lidFor = (map, identity) => {
    if (lidOverride !== '') return toInt(lidOverride);
    const v = map?.[String(identity)];
    return v == null ? null : Number(v);
  };

  // {comment, rows} for the form, or throws an Error saying what is missing.
  const buildEntry = async () => {
    const first = toInt(from);
    const last = toInt(to);
    if (first == null || last == null) throw new Error('set From and To');
    if (last < first) throw new Error('To is before From');
    const chunksize = info.chunksize;

    if (BLOB_MODES.has(mode)) {
      const need = mode === 'swap' ? 2 : 1;
      if (picks.length < need) throw new Error(mode === 'swap' ? 'pick two blobs' : 'pick a blob');
      const chunk = picks[0].chunk;
      if (picks.some((p) => p.chunk !== chunk)) throw new Error('both blobs must be in the same chunk');
      if (Math.floor(first / chunksize) !== chunk || Math.floor(last / chunksize) !== chunk) {
        throw new Error(`fragment ids are per chunk: keep From and To inside chunk ${chunk} `
          + `(${chunk * chunksize}–${(chunk + 1) * chunksize - 1})`);
      }
      const { maps } = unwrap((await api.get(`/api/validation/lid_map?first=${first}&last=${first}`)).data);
      const rows = [];
      const parts = [];
      picks.forEach((p, i) => {
        const identity = toInt(targets[i]);
        if (identity == null) throw new Error(`choose the target fly${need > 1 ? ` of blob ${i + 1}` : ''}`);
        const lid = lidFor(maps[String(chunk)], identity);
        if (lid == null) throw new Error(`fly ${identity} has no local identity in chunk ${chunk}; type it in "local id"`);
        rows.push({
          frame_number: first, first_frame_number: first, last_frame_number: last,
          x: null, y: null, fragment: p.fragment, local_identity: lid,
          by_identity: false, replace: !breakFragment,
        });
        parts.push(`fragment ${p.fragment} (shown as ${p.shown ?? '?'}) -> fly ${identity} (local id ${lid})`);
      });
      const what = mode === 'swap' ? 'swap' : 'assign';
      return {
        rows,
        comment: `${today()} ${what}: ${parts.join(', ')}, frames ${first}-${last}, chunk ${chunk}`
          + `${breakFragment ? ', new fragment ids' : ''}${comment.trim() ? ` | ${comment.trim()}` : ''}`,
      };
    }

    if (!point) throw new Error('click the frame to place the point');
    const identity = toInt(targets[0]);
    if (identity == null) throw new Error('choose the target fly');
    // One row per chunk: local identities change between chunks.
    const { maps } = unwrap((await api.get(`/api/validation/lid_map?first=${first}&last=${last}`)).data);
    const rows = [];
    const lids = [];
    for (let chunk = Math.floor(first / chunksize); chunk <= Math.floor(last / chunksize); chunk += 1) {
      const a = Math.max(first, chunk * chunksize);
      const b = Math.min(last, (chunk + 1) * chunksize - 1);
      const lid = lidFor(maps[String(chunk)], identity);
      if (lid == null) throw new Error(`fly ${identity} has no local identity in chunk ${chunk}; type it in "local id"`);
      rows.push({
        frame_number: a, first_frame_number: a, last_frame_number: b,
        x: point.x, y: point.y, fragment: null, local_identity: lid,
        by_identity: false, replace: mode === 'pin',
      });
      lids.push(lid);
    }
    const what = mode === 'pin' ? 'pin' : 'add';
    return {
      rows,
      comment: `${today()} ${what}: fly ${identity} (local id ${[...new Set(lids)].join('/')}) at (${point.x}, ${point.y}), `
        + `frames ${first}-${last}${comment.trim() ? ` | ${comment.trim()}` : ''}`,
    };
  };

  const addEntry = async () => {
    try {
      const entry = await buildEntry();
      savePending([...pending, { ...entry, id: Date.now() }]);
      resetForm();
    } catch (e) {
      log('warning', `Validation CSV: ${e.response?.data?.error || e.message}`);
    }
  };

  const csvText = useMemo(() => entriesToCsv(pending), [pending]);

  const download = () => {
    const url = URL.createObjectURL(new Blob([csvText], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(experiment || 'experiment').replaceAll('/', '_')}_validation_rows.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(csvText);
      log('info', 'Validation rows copied');
    } catch {
      log('warning', 'The browser refused the clipboard (needs https or localhost): use Download');
    }
  };

  const toggleFile = async () => {
    if (showFile) { setShowFile(null); return; }
    try {
      const data = unwrap((await api.get('/api/validation/csv')).data);
      setShowFile(data);
    } catch (e) {
      log('error', `Could not read validation.csv: ${e.response?.data?.error || e.message}`);
    }
  };

  const append = async () => {
    setBusy(true);
    try {
      const data = unwrap((await api.post('/api/validation/csv', {
        experiment,
        entries: pending.map(({ comment: c, rows }) => ({ comment: c, rows })),
      })).data);
      log('success', `Appended ${data.rows} rows to ${data.path}`
        + (data.backup ? ` (previous version: ${data.backup})` : ''));
      savePending([]);
      setConfirming(false);
      if (showFile) setShowFile(unwrap((await api.get('/api/validation/csv')).data));
    } catch (e) {
      log('error', `Could not write validation.csv: ${e.response?.data?.error || e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const identities = useMemo(
    () => Array.from({ length: Math.max(0, Number(numberOfAnimals) || 0) }, (_, i) => i + 1),
    [numberOfAnimals],
  );
  const lidMap = info?.lid_by_identity ?? {};
  const isBlobMode = BLOB_MODES.has(mode);
  const pickedKey = (b) => picks.findIndex((p) => p.frame === info?.frame_number && p.in_frame_index === b.in_frame_index);

  const targetSelect = (i, label) => (
    <label className="field" key={i}>
      {label}
      <select value={targets[i]} onChange={(e) => setTargets((t) => t.map((v, j) => (j === i ? e.target.value : v)))}>
        <option value="">—</option>
        {identities.map((id) => (
          <option key={id} value={id}>fly {id} (local id {lidMap[String(id)] ?? '?'})</option>
        ))}
      </select>
    </label>
  );

  return (
    <section className="card vcsv" style={open ? { flex: '0 1 auto', minHeight: 0 } : undefined}>
      <div className="card-header" style={{ cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <i className={`fa fa-caret-${open ? 'down' : 'right'}`} />
        Validation CSV
        <span className="spacer" />
        {pending.length > 0 && (
          <span className="vcsv-badge" title="Entries not written yet">{pending.length} pending</span>
        )}
      </div>

      {open && (
        <div className="card-body vcsv-body">
          {error && <div className="vcsv-error">{error}</div>}

          <div className="vcsv-modes" role="tablist">
            {Object.entries(MODES).map(([key, m]) => (
              <button key={key} className={mode === key ? 'active' : ''} onClick={() => changeMode(key)}>{m.label}</button>
            ))}
          </div>
          <div className="vcsv-help">{MODES[mode].help}</div>

          {info && isBlobMode && (
            <>
              <div className="vcsv-sub">
                Raw blobs, frame {info.frame_number} · chunk {info.chunk} · click a row or the fly on the frame
              </div>
              <table className="data-table vcsv-blobs">
                <thead>
                  <tr>
                    <th />
                    <th title="in_frame_index (raw)">Idx</th>
                    <th>X</th><th>Y</th>
                    <th title="Raw fragment and the frames it spans in this chunk">Fragment (frames)</th>
                    <th title="Raw local identity">Raw lid</th>
                    <th title="Identity the viewer shows at this position in the validated tables">Shown as</th>
                  </tr>
                </thead>
                <tbody>
                  {info.raw.map((b) => {
                    const k = pickedKey(b);
                    const disabled = b.fragment == null;
                    return (
                      <tr key={b.in_frame_index}
                          className={k >= 0 ? 'picked' : ''}
                          style={{ cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }}
                          title={disabled ? 'No fragment (crossing): use "Pin fly to point" or "Add missing fly"' : 'Pick this blob'}
                          onClick={() => pickBlob(b)}>
                        <td>{k >= 0 ? (mode === 'swap' ? `#${k + 1}` : '●') : ''}</td>
                        <td>{b.in_frame_index}</td>
                        <td>{b.x}</td>
                        <td>{b.y}</td>
                        <td>{b.fragment ?? '—'}{b.fragment_frames ? ` (${b.fragment_frames[0]}–${b.fragment_frames[1]})` : ''}</td>
                        <td>{b.local_identity ?? '—'}</td>
                        <td>{shownAs(info.val, b.x, b.y) ?? '—'}</td>
                      </tr>
                    );
                  })}
                  {info.raw.length === 0 && <tr><td colSpan={7}>No raw blobs in this frame</td></tr>}
                </tbody>
              </table>
              {picks.length > 0 && (
                <div className="vcsv-sub">
                  Picked: {picks.map((p, i) => `${mode === 'swap' ? `#${i + 1} ` : ''}fragment ${p.fragment} at frame ${p.frame}`).join(' · ')}
                  {' '}<button className="vcsv-link" onClick={() => setPicks([])}>clear</button>
                </div>
              )}
            </>
          )}

          {!isBlobMode && (
            <div className="vcsv-sub">
              {point ? <>Point <b>({point.x}, {point.y})</b> · click the frame again to move it</> : 'Click the frame where the fly is'}
            </div>
          )}

          <div className="toolbar vcsv-form">
            <label className="field">
              From
              <input type="number" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 96 }} />
              <button title="Displayed frame" onClick={() => setFrom(String(frameNumber))}>now</button>
              {from !== '' && <button title="Go to this frame" onClick={() => setFrameNumber(toInt(from))}>go</button>}
            </label>
            <label className="field">
              To
              <input type="number" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 96 }} />
              <button title="Displayed frame" onClick={() => setTo(String(frameNumber))}>now</button>
              {info && <button title="Last frame of the displayed chunk"
                               onClick={() => setTo(String(info.chunk_frames[1]))}>chunk end</button>}
              {to !== '' && <button title="Go to this frame" onClick={() => setFrameNumber(toInt(to))}>go</button>}
            </label>
          </div>
          <div className="toolbar vcsv-form">
            {mode === 'swap'
              ? [targetSelect(0, 'Blob #1 becomes'), targetSelect(1, 'Blob #2 becomes')]
              : targetSelect(0, 'Target fly')}
            <label className="field" title={`Local identity written to the CSV. Empty: looked up per chunk in ${info?.lid_source ?? 'CONCATENATION_VAL'}`}>
              local id
              <input type="number" value={lidOverride} placeholder="auto" onChange={(e) => setLidOverride(e.target.value)} />
            </label>
            {isBlobMode && (
              <label className="field check" title="replace=False: the blobs get new fragment ids, so the rest of the old fragment keeps its identity">
                <input type="checkbox" checked={breakFragment} onChange={(e) => setBreakFragment(e.target.checked)} />
                new fragment ids
              </label>
            )}
          </div>
          <div className="toolbar vcsv-form">
            <label className="field" style={{ flex: 1 }}>
              Note
              <input type="text" value={comment} placeholder="optional, written as a # comment"
                     onChange={(e) => setComment(e.target.value)} style={{ flex: 1, minWidth: 120 }} />
            </label>
            <button className="btn-primary" onClick={addEntry} disabled={!info}>
              <i className="fa fa-plus" style={{ marginRight: 6 }} />Add
            </button>
          </div>

          {pending.length > 0 && (
            <>
              <ul className="vcsv-pending">
                {pending.map((entry) => (
                  <li key={entry.id}>
                    <span title={entriesToCsv([entry], false)}>{entry.comment}</span>
                    <span className="vcsv-rows">{entry.rows.length} row{entry.rows.length === 1 ? '' : 's'}</span>
                    <button className="vcsv-link" title="Remove"
                            onClick={() => savePending(pending.filter((e) => e.id !== entry.id))}>✕</button>
                  </li>
                ))}
              </ul>
              <pre className="vcsv-preview">{csvText}</pre>
            </>
          )}

          <div className="toolbar vcsv-form">
            <button onClick={() => setConfirming(true)} className="btn-primary" disabled={!pending.length || confirming}>
              <i className="fa fa-floppy-o" style={{ marginRight: 6 }} />Append to validation.csv…
            </button>
            <button onClick={download} disabled={!pending.length}>Download</button>
            <button onClick={copy} disabled={!pending.length}>Copy</button>
            <button onClick={() => savePending([])} disabled={!pending.length}>Clear</button>
            <span className="spacer" style={{ flex: 1 }} />
            <button onClick={toggleFile} disabled={!info}>{showFile ? 'Hide file' : 'Show file'}</button>
          </div>

          {confirming && (
            <div className="vcsv-banner" role="alertdialog">
              <div>
                Append <b>{pending.reduce((n, e) => n + e.rows.length, 0)}</b> rows to the validation.csv of <code>{experiment}</code>?
                A copy of the current file goes to <code>validation_csv_backups/</code>. The corrections take effect the
                next time the validated tables are rebuilt.
              </div>
              <div className="banner-actions">
                <button className="btn-primary" onClick={append} disabled={busy}>{busy ? 'Writing…' : 'Append'}</button>
                <button onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
              </div>
            </div>
          )}

          {showFile && (
            <>
              <div className="vcsv-sub"><code>{showFile.path}</code>{showFile.exists ? '' : ' (does not exist yet)'}</div>
              {showFile.exists && <pre className="vcsv-preview">{showFile.text}</pre>}
            </>
          )}
        </div>
      )}
    </section>
  );
}
