// "Validation queue" card at the top of the Annotate tab: analyzed experiments (a database in index.txt)
// without the validated tables (ROI_0_VAL, IDENTITY_VAL, CONCATENATION_VAL; server experiments.VALIDATED_TABLES),
// with this person's progress (GET /api/annotate/queue, box_annotations.validation_queue):
// in progress (frames saved by me, scenes left), to do, needs Prepare scenes, annotated (every scene saved:
// Integrate + Write validated tables left). Hide takes one out of my queue (kept on the server).
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from './api';
import { useConsole } from './MessageConsole';

const STATUS = {
  in_progress: ['In progress', 'You saved frames of it; scenes left'],
  to_do: ['To do', 'Scenes ready, nothing saved by you yet'],
  no_scenes: ['Needs Prepare scenes', 'No scene_qc.csv yet: open it and press Prepare scenes'],
  annotated: ['Annotated', 'Every scene saved: Integrate and Write validated tables left'],
};
const flat = (name) => (name || '').replace(/\//g, '_').replace(/_arenas_(\d+)$/, '_arena$1');
const stored = (key, fallback) => { try { const v = localStorage.getItem(key); return v == null ? fallback : v === '1'; } catch { return fallback; } };
const store = (key, value) => { try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* ignore */ } };
const ago = (t) => {
  if (!t) return '';
  const s = Date.now() / 1000 - t;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};

// sort keys of the columns (null / missing values last in both directions)
const STATUS_RANK = { in_progress: 0, to_do: 1, no_scenes: 2, annotated: 3 };
const COLUMNS = [
  ['status', 'Status', (it) => STATUS_RANK[it.status] ?? 9],
  ['experiment', 'Experiment', (it) => it.experiment],
  ['n_animals', 'Flies', (it) => it.n_animals],
  ['scenes', 'Scenes done', (it) => (it.scenes ? it.scenes_done / it.scenes : null)],
  ['mine', 'My frames', (it) => it.mine || null],
  ['last_mine', 'Last saved by me', (it) => it.last_mine],
  // Drive exchange: published (when), downloaded copies after, never shared last
  ['exchange', 'Drive', (it) => (it.exchange?.role === 'publisher' ? it.exchange.published_at : it.exchange ? 0 : null)],
];
const ORDERS = [
  ['queue', 'Queue order', 'In progress (last worked on first), to do, Prepare scenes, annotated; then oldest first'],
  ['date_asc', 'Oldest first', 'By recording date and time, oldest first'],
  ['date_desc', 'Newest first', 'By recording date and time, newest first'],
];
const cmp = (a, b) => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return typeof a === 'string' ? a.localeCompare(b) : a - b;
};
// the recording's date_time, then the FlyHostel and arena (names sort the same way within a date)
const dateKey = (it) => (it.date ? `${it.date} ${it.experiment}` : null);

const META_LABELS = { light_cycle: 'light cycle', age_min: 'age min (d)', age_max: 'age max (d)', reference_hour: 'ZT0 (h)', GBX: 'GBX' };

// metadata of the hovered row: GET /api/annotate/queue/meta (the database's ethoscope_metadata, per column the
// values with their number of flies; the columns that vary in the metadata sheets)
function MetaPopover({ meta, item, x, y }) {
  const left = Math.min(x + 16, window.innerWidth - 380);
  const below = y + 16 + 260 < window.innerHeight;
  return (
    <div className="vq-meta" style={{ left: Math.max(8, left), top: below ? y + 16 : undefined, bottom: below ? undefined : window.innerHeight - y + 12 }}>
      <div className="vq-meta-title">{item.experiment}</div>
      {!meta ? <div className="qc-muted">Reading…</div> : meta.error && !meta.columns?.length ? <div className="sl-error">{meta.error}</div> : (
        <>
          <div className="qc-muted vq-meta-sub">
            {meta.flies} fl{meta.flies === 1 ? 'y' : 'ies'}
            {' · '}{meta.arena != null ? `arena ${meta.arena} of a ${meta.group_size}X recording` : 'no arena'}
            {meta.duration_h != null ? ` · ${meta.duration_h} h tracked` : ''}
          </div>
          <table className="vq-meta-table">
            <tbody>
              {meta.columns.map(([column, values]) => (
                <tr key={column}>
                  <th>{META_LABELS[column] || column}</th>
                  <td>{values.map(([v, n], i) => (
                    <span key={v}>{i ? ', ' : ''}{v}{values.length > 1 || n !== meta.flies ? <span className="qc-muted"> ×{n}</span> : null}</span>
                  ))}</td>
                </tr>
              ))}
              {!meta.columns.length && <tr><td className="qc-muted">No fly metadata in the database</td></tr>}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export default function ValidationQueue({ active, currentExperiment, onOpenExperiment }) {
  const { log, trackJob } = useConsole();
  const [publishing, setPublishing] = useState({});     // experiment -> true while its publish job runs
  const [open, setOpen] = useState(() => stored('fh-annotate-queue-open', true));
  const [groupsOnly, setGroupsOnly] = useState(() => stored('fh-annotate-queue-groups', true));
  const [withPrepare, setWithPrepare] = useState(() => stored('fh-annotate-queue-prepare', false));
  // {by: column id or 'queue' / 'date', dir: 1 | -1}: the order of the table and of Open next
  const [sort, setSort] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem('fh-annotate-queue-sort')); if (v?.by) return v; } catch { /* default */ }
    return { by: 'queue', dir: 1 };
  });
  useEffect(() => { try { localStorage.setItem('fh-annotate-queue-sort', JSON.stringify(sort)); } catch { /* ignore */ } }, [sort]);
  const clickColumn = (id) => setSort((s) => (s.by === id ? { by: id, dir: -s.dir } : { by: id, dir: 1 }));
  const orderValue = sort.by === 'queue' ? 'queue' : sort.by === 'date' ? (sort.dir > 0 ? 'date_asc' : 'date_desc') : '';
  const setOrder = (v) => setSort(v === 'queue' ? { by: 'queue', dir: 1 } : { by: 'date', dir: v === 'date_asc' ? 1 : -1 });
  const [showHidden, setShowHidden] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(null);
  const [hover, setHover] = useState(null);          // {item, x, y}
  const [metas, setMetas] = useState({});            // experiment -> /api/annotate/queue/meta
  const hoverTimer = useRef(null);
  const requested = useRef(new Set());
  const onRowEnter = (item, e) => {
    const { clientX: x, clientY: y } = e;
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      setHover({ item, x, y });
      if (requested.current.has(item.experiment)) return;
      requested.current.add(item.experiment);
      api.get('/api/annotate/queue/meta', { params: { experiment: item.experiment } })
        .then(({ data: d }) => setMetas((m) => ({ ...m, [item.experiment]: d })))
        .catch((err) => setMetas((m) => ({ ...m, [item.experiment]: { error: err.response?.data?.error ?? err.message, columns: [] } })));
    }, 250);
  };
  const onRowLeave = () => { clearTimeout(hoverTimer.current); setHover(null); };
  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  useEffect(() => store('fh-annotate-queue-open', open), [open]);
  useEffect(() => store('fh-annotate-queue-groups', groupsOnly), [groupsOnly]);
  useEffect(() => store('fh-annotate-queue-prepare', withPrepare), [withPrepare]);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const { data: d } = await api.get('/api/annotate/queue');
      setData(d);
    } catch (err) {
      log('error', `Validation queue: ${err.response?.data?.error ?? err.message}`);
    } finally {
      setLoading(false);
    }
  }, [log]);
  // read again when the tab is shown and when another experiment is loaded (its progress changed)
  useEffect(() => { if (active) fetchQueue(); }, [active, currentExperiment, fetchQueue]);

  const loaded = flat(currentExperiment);
  const items = useMemo(() => (data?.items || []).filter((it) => (
    (!groupsOnly || it.n_animals == null || it.n_animals > 1)
    && (withPrepare || it.status !== 'no_scenes' || it.mine > 0 || it.experiment === loaded)
    && (showHidden || !it.hidden))), [data, groupsOnly, withPrepare, showHidden, loaded]);
  // the server sends them in queue order; any other order is a stable sort of it
  const sorted = useMemo(() => {
    if (sort.by === 'queue') return items;
    const key = sort.by === 'date' ? dateKey : COLUMNS.find(([id]) => id === sort.by)?.[2];
    if (!key) return items;
    return items.map((it, i) => [it, i]).sort(([a, i], [b, j]) => {
      const ka = key(a), kb = key(b);
      if (ka == null || kb == null) return cmp(ka, kb) || i - j;     // missing last either way
      return sort.dir * cmp(ka, kb) || i - j;
    }).map(([it]) => it);
  }, [items, sort]);
  const counts = useMemo(() => {
    const c = {};
    items.forEach((it) => { if (!it.hidden) c[it.status] = (c[it.status] || 0) + 1; });
    return c;
  }, [items]);
  // next: the first one not hidden, not done, not loaded (in progress first, then to do)
  const next = sorted.find((it) => !it.hidden && it.experiment !== loaded && (it.status === 'in_progress' || it.status === 'to_do'));

  const openOne = async (experiment) => {
    setOpening(experiment);
    try { await onOpenExperiment(experiment); } finally { setOpening(null); }
  };
  // Publish to the Drive exchange as the Drive exchange tab does (its "Whole experiment" tick picks the kind)
  const publish = async (it) => {
    let whole = false;
    try { whole = JSON.parse(localStorage.getItem('fh-exchange-whole')) === true; } catch { /* minimal */ }
    const again = it.exchange?.role === 'publisher';
    const what = whole
      ? `Upload the whole experiment folder of ${it.experiment} (tens of GB) to the Drive exchange?`
      : `Make a minimal bundle of ${it.experiment} (clips of its scene frames, the database cut down to them; the first time it ` +
        `reads and segments every scene frame, about half an hour for a thousand scenes) and upload it to the Drive exchange?`;
    if (!window.confirm(what + (again ? '\n\nIt is on Drive already: only what changed is sent.' : '') +
      '\n\n("Whole experiment" in the Drive exchange tab chooses between the two.)')) return;
    setPublishing((p) => ({ ...p, [it.experiment]: true }));
    try {
      const body = { experiment: it.experiment, kind: whole ? 'full' : 'minimal' };
      let r;
      try {
        r = await api.post('/api/exchange/publish', body);
      } catch (err) {
        // scene_qc.csv looks older than the tracking: ask, then send it anyway
        const outdated = err.response?.status === 409 && err.response?.data?.outdated;
        if (!outdated) throw err;
        if (!window.confirm(`The scenes to check of ${it.experiment} (scene_qc.csv) may be out of date: ${outdated}.\n\n` +
          'Open it and Prepare scenes again first to send the current ones. Publish the old scenes anyway?')) return;
        r = await api.post('/api/exchange/publish', { ...body, outdated_ok: true });
      }
      const done = await trackJob(r.data.job);
      if (done?.status === 'done') log('success', `${it.experiment} published on the Drive exchange`);
      else if (done?.status === 'failed') log('error', `Publishing ${it.experiment} failed: ${done.error}`);
      fetchQueue();
    } catch (err) {
      log('error', `Publish ${it.experiment}: ${err.response?.data?.error ?? err.message}`);
    } finally {
      setPublishing((p) => { const n = { ...p }; delete n[it.experiment]; return n; });
    }
  };
  const hide = async (experiment, hidden) => {
    try {
      await api.post('/api/annotate/queue/hide', { experiment, hidden });
      setData((d) => d && { ...d, items: d.items.map((it) => (it.experiment === experiment ? { ...it, hidden } : it)) });
    } catch (err) {
      log('error', `Validation queue: ${err.response?.data?.error ?? err.message}`);
    }
  };

  return (
    <section className="card vq">
      <header className="card-header vq-header" onClick={() => setOpen((o) => !o)}>
        <span>{open ? '▾' : '▸'} Validation queue</span>
        <span className="ov-count">
          {data ? [
            counts.in_progress && `${counts.in_progress} in progress`,
            counts.to_do && `${counts.to_do} to do`,
            counts.no_scenes && `${counts.no_scenes} need Prepare scenes`,
            counts.annotated && `${counts.annotated} annotated, not validated`,
          ].filter(Boolean).join(' · ') || 'nothing to annotate' : loading ? 'Reading the databases…' : ''}
          {data?.me ? ` · as ${data.me}` : ''}
        </span>
        <span className="spacer" />
        <span onClick={(e) => e.stopPropagation()} className="vq-actions">
          <button className="btn-primary" disabled={!next || !!opening} onClick={() => openOne(next.experiment)}
                  title={next ? `Load ${next.experiment} here (the first one in progress or to do, in the order shown)` : 'Nothing left to annotate'}>
            {opening && next && opening === next.experiment ? 'Loading…' : 'Open next'}
          </button>
          <button onClick={fetchQueue} disabled={loading} title="Read the databases and annotations again">↻</button>
        </span>
      </header>
      {open && (
        <div className="vq-body">
          <div className="toolbar vq-filters">
            <label className="field" title="Experiments of one fly need no box validation">
              <input type="checkbox" checked={groupsOnly} onChange={(e) => setGroupsOnly(e.target.checked)} /> Groups only
            </label>
            <label className="field" title="Also list experiments without scene_qc.csv (Prepare scenes first: make-identogram + auto-annotate-qc, can take long)">
              <input type="checkbox" checked={withPrepare} onChange={(e) => setWithPrepare(e.target.checked)} /> Needing Prepare scenes
            </label>
            <label className="field" title="Order of the table and of Open next; a click on a column header sorts by that column">Order
              <select value={orderValue} onChange={(e) => setOrder(e.target.value)}>
                {orderValue === '' && <option value="">By {COLUMNS.find(([id]) => id === sort.by)?.[1]} {sort.dir > 0 ? '▲' : '▼'}</option>}
                {ORDERS.map(([v, label, title]) => <option key={v} value={v} title={title}>{label}</option>)}
              </select>
            </label>
            <label className="field">
              <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Hidden
            </label>
            <span className="qc-muted">
              Analyzed experiments without the validated tables (ROI_0_VAL, IDENTITY_VAL, CONCATENATION_VAL){data ? `: ${data.items.length} of ${data.analyzed}` : ''}
            </span>
          </div>
          <div className="ov-scroll vq-scroll">
            <table className="pe-table ov-table">
              <thead>
                <tr>
                  {COLUMNS.map(([id, label]) => (
                    <th key={id} className="vq-sortable" onClick={() => clickColumn(id)} title="Sort by this column (click again: reverse)"
                        aria-sort={sort.by === id ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
                      {label}{sort.by === id ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {sorted.map((it) => {
                  const [label, hint] = STATUS[it.status] || [it.status, ''];
                  const isLoaded = it.experiment === loaded;
                  return (
                    <tr key={it.experiment} className={`${isLoaded ? 'ov-loaded' : ''}${it.hidden ? ' vq-hidden' : ''}`}
                        onMouseEnter={(e) => onRowEnter(it, e)} onMouseLeave={onRowLeave}>
                      <td><span className={`ov-badge vq-${it.status}`} title={it.error || hint}>{label}</span></td>
                      <td className="mono">
                        {it.experiment}
                        {isLoaded && <span className="ov-badge ov-badge-loaded">loaded</span>}
                        {it.experiment === next?.experiment && <span className="ov-badge ov-badge-repeat">next</span>}
                      </td>
                      <td className="qc-num">{it.n_animals ?? '?'}</td>
                      <td className="qc-num" title="Scenes of scene_qc.csv (chunk boundaries not counted)">
                        {it.scenes ? `${it.scenes_done.toLocaleString()} / ${it.scenes.toLocaleString()}` : '–'}
                      </td>
                      <td className="qc-num" title={`${it.annotated.toLocaleString()} frames saved by anyone`}>{it.mine ? it.mine.toLocaleString() : ''}</td>
                      <td className="qc-muted" title={it.last_mine ? new Date(it.last_mine * 1000).toLocaleString() : ''}>{ago(it.last_mine)}</td>
                      <td>
                        {it.exchange?.role === 'publisher' && (
                          <span className="ov-badge" title={`Published ${it.exchange.kind === 'full' ? 'whole' : 'as a minimal bundle'} ${new Date(it.exchange.published_at * 1000).toLocaleString()}`}>
                            published {ago(it.exchange.published_at)}
                          </span>
                        )}
                        {it.exchange?.role === 'annotator' && (
                          <span className="ov-badge" title={`Downloaded from the Drive exchange (published by ${it.exchange.publisher || '?'})`}>downloaded</span>
                        )}
                      </td>
                      <td className="vq-row-actions">
                        {!isLoaded && (
                          <button onClick={() => openOne(it.experiment)} disabled={!!opening}>
                            {opening === it.experiment ? 'Loading…' : 'Open'}
                          </button>
                        )}
                        <button onClick={() => publish(it)}
                                disabled={!!publishing[it.experiment] || it.exchange?.role === 'annotator' || !it.scenes}
                                title={it.exchange?.role === 'annotator' ? 'A copy downloaded from Drive: upload its annotations from the Drive exchange tab'
                                  : !it.scenes ? 'No scene_qc.csv yet: Prepare scenes first (a bundle holds the scene frames)'
                                    : 'Publish it on the Drive exchange for the annotators (the Drive exchange tab shows the rest)'}>
                          {publishing[it.experiment] ? 'Publishing…' : it.exchange?.role === 'publisher' ? 'Publish again' : 'Publish'}
                        </button>
                        <button onClick={() => hide(it.experiment, !it.hidden)}
                                title={it.hidden ? 'Back into my queue' : 'Take it out of my queue (Hidden shows it again)'}>
                          {it.hidden ? 'Unhide' : 'Hide'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {data && !items.length && (
                  <tr><td colSpan={8} className="qc-muted">Nothing here with these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {open && hover && <MetaPopover meta={metas[hover.item.experiment]} item={hover.item} x={hover.x} y={hover.y} />}
    </section>
  );
}
