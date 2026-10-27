// EthogramTrack.js  —  canvas ethogram of one fly (/api/ethogram/<fly>/track)
//
// One row per behavior, x = seconds since the start of the fly's movie, plus an
// overview strip of the whole recording with the visible window on it. The view
// ([t0, t1]) belongs to the parent, so nothing here resets the zoom: the parent
// only moves the window, keeping its width.
//
// Zoomed out, each pixel column of a row is shaded by the share of its seconds
// spent in that behavior (a single second still shows faintly); zoomed in, each
// second is a block, optionally shaded by the classifier's score.
//
// Below the rows, the fly's deepethogram (DEG) labels (runs of movie seconds, see
// deg_labels.py) and the selection being labelled: Shift+drag selects seconds.

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useElementSize } from './layout';

// Okabe-Ito colours (colour-blind safe); each behavior also has its own row.
export const BEHAVIOR_STYLE = {
  inactive: { label: 'inactive', color: '#0072B2' },
  'inactive+micromovement': { label: 'inactive + micromovement', color: '#56B4E9' },
  feed: { label: 'feed', color: '#009E73' },
  groom: { label: 'groom', color: '#E69F00' },
  walk: { label: 'walk', color: '#D55E00' },
};
const styleOf = (behavior) => BEHAVIOR_STYLE[behavior] || { label: behavior, color: '#888888' };

// Classes of the DEG label strip (deg_labels.CLASSES): the RF classes, any other
// combination of columns, and seconds whose frames disagree.
export const LABEL_STYLE = {
  ...BEHAVIOR_STYLE,
  'inactive+pe': { label: 'inactive + PE', color: '#CC79A7' },
  background: { label: 'background', color: '#A0A0A0' },
  other: { label: 'other combination', color: '#5A5A5A' },
  mixed: { label: 'mixed (frames differ)', color: '#F0E442' },
};
export const labelStyleOf = (cls) => LABEL_STYLE[cls] || { label: cls, color: '#888888' };

const ROW_H = 30;
const AXIS_H = 24;
const OVERVIEW_H = 26;
const LABELS_H = 22;
export const MIN_VIEW_WIDTH = 10;     // s
const DRAG_THRESHOLD = 4;             // px moved before a press is a pan, not a click

const pad2 = (n) => String(n).padStart(2, '0');
// seconds -> "hh:mm:ss" (hours keep counting past 24)
export const formatClock = (seconds, withSeconds = true) => {
  const s = Math.round(seconds);
  const sign = s < 0 ? '-' : '';
  const a = Math.abs(s);
  const hm = `${sign}${pad2(Math.floor(a / 3600))}:${pad2(Math.floor((a % 3600) / 60))}`;
  return withSeconds ? `${hm}:${pad2(a % 60)}` : hm;
};
export const formatDuration = (s) =>
  s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${(s / 60).toFixed(1)} min` : `${(s / 3600).toFixed(2)} h`;

const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200];

// Codes, scores, per-behavior prefix sums (share of time in any window in O(1))
// and the run every second belongs to.
export function prepareTrack(track) {
  const n = track.codes.length;
  const nb = track.behaviors.length;
  const codes = Int8Array.from(track.codes);
  const scores = Uint8Array.from(track.scores);
  const counts = Array.from({ length: nb }, () => new Int32Array(n + 1));
  const scoreSums = Array.from({ length: nb }, () => new Float64Array(n + 1));
  const runStart = new Int32Array(n);
  const runEnd = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    for (let b = 0; b < nb; b++) {
      counts[b][i + 1] = counts[b][i];
      scoreSums[b][i + 1] = scoreSums[b][i];
    }
    const c = codes[i];
    if (c >= 0) {
      counts[c][i + 1] += 1;
      scoreSums[c][i + 1] += scores[i];
    }
    runStart[i] = i > 0 && codes[i - 1] === c ? runStart[i - 1] : i;
  }
  for (let i = n - 1; i >= 0; i--) runEnd[i] = i < n - 1 && codes[i + 1] === codes[i] ? runEnd[i + 1] : i + 1;
  return { ...track, n, codes, scores, counts, scoreSums, runStart, runEnd };
}

// Start (s) of the previous / next run of behavior `b` lasting at least `minLength`
// seconds; a run ongoing at `t` is skipped. null if there is none.
export function findRun(data, b, t, direction, minLength = 1) {
  const { n, codes, runStart, runEnd } = data;
  const cur = Math.max(0, Math.min(n - 1, Math.floor(t)));
  const ok = (s) => runEnd[s] - s >= minLength;
  if (direction === 'next') {
    for (let i = cur + 1; i < n; i++) {
      if (codes[i] === b && (i === 0 || codes[i - 1] !== b) && ok(i)) return i;
    }
  } else {
    const before = codes[cur] === b ? runStart[cur] : cur + 1;
    for (let i = before - 1; i >= 0; i--) {
      if (codes[i] === b && (i === 0 || codes[i - 1] !== b) && ok(i)) return i;
    }
  }
  return null;
}

// Share of [t0, t1) spent in each behavior.
const shares = (data, t0, t1) => {
  const i0 = Math.max(0, Math.min(data.n, Math.floor(t0)));
  const i1 = Math.max(i0, Math.min(data.n, Math.ceil(t1)));
  const total = i1 - i0;
  return data.counts.map((c) => (total ? (c[i1] - c[i0]) / total : 0));
};

// Window of the same width as [t0, t1) (within limits), kept inside the recording.
export function clampView(t0, t1, n) {
  const max = Math.max(n, MIN_VIEW_WIDTH) * 1.05;
  const width = Math.min(max, Math.max(MIN_VIEW_WIDTH, t1 - t0));
  if (width >= n) return [(n - width) / 2, (n + width) / 2];
  const start = Math.max(0, Math.min(n - width, t0));
  return [start, start + width];
}

const cssVar = (name, fallback) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function useCanvas(canvas, width, height) {
  // Backing store at the screen's resolution; returns a 2D context in CSS pixels.
  return useCallback(() => {
    if (!canvas || !width) return null;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }, [canvas, width, height]);
}

export default function EthogramTrack({
  data, view, onView, cursorT, onSeek, frameOf, chunksize, shade, minBout, themeName,
  labelRuns, labelClasses, labelVideos, selection, onSelect,
}) {
  const [plotEl, setPlotEl] = useState(null);
  const [mainCanvas, setMainCanvas] = useState(null);
  const [overviewCanvas, setOverviewCanvas] = useState(null);
  const [labelsCanvas, setLabelsCanvas] = useState(null);
  const [labelHover, setLabelHover] = useState(null);  // x on the label strip
  const { width } = useElementSize(plotEl);
  const [hover, setHover] = useState(null);           // { x, row } (t follows the view)
  const viewRef = useRef(view);
  viewRef.current = view;

  const rows = useMemo(() => (data ? data.behaviors.map((_, b) => b).reverse() : []), [data]);   // top to bottom
  const mainH = rows.length * ROW_H + AXIS_H;
  const mainCtx = useCanvas(mainCanvas, width, mainH);
  const overviewCtx = useCanvas(overviewCanvas, width, OVERVIEW_H);
  const labelsCtx = useCanvas(labelsCanvas, width, LABELS_H);

  const [t0, t1] = view;
  const pps = width ? width / (t1 - t0) : 1;           // pixels per second
  const xOf = useCallback((t) => (t - viewRef.current[0]) * (width / (viewRef.current[1] - viewRef.current[0])), [width]);
  const tOf = useCallback((x) => viewRef.current[0] + x * ((viewRef.current[1] - viewRef.current[0]) / width), [width]);

  // ── main rows + axis ──
  // Drawn on the next frame: wheel ticks coalesce, and after a theme switch the
  // new CSS variables are in place (<html data-theme> is set by App after us).
  useEffect(() => {
    const id = requestAnimationFrame(() => drawMain());
    return () => cancelAnimationFrame(id);
    function drawMain() {
      const ctx = mainCtx();
      if (!ctx || !data) return;
      const surface = cssVar('--surface', '#fff');
      const surface2 = cssVar('--surface-2', '#f8fafc');
      const border = cssVar('--border', '#dbe1e8');
      const subtext = cssVar('--subtext', '#64748b');
      const text = cssVar('--text', '#1f2937');
      const accent = cssVar('--accent', '#2563eb');
      ctx.globalAlpha = 1;
      ctx.fillStyle = surface;
      ctx.fillRect(0, 0, width, mainH);

      const rowY = {};
      rows.forEach((b, r) => {
        rowY[b] = r * ROW_H;
        ctx.fillStyle = r % 2 ? surface : surface2;
        ctx.fillRect(0, r * ROW_H, width, ROW_H);
      });
      // outside the recording
      ctx.fillStyle = border;
      if (t0 < 0) ctx.fillRect(0, 0, Math.min(width, -t0 * pps), rows.length * ROW_H);
      if (t1 > data.n) { const x = (data.n - t0) * pps; ctx.fillRect(Math.max(0, x), 0, width - x, rows.length * ROW_H); }

      const padY = 3;
      const colors = data.behaviors.map((b) => styleOf(b).color);
      if (pps >= 1) {
        // one block per second
        const i0 = Math.max(0, Math.floor(t0));
        const i1 = Math.min(data.n, Math.ceil(t1));
        for (let i = i0; i < i1; i++) {
          const c = data.codes[i];
          if (c < 0) continue;
          ctx.globalAlpha = shade ? 0.25 + 0.75 * (data.scores[i] / 100) : 1;
          ctx.fillStyle = colors[c];
          const x = (i - t0) * pps;
          ctx.fillRect(x, rowY[c] + padY, Math.max(1, pps - (pps > 6 ? 1 : 0)), ROW_H - 2 * padY);
        }
      } else {
        // one column per pixel, shaded by the share of time in the behavior
        for (let b = 0; b < colors.length; b++) {
          ctx.fillStyle = colors[b];
          const cnt = data.counts[b];
          const sc = data.scoreSums[b];
          for (let px = 0; px < width; px++) {
            const i0 = Math.max(0, Math.min(data.n, Math.floor(t0 + px / pps)));
            const i1 = Math.max(0, Math.min(data.n, Math.floor(t0 + (px + 1) / pps)));
            if (i1 <= i0) continue;
            const k = cnt[i1] - cnt[i0];
            if (!k) continue;
            let alpha = 0.18 + 0.82 * (k / (i1 - i0));
            if (shade) alpha *= 0.25 + 0.75 * ((sc[i1] - sc[i0]) / k / 100);
            ctx.globalAlpha = alpha;
            ctx.fillRect(px, rowY[b] + padY, 1, ROW_H - 2 * padY);
          }
        }
      }
      ctx.globalAlpha = 1;

      // row separators
      ctx.fillStyle = border;
      for (let r = 1; r <= rows.length; r++) ctx.fillRect(0, r * ROW_H - 0.5, width, 1);

      // axis: ZT when known, else movie time
      const axisY = rows.length * ROW_H;
      const offset = data.zt0 ?? 0;
      const step = TICK_STEPS.find((s) => s * pps >= 90) ?? 86400;
      const first = Math.ceil((t0 + offset) / step) * step;
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let v = first; v <= t1 + offset; v += step) {
        const x = (v - offset - t0) * pps;
        ctx.fillStyle = border;
        ctx.fillRect(Math.round(x), 0, 1, axisY);
        ctx.fillStyle = subtext;
        ctx.fillRect(Math.round(x), axisY, 1, 4);
        const label = `${data.zt0 != null ? 'ZT ' : ''}${formatClock(v, step < 60)}`;
        const half = ctx.measureText(label).width / 2;
        ctx.fillText(label, Math.max(half, Math.min(width - half, x)), axisY + 6);
      }

      // selection being labelled
      if (selection) {
        const xa = (selection[0] - t0) * pps;
        const xb = (selection[1] - t0) * pps;
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = accent;
        ctx.fillRect(xa, 0, Math.max(2, xb - xa), axisY);
        ctx.globalAlpha = 0.8;
        ctx.fillRect(Math.round(xa), 0, 1, axisY);
        ctx.fillRect(Math.round(Math.max(xb, xa + 2)), 0, 1, axisY);
        ctx.globalAlpha = 1;
      }

      // hover line
      if (hover) {
        ctx.fillStyle = text;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(Math.round(hover.x), 0, 1, axisY);
        ctx.globalAlpha = 1;
      }
      // cursor
      if (cursorT != null) {
        const x = (cursorT - t0) * pps;
        if (x >= -2 && x <= width + 2) {
          ctx.fillStyle = accent;
          ctx.fillRect(Math.round(x) - 1, 0, 2, axisY);
          ctx.beginPath();
          ctx.moveTo(x - 5, axisY); ctx.lineTo(x + 5, axisY); ctx.lineTo(x, axisY + 6);
          ctx.fill();
        }
      }
    }
  }, [mainCtx, data, rows, width, mainH, t0, t1, pps, cursorT, hover, shade, selection, themeName]);

  // ── DEG labels: one block per run (labels are sparse) ──
  useEffect(() => {
    const id = requestAnimationFrame(() => drawLabels());
    return () => cancelAnimationFrame(id);
    function drawLabels() {
      const ctx = labelsCtx();
      if (!ctx || !data) return;
      const accent = cssVar('--accent', '#2563eb');
      ctx.globalAlpha = 1;
      ctx.fillStyle = cssVar('--surface-2', '#f8fafc');
      ctx.fillRect(0, 0, width, LABELS_H);
      for (const [a, b, code] of labelRuns || []) {
        if (b < t0 || a > t1) continue;
        const xa = (a - t0) * pps;
        ctx.fillStyle = labelStyleOf(labelClasses?.[code]).color;
        ctx.fillRect(xa, 3, Math.max(1, (b - a) * pps - (pps > 6 ? 1 : 0)), LABELS_H - 6);
      }
      // stretches whose DEG video is made (ready for labelling): black edge
      ctx.strokeStyle = themeName === 'dark' ? cssVar('--text', '#e2e8f0') : '#000000';
      ctx.lineWidth = 1.5;
      for (const [a, b] of labelVideos || []) {
        if (b < t0 || a > t1) continue;
        const xa = Math.max(-2, (a - t0) * pps);
        const xb = Math.min(width + 2, (b - t0) * pps);
        ctx.strokeRect(xa + 0.75, 1.75, Math.max(1, xb - xa - 1.5), LABELS_H - 3.5);
      }
      if (selection) {
        const xa = (selection[0] - t0) * pps;
        const xb = (selection[1] - t0) * pps;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.strokeRect(xa, 1, Math.max(2, xb - xa), LABELS_H - 2);
      }
      if (cursorT != null) {
        ctx.fillStyle = accent;
        ctx.fillRect(Math.round((cursorT - t0) * pps) - 1, 0, 2, LABELS_H);
      }
    }
  }, [labelsCtx, data, width, t0, t1, pps, cursorT, labelRuns, labelClasses, labelVideos, selection, themeName]);

  // ── overview: dominant behavior of each pixel over the whole recording ──
  const overviewImage = useMemo(() => {
    if (!data || !width) return null;
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(width));
    off.height = 1;
    const ctx = off.getContext('2d');
    const colors = data.behaviors.map((b) => styleOf(b).color);
    const per = data.n / width;
    for (let px = 0; px < width; px++) {
      const i0 = Math.floor(px * per);
      const i1 = Math.max(i0 + 1, Math.floor((px + 1) * per));
      let best = -1; let bestCount = 0;
      for (let b = 0; b < colors.length; b++) {
        const k = data.counts[b][Math.min(data.n, i1)] - data.counts[b][Math.min(data.n, i0)];
        if (k > bestCount) { best = b; bestCount = k; }
      }
      if (best < 0) continue;
      ctx.fillStyle = colors[best];
      ctx.fillRect(px, 0, 1, 1);
    }
    return off;
  }, [data, width]);

  useEffect(() => {
    const id = requestAnimationFrame(() => drawOverview());
    return () => cancelAnimationFrame(id);
    function drawOverview() {
      const ctx = overviewCtx();
      if (!ctx || !data) return;
      ctx.globalAlpha = 1;
      ctx.fillStyle = cssVar('--surface-2', '#f8fafc');
      ctx.fillRect(0, 0, width, OVERVIEW_H);
      if (overviewImage) {
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = 0.85;
        ctx.drawImage(overviewImage, 0, 4, width, OVERVIEW_H - 8);
      }
      const scale = width / data.n;
      const accent = cssVar('--accent', '#2563eb');
      // at least 6 px wide, so a short window stays visible
      const mid = ((t0 + t1) / 2) * scale;
      const x0 = Math.max(0, Math.min(t0 * scale, mid - 3));
      const x1 = Math.min(width, Math.max(t1 * scale, mid + 3));
      // dim what is outside the window
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = cssVar('--surface', '#fff');
      ctx.fillRect(0, 0, x0, OVERVIEW_H);
      ctx.fillRect(x1, 0, width - x1, OVERVIEW_H);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(x0 + 1, 1, Math.max(2, x1 - x0 - 2), OVERVIEW_H - 2);
      if (cursorT != null) {
        ctx.fillStyle = accent;
        ctx.fillRect(Math.round(cursorT * scale) - 1, 0, 2, OVERVIEW_H);
      }
    }
  }, [overviewCtx, overviewImage, data, width, t0, t1, cursorT, themeName]);

  // ── wheel on the ethogram or the DEG labels strip: zoom around the pointer
  // (Shift / horizontal scroll: pan) ──
  useEffect(() => {
    if (!mainCanvas || !data) return undefined;
    const canvases = [mainCanvas, labelsCanvas].filter(Boolean);
    const onWheel = (e) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;
      const [a, b] = viewRef.current;
      const spp = (b - a) / width;
      if (e.shiftKey || Math.abs(dx) > Math.abs(dy)) {
        const d = (Math.abs(dx) > Math.abs(dy) ? dx : dy) * spp;
        onView(clampView(a + d, b + d, data.n));
        return;
      }
      const rect = e.currentTarget.getBoundingClientRect();
      const anchor = a + (e.clientX - rect.left) * spp;
      const factor = Math.exp(dy * 0.0015);
      onView(clampView(anchor - (anchor - a) * factor, anchor + (b - anchor) * factor, data.n));
    };
    canvases.forEach((c) => c.addEventListener('wheel', onWheel, { passive: false }));
    return () => canvases.forEach((c) => c.removeEventListener('wheel', onWheel));
  }, [mainCanvas, labelsCanvas, data, width, onView]);

  // ── main canvas: drag pans, click moves the cursor, double click zooms in ──
  const dragRef = useRef(null);
  const localX = (e) => e.clientX - e.currentTarget.getBoundingClientRect().left;
  // whole seconds from the press to the pointer
  const selectTo = (drag, x) => {
    const a = Math.max(0, Math.min(data.n - 1, Math.floor(Math.min(drag.t, tOf(x)))));
    const b = Math.max(a + 1, Math.min(data.n, Math.ceil(Math.max(drag.t, tOf(x)))));
    onSelect([a, b]);
  };
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const select = e.shiftKey && Boolean(onSelect);
    dragRef.current = { x: e.clientX, view: viewRef.current, moved: false, select, t: tOf(localX(e)) };
    if (select) selectTo(dragRef.current, localX(e));
  };
  const onPointerMove = (e) => {
    const x = localX(e);
    const drag = dragRef.current;
    if (drag?.select) {
      selectTo(drag, x);
    } else if (drag) {
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > DRAG_THRESHOLD) drag.moved = true;
      if (drag.moved) {
        const [a, b] = drag.view;
        const d = -dx * ((b - a) / width);
        onView(clampView(a + d, b + d, data.n));
      }
    }
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    setHover({ x, row: Math.floor(y / ROW_H) });
  };
  const onPointerUp = (e) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && !drag.moved && !drag.select) onSeek(Math.max(0, Math.min(data.n, tOf(localX(e)))));
  };
  // label strip: same gestures, its own tooltip
  const onLabelsMove = (e) => {
    const drag = dragRef.current;
    if (drag?.select) selectTo(drag, localX(e));
    else if (drag) onPointerMove(e);
    setLabelHover(localX(e));
  };
  const onDoubleClick = (e) => {
    const t = tOf(localX(e));
    const [a, b] = viewRef.current;
    onView(clampView(t - (b - a) / 4, t + (b - a) / 4, data.n));
  };

  // ── overview: click / drag moves the window there ──
  const overviewDrag = useRef(null);
  const overviewT = (e) => ((e.clientX - e.currentTarget.getBoundingClientRect().left) / width) * data.n;
  const moveWindowTo = (center) => {
    const [a, b] = viewRef.current;
    onView(clampView(center - (b - a) / 2, center + (b - a) / 2, data.n));
  };
  const onOverviewDown = (e) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const t = overviewT(e);
    const [a, b] = viewRef.current;
    // grabbing the window keeps the grab point under the pointer
    const grab = t >= a && t <= b ? t - (a + b) / 2 : 0;
    overviewDrag.current = { grab };
    moveWindowTo(t - grab);
  };
  const onOverviewMove = (e) => {
    if (overviewDrag.current) moveWindowTo(overviewT(e) - overviewDrag.current.grab);
  };
  const onOverviewUp = () => { overviewDrag.current = null; };

  if (!data) return null;

  // " · chunk C · frame N" of movie second t (empty without the fly's properties)
  const frameInfo = (t) => {
    const frame = frameOf?.(t);
    if (frame == null) return null;
    return (
      <span className="eth-dim">
        {chunksize ? ` · chunk ${Math.floor(frame / chunksize)}` : ''} · frame {frame}
      </span>
    );
  };

  // tooltip: the run under the pointer
  let tooltip = null;
  const hoverT = hover ? t0 + hover.x / pps : null;
  if (hover && hoverT >= 0 && hoverT < data.n && !dragRef.current?.moved) {
    const i = Math.floor(hoverT);
    const c = data.codes[i];
    const s = data.runStart[i];
    const e = data.runEnd[i];
    const zt = (t) => (data.zt0 != null ? `ZT ${formatClock(data.zt0 + t)}` : `${formatClock(t)} (movie)`);
    tooltip = (
      <div
        className="eth-tooltip"
        style={{ left: Math.min(hover.x + 14, Math.max(0, width - 250)), top: Math.min(hover.row, rows.length - 1) * ROW_H + ROW_H + 4 }}
      >
        <div>
          {c >= 0 && <span className="eth-swatch" style={{ background: styleOf(data.behaviors[c]).color }} />}
          <b>{c >= 0 ? styleOf(data.behaviors[c]).label : 'not classified'}</b>
          {c >= 0 && <span className="eth-dim"> · score {data.scores[i]}%</span>}
        </div>
        <div>{zt(hoverT)}{frameInfo(hoverT)}</div>
        <div className="eth-dim">bout {zt(s)} – {zt(e)} ({formatDuration(e - s)})</div>
      </div>
    );
  }

  let labelTooltip = null;
  if (labelHover != null && !dragRef.current) {
    const t = t0 + labelHover / pps;
    const run = (labelRuns || []).find(([a, b]) => t >= a && t < b);
    const video = (labelVideos || []).some(([a, b]) => t >= a && t < b);
    const zt = (s) => (data.zt0 != null ? `ZT ${formatClock(data.zt0 + s)}` : `${formatClock(s)} (movie)`);
    labelTooltip = (
      <div className="eth-tooltip" style={{ left: Math.min(labelHover + 14, Math.max(0, width - 250)), top: LABELS_H + 4 }}>
        {run ? (
          <>
            <div>
              <span className="eth-swatch" style={{ background: labelStyleOf(labelClasses?.[run[2]]).color }} />
              <b>{labelStyleOf(labelClasses?.[run[2]]).label}</b>
            </div>
            <div className="eth-dim">{zt(run[0])} – {zt(run[1])} ({formatDuration(run[1] - run[0])})</div>
            <div>{zt(t)}{frameInfo(t)}</div>
          </>
        ) : <div><span className="eth-dim">not labelled · </span>{zt(t)}{frameInfo(t)}</div>}
        <div className="eth-dim">{video ? 'DEG video made (black edge): ready for labelling' : 'no DEG video yet'}</div>
      </div>
    );
  }

  const inView = shares(data, t0, t1);

  return (
    <div className="eth">
      <div className="eth-labels" style={{ paddingBottom: AXIS_H }}>
        {rows.map((b) => {
          const behavior = data.behaviors[b];
          const { label, color } = styleOf(behavior);
          const prev = () => { const s = findRun(data, b, cursorT ?? t0, 'prev', minBout); if (s != null) onSeek(s, { center: true }); };
          const next = () => { const s = findRun(data, b, cursorT ?? t0, 'next', minBout); if (s != null) onSeek(s, { center: true }); };
          return (
            <div key={behavior} className="eth-label" style={{ height: ROW_H }}>
              <button className="eth-jump" onClick={prev} title={`Previous ${label} bout`} aria-label={`Previous ${label} bout`}>◀</button>
              <span className="eth-swatch" style={{ background: color }} />
              <span className="eth-name" title={behavior}>{label}</span>
              <span className="eth-share" title="Share of the visible window">{Math.round(inView[b] * 100)}%</span>
              <button className="eth-jump" onClick={next} title={`Next ${label} bout`} aria-label={`Next ${label} bout`}>▶</button>
            </div>
          );
        })}
      </div>
      <div className="eth-plot" ref={setPlotEl}>
        <canvas
          ref={setMainCanvas}
          style={{ width: '100%', height: mainH, display: 'block', cursor: dragRef.current?.moved ? 'grabbing' : 'crosshair', touchAction: 'none' }}
          role="img"
          aria-label={`Ethogram from ${formatClock(Math.max(0, t0) + (data.zt0 ?? 0))} to ${formatClock(Math.min(data.n, t1) + (data.zt0 ?? 0))}: `
            + rows.map((b) => `${styleOf(data.behaviors[b]).label} ${Math.round(inView[b] * 100)}%`).join(', ')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setHover(null)}
          onDoubleClick={onDoubleClick}
        />
        {tooltip}
      </div>
      {labelRuns && (
        <>
          <div className="eth-label eth-overview-label" style={{ height: LABELS_H }} title="deepethogram labels of this fly">DEG labels</div>
          <div className="eth-plot">
            <canvas
              ref={setLabelsCanvas}
              style={{ width: '100%', height: LABELS_H, display: 'block', cursor: 'crosshair', touchAction: 'none' }}
              onPointerDown={onPointerDown}
              onPointerMove={onLabelsMove}
              onPointerUp={onPointerUp}
              onPointerLeave={() => setLabelHover(null)}
            />
            {labelTooltip}
          </div>
        </>
      )}
      <div className="eth-label eth-overview-label" style={{ height: OVERVIEW_H }}>Whole recording</div>
      <canvas
        ref={setOverviewCanvas}
        className="eth-overview"
        style={{ width: '100%', height: OVERVIEW_H, display: 'block', touchAction: 'none' }}
        title="Click or drag to move the window"
        onPointerDown={onOverviewDown}
        onPointerMove={onOverviewMove}
        onPointerUp={onOverviewUp}
      />
    </div>
  );
}
