// "Validation queue" card at the top of the Annotate tab: analyzed experiments (a database in index.txt)
// without the validated tables (ROI_0_VAL, IDENTITY_VAL, CONCATENATION_VAL; server experiments.VALIDATED_TABLES),
// with this person's progress (GET /api/annotate/queue, box_annotations.validation_queue):
// in progress (frames saved by me, scenes left), to do, needs Prepare scenes, annotated (every scene saved:
// Integrate + Write validated tables left). Hide takes one out of my queue (kept on the server).
import React, { useState, useEffect, useCallback, useMemo } from 'react';
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

export default function ValidationQueue({ active, currentExperiment, onOpenExperiment }) {
  const { log } = useConsole();
  const [open, setOpen] = useState(() => stored('fh-annotate-queue-open', true));
  const [groupsOnly, setGroupsOnly] = useState(() => stored('fh-annotate-queue-groups', true));
  const [withPrepare, setWithPrepare] = useState(() => stored('fh-annotate-queue-prepare', false));
  const [showHidden, setShowHidden] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(null);

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
  const counts = useMemo(() => {
    const c = {};
    items.forEach((it) => { if (!it.hidden) c[it.status] = (c[it.status] || 0) + 1; });
    return c;
  }, [items]);
  // next: the first one not hidden, not done, not loaded (in progress first, then to do)
  const next = items.find((it) => !it.hidden && it.experiment !== loaded && (it.status === 'in_progress' || it.status === 'to_do'));

  const openOne = async (experiment) => {
    setOpening(experiment);
    try { await onOpenExperiment(experiment); } finally { setOpening(null); }
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
                  title={next ? `Load ${next.experiment} here` : 'Nothing left to annotate'}>
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
                  <th>Status</th><th>Experiment</th><th>Flies</th><th>Scenes done</th><th>My frames</th><th>Last saved by me</th><th />
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const [label, hint] = STATUS[it.status] || [it.status, ''];
                  const isLoaded = it.experiment === loaded;
                  return (
                    <tr key={it.experiment} className={`${isLoaded ? 'ov-loaded' : ''}${it.hidden ? ' vq-hidden' : ''}`}>
                      <td><span className={`ov-badge vq-${it.status}`} title={it.error || hint}>{label}</span></td>
                      <td className="mono">
                        {it.experiment}
                        {isLoaded && <span className="ov-badge ov-badge-loaded">loaded</span>}
                        {it.experiment === next?.experiment && <span className="ov-badge ov-badge-repeat">next</span>}
                      </td>
                      <td className="qc-num">{it.n_animals ?? '?'}</td>
                      <td className="qc-num" title={it.scene_source === 'qc' ? 'Scenes from the QC tab (no scene_qc.csv)' : 'Scenes of scene_qc.csv (chunk boundaries not counted)'}>
                        {it.scenes ? `${it.scenes_done.toLocaleString()} / ${it.scenes.toLocaleString()}` : '–'}
                      </td>
                      <td className="qc-num" title={`${it.annotated.toLocaleString()} frames saved by anyone`}>{it.mine ? it.mine.toLocaleString() : ''}</td>
                      <td className="qc-muted" title={it.last_mine ? new Date(it.last_mine * 1000).toLocaleString() : ''}>{ago(it.last_mine)}</td>
                      <td className="vq-row-actions">
                        {!isLoaded && (
                          <button onClick={() => openOne(it.experiment)} disabled={!!opening}>
                            {opening === it.experiment ? 'Loading…' : 'Open'}
                          </button>
                        )}
                        <button onClick={() => hide(it.experiment, !it.hidden)}
                                title={it.hidden ? 'Back into my queue' : 'Take it out of my queue (Hidden shows it again)'}>
                          {it.hidden ? 'Unhide' : 'Hide'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {data && !items.length && (
                  <tr><td colSpan={7} className="qc-muted">Nothing here with these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
