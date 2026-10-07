// Splitter.js  —  drag handle that resizes the panels next to it
//
// `onDrag(dx, dy)` receives the pointer offset (px) since the drag started;
// the caller turns it into a size. Double click calls `onReset`.

import React, { useRef } from 'react';

export default function Splitter({ direction = 'vertical', onDragStart, onDrag, onDragEnd, onReset, title, className = '', style }) {
  const startRef = useRef(null);

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    startRef.current = { x: e.clientX, y: e.clientY };
    document.body.classList.add(direction === 'vertical' ? 'resizing-col' : 'resizing-row');
    onDragStart?.();
  };

  const onPointerMove = (e) => {
    if (!startRef.current) return;
    onDrag(e.clientX - startRef.current.x, e.clientY - startRef.current.y);
  };

  const end = (e) => {
    if (!startRef.current) return;
    startRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    document.body.classList.remove('resizing-col', 'resizing-row');
    onDragEnd?.();
  };

  return (
    <div
      className={`splitter splitter-${direction} ${className}`}
      role="separator"
      aria-orientation={direction}
      title={title}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      style={style}
    />
  );
}
