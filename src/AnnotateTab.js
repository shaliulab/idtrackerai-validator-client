// AnnotateTab.js  —  "Annotate" tab: box validation of multi-fly experiments (CVAT stays as fallback)
//
// One box per fly, labelled with its local identity (the labels of the CVAT tasks), saved per
// frame in the experiment's validator_annotations.db (idtrackerai_validator_server/box_annotations.py).
// flyhostel's `integrate-human-annotations --source validator` reads them like CVAT's boxes.
// A frame not saved yet opens with the machine's proposal (one box per tracked blob, its local
// identity); saving it (Enter) marks it validated. Edits of a frame are saved when leaving it;
// an untouched proposal is not (Enter accepts it). The list holds the failed scenes of the
// validation pipeline (scene_qc.csv), else the QC tab's runs of bad frames.
// "Propose" runs `yolov7-cvat propose` (the YOLO detections + identity solver of the CVAT pipeline's
// predict --assign / complete, with the carry-over of swaps between clips): unsaved frames then open with its boxes,
// the uncertain ones marked "!", and the frames it flagged (what a person must check) listed with ⚑ (F / Shift+F).

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import api, { apiUrl } from './api';
import { useElementSize, useFillHeight } from './layout';
import { useConsole } from './MessageConsole';

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);
const errorOf = (err) => err.response?.data?.error || err.message;
const FILTERS = [['todo', 'To do'], ['flagged', '⚑ Flagged'], ['all', 'All'], ['done', 'Done']];
const UNDO_DEPTH = 100;
const HANDLE = 7;            // px (screen) around a corner that resizes
const MIN_DRAG = 4;          // px (screen) before a drag draws a box
// Okabe-Ito first, then more distinct colours
const PALETTE = ['#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2', '#d55e00', '#cc79a7',
  '#ffffff', '#7fc97f', '#beaed4', '#fdc086', '#ff7f00', '#a6cee3', '#b2df8a', '#fb9a99', '#cab2d6'];
const TAG_COLOR = '#ff4d4d';
export const labelColor = (label) => {
  if (!label) return '#9aa0a6';
  const n = parseInt(label, 10);
  return Number.isFinite(n) ? PALETTE[(n - 1) % PALETTE.length] : TAG_COLOR;
};
const geometry = (list) => list.map(({ x0, y0, x1, y1, label }) => [x0, y0, x1, y1, label]);
const sameBoxes = (a, b) => JSON.stringify(geometry(a)) === JSON.stringify(geometry(b));
const unsure = (b) => b.confidence === 'low' || b.confidence === 'medium';
const fmtTime = (t) => (t ? new Date(t * 1000).toLocaleString() : '');

function BoxCanvas({ image, size, boxes, machine, selected, setSelected, onDraft, onCommit, newLabel, showMachine }) {
  const canvasRef = useRef(null);
  const [view, setView] = useState({ zoom: 1, cx: null, cy: null });
  const drag = useRef(null);
  const [hover, setHover] = useState(null);       // {i, part}
  const w = image?.naturalWidth || 1000;
  const h = image?.naturalHeight || 1000;
  const cx = view.cx ?? w / 2;
  const cy = view.cy ?? h / 2;
  const scale = (size / Math.max(w, h)) * view.zoom;
  const toScreen = useCallback((x, y) => [(x - cx) * scale + size / 2, (y - cy) * scale + size / 2], [cx, cy, scale, size]);
  const toImage = useCallback((sx, sy) => [(sx - size / 2) / scale + cx, (sy - size / 2) / scale + cy], [cx, cy, scale, size]);
  useEffect(() => { setView({ zoom: 1, cx: null, cy: null }); }, [w, h]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    if (!image) return;
    const [ix, iy] = toScreen(0, 0);
    ctx.drawImage(image, ix, iy, w * scale, h * scale);

    if (showMachine) {
      for (const m of machine || []) {
        const [x, y] = toScreen(m.x, m.y);
        ctx.fillStyle = labelColor(m.local_identity ? String(m.local_identity) : '');
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      }
    }

    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    boxes.forEach((b, i) => {
      const [x0, y0] = toScreen(b.x0, b.y0);
      const [x1, y1] = toScreen(b.x1, b.y1);
      const color = labelColor(b.label);
      const isSel = i === selected;
      ctx.setLineDash(b.label ? [] : [5, 4]);
      ctx.lineWidth = isSel ? 3 : 2;
      ctx.strokeStyle = '#000a';
      ctx.strokeRect(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2);
      ctx.strokeStyle = color;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setLineDash([]);
      const text = b.label || '?';
      const tw = ctx.measureText(text).width + 8;
      ctx.fillStyle = color;
      ctx.fillRect(x0, y0 - 17, tw, 17);
      ctx.fillStyle = '#000';
      ctx.fillText(text, x0 + 4, y0 - 2);
      if (unsure(b)) {
        // the solver was not sure: a person must check this box
        ctx.fillStyle = b.confidence === 'low' ? '#ff4d4d' : '#ffd400';
        ctx.fillRect(x0 + tw, y0 - 17, 14, 17);
        ctx.fillStyle = '#000';
        ctx.fillText('!', x0 + tw + 4, y0 - 2);
      }
      if (isSel) {
        ctx.fillStyle = color;
        for (const [px, py] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) ctx.fillRect(px - 4, py - 4, 8, 8);
      }
    });
    const d = drag.current;
    if (d?.kind === 'draw' && d.moved) {
      const [x0, y0] = toScreen(d.x0, d.y0);
      const [x1, y1] = toScreen(d.x1, d.y1);
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = labelColor(newLabel);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setLineDash([]);
    }
  });

  const local = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };
  // the box part under the pointer: a corner of the selected box first, then the smallest box holding it
  const hit = (sx, sy) => {
    const order = selected != null && boxes[selected] ? [selected] : [];
    for (const i of order) {
      const b = boxes[i];
      const [x0, y0] = toScreen(b.x0, b.y0);
      const [x1, y1] = toScreen(b.x1, b.y1);
      const corners = { nw: [x0, y0], ne: [x1, y0], sw: [x0, y1], se: [x1, y1] };
      for (const [part, [px, py]] of Object.entries(corners)) {
        if (Math.abs(sx - px) <= HANDLE && Math.abs(sy - py) <= HANDLE) return { i, part };
      }
    }
    const [x, y] = toImage(sx, sy);
    let best = null;
    boxes.forEach((b, i) => {
      if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) {
        const area = (b.x1 - b.x0) * (b.y1 - b.y0);
        if (!best || area < best.area || i === selected) best = { i, part: 'move', area: i === selected ? -1 : area };
      }
    });
    return best && { i: best.i, part: best.part };
  };

  const onPointerDown = (e) => {
    const [sx, sy] = local(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey)) {
      e.preventDefault();
      drag.current = { kind: 'pan', sx, sy, cx, cy };
      return;
    }
    if (e.button !== 0) return;
    const target = hit(sx, sy);
    const [x, y] = toImage(sx, sy);
    if (target) {
      setSelected(target.i);
      drag.current = { kind: target.part, i: target.i, x, y, orig: { ...boxes[target.i] }, moved: false };
    } else {
      drag.current = { kind: 'draw', sx, sy, x0: x, y0: y, x1: x, y1: y, moved: false };
    }
  };
  const clampX = (v) => Math.max(0, Math.min(w, v));
  const clampY = (v) => Math.max(0, Math.min(h, v));
  const onPointerMove = (e) => {
    const [sx, sy] = local(e);
    const d = drag.current;
    if (!d) { setHover(hit(sx, sy)); return; }
    if (d.kind === 'pan') {
      setView((v) => ({ ...v, cx: d.cx - (sx - d.sx) / scale, cy: d.cy - (sy - d.sy) / scale }));
      return;
    }
    const [x, y] = toImage(sx, sy);
    if (d.kind === 'draw') {
      if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) < MIN_DRAG) return;
      d.moved = true;
      d.x1 = clampX(x);
      d.y1 = clampY(y);
      setHover({ draw: Math.random() });    // redraw
      return;
    }
    d.moved = true;
    const o = d.orig;
    let b;
    if (d.kind === 'move') {
      const dx = Math.max(-o.x0, Math.min(w - o.x1, x - d.x));
      const dy = Math.max(-o.y0, Math.min(h - o.y1, y - d.y));
      b = { ...o, x0: o.x0 + dx, x1: o.x1 + dx, y0: o.y0 + dy, y1: o.y1 + dy };
    } else {
      b = { ...o };
      if (d.kind.includes('n')) b.y0 = clampY(y);
      if (d.kind.includes('s')) b.y1 = clampY(y);
      if (d.kind.includes('w')) b.x0 = clampX(x);
      if (d.kind.includes('e')) b.x1 = clampX(x);
    }
    onDraft(boxes.map((q, i) => (i === d.i ? b : q)));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'draw') {
      if (!d.moved) { setSelected(null); return; }
      const b = { x0: Math.min(d.x0, d.x1), y0: Math.min(d.y0, d.y1), x1: Math.max(d.x0, d.x1), y1: Math.max(d.y0, d.y1), label: newLabel || '' };
      if (b.x1 - b.x0 < 3 || b.y1 - b.y0 < 3) return;
      onCommit([...boxes, b], { select: boxes.length });
    } else if (d.kind !== 'pan' && d.moved) {
      const b = boxes[d.i];
      const norm = { ...b, x0: Math.min(b.x0, b.x1), x1: Math.max(b.x0, b.x1), y0: Math.min(b.y0, b.y1), y1: Math.max(b.y0, b.y1) };
      onCommit(boxes.map((q, i) => (i === d.i ? norm : q)));
    }
  };
  const onWheel = (e) => {
    const [sx, sy] = local(e);
    const [x, y] = toImage(sx, sy);
    const zoom = Math.max(1, Math.min(16, view.zoom * (e.deltaY < 0 ? 1.25 : 1 / 1.25)));
    const s = (size / Math.max(w, h)) * zoom;
    setView({ zoom, cx: x - (sx - size / 2) / s, cy: y - (sy - size / 2) / s });
  };
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const stop = (e) => e.preventDefault();
    canvas.addEventListener('wheel', stop, { passive: false });
    return () => canvas.removeEventListener('wheel', stop);
  }, []);

  const cursor = drag.current?.kind === 'pan' ? 'grabbing'
    : hover?.part === 'move' ? 'move'
    : hover?.part === 'nw' || hover?.part === 'se' ? 'nwse-resize'
    : hover?.part === 'ne' || hover?.part === 'sw' ? 'nesw-resize' : 'crosshair';
  return (
    <div className="pose-canvas-wrap" style={{ width: size, height: size }}>
      <canvas ref={canvasRef} style={{ width: size, height: size, display: 'block', cursor }}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
              onPointerLeave={() => setHover(null)} onWheel={onWheel}
              onContextMenu={(e) => e.preventDefault()}
              onDoubleClick={(e) => { if (!hit(...local(e))) setView({ zoom: 1, cx: null, cy: null }); }} />
      {!image && <div className="pose-canvas-msg">Loading the frame…</div>}
    </div>
  );
}

export default function AnnotateTab({ active, currentExperiment, viewerFrame, onOpenFrame }) {
  const { log, trackJob } = useConsole();
  const [info, setInfo] = useState(null);           // /api/annotate/scenes
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('todo');
  const [current, setCurrent] = useState(null);     // frame number
  const [frame, setFrame] = useState(null);         // /api/annotate/frame/<n>
  const [image, setImage] = useState(null);
  const [boxes, setBoxes] = useState([]);
  const [loaded, setLoaded] = useState([]);         // boxes as opened / last saved
  const [selected, setSelected] = useState(null);
  const [newLabel, setNewLabel] = useState('');
  const [showMachine, setShowMachine] = useState(true);
  const [pending, setPending] = useState(0);
  const [jump, setJump] = useState('');
  const [zt, setZt] = useState({ start: '', end: '' });
  const [rootEl, setRootEl] = useState(null);
  const [viewEl, setViewEl] = useState(null);
  const fillHeight = useFillHeight(rootEl, [active, info]);
  const { width: viewWidth } = useElementSize(viewEl);
  const queue = useRef(Promise.resolve());
  const undo = useRef([]);
  const latest = useRef(0);
  const lastSaved = useRef(null);                   // boxes of the last frame saved (for "copy previous")
  const digits = useRef({ text: '', t: 0 });
  const currentRef = useRef(null);
  currentRef.current = current;
  const [reloadKey, setReloadKey] = useState(0);

  const fetchInfo = useCallback(() => {
    setLoading(true);
    return api.get('/api/annotate/scenes')
      .then((r) => setInfo(unwrap(r.data)))
      .catch((err) => { setInfo(null); log('error', `Annotate: ${errorOf(err)}`); })
      .finally(() => setLoading(false));
  }, [log]);

  const fetchedFor = useRef(null);
  useEffect(() => {
    if (!active || !currentExperiment || fetchedFor.current === currentExperiment) return;
    fetchedFor.current = currentExperiment;
    setCurrent(null); setFrame(null); setBoxes([]); setLoaded([]); undo.current = []; lastSaved.current = null;
    fetchInfo();
  }, [active, currentExperiment, fetchInfo]);

  const annotated = useMemo(() => new Map((info?.annotated || []).map((a) => [a.frame_number, a])), [info]);
  const flagged = useMemo(() => new Set(info?.flagged || []), [info]);
  const nAnimals = info?.n_animals || 0;

  // every frame of the scenes, in order: what ← → walk through
  const scenes = useMemo(() => (info?.scenes || []).map((s, k) => {
    let done = 0;
    let flags = 0;
    for (let f = s.start; f < s.start + s.length; f += 1) {
      if (annotated.has(f)) done += 1;
      else if (flagged.has(f)) flags += 1;
    }
    return { ...s, k, done, flags };
  }), [info, annotated, flagged]);
  const shownScenes = useMemo(() => scenes.filter((s) => (
    filter === 'all' || (filter === 'flagged' ? s.flags > 0 : filter === 'done' ? s.done === s.length : s.done < s.length)
  )), [scenes, filter]);
  // flagged frames not saved yet, in order
  const todoFlags = useMemo(() => [...flagged].filter((f) => !annotated.has(f)).sort((a, b) => a - b), [flagged, annotated]);
  const sceneOf = useCallback((fn) => scenes.find((s) => fn >= s.start && fn < s.start + s.length), [scenes]);
  const currentScene = current != null ? sceneOf(current) : null;

  // open a frame
  useEffect(() => {
    if (current == null) return;
    const id = ++latest.current;
    setImage(null);
    setSelected(null);
    undo.current = [];
    api.get(`/api/annotate/frame/${current}`)
      .then((r) => {
        if (id !== latest.current) return;
        const d = unwrap(r.data);
        setFrame(d);
        setBoxes(d.boxes);
        setLoaded(d.boxes);
      })
      .catch((err) => { if (id === latest.current) { setFrame({ error: errorOf(err) }); setBoxes([]); setLoaded([]); } });
    const img = new Image();
    img.onload = () => { if (id === latest.current) setImage(img); };
    img.onerror = () => { if (id === latest.current) log('error', `Could not read frame ${current}`); };
    img.src = apiUrl(`/api/frame/${current}`);
    // the next one, ready when → is pressed
    const next = new Image();
    next.src = apiUrl(`/api/frame/${current + 1}`);
  }, [current, reloadKey, log]);

  const dirty = frame && !frame.error && !sameBoxes(boxes, loaded);
  const duplicates = useMemo(() => {
    const seen = new Map();
    boxes.forEach((b) => { if (/^\d+$/.test(b.label)) seen.set(b.label, (seen.get(b.label) || 0) + 1); });
    return [...seen].filter(([, n]) => n > 1).map(([l]) => l);
  }, [boxes]);
  const missing = useMemo(() => {
    const have = new Set(boxes.map((b) => b.label));
    return Array.from({ length: nAnimals }, (_, i) => String(i + 1)).filter((l) => !have.has(l));
  }, [boxes, nAnimals]);
  const unassigned = boxes.filter((b) => !b.label).length;

  const save = useCallback((fn, list) => {
    setPending((n) => n + 1);
    const p = queue.current.then(() => api.post(`/api/annotate/frame/${fn}`, { boxes: list, experiment: currentExperiment })
      .then((r) => {
        const d = unwrap(r.data);
        lastSaved.current = d.boxes;
        setInfo((old) => {
          if (!old) return old;
          const rest = old.annotated.filter((a) => a.frame_number !== fn);
          return { ...old, annotated: [...rest, { frame_number: fn, author: d.author, updated: d.updated, n_boxes: d.boxes.length }] };
        });
        if (fn === currentRef.current) { setLoaded(d.boxes); setFrame((f) => f && { ...f, saved: true, author: d.author, updated: d.updated }); }
        return true;
      })
      .catch((err) => { log('error', `Frame ${fn} not saved: ${errorOf(err)}`); return false; })
      .finally(() => setPending((n) => n - 1)));
    queue.current = p;
    return p;
  }, [currentExperiment, log]);

  const unsave = useCallback(() => {
    if (current == null || !frame?.saved) return;
    if (!window.confirm(`Frame ${current} will no longer count as annotated (its boxes are deleted). Continue?`)) return;
    api.delete(`/api/annotate/frame/${current}`)
      .then(() => {
        setInfo((old) => old && { ...old, annotated: old.annotated.filter((a) => a.frame_number !== current) });
        setReloadKey((k) => k + 1);   // opened again: the proposal
      })
      .catch((err) => log('error', `Frame ${current}: ${errorOf(err)}`));
  }, [current, frame, log]);

  // leaving a frame: its edits are saved (an untouched proposal is not)
  const go = useCallback((fn) => {
    if (fn == null || fn === current) return;
    if (dirty) {
      if (duplicates.length) { log('warning', `Frame ${current}: local identity ${duplicates.join(', ')} is on two boxes. Fix it (or Ctrl+Z) before leaving the frame`); return; }
      save(current, boxes);
    }
    setCurrent(fn);
  }, [current, dirty, duplicates, boxes, save, log]);

  const stepFrame = useCallback((d) => {
    if (current == null) { if (shownScenes.length) go(shownScenes[0].start); return; }
    const s = sceneOf(current);
    if (s) {
      const target = current + d;
      if (target >= s.start && target < s.start + s.length) { go(target); return; }
      const i = shownScenes.findIndex((x) => x.k === s.k);
      const list = i >= 0 ? shownScenes : scenes;
      const j = (i >= 0 ? i : list.findIndex((x) => x.k === s.k)) + (d > 0 ? 1 : -1);
      if (j >= 0 && j < list.length) go(d > 0 ? list[j].start : list[j].start + list[j].length - 1);
      else log('info', d > 0 ? 'Last scene of the list' : 'First scene of the list');
      return;
    }
    go(current + d);
  }, [current, sceneOf, shownScenes, scenes, go, log]);

  const stepScene = useCallback((d) => {
    const list = shownScenes;
    if (!list.length) return;
    let j;
    if (current == null) j = d > 0 ? 0 : list.length - 1;
    else {
      const s = sceneOf(current);
      const i = s ? list.findIndex((x) => x.k === s.k) : -1;
      if (i >= 0) j = i + d;
      else {
        const after = list.findIndex((x) => x.start > current);
        j = d > 0 ? (after < 0 ? list.length : after) : (after < 0 ? list.length : after) - 1;
      }
    }
    if (j >= 0 && j < list.length) go(list[j].start);
  }, [shownScenes, current, sceneOf, go]);

  // accept this frame as it is shown, then the next one
  const accept = useCallback(() => {
    if (current == null || !frame || frame.error) return;
    if (duplicates.length) { log('warning', `Local identity ${duplicates.join(', ')} is on two boxes`); return; }
    save(current, boxes);
    setLoaded(boxes);
    stepFrame(1);
  }, [current, frame, boxes, duplicates, save, stepFrame, log]);

  // edits
  const commit = useCallback((next, opts = {}) => {
    undo.current.push(opts.before || boxes);
    if (undo.current.length > UNDO_DEPTH) undo.current.shift();
    setBoxes(next);
    if (opts.select !== undefined) setSelected(opts.select);
  }, [boxes]);
  const dragStart = useRef(null);
  const onDraft = useCallback((next) => {
    if (dragStart.current == null) dragStart.current = boxes;
    setBoxes(next);
  }, [boxes]);
  const onCommit = useCallback((next, opts = {}) => {
    const before = dragStart.current || boxes;
    dragStart.current = null;
    commit(next, { ...opts, before });
  }, [boxes, commit]);
  const undoLast = useCallback(() => {
    const prev = undo.current.pop();
    if (!prev) { log('info', 'Nothing to undo in this frame'); return; }
    setBoxes(prev);
    setSelected(null);
  }, [log]);

  // a label on the selected box; a local identity already used moves to the other box's old label
  const setLabel = useCallback((label) => {
    if (selected == null || !boxes[selected]) { setNewLabel(label); return; }
    const old = boxes[selected].label;
    const next = boxes.map((b, i) => {
      if (i === selected) return { ...b, label };
      if (label && /^\d+$/.test(label) && b.label === label) return { ...b, label: /^\d+$/.test(old) ? old : '' };
      return b;
    });
    commit(next);
  }, [selected, boxes, commit]);
  const removeSelected = useCallback(() => {
    if (selected == null) return;
    commit(boxes.filter((_, i) => i !== selected));
    setSelected(null);
  }, [selected, boxes, commit]);
  const resetToProposal = useCallback((which = '1') => {
    if (current == null) return;
    // a proposal again (also for a saved frame): the solver's, or idtrackerai's boxes ('tracking')
    api.get(`/api/annotate/frame/${current}`, { params: { proposal: which } })
      .then((r) => commit(unwrap(r.data).boxes))
      .catch((err) => log('error', errorOf(err)));
  }, [current, commit, log]);
  const copyPrevious = useCallback(() => {
    if (!lastSaved.current) { log('info', 'No frame saved yet in this session'); return; }
    commit(lastSaved.current.map((b) => ({ ...b })));
  }, [commit, log]);

  const stepFlag = useCallback((d) => {
    const list = todoFlags.filter((f) => f !== current);
    if (!list.length) { log('info', 'No flagged frame left to check'); return; }
    const ref = current ?? -1;
    const target = d > 0 ? list.find((f) => f > ref) ?? list[0] : [...list].reverse().find((f) => f < ref) ?? list[list.length - 1];
    go(target);
  }, [todoFlags, current, go, log]);

  const propose = useCallback(() => {
    const again = info?.proposal_run;
    if (again && !window.confirm('Make the proposals again? Frames you saved are kept (and their labels guide the solver); unsaved frames get the new proposals.')) return;
    api.post('/api/annotate/propose')
      .then((r) => trackJob(unwrap(r.data)))
      .then((job) => {
        if (!job) return;
        const res = job.result;
        if (job.status === 'done') log('success', `Proposals made: ${JSON.stringify(res?.summary?.decisions || {})}, ${res?.summary?.flagged_frames ?? '?'} frames flagged`);
        else if (res?.tail) log('error', `${res.command}\n${res.tail.slice(-15).join('\n')}`);
        fetchInfo();
        setReloadKey((k) => k + 1);
      })
      .catch((err) => log('error', `Propose: ${errorOf(err)}`));
  }, [info, trackJob, log, fetchInfo]);

  // keys (while shown, not in a field)
  const keys = useRef({});
  keys.current = { stepFrame, stepScene, stepFlag, accept, undoLast, setLabel, removeSelected, copyPrevious, boxes, selected, nAnimals };
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      const k = keys.current;
      if (e.ctrlKey && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); k.undoLast(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); if (e.shiftKey) k.stepScene(-1); else k.stepFrame(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); if (e.shiftKey) k.stepScene(1); else k.stepFrame(1); }
      else if (e.key === 'Enter') { e.preventDefault(); k.accept(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); k.removeSelected(); }
      else if (e.key === 'Tab' && k.boxes.length) {
        e.preventDefault();
        const n = k.boxes.length;
        setSelected((s) => (s == null ? (e.shiftKey ? n - 1 : 0) : (s + (e.shiftKey ? n - 1 : 1)) % n));
      }
      else if (e.key === 'Escape') setSelected(null);
      else if (e.key === 'u' || e.key === 'U') k.setLabel('');
      else if (e.key === 'p' || e.key === 'P') k.copyPrevious();
      else if (e.key === 'f' || e.key === 'F') k.stepFlag(e.shiftKey ? -1 : 1);
      else if (/^[0-9]$/.test(e.key)) {
        // two digits typed quickly make one number (more than 9 flies)
        const now = Date.now();
        const d = digits.current;
        const text = k.nAnimals > 9 && now - d.t < 700 && d.text.length === 1 ? d.text + e.key : e.key;
        digits.current = { text, t: now };
        const n = parseInt(text, 10);
        if (n >= 1 && n <= k.nAnimals) k.setLabel(String(n));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  const integrate = useCallback((mode) => {
    if (mode === 'save' && !window.confirm(
      'Write IDENTITY_VAL, ROI_0_VAL and CONCATENATION_VAL of this experiment\'s database from the last integration? The validated tables are replaced.')) return;
    api.post('/api/annotate/integrate', { mode, start_zt: zt.start, end_zt: zt.end })
      .then((r) => trackJob(unwrap(r.data)))
      .then((job) => {
        if (!job) return;
        const res = job.result;
        if (res?.tail) log(job.status === 'done' ? 'success' : 'error', `${res.command}\n${res.tail.slice(-15).join('\n')}`);
        fetchInfo();
      })
      .catch((err) => log('error', `${mode === 'save' ? 'Write validated tables' : 'Integrate'}: ${errorOf(err)}`));
  }, [zt, trackJob, log, fetchInfo]);

  const mainHeight = fillHeight ? fillHeight - 60 : 640;
  const size = Math.max(260, Math.min((viewWidth || 600) - 24, mainHeight - 120));
  const doneFrames = info?.annotated?.length || 0;
  const identityOf = (label) => (frame?.concatenation && /^\d+$/.test(label) ? frame.concatenation[label] : undefined);

  if (!currentExperiment) return <div className="ov"><div className="card ov-controls toolbar">Load an experiment first.</div></div>;

  return (
    <div className="ov" ref={setRootEl}>
      <div className="card ov-controls toolbar">
        <span className="ov-count">
          {info ? `${doneFrames.toLocaleString()} frames annotated · ${scenes.filter((s) => s.done === s.length).length} / ${scenes.length} scenes done` : loading ? 'Reading…' : ''}
        </span>
        <span className="toolbar-sep" />
        <label className="field">
          Frame
          <input type="number" value={jump} style={{ width: 110 }} onChange={(e) => setJump(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter' && jump !== '') go(Number(jump)); }} />
        </label>
        <button onClick={() => jump !== '' && go(Number(jump))} disabled={jump === ''}>Open</button>
        <button onClick={() => viewerFrame != null && go(viewerFrame)} title="Open the Group viewer's frame">Viewer frame</button>
        <span className="toolbar-sep" />
        <span className="sl-save">
          {pending > 0 ? 'Saving…' : dirty ? 'Edited (saved when you leave the frame)' : frame?.saved ? `Saved by ${frame.author} · ${fmtTime(frame.updated)}` : frame ? 'Proposal, not saved' : ''}
        </span>
        <span className="spacer" />
        <button onClick={propose} disabled={!scenes.length || info?.source?.kind !== 'scene_qc'}
                title="Run yolov7-cvat propose: YOLO detections + the identity solver of the CVAT pipeline (predict --assign, complete), swaps carried from clip to clip. Unsaved frames then open with its boxes; GPU, minutes to hours">
          {info?.proposal_run ? 'Propose again' : 'Propose (YOLO + solver)'}
        </button>
        {info?.proposal_run && (
          <span className="ov-count" title={JSON.stringify(info.proposal_run.summary?.decisions || {})}>
            {todoFlags.length} ⚑ to check · proposed {fmtTime(info.proposal_run.t)}
          </span>
        )}
        <span className="toolbar-sep" />
        <label className="field" title="ZT range integrated (hours, as integrate-human-annotations --start-zt / --end-zt). Empty: the frames annotated">
          ZT
          <input type="number" placeholder="start" value={zt.start} style={{ width: 64 }} onChange={(e) => setZt((z) => ({ ...z, start: e.target.value }))} />
          –
          <input type="number" placeholder="end" value={zt.end} style={{ width: 64 }} onChange={(e) => setZt((z) => ({ ...z, end: e.target.value }))} />
        </label>
        <button onClick={() => integrate('integrate')} disabled={!doneFrames}
                title="Run integrate-human-annotations --source validator: the boxes crossed with the tracking, validated tables written as feathers in flyhostel/validation (the database is not touched)">
          Integrate
        </button>
        <button onClick={() => integrate('save')} disabled={!doneFrames}
                title="Run save-human-annotations: write the last integration into the database's _VAL tables">
          Write validated tables…
        </button>
      </div>

      <div className="sl-main" style={{ height: mainHeight }}>
        <section className="card sl-list">
          <header className="card-header">
            <span>Scenes to check</span>
            <span className="ov-count">{info?.source?.kind === 'scene_qc' ? 'scene_qc.csv' : info?.source?.kind === 'qc' ? 'QC tab' : ''}</span>
          </header>
          <div className="sl-filters">
            {FILTERS.map(([k, label]) => (
              <button key={k} className={filter === k ? 'btn-primary' : undefined} onClick={() => setFilter(k)}>{label}</button>
            ))}
            <button onClick={fetchInfo} title="Read the scenes and annotated frames again">↻</button>
          </div>
          <div className="ov-scroll sl-scroll">
            {info && !scenes.length && (
              <div className="qc-muted qc-pad">
                No scenes to check: this experiment has no flyhostel/validation/scene_qc.csv (made by the validation pipeline before CVAT)
                and the QC tab has not run on it. Any frame can still be opened with Frame.
              </div>
            )}
            <table className="pe-table ov-table pose-table sl-table">
              <tbody>
                {shownScenes.map((s) => {
                  const isCur = currentScene?.k === s.k;
                  return (
                    <tr key={s.k} className={isCur ? 'pose-selected' : undefined} onClick={() => go(s.start)}
                        ref={isCur ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined} title={s.reason}>
                      <td><span className={`sl-dot ${s.done === s.length ? 'sl-done' : s.done ? 'sl-pred' : 'sl-sugg'}`} /></td>
                      <td className="qc-num">{s.start.toLocaleString()}</td>
                      <td className="qc-muted">{s.done}/{s.length}{s.flags ? <span className="bx-flag" title={`${s.flags} flagged frame(s) not saved yet`}> ⚑{s.flags}</span> : null}</td>
                      <td className="qc-muted bx-reason">{s.reason}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {info?.problems && (
            <details className="bx-problems" open={info.problems.frames.length > 0}>
              <summary>
                After the last integration ({fmtTime(info.problems.mtime)}): {info.problems.frames.length} frame{info.problems.frames.length === 1 ? '' : 's'} with problems
              </summary>
              <div className="ov-scroll bx-problems-list">
                <table className="pe-table ov-table pose-table sl-table">
                  <tbody>
                    {info.problems.frames.map((p) => (
                      <tr key={p.frame_number} className={p.frame_number === current ? 'pose-selected' : undefined} onClick={() => go(p.frame_number)}>
                        <td className="qc-num">{p.frame_number.toLocaleString()}</td>
                        <td className="qc-muted bx-reason">{p.problems.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          <div className="qc-muted qc-pad">
            <span className="sl-dot sl-done" /> done <span className="sl-dot sl-pred" /> started <span className="sl-dot sl-sugg" /> to do
          </div>
        </section>

        <section className="card sl-view" ref={setViewEl}>
          <header className="card-header">
            {current != null ? (
              <span>
                Frame {current.toLocaleString()}
                {frame?.source && <span className={`bx-source bx-source-${frame.source}`}>{{ solver: 'solver proposal', tracking: 'idtrackerai proposal', saved: 'saved' }[frame.source]}</span>}
                <span className="ov-count"> · chunk {frame?.chunk ?? '…'}{currentScene ? ` · scene ${currentScene.start.toLocaleString()} (${current - currentScene.start + 1} of ${currentScene.length})` : ''}</span>
              </span>
            ) : <span>No frame open</span>}
            <span className="spacer" />
            <button onClick={() => stepScene(-1)} title="Previous scene (Shift+←)">⏮</button>
            <button onClick={() => stepFrame(-1)} title="Previous frame (←)">◀</button>
            <button onClick={() => stepFrame(1)} title="Next frame (→)">▶</button>
            <button onClick={() => stepScene(1)} title="Next scene (Shift+→)">⏭</button>
            <button onClick={() => stepFlag(1)} disabled={!todoFlags.length} title="Next flagged frame not saved yet (F; Shift+F: previous)">⚑ ▶</button>
            <label className="field"><input type="checkbox" checked={showMachine} onChange={(e) => setShowMachine(e.target.checked)} />Centroids</label>
          </header>
          <div className="card-body">
            {currentScene && (
              <div className="bx-strip" title="Frames of the scene: green = saved">
                {Array.from({ length: currentScene.length }, (_, i) => {
                  const fn = currentScene.start + i;
                  return (
                    <span key={fn} className={`bx-cell${annotated.has(fn) ? ' bx-saved' : flagged.has(fn) ? ' bx-flagged' : ''}${fn === current ? ' bx-current' : ''}`}
                          onClick={() => go(fn)} title={`Frame ${fn}${annotated.has(fn) ? ' (saved)' : ''}`} />
                  );
                })}
              </div>
            )}
            {current != null && !frame?.error && (
              <BoxCanvas image={image} size={size} boxes={boxes} machine={frame?.machine} selected={selected} setSelected={setSelected}
                         onDraft={onDraft} onCommit={onCommit} newLabel={newLabel} showMachine={showMachine} />
            )}
            {frame?.error && <div className="qc-muted">{frame.error}</div>}
            {current == null && <div className="qc-muted">Pick a scene in the list (or → to start with the first one).</div>}
            {current != null && (
              <div className="toolbar sl-actions">
                <button className="btn-primary" onClick={accept} disabled={!frame || !!frame.error || duplicates.length > 0}
                        title="Save this frame as shown and go to the next one (Enter)">Save &amp; next (Enter)</button>
                <button onClick={copyPrevious} title="Boxes of the last frame saved (P)">Copy previous (P)</button>
                <button onClick={() => resetToProposal('1')} disabled={!frame?.has_solver}
                        title="The boxes of the YOLO + solver proposal again">Solver proposal</button>
                <button onClick={() => resetToProposal('tracking')} title="One box per blob of idtrackerai, with its local identity">idtrackerai boxes</button>
                <button onClick={unsave} disabled={!frame?.saved} title="This frame no longer counts as annotated">Unsave</button>
                {onOpenFrame && <button onClick={() => onOpenFrame(current)}>Open in Group viewer</button>}
              </div>
            )}
          </div>
        </section>

        <section className="card sl-side">
          <header className="card-header">
            <span>Labels</span>
            <span className="spacer" />
            <span className="ov-count">{selected != null ? 'applied to the selected box' : 'of the next box drawn'}</span>
          </header>
          <div className="bx-labels">
            {(info?.labels || []).map((l) => {
              const sel = selected != null ? boxes[selected]?.label === l : newLabel === l;
              return (
                <button key={l} className={`bx-label${sel ? ' bx-label-on' : ''}${missing.includes(l) ? ' bx-label-missing' : ''}`}
                        style={{ '--bx-color': labelColor(l) }} onClick={() => setLabel(l)}
                        title={`Local identity ${l}${identityOf(l) != null ? ` (identity ${identityOf(l)} in this chunk)` : ''}${missing.includes(l) ? ': no box in this frame' : ''}`}>
                  {l}
                </button>
              );
            })}
            <button className="bx-label" style={{ '--bx-color': labelColor('') }} onClick={() => setLabel('')} title="Not assigned: ignored by the integration (U)">?</button>
            {(info?.tags || []).map((t) => (
              <button key={t} className="bx-label bx-tag" style={{ '--bx-color': TAG_COLOR }} onClick={() => setLabel(t)}
                      title={{ FMB: 'Fragment must break here', 'NEW-FRAGMENT': 'This fly gets a new fragment from here to the end of the chunk', CROSSING: 'This box is a crossing' }[t]}>
                {t}
              </button>
            ))}
          </div>
          {frame?.flags?.length > 0 && (
            <div className="qc-pad bx-flags">
              {frame.flags.map((t, i) => <div key={i}>⚑ {t}</div>)}
            </div>
          )}
          <div className="qc-pad bx-warnings">
            {duplicates.length > 0 && <div className="sl-error">Local identity {duplicates.join(', ')} on two boxes</div>}
            {frame && !frame.error && missing.length > 0 && <div className="qc-muted">No box for {missing.join(', ')}</div>}
            {unassigned > 0 && <div className="qc-muted">{unassigned} box{unassigned > 1 ? 'es' : ''} without label (ignored)</div>}
          </div>
          <div className="ov-scroll">
            <table className="pe-table ov-table pose-table sl-table">
              <thead><tr><th>Label</th><th title="Identity of that local identity in this chunk (CONCATENATION)">Id</th><th>x</th><th>y</th><th>w×h</th><th title="The solver's note">!</th></tr></thead>
              <tbody>
                {boxes.map((b, i) => (
                  <tr key={i} className={i === selected ? 'pose-selected' : undefined} onClick={() => setSelected(i)}>
                    <td><span className="qc-swatch" style={{ background: labelColor(b.label), border: '1px solid #0006' }} />{b.label || '?'}</td>
                    <td className="qc-num qc-muted">{identityOf(b.label) ?? ''}</td>
                    <td className="qc-num">{((b.x0 + b.x1) / 2).toFixed(0)}</td>
                    <td className="qc-num">{((b.y0 + b.y1) / 2).toFixed(0)}</td>
                    <td className="qc-num qc-muted">{(b.x1 - b.x0).toFixed(0)}×{(b.y1 - b.y0).toFixed(0)}</td>
                    <td title={b.note ? `${b.confidence ? `${b.confidence} confidence: ` : ''}${b.note}` : ''}>
                      {unsure(b) ? <span className={b.confidence === 'low' ? 'sl-error' : 'bx-flag'}>!</span> : b.note ? <span className="qc-muted">i</span> : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="qc-muted qc-pad bx-help">
            Drag on the image: new box · drag a box: move · corners of the selected box: resize · 1–{nAnimals || 'N'}: label
            {nAnimals > 9 ? ' (two digits quickly for 10+)' : ''} · U: no label · Del: delete · Tab: next box · Enter: save &amp; next ·
            ←/→ frame · Shift+←/→ scene · F / Shift+F: next / previous flagged frame · P: copy previous · Ctrl+Z undo · wheel zoom · right/middle drag or Shift+drag: pan · double click: reset zoom
          </div>
        </section>
      </div>
    </div>
  );
}
