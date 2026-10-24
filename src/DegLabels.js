// DegLabels.js  —  "DEG labels" card of the Ethograms tab
//
// Writes deepethogram labels for the shown fly (POST /api/ethogram/<fly>/deg_labels,
// see deg_labels.py): every second of the selection gets `framerate` rows of its chunk's
// <chunk>_labels.csv, the folder being made by deepethogram when missing. The selection
// is made with Shift+drag on the ethogram, or [ and ] at the cursor; without one the
// buttons label the cursor's second. Keys 1–9 apply a preset and Delete clears, only
// while there is a selection.

import React, { useState, useEffect, useCallback } from 'react';
import api from './api';
import { useConsole } from './MessageConsole';
import { labelStyleOf, formatClock, formatDuration } from './EthogramTrack';

const API = '/api/ethogram';

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);

export default function DegLabels({ fly, labels, onLabels, selection, onSelect, cursorT, track, seek, active }) {
  const { log } = useConsole();
  const [busy, setBusy] = useState(null);         // what is being written
  const [error, setError] = useState(null);
  const [custom, setCustom] = useState([]);        // columns of the custom label

  useEffect(() => { setError(null); setCustom([]); }, [fly]);

  // the seconds a button acts on: the selection, else the cursor's second
  const target = selection
    || (cursorT != null && track ? [Math.min(track.n - 1, Math.floor(cursorT)), Math.min(track.n, Math.floor(cursorT) + 1)] : null);

  const write = useCallback(async (behaviors, name) => {
    if (!fly || !target || busy) return;
    const [start, end] = target;
    setError(null);
    setBusy(name);
    try {
      const { data } = await api.post(`${API}/${fly}/deg_labels`, { start, end, behaviors });
      const result = unwrap(data);
      onLabels(result);
      const made = result.written.filter((w) => w.created).length;
      log('info', `${fly}: ${behaviors ? `labelled ${name}` : 'cleared labels'} for ${formatDuration(end - start)}`
        + ` (${result.written.length} label file${result.written.length === 1 ? '' : 's'}`
        + `${made ? `, ${made} new DEG folder${made === 1 ? '' : 's'}` : ''})`);
      onSelect(null);
    } catch (err) {
      const message = err.response?.data?.error || err.message;
      setError(message);
      log('error', `${fly}: could not write DEG labels: ${message}`);
    } finally {
      setBusy(null);
    }
  }, [fly, target, busy, onLabels, onSelect, log]);

  const presets = labels ? labels.presets : [];   // [name, columns]

  // ── Keyboard: [ / ] selection start / end at the cursor, Esc drops it,
  //    1–9 preset and Delete clear (with a selection only) ──
  useEffect(() => {
    if (!active || !labels) return;
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = cursorT != null && track ? Math.max(0, Math.min(track.n - 1, Math.floor(cursorT))) : null;
      if (e.key === '[' && t != null) {
        e.preventDefault();
        onSelect([t, Math.max(t + 1, selection ? selection[1] : t + 1)]);
      } else if (e.key === ']' && t != null) {
        e.preventDefault();
        onSelect([Math.min(t, selection ? selection[0] : t), t + 1]);
      } else if (e.key === 'Escape' && selection) {
        e.preventDefault();
        onSelect(null);
      } else if (selection && /^[1-9]$/.test(e.key) && presets[Number(e.key) - 1]) {
        e.preventDefault();
        const [name, columns] = presets[Number(e.key) - 1];
        write(columns, name);
      } else if (selection && e.key === 'Delete') {
        e.preventDefault();
        write(null, 'clear');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, labels, cursorT, track, selection, presets, onSelect, write]);

  // previous / next labelled run
  const jump = (direction) => {
    if (!labels?.runs.length) return;
    const t = cursorT ?? 0;
    const run = direction === 'next'
      ? labels.runs.find(([a]) => a > t + 0.5)
      : [...labels.runs].reverse().find(([a, b]) => b <= Math.floor(t));
    if (run) seek(run[0], { center: true });
  };

  if (!labels) return null;

  const framerate = Math.round(labels.framerate);
  const zt = (s) => (track?.zt0 != null ? `ZT ${formatClock(track.zt0 + s)}` : `${formatClock(s)} (movie)`);
  const labelled = labels.runs.reduce((sum, [a, b]) => sum + b - a, 0);
  const project = labels.project.split('/').pop();

  return (
    <div className="card eth-card">
      <div className="card-header eth-toolbar">
        <span>DEG labels</span>
        <span className="eth-dim" title={labels.project}>
          {project} · {labels.files} labelled video{labels.files === 1 ? '' : 's'} of this fly · {formatDuration(labelled)} labelled
        </span>
        <span className="spacer" />
        <button onClick={() => jump('prev')} disabled={!labels.runs.length} title="Previous labelled stretch">◀ labelled</button>
        <button onClick={() => jump('next')} disabled={!labels.runs.length} title="Next labelled stretch">labelled ▶</button>
      </div>
      <div className="card-body deg-body">
        <div className="deg-target">
          {target ? (
            <>
              <b>{selection ? 'Selection' : 'Cursor second'}:</b> {zt(target[0])} – {zt(target[1])}
              <span className="eth-dim"> · {formatDuration(target[1] - target[0])} · {(target[1] - target[0]) * framerate} frames</span>
              {selection && <button className="deg-small" onClick={() => onSelect(null)} title="Drop the selection (Esc)">×</button>}
            </>
          ) : <span className="eth-dim">Move the cursor or select seconds on the ethogram</span>}
          {busy && <span className="eth-dim"> · writing {busy}… (a chunk without DEG folder takes ~30 s)</span>}
        </div>
        <div className="deg-buttons">
          {presets.map(([name, columns], i) => {
            const { label, color } = labelStyleOf(name);
            return (
              <button
                key={name}
                onClick={() => write(columns, name)}
                disabled={!target || Boolean(busy)}
                title={`Set ${columns.join(' + ')} to 1 and every other column to 0${i < 9 ? ` (key ${i + 1} with a selection)` : ''}`}
              >
                <span className="eth-swatch" style={{ background: color }} />
                {label}{i < 9 && <span className="eth-dim"> {i + 1}</span>}
              </button>
            );
          })}
          <button
            onClick={() => write(null, 'clear')}
            disabled={!target || Boolean(busy)}
            title="Set the frames back to -1, not labelled (Delete with a selection)"
          >
            Clear
          </button>
        </div>
        <details className="deg-custom">
          <summary>Custom combination of the project's columns</summary>
          <div className="deg-buttons">
            {labels.columns.map((column) => (
              <label key={column} className="field check">
                <input
                  type="checkbox"
                  checked={custom.includes(column)}
                  onChange={(e) => setCustom(e.target.checked ? [...custom, column] : custom.filter((c) => c !== column))}
                />
                {column}
              </label>
            ))}
            <button
              onClick={() => write(labels.columns.filter((c) => custom.includes(c)), custom.join('+'))}
              disabled={!target || !custom.length || Boolean(busy)}
            >
              Apply
            </button>
          </div>
        </details>
        {error && <div className="deg-error">{error}</div>}
        <div className="eth-keys">
          <b>Shift+drag</b> on the ethogram: select seconds · <b>[ ]</b> selection start / end at the cursor ·
          <b> 1–{Math.min(9, presets.length)}</b> label the selection · <b>Delete</b> clear it · <b>Esc</b> drop it.
          Each second writes {framerate} rows of its chunk's labels.csv; missing video folders are made with deepethogram.
        </div>
      </div>
    </div>
  );
}
