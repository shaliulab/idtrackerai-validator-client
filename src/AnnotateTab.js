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
// the uncertain ones marked "!", and the frames it flagged (what a person must check) listed with ⚑ (G / Shift+G).

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import api, { apiUrl } from './api';
import { useElementSize, useFillHeight } from './layout';
import { useConsole } from './MessageConsole';

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);
const errorOf = (err) => err.response?.data?.error || err.message;
// FlyHostel1/4X/<date>/arenas/1 -> FlyHostel1_4X_<date>_arena1 (server experiments.to_flat)
const flatName = (name) => (name || '').replace(/\//g, '_').replace(/_arenas_(\d+)$/, '_arena$1');
// the digit of a key by its physical key (Shift+1 is "!" on QWERTY, "1" is Shift+& on AZERTY), numpad included
const digitOf = (e) => {
  const m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code || '');
  if (m) return Number(m[1]);
  return /^[0-9]$/.test(e.key) ? Number(e.key) : null;
};
// ZT hours -> "ZT 06:43:39 (6.73 h)"
// ZT of a scene start in the list: ZT hh:mm:ss
const fmtZtShort = (h) => {
  const s = Math.round(Math.abs(h) * 3600);
  const pad = (v) => String(v).padStart(2, '0');
  return `${h < 0 ? '-' : ''}${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};
const fmtZt = (h) => {
  const sign = h < 0 ? '-' : '';
  const s = Math.round(Math.abs(h) * 3600);
  const pad = (v) => String(v).padStart(2, '0');
  return `ZT ${sign}${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)} (${h.toFixed(2)} h)`;
};
// idtrackerai fragment of each box: the machine row whose centroid is inside the box, nearest its centre,
// one row per box (touching flies: overlapping boxes) -> [fragment or null]. Tag boxes (FMB, NEW-FRAGMENT, …) take
// no row. A row inside a box with a local identity that got no row of its own is one blob holding two flies (a
// crossing): its fragment is given to neither box (out.shared: box index -> that fragment), or a label given to one
// fly would be carried through the fragment to the other (same rule as the server's box_fragments).
const isTag = (label) => !!label && !/^\d+$/.test(label);
const inBox = (b, m) => m.x >= b.x0 && m.x <= b.x1 && m.y >= b.y0 && m.y <= b.y1;
const fragmentsOf = (boxes, machine) => {
  const rows = machine || [];
  const pairs = [];
  boxes.forEach((b, i) => rows.forEach((m, j) => {
    if (m.fragment == null || isTag(b.label) || !inBox(b, m)) return;
    pairs.push([Math.hypot(m.x - (b.x0 + b.x1) / 2, m.y - (b.y0 + b.y1) / 2), i, j]);
  }));
  pairs.sort((a, b) => a[0] - b[0]);
  const rowOf = boxes.map(() => null);
  const used = new Set();
  for (const [, i, j] of pairs) {
    if (rowOf[i] != null || used.has(j)) continue;
    rowOf[i] = j;
    used.add(j);
  }
  const out = rowOf.map((j) => (j == null ? null : rows[j].fragment));
  out.shared = new Map();
  boxes.forEach((b, i) => {
    if (rowOf[i] != null || !/^\d+$/.test(b.label || '')) return;
    const k = rowOf.findIndex((j) => j != null && inBox(b, rows[j]));
    if (k < 0) return;
    out.shared.set(i, rows[rowOf[k]].fragment);
    out.shared.set(k, rows[rowOf[k]].fragment);
  });
  out.shared.forEach((f, i) => { out[i] = null; });
  return out;
};
// labels a person gave in a frame (fragment -> local identity): boxes with a local identity whose fragment had no box,
// or a box with another label, before the change
const assignedFragments = (before, after, machine) => {
  const fb = fragmentsOf(before, machine);
  const was = new Map();
  before.forEach((b, i) => { if (fb[i] != null) was.set(fb[i], b.label); });
  const out = new Map();
  fragmentsOf(after, machine).forEach((f, i) => {
    const { label } = after[i];
    if (f != null && /^\d+$/.test(label) && was.get(f) !== label) out.set(f, label);
  });
  return out;
};
// those labels on the boxes of another frame of the chunk (as the server's inherit_labels: per fragment the label of the
// nearest frame before, else after, marked inherited); a local identity already on another box swaps with it.
// byFrag: fragment -> [[frame, label]] sorted by frame
const inheritFragments = (boxes, machine, byFrag, fn) => {
  if (!byFrag || !byFrag.size) return boxes;
  const out = boxes.map((b) => ({ ...b }));
  fragmentsOf(out, machine).forEach((f, i) => {
    const list = f != null && byFrag.get(f);
    if (!list || !list.length) return;
    const before = list.filter(([n]) => n < fn);
    const src = before.length ? before[before.length - 1] : list.find(([n]) => n > fn);
    if (!src) return;
    const [from, label] = src;
    const old = out[i].label;
    if (old !== label) {
      const j = out.findIndex((b, k) => k !== i && b.label === label);
      if (j >= 0) { out[j].label = /^\d+$/.test(old) ? old : ''; out[j].inherited = undefined; }
    }
    out[i].label = label;
    out[i].inherited = from;
  });
  return out;
};
// label changes of a frame: fragment -> new local identity, for the boxes whose fragment had another label before
const changedFragments = (before, after, machine) => {
  const fb = fragmentsOf(before, machine);
  const fa = fragmentsOf(after, machine);
  const was = new Map();
  before.forEach((b, i) => { if (fb[i] != null) was.set(fb[i], b.label); });
  const out = new Map();
  after.forEach((b, i) => {
    const f = fa[i];
    if (f != null && was.has(f) && was.get(f) !== b.label && /^\d+$/.test(b.label)) out.set(f, b.label);
  });
  return out;
};
// those labels on the boxes of another frame (by fragment); a local identity already on another box swaps with it
const applyLabels = (boxes, frags, mapping, from) => {
  const next = boxes.map((b) => ({ ...b }));
  for (const [f, label] of mapping) {
    const i = frags.indexOf(f);
    if (i < 0 || next[i].label === label) continue;
    const old = next[i].label;
    const j = next.findIndex((b, k) => k !== i && b.label === label);
    if (j >= 0) { next[j].label = /^\d+$/.test(old) ? old : ''; next[j].inherited = undefined; }
    next[i].label = label;
    next[i].inherited = from;
  }
  return next;
};
const PROPAGATE_MAX = 1000;   // frames a label change is carried forward at most (within its scene)
// Where to look in a frame: boxes and spots that may hide an identity problem, grouped into regions
// [{x0, y0, x1, y1, reasons}] (most reasons first)
const REGION_PAD = 40;        // px of the frame around each spot; spots closer than twice this join one region
const MIN_FOCUS = 250;        // px of the frame shown at least when zooming to a region
const inside = (b, x, y) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const findRegions = (boxes, fragments, frame, prevBoxes, duplicates) => {
  const items = [];
  const add = (r, reason) => items.push({ x0: r.x0 - REGION_PAD, y0: r.y0 - REGION_PAD, x1: r.x1 + REGION_PAD, y1: r.y1 + REGION_PAD, reasons: [reason] });
  const starts = new Set(frame?.fragment_events?.starts || []);
  const ends = new Set(frame?.fragment_events?.ends || []);
  boxes.forEach((b, i) => {
    const f = fragments[i];
    const name = b.label || '?';
    if (!b.label) add(b, 'box without identity');
    if (unsure(b)) add(b, `solver ${b.confidence === 'low' ? 'could not decide' : 'unsure'} about ${name}`);
    if (f != null && starts.has(f)) add(b, `fragment f${f} (${name}) starts here`);
    if (f != null && ends.has(f)) add(b, `fragment f${f} (${name}) ends here`);
    if (b.label && duplicates.includes(b.label)) add(b, `${b.label} on two boxes`);
    boxes.forEach((o, j) => {
      if (j > i && overlaps(b, o)) {
        add({ x0: Math.min(b.x0, o.x0), y0: Math.min(b.y0, o.y0), x1: Math.max(b.x1, o.x1), y1: Math.max(b.y1, o.y1) },
          `${name} and ${o.label || '?'} touching`);
      }
    });
  });
  // a tracked fly with no box around it
  for (const m of frame?.machine || []) {
    if (!boxes.some((b) => inside(b, m.x, m.y))) add({ x0: m.x - 30, y0: m.y - 30, x1: m.x + 30, y1: m.y + 30 }, 'tracked fly without box');
  }
  // a fly of the previous frame with no box here: where it was
  if (prevBoxes) {
    const have = new Set(boxes.map((b) => b.label));
    for (const b of prevBoxes) if (/^\d+$/.test(b.label) && !have.has(b.label)) add(b, `fly ${b.label} has no box (was here in the previous frame)`);
  }
  // join overlapping spots
  let regions = items;
  for (let merged = true; merged;) {
    merged = false;
    const out = [];
    for (const r of regions) {
      const o = out.find((q) => overlaps(q, r));
      if (o) {
        o.x0 = Math.min(o.x0, r.x0); o.y0 = Math.min(o.y0, r.y0); o.x1 = Math.max(o.x1, r.x1); o.y1 = Math.max(o.y1, r.y1);
        for (const t of r.reasons) if (!o.reasons.includes(t)) o.reasons.push(t);
        merged = true;
      } else out.push({ ...r, reasons: [...r.reasons] });
    }
    regions = out;
  }
  return regions.sort((a, b) => b.reasons.length - a.reasons.length || a.y0 - b.y0);
};
const CACHE_FRAMES = 80;      // frames kept in the browser (images + boxes)
const PREFETCH_AHEAD = 20;    // frames loaded ahead in ← / → order
const PREFETCH_BEHIND = 6;
const FILTERS = [['todo', 'To do'], ['flagged', '⚑ Flagged'], ['all', 'All'], ['done', 'Done']];
const UNDO_DEPTH = 100;
const HANDLE = 6;            // px (screen) around an edge / corner of a box that resizes it
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
const geometry = (list) => list.map(({ x0, y0, x1, y1, label, track }) => [x0, y0, x1, y1, label, track || null]);
const iou = (a, b) => {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / ((a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter);
};
// the tracks of the frame before (`prev`, boxes with a `track`) not hidden yet, on frame fn. Unsaved frame: each one
// replaces the box with its local identity and the boxes it overlaps (IoU > 0.5). Saved frame: what a person saved
// stays; a box with the track's local identity joins the track (its geometry kept), else the track's box is added
const TRACK_MARK = '▸';
const withTracks = (base, prev, hiddenAt, fn, saved) => {
  const live = (prev || []).filter((t) => t.track && !(hiddenAt.get(t.track) <= fn) && !base.some((b) => b.track === t.track));
  if (!live.length) return base;
  const copy = ({ x0, y0, x1, y1, label, track }) => ({ x0, y0, x1, y1, label, track });
  const sameId = (b, t) => /^\d+$/.test(t.label) && b.label === t.label;
  if (saved) {
    const next = base.map((b) => {
      const t = live.find((q) => sameId(b, q));
      return t ? { ...b, track: t.track } : b;
    });
    return [...next, ...live.filter((t) => !base.some((b) => sameId(b, t))).map(copy)];
  }
  const keep = base.filter((b) => !live.some((t) => sameId(b, t) || iou(b, t) > 0.5));
  return [...keep, ...live.map(copy)];
};
const sameBoxes = (a, b) => JSON.stringify(geometry(a)) === JSON.stringify(geometry(b));
const unsure = (b) => b.confidence === 'low' || b.confidence === 'medium';
const fmtTime = (t) => (t ? new Date(t * 1000).toLocaleString() : '');

function BoxCanvas({ image, width, height, boxes, fragments, regions, focus, machine, selected, setSelected, onDraft, onCommit, newLabel, showMachine, drawMode, onDrawn }) {
  const canvasRef = useRef(null);
  const [view, setView] = useState({ zoom: 1, cx: null, cy: null });
  const drag = useRef(null);
  const [hover, setHover] = useState(null);       // {i, part}
  const w = image?.naturalWidth || 1000;
  const h = image?.naturalHeight || 1000;
  const cx = view.cx ?? w / 2;
  const cy = view.cy ?? h / 2;
  const fit = Math.min(width / w, height / h);
  const scale = fit * view.zoom;
  const toScreen = useCallback((x, y) => [(x - cx) * scale + width / 2, (y - cy) * scale + height / 2], [cx, cy, scale, width, height]);
  const toImage = useCallback((sx, sy) => [(sx - width / 2) / scale + cx, (sy - height / 2) / scale + cy], [cx, cy, scale, width, height]);
  useEffect(() => { setView({ zoom: 1, cx: null, cy: null }); }, [w, h]);
  // zoom to a region (focus.rect, null: the whole frame); 'ensure': only when zoomed out or the region is out of view
  useEffect(() => {
    if (!focus) return;
    const r = focus.rect;
    if (!r) { setView({ zoom: 1, cx: null, cy: null }); return; }
    if (focus.mode === 'ensure' && view.zoom > 1) {
      const [vx0, vy0] = toImage(0, 0);
      const [vx1, vy1] = toImage(width, height);
      if (r.x0 >= vx0 && r.y0 >= vy0 && r.x1 <= vx1 && r.y1 <= vy1) return;
    }
    const rw = Math.max(r.x1 - r.x0, MIN_FOCUS);
    const rh = Math.max(r.y1 - r.y0, MIN_FOCUS);
    const zoom = Math.max(1, Math.min(16, Math.min(width / (rw * 1.2), height / (rh * 1.2)) / fit));
    setView({ zoom, cx: (r.x0 + r.x1) / 2, cy: (r.y0 + r.y1) / 2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
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

    // where to look: numbered dashed regions under the boxes
    (regions || []).forEach((r, k) => {
      const [x0, y0] = toScreen(r.x0, r.y0);
      const [x1, y1] = toScreen(r.x1, r.y1);
      ctx.setLineDash([7, 5]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ff7a00';
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setLineDash([]);
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#ff7a00';
      ctx.fillRect(x1 - 18, y1 - 17, 18, 17);
      ctx.fillStyle = '#000';
      ctx.fillText(String(k + 1), x1 - 13, y1 - 15);
    });
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
      const frag = fragments?.[i];
      const sharedFrag = fragments?.shared?.get(i);
      // ↳: label taken from a frame you saved (same fragment), not decided in this frame; f65×: blob of two flies
      const text = `${b.track ? `${TRACK_MARK} ` : ''}${b.inherited != null ? '↳' : ''}${b.label || '?'}${frag != null ? `  f${frag}` : sharedFrag != null ? `  f${sharedFrag}×` : ''}`;
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
  // the box part under the pointer: near an edge or corner (within HANDLE px) resizes, inside moves;
  // the selected box first, then the smallest one
  const hit = (sx, sy) => {
    const order = boxes.map((b, i) => [i, i === selected ? -1 : (b.x1 - b.x0) * (b.y1 - b.y0)])
      .sort((a, b) => a[1] - b[1]).map(([i]) => i);
    for (const i of order) {
      const b = boxes[i];
      const [x0, y0] = toScreen(b.x0, b.y0);
      const [x1, y1] = toScreen(b.x1, b.y1);
      if (sx < x0 - HANDLE || sx > x1 + HANDLE || sy < y0 - HANDLE || sy > y1 + HANDLE) continue;
      // a box smaller than its handles: the nearer edge
      const dn = Math.abs(sy - y0), ds = Math.abs(sy - y1), dw = Math.abs(sx - x0), de = Math.abs(sx - x1);
      const v = Math.min(dn, ds) <= HANDLE ? (dn <= ds ? 'n' : 's') : '';
      const hz = Math.min(dw, de) <= HANDLE ? (dw <= de ? 'w' : 'e') : '';
      if (v || hz) return { i, part: v + hz };
      return { i, part: 'move' };
    }
    return null;
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
    const [x, y] = toImage(sx, sy);
    // new boxes only after N
    if (drawMode) {
      drag.current = { kind: 'draw', sx, sy, x0: clampX(x), y0: clampY(y), x1: clampX(x), y1: clampY(y), moved: false };
      return;
    }
    const target = hit(sx, sy);
    if (target) {
      setSelected(target.i);
      drag.current = { kind: target.part, i: target.i, x, y, orig: { ...boxes[target.i] }, moved: false };
    } else {
      // outside every box: pan (a click without moving deselects)
      drag.current = { kind: 'pan', sx, sy, cx, cy, click: true, moved: false };
    }
  };
  const clampX = (v) => Math.max(0, Math.min(w, v));
  const clampY = (v) => Math.max(0, Math.min(h, v));
  const onPointerMove = (e) => {
    const [sx, sy] = local(e);
    const d = drag.current;
    if (!d) { setHover(drawMode ? null : hit(sx, sy)); return; }
    if (d.kind === 'pan') {
      if (d.click && !d.moved && Math.hypot(sx - d.sx, sy - d.sy) < MIN_DRAG) return;
      d.moved = true;
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
    if (d.kind === 'pan') { if (d.click && !d.moved) setSelected(null); setHover((x) => ({ ...x })); return; }
    if (d.kind === 'draw') {
      if (!d.moved) return;
      const b = { x0: Math.min(d.x0, d.x1), y0: Math.min(d.y0, d.y1), x1: Math.max(d.x0, d.x1), y1: Math.max(d.y0, d.y1), label: newLabel || '' };
      if (drawMode === 'track') b.track = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      if (b.x1 - b.x0 < 3 || b.y1 - b.y0 < 3) return;
      onDrawn?.();
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
    const s = fit * zoom;
    setView({ zoom, cx: x - (sx - width / 2) / s, cy: y - (sy - height / 2) / s });
  };
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const stop = (e) => e.preventDefault();
    canvas.addEventListener('wheel', stop, { passive: false });
    return () => canvas.removeEventListener('wheel', stop);
  }, []);

  const part = drag.current && drag.current.kind !== 'draw' ? drag.current.kind : hover?.part;
  const cursor = part === 'pan' ? 'grabbing'
    : drawMode ? 'crosshair'
    : part === 'move' ? 'move'
    : part === 'nw' || part === 'se' ? 'nwse-resize'
    : part === 'ne' || part === 'sw' ? 'nesw-resize'
    : part === 'n' || part === 's' ? 'ns-resize'
    : part === 'e' || part === 'w' ? 'ew-resize' : 'grab';
  return (
    <div className="pose-canvas-wrap" style={{ width, height }}>
      <canvas ref={canvasRef} style={{ width, height, display: 'block', cursor }}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
              onPointerLeave={() => setHover(null)} onWheel={onWheel}
              onContextMenu={(e) => e.preventDefault()}
              onDoubleClick={(e) => { if (!hit(...local(e))) setView({ zoom: 1, cx: null, cy: null }); }} />
      {!image && <div className="pose-canvas-msg">Loading the frame…</div>}
      {drawMode && image && <div className="bx-draw-badge">{drawMode === 'track' ? 'New track: drag on the image (kept in the next frames until hidden with H) · Shift+N / Esc cancels' : 'New shape: drag on the image · N / Esc cancels'}</div>}
    </div>
  );
}

// The scenes (thousands): only the rows in view are rendered, and only when the list, the current scene or the
// scroll change, not on every frame.
const ROW_H = 21;
const SceneList = React.memo(function SceneList({ scenes, currentK, onPick, zt0 }) {
  const [el, setEl] = useState(null);
  const [top, setTop] = useState(0);
  const { height } = useElementSize(el);
  // the current scene scrolled into view when it changes
  useEffect(() => {
    if (!el || currentK == null) return;
    const i = scenes.findIndex((s) => s.k === currentK);
    if (i < 0) return;
    const y = i * ROW_H;
    if (y < el.scrollTop) el.scrollTop = y;
    else if (y + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = y + ROW_H - el.clientHeight;
  }, [el, currentK, scenes]);
  const first = Math.max(0, Math.floor(top / ROW_H) - 10);
  const last = Math.min(scenes.length, Math.ceil((top + (height || 600)) / ROW_H) + 10);
  return (
    <div className="ov-scroll sl-scroll" ref={setEl} onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
      <div style={{ height: scenes.length * ROW_H, position: 'relative' }}>
        <table className="pe-table ov-table pose-table sl-table bx-scenes" style={{ position: 'absolute', top: first * ROW_H, left: 0, right: 0 }}>
          <tbody>
            {scenes.slice(first, last).map((s) => (
              <tr key={s.k} className={s.k === currentK ? 'pose-selected' : undefined} onClick={() => onPick(s)} title={s.reason}>
                <td><span className={`sl-dot ${s.done === s.length ? 'sl-done' : s.done ? 'sl-pred' : 'sl-sugg'}`} /></td>
                <td className="qc-num">{s.start.toLocaleString()}</td>
                <td className="qc-num qc-muted" title={s.clock != null ? fmtZt(s.clock / 3600 - zt0) : 'No time for this frame'}>
                  {s.clock != null ? `ZT ${fmtZtShort(s.clock / 3600 - zt0)}` : "–"}
                </td>
                <td className="qc-muted">{s.done}/{s.length}{s.flags ? <span className="bx-flag" title={`${s.flags} flagged frame(s) not saved yet`}> ⚑{s.flags}</span> : null}</td>
                <td className="qc-muted bx-reason">{s.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});

export default function AnnotateTab({ active, currentExperiment, viewerFrame, onOpenFrame, request }) {
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
  const [drawMode, setDrawMode] = useState(null);    // 'shape' (N) / 'track' (Shift+N): the next drag draws a new box
  const [pending, setPending] = useState(0);
  const [jump, setJump] = useState('');
  const [zt, setZt] = useState({ start: '', end: '' });
  const [rootEl, setRootEl] = useState(null);
  const [stageEl, setStageEl] = useState(null);
  const [full, setFull] = useState(false);
  const [focus, setFocus] = useState(null);         // {rect, mode, key}: what the canvas zooms to
  const [focusIdx, setFocusIdx] = useState(0);
  const [showRegions, setShowRegions] = useState(() => { try { return localStorage.getItem('fh-annotate-regions') !== '0'; } catch { return true; } });
  const [zoomProblems, setZoomProblems] = useState(() => { try { return localStorage.getItem('fh-annotate-zoom-problems') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('fh-annotate-regions', showRegions ? '1' : '0'); localStorage.setItem('fh-annotate-zoom-problems', zoomProblems ? '1' : '0'); } catch { /* ignore */ } }, [showRegions, zoomProblems]);
  // label changes carried forward along each fly's idtrackerai fragment (as a CVAT track)
  const [carry, setCarry] = useState(() => { try { return localStorage.getItem('fh-annotate-carry') !== '0'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem('fh-annotate-carry', carry ? '1' : '0'); } catch { /* ignore */ } }, [carry]);
  const edits = useRef(new Map());                  // fn -> {boxes, from}: labels carried from frame `from`, not saved yet
  const [, setEditsVersion] = useState(0);
  const carryGen = useRef(0);
  // ZT0 (hour of the folder names' clock, UTC): 12 unless changed here
  const [zt0, setZt0] = useState(() => { try { const v = localStorage.getItem('fh-annotate-zt0'); return v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : 12; } catch { return 12; } });
  useEffect(() => { try { localStorage.setItem('fh-annotate-zt0', String(zt0)); } catch { /* ignore */ } }, [zt0]);          // full screen: only the frame, its navigation and the labels
  const fillHeight = useFillHeight(rootEl, [active, info, full]);
  const stage = useElementSize(stageEl);
  const queue = useRef(Promise.resolve());
  const undo = useRef([]);
  const latest = useRef(0);
  const trackOut = useRef(new Map());               // frame -> its track boxes when it was left (carried to frame + 1)
  const hiddenAt = useRef(new Map());               // track -> frame where it was hidden (not carried from there on)
  const fragLabels = useRef(new Map());             // chunk -> fragment -> [[frame, label]]: labels given in this session
  const worked = useRef(new Set());                 // scenes (k) opened in this session: Save writes all their frames
  const lastSaved = useRef(null);                   // boxes of the last frame saved (for "copy previous")
  const digits = useRef({ text: '', t: 0 });
  const currentRef = useRef(null);
  currentRef.current = current;
  const [reloadKey, setReloadKey] = useState(0);

  const fetchInfo = useCallback(() => {
    setLoading(true);
    const forExperiment = fetchedFor.current;   // which experiment this info is of (a link waits for it)
    return api.get('/api/annotate/scenes')
      .then((r) => setInfo({ ...unwrap(r.data), forExperiment }))
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
  // scenes of scene_qc.csv can overlap (each starts 2 frames before its first failure): the scene picked (sceneK) is the
  // current one while it holds the frame, else the first scene holding it
  const [sceneK, setSceneK] = useState(null);
  useEffect(() => { setSceneK(null); }, [info?.experiment]);
  const sceneOf = useCallback((fn) => {
    const picked = sceneK != null ? scenes[sceneK] : null;
    if (picked && fn >= picked.start && fn < picked.start + picked.length) return picked;
    return scenes.find((s) => fn >= s.start && fn < s.start + s.length);
  }, [scenes, sceneK]);
  const currentScene = current != null ? sceneOf(current) : null;
  useEffect(() => { if (currentScene) worked.current.add(currentScene.k); }, [currentScene]);

  // Frames already loaded or loading: fn -> {promise, value}. Images never change; a frame's boxes do (saved,
  // proposals made again), so its entry is dropped then. Reading the video forward is cheap and a jump costs a
  // seek (1-3 s), so the frames around the current one are loaded ahead, one at a time, in increasing order.
  const images = useRef(new Map());
  const datas = useRef(new Map());
  const cached = useCallback((map, fn, load) => {
    let e = map.get(fn);
    if (!e) {
      e = { value: undefined };
      e.promise = load(fn).then((v) => { e.value = v; return v; }, (err) => { map.delete(fn); throw err; });
      map.set(fn, e);
      while (map.size > CACHE_FRAMES) map.delete(map.keys().next().value);
    } else { map.delete(fn); map.set(fn, e); }      // most recently used last
    return e;
  }, []);
  const imageOf = useCallback((fn) => cached(images.current, fn, (n) => new Promise((resolve, reject) => {
    const img = new Image();
    // decoded ahead too: a 2100 px JPEG takes a while to decode when it is first drawn
    img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => resolve(img));
    img.onerror = () => reject(new Error(`Could not read frame ${n}`));
    img.src = apiUrl(`/api/frame/${n}`);
  })), [cached]);
  const dataOf = useCallback((fn) => cached(datas.current, fn, (n) => queue.current.then(() => api.get(`/api/annotate/frame/${n}`)).then((r) => unwrap(r.data))), [cached]);  // after the saves sent
  const forget = useCallback((fn) => { if (fn == null) datas.current.clear(); else datas.current.delete(fn); }, []);
  useEffect(() => { images.current.clear(); datas.current.clear(); edits.current.clear(); trackOut.current.clear(); hiddenAt.current.clear(); fragLabels.current.clear(); worked.current.clear(); }, [currentExperiment]);
  useEffect(() => { datas.current.clear(); }, [reloadKey, info?.proposal_run?.t]);
  useEffect(() => { edits.current.clear(); setEditsVersion((v) => v + 1); }, [info?.proposal_run?.t]);

  // a frame as shown: unsaved, its carried edits, then the labels given in this session to its fragments (anywhere in
  // the chunk, with "Carry labels"); then the tracks of the frame before, kept until hidden
  const compose = useCallback((fn, v) => {
    let shown = v.boxes;
    if (!v.saved) {
      shown = edits.current.get(fn)?.boxes ?? shown;
      if (carry) shown = inheritFragments(shown, v.machine, fragLabels.current.get(v.chunk), fn);
    }
    const prev = trackOut.current.get(fn - 1) ?? datas.current.get(fn - 1)?.value?.boxes?.filter((b) => b.track);
    return withTracks(shown, prev, hiddenAt.current, fn, v.saved);
  }, [carry]);
  const composeRef = useRef(compose);
  composeRef.current = compose;
  const recordLabels = useCallback((before, after) => {
    if (current == null || !frame?.machine || frame.frame_number !== current) return;
    const given = assignedFragments(before, after, frame.machine);
    if (!given.size) return;
    if (!fragLabels.current.has(frame.chunk)) fragLabels.current.set(frame.chunk, new Map());
    const byFrag = fragLabels.current.get(frame.chunk);
    for (const [f, label] of given) {
      const list = (byFrag.get(f) || []).filter(([n]) => n !== current);
      list.push([current, label]);
      list.sort((a, b) => a[0] - b[0]);
      byFrag.set(f, list);
    }
    if (!carry) return;
    // and into the frames of the chunk already saved: the server relabels their boxes of those fragments
    const fn = current;
    const { chunk } = frame;
    setPending((n) => n + 1);
    const p = queue.current.then(() => api.post('/api/annotate/relabel_fragments', {
      experiment: currentExperiment, frame_number: fn, mapping: Object.fromEntries(given),
    }))
      .then((r) => {
        const d = unwrap(r.data);
        if (!d.changed.length) return;
        for (const [k, e] of [...datas.current]) if (k !== currentRef.current && e.value?.chunk === chunk) datas.current.delete(k);
        const pairs = Object.entries(d.mapping).map(([f, l]) => `fragment ${f} → ${l}`).join(', ');
        log('info', `Frame ${fn}: ${pairs} written in ${d.changed.length} saved frame${d.changed.length === 1 ? '' : 's'} of chunk ${chunk}`);
      })
      .catch((err) => log('error', `Frame ${fn}: the saved frames of chunk ${chunk} were not relabelled: ${errorOf(err)}`))
      .finally(() => setPending((n) => n - 1));
    queue.current = p;
  }, [current, frame, carry, currentExperiment, log]);

  // open a frame
  useEffect(() => {
    if (current == null) return;
    const id = ++latest.current;
    setSelected(null);
    undo.current = [];
    const d = dataOf(current);
    const show = (v) => {
      setFrame(v); setBoxes(composeRef.current(current, v)); setLoaded(v.boxes);
    };
    if (d.value) show(d.value);
    else {
      // nothing of the frame left before while this one loads: a key pressed meanwhile (Enter, →) must not save the
      // boxes of the frame before as this frame's
      setFrame(null); setBoxes([]); setLoaded([]);
      d.promise.then((v) => { if (id === latest.current) show(v); })
        .catch((err) => { if (id === latest.current) { setFrame({ error: errorOf(err) }); setBoxes([]); setLoaded([]); } });
    }
    const im = imageOf(current);
    if (im.value) setImage(im.value);
    else {
      setImage(null);
      im.promise.then((img) => { if (id === latest.current) setImage(img); })
        .catch((err) => { if (id === latest.current) log('error', err.message); });
    }
  }, [current, reloadKey, dataOf, imageOf, log]);

  // only the boxes of the frame open (frame loaded and its number the current one) are ever saved as that frame
  const ready = Boolean(frame && !frame.error && frame.frame_number === current);
  const dirty = ready && !sameBoxes(boxes, loaded);
  // closing / reloading the page with annotations not written yet (this frame's edits, labels carried to frames not
  // saved, saves still on their way): the browser asks first
  const unsavedRef = useRef(false);
  unsavedRef.current = Boolean(dirty) || edits.current.size > 0 || pending > 0;
  useEffect(() => {
    const onUnload = (e) => {
      if (!unsavedRef.current) return undefined;
      e.preventDefault();
      e.returnValue = '';   // older browsers need it set
      return '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);
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
  const fragments = useMemo(() => fragmentsOf(boxes, frame?.machine), [boxes, frame]);
  const regions = useMemo(() => {
    if (current == null || !frame || frame.error || frame.frame_number !== current) return [];
    const prev = edits.current.get(current - 1)?.boxes ?? datas.current.get(current - 1)?.value?.boxes;
    return findRegions(boxes, fragments, frame, prev, duplicates);
  }, [boxes, fragments, frame, current, duplicates]);
  // zoom to the first region when a frame opens (if on), then Z / the list for the others
  const autoFocused = useRef(null);
  useEffect(() => {
    if (current == null || frame?.frame_number !== current || autoFocused.current === current) return;
    autoFocused.current = current;
    setFocusIdx(0);
    if (zoomProblems && regions.length) setFocus({ rect: regions[0], mode: 'ensure', key: `auto-${current}` });
  }, [zoomProblems, current, frame, regions]);
  const focusRegion = useCallback((k) => {
    if (k == null) { setFocus({ rect: null, key: `all-${Date.now()}` }); return; }
    if (!regions.length) { log('info', 'Nothing to look at in this frame'); return; }
    const i = ((k % regions.length) + regions.length) % regions.length;
    setFocusIdx(i);
    setFocus({ rect: regions[i], mode: 'force', key: `r${i}-${Date.now()}` });
  }, [regions, log]);

  const save = useCallback((fn, list) => {
    setPending((n) => n + 1);
    const prev = datas.current.get(fn)?.value;
    const relabel = !prev || JSON.stringify(prev.boxes.map((b) => b.label)) !== JSON.stringify(list.map((b) => b.label));
    forget(fn);
    const p = queue.current.then(() => api.post(`/api/annotate/frame/${fn}`, { boxes: list, experiment: currentExperiment })
      .then((r) => {
        const d = unwrap(r.data);
        lastSaved.current = d.boxes;
        if (edits.current.delete(fn)) setEditsVersion((v) => v + 1);
        forget(fn);
        // other frames of the chunk inherit labels from the saved ones (server side): read them again
        if (relabel && prev) for (const [k, e] of [...datas.current]) if (e.value?.chunk === prev.chunk) datas.current.delete(k);
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
  }, [currentExperiment, log, forget]);

  const unsave = useCallback(() => {
    if (current == null || !frame?.saved) return;
    if (!window.confirm(`Frame ${current} will no longer count as annotated (its boxes are deleted). Continue?`)) return;
    api.delete(`/api/annotate/frame/${current}`)
      .then(() => {
        forget(current);
        setInfo((old) => old && { ...old, annotated: old.annotated.filter((a) => a.frame_number !== current) });
        setReloadKey((k) => k + 1);   // opened again: the proposal
      })
      .catch((err) => log('error', `Frame ${current}: ${errorOf(err)}`));
  }, [current, frame, log, forget]);

  // leaving a frame: its edits are saved (an untouched proposal is not)
  // open frame fn (and make scene k the current one); false when the frame cannot be left
  const go = useCallback((fn, k) => {
    if (fn == null) return false;
    if (fn === current) { if (k != null) setSceneK(k); return true; }
    if (current != null && frame?.frame_number === current) trackOut.current.set(current, boxes.filter((b) => b.track));
    if (dirty) {
      if (duplicates.length) { log('warning', `Frame ${current}: local identity ${duplicates.join(', ')} is on two boxes. Fix it (or Ctrl+Z) before leaving the frame`); return false; }
      save(current, boxes);
    }
    if (k != null) setSceneK(k);
    setCurrent(fn);
    return true;
  }, [current, frame, dirty, duplicates, boxes, save, log]);

  const goRef = useRef(go);
  goRef.current = go;

  // a link (?tab=annotate&experiment=…&frame=…, App.js): open that frame once the experiment's scenes are here
  const handledRequest = useRef(null);
  useEffect(() => {
    if (!request || handledRequest.current === request.nonce || !info) return;
    if (flatName(info.forExperiment) !== request.experiment) return;
    handledRequest.current = request.nonce;
    const fn = request.frameNumber;
    const scene = scenes.find((s) => fn >= s.start && fn < s.start + s.length);
    goRef.current(fn, scene ? scene.k : null);
  }, [request, info, scenes]);
  const pick = useCallback((sc) => goRef.current(sc.start, sc.k), []);

  const stepFrame = useCallback((d) => {
    if (current == null) { if (shownScenes.length) go(shownScenes[0].start, shownScenes[0].k); return; }
    const s = sceneOf(current);
    if (s) {
      const target = current + d;
      if (target >= s.start && target < s.start + s.length) { go(target); return; }
      const i = shownScenes.findIndex((x) => x.k === s.k);
      const list = i >= 0 ? shownScenes : scenes;
      const j = (i >= 0 ? i : list.findIndex((x) => x.k === s.k)) + (d > 0 ? 1 : -1);
      if (j >= 0 && j < list.length) go(d > 0 ? list[j].start : list[j].start + list[j].length - 1, list[j].k);
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
    if (j >= 0 && j < list.length) go(list[j].start, list[j].k);
  }, [shownScenes, current, sceneOf, go]);

  // accept this frame as it is shown, then the next one
  const accept = useCallback(() => {
    if (current == null || !ready) return;
    if (duplicates.length) { log('warning', `Local identity ${duplicates.join(', ')} is on two boxes`); return; }
    save(current, boxes);
    setLoaded(boxes);
    stepFrame(1);
  }, [current, frame, boxes, duplicates, save, stepFrame, log]);

  // Ctrl+S: save everything, staying here (as CVAT): this frame as shown, then every frame of each scene opened in
  // this session as it would open (its proposal with the labels and tracks carried into it; saved frames only when
  // something was carried into them) and the frames holding carried labels anywhere. Frames in scene order, so a
  // track goes on from frame to frame.
  const savingAll = useRef(false);
  const saveNow = useCallback(async () => {
    const here = current != null && frame && !frame.error && frame.frame_number === current;
    if (here && duplicates.length) { log('warning', `Frame ${current}: local identity ${duplicates.join(', ')} is on two boxes. Nothing saved`); return; }
    if (savingAll.current) { log('info', 'Already saving'); return; }
    savingAll.current = true;
    setPending((n) => n + 1);    // the page asks before closing meanwhile
    const sent = [];
    let failed = 0;
    try {
      if (here) {
        sent.push(save(current, boxes));
        setLoaded(boxes);
        trackOut.current.set(current, boxes.filter((b) => b.track));
      }
      const frames = new Set();
      for (const k of worked.current) {
        const sc = scenes[k];
        if (sc) for (let fn = sc.start; fn < sc.start + sc.length; fn += 1) frames.add(fn);
      }
      for (const fn of edits.current.keys()) frames.add(fn);
      frames.delete(current);
      const list = [...frames].sort((a, b) => a - b);
      if (!here && !list.length) { log('info', 'Nothing to save'); return; }
      if (list.length > 20) log('info', `Saving ${list.length} frames of ${worked.current.size} scene(s)…`);
      const keepLast = here ? boxes : lastSaved.current;   // "copy previous" stays the frame you saved
      let done = 0;
      for (const fn of list) {
        done += 1;
        if (list.length > 200 && done % 200 === 0) log('info', `Save all: ${done} of ${list.length} frames`);
        let v = datas.current.get(fn)?.value;
        if (!v) {
          try { v = unwrap((await queue.current.then(() => api.get(`/api/annotate/frame/${fn}`))).data); } catch (err) {
            failed += 1; log('error', `Frame ${fn}: ${errorOf(err)}`); continue;
          }
        }
        const shown = composeRef.current(fn, v);
        trackOut.current.set(fn, shown.filter((b) => b.track));
        if (v.saved && !edits.current.has(fn) && sameBoxes(shown, v.boxes)) continue;
        const seen = new Set();
        const dup = shown.find((b) => /^\d+$/.test(b.label) && (seen.has(b.label) || !seen.add(b.label)));
        if (dup) { failed += 1; log('warning', `Frame ${fn} not saved: local identity ${dup.label} is on two boxes`); continue; }
        sent.push(save(fn, shown));
      }
      const ok = await Promise.all(sent);
      lastSaved.current = keepLast;
      const good = ok.filter(Boolean).length;
      failed += ok.length - good;
      log(failed ? 'warning' : 'info', `${good} frame${good === 1 ? '' : 's'} saved${failed ? `, ${failed} not saved (see above)` : ''}`);
    } finally {
      savingAll.current = false;
      setPending((n) => n - 1);
    }
  }, [current, frame, boxes, duplicates, scenes, save, log]);

  // edits
  // carry the label changes of frame `from` to the next frames of its scene: each changed fly is followed by its
  // fragment until the fragment ends; stops at a frame a person saved (or the one open)
  const propagate = useCallback((from, mapping) => {
    const gen = ++carryGen.current;
    const sc = sceneOf(from);
    if (!sc || !mapping.size) return;
    const end = Math.min(sc.start + sc.length, from + 1 + PROPAGATE_MAX);
    const live = new Map(mapping);
    (async () => {
      let last = from;
      for (let n = from + 1; n < end && live.size; n += 1) {
        let d;
        try { d = await dataOf(n).promise; } catch { break; }
        if (gen !== carryGen.current) return;
        if (d.saved) break;
        const base = edits.current.get(n)?.boxes ?? d.boxes;
        const frags = fragmentsOf(base, d.machine);
        for (const f of [...live.keys()]) if (!frags.includes(f)) live.delete(f);
        if (!live.size) break;
        edits.current.set(n, { boxes: applyLabels(base, frags, live, from), from });
        last = n;
        // the frame open (reached before the carry): its boxes too, unless edited there
        if (n === currentRef.current && !undo.current.length) setBoxes(edits.current.get(n).boxes);
        if ((n - from) % 10 === 0) setEditsVersion((v) => v + 1);
      }
      setEditsVersion((v) => v + 1);
      if (last > from) log('info', `Frame ${from}: labels carried to frames ${from + 1}–${last} (${[...mapping].map(([f, l]) => `fragment ${f} → ${l}`).join(', ')})`);
    })();
  }, [sceneOf, dataOf, log]);
  const carryChange = useCallback((before, after) => {
    if (!carry || current == null || !frame?.machine) return;
    propagate(current, changedFragments(before, after, frame.machine));
  }, [carry, current, frame, propagate]);

  const commit = useCallback((next, opts = {}) => {
    const before = opts.before || boxes;
    undo.current.push(before);
    if (undo.current.length > UNDO_DEPTH) undo.current.shift();
    setBoxes(next);
    if (opts.select !== undefined) setSelected(opts.select);
    carryChange(before, next);
    recordLabels(before, next);
  }, [boxes, carryChange, recordLabels]);
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
    carryChange(boxes, prev);
    recordLabels(boxes, prev);
    // a track hidden here and back with the undo: carried again
    for (const b of prev) if (b.track && hiddenAt.current.get(b.track) === current && !boxes.some((q) => q.track === b.track)) hiddenAt.current.delete(b.track);
    setBoxes(prev);
    setSelected(null);
  }, [log, boxes, carryChange, recordLabels, current]);

  // a label on the selected box; a local identity already used moves to the other box's old label
  const setLabel = useCallback((label) => {
    if (selected == null || !boxes[selected]) { setNewLabel(label); return; }
    const old = boxes[selected].label;
    const next = boxes.map((b, i) => {
      if (i === selected) return { ...b, label, inherited: undefined };
      if (label && /^\d+$/.test(label) && b.label === label) return { ...b, label: /^\d+$/.test(old) ? old : '', inherited: undefined };
      return b;
    });
    commit(next);
  }, [selected, boxes, commit]);
  // deleting a track's box (or H) hides the track: it is no longer carried from this frame on
  const removeSelected = useCallback(() => {
    if (selected == null || !boxes[selected]) return;
    const { track } = boxes[selected];
    if (track) hiddenAt.current.set(track, current);
    commit(boxes.filter((_, i) => i !== selected));
    setSelected(null);
  }, [selected, boxes, commit, current]);
  const hideSelected = useCallback(() => {
    if (selected == null || !boxes[selected]?.track) { log('info', 'Select a box of a track to hide it (a shape is deleted with Del)'); return; }
    removeSelected();
  }, [selected, boxes, removeSelected, log]);
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

  // the frame ← / → would open from fn (across scenes, as stepFrame)
  const neighbour = useCallback((fn, d) => {
    const s = sceneOf(fn);
    if (!s) return fn + d;
    if (fn + d >= s.start && fn + d < s.start + s.length) return fn + d;
    let list = shownScenes;
    let i = list.findIndex((x) => x.k === s.k);
    if (i < 0) { list = scenes; i = list.findIndex((x) => x.k === s.k); }
    const j = i + (d > 0 ? 1 : -1);
    if (j < 0 || j >= list.length) return null;
    return d > 0 ? list[j].start : list[j].start + list[j].length - 1;
  }, [sceneOf, shownScenes, scenes]);

  // load ahead: the next PREFETCH_AHEAD frames, the PREFETCH_BEHIND before, the next / previous flagged frames
  const prefetchPlan = useRef([]);
  const prefetching = useRef(false);
  useEffect(() => {
    if (current == null || !active) return;
    const walk = (d, n) => {
      const out = [];
      let fn = current;
      for (let i = 0; i < n; i += 1) { fn = neighbour(fn, d); if (fn == null || fn < 0) break; out.push(fn); }
      return out;
    };
    const flagsTodo = todoFlags.filter((f) => f !== current);
    const nextFlag = flagsTodo.find((f) => f > current);
    const prevFlag = [...flagsTodo].reverse().find((f) => f < current);
    const sc = sceneOf(current);
    const i = sc ? shownScenes.findIndex((x) => x.k === sc.k) : -1;
    const sceneStarts = i < 0 ? [] : [shownScenes[i + 1], shownScenes[i - 1]].filter(Boolean).map((x) => [x.start, x.start + 1, x.start + 2]);
    const ahead = walk(1, PREFETCH_AHEAD);
    const groups = [ahead.slice(0, 5), ...sceneStarts, walk(-1, PREFETCH_BEHIND).reverse(), ahead.slice(5),
      ...[nextFlag, prevFlag].filter((f) => f != null).map((f) => [f, f + 1, f + 2])];
    const seen = new Set([current]);
    const plan = [];
    for (const g of groups) for (const fn of g) if (!seen.has(fn)) { seen.add(fn); plan.push(fn); }
    prefetchPlan.current = plan;
    if (prefetching.current) return;
    prefetching.current = true;
    (async () => {
      while (prefetchPlan.current.length) {
        const fn = prefetchPlan.current.shift();
        if (images.current.get(fn)?.value && datas.current.get(fn)?.value) continue;
        try { await Promise.all([imageOf(fn).promise, dataOf(fn).promise]); } catch { /* shown when opened */ }
      }
      prefetching.current = false;
    })();
  }, [current, active, neighbour, todoFlags, imageOf, dataOf, sceneOf, shownScenes]);

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

  // scene_qc.csv made here: make-identogram + auto-annotate-qc (the validation pipeline's first steps) as a job
  const [preparing, setPreparing] = useState(false);
  const prepare = useCallback(() => {
    const again = info?.source?.kind === 'scene_qc';
    if (again && !window.confirm('Make scene_qc.csv again? The scenes listed can change; boxes you saved are kept.')) return;
    const follow = (job) => {
      setPreparing(true);
      return trackJob(job).then((done) => {
        setPreparing(false);
        if (!done) return;
        const steps = done.result?.steps || [];
        if (done.status === 'done') log('success', `Scenes prepared: ${done.result?.scenes ?? '?'} scenes to check`);
        else {
          const failed = steps.find((st) => st.exit_code !== 0);
          if (failed) log('error', `${failed.command}\n${failed.tail.slice(-15).join('\n')}`);
        }
        fetchInfo();
      });
    };
    api.post('/api/annotate/prepare', { force: again })
      .then((r) => follow(unwrap(r.data)))
      .catch((err) => {
        // already running (e.g. started before a reload): follow that job
        const running = err.response?.status === 409 && err.response.data?.job;
        if (running) { log('info', 'The scenes of this experiment are being prepared already'); follow(running); return; }
        setPreparing(false);
        log('error', `Prepare scenes: ${errorOf(err)}`);
      });
  }, [info, trackJob, log, fetchInfo]);

  const toggleFull = useCallback(() => {
    if (full) {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      setFull(false);
    } else {
      setFull(true);
      // the browser's full screen too when allowed (else the tab fills the window)
      rootEl?.requestFullscreen?.().catch(() => {});
    }
  }, [full, rootEl]);
  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) setFull(false); };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  useEffect(() => { if (!active && full) toggleFull(); }, [active, full, toggleFull]);

  // keys (while shown, not in a field)
  const keys = useRef({});
  keys.current = { drawMode, hideSelected, saveNow, stepFrame, stepScene, stepFlag, accept, undoLast, setLabel, removeSelected, copyPrevious, toggleFull, full, focusRegion, focusIdx, focus, boxes, selected, nAnimals, log };
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      const k = keys.current;
      if (e.ctrlKey && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); k.undoLast(); return; }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyS') { e.preventDefault(); k.saveNow(); return; }
      const label = (n) => {
        if (n >= 1 && n <= k.nAnimals) k.setLabel(String(n));
        else k.log('info', `There is no fly ${n} (${k.nAnimals} flies)`);
      };
      // Ctrl+Shift+0…9: local identity 10…19
      if (e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey) {
        const d = digitOf(e);
        if (d != null) { e.preventDefault(); label(10 + d); }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Shift+1…9: local identity 1…9, Shift+0: 10
      if (e.shiftKey && digitOf(e) != null) { e.preventDefault(); const d = digitOf(e); label(d === 0 ? 10 : d); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); if (e.shiftKey) k.stepScene(-1); else k.stepFrame(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); if (e.shiftKey) k.stepScene(1); else k.stepFrame(1); }
      else if (e.key === 'Enter') { e.preventDefault(); k.accept(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); k.removeSelected(); }
      else if (e.key === 'Tab' && k.boxes.length) {
        e.preventDefault();
        const n = k.boxes.length;
        setSelected((s) => (s == null ? (e.shiftKey ? n - 1 : 0) : (s + (e.shiftKey ? n - 1 : 1)) % n));
      }
      else if (e.key === 'Escape' && k.drawMode) setDrawMode(null);
      else if (e.code === 'KeyN') { const kind = e.shiftKey ? 'track' : 'shape'; setDrawMode((m) => (m === kind ? null : kind)); }
      else if (e.code === 'KeyH') k.hideSelected();
      else if (e.key === 'Escape') { if (k.full && !document.fullscreenElement) k.toggleFull(); else setSelected(null); }
      else if (e.key === 'm' || e.key === 'M') k.toggleFull();
      // Z: zoom to the next region to look at (the first one after a frame opens), Shift+Z: the whole frame
      else if (e.code === 'KeyZ') { if (e.shiftKey) k.focusRegion(null); else k.focusRegion(k.focus?.mode === 'force' ? k.focusIdx + 1 : k.focusIdx); }
      else if (e.key === 'u' || e.key === 'U') k.setLabel('');
      else if (e.key === 'p' || e.key === 'P') k.copyPrevious();
      // D / F: previous / next frame (with Shift: scene), as CVAT; G / Shift+G: next / previous flagged frame
      else if (e.code === 'KeyD') { e.preventDefault(); if (e.shiftKey) k.stepScene(-1); else k.stepFrame(-1); }
      else if (e.code === 'KeyF') { e.preventDefault(); if (e.shiftKey) k.stepScene(1); else k.stepFrame(1); }
      else if (e.code === 'KeyG') k.stepFlag(e.shiftKey ? -1 : 1);
      else if (digitOf(e) != null) {
        // two digits typed quickly make one number (more than 9 flies)
        const key = String(digitOf(e));
        const now = Date.now();
        const d = digits.current;
        const text = k.nAnimals > 9 && now - d.t < 700 && d.text.length === 1 ? d.text + key : key;
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

  const mainHeight = full ? null : fillHeight ? fillHeight - 60 : 640;
  const stageW = Math.max(200, Math.floor(stage.width));
  const stageH = Math.max(200, Math.floor(stage.height));
  const doneFrames = info?.annotated?.length || 0;
  const identityOf = (label) => (frame?.concatenation && /^\d+$/.test(label) ? frame.concatenation[label] : undefined);

  if (!currentExperiment) return <div className="ov"><div className="card ov-controls toolbar">Load an experiment first.</div></div>;

  return (
    <div className={`ov${full ? ' bx-full' : ''}`} ref={setRootEl}>
      {!full && <div className="card ov-controls toolbar">
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
        <button onClick={prepare} disabled={!info || preparing}
                className={info && info.source?.kind !== 'scene_qc' ? 'btn-primary' : undefined}
                title="Run make-identogram and auto-annotate-qc (the first steps of the validation pipeline) in the background: they write flyhostel/validation/scene_qc.csv, the scenes listed here, which Propose needs. Can take a long time on many flies / chunks; follow it in the console">
          {preparing ? 'Preparing scenes…' : info?.source?.kind === 'scene_qc' ? 'Prepare scenes again' : 'Prepare scenes'}
        </button>
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
      </div>}

      <div className="sl-main" style={mainHeight ? { height: mainHeight } : undefined}>
        {!full && <section className="card sl-list">
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
          {info && !scenes.length && (
            <div className="qc-muted qc-pad">
              No scenes to check: this experiment has no flyhostel/validation/scene_qc.csv (made by the validation pipeline before CVAT)
              and the QC tab has not run on it. Any frame can still be opened with Frame.
              <div style={{ marginTop: 8 }}>
                <button className="btn-primary" onClick={prepare} disabled={preparing}>
                  {preparing ? 'Preparing scenes…' : 'Prepare scenes'}
                </button>
              </div>
            </div>
          )}
          <SceneList scenes={shownScenes} currentK={currentScene?.k} onPick={pick} zt0={zt0} />
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
        </section>}

        <section className="card sl-view bx-view">
          <header className="card-header">
            {current != null ? (
              <span>
                Frame {current.toLocaleString()}
                {frame?.source && <span className={`bx-source bx-source-${frame.source}`}>{{ solver: 'solver proposal', tracking: 'idtrackerai proposal', saved: 'saved' }[frame.source]}</span>}
                {!frame?.saved && edits.current.get(current) && <span className="bx-source bx-source-carried" title="Labels carried from an earlier frame: saved when you leave this frame">labels from frame {edits.current.get(current).from}</span>}
                <span className="ov-count"> · chunk {frame?.chunk ?? '…'}{currentScene ? ` · scene ${currentScene.start.toLocaleString()} (${current - currentScene.start + 1} of ${currentScene.length})` : ''}</span>
                <span className="ov-count" title="Zeitgeber time of this frame: hours since ZT0 of the first day (as the ZT range of Integrate)">
                  {' · '}{frame?.clock != null ? fmtZt(frame.clock / 3600 - zt0) : 'ZT …'}
                </span>
                <label className="field bx-zt0" title="Hour of ZT0 (lights on), on the clock of the experiment folder names (UTC). Default 12">
                  ZT0 at
                  <input type="number" min={0} max={23.99} step={0.5} value={zt0} style={{ width: 54 }}
                         onChange={(e) => setZt0(e.target.value === '' ? 12 : Number(e.target.value))} />
                  h
                </label>
              </span>
            ) : <span>No frame open</span>}
            <span className="spacer" />
            <button onClick={() => stepScene(-1)} title="Previous scene (Shift+← or Shift+D)">⏮</button>
            <button onClick={() => stepFrame(-1)} title="Previous frame (← or D)">◀</button>
            <button onClick={() => stepFrame(1)} title="Next frame (→ or F)">▶</button>
            <button onClick={() => stepScene(1)} title="Next scene (Shift+→ or Shift+F)">⏭</button>
            <button onClick={() => stepFlag(-1)} disabled={!todoFlags.length} title="Previous flagged frame not saved yet (Shift+G)">◀ ⚑</button>
            <button onClick={() => stepFlag(1)} disabled={!todoFlags.length} title="Next flagged frame not saved yet (G)">⚑ ▶</button>
            <label className="field" title="A label you change is carried to the next frames of the scene, following the fly's idtrackerai fragment (until it ends or a frame you saved); those frames open with it and are saved when you leave them">
              <input type="checkbox" checked={carry} onChange={(e) => setCarry(e.target.checked)} />Carry labels
            </label>
            <label className="field"><input type="checkbox" checked={showMachine} onChange={(e) => setShowMachine(e.target.checked)} />Centroids</label>
            {full && <span className="ov-count">{pending > 0 ? 'Saving…' : dirty ? 'Edited' : frame?.saved ? 'Saved' : ''}</span>}
            <button onClick={toggleFull} className={full ? 'btn-primary' : undefined}
                    title={full ? 'Leave full screen (M or Esc)' : 'Full screen: the frame, its navigation and the labels only (M)'}>{full ? '✕ Full screen' : '⛶ Full screen'}</button>
          </header>
          <div className="card-body bx-view-body">
            {currentScene && (
              <div className="bx-strip" title="Frames of the scene: green = saved, purple = labels carried (not saved yet), yellow = flagged">
                {Array.from({ length: currentScene.length }, (_, i) => {
                  const fn = currentScene.start + i;
                  return (
                    <span key={fn} className={`bx-cell${annotated.has(fn) ? ' bx-saved' : edits.current.has(fn) ? ' bx-carried' : flagged.has(fn) ? ' bx-flagged' : ''}${fn === current ? ' bx-current' : ''}`}
                          onClick={() => go(fn)} title={`Frame ${fn}${annotated.has(fn) ? ' (saved)' : ''}`} />
                  );
                })}
              </div>
            )}
            <div className="bx-stage" ref={setStageEl}>
            {current != null && !frame?.error && (
              <BoxCanvas image={image} width={stageW} height={stageH} boxes={boxes} fragments={fragments}
                         regions={showRegions ? regions : null} focus={focus} machine={frame?.machine} selected={selected} setSelected={setSelected}
                         onDraft={onDraft} onCommit={onCommit} newLabel={newLabel} showMachine={showMachine}
                         drawMode={drawMode} onDrawn={() => setDrawMode(null)} />
            )}
            {frame?.error && <div className="qc-muted">{frame.error}</div>}
            {current == null && <div className="qc-muted">Pick a scene in the list (or → to start with the first one).</div>}
            </div>
            {current != null && (
              <div className="toolbar sl-actions">
                <button className="btn-primary" onClick={accept} disabled={!frame || !!frame.error || duplicates.length > 0}
                        title="Save this frame as shown and go to the next one (Enter)">Save &amp; next (Enter)</button>
                <button onClick={saveNow} disabled={!frame || !!frame.error || duplicates.length > 0}
                        title="Save this frame and every frame of the scenes you opened in this session (as shown, with the labels and tracks carried into them), and stay here (Ctrl+S)">Save all (Ctrl+S)</button>
                <button onClick={copyPrevious} title="Boxes of the last frame saved (P)">Copy previous (P)</button>
                <button className={drawMode === 'shape' ? 'btn-primary' : undefined} onClick={() => setDrawMode((m) => (m === 'shape' ? null : 'shape'))}
                        title="The next drag on the image draws a box of this frame only (N; N / Esc cancels)">New shape (N)</button>
                <button className={drawMode === 'track' ? 'btn-primary' : undefined} onClick={() => setDrawMode((m) => (m === 'track' ? null : 'track'))}
                        title="The next drag on the image draws a box that stays in the next frames until it is hidden (Shift+N; Shift+N / Esc cancels)">New track (Shift+N)</button>
                <button onClick={hideSelected} disabled={selected == null || !boxes[selected]?.track}
                        title="The selected track ends here: its box leaves this frame and the next ones (H)">Hide track (H)</button>
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
          <div className="qc-pad bx-regions">
            <div className="bx-regions-head">
              <b>Where to look</b>
              <span className="spacer" />
              <label className="field" title="Draw the regions on the frame"><input type="checkbox" checked={showRegions} onChange={(e) => setShowRegions(e.target.checked)} />Show</label>
              <label className="field" title="Zoom to the first region when a frame opens (only when it is out of view)"><input type="checkbox" checked={zoomProblems} onChange={(e) => setZoomProblems(e.target.checked)} />Zoom</label>
            </div>
            {regions.length === 0 ? <div className="qc-muted">Nothing suspicious in this frame</div> : regions.map((r, k) => (
              <div key={k} className={`bx-region${focus?.mode === 'force' && focusIdx === k ? ' bx-region-on' : ''}`} onClick={() => focusRegion(k)}
                   title="Zoom here (Z: next region, Shift+Z: whole frame)">
                <span className="bx-region-n">{k + 1}</span>{r.reasons.join(' · ')}
              </div>
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
              <thead><tr><th>Label</th><th title="Identity of that local identity in this chunk (CONCATENATION)">Id</th><th title="idtrackerai fragment of the blob in the box: frames of one fragment share its identity, so a fragment corrected once is corrected in all its frames">Frag</th><th>x</th><th>y</th><th>w×h</th><th title="The solver's note">!</th></tr></thead>
              <tbody>
                {boxes.map((b, i) => (
                  <tr key={i} className={i === selected ? 'pose-selected' : undefined} onClick={() => setSelected(i)}>
                    <td><span className="qc-swatch" style={{ background: labelColor(b.label), border: '1px solid #0006' }} />{b.track ? <span title="Track: kept in the next frames until hidden (H)">{TRACK_MARK} </span> : null}{b.label || '?'}</td>
                    <td className="qc-num qc-muted">{identityOf(b.label) ?? ''}</td>
                    <td className="qc-num">{fragments[i] ?? (fragments.shared?.has(i)
                      ? <span title="One blob holding this fly and another (a crossing): its fragment carries no label to either box">{fragments.shared.get(i)}×</span>
                      : '')}</td>
                    <td className="qc-num">{((b.x0 + b.x1) / 2).toFixed(0)}</td>
                    <td className="qc-num">{((b.y0 + b.y1) / 2).toFixed(0)}</td>
                    <td className="qc-num qc-muted">{(b.x1 - b.x0).toFixed(0)}×{(b.y1 - b.y0).toFixed(0)}</td>
                    <td title={b.note ? `${b.confidence ? `${b.confidence} confidence: ` : ''}${b.note}` : ''}>
                      {b.inherited != null ? <span className="bx-inherited" title={`Label from frame ${b.inherited}, where you gave it to this fragment`}>↳</span> : null}
                      {unsure(b) ? <span className={b.confidence === 'low' ? 'sl-error' : 'bx-flag'}>!</span> : b.note ? <span className="qc-muted">i</span> : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="qc-muted qc-pad bx-help">
            N / Shift+N then drag: new shape (this frame) / new track (kept in the next frames until H hides it) · drag inside a box: move · drag its edges or corners: resize · drag outside the boxes: pan · 1–9 or Shift+1–9: label (Shift+0: 10, Ctrl+Shift+1…9: 11…19
            {nAnimals > 9 ? '; or two digits quickly' : ''}) · U: no label · Del: delete · Tab: next box · Enter: save &amp; next · Ctrl+S: save all ·
            ←/→ or D/F: frame · Shift+←/→ or Shift+D/F: scene · G / Shift+G: next / previous flagged frame · P: copy previous · Z / Shift+Z: zoom to the next region to look at / whole frame · M: full screen · Ctrl+Z undo · wheel zoom · right/middle drag or Shift+drag: pan · double click: reset zoom
          </div>
        </section>
      </div>
    </div>
  );
}
