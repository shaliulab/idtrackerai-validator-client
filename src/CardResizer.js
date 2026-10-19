// CardResizer.js  —  drag handle on the bottom edge of a card that sets its height
//
// Put <CardResizer id="..." /> as the last child of a `.card`: dragging makes the
// card shorter or taller (its scrolling part takes the change, see `.card-sized`
// in index.css), the height is kept in localStorage (`fh-card-height-<id>`) and a
// double click returns the card to its natural height. Render it only while a
// collapsible card is open: on unmount the card gets its natural height back.

import React, { useLayoutEffect, useRef } from 'react';

const MIN_HEIGHT = 60;
const storageKey = (id) => `fh-card-height-${id}`;

function readHeight(id) {
  try { return Number(localStorage.getItem(storageKey(id))) || null; } catch { return null; }
}

function writeHeight(id, height) {
  try {
    if (height == null) localStorage.removeItem(storageKey(id));
    else localStorage.setItem(storageKey(id), String(Math.round(height)));
  } catch { /* ignore */ }
}

function applyHeight(card, height) {
  if (!card) return;
  if (height == null) {
    card.style.height = '';
    card.classList.remove('card-sized');
  } else {
    card.style.height = `${height}px`;
    card.classList.add('card-sized');
  }
}

export default function CardResizer({ id }) {
  const ref = useRef(null);
  const dragRef = useRef(null);

  useLayoutEffect(() => {
    const card = ref.current?.parentElement;
    if (!card) return undefined;
    card.classList.add('card-resizable');
    applyHeight(card, readHeight(id));
    return () => {
      applyHeight(card, null);
      card.classList.remove('card-resizable');
    };
  }, [id]);

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { y: e.clientY, height: ref.current.parentElement.getBoundingClientRect().height };
    document.body.classList.add('resizing-row');
  };

  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    const height = Math.max(MIN_HEIGHT, dragRef.current.height + e.clientY - dragRef.current.y);
    applyHeight(ref.current.parentElement, height);
    dragRef.current.last = height;
  };

  const end = (e) => {
    if (!dragRef.current) return;
    if (dragRef.current.last != null) writeHeight(id, dragRef.current.last);
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    document.body.classList.remove('resizing-row');
  };

  const reset = () => {
    writeHeight(id, null);
    applyHeight(ref.current.parentElement, null);
  };

  return (
    <div
      ref={ref}
      className="card-resizer"
      role="separator"
      aria-orientation="horizontal"
      title="Drag to make this card shorter or taller · double click for its natural height"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={reset}
    />
  );
}
