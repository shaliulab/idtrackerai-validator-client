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
import { useConsole } from './MessageConsole';

const API = '/api/ethogram';

// Axios can hand back a raw string when a payload contains NaN; parse defensively.
const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);

// Figures are 10-25 MB of JSON each: keep only the last few in memory.
const FIGURE_CACHE_SIZE = 6;

// seconds since ZT0 -> "hh:mm:ss" (hours keep counting past 24 on later days)
const formatZT = (zt) => {
  const s = Math.round(zt);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};

// Error payloads of blob requests arrive as a Blob, not as parsed JSON.
const errorMessage = async (err) => {
  let data = err.response?.data;
  if (data instanceof Blob) {
    try { data = JSON.parse(await data.text()); } catch { data = null; }
  }
  return data?.error || err.message;
};

export default function EthogramViewer({ flies, active, theme, selectStyle, onOpenInViewer }) {
  const [fly, setFly] = useState(null);
  const [properties, setProperties] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [cursorT, setCursorT] = useState(null);      // seconds since movie start
  const [gotoMode, setGotoMode] = useState('frame_number');   // 'frame_number' | 'zt'
  const [gotoValue, setGotoValue] = useState('');
  const [notice, setNotice] = useState(null);        // result of the last go-to / capture
  const [actionError, setActionError] = useState(null);
  const [capturing, setCapturing] = useState(false);
  const { log, trackJob } = useConsole();
  const [capturingAll, setCapturingAll] = useState(false);
  const [saveOnServer, setSaveOnServer] = useState(false);  // all-bouts export: save vs download

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
      // Update at most once per second of video, but keep the exact time: a
      // floored cursor would sit before a sleep bout we just jumped to.
      const second = Math.floor(video.currentTime);
      if (second === lastTimeUpdateRef.current) return;
      lastTimeUpdateRef.current = second;
      centerOn(video.currentTime);
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

  useEffect(() => { setNotice(null); setActionError(null); }, [fly]);

  // Errors show under the controls and in the console.
  const reportError = useCallback((message) => {
    setActionError(message);
    log('error', fly && !message.includes(fly) ? `${fly}: ${message}` : message);
  }, [fly, log]);

  // ── Go to a frame number (since chunk 0) or a ZT time (s since ZT0 of day 1) ──
  const goTo = useCallback(async () => {
    const value = Number(gotoValue);
    if (!fly || gotoValue.trim() === '' || !Number.isFinite(value)) {
      reportError('Enter a number');
      return;
    }
    setActionError(null);
    try {
      const { data } = await api.get(`${API}/${fly}/locate`, { params: { [gotoMode]: value } });
      const position = unwrap(data);
      centerOn(position.movie_time);
      if (videoRef.current && hasMovie) videoRef.current.currentTime = Math.max(0, position.movie_time);
      setNotice({ kind: 'goto', ...position });
      log('info', `${fly}: went to frame ${position.frame_number} · ZT ${position.zt.toFixed(1)} s (${formatZT(position.zt)})`);
    } catch (err) {
      reportError(await errorMessage(err));
    }
  }, [fly, gotoMode, gotoValue, centerOn, hasMovie, log, reportError]);

  // ── Jump to the start of the previous / next sleep bout (an ongoing one is skipped) ──
  const navigateSleepBout = useCallback(async (direction) => {
    if (!fly || cursorFrame == null) return;
    setActionError(null);
    try {
      const { data } = await api.get(`${API}/${fly}/sleep_bout/${direction}`, { params: { frame_number: cursorFrame } });
      const bout = unwrap(data);
      centerOn(bout.movie_time);
      if (videoRef.current && hasMovie) videoRef.current.currentTime = Math.max(0, bout.movie_time);
      setNotice({ kind: 'bout', ...bout, label: 'Sleep bout' });
      log('info', `${fly}: ${direction === 'next' ? 'next' : 'previous'} sleep bout, frames ${bout.start_frame}–${bout.end_frame} (${(bout.duration / 60).toFixed(1)} min)`);
    } catch (err) {
      reportError(await errorMessage(err));
    }
  }, [fly, cursorFrame, centerOn, hasMovie, log, reportError]);

  // ── Export the movie of the ongoing (or else next) sleep bout ──
  // Video exports run as backend jobs; the console shows their progress and
  // downloads the result (or reports where it was saved).
  const runVideoJob = useCallback(async (body, setBusy) => {
    setActionError(null);
    setBusy(true);
    try {
      const { data } = await api.post(`${API}/${fly}/sleep_bouts/videos`, { ...body, save: saveOnServer });
      const job = await trackJob(unwrap(data));
      if (job.status === 'failed') setActionError(job.error);
    } catch (err) {
      reportError(await errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [fly, saveOnServer, trackJob, reportError]);

  const captureSleepBout = useCallback(async () => {
    if (!fly || cursorFrame == null) return;
    try {
      const { data } = await api.get(`${API}/${fly}/sleep_bout`, { params: { frame_number: cursorFrame } });
      setNotice({ kind: 'bout', ...unwrap(data) });
    } catch (err) {
      reportError(await errorMessage(err));
      return;
    }
    await runVideoJob({ frame_number: cursorFrame }, setCapturing);
  }, [fly, cursorFrame, runVideoJob, reportError]);

  // ── One video per sleep bout of the fly ──
  const captureAllSleepBouts = useCallback(async () => {
    if (!fly) return;
    setNotice(null);
    await runVideoJob({}, setCapturingAll);
  }, [fly, runVideoJob]);

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

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', paddingBottom: 8 }}>
        <form
          style={{ display: 'flex', gap: 6, alignItems: 'center' }}
          onSubmit={(e) => { e.preventDefault(); goTo(); }}
        >
          Go to&nbsp;
          <select value={gotoMode} onChange={(e) => setGotoMode(e.target.value)} style={selectStyle}>
            <option value="frame_number">frame number (since chunk 0)</option>
            <option value="zt">ZT seconds (since ZT0 of day 1)</option>
          </select>
          <input
            value={gotoValue}
            onChange={(e) => setGotoValue(e.target.value)}
            placeholder={gotoMode === 'zt' ? 'e.g. 40000' : 'e.g. 3300000'}
            style={{ ...selectStyle, width: 110 }}
          />
          <button type="submit" style={buttonStyle} disabled={!fly}>Go</button>
        </form>

        <button
          style={buttonStyle}
          onClick={() => navigateSleepBout('prev')}
          disabled={cursorFrame == null}
          title="Start of the previous sleep bout (before the current one, if the fly is asleep)"
        >
          ← sleep bout
        </button>
        <button
          style={buttonStyle}
          onClick={() => navigateSleepBout('next')}
          disabled={cursorFrame == null}
          title="Start of the next sleep bout (after the current one, if the fly is asleep)"
        >
          sleep bout →
        </button>

        <button
          style={buttonStyle}
          onClick={captureSleepBout}
          disabled={!hasMovie || cursorFrame == null || capturing}
          title="Download the movie of the sleep bout at the cursor, or of the next one if the fly is awake"
        >
          {capturing ? 'Capturing…' : 'Capture sleep bout video'}
        </button>

        <button
          style={buttonStyle}
          onClick={captureAllSleepBouts}
          disabled={!hasMovie || capturingAll}
          title="One video per sleep bout of this fly"
        >
          {capturingAll ? 'Capturing all bouts…' : 'Capture all sleep bouts'}
        </button>
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
          title="Save sleep bout videos under <experiment>/flyhostel/videos/<fly>/ on the server instead of downloading them"
        >
          <input type="checkbox" checked={saveOnServer} onChange={(e) => setSaveOnServer(e.target.checked)} />
          save on server
        </label>

        {notice?.kind === 'goto' && (
          <span style={{ color: theme.subtext }}>
            frame {notice.frame_number} · ZT {notice.zt.toFixed(1)} s ({formatZT(notice.zt)})
            {notice.in_movie ? (
              <>
                {' · '}
                <a
                  href={apiUrl(`${API}/${fly}/movie_frame?frame_number=${notice.frame_number}`)}
                  target="_blank" rel="noreferrer" style={{ color: theme.text }}
                >
                  open still
                </a>
              </>
            ) : ' · not covered by the movie'}
          </span>
        )}
        {notice?.kind === 'bout' && (
          <span style={{ color: theme.subtext }}>
            {notice.label ?? `${notice.current ? 'Current' : 'Next'} sleep bout`}: frames {notice.start_frame}–{notice.end_frame}
            {' '}({(notice.duration / 60).toFixed(1)} min)
          </span>
        )}
      </div>

      {!flies.length && <div style={{ color: theme.subtext }}>No experiment loaded.</div>}
      {error && <div style={{ color: '#d62728', padding: '4px 0' }}>{error}</div>}
      {actionError && <div style={{ color: '#d62728', padding: '4px 0' }}>{actionError}</div>}

      {hasMovie && (
        <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 8 }}>
          <video ref={videoRef} controls muted style={{ maxWidth: '100%', maxHeight: '45vh' }} />
        </div>
      )}

      <div ref={plotRef} style={{ width: '100%' }} />
    </div>
  );
}
