// PEValidator.js  —  drop next to App.js
//
// A second tab for the FlyHostel viewer: shows each burst's trace PNG + pose-overlay
// clip, and a pe / not_pe / unsure control per bout. Matches App.js conventions:
// same-origin requests through the shared `api` instance, experiment held server-side.
//
// Wire-up (see chat): import it in App.js, add a <Tab id="pe_validator">, and render
// <PEValidator identity={...} /> when activeTab === 'pe_validator'.

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api, { apiUrl } from './api';
import BurstTrace from './BurstTrace';
import BurstVideo from './BurstVideo';
import ConfidenceTrace from './ConfidenceTrace';
import { recordBurst } from './recordBurst';

// Relative: axios resolves it against the instance baseURL, media URLs go
// through apiUrl() because element src attributes don't see that baseURL.
const API = '/api/pe';

// Axios can hand back a raw string when a payload contains NaN; parse defensively.
const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);


// API points needed
// /pe/bouts            GET
// /pe/annotate         POST
// /pe/trace            GET
// /pe/media/videos     GET

export default function PEValidator({ fly, active }) {

  const [auditMode, setAuditMode] = useState(false);
  const [auditIds, setAuditIds] = useState([]);

  const [bouts, setBouts] = useState([]);
  const [verdicts, setVerdicts] = useState({});   // "start-end" -> verdict
  const [burstIdx, setBurstIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);       // fatal: load failed
  const [notice, setNotice] = useState(null);     // transient: "no more unreviewed bursts"
  const [selectedBoutIdx, setSelectedBoutIdx] = useState(0);
  const [trace, setTrace] = useState(null);
  const [playT, setPlayT] = useState(null);      // current playhead time (s) in trace coords
  const videoRef = useRef(null);
  const [jumpValue, setJumpValue] = useState('');
  const [jumpBidValue, setJumpBidValue] = useState('');

  const overlayCanvasRef = useRef(null);
  const plainCanvasRef = useRef(null);
  const distSvgRef = useRef(null);
  const confSvgRef = useRef(null);
  const [recording, setRecording] = useState(false);


  const OPTIONS = ['pe', 'feed', 'groom', 'walk', 'other', 'merge', 'unsure'];
    const VERDICT_STYLE = {
      pe:     { on: '#2ca02c' },
      feed:   { on: '#d62728' },
      groom:  { on: '#e377c2' },
      walk:   { on: '#9467bd' },
      other:  { on: '#7f7f7f' },
      merge:  { on: '#1f77b4' },
      unsure: { on: '#ff7f0e' },
    };

    const keyOf = (b) => `${b.start_fn}-${b.end_fn}`;

    // pipeline label -> default verdict for a non-PE bout
    const labelToVerdict = (label) =>
      label === 'pe'    ? 'pe' :
      label === 'feed'  ? 'feed' :
      label === 'groom' ? 'groom' :
      label === 'walk'  ? 'walk' :
      'other';

    // human annotation if any; else the pipeline's own guess for non-PE bouts
    const effectiveVerdict = (b) =>
      verdicts[keyOf(b)] ?? labelToVerdict(b.label);

  const load = useCallback(async () => {
    setLoading(true); setError(null); setNotice(null);
    try {
      if (!fly) { setBouts([]); return; }

      const response = await api.get(`${API}/bouts`, { params: { fly } });
      const data = unwrap(response.data);
      setBouts(data);
      const v = {};
      data.forEach(b => { if (b.verdict) v[`${b.start_fn}-${b.end_fn}`] = b.verdict; });
      setVerdicts(v);
      setBurstIdx(0);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      setBouts([]);
    } finally {
      setLoading(false);
    }
  }, [fly]);


  useEffect(() => { load(); }, [load]);

  // per-burst score for ordering: prefer a burst-level score if the backend supplies
  // one (burst_pe_score); otherwise fall back to the mean of the bouts' pe_score.
  const burstScore = useMemo(() => {
    const agg = {};
    for (const b of bouts) {
      const g = (agg[b.burst_id] ??= { burst: null, sum: 0, n: 0 });
      if (b.burst_pe_score != null) g.burst = b.burst_pe_score;
      if (b.pe_score != null) { g.sum += b.pe_score; g.n += 1; }
    }
    const out = {};
    for (const [bid, g] of Object.entries(agg)) {
      out[bid] = g.burst != null ? g.burst : (g.n ? g.sum / g.n : Infinity);
    }
    return out;
  }, [bouts]);

  // best (max) single-bout pe_score in each burst
  const burstBest = useMemo(() => {
    const out = {};
    for (const b of bouts) {
      if (b.pe_score == null) continue;
      if (out[b.burst_id] == null || b.pe_score > out[b.burst_id]) out[b.burst_id] = b.pe_score;
    }
    return out;
  }, [bouts]);

  // bursts sorted by that score, high first. missing scores sink to the bottom.
  // swap a/b in the comparator for low-first.
  const burstIds = useMemo(() => {
    const all = [...new Set(bouts.map(b => b.burst_id))];
    if (auditMode && auditIds.length) {
      const present = new Set(all);
      return auditIds.filter(id => present.has(id));
    }
    return all.sort((x, y) => (burstScore[y] ?? -Infinity) - (burstScore[x] ?? -Infinity));
  }, [bouts, auditMode, auditIds, burstScore]);

  const burstId = burstIds[burstIdx];
  const burstBouts = bouts
    .filter(b => b.burst_id === burstId)
    .sort((a, b) => a.bout_uid - b.bout_uid);

  const burstDone = useCallback((bid) => {
  const bs = bouts.filter(b => b.burst_id === bid);
    return bs.length > 0 && bs.every(b => verdicts[keyOf(b)] != null);
  }, [bouts, verdicts]);

  const gotoNextIncomplete = useCallback((dir = 1) => {
    for (let i = burstIdx + dir; i >= 0 && i < burstIds.length; i += dir) {
      if (!burstDone(burstIds[i])) { setBurstIdx(i); setNotice(null); return; }
    }
    setNotice(dir > 0 ? 'no more unreviewed bursts' : 'no earlier unreviewed bursts');
  }, [burstIdx, burstIds, burstDone]);


const downloadBurstVideo = useCallback(async () => {
    if (recording) return;
    setRecording(true);
    try {
      const bid = burstIds[burstIdx];
      // frame span of the whole burst: min start_fn .. max end_fn across its bouts
      const inBurst = bouts.filter(b => b.burst_id === bid);
      const startFn = inBurst.length ? Math.min(...inBurst.map(b => b.start_fn)) : null;
      const endFn   = inBurst.length ? Math.max(...inBurst.map(b => b.end_fn))   : null;
      const filename = (bid != null && startFn != null)
        ? `${fly}_burst_${bid}_frame_${startFn}-${endFn}.webm`
        : 'burst.webm';

      await recordBurst({
        videoEl:   videoRef.current,
        overlayEl: overlayCanvasRef.current,
        plainEl:   plainCanvasRef.current,
        distSvgEl: distSvgRef.current,
        confSvgEl: confSvgRef.current,
      }, { filename, fps: 30 });
    } catch (e) {
      setNotice(`recording failed: ${e.message}`);
    } finally {
      setRecording(false);
    }
  }, [recording, burstIds, burstIdx, bouts, fly]);

  const jumpToBurst = useCallback((oneBased) => {
    const idx = oneBased - 1;                          // display is 1-based (70/80)
    if (idx >= 0 && idx < burstIds.length) {
      setBurstIdx(idx);
      setNotice(null);
    } else {
      setNotice(`burst ${oneBased} out of range (1–${burstIds.length})`);
    }
  }, [burstIds.length]);

    const jumpToBurstId = useCallback((bid) => {
      const idx = burstIds.indexOf(bid);
      if (idx === -1) { setNotice(`burst_id ${bid} not found`); return; }
      setBurstIdx(idx);
      setNotice(null);
    }, [burstIds]);


  const scrubbingRef = useRef(false);

  const seekToTraceTime = useCallback((tSec) => {
    const vid = videoRef.current;
    if (!vid || !trace) return;
    const clipStart = burstBouts[0]?.clip_start ?? trace.start_frame;
    const videoTime = tSec + (trace.start_frame - clipStart) / trace.fps;
    const target = Math.max(0, videoTime);

    const doSeek = () => {
      const dur = Number.isFinite(vid.duration) ? vid.duration : Infinity;
      vid.currentTime = Math.min(target, Math.max(0, dur - 1e-3));
      if (vid.paused) vid.play().catch(() => {});   // resume if a seek paused it
    };

    if (vid.readyState >= 1) doSeek();
    else vid.addEventListener('loadedmetadata', doSeek, { once: true });

    setPlayT(tSec);
  }, [trace, burstBouts]);

  const setVerdict = useCallback(async (b, verdict) => {
    setVerdicts(v => ({ ...v, [keyOf(b)]: verdict }));   // optimistic
    try {
      await api.post(`${API}/annotate`, {
        fly,
        start_frame: b.start_fn, end_frame: b.end_fn,
        burst_id: b.burst_id, bout_uid: b.bout_uid,
        pe_score: b.pe_score, verdict,
      });
    } catch (e) {
      setNotice(`save failed: ${e.message}`);
      load();   // resync on failure
    }
  }, [fly, load]);

  const clearVerdict = useCallback(async (b) => {
      setVerdicts(v => { const next = { ...v }; delete next[keyOf(b)]; return next; });
    try {
      await api.post(`${API}/annotate`, {
        fly, start_frame: b.start_fn, end_frame: b.end_fn,
        burst_id: b.burst_id, bout_uid: b.bout_uid,
        pe_score: b.pe_score, verdict: null,
      });
    } catch (e) { setNotice(`clear failed: ${e.message}`); load(); }
  }, [fly, load]);

  // Defined BEFORE stateRef.current below: that assignment runs during render,
  // so anything it references must already exist (const is not hoisted).
  const setAllInBurst = useCallback((verdict) => {
    // optimistic: one state update for the whole burst
    setVerdicts(v => {
      const next = { ...v };
      burstBouts.forEach(b => { next[keyOf(b)] = verdict; });
      return next;
    });
    // persist each bout (PK is per-bout); fire together, resync if any fail
    Promise.allSettled(
      burstBouts.map(b =>
        api.post(`${API}/annotate`, {
          fly,
          start_frame: b.start_fn, end_frame: b.end_fn,
          burst_id: b.burst_id, bout_uid: b.bout_uid,
          pe_score: b.pe_score, verdict,
        })
      )
    ).then(results => {
      if (results.some(r => r.status === 'rejected')) {
        setNotice('some bulk saves failed');
        load();   // resync truth from the server
      }
    });
  }, [burstBouts, fly, load]);


  useEffect(() => { setSelectedBoutIdx(0); }, [burstId]);

  // index of the next burst (after `fromIdx`) that still has at least one bout with no
  // saved verdict; -1 if none remain. Pipeline defaults don't count as labelled — only
  // an entry in `verdicts` does.
  const findNextUnlabeledBurst = useCallback((fromIdx) => {
    for (let i = fromIdx + 1; i < burstIds.length; i++) {
      const bid = burstIds[i];
      const hasUnlabeled = bouts.some(
        b => b.burst_id === bid && verdicts[`${b.start_fn}-${b.end_fn}`] == null
      );
      if (hasUnlabeled) return i;
    }
    return -1;
  }, [burstIds, bouts, verdicts]);

  // same, but only counts bouts the pipeline itself called PE.
  const findNextUnlabeledBurstPE = useCallback((fromIdx) => {
    for (let i = fromIdx + 1; i < burstIds.length; i++) {
      const bid = burstIds[i];
      const hasUnlabeled = bouts.some(
        b => b.burst_id === bid && b.label === 'pe' && verdicts[`${b.start_fn}-${b.end_fn}`] == null
      );
      if (hasUnlabeled) return i;
    }
    return -1;
  }, [burstIds, bouts, verdicts]);


  const gotoNextUnlabeled = useCallback(() => {
    const next = findNextUnlabeledBurst(burstIdx);
    if (next === -1) {
      setNotice('no later burst has an unlabeled bout');
    } else {
      setBurstIdx(next);
      setNotice(null);
    }
  }, [findNextUnlabeledBurst, burstIdx]);

  const gotoNextUnlabeledPE = useCallback(() => {
    const next = findNextUnlabeledBurstPE(burstIdx);
    if (next === -1) {
      setNotice('no later burst has an unlabeled PE bout');
    } else {
      setBurstIdx(next);
      setNotice(null);
    }
  }, [findNextUnlabeledBurstPE, burstIdx]);


  const stateRef = useRef({});
  stateRef.current = { active, burstBouts, burstIds, selectedBoutIdx, verdicts, OPTIONS,
                       setVerdict, clearVerdict, setAllInBurst, gotoNextUnlabeled,
                       gotoNextIncomplete };

  useEffect(() => {
  const onKey = (e) => {
    const s = stateRef.current;
    if (!s.active) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      setBurstIdx(i => Math.min(Math.max(i + (e.key === 'ArrowRight' ? 1 : -1), 0),
                                s.burstIds.length - 1));
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedBoutIdx(i => Math.min(Math.max(i + (e.key === 'ArrowDown' ? 1 : -1), 0),
                                        s.burstBouts.length - 1));
      return;
    }
    if (e.key === 'n' || e.key === 'N') {
      s.gotoNextUnlabeled?.();
      return;
    }
    // clear the selected bout's verdict (unpress), regardless of which verdict it holds
    if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
      e.preventDefault();
      const target = s.burstBouts[s.selectedBoutIdx];
      const saved = target && s.verdicts[`${target.start_fn}-${target.end_fn}`];
      if (target && saved != null) s.clearVerdict?.(target);
      return;
    }

    // Shift+1..7 -> mark EVERY bout in the burst. Must use e.code: with Shift held,
    // e.key is '!', '@', '#'... not the digit. Shift-only, so it can't collide with
    // App.js's Ctrl+Shift+digit fly switcher.
    if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const m = /^Digit([1-7])$/.exec(e.code);
      if (m) {
        e.preventDefault();
        const opt = s.OPTIONS[parseInt(m[1], 10) - 1];
        const n = s.burstBouts.length;
        if (!n) return;
        if (n > 5 && !window.confirm(`Mark all ${n} bouts as "${opt}"?`)) return;
        s.setAllInBurst?.(opt);
        return;
      }
    }

    const map = { '1': 'pe', '2': 'feed', '3': 'groom', '4': 'walk', '5': 'other', '6': 'merge', '7': 'unsure' };
    if (map[e.key] && s.burstBouts.length) {
      const target = s.burstBouts[s.selectedBoutIdx];
      if (!target) return;
      const saved = s.verdicts[`${target.start_fn}-${target.end_fn}`];
      if (saved === map[e.key]) s.clearVerdict?.(target);   // same key again -> unpress
      else s.setVerdict(target, map[e.key]);
      return;
    }
    if (e.key === 'j') { s.gotoNextIncomplete?.(1);  return; }
    if (e.key === 'k') { s.gotoNextIncomplete?.(-1); return; }

  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, []);   // subscribe ONCE; all live values come from stateRef

  useEffect(() => {
    if (!fly) { setAuditIds([]); return; }
    api.get(`${API}/audit`, { params: { fly } })
      .then(r => setAuditIds(unwrap(r.data)))
      .catch(() => setAuditIds([]));
  }, [fly]);

  // fetch trace when the burst changes
  useEffect(() => {
    if (burstId == null) return;
    const controller = new AbortController();
    const t0 = performance.now();

    api.get(`${API}/trace`, { params: { fly, burst_id: burstId }, signal: controller.signal })
      .then(r => {
        const data = unwrap(r.data);
        console.log('[trace] fetch ms:', (performance.now() - t0).toFixed(0),
                    'points:', data.points?.length);
        setTrace(data);
      })
      .catch(() => {
        if (controller.signal.aborted) return;   // superseded by a newer burst
        setTrace(null);
      });

    setPlayT(null);
    return () => controller.abort();
  }, [fly, burstId]);

  // drive the playhead from the video's presented frames
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !trace || !vid.requestVideoFrameCallback) return;
    let handle;
    const tick = (now, meta) => {
      if (trace && burstBouts[0] && trace.burst_id === burstBouts[0].burst_id) {
        const clipStart = burstBouts[0]?.clip_start ?? trace.start_frame;
        const globalFrame = clipStart + Math.round(meta.mediaTime * trace.fps);
        setPlayT((globalFrame - trace.start_frame) / trace.fps);
      }
      handle = vid.requestVideoFrameCallback(tick);
    };
    handle = vid.requestVideoFrameCallback(tick);
    return () => vid.cancelVideoFrameCallback?.(handle);
  }, [trace, burstBouts]);

  const lastSeekedKeyRef = useRef(null);
  const seekToGlobalFrame = useCallback((globalFrame) => {
    const vid = videoRef.current;
    if (!vid || !trace) return;

    const clipStart = burstBouts[0]?.clip_start ?? trace.start_frame;

    const videoTime = (globalFrame - clipStart) / trace.fps;

    const doSeek = () => {
      const dur = Number.isFinite(vid.duration) ? vid.duration : 0;
      vid.currentTime = Math.min(
        Math.max(0, videoTime),
        Math.max(0, dur - 1e-3)
      );
      if (vid.paused) vid.play().catch(() => {});
    };

    if (vid.readyState >= 1) doSeek();
    else vid.addEventListener('loadedmetadata', doSeek, { once: true });

    setPlayT((globalFrame - trace.start_frame) / trace.fps);
  }, [burstBouts, trace]);


  useEffect(() => {
      if (!trace) return;
      const b = burstBouts[selectedBoutIdx];
      if (!b) return;

      // GUARD: the trace in state must belong to THIS bout's burst. On burst switch,
      // burstBouts updates immediately but the trace fetch resolves ~0.5s later; seeking
      // in that window differences a new bout against the old trace's origin -> garbage.
      if (trace.burst_id !== b.burst_id) return;

      const boutKey = keyOf(b);
      if (lastSeekedKeyRef.current === boutKey) return;
      lastSeekedKeyRef.current = boutKey;

      const oneSec = Math.round(trace.fps);
      seekToGlobalFrame(b.start_fn - oneSec);
    }, [selectedBoutIdx, trace, burstBouts, seekToGlobalFrame]);

  // clip_start for the current burst; recomputed whenever the burst or trace changes so
  // BurstVideo always aligns pose frames against the CURRENT burst, not a stale one.
  const clipStart = useMemo(
    () => burstBouts[0]?.clip_start ?? trace?.start_frame,
    [burstBouts, trace]
  );

  // Early returns, in priority order. `error` only takes over the whole panel when
  // there's nothing to show; otherwise it renders as a dismissible banner below.
  if (!fly)    return <div style={{ padding: 12 }}>Select a fly…</div>;
  if (loading) return <div style={{ padding: 12 }}>Loading bouts…</div>;
  if (error && !bouts.length) {
    return <div style={{ padding: 12, color: '#d62728' }}>{error}</div>;
  }
  if (!bouts.length) {
    return (
      <div style={{ padding: 12 }}>
        {`No PE bouts for this fly (${fly}).`}
      </div>
    );
  }

  const nReviewed = Object.keys(verdicts).length;
  const selectedBout = burstBouts[selectedBoutIdx];
  const traceStem = burstBouts[0]?.trace_stem; // same for all bouts in the burst
  // Media URLs land in element src attributes, so they need apiUrl(), not the
  // axios baseURL.
  const tracePng   = traceStem && apiUrl(`${API}/media/plots/${traceStem}.png`);
  const burstClip  = traceStem && apiUrl(`${API}/media/videos/${traceStem}.mp4`);
  // burst-level pose: one file per burst, aligned to the burst clip. Covers every bout.
  const burstPose  = traceStem && apiUrl(`${API}/media/videos/${traceStem}.pose.json`);

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '0 12px' }}>
    <div style={{ flex: 1, minWidth: 0, maxWidth: 1200 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button disabled={burstIdx === 0} onClick={() => setBurstIdx(i => i - 1)}>← prev</button>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          burst {burstId} · score {burstScore[burstId]?.toFixed(2) ?? '—'} · best {burstBest[burstId]?.toFixed(2) ?? '—'} · {burstIdx + 1}/{burstIds.length} · reviewed bouts {nReviewed}/{bouts.length}
          <input
            type="number"
            value={jumpBidValue}
            onChange={e => setJumpBidValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const bid = parseInt(jumpBidValue, 10);
                if (Number.isInteger(bid)) jumpToBurstId(bid);
              }
              e.stopPropagation();          // keep digits out of the global 1-7 / arrow handler
            }}
            placeholder="burst_id"
            style={{ width: 90, padding: '2px 6px' }}
          />

          <input
            type="number"
            min={1}
            max={burstIds.length}
            value={jumpValue}
            onChange={e => setJumpValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const n = parseInt(jumpValue, 10);
                if (Number.isInteger(n)) jumpToBurst(n);
              }
              e.stopPropagation();          // keep typing out of the global 1-5 / arrow handler
            }}
            placeholder="go to #"
            style={{ width: 70, padding: '2px 6px' }}
          />
        </span>
        <span style={{ display: 'flex', gap: 6 }}>
          <button disabled={burstIdx >= burstIds.length - 1} onClick={() => setBurstIdx(i => i + 1)}>next →</button>
          <button onClick={gotoNextUnlabeled}
                  title="jump to the next burst that still has an unlabeled bout (n)">
            next unlabeled ⏭
          </button>
          <button onClick={gotoNextUnlabeledPE}
                  title="jump to the next burst that still has an unlabeled PE bout">
            next unlabeled PE ⏭
          </button>
          <button onClick={downloadBurstVideo} disabled={recording}
                    title="record this burst's visualization to a .webm">
              {recording ? 'recording…' : '⤓ video'}
            </button>
        </span>
      </div>

      <label style={{ marginLeft: 12 }}>
        <input type="checkbox" checked={auditMode}
              onChange={e => { setAuditMode(e.target.checked); setBurstIdx(0); }} />
        {' '}audit mode
      </label>
      {auditMode && (
        <>
          <span style={{ marginLeft: 8, fontSize: '0.85em', color: '#777' }}>
            {burstIds.filter(burstDone).length}/{burstIds.length} done
          </span>
          <button onClick={() => gotoNextIncomplete(-1)} style={{ marginLeft: 8 }}>◀ prev</button>
          <button onClick={() => gotoNextIncomplete(1)}>next unreviewed ▸</button>
        </>
      )}

      {notice && (
        <div style={{ marginTop: 6, padding: '4px 8px', background: '#fff3cd',
                      border: '1px solid #ffe08a', borderRadius: 4, fontSize: '0.85em',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} style={{ marginLeft: 8 }}>dismiss</button>
        </div>
      )}


      {(() => {
        const PANEL_H = 280;
        const PANEL_W = 280;
        return (
          <div style={{ display: 'flex', gap: 12, marginTop: 8, alignItems: 'stretch',
                        height: PANEL_H }}>
            <BurstVideo
              src={burstClip}
              poseUrl={burstPose}
              videoRef={videoRef}
              width={PANEL_W}
              height={PANEL_H}
              clipStart={clipStart}
              traceFps={trace?.fps}
              overlayExportRef={overlayCanvasRef}
              plainExportRef={plainCanvasRef}
              onError={e => { e.target.style.display = 'none'; }}
            />
            <div style={{ flex: 1, minWidth: 0, height: '100%',
                          display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ flex: 1, minHeight: 0 }}>
                {trace && <BurstTrace trace={trace} playT={playT}
                                      onScrub={seekToTraceTime} scrubbingRef={scrubbingRef}
                                      svgExportRef={distSvgRef} />}
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                {trace && <ConfidenceTrace trace={trace} playT={playT}
                                          onScrub={seekToTraceTime} scrubbingRef={scrubbingRef}
                                          svgExportRef={confSvgRef} />}
              </div>
            </div>
          </div>
        );
      })()}


      <div
        style={{
          marginTop: 12,
          maxHeight: 350,      // choose whatever fits your layout
          overflowY: 'auto',
          border: '1px solid #ddd',
        }}
      >
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
          }}
        >
      <caption style={{ captionSide: 'top', textAlign: 'left', padding: '4px 6px',
                        fontSize: '0.85em', color: '#555' }}>
        fly: <b>{fly}</b>
      </caption>
      <thead>
      <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
        <th style={{ position: 'sticky', top: 0, background: 'white' }}>bout</th>
        <th style={{ position: 'sticky', top: 0, background: 'white' }}>frames</th>
        <th style={{ position: 'sticky', top: 0, background: 'white' }}>frame_idx</th>
        <th style={{ position: 'sticky', top: 0, background: 'white' }}>dur</th>
        <th style={{ position: 'sticky', top: 0, background: 'white' }}>score</th>
        <th style={{ position: 'sticky', top: 0, background: 'white' }}>verdict</th>
      </tr>
      </thead>

        <tbody>
                  <tr style={{ borderBottom: '2px solid #ccc', background: '#fafafa' }}>
            <td colSpan={5} style={{ textAlign: 'right', paddingRight: 8,
                                     fontSize: '0.85em', color: '#555' }}>
              mark all {burstBouts.length} bouts →
            </td>
            <td>
              {OPTIONS.map(opt => (
                <button key={opt}
                  onClick={() => {
                    if (burstBouts.length > 5 &&
                        !window.confirm(`Mark all ${burstBouts.length} bouts as "${opt}"?`)) return;
                    setAllInBurst(opt);
                  }}
                  style={{
                    marginRight: 4, padding: '2px 6px', cursor: 'pointer',
                    border: '1px dashed #888', borderRadius: 4,   // dashed = bulk, distinct from per-bout
                    background: VERDICT_STYLE[opt].on, color: 'white',
                    fontWeight: 'bold', opacity: 0.85,
                  }}>
                  {opt}
                </button>
              ))}
            </td>
          </tr>

        {burstBouts.map((b, idx) => {
                    const isSel = idx === selectedBoutIdx;
                    return (
                      <tr key={keyOf(b)}
                          onClick={() => setSelectedBoutIdx(idx)}
                          style={{
                            borderBottom: '1px solid #eee',
                            background: isSel ? '#eef4ff' : 'transparent',
                            outline: isSel ? '2px solid #1f77b4' : 'none',
                            cursor: 'pointer',
                          }}>
                <td>{b.bout_uid}{b.is_solitary ? ' (solo)' : ''}</td>
                <td>{b.start_fn}–{b.end_fn}</td>
                <td>{b.start_fidx}–{b.end_fidx}</td>
                <td>{b.dur_s?.toFixed(2)}s</td>
                <td>{b.pe_score?.toFixed(2)}</td>
                <td>
                  {(() => {
                    const userAnnotated = verdicts[keyOf(b)] != null;
                    const pipelineVerdict = labelToVerdict(b.label);   // pipeline's mapped verdict
                    return (
                      <>
                        {OPTIONS.map(opt => {
                          const chosen = effectiveVerdict(b) === opt;         // currently active
                          const isPipeline = opt === pipelineVerdict;          // pipeline's prediction (always marked)
                          const isUnconfirmedDefault = !userAnnotated && isPipeline;
                          return (
                            <button key={opt} onClick={
                              () => {
                                const saved = verdicts[keyOf(b)];
                                if (saved === opt) clearVerdict(b);   // click the pressed one -> unpress
                                else setVerdict(b, opt);
                            }} title={isPipeline
                                ? `pipeline predicted: ${b.label}${b.label_reason ? ` (${b.label_reason})` : ''}`
                                : undefined}
                              style={{
                                position: 'relative',
                                marginRight: 4, padding: '2px 6px', cursor: 'pointer',
                                border: chosen ? '2px solid #333' : '1px solid #bbb',
                                borderRadius: 4,
                                background: chosen
                                  ? (isUnconfirmedDefault ? '#ffd54f' : VERDICT_STYLE[opt].on)
                                  : '#f4f4f4',
                                color: chosen && !isUnconfirmedDefault ? 'white' : '#333',
                                fontWeight: chosen ? 'bold' : 'normal',
                                fontStyle: isUnconfirmedDefault ? 'italic' : 'normal',
                                // pipeline-predicted button gets a persistent accent underline
                                boxShadow: isPipeline ? 'inset 0 -3px 0 0 #111' : 'none',
                              }}>
                              {isPipeline ? '★ ' : ''}{opt}
                            </button>
                          );
                        })}
                        {/* the raw pipeline label, always visible even after annotation */}
                        <span style={{ marginLeft: 6, fontSize: '0.78em', color: '#888',
                                       whiteSpace: 'nowrap' }}>
                          pred: <b>{b.label}</b>
                        </span>
                      </>
                    );
                  })()}
                </td>

              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <div style={{ marginTop: 8, fontSize: '0.8em', color: '#777' }}>
        keys: <b>1–7</b> verdict for the selected bout (same key again unpresses) ·{' '}
        <b>Shift+1–7</b> same verdict for ALL bouts in the burst ·{' '}
        <b>0</b>/<b>Backspace</b> clear ·{' '}
        <b>←/→</b> bursts · <b>↑/↓</b> bouts · <b>n</b> next unlabeled ·{' '}
        <b>j/k</b> next/prev unreviewed · <b>★</b> = pipeline's prediction
      </div>
    </div>

      {/* RIGHT: debug console, alongside all the info */}
      <div
        style={{
          width: 320,
          flexShrink: 0,
          marginTop: 8,
          background: '#111',
          color: '#0f0',
          fontFamily: 'monospace',
          fontSize: 12,
          padding: 8,
          border: '1px solid #555',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        <div><b>Current media</b></div>

        <div>Video: {burstClip || "(none)"}</div>
        <div>Pose: {burstPose || "(none)"}</div>
        <div>Trace PNG: {tracePng || "(none)"}</div>

        <br />

        <div>burst_id: {burstId}</div>
        <div>bout_uid: {selectedBout?.bout_uid}</div>
        <div>media_stem: {selectedBout?.media_stem}</div>
        <div>trace_stem: {traceStem}</div>
      </div>
    </div>
  );
}