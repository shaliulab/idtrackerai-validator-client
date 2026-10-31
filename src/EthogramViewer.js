// EthogramViewer.js  —  per-fly ethogram tab (merged from the behavior-viewer project)
//
// Shows the ethogram of one fly of the loaded experiment at a time (EthogramTrack,
// drawn from /api/ethogram/<fly>/track), with a dropdown + prev/next buttons to
// switch between flies of the group. When the fly has an HLS movie (shown above the
// ethogram), the video and the ethogram cursor are kept in sync: the x axis is
// seconds since the start of the movie. Arena flies with an activity ethogram (sleep_centroid.nf) show only
// active / inactive rows, and their sleep bouts are the centroid ones. The visible window is only ever moved, never reset: playback pages
// it along (with "follow"), jumps center it, and its width is kept per browser.
// Below the ethogram, the fly's deepethogram labels and the card writing them (DegLabels).

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Hls from 'hls.js/light';
import api, { apiUrl } from './api';
import { useConsole } from './MessageConsole';
import { FlyRow } from './blobs_table';
import { useStoredNumber } from './layout';
import EthogramTrack, { prepareTrack, clampView, formatClock, MIN_VIEW_WIDTH } from './EthogramTrack';
import DegLabels from './DegLabels';

const API = '/api/ethogram';

// Axios can hand back a raw string when a payload contains NaN; parse defensively.
const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);

// Tracks are ~0.5 MB each: keep the last few.
const TRACK_CACHE_SIZE = 12;

const ZOOMS = [
  { label: '1 min', width: 60 },
  { label: '5 min', width: 300 },
  { label: '15 min', width: 900 },
  { label: '1 h', width: 3600 },
  { label: '6 h', width: 6 * 3600 },
];
const DEFAULT_WIDTH = 300;

// frame number -> seconds since the start of the fly's movie (null if unknown)
const movieTimeOf = (props, frameNumber) =>
  props && props.first_chunk != null
    ? (frameNumber - props.first_chunk * props.chunksize) / props.framerate
    : null;

// seconds since ZT0 -> "hh:mm:ss" (hours keep counting past 24 on later days)
const formatZT = (zt) => formatClock(zt);

// Error payloads of blob requests arrive as a Blob, not as parsed JSON.
const errorMessage = async (err) => {
  let data = err.response?.data;
  if (data instanceof Blob) {
    try { data = JSON.parse(await data.text()); } catch { data = null; }
  }
  return data?.error || err.message;
};

const readFlag = (key, fallback) => {
  try { const v = localStorage.getItem(key); return v == null ? fallback : v === '1'; } catch { return fallback; }
};
const writeFlag = (key, value) => { try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* ignore */ } };

export default function EthogramViewer({ flies, request, animalMetadata, active, theme, themeName, selectStyle, onOpenInViewer, onOpenInPose }) {
  const [fly, setFly] = useState(null);
  const [properties, setProperties] = useState(null);
  const [track, setTrack] = useState(null);          // prepareTrack() of the shown fly
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [cursorT, setCursorT] = useState(null);      // seconds since movie start
  const [storedWidth, setStoredWidth] = useStoredNumber('fh-ethogram-window', DEFAULT_WIDTH);
  const [view, setViewState] = useState([0, storedWidth]);
  const [follow, setFollow] = useState(() => readFlag('fh-ethogram-follow', true));
  const [shade, setShade] = useState(() => readFlag('fh-ethogram-shade', false));
  const [minBout, setMinBout] = useState(1);
  const [gotoMode, setGotoMode] = useState('frame_number');   // 'frame_number' | 'zt'
  const [gotoValue, setGotoValue] = useState('');
  const [notice, setNotice] = useState(null);        // result of the last go-to / capture
  const [actionError, setActionError] = useState(null);
  const [capturing, setCapturing] = useState(false);
  const { log, trackJob } = useConsole();
  const [capturingAll, setCapturingAll] = useState(false);
  const [saveOnServer, setSaveOnServer] = useState(false);   // all-bouts export: save vs download
  const [savedVideos, setSavedVideos] = useState(null);   // { directory, videos: [{name, t0, t1, duration, movie_time}] }
  const [degLabels, setDegLabels] = useState(null);       // /deg_labels of the shown fly
  const [selection, setSelection] = useState(null);       // [start, end) s being labelled

  const videoRef = useRef(null);
  const trackCache = useRef(new Map());               // fly -> prepared track
  const viewRef = useRef(view);
  const cursorTRef = useRef(null);
  const followRef = useRef(follow);
  followRef.current = follow;
  const nRef = useRef(Infinity);                      // seconds in the shown track
  nRef.current = track ? track.n : Infinity;

  const setView = useCallback(([a, b]) => {
    const v = clampView(a, b, nRef.current);
    viewRef.current = v;
    setViewState(v);
  }, []);

  // Remember the window width (not on every wheel tick).
  useEffect(() => {
    const id = setTimeout(() => setStoredWidth(Math.round(view[1] - view[0])), 500);
    return () => clearTimeout(id);
  }, [view, setStoredWidth]);

  useEffect(() => writeFlag('fh-ethogram-follow', follow), [follow]);
  useEffect(() => writeFlag('fh-ethogram-shade', shade), [shade]);

  // Keep the selection within the current group of flies. A new experiment has
  // its own time axis: start it at the beginning, not at the old cursor.
  const experimentRef = useRef(null);
  useEffect(() => {
    const experiment = flies.length ? flies[0].fly.split('__')[0] : null;
    if (experiment !== experimentRef.current) {
      experimentRef.current = experiment;
      cursorTRef.current = null;
      setCursorT(null);
      setProperties(null);
    }
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

  // Move the cursor to t (s since movie start).
  //   center:    put t in the middle of the window (jumps)
  //   fromVideo: the movie is there already; the window follows only with "follow"
  // Otherwise the window moves only if t left it. Its width never changes.
  const seek = useCallback((t, { center = false, fromVideo = false } = {}) => {
    cursorTRef.current = t;
    setCursorT(t);
    if (!fromVideo && videoRef.current && videoRef.current.readyState > 0) {
      videoRef.current.currentTime = Math.max(0, t);
    }
    const [a, b] = viewRef.current;
    const w = b - a;
    if (center) {
      setView([t - w / 2, t + w / 2]);
    } else if (fromVideo) {
      // page ahead, leaving a bit of the past in sight
      if (followRef.current && (t < a || t > b - 0.05 * w)) setView([t - 0.1 * w, t + 0.9 * w]);
    } else if (t < a || t > b) {
      setView([t - w / 2, t + w / 2]);
    }
  }, [setView]);

  const zoomTo = useCallback((width) => {
    const [a, b] = viewRef.current;
    const t = cursorTRef.current;
    const anchor = t != null && t >= a && t <= b ? t : (a + b) / 2;
    // the anchor keeps its place on screen
    const f = (anchor - a) / (b - a);
    setView([anchor - f * width, anchor + (1 - f) * width]);
  }, [setView]);
  const zoomBy = useCallback((factor) => {
    const [a, b] = viewRef.current;
    zoomTo(Math.max(MIN_VIEW_WIDTH, (b - a) * factor));
  }, [zoomTo]);
  const showAll = useCallback(() => {
    if (track) setView([0, track.n]);
  }, [track, setView]);

  // ── Requests from elsewhere in the app (blobs table "etho" button):
  //    show fly `request.fly` at frame `request.frameNumber` ──
  const pendingSeekRef = useRef(null);       // { fly, frameNumber } applied once that fly is loaded
  useEffect(() => {
    if (!request) return;
    pendingSeekRef.current = request;
    if (request.fly !== fly) {
      setFly(request.fly);                   // the load effect below applies the seek
      return;
    }
    const t = loading ? null : movieTimeOf(properties, request.frameNumber);
    if (t == null) return;                   // still loading: applied by the load effect
    pendingSeekRef.current = null;
    seek(t, { center: true });
  // Only react to new requests, not to the state they read.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  // ── Load track + properties for the selected fly ──
  useEffect(() => {
    if (!active || !fly) return;
    let cancelled = false;
    const entry = flies.find((f) => f.fly === fly);

    const load = async () => {
      setError(null);
      setLoading(true);
      try {
        const { data: rawProps } = await api.get(`${API}/${fly}/properties`);
        if (cancelled) return;
        const props = unwrap(rawProps);
        setProperties(props);

        if (entry && !entry.available) {
          setTrack(null);
          throw new Error(`No ethogram has been generated for ${fly}`);
        }

        let data = trackCache.current.get(fly);
        if (!data) {
          const { data: raw } = await api.get(`${API}/${fly}/track`);
          data = prepareTrack(unwrap(raw));
          trackCache.current.set(fly, data);
          while (trackCache.current.size > TRACK_CACHE_SIZE) {
            trackCache.current.delete(trackCache.current.keys().next().value);
          }
        }
        if (cancelled) return;
        nRef.current = data.n;
        setTrack(data);

        // Flies of a group share the time axis: keep the same window when
        // switching between them, unless another tab asked for a frame.
        const pending = pendingSeekRef.current;
        let t = cursorTRef.current;
        let center = false;
        if (pending?.fly === fly) {
          const pt = movieTimeOf(props, pending.frameNumber);
          if (pt != null) { t = pt; center = true; }
          pendingSeekRef.current = null;
        }
        if (t == null) {
          t = 0;
          const w = viewRef.current[1] - viewRef.current[0];
          setView([0, w]);
        }
        seek(t, { center });
      } catch (err) {
        if (cancelled) return;
        console.error('Could not load ethogram', err);
        setTrack(null);
        setError(err.response?.data?.error || err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [fly, active, flies, seek, setView]);

  // ── HLS movie ──
  useEffect(() => {
    const video = videoRef.current;
    if (!active || !fly || !video || !hasMovie) return;
    const src = apiUrl(`${API}/${fly}/movie/movie.m3u8`);
    // Read the cursor when the stream is ready: the track may load after this runs.
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
      // our own seeks land here too: nothing to do then
      if (cursorTRef.current != null && Math.abs(video.currentTime - cursorTRef.current) < 0.05) return;
      seek(video.currentTime, { fromVideo: true });
    };
    video.addEventListener('timeupdate', onTime);
    return () => video.removeEventListener('timeupdate', onTime);
  }, [seek, hasMovie]);

  // Pause the movie when leaving the tab.
  useEffect(() => {
    if (!active) videoRef.current?.pause();
  }, [active]);

  // ── Keyboard: ←/→ move the cursor (Shift ×10, Ctrl ×60, Ctrl+Alt ×600 s), ↑/↓ switch fly,
  //    +/- zoom, Space play/pause ──
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
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(0.5); return; }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(2); return; }
      if (e.key === ' ' && tag !== 'BUTTON' && tag !== 'VIDEO' && videoRef.current && hasMovie) {
        e.preventDefault();
        const video = videoRef.current;
        if (video.paused) video.play(); else video.pause();
        return;
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (cursorTRef.current == null) return;
      e.preventDefault();
      const amount = (e.ctrlKey ? 60 : e.shiftKey ? 10 : 1) * (e.ctrlKey && e.altKey ? 10 : 1);
      seek(cursorTRef.current + (e.key === 'ArrowLeft' ? -amount : amount));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, step, seek, zoomBy, hasMovie]);

  const frameOf = useCallback(
    (t) => (properties && properties.first_chunk != null && t != null
      ? Math.round(properties.first_chunk * properties.chunksize + t * properties.framerate)
      : null),
    [properties],
  );
  const cursorFrame = frameOf(cursorT);

  useEffect(() => { setNotice(null); setActionError(null); setSelection(null); }, [fly]);

  // ── DEG labels of the fly ──
  useEffect(() => {
    if (!active || !fly) return undefined;
    let cancelled = false;
    setDegLabels(null);
    api.get(`${API}/${fly}/deg_labels`)
      .then(({ data }) => { if (!cancelled) setDegLabels(unwrap(data)); })
      .catch(async (err) => { if (!cancelled) log('warning', `${fly}: no DEG labels (${await errorMessage(err)})`); });
    return () => { cancelled = true; };
  }, [fly, active, log]);

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
      if (position.movie_time == null) throw new Error(`Frame ${position.frame_number} cannot be placed in ${fly}'s ethogram (no feather file)`);
      seek(position.movie_time, { center: true });
      setNotice({ kind: 'goto', ...position });
      log('info', `${fly}: went to frame ${position.frame_number} · ZT ${position.zt.toFixed(1)} s (${formatZT(position.zt)})`);
    } catch (err) {
      reportError(await errorMessage(err));
    }
  }, [fly, gotoMode, gotoValue, seek, log, reportError]);

  // ── Sleep bout videos saved on the server (<basedir>/flyhostel/videos/<fly>/) ──
  const fetchSavedVideos = useCallback(async () => {
    if (!fly) { setSavedVideos(null); return; }
    try {
      const { data } = await api.get(`${API}/${fly}/saved_videos`);
      setSavedVideos(unwrap(data));
    } catch (err) {
      setSavedVideos(null);
      log('warning', `${fly}: could not list saved videos (${await errorMessage(err)})`);
    }
  }, [fly, log]);

  useEffect(() => {
    if (active) fetchSavedVideos();
  }, [active, fetchSavedVideos]);

  const jumpToSavedVideo = useCallback((video) => {
    if (video.movie_time == null) return;
    seek(video.movie_time, { center: true });
  }, [seek]);

  // ── Jump to the start of the previous / next sleep bout (an ongoing one is skipped) ──
  const navigateSleepBout = useCallback(async (direction) => {
    if (!fly || cursorFrame == null) return;
    setActionError(null);
    try {
      const { data } = await api.get(`${API}/${fly}/sleep_bout/${direction}`, { params: { frame_number: cursorFrame } });
      const bout = unwrap(data);
      seek(bout.movie_time, { center: true });
      setNotice({ kind: 'bout', ...bout, label: 'Sleep bout' });
      log('info', `${fly}: ${direction === 'next' ? 'next' : 'previous'} sleep bout, frames ${bout.start_frame}–${bout.end_frame} (${(bout.duration / 60).toFixed(1)} min)`);
    } catch (err) {
      reportError(await errorMessage(err));
    }
  }, [fly, cursorFrame, seek, log, reportError]);

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
      if (job.directory) fetchSavedVideos();      // new videos were saved on the server
    } catch (err) {
      reportError(await errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [fly, saveOnServer, trackJob, reportError, fetchSavedVideos]);

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

  const viewWidth = view[1] - view[0];
  const cursorZT = track?.zt0 != null && cursorT != null ? track.zt0 + cursorT : null;

  return (
    <div style={{ padding: '0 12px 12px' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '12px 0' }}>
        <button style={buttonStyle} onClick={() => step(-1)} title="Previous fly (↑)">◀</button>
        <label>
          Fly:&nbsp;
          <select value={fly || ''} onChange={(e) => setFly(e.target.value)} style={selectStyle}>
            {flies.map(({ fly: f, available, activity }) => (
              <option key={f} value={f}>
                {f}{!available ? ' (no ethogram)' : activity ? ' (activity)' : ''}
              </option>
            ))}
          </select>
        </label>
        <button style={buttonStyle} onClick={() => step(1)} title="Next fly (↓)">▶</button>

        {cursorFrame != null && (
          <>
            <span style={{ color: theme.subtext, marginLeft: 12, fontVariantNumeric: 'tabular-nums' }}>
              {cursorZT != null && <>ZT {formatZT(cursorZT)} · </>}
              t = {cursorT.toFixed(0)} s · frame {cursorFrame}
            </span>
            <button
              style={buttonStyle}
              onClick={() => onOpenInViewer(cursorFrame)}
              title="Show this frame in the Idtrackerai viewer tab"
            >
              Open frame in viewer
            </button>
            <button
              style={buttonStyle}
              onClick={() => onOpenInPose(fly, cursorFrame)}
              title="Show this fly's pose at this frame in the Pose tab"
            >
              Open frame in Pose
            </button>
          </>
        )}
        {loading && <span style={{ color: theme.subtext }}>Loading ethogram…</span>}
      </div>

      {/* the inspected fly's row of the viewer's table, at the cursor */}
      <FlyRow fly={fly} frameNumber={cursorFrame} animalMetadata={animalMetadata} theme={theme} />

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

      {savedVideos?.videos.length > 0 && (
        <div style={{ paddingBottom: 8 }}>
          <div style={{ color: theme.subtext, paddingBottom: 4 }} title={savedVideos.directory}>
            Saved sleep bout videos ({savedVideos.videos.length}) — click to jump to the bout:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 76, overflowY: 'auto' }}>
            {savedVideos.videos.map((video) => {
              // 1 s tolerance: t0 is rounded to seconds and the movie seeks to the nearest frame
              const current = cursorT != null && video.movie_time != null
                && cursorT >= video.movie_time - 1 && cursorT < video.movie_time + video.duration;
              return (
                <button
                  key={video.name}
                  onClick={() => jumpToSavedVideo(video)}
                  disabled={video.movie_time == null}
                  title={video.name}
                  style={{
                    ...buttonStyle,
                    padding: '2px 8px',
                    fontSize: '0.85em',
                    fontFamily: 'monospace',
                    ...(current ? { background: '#1f77b4', color: '#fff', borderColor: '#1f77b4' } : {}),
                  }}
                >
                  ZT {formatZT(video.t0)} · {(video.duration / 60).toFixed(1)} min
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!flies.length && <div style={{ color: theme.subtext }}>No experiment loaded.</div>}
      {error && <div style={{ color: '#d62728', padding: '4px 0' }}>{error}</div>}
      {actionError && <div style={{ color: '#d62728', padding: '4px 0' }}>{actionError}</div>}

      {hasMovie && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
          <video ref={videoRef} controls muted style={{ maxWidth: '100%', maxHeight: '45vh' }} />
        </div>
      )}

      {track && (
        <div className="card eth-card">
          <div className="card-header eth-toolbar">
            <span className="eth-zooms" role="group" aria-label="Window width">
              {ZOOMS.map((z) => (
                <button
                  key={z.label}
                  className={Math.abs(viewWidth - z.width) < 1 ? 'active' : ''}
                  onClick={() => zoomTo(z.width)}
                  title={`Show ${z.label} around the cursor`}
                >
                  {z.label}
                </button>
              ))}
              <button className={viewWidth >= track.n ? 'active' : ''} onClick={showAll} title="Show the whole recording">All</button>
            </span>
            <button onClick={() => zoomBy(2)} title="Zoom out (−)" aria-label="Zoom out">−</button>
            <button onClick={() => zoomBy(0.5)} title="Zoom in (+)" aria-label="Zoom in">+</button>
            <span className="eth-dim">window {formatClock(viewWidth)}</span>
            {track.kind === 'activity' && (
              <span
                className="eth-dim"
                title={`${track.source}: a second is inactive when the centroid moved at most min_displacement_mm (1 mm by default) since the previous one (sleep_centroid.nf); sleep bouts are 5 min of inactivity`}
              >
                activity from the centroid
              </span>
            )}
            <span className="spacer" />
            <label className="field check" title="While the movie plays, move the window along with the cursor">
              <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
              follow playback
            </label>
            {track.kind !== 'activity' && (
              <label className="field check" title="Fade seconds the classifier was less sure about">
                <input type="checkbox" checked={shade} onChange={(e) => setShade(e.target.checked)} />
                shade by score
              </label>
            )}
            <label className="field" title="◀ ▶ next to each behavior skip bouts shorter than this">
              ◀ ▶ skip bouts under
              <input
                type="number" min={1} step={1} value={minBout}
                onChange={(e) => setMinBout(Math.max(1, Number(e.target.value) || 1))}
              />
              s
            </label>
          </div>
          <div className="card-body">
            <EthogramTrack
              data={track}
              view={view}
              onView={setView}
              cursorT={cursorT}
              onSeek={seek}
              frameOf={frameOf}
              chunksize={properties?.chunksize}
              shade={shade}
              minBout={minBout}
              themeName={themeName}
              labelRuns={degLabels?.runs}
              labelClasses={degLabels?.classes}
              labelVideos={degLabels?.videos}
              selection={selection}
              onSelect={setSelection}
            />
            <div className="eth-keys">
              Wheel: zoom · Shift+wheel or drag: pan · click: move the cursor · double click: zoom in ·
              drag on <i>Whole recording</i>: move the window · ◀ ▶ per behavior: previous / next bout ·
              <b> ←/→</b> cursor · <b>+/−</b> zoom · <b>Space</b> play/pause · <b>↑/↓</b> fly
            </div>
          </div>
        </div>
      )}

      {track && (
        <DegLabels
          fly={fly}
          labels={degLabels}
          onLabels={setDegLabels}
          selection={selection}
          onSelect={setSelection}
          cursorT={cursorT}
          track={track}
          seek={seek}
          active={active}
        />
      )}

    </div>
  );
}
