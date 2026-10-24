// DegLabels.js  —  "DEG labels" card of the Ethograms tab
//
// Writes deepethogram labels for the shown fly (POST /api/ethogram/<fly>/deg_labels,
// see deg_labels.py): every second of the selection gets `framerate` rows of its chunk's
// <chunk>_labels.csv, the folder being made by deepethogram when missing. The selection
// is made with Shift+drag on the ethogram, or [ and ] at the cursor; without one the
// buttons and keys label the cursor's second. Keys 1–6 apply a preset (1 walk, 2 groom,
// 3 feed, 4 inactive + micromovement, 5 inactive, 6 inactive + PE, in the server's
// PRESETS order), 0 background, and Delete applies None: the frames go back to -1 (not
// labelled), removing whatever was written there.
//
// "Label while moving" gives every second the cursor enters (playback, arrow keys) the
// last label applied, None included (labels are then removed as it moves), until stopped. Writes go through one queue, sent in order;
// contiguous seconds of the same label waiting in it are merged into one write. A write
// that needs a new DEG folder runs as a job (progress in the console).

import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from './api';
import { useConsole } from './MessageConsole';
import { labelStyleOf, formatClock, formatDuration } from './EthogramTrack';

const API = '/api/ethogram';
// While labelling on the move, a jump forward of at most this many seconds (fast playback,
// Shift+→) also labels the seconds skipped; longer jumps label only the second reached.
const MAX_FILL = 10;

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);

// key of the i-th preset: background on 0, the others 1, 2, ... in order
const keyOf = (name, i) => (name === 'background' ? '0' : i < 9 ? String(i + 1) : null);

// the label that removes labels (behaviors null)
const NONE = 'none';
const styleOf = (name) => (name === NONE ? { label: 'None (remove)', color: 'transparent', none: true } : labelStyleOf(name));
const Swatch = ({ style }) => <span className={`eth-swatch${style.none ? ' deg-none-swatch' : ''}`} style={{ background: style.color }} />;

export default function DegLabels({ fly, labels, onLabels, selection, onSelect, cursorT, track, seek, active }) {
  const { log, trackJob } = useConsole();
  const [pending, setPending] = useState(0);       // writes queued or being sent
  const [error, setError] = useState(null);
  const [custom, setCustom] = useState([]);        // columns of the custom label
  const [lastLabel, setLastLabel] = useState(null);   // { name, columns }: what moving labels with
  const [painting, setPainting] = useState(false);

  useEffect(() => { setError(null); setCustom([]); setPainting(false); }, [fly]);

  // ── Write queue ──
  const flyRef = useRef(fly);        // the fly shown now (the queue may outlive a switch)
  flyRef.current = fly;
  const queue = useRef([]);          // { fly, start, end, behaviors, name, quiet }
  const sending = useRef(false);

  const send = useCallback(async ({ fly: f, start, end, behaviors, name, quiet }) => {
    try {
      const response = await api.post(`${API}/${f}/deg_labels`, { start, end, behaviors });
      let result = unwrap(response.data);
      if (response.status === 202) {
        // new DEG folders are being made by deepethogram: the console shows their progress
        const job = await trackJob(result);
        if (job.status !== 'done') throw new Error(job.error || `job ${job.status}`);
        result = job.result;
      }
      if (f === flyRef.current) onLabels(result);
      const made = result.written.filter((w) => w.created).length;
      if (!quiet || made) {
        log('info', `${f}: ${behaviors ? `labelled ${name}` : 'cleared labels'} for ${formatDuration(end - start)}`
          + ` (${result.written.length} label file${result.written.length === 1 ? '' : 's'}`
          + `${made ? `, ${made} new DEG folder${made === 1 ? '' : 's'}` : ''})`);
      }
    } catch (err) {
      const message = err.response?.data?.error || err.message;
      setError(message);
      log('error', `${f}: could not write DEG labels ${formatClock(start)}–${formatClock(end)} (movie): ${message}`);
    }
  }, [onLabels, log, trackJob]);

  const pump = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      while (queue.current.length) {
        const item = queue.current.shift();
        setPending(queue.current.length + 1);
        await send(item);
        setPending(queue.current.length);
      }
    } finally {
      sending.current = false;
      setPending(queue.current.length);
    }
  }, [send]);

  const enqueue = useCallback((item) => {
    const last = queue.current[queue.current.length - 1];
    const same = last && last.fly === item.fly && last.end === item.start
      && JSON.stringify(last.behaviors) === JSON.stringify(item.behaviors);
    if (same) last.end = item.end;          // not sent yet: one write for both
    else queue.current.push(item);
    setError(null);
    setPending(queue.current.length + (sending.current ? 1 : 0));
    pump();
  }, [pump]);

  // the seconds a button acts on: the selection, else the cursor's second
  const target = selection
    || (cursorT != null && track ? [Math.min(track.n - 1, Math.floor(cursorT)), Math.min(track.n, Math.floor(cursorT) + 1)] : null);

  const write = useCallback((behaviors, name) => {
    if (!fly || !target) return;
    enqueue({ fly, start: target[0], end: target[1], behaviors, name });
    setLastLabel({ name: behaviors ? name : NONE, columns: behaviors });
    onSelect(null);
  }, [fly, target, enqueue, onSelect]);

  // ── Label while moving: each second the cursor enters gets lastLabel ──
  const paintedRef = useRef(null);   // last second labelled by moving
  useEffect(() => {
    if (!painting || !lastLabel || cursorT == null || !track || !fly) {
      paintedRef.current = null;
      return;
    }
    const second = Math.max(0, Math.min(track.n - 1, Math.floor(cursorT)));
    const prev = paintedRef.current;
    if (prev === second) return;
    const start = prev != null && second > prev && second - prev <= MAX_FILL ? prev + 1 : second;
    paintedRef.current = second;
    enqueue({ fly, start, end: second + 1, behaviors: lastLabel.columns, name: lastLabel.name, quiet: true });
  }, [painting, lastLabel, cursorT, track, fly, enqueue]);

  const startPainting = () => {
    if (!lastLabel) return;
    setPainting(true);
    log('info', `${fly}: labelling ${lastLabel.name} while the cursor moves`);
  };
  const stopPainting = () => {
    setPainting(false);
    log('info', `${fly}: stopped labelling while moving`);
  };

  const presets = labels ? labels.presets : [];   // [name, columns]

  // ── Keyboard: [ / ] selection start / end at the cursor, Esc drops it,
  //    0–9 preset and Delete clear (the selection, else the cursor's second) ──
  // Subscribed once, reading the current state from a ref: a listener re-added on every
  // render is dropped by the browser when another keydown listener re-renders us first.
  const keyState = useRef({});
  keyState.current = { active, labels, cursorT, track, selection, presets, onSelect, write };
  useEffect(() => {
    const onKey = (e) => {
      const { active, labels, cursorT, track, selection, presets, onSelect, write } = keyState.current;
      if (!active || !labels) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // physical digit row / numpad, so AZERTY layouts need no Shift
      const digit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code)?.[1] ?? (/^[0-9]$/.test(e.key) ? e.key : null);
      const preset = digit != null ? presets.find(([name], i) => keyOf(name, i) === digit) : null;
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
      } else if (preset) {
        e.preventDefault();
        write(preset[1], preset[0]);
      } else if (e.key === 'Delete') {
        e.preventDefault();
        write(null, NONE);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
  const lastStyle = lastLabel ? styleOf(lastLabel.name) : null;

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
          {pending > 0 && <span className="eth-dim"> · writing {pending} label{pending === 1 ? '' : 's'}… (a chunk without DEG folder takes ~30 s, progress in the console)</span>}
        </div>
        <div className="deg-buttons">
          {presets.map(([name, columns], i) => {
            const { label, color } = labelStyleOf(name);
            const key = keyOf(name, i);
            return (
              <button
                key={name}
                onClick={() => write(columns, name)}
                disabled={!target}
                className={lastLabel?.name === name ? 'deg-last' : ''}
                title={`Set ${columns.join(' + ')} to 1 and every other column to 0${key ? ` (key ${key})` : ''}`}
              >
                <span className="eth-swatch" style={{ background: color }} />
                {label}{key && <span className="eth-dim"> {key}</span>}
              </button>
            );
          })}
          <button
            onClick={() => write(null, NONE)}
            disabled={!target}
            className={lastLabel?.name === NONE ? 'deg-last' : ''}
            title="Remove the labels: set the frames back to -1, not labelled (Delete). With Label while moving, removes them as the cursor moves"
          >
            <Swatch style={styleOf(NONE)} />None (remove)<span className="eth-dim"> Del</span>
          </button>
        </div>
        <div className="deg-buttons">
          <button
            onClick={startPainting}
            disabled={!lastLabel || painting}
            className={painting ? 'deg-painting' : ''}
            title={lastLabel
              ? (lastLabel.name === NONE
                ? 'Remove the labels of every second the cursor enters (playing the movie, ←/→); a label key changes it'
                : `Give every second the cursor enters (playing the movie, ←/→) the label ${lastLabel.name}; a label key changes it`)
              : 'Apply a label first: moving then labels with the last one applied'}
          >
            ● Label while moving
          </button>
          <button onClick={stopPainting} disabled={!painting} title="Stop labelling the seconds the cursor enters">
            ■ Stop labelling
          </button>
          {painting ? (
            <span>
              <span className="deg-rec">●</span>{' '}
              {lastLabel.name === NONE
                ? <>each second the cursor enters has its labels <b>removed</b></>
                : <>each second the cursor enters gets <Swatch style={lastStyle} /><b>{lastStyle.label}</b></>}
            </span>
          ) : (
            <span className="eth-dim">
              {lastLabel ? <>last label: <Swatch style={lastStyle} />{lastStyle.label}</> : 'no label applied yet'}
            </span>
          )}
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
              disabled={!target || !custom.length}
            >
              Apply
            </button>
          </div>
        </details>
        {error && <div className="deg-error">{error}</div>}
        <div className="eth-keys">
          <b>Shift+drag</b> on the ethogram: select seconds · <b>[ ]</b> selection start / end at the cursor ·
          <b> 1–{Math.min(9, presets.filter(([n]) => n !== 'background').length)}</b>, <b>0</b> background: label the selection, or the cursor's second without one ·
          <b> Delete</b> None: remove its labels · <b>Esc</b> drop the selection · <b>Label while moving</b>: the movie or ←/→ label each second
          they reach with the last label (a label key switches it).
          Each second writes {framerate} rows of its chunk's labels.csv; missing video folders are made with deepethogram.
        </div>
      </div>
    </div>
  );
}
