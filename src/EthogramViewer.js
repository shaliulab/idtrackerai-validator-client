// EthogramViewer.js  —  per-fly ethogram tab (merged from the behavior-viewer project)
//
// Shows the pre-rendered plotly ethogram of one fly of the loaded experiment at a
// time, with a dropdown + prev/next buttons to switch between flies of the group.
// When the fly has an HLS movie, the video and the ethogram are kept in sync like
// in behavior-viewer's sync.js: the x axis is seconds since the start of the movie.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Plotly from 'plotly.js-dist-min';
import Hls from 'hls.js';
import api, { apiUrl } from './api';

const API = '/api/ethogram';

// Axios can hand back a raw string when a payload contains NaN; parse defensively.
const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);

// Figures are 10-25 MB of JSON each: keep only the last few in memory.
const FIGURE_CACHE_SIZE = 6;

export default function EthogramViewer({ flies, active, theme, selectStyle, onOpenInViewer }) {
  const [fly, setFly] = useState(null);
  const [properties, setProperties] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [cursorT, setCursorT] = useState(null);      // seconds since movie start

  const plotRef = useRef(null);
  const videoRef = useRef(null);
  const figureCache = useRef(new Map());              // fly -> figure
  const rangeWidthRef = useRef(20);
  const lastTimeUpdateRef = useRef(-1);
  const programmaticRef = useRef(false);              // ignore our own relayouts
  const cursorTRef = useRef(null);

  // Keep the selection within the current group of flies.
  useEffect(() => {
    if (!flies.length) { setFly(null); return; }
    if (!flies.some((f) => f.fly === fly)) {
      const first = flies.find((f) => f.available) || flies[0];
      setFly(first.fly);
    }
  }, [flies, fly]);

  const hasMovie = Boolean(properties?.has_movie);

  const flyIndex = flies.findIndex((f) => f.fly === fly);
  const step = useCallback((delta) => {
    if (!flies.length) return;
    const n = flies.length;
    setFly(flies[(((flyIndex + delta) % n) + n) % n].fly);
  }, [flies, flyIndex]);

  const moveCursor = useCallback((t) => {
    cursorTRef.current = t;
    setCursorT(t);
  }, []);

  const relayout = useCallback((update) => {
    const div = plotRef.current;
    if (!div || !div.layout) return Promise.resolve();
    programmaticRef.current = true;
    return Plotly.relayout(div, update).finally(() => { programmaticRef.current = false; });
  }, []);

  const centerOn = useCallback((t) => {
    const half = rangeWidthRef.current / 2;
    moveCursor(t);
    return relayout({
      'xaxis.range': [t - half, t + half],
      'shapes[0].x0': t,
      'shapes[0].x1': t,
    });
  }, [relayout, moveCursor]);

  // ── Load figure + properties for the selected fly ──
  useEffect(() => {
    if (!active || !fly) return;
    let cancelled = false;
    const entry = flies.find((f) => f.fly === fly);

    const load = async () => {
      setError(null);
      setLoading(true);
      try {
        const { data: props } = await api.get(`${API}/${fly}/properties`);
        if (cancelled) return;
        setProperties(unwrap(props));

        if (entry && !entry.available) {
          throw new Error(`No ethogram has been generated for ${fly}`);
        }

        let figure = figureCache.current.get(fly);
        if (!figure) {
          const { data } = await api.get(`${API}/${fly}/figure`);
          figure = unwrap(data);
          figureCache.current.set(fly, figure);
          while (figureCache.current.size > FIGURE_CACHE_SIZE) {
            figureCache.current.delete(figureCache.current.keys().next().value);
          }
        }
        if (cancelled) return;

        // Flies of a group share the time axis: keep looking at the same time
        // window when switching between them.
        const layout = { ...figure.layout, autosize: true };
        const t = cursorTRef.current;
        if (t != null) {
          const half = rangeWidthRef.current / 2;
          layout.xaxis = { ...layout.xaxis, range: [t - half, t + half] };
          if (layout.shapes?.length) {
            layout.shapes = [{ ...layout.shapes[0], x0: t, x1: t }, ...layout.shapes.slice(1)];
          }
        } else if (layout.xaxis?.range) {
          const [x0, x1] = layout.xaxis.range;
          rangeWidthRef.current = Math.abs(x1 - x0);
          moveCursor((x0 + x1) / 2);
        }

        programmaticRef.current = true;
        await Plotly.react(plotRef.current, figure.data, layout, { responsive: true });
        programmaticRef.current = false;
        if (videoRef.current && cursorTRef.current != null) {
          videoRef.current.currentTime = Math.max(0, cursorTRef.current);
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Could not load ethogram', err);
        setError(err.response?.data?.error || err.message);
        Plotly.purge(plotRef.current);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [fly, active, flies, moveCursor]);

  // Plotly cannot size itself while the tab is display:none.
  useEffect(() => {
    if (active && plotRef.current?.layout) Plotly.Plots.resize(plotRef.current);
  }, [active]);

  // ── Ethogram → video ──
  useEffect(() => {
    const div = plotRef.current;
    if (!div) return;
    const onRelayout = (ev) => {
      if (programmaticRef.current) return;
      let range = ev['xaxis.range'];
      if (!range && ev['xaxis.range[0]'] != null) range = [ev['xaxis.range[0]'], ev['xaxis.range[1]']];
      if (!range) return;
      const [x0, x1] = range.map(Number);
      rangeWidthRef.current = Math.abs(x1 - x0);
      const t = (x0 + x1) / 2;
      moveCursor(t);
      relayout({ 'shapes[0].x0': t, 'shapes[0].x1': t });
      if (videoRef.current && hasMovie) videoRef.current.currentTime = Math.max(0, t);
    };
    const onClick = (ev) => {
      const x = ev.points?.[0]?.x;
      if (x == null) return;
      centerOn(Number(x));
      if (videoRef.current && hasMovie) videoRef.current.currentTime = Math.max(0, Number(x));
    };
    // plotly attaches .on() only after the first newPlot/react.
    if (!div.on) return;
    div.on('plotly_relayout', onRelayout);
    div.on('plotly_click', onClick);
    return () => {
      div.removeListener?.('plotly_relayout', onRelayout);
      div.removeListener?.('plotly_click', onClick);
    };
  }, [hasMovie, relayout, centerOn, moveCursor, loading]);

  // ── HLS movie ──
  useEffect(() => {
    const video = videoRef.current;
    if (!active || !fly || !video || !hasMovie) return;
    const src = apiUrl(`${API}/${fly}/movie/movie.m3u8`);
    // Read the cursor when the stream is ready: the figure may load after this runs.
    const startAt = () => Math.max(0, cursorTRef.current ?? 0);
    let hls = null;
    if (Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { video.currentTime = startAt(); });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.currentTime = startAt();
    }
    return () => {
      if (hls) hls.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [fly, active, hasMovie]);

  // ── Video → ethogram ──
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      const t = Math.floor(video.currentTime);
      if (t === lastTimeUpdateRef.current) return;
      lastTimeUpdateRef.current = t;
      centerOn(t);
    };
    video.addEventListener('timeupdate', onTime);
    return () => video.removeEventListener('timeupdate', onTime);
  }, [centerOn, hasMovie]);

  // Pause the movie when leaving the tab.
  useEffect(() => {
    if (!active) videoRef.current?.pause();
  }, [active]);

  // ── Keyboard: ←/→ pan (Shift ×10, Ctrl ×60, Ctrl+Alt ×600 s), ↑/↓ switch fly ──
  useEffect(() => {
    if (!active) return;
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        step(e.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (cursorTRef.current == null) return;
      e.preventDefault();
      const amount = (e.ctrlKey ? 60 : e.shiftKey ? 10 : 1) * (e.ctrlKey && e.altKey ? 10 : 1);
      const t = cursorTRef.current + (e.key === 'ArrowLeft' ? -amount : amount);
      centerOn(t);
      if (videoRef.current && hasMovie) videoRef.current.currentTime = Math.max(0, t);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, step, centerOn, hasMovie]);

  const cursorFrame =
    properties && properties.first_chunk != null && cursorT != null
      ? Math.round(properties.first_chunk * properties.chunksize + cursorT * properties.framerate)
      : null;

  const buttonStyle = {
    padding: '4px 10px',
    borderRadius: 4,
    border: `1px solid ${theme.border}`,
    background: theme.buttonBg,
    color: theme.text,
    cursor: 'pointer',
  };

  return (
    <div style={{ padding: '0 12px 12px' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '12px 0' }}>
        <button style={buttonStyle} onClick={() => step(-1)} title="Previous fly (↑)">◀</button>
        <label>
          Fly:&nbsp;
          <select value={fly || ''} onChange={(e) => setFly(e.target.value)} style={selectStyle}>
            {flies.map(({ fly: f, available }) => (
              <option key={f} value={f}>
                {f}{available ? '' : ' (no ethogram)'}
              </option>
            ))}
          </select>
        </label>
        <button style={buttonStyle} onClick={() => step(1)} title="Next fly (↓)">▶</button>

        {cursorFrame != null && (
          <>
            <span style={{ color: theme.subtext, marginLeft: 12 }}>
              t = {cursorT.toFixed(0)} s · frame {cursorFrame}
            </span>
            <button
              style={buttonStyle}
              onClick={() => onOpenInViewer(cursorFrame)}
              title="Show this frame in the Idtrackerai viewer tab"
            >
              Open frame in viewer
            </button>
          </>
        )}
        {loading && <span style={{ color: theme.subtext }}>Loading ethogram…</span>}
      </div>

      {!flies.length && <div style={{ color: theme.subtext }}>No experiment loaded.</div>}
      {error && <div style={{ color: '#d62728', padding: '4px 0' }}>{error}</div>}

      {hasMovie && (
        <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 8 }}>
          <video ref={videoRef} controls muted style={{ maxWidth: '100%', maxHeight: '45vh' }} />
        </div>
      )}

      <div ref={plotRef} style={{ width: '100%' }} />
    </div>
  );
}
