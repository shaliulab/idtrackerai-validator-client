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

const API = `http://${BACKEND_SERVER}:${BACKEND_PORT}/api/pe`;

export default function PEValidator({ identity = 1 }) {
  const [bouts, setBouts] = useState([]);
  const [verdicts, setVerdicts] = useState({});   // "start-end" -> verdict
  const [burstIdx, setBurstIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data } = await axios.get(`${API}/bouts`, { params: { identity } });
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
  }, [identity]);

  useEffect(() => { load(); }, [load]);

  // distinct bursts, in the order the (score-sorted) bouts arrived
  const burstIds = [...new Set(bouts.map(b => b.burst_id))];
  const burstId = burstIds[burstIdx];
  const burstBouts = bouts.filter(b => b.burst_id === burstId);
  const keyOf = b => `${b.start_fn}-${b.end_fn}`;

  const setVerdict = useCallback(async (b, verdict) => {
    setVerdicts(v => ({ ...v, [keyOf(b)]: verdict }));   // optimistic
    try {
      await axios.post(`${API}/annotate`, {
        identity,
        start_frame: b.start_fn, end_frame: b.end_fn,
        burst_id: b.burst_id, bout_uid: b.bout_uid,
        pe_score: b.pe_score, verdict,
      });
    } catch (e) {
      setError(`save failed: ${e.message}`);
      load();   // resync on failure
    }
  }, [identity, load]);

  // keyboard: 1/2/3 verdict the FIRST unreviewed bout in the burst; arrows navigate
  useEffect(() => {
    const onKey = (e) => {
      if (['ArrowRight', 'ArrowLeft'].includes(e.key)) {
        setBurstIdx(i => Math.min(Math.max(i + (e.key === 'ArrowRight' ? 1 : -1), 0),
                                  burstIds.length - 1));
        return;
      }
      const map = { '1': 'pe', '2': 'not_pe', '3': 'unsure' };
      if (map[e.key] && burstBouts.length) {
        const target = burstBouts.find(b => !verdicts[keyOf(b)]) || burstBouts[0];
        setVerdict(target, map[e.key]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [burstBouts, burstIds.length, verdicts, setVerdict]);

  if (loading) return <div style={{ padding: 12 }}>Loading bouts…</div>;
  if (error)   return <div style={{ padding: 12, color: '#d62728' }}>{error}</div>;
  if (!bouts.length) return <div style={{ padding: 12 }}>No PE bouts for this fly.</div>;

  const nReviewed = Object.keys(verdicts).length;
  const stem = burstBouts[0]?.media_stem;   // same for every bout in the burst
  const tracePng = stem && `${API}/media/plots/${stem}.png`;
  const clipMp4  = stem && `${API}/media/videos/${stem}.mp4`;
  const poseJson = stem && `${API}/media/videos/${stem}.pose.json`;
  
  const VERDICT_STYLE = {
    pe:      { on: '#2ca02c' }, not_pe: { on: '#d62728' }, unsure: { on: '#888' },
  };

  return (
    <div style={{ maxWidth: 900, padding: '0 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button disabled={burstIdx === 0} onClick={() => setBurstIdx(i => i - 1)}>← prev</button>
        <span>burst {burstId} · {burstIdx + 1}/{burstIds.length} · reviewed {nReviewed}/{bouts.length}</span>
        <button disabled={burstIdx >= burstIds.length - 1} onClick={() => setBurstIdx(i => i + 1)}>next →</button>
      </div>

      <img src={tracePng} alt={`trace ${burstId}`} style={{ width: '100%', marginTop: 8 }}
           onError={e => { e.target.style.display = 'none'; }} />
      <video src={clipMp4} controls loop muted style={{ width: '100%', marginTop: 4 }}
             onError={e => { e.target.style.display = 'none'; }} />

      <table style={{ width: '100%', marginTop: 12, borderCollapse: 'collapse' }}>
        <thead><tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
          <th>bout</th><th>frames</th><th>dur</th><th>score</th><th>verdict</th>
        </tr></thead>
        <tbody>
          {burstBouts.map(b => {
            const v = verdicts[keyOf(b)];
            return (
              <tr key={keyOf(b)} style={{ borderBottom: '1px solid #eee' }}>
                <td>{b.bout_uid}{b.is_solitary ? ' (solo)' : ''}</td>
                <td>{b.start_fn}–{b.end_fn}</td>
                <td>{b.dur_s?.toFixed(2)}s</td>
                <td>{b.pe_score?.toFixed(2)}</td>
                <td>
                  {['pe', 'not_pe', 'unsure'].map(opt => (
                    <button key={opt} onClick={() => setVerdict(b, opt)}
                      style={{
                        marginRight: 4, padding: '2px 8px', cursor: 'pointer',
                        border: '1px solid #bbb', borderRadius: 4,
                        background: v === opt ? VERDICT_STYLE[opt].on : '#f4f4f4',
                        color: v === opt ? 'white' : '#333',
                        fontWeight: v === opt ? 'bold' : 'normal',
                      }}>
                      {opt}
                    </button>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ marginTop: 8, fontSize: '0.8em', color: '#777' }}>
        keys: <b>1</b>=pe <b>2</b>=not_pe <b>3</b>=unsure · <b>←/→</b> bursts
      </div>
    </div>
  );
}