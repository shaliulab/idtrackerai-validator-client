// "Accept easy scenes" of the Annotate tab: the easy scenes (◆, by the easy method in use) not saved yet, reviewed
// before their proposals are saved in one go (POST /api/annotate/accept_easy: a server job, frames saved by anyone
// skipped, each frame saved as the person with "accepted easy scene, …, batch N" in the log), and the last batches
// with an Undo (POST /api/annotate/accept_easy/<batch>/undo: the frames still as accepted are unsaved).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import api, { apiUrl } from './api';
import { useConsole } from './MessageConsole';

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);
const errorOf = (err) => err?.response?.data?.error || err?.message || String(err);
const THUMB_W = 112;
const PREVIEW_W = 560;
const fmtTime = (t) => (t ? new Date(t * 1000).toLocaleString() : '');
const fmtZt = (clock, zt0) => {
  if (clock == null) return '';
  const h = clock / 3600 - zt0;
  return `ZT ${h.toFixed(2)}`;
};

// the scene's frame with the boxes it would be saved with (its proposal, or the saved boxes of a frame saved already)
function Preview({ scene, cont, zt0, onOpen }) {
  const [fn, setFn] = useState(scene.start);
  const [data, setData] = useState(null);
  const [img, setImg] = useState(null);
  const canvas = useRef(null);
  useEffect(() => { setFn(scene.start); }, [scene.start]);
  useEffect(() => {
    let live = true;
    setData(null);
    api.get(`/api/annotate/frame/${fn}`, { params: { continuity: cont } })
      .then((r) => { if (live) setData(unwrap(r.data)); }).catch(() => {});
    const im = new Image();
    im.onload = () => { if (live) setImg(im); };
    im.src = apiUrl(`/api/frame/${fn}`);
    return () => { live = false; };
  }, [fn, cont]);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !img) return;
    const k = PREVIEW_W / img.naturalWidth;
    c.width = PREVIEW_W;
    c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, c.width, c.height);
    for (const b of data?.boxes || []) {
      const unsure = b.confidence === 'medium' || b.confidence === 'low';
      g.strokeStyle = !b.label ? '#e11d48' : unsure ? '#f59e0b' : '#22c55e';
      g.lineWidth = 2;
      g.strokeRect(b.x0 * k, b.y0 * k, (b.x1 - b.x0) * k, (b.y1 - b.y0) * k);
      g.fillStyle = g.strokeStyle;
      g.font = 'bold 13px sans-serif';
      g.fillText(b.label || '?', b.x0 * k + 2, Math.max(12, b.y0 * k - 3));
    }
  }, [img, data]);
  const last = scene.start + scene.length - 1;
  return (
    <div className="ae-preview" data-ae-preview={scene.start}>
      <div className="ae-preview-head">
        <button onClick={() => setFn((f) => Math.max(scene.start, f - 1))} disabled={fn <= scene.start}>◀</button>
        <input type="range" min={scene.start} max={last} value={fn} onChange={(e) => setFn(Number(e.target.value))} />
        <button onClick={() => setFn((f) => Math.min(last, f + 1))} disabled={fn >= last}>▶</button>
        <span className="qc-muted">frame {fn.toLocaleString()} ({fn - scene.start + 1}/{scene.length}) {fmtZt(scene.clock, zt0)}</span>
        <span className="spacer" />
        <button onClick={() => onOpen(scene)} title="Close this and open the scene in the editor">Open in editor</button>
      </div>
      <canvas ref={canvas} className="ae-canvas" />
      <div className="qc-muted ae-legend">
        {data ? (data.saved ? `saved by ${data.author}: kept as it is` : `${data.source === 'continuity2' ? 'continuity v2' : data.source} proposal: `
          + `${(data.boxes || []).filter((b) => b.label).length} flies, ${(data.boxes || []).filter((b) => b.confidence).length} to look at (amber)`
          + `${(data.flags || []).length ? ` · ⚑ ${data.flags.join('; ')}` : ''}`) : 'Reading…'}
      </div>
    </div>
  );
}

export default function AcceptEasy({ experiment, info, scenes, cont, zt0, onClose, onOpenScene, onChanged }) {
  const { log, trackJob } = useConsole();
  const method = info?.easy?.method || 'rules';
  const scores = info?.easy?.scores || {};
  const candidates = useMemo(() => scenes.filter((s) => s.easy != null && s.done < s.length), [scenes]);
  const [ticked, setTicked] = useState(() => new Set(candidates.map((s) => s.start)));
  const [sort, setSort] = useState('start');
  const [minScore, setMinScore] = useState('');
  const [selected, setSelected] = useState(candidates[0]?.start ?? null);
  const [job, setJob] = useState(info?.accepting || null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (info?.accepting) setJob(info.accepting); }, [info?.accepting]);

  // progress of the running accept (the console follows it too)
  useEffect(() => {
    if (!job || job.status !== 'running') return undefined;
    const t = setInterval(() => {
      api.get(`/api/jobs/${job.id}`).then((r) => {
        const j = unwrap(r.data);
        setJob(j);
        if (j.status !== 'running') {
          setResult(j.result || null);
          onChanged();
        }
      }).catch(() => {});
    }, 1000);
    return () => clearInterval(t);
  }, [job, onChanged]);

  const rows = useMemo(() => {
    const out = [...candidates];
    if (sort === 'score') out.sort((a, b) => (scores[b.start] ?? -1) - (scores[a.start] ?? -1));
    return out;
  }, [candidates, sort, scores]);
  const picked = candidates.filter((s) => ticked.has(s.start));
  const frames = picked.reduce((n, s) => n + s.length - s.done, 0);
  const sel = candidates.find((s) => s.start === selected) || null;
  const running = job?.status === 'running';

  const toggle = (start) => setTicked((t) => { const n = new Set(t); if (n.has(start)) n.delete(start); else n.add(start); return n; });
  const accept = () => {
    if (!picked.length) return;
    const label = cont === 2 ? 'continuity v2' : 'continuity';
    if (!window.confirm(`Save the ${label} proposals of ${frames.toLocaleString()} frames in ${picked.length} easy scene${picked.length === 1 ? '' : 's'} (${method}) as yours?\n\n`
      + 'Frames already saved by anyone are skipped. The log marks each frame "accepted easy scene"; the whole batch can be undone below.')) return;
    setBusy(true);
    setResult(null);
    api.post('/api/annotate/accept_easy', {
      experiment, continuity: cont, method,
      scenes: picked.map((s) => ({ start: s.start, length: s.length, ...(scores[s.start] != null ? { score: scores[s.start] } : {}) })),
    }).then((r) => {
      const j = unwrap(r.data).job;
      setJob(j);
      trackJob(j);
    }).catch((err) => log('error', `Accept easy scenes: ${errorOf(err)}`))
      .finally(() => setBusy(false));
  };
  const stop = () => api.post('/api/annotate/accept_easy/stop').catch((err) => log('error', errorOf(err)));
  const undo = (b) => {
    if (!window.confirm(`Undo batch ${b.id} (${fmtTime(b.t)}): unsave its ${b.kept.toLocaleString()} frames still as accepted?${b.frames - b.kept ? ` ${b.frames - b.kept} frames saved again since are kept.` : ''}`)) return;
    setBusy(true);
    api.post(`/api/annotate/accept_easy/${b.id}/undo`, { experiment })
      .then((r) => {
        const d = unwrap(r.data);
        log('success', `Undid accepted batch ${b.id}: ${d.removed} frames unsaved${d.kept ? `, ${d.kept} kept (saved again since)` : ''}`);
        return onChanged();
      })
      .catch((err) => log('error', `Undo: ${errorOf(err)}`))
      .finally(() => setBusy(false));
  };

  return (
    <div className="ae-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !running) onClose(); }}>
      <section className="card ae-dialog" data-ae-state={running ? 'running' : result ? 'done' : 'review'}>
        <header className="card-header">
          <span>Accept easy scenes</span>
          <span className="ov-count">
            {candidates.length} easy scene{candidates.length === 1 ? '' : 's'} not saved ({method}) · proposal {cont === 2 ? 'continuity v2' : 'continuity v1'}
          </span>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose} title="Close (a running accept goes on)">✕</button>
        </header>
        <div className="ae-body">
          <div className="ae-list">
            <div className="ae-tools">
              <button onClick={() => setTicked(new Set(candidates.map((s) => s.start)))}>All</button>
              <button onClick={() => setTicked(new Set())}>None</button>
              {method === 'learned' && (
                <label className="field" title="Tick only the scenes scoring at least this">
                  score ≥
                  <input type="number" step={0.01} min={0} max={1} value={minScore} style={{ width: 64 }}
                         onChange={(e) => {
                           setMinScore(e.target.value);
                           const v = Number(e.target.value);
                           if (e.target.value !== '' && !Number.isNaN(v)) setTicked(new Set(candidates.filter((s) => (scores[s.start] ?? 0) >= v).map((s) => s.start)));
                         }} />
                </label>
              )}
              <label className="field">
                Sort
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="start">by frame</option>
                  {method === 'learned' && <option value="score">by score</option>}
                </select>
              </label>
            </div>
            <div className="ae-scroll">
              <table className="pe-table ae-table">
                <thead>
                  <tr><th /><th /><th>frame</th><th>ZT</th><th>to save</th><th>scene</th><th>{method === 'learned' ? 'score' : 'why easy'}</th></tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.start} data-ae-row={s.start} data-ae-checked={ticked.has(s.start) ? '1' : '0'}
                        className={s.start === selected ? 'ae-selected' : undefined} onClick={() => setSelected(s.start)}>
                      <td><input type="checkbox" checked={ticked.has(s.start)} onChange={() => toggle(s.start)} onClick={(e) => e.stopPropagation()} /></td>
                      <td><img className="ae-thumb" loading="lazy" alt="" width={THUMB_W}
                               src={apiUrl(`/api/frame/${s.start + Math.floor(s.length / 2)}?w=${THUMB_W}`)} /></td>
                      <td className="qc-num">{s.start.toLocaleString()}</td>
                      <td className="qc-num">{s.clock != null ? (s.clock / 3600 - zt0).toFixed(2) : ''}</td>
                      <td className="qc-num">{s.length - s.done}{s.done ? <span className="qc-muted"> /{s.length}</span> : ''}</td>
                      <td className="qc-muted">{s.reason}</td>
                      <td title={s.easy || ''}>{method === 'learned' && scores[s.start] != null ? scores[s.start].toFixed(3) : <span className="qc-muted">{s.easy}</span>}</td>
                    </tr>
                  ))}
                  {!rows.length && <tr><td colSpan={7} className="qc-muted">No easy scene left to save.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div className="ae-side">
            {sel ? <Preview scene={sel} cont={cont} zt0={zt0} onOpen={onOpenScene} /> : <div className="qc-muted qc-pad">Click a scene to preview it.</div>}
            <div className="ae-batches">
              <div className="ae-sub">Accepted batches</div>
              {(info?.accept_batches || []).length ? (
                <table className="pe-table">
                  <tbody>
                    {info.accept_batches.map((b) => (
                      <tr key={b.id} data-ae-batch={b.id}>
                        <td>#{b.id}</td>
                        <td className="qc-muted">{fmtTime(b.t)}</td>
                        <td title={b.note}>{b.author}</td>
                        <td className="qc-num" title="frames saved / still as accepted">{b.frames} / {b.kept}</td>
                        <td>{b.undone ? <span className="qc-muted">undone</span>
                          : <button data-action="accept-easy-undo" onClick={() => undo(b)} disabled={busy || running || !b.kept}
                                    title="Unsave the frames of this batch still as accepted (frames saved again since are kept)">Undo</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="qc-muted">None yet.</div>}
            </div>
          </div>
        </div>
        <footer className="ae-foot">
          {running ? (
            <>
              <progress max={1} value={job.items?.[0]?.progress || 0} />
              <span>Accepting… {Math.round(100 * (job.items?.[0]?.progress || 0))}%</span>
              <button className="btn-danger" onClick={stop} title="Stop after the scene being saved (what is saved stays, as one batch)">■ Stop</button>
            </>
          ) : (
            <>
              {result && (
                <span className="ae-result" data-ae-result={result.frames}>
                  Batch {result.batch}: {result.frames.toLocaleString()} frames saved
                  {Object.keys(result.skipped || {}).length ? `, ${Object.keys(result.skipped).length} skipped (${Object.values(result.skipped)[0]})` : ''}
                  {result.stopped ? ' · stopped' : ''}
                </span>
              )}
              <span className="spacer" />
              <span className="qc-muted">{picked.length} scene{picked.length === 1 ? '' : 's'} ticked · {frames.toLocaleString()} frames to save</span>
              <button className="btn-primary" data-action="accept-easy-run" onClick={accept} disabled={busy || !picked.length}>
                Accept {picked.length} scene{picked.length === 1 ? '' : 's'}…
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
