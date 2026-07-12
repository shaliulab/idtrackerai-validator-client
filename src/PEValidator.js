// PEValidator.js  —  drop next to App.js
//
// A second tab for the FlyHostel viewer: shows each burst's trace PNG + pose-overlay
// clip, and a pe / not_pe / unsure control per bout. Matches App.js conventions:
// axios, BACKEND_SERVER/BACKEND_PORT from constants, experiment held server-side.
//
// Wire-up (see chat): import it in App.js, add a <Tab id="pe_validator">, and render
// <PEValidator identity={...} /> when activeTab === 'pe_validator'.

import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { BACKEND_SERVER, BACKEND_PORT } from './constants';
import { useRef } from 'react';
import BurstTrace from './BurstTrace';
import BurstVideo from './BurstVideo';

const API = `http://${BACKEND_SERVER}:${BACKEND_PORT}/api/pe`;


// API points needed
// /pe/bouts            GET
// /pe/annotate         POST
// /pe/trace            GET
// /pe/media/videos     GET

export default function PEValidator({ fly, active }) {
  

  const [bouts, setBouts] = useState([]);
  const [verdicts, setVerdicts] = useState({});   // "start-end" -> verdict
  const [burstIdx, setBurstIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedBoutIdx, setSelectedBoutIdx] = useState(0);
  const [trace, setTrace] = useState(null);
  const [playT, setPlayT] = useState(null);      // current playhead time (s) in trace coords
  const videoRef = useRef(null);


    
  const OPTIONS = ['pe', 'feed', 'groom', 'other', 'merge', 'unsure'];
    const VERDICT_STYLE = {
      pe:     { on: '#2ca02c' },
      feed:   { on: '#d62728' },
      groom:  { on: '#e377c2' },
      other:  { on: '#7f7f7f' },
      merge:  { on: '#1f77b4' },
      unsure: { on: '#ff7f0e' },
    };

    // pipeline label -> default verdict for a non-PE bout
    const labelToVerdict = (label) =>
      label === 'pe'    ? 'pe' :
      label === 'feed'  ? 'feed' :
      label === 'groom' ? 'groom' :
      'other';
  
    // human annotation if any; else the pipeline's own guess for non-PE bouts
    const effectiveVerdict = (b) =>
      verdicts[keyOf(b)] ?? labelToVerdict(b.label);
    
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      if (!fly) return;

      const { data } = await 
        axios.get(`${API}/bouts`, {
          params: { fly }
        });
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

  // distinct bursts, in the order the (score-sorted) bouts arrived
  const burstIds = [...new Set(bouts.map(b => b.burst_id))];
  const burstId = burstIds[burstIdx];
  const burstBouts = bouts
    .filter(b => b.burst_id === burstId)
    .sort((a, b) => a.bout_uid - b.bout_uid);

    

  const [jumpValue, setJumpValue] = useState('');

  const jumpToBurst = useCallback((oneBased) => {
    const idx = oneBased - 1;                          // display is 1-based (70/80)
    if (idx >= 0 && idx < burstIds.length) {
      setBurstIdx(idx);
      setError(null);
    } else {
      setError(`burst ${oneBased} out of range (1–${burstIds.length})`);
    }
  }, [burstIds.length]);




  const keyOf = b => `${b.start_fn}-${b.end_fn}`;
  const scrubbingRef = useRef(false);

  const seekToTraceTime = useCallback((tSec) => {
    const vid = videoRef.current;
    if (!vid || !trace) return;
    const clipStart = burstBouts[0]?.clip_start ?? trace.start_frame;
    const videoTime = tSec + (trace.start_frame - clipStart) / trace.fps;
    const target = Math.max(0, videoTime);

    const doSeek = () => {
          console.log('seek', { target, dur: vid.duration,
                            traceStart: trace.start_frame,
                            clipStart: burstBouts[0]?.clip_start,
                            tSec });

      const dur = Number.isFinite(vid.duration) ? vid.duration : Infinity;
      vid.currentTime = Math.min(target, Math.max(0, dur - 1e-3));
      if (vid.paused) vid.play().catch(() => {});   // resume if a seek paused it
    };
    console.log(vid.readyState);
    console.log(vid.duration);

    if (vid.readyState >= 1) doSeek();
    else vid.addEventListener('loadedmetadata', doSeek, { once: true });

    setPlayT(tSec);
  }, [trace, burstBouts]);

  const setVerdict = useCallback(async (b, verdict) => {
    setVerdicts(v => ({ ...v, [keyOf(b)]: verdict }));   // optimistic
    try {
      await axios.post(`${API}/annotate`, {
        fly,
        start_frame: b.start_fn, end_frame: b.end_fn,
        burst_id: b.burst_id, bout_uid: b.bout_uid,
        pe_score: b.pe_score, verdict,
      });
    } catch (e) {
      setError(`save failed: ${e.message}`);
      load();   // resync on failure
    }
  }, [fly, load]);


  useEffect(() => { setSelectedBoutIdx(0); }, [burstId]);

  
  const stateRef = useRef({});
  stateRef.current = { active, burstBouts, burstIds, selectedBoutIdx, verdicts, setVerdict };

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
      const map = { '1': 'pe', '2': 'feed', '3': 'groom', '4': 'other', '5': 'merge', '6': 'unsure'};
      if (map[e.key] && s.burstBouts.length) {
        const target = s.burstBouts[s.selectedBoutIdx];
        if (target) s.setVerdict(target, map[e.key]);   // only PE
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);   // subscribe ONCE; all live values come from stateRef

  // fetch trace when the burst changes
  useEffect(() => {
    if (burstId == null) return;
    axios.get(`${API}/trace`, { params: { fly, burst_id: burstId } })
      .then(r => setTrace(r.data)).catch(() => setTrace(null));
    setPlayT(null);
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
        axios.post(`${API}/annotate`, {
          fly,
          start_frame: b.start_fn, end_frame: b.end_fn,
          burst_id: b.burst_id, bout_uid: b.bout_uid,
          pe_score: b.pe_score, verdict,
        })
      )
    ).then(results => {
      if (results.some(r => r.status === 'rejected')) {
        setError('some bulk saves failed');
        load();   // resync truth from the server
      }
    });
  }, [burstBouts, fly, load]);


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

  if (loading) return <div style={{ padding: 12 }}>Loading bouts…</div>;
  if (error)   return <div style={{ padding: 12, color: '#d62728' }}>{error}</div>;
  if (!bouts.length) {
  return (
      <div style={{ padding: 12 }}>
        {`No PE bouts for this fly (${fly}).`}
      </div>
    );
  }

  const nReviewed = Object.keys(verdicts).length;
  const selectedBout = burstBouts[selectedBoutIdx];
  // const stem = burstBouts[0]?.media_stem;   // changes with the bout
  const traceStem = burstBouts[0]?.trace_stem; // same for all bouts in the burst
  const tracePng = traceStem && `${API}/media/plots/${traceStem}.png`;
  const burstClip = traceStem && `${API}/media/videos/${traceStem}.mp4`;
  const boutPose = selectedBout?.media_stem &&
    `${API}/media/videos/${selectedBout.media_stem}.pose.json`;
  

  if (!fly)    return <div style={{ padding: 12 }}>Select a fly…</div>;
  if (loading) return <div style={{ padding: 12 }}>Loading bouts…</div>;
  if (error)   return <div style={{ padding: 12, color: '#d62728' }}>{error}</div>;
  if (!bouts.length) return (
    <div style={{ padding: 12 }}>{`No PE bouts for this fly (${fly}).`}</div>
  );

  return (
    <div style={{ maxWidth: 900, padding: '0 12px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button disabled={burstIdx === 0} onClick={() => setBurstIdx(i => i - 1)}>← prev</button>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          burst {burstId} · {burstIdx + 1}/{burstIds.length} · reviewed bouts {nReviewed}/{bouts.length}
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
        <button disabled={burstIdx >= burstIds.length - 1} onClick={() => setBurstIdx(i => i + 1)}>next →</button>
      </div>

      {(() => {
        const PANEL_H = 280;         // one height for all three
        const PANEL_W = 280;         // square video panels
        return (
          <div style={{ display: 'flex', gap: 12, marginTop: 8, alignItems: 'stretch',
                        height: PANEL_H }}>
            <BurstVideo
              src={burstClip}
              poseUrl={boutPose}
              videoRef={videoRef}
              width={PANEL_W}
              height={PANEL_H}
              onError={e => { e.target.style.display = 'none'; }}
            />
            <div style={{ flex: 1, minWidth: 0, height: '100%' }}>
              {trace && <BurstTrace trace={trace} playT={playT}
                                    onScrub={seekToTraceTime} scrubbingRef={scrubbingRef} />}
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
                    const v = verdicts[keyOf(b)];
                    const clipMp4 = `${API}/media/videos/${b.media_stem}.mp4`;
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
                  {OPTIONS.map(opt => {
                    const userAnnotated = verdicts[keyOf(b)] != null;

                    const chosen = effectiveVerdict(b) === opt;
                    const isDefault =
                      !userAnnotated &&
                      opt === labelToVerdict(b.label);
                    return (
                      <button key={opt} onClick={() => setVerdict(b, opt)}
                        title={isDefault ? `pipeline: ${b.label_reason || b.label}` : undefined}
                        style={{
                          marginRight: 4, padding: '2px 6px', cursor: 'pointer',
                          border: chosen ? '2px solid #333' : '1px solid #bbb',
                          borderRadius: 4,
                          background: chosen
                            ? (isDefault ? '#ffd54f' : VERDICT_STYLE[opt].on)
                            : '#f4f4f4',

                          color: chosen && !isDefault ? 'white' : '#333',

                          fontWeight: chosen ? 'bold' : 'normal',

                          fontStyle: isDefault ? 'italic' : 'normal',
                        }}>
                        {opt}
                      </button>
                    );
                  })}
                </td>

              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      <div style={{ marginTop: 8, fontSize: '0.8em', color: '#777' }}>
        keys: <b>1</b>=pe <b>2</b>=feed <b>3</b>=groom <b>4</b>=other <b>5</b>=merge <b>6</b>=unsure · <b>←/→</b> bursts  <b>↑/↓</b> bouts
      </div>
    </div>
  );
}