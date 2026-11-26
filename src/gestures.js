// Touch / pen gestures on a canvas through pointer events: tap, double tap, long press (then drag),
// one-finger drag (pan), two-finger pinch (zoom + pan). Mouse pointers are ignored, so a component keeps
// its mouse handlers exactly as they were and adds these for phones / tablets / pens.
//
//   const g = useTouchGestures({ onTap, onDoubleTap, onLongPress, onLongMove, onLongEnd,
//                                onPanStart, onPan, onPanEnd, onPinch, onPinchEnd });
//   <canvas {...g} style={{ touchAction: 'none' }} />
//
// Positions are client coordinates ({x, y}). onPan gets ({dx, dy} since the last move, {x, y} now, start);
// onPinch gets ({scale: factor since the last move, x, y: midpoint now, dx, dy: midpoint moved}).
// The pointerdown of a touch is preventDefault'ed: no emulated mousedown / mouseup follows it (a component's
// mouse handlers would otherwise act on the same tap a second time); click events still fire.
import { useRef } from 'react';

const MOVE_PX = 8;          // a finger moving less than this is still a tap / long press
const LONG_MS = 500;
const DOUBLE_MS = 300;
const DOUBLE_PX = 30;

export function useTouchGestures(handlers) {
  const h = useRef(handlers);
  h.current = handlers;
  const s = useRef({ pointers: new Map(), mode: null, start: null, timer: null, lastTap: null, pinch: null });

  const clearTimer = () => { clearTimeout(s.current.timer); s.current.timer = null; };
  const mid = () => {
    const [a, b] = [...s.current.pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
  };

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* already released */ }
    const st = s.current;
    st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (st.pointers.size === 1) {
      st.mode = null;
      st.start = { x: e.clientX, y: e.clientY, t: Date.now(), last: { x: e.clientX, y: e.clientY }, pointerType: e.pointerType };
      clearTimer();
      if (h.current.onLongPress) {
        st.timer = setTimeout(() => {
          st.timer = null;
          if (st.mode === null && st.pointers.size === 1) {
            st.mode = 'long';
            h.current.onLongPress({ x: st.start.last.x, y: st.start.last.y });
          }
        }, LONG_MS);
      }
    } else if (st.pointers.size === 2) {
      clearTimer();
      if (st.mode === 'pan') h.current.onPanEnd?.();
      if (st.mode === 'long') h.current.onLongEnd?.({ ...st.start.last, cancelled: true });
      st.mode = 'pinch';
      st.pinch = mid();
    }
  };

  const onPointerMove = (e) => {
    if (e.pointerType === 'mouse') return;
    const st = s.current;
    if (!st.pointers.has(e.pointerId)) return;
    st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (st.mode === 'pinch' && st.pointers.size === 2) {
      const m = mid();
      h.current.onPinch?.({ scale: m.d / st.pinch.d, x: m.x, y: m.y, dx: m.x - st.pinch.x, dy: m.y - st.pinch.y });
      st.pinch = m;
      return;
    }
    if (st.pointers.size !== 1 || !st.start) return;
    const p = { x: e.clientX, y: e.clientY };
    if (st.mode === null && Math.hypot(p.x - st.start.x, p.y - st.start.y) > MOVE_PX) {
      clearTimer();
      st.mode = 'pan';
      h.current.onPanStart?.({ x: st.start.x, y: st.start.y });
    }
    const dx = p.x - st.start.last.x, dy = p.y - st.start.last.y;
    st.start.last = p;
    if (st.mode === 'pan') h.current.onPan?.({ dx, dy }, p, st.start);
    else if (st.mode === 'long') h.current.onLongMove?.(p);
  };

  const onPointerUp = (e) => {
    if (e.pointerType === 'mouse') return;
    const st = s.current;
    if (!st.pointers.has(e.pointerId)) return;
    st.pointers.delete(e.pointerId);
    const cancelled = e.type === 'pointercancel';
    if (st.mode === 'pinch') {
      if (st.pointers.size === 0) { h.current.onPinchEnd?.(); st.mode = null; st.start = null; }
      else st.mode = 'pinched';             // the other finger lifting later is not a tap
      return;
    }
    if (st.pointers.size) return;
    clearTimer();
    const p = { x: e.clientX, y: e.clientY };
    if (st.mode === 'pan') h.current.onPanEnd?.(p);
    else if (st.mode === 'long') h.current.onLongEnd?.({ ...p, cancelled });
    else if (st.mode === null && st.start && !cancelled) {
      const now = Date.now();
      const last = st.lastTap;
      if (last && now - last.t < DOUBLE_MS && Math.hypot(p.x - last.x, p.y - last.y) < DOUBLE_PX && h.current.onDoubleTap) {
        st.lastTap = null;
        h.current.onDoubleTap(p);
      } else {
        st.lastTap = { ...p, t: now };
        h.current.onTap?.(p, st.start.pointerType);
      }
    }
    st.mode = null;
    st.start = null;
  };

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
}

// true on phones / tablets (no mouse as the primary pointer)
export const COARSE_QUERY = '(pointer: coarse)';
