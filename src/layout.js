// layout.js  —  sizing hooks for panels that fill the window

import { useEffect, useLayoutEffect, useState } from 'react';
import { useConsoleState, consoleHeight } from './MessageConsole';

const PAGE_BOTTOM_GAP = 12;

// Height (px) from the top of `el` down to the docked console, so a panel can
// fill the window without scrolling. Re-measured on window resize, console
// open/resize and whenever `deps` change (e.g. the tab becomes visible).
export function useFillHeight(el, deps = [], min = 360) {
  const consoleState = useConsoleState();
  const open = consoleState?.open ?? true;
  const bodyHeight = consoleState?.height;
  const [height, setHeight] = useState(null);

  useLayoutEffect(() => {
    const fit = () => {
      if (!el || el.offsetParent === null) return;    // hidden tab: keep the last size
      const top = el.getBoundingClientRect().top + window.scrollY;
      const h = window.innerHeight - top - consoleHeight(open, bodyHeight) - PAGE_BOTTOM_GAP - 2;
      setHeight(Math.max(min, Math.floor(h)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el, open, bodyHeight, min, ...deps]);

  return height;
}

// Content-box size of `el`, kept current with a ResizeObserver. Pass the
// element itself (from a callback ref held in state), so the observer
// attaches when it mounts.
export function useElementSize(el) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return size;
}

// useState mirrored to localStorage (numbers; null = not set).
export function useStoredNumber(key, initial = null) {
  const [value, setValue] = useState(() => {
    try { return Number(localStorage.getItem(key)) || initial; } catch { return initial; }
  });
  useEffect(() => {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    } catch { /* ignore */ }
  }, [key, value]);
  return [value, setValue];
}
