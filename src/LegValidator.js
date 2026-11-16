// LegValidator.js  —  Leg movements tab: validation of the middle-leg movement detector.
//
// The detector (leg_movements.py of the FlyHostel analysis repository) finds repeated movements of a middle leg while the thorax
// stays in place, from the raw pose. This tab plays each event in the fly's HLS movie (the Ethograms tab's movie, so any fly can be
// shown without loading its experiment), draws what the detector saw (distance of every leg tip from its resting position, strokes,
// thorax speed) and saves a verdict per event (/api/legs/*, leg_validation.py). The queue is one fly's events or a random sample of
// every fly's (same size and seed = same queue, so a review can be continued later). The selections "counted movements" sample the
// events the classifier counts as real movements (leg_movements_per_fly.py, model/movements.csv), all, near another fly or away from
// others; for those a review also says whether the moving leg touches the other fly (keys t / o / x).
//
// Colours: Okabe-Ito, and every leg also has its own line type (left middle solid, right middle dashed, front dotted, hind dash-dot).

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Hls from 'hls.js/light';
import api, { apiUrl } from './api';
import { useFillHeight, useElementSize } from './layout';

const API = '/api/legs';
const GAP = 12;

const VERDICTS = [
  { id: 'middle', label: 'middle legs', title: 'a middle leg moves repeatedly, the other legs stay still', color: '#009E73' },
  { id: 'groom', label: 'grooming', title: 'the middle legs move as part of grooming, with the front or hind legs', color: '#CC79A7' },
  { id: 'walk', label: 'walk / turn', title: 'the fly walks or turns: not in place', color: '#56B4E9' },
  { id: 'posture', label: 'one shift', title: 'a single posture adjustment, not repeated', color: '#E69F00' },
  { id: 'pose_error', label: 'pose error', title: 'no leg movement: the keypoints jump', color: '#D55E00' },
  { id: 'other', label: 'other', title: 'something else (write it in the notes)', color: '#999999' },
  { id: 'unsure', label: 'unsure', title: 'cannot tell', color: '#F0E442' },
];
const WHICH = [
  { id: 'left', key: 'l' },
  { id: 'right', key: 'r' },
  { id: 'both', key: 'b' },
];
// does the moving leg touch the other fly? (keys t / o / x)
const TOUCHES = [
  { id: 'yes', key: 't', label: 'touches it', title: 'the moving leg touches the other fly', color: '#E69F00' },
  { id: 'no', key: 'o', label: 'does not touch', title: 'another fly is in the clip, the moving leg does not touch it', color: '#56B4E9' },
  { id: 'no_partner', key: 'x', label: 'no other fly', title: 'no other fly in the clip', color: '#BBBBBB' },
];
const SELECTIONS = [
  { id: 'all', label: 'all events' },
  { id: 'immobile', label: 'while immobile' },
  { id: 'alone', label: 'middle legs alone' },
  { id: 'alone_immobile', label: 'middle legs alone, while immobile' },
  { id: 'clean', label: 'clean pose' },
  { id: 'clean_alone_immobile', label: 'clean pose, middle legs alone, while immobile' },
  { id: 'model', label: 'model: review queue of the classifier (leg_movements_model.py: uncertain or contact events)' },
  { id: 'movements', label: 'counted movements (classifier), all' },
  { id: 'movements_near', label: 'counted movements, near another fly' },
  { id: 'movements_away', label: 'counted movements, away from other flies' },
];
// leg -> colour and dash (Okabe-Ito + line types)
const LEG_STYLE = {
  mL: { color: '#0072B2', dash: null, width: 2, label: 'middle left' },
  mR: { color: '#D55E00', dash: '7 4', width: 2, label: 'middle right' },
  fL: { color: '#009E73', dash: '2 3', width: 1, label: 'front' },
  fR: { color: '#009E73', dash: '2 3', width: 1, label: null },
  rL: { color: '#CC79A7', dash: '8 3 2 3', width: 1, label: 'hind' },
  rR: { color: '#CC79A7', dash: '8 3 2 3', width: 1, label: null },
};
const AMPLITUDE = 0.08;   // stroke threshold of the detector (body lengths)
const STILL_BL_S = 0.3;   // thorax speed above which strokes do not count (body lengths / s)
const LEG_NAME = { mL: 'left', mR: 'right', both: 'both' };

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);
const keyOf = (e) => `${e.fly}|${e.start}|${e.end}`;
const formatZT = (zt) => {
  const s = Math.round(zt);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};
const stored = (key, initial) => {
  try { const v = localStorage.getItem(key); return v == null ? initial : JSON.parse(v); } catch { return initial; }
};
const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } };
const typing = (e) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName) || e.target?.isContentEditable;


// ── What the detector saw: leg tips' distance from rest, strokes, thorax speed ──
function LegTrace({ trace, event, playT, onSeek, showOthers }) {
  const [el, setEl] = useState(null);
  const { width, height } = useElementSize(el);
  if (!trace) return <div ref={setEl} className="leg-trace leg-empty">no trace</div>;
  const W = Math.max(200, width), H = Math.max(160, height);
  const m = { l: 44, r: 10, t: 22, b: 22 };
  const speedH = Math.round((H - m.t - m.b) * 0.18);
  const strokeH = 22;
  const mainH = H - m.t - m.b - speedH - strokeH - 16;
  const t0 = trace.t[0], t1 = trace.t[trace.t.length - 1];
  const legs = showOthers ? ['fL', 'fR', 'rL', 'rR', 'mL', 'mR'] : ['mL', 'mR'];
  const ymax = Math.max(0.2, ...legs.flatMap((leg) => trace[leg].filter((v) => v != null))) * 1.05;
  const smax = Math.max(STILL_BL_S * 2, ...trace.speed) * 1.05;
  const x = (t) => m.l + ((t - t0) / (t1 - t0 || 1)) * (W - m.l - m.r);
  const y = (v) => m.t + mainH - (v / ymax) * mainH;
  const sTop = m.t + mainH + 8 + strokeH + 8;
  const ys = (v) => sTop + speedH - (Math.min(v, smax) / smax) * speedH;
  const path = (values, yf) => {
    let d = '', pen = false;
    values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(trace.t[i]).toFixed(1)},${yf(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const runs = (flags) => {
    const out = []; let a = null;
    flags.forEach((f, i) => {
      if (f && a == null) a = i;
      if ((!f || i === flags.length - 1) && a != null) { out.push([trace.t[a], trace.t[f ? i : i - 1]]); a = null; }
    });
    return out;
  };
  const ticks = [];
  for (let s = Math.ceil(t0 - event.start); s <= t1 - event.start; s += 1) ticks.push(s);
  const yticks = [0, AMPLITUDE, ...[0.2, 0.4, 0.6, 0.8, 1.0].filter((v) => v < ymax)];
  const seek = (ev) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const t = t0 + ((ev.clientX - r.left - m.l) / (W - m.l - m.r)) * (t1 - t0);
    if (t >= t0 && t <= t1) onSeek(t);
  };
  return (
    <div ref={setEl} className="leg-trace">
      <svg width={W} height={H} onClick={seek} style={{ cursor: 'pointer', display: 'block' }}>
        <rect x={x(event.start)} y={m.t} width={Math.max(1, x(event.end) - x(event.start))} height={H - m.t - m.b}
              fill="var(--accent-soft)" opacity={0.6} />
        {yticks.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke="var(--border)"
                  strokeDasharray={v === AMPLITUDE ? '4 3' : null} />
            <text x={m.l - 4} y={y(v) + 3} fontSize={10} textAnchor="end" fill="var(--subtext)">{v.toFixed(2)}</text>
          </g>
        ))}
        <text x={W - m.r} y={y(AMPLITUDE) - 3} fontSize={10} textAnchor="end" fill="var(--subtext)">stroke threshold</text>
        <text x={4} y={12} fontSize={10} fill="var(--subtext)">leg tip from its resting position (body lengths)</text>
        {legs.map((leg) => (
          <path key={leg} d={path(trace[leg], y)} fill="none" stroke={LEG_STYLE[leg].color}
                strokeWidth={LEG_STYLE[leg].width} strokeDasharray={LEG_STYLE[leg].dash} />
        ))}
        {/* strokes of the middle legs: left row, right row */}
        {['mL', 'mR'].map((leg, k) => {
          const top = m.t + mainH + 8 + k * (strokeH / 2);
          return (
            <g key={leg}>
              <text x={m.l - 4} y={top + 8} fontSize={9} textAnchor="end" fill="var(--subtext)">{leg}</text>
              {runs(trace[`stroke_${leg}`]).map(([a, b]) => (
                <rect key={a} x={x(a)} y={top + 1} width={Math.max(2, x(b) - x(a))} height={strokeH / 2 - 2}
                      fill={LEG_STYLE[leg].color} stroke={leg === 'mR' ? 'var(--text)' : 'none'} strokeWidth={0.6}
                      strokeDasharray={leg === 'mR' ? '2 1' : null} />
              ))}
            </g>
          );
        })}
        <line x1={m.l} x2={W - m.r} y1={ys(STILL_BL_S)} y2={ys(STILL_BL_S)} stroke="var(--border-strong)" strokeDasharray="4 3" />
        <path d={path(trace.speed, ys)} fill="none" stroke="var(--text)" strokeWidth={1} />
        <text x={m.l - 4} y={sTop + 8} fontSize={9} textAnchor="end" fill="var(--subtext)">speed</text>
        <line x1={m.l} x2={W - m.r} y1={sTop + speedH} y2={sTop + speedH} stroke="var(--border-strong)" />
        {ticks.map((s) => (
          <text key={s} x={x(event.start + s)} y={H - 6} fontSize={10} textAnchor="middle" fill="var(--subtext)">
            {s > 0 ? `+${s}` : s}
          </text>
        ))}
        <text x={W - m.r} y={H - 6} fontSize={10} textAnchor="end" fill="var(--subtext)">s from the start</text>
        {playT != null && playT >= t0 && playT <= t1 && (
          <line x1={x(playT)} x2={x(playT)} y1={m.t - 6} y2={H - m.b} stroke="var(--text)" strokeWidth={1.5} />
        )}
      </svg>
    </div>
  );
}

function Legend({ showOthers }) {
  const legs = showOthers ? ['mL', 'mR', 'fL', 'rL'] : ['mL', 'mR'];
  return (
    <span className="leg-legend">
      {legs.map((leg) => (
        <span key={leg}>
          <svg width={28} height={10}><line x1={1} x2={27} y1={5} y2={5} stroke={LEG_STYLE[leg].color}
            strokeWidth={LEG_STYLE[leg].width + 0.5} strokeDasharray={LEG_STYLE[leg].dash} /></svg>
          {LEG_STYLE[leg].label}
        </span>
      ))}
      <span><svg width={18} height={10}><rect x={1} y={1} width={16} height={8} fill="var(--accent-soft)" /></svg>event</span>
    </span>
  );
}


export default function LegValidator({ active }) {
  const [flies, setFlies] = useState([]);
  const [info, setInfo] = useState(null);
  const [source, setSource] = useState(() => stored('fh-legs-source', 'sample'));    // 'sample' or a fly id
  const [which, setWhich] = useState(() => stored('fh-legs-which', 'alone_immobile'));
  const [sampleN, setSampleN] = useState(() => stored('fh-legs-sample', 100));
  const [seed, setSeed] = useState(() => stored('fh-legs-seed', 2026));
  const [speed, setSpeed] = useState(() => stored('fh-legs-speed', 0.5));
  const [pad, setPad] = useState(() => stored('fh-legs-pad', 2));
  const [loop, setLoop] = useState(() => stored('fh-legs-loop', true));
  const [advance, setAdvance] = useState(() => stored('fh-legs-advance', true));
  const [blind, setBlind] = useState(() => stored('fh-legs-blind', false));
  const [showOthers, setShowOthers] = useState(() => stored('fh-legs-others', true));
  useEffect(() => store('fh-legs-source', source), [source]);
  useEffect(() => store('fh-legs-which', which), [which]);
  useEffect(() => store('fh-legs-sample', sampleN), [sampleN]);
  useEffect(() => store('fh-legs-seed', seed), [seed]);
  useEffect(() => store('fh-legs-speed', speed), [speed]);
  useEffect(() => store('fh-legs-pad', pad), [pad]);
  useEffect(() => store('fh-legs-loop', loop), [loop]);
  useEffect(() => store('fh-legs-advance', advance), [advance]);
  useEffect(() => store('fh-legs-blind', blind), [blind]);
  useEffect(() => store('fh-legs-others', showOthers), [showOthers]);

  const [events, setEvents] = useState([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mediaError, setMediaError] = useState(null);
  const [trace, setTrace] = useState(null);
  const [playT, setPlayT] = useState(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [aspect, setAspect] = useState(16 / 9);     // of the movie (width / height), once loaded

  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const hlsFlyRef = useRef(null);
  const windowRef = useRef(null);          // {fly, m0, start, from, to} movie seconds of the loop
  const tableRef = useRef(null);

  const event = events[idx] || null;
  const nReviewed = useMemo(() => events.filter((e) => e.verdict).length, [events]);

  // ── flies with detector output ──
  const loadFlies = useCallback(async () => {
    try {
      const { data } = await api.get(`${API}/flies`);
      const d = unwrap(data);
      setFlies(d.flies); setInfo(d);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }, []);
  useEffect(() => { if (active && !info) loadFlies(); }, [active, info, loadFlies]);

  // ── the queue ──
  const loadEvents = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = source === 'sample' ? { sample: sampleN, seed, which } : { fly: source, which };
      const { data } = await api.get(`${API}/events`, { params });
      const rows = unwrap(data);
      setEvents(rows);
      // continue where the review stopped: the first event without a verdict
      setIdx(Math.max(0, rows.findIndex((r) => !r.verdict)));
    } catch (e) {
      setEvents([]); setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [source, sampleN, seed, which]);
  useEffect(() => { if (active) loadEvents(); }, [active, loadEvents]);

  // ── trace of the event ──
  useEffect(() => {
    setTrace(null);
    if (!event) return undefined;
    let cancelled = false;
    api.get(`${API}/trace`, { params: { fly: event.fly, event: event.event } })
      .then(({ data }) => { if (!cancelled) setTrace(unwrap(data)); })
      .catch(() => { if (!cancelled) setTrace(null); });
    return () => { cancelled = true; };
  }, [event?.fly, event?.event]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setNotesDraft(event?.notes || ''); }, [event?.fly, event?.start]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── movie: the fly's HLS stream, seeked to the event ──
  const startLoop = useCallback(() => {
    const video = videoRef.current, w = windowRef.current;
    if (!video || !w) return;
    video.currentTime = Math.max(0, w.from);
    video.playbackRate = speed;
    video.play().catch(() => { /* autoplay refused: the user presses play */ });
  }, [speed]);

  useEffect(() => {
    const video = videoRef.current;
    setMediaError(null);
    if (!active || !event || !video) return undefined;
    if (!event.has_movie) { setMediaError(`${event.fly} has no movie (motionmapper/<NN>/movie)`); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/api/ethogram/${event.fly}/locate`, { params: { zt: event.start } });
        if (cancelled) return;
        const m0 = unwrap(data).movie_time;
        if (m0 == null) { setMediaError('cannot place the event in the movie'); return; }
        windowRef.current = { fly: event.fly, m0, start: event.start, from: m0 - pad, to: m0 + (event.end - event.start) + pad };
        if (hlsFlyRef.current === event.fly && (hlsRef.current || video.src)) { startLoop(); return; }
        if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
        const src = apiUrl(`/api/ethogram/${event.fly}/movie/movie.m3u8`);
        hlsFlyRef.current = event.fly;
        if (Hls.isSupported()) {
          const hls = new Hls({ startPosition: Math.max(0, m0 - pad) });
          hlsRef.current = hls;
          hls.loadSource(src);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => startLoop());
          hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) setMediaError(`movie: ${d.details}`); });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = src;
          video.addEventListener('loadedmetadata', startLoop, { once: true });
        }
      } catch (e) {
        if (!cancelled) setMediaError(e.response?.data?.error || e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [active, event?.fly, event?.start, pad]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (hlsRef.current) hlsRef.current.destroy(); }, []);
  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = speed; }, [speed]);
  useEffect(() => { if (!active) videoRef.current?.pause(); }, [active]);

  // playhead and loop, every animation frame while the tab is shown
  useEffect(() => {
    if (!active) return undefined;
    let raf;
    const tick = () => {
      const video = videoRef.current, w = windowRef.current;
      if (video && w && w.fly === event?.fly) {
        const t = video.currentTime;
        if (!video.paused && t > w.to) {
          if (loop) video.currentTime = Math.max(0, w.from); else video.pause();
        }
        setPlayT(w.start + (t - w.m0));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, loop, event?.fly]);

  const seekTrace = useCallback((t) => {
    const video = videoRef.current, w = windowRef.current;
    if (video && w) video.currentTime = Math.max(0, w.m0 + (t - w.start));
  }, []);

  // ── saving ──
  const save = useCallback(async (e, changes) => {
    const next = { ...e, ...changes };
    setEvents((list) => list.map((x) => (keyOf(x) === keyOf(e) ? next : x)));
    try {
      await api.post(`${API}/annotate`, {
        fly: e.fly, event: e.event, start: e.start, end: e.end, leg: e.leg,
        verdict: next.verdict, which_leg: next.which_leg, touches: next.touches, notes: next.notes,
      });
      if (Boolean(next.verdict) !== Boolean(e.verdict)) loadFlies();   // reviewed counts of the fly list
    } catch (err) {
      setEvents((list) => list.map((x) => (keyOf(x) === keyOf(e) ? e : x)));
      setError(`not saved: ${err.response?.data?.error || err.message}`);
    }
  }, [loadFlies]);

  const go = useCallback((i) => setIdx(Math.max(0, Math.min(events.length - 1, i))), [events.length]);
  const nextUnreviewed = useCallback((dir = 1) => {
    for (let k = 1; k <= events.length; k++) {
      const i = (idx + dir * k + events.length) % events.length;
      if (!events[i].verdict) { setIdx(i); return; }
    }
  }, [events, idx]);

  const setVerdict = useCallback((verdict) => {
    if (!event) return;
    const same = event.verdict === verdict;
    save(event, { verdict: same ? null : verdict });
    if (!same && advance && idx < events.length - 1) setTimeout(() => setIdx((i) => Math.min(events.length - 1, i + 1)), 150);
  }, [event, save, advance, idx, events.length]);
  const setWhichLeg = useCallback((leg) => {
    if (event) save(event, { which_leg: event.which_leg === leg ? null : leg });
  }, [event, save]);
  const setTouches = useCallback((t) => {
    if (event) save(event, { touches: event.touches === t ? null : t });
  }, [event, save]);

  // ── keyboard ──
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= VERDICTS.length) { e.preventDefault(); setVerdict(VERDICTS[n - 1].id); return; }
      const w = WHICH.find((x) => x.key === e.key.toLowerCase());
      if (w) { e.preventDefault(); setWhichLeg(w.id); return; }
      const tc = TOUCHES.find((x) => x.key === e.key.toLowerCase());
      if (tc) { e.preventDefault(); setTouches(tc.id); return; }
      if (e.key === '0' || e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault(); if (event) save(event, { verdict: null, which_leg: null, touches: null, notes: '' }); return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); go(idx + 1); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); go(idx - 1); return; }
      if (e.key === 'n') { e.preventDefault(); nextUnreviewed(1); return; }
      if (e.key === 'N') { e.preventDefault(); nextUnreviewed(-1); return; }
      if (e.key === 'Enter') { e.preventDefault(); startLoop(); return; }
      if (e.key === ' ') {
        e.preventDefault();
        const v = videoRef.current;
        if (v) { if (v.paused) v.play().catch(() => {}); else v.pause(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, event, idx, go, nextUnreviewed, setVerdict, setWhichLeg, setTouches, save, startLoop]);

  // keep the selected row in view
  useEffect(() => {
    tableRef.current?.querySelector('tr.selected')?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  // ── layout ──
  const [layoutEl, setLayoutEl] = useState(null);
  const layoutH = useFillHeight(layoutEl, [active]);
  const mediaH = layoutH ? Math.max(240, Math.min(440, Math.round(layoutH * 0.45))) : 360;
  const videoW = Math.round((mediaH - 16) * aspect);

  const flyLabel = (f) => `${f.fly} · ${f.events} events (${f.immobile} immobile) · ${f.reviewed} reviewed${f.has_movie ? '' : ' · no movie'}`;
  const verdictButton = (v, i, e, small) => {
    const on = e.verdict === v.id;
    return (
      <button key={v.id} title={`${v.title} (${i + 1})`}
              onClick={(ev) => { ev.stopPropagation(); if (e === event) setVerdict(v.id); else save(e, { verdict: on ? null : v.id }); }}
              className="leg-verdict"
              style={{
                padding: small ? '1px 5px' : '3px 8px',
                background: on ? v.color : 'var(--btn-bg)',
                color: on ? '#000' : 'var(--text)',
                border: on ? '2px solid var(--text)' : '1px solid var(--border-strong)',
                fontWeight: on ? 'bold' : 'normal',
              }}>
        {small ? '' : <span className="leg-key">{i + 1}</span>}{v.label}
      </button>
    );
  };

  return (
    <div className="leg-layout" ref={setLayoutEl} style={{ height: layoutH ?? undefined }}>
      {/* ── Queue and playback ── */}
      <section className="card">
        <div className="card-header">
          Leg movements
          <span className="spacer" />
          <div className="readout" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
            <span><b>{events.length ? idx + 1 : 0}</b> / {events.length}</span>
            <span>reviewed <b>{nReviewed}</b> / {events.length}</span>
          </div>
        </div>
        <div className="card-body pe-controls">
          <div className="toolbar">
            <span className="pe-group">
              Events of
              <select value={source} onChange={(e) => setSource(e.target.value)} style={{ maxWidth: 520 }}>
                <option value="sample">a random sample of every fly</option>
                {flies.map((f) => <option key={f.fly} value={f.fly}>{flyLabel(f)}</option>)}
              </select>
            </span>
            {source === 'sample' && (
              <span className="pe-group">
                size <input type="number" min={1} value={sampleN} style={{ width: 70 }}
                            onChange={(e) => setSampleN(Math.max(1, Number(e.target.value) || 1))} />
                seed <input type="number" value={seed} style={{ width: 70 }} onChange={(e) => setSeed(Number(e.target.value) || 0)} />
              </span>
            )}
            <span className="pe-group">
              <select value={which} onChange={(e) => setWhich(e.target.value)}>
                {SELECTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </span>
            <span className="pe-group">
              <button disabled={idx === 0} onClick={() => go(idx - 1)}>← prev</button>
              <button disabled={idx >= events.length - 1} onClick={() => go(idx + 1)}>next →</button>
              <button onClick={() => nextUnreviewed(1)} title="next event without a verdict (n)">next unreviewed ⏭</button>
            </span>
          </div>
          <div className="toolbar">
            <span className="pe-group">
              speed
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                {[0.1, 0.25, 0.5, 1].map((s) => <option key={s} value={s}>{s}×</option>)}
              </select>
              ± <input type="number" min={0} max={3} step={0.5} value={pad} style={{ width: 50 }}
                       onChange={(e) => setPad(Math.max(0, Math.min(3, Number(e.target.value) || 0)))} /> s
              <label><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> loop</label>
              <button onClick={startLoop} title="play the event again (Enter)">↻ replay</button>
            </span>
            <span className="pe-group">
              <label title="go to the next event after a verdict">
                <input type="checkbox" checked={advance} onChange={(e) => setAdvance(e.target.checked)} /> next after verdict
              </label>
              <label title="draw the front and hind legs too">
                <input type="checkbox" checked={showOthers} onChange={(e) => setShowOthers(e.target.checked)} /> other legs
              </label>
              <label title="hide what the detector found (trace, leg, strokes) to judge from the movie only">
                <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} /> hide detector's call
              </label>
            </span>
            <span className="spacer" style={{ flex: 1 }} />
            <a href={apiUrl(`${API}/export`)} className="leg-export" title={info ? `reviews in ${info.database}` : undefined}>⤓ reviews (csv)</a>
          </div>
          {(error || loading) && <div className="pe-notice">{loading ? 'loading…' : error}</div>}
        </div>
      </section>

      {/* ── Movie | trace ── */}
      <section className="card leg-media" style={{ height: mediaH, marginTop: GAP }}>
        <div className="leg-video" style={{ width: videoW, height: mediaH - 16 }}>
          <video ref={videoRef} muted playsInline controls
                 onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight); }}
                 style={{ width: '100%', height: '100%', background: '#000' }} />
          {mediaError && <div className="leg-video-error">{mediaError}</div>}
        </div>
        <div className="leg-trace-col">
          {event && (
            <div className="leg-event-line">
              <b>{event.fly}</b> · ZT {formatZT(event.start)} · {(event.end - event.start).toFixed(1)} s
              {!blind && <> · {LEG_NAME[event.leg] || event.leg} · {event.strokes} strokes
                {event.alone ? ' · middle legs alone' : ` · front ${event.front_strokes}, hind ${event.hind_strokes} strokes`}</>}
              {' '}· immobile {event.immobile_s != null ? `${Math.round(event.immobile_s)} s` : '—'} before
              {!blind && event.p_middle != null && <> · classifier p = {event.p_middle.toFixed(2)}{event.movement ? ' (counted)' : ''}</>}
              {!blind && event.near != null && (event.near
                ? <> · <b>near {event.partner ? `fly ${event.partner.split('__').pop()}` : 'another fly'}</b></>
                : ' · away from other flies')}
            </div>
          )}
          {blind ? <div className="leg-trace leg-empty">detector's call hidden</div> : (
            <>
              <Legend showOthers={showOthers} />
              {event && <LegTrace trace={trace} event={event} playT={playT} onSeek={seekTrace} showOthers={showOthers} />}
            </>
          )}
        </div>
      </section>

      {/* ── Verdict of the current event ── */}
      <section className="card" style={{ marginTop: GAP }}>
        <div className="card-body pe-controls">
          <div className="toolbar">
            <span className="pe-group">
              What is the fly doing?
              {event && VERDICTS.map((v, i) => verdictButton(v, i, event, false))}
            </span>
            <span className="pe-group">
              which leg
              {event && WHICH.map((w) => (
                <button key={w.id} onClick={() => setWhichLeg(w.id)} title={`${w.id} (${w.key})`}
                        style={{ fontWeight: event.which_leg === w.id ? 'bold' : 'normal',
                                 background: event.which_leg === w.id ? 'var(--accent-soft)' : 'var(--btn-bg)',
                                 border: event.which_leg === w.id ? '2px solid var(--accent)' : '1px solid var(--border-strong)' }}>
                  <span className="leg-key">{w.key}</span>{w.id}
                </button>
              ))}
            </span>
            <span className="pe-group">
              moving leg and the other fly
              {event && TOUCHES.map((tc) => {
                const on = event.touches === tc.id;
                return (
                  <button key={tc.id} onClick={() => setTouches(tc.id)} title={`${tc.title} (${tc.key})`}
                          style={{ fontWeight: on ? 'bold' : 'normal', background: on ? tc.color : 'var(--btn-bg)',
                                   color: on ? '#000' : 'var(--text)',
                                   border: on ? '2px solid var(--text)' : '1px solid var(--border-strong)' }}>
                    <span className="leg-key">{tc.key}</span>{tc.label}
                  </button>
                );
              })}
            </span>
            <span className="pe-group" style={{ flex: 1, minWidth: 200 }}>
              notes
              <input type="text" value={notesDraft} style={{ flex: 1 }} disabled={!event}
                     onChange={(e) => setNotesDraft(e.target.value)}
                     onBlur={() => { if (event && notesDraft !== (event.notes || '')) save(event, { notes: notesDraft }); }}
                     onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
            </span>
          </div>
        </div>
      </section>

      {/* ── The queue ── */}
      <section className="card pe-bouts" style={{ marginTop: GAP }}>
        <div className="scroll" ref={tableRef}>
          <table className="pe-table">
            <thead>
              <tr>
                <th>#</th>
                {source === 'sample' && <th>fly</th>}
                <th>ZT</th>
                <th>dur</th>
                {!blind && <><th>leg</th><th>strokes</th><th>amplitude</th><th>front / hind</th><th title="median score of the tip / fraction of its path in single-frame jumps">tip score / jumps</th>
                  <th title="classifier: probability of a real middle-leg movement">p</th><th title="during a contact with another fly or in the 10 s after">near</th></>}
                <th>immobile</th>
                <th>verdict</th>
                <th>leg seen</th>
                <th>touches</th>
                <th>notes</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={keyOf(e)} className={i === idx ? 'selected' : undefined} onClick={() => setIdx(i)}>
                  <td>{i + 1}</td>
                  {source === 'sample' && <td>{e.fly}</td>}
                  <td>{formatZT(e.start)}</td>
                  <td>{(e.end - e.start).toFixed(1)} s</td>
                  {!blind && <>
                    <td>{LEG_NAME[e.leg] || e.leg}</td>
                    <td>{e.strokes}</td>
                    <td>{e.amplitude?.toFixed(2)}</td>
                    <td>{e.front_strokes} / {e.hind_strokes}</td>
                    <td className={e.clean === true || e.clean === 'True' ? undefined : 'leg-unclean'}>
                      {e.tip_score != null ? `${e.tip_score.toFixed(2)} / ${Math.round(100 * e.jump_fraction)}%` : '—'}
                    </td>
                    <td>{e.p_middle != null ? e.p_middle.toFixed(2) : '—'}</td>
                    <td>{e.near == null ? '—' : e.near ? (e.partner ? `fly ${e.partner.split('__').pop()}` : 'yes') : 'no'}</td>
                  </>}
                  <td>{e.immobile_s != null ? `${Math.round(e.immobile_s)} s` : '—'}</td>
                  <td>
                    {e.verdict
                      ? <span className="leg-chip" style={{ background: VERDICTS.find((v) => v.id === e.verdict)?.color }}>
                          {VERDICTS.find((v) => v.id === e.verdict)?.label}
                        </span>
                      : <span style={{ color: 'var(--subtext)' }}>—</span>}
                  </td>
                  <td>{e.which_leg || ''}</td>
                  <td>{TOUCHES.find((tc) => tc.id === e.touches)?.label || ''}</td>
                  <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pe-keys">
          keys: <b>1–7</b> verdict (same key again clears it) · <b>l</b>/<b>r</b>/<b>b</b> leg seen: left / right / both ·{' '}
          <b>t</b>/<b>o</b>/<b>x</b> the moving leg touches the other fly / does not / no other fly ·{' '}
          <b>0</b>/<b>Backspace</b> clear the review · <b>←/→</b> events · <b>n</b>/<b>Shift+n</b> next / previous unreviewed ·{' '}
          <b>Space</b> play/pause · <b>Enter</b> replay · click the trace to seek
        </div>
      </section>
    </div>
  );
}
