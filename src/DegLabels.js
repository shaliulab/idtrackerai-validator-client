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
//
// Undo (Ctrl+Z) goes through the same queue and restores the rows of the fly's last
// action (POST .../deg_labels/undo, kept by the server until it restarts). Each label
// applied is one action, sent as `action` with its writes; the seconds Label while
// moving paints join the action of the label it paints with (a new one when started).
// Redo (Ctrl+Y, Ctrl+Shift+Z) writes the last undone action again, until a new label.
//
// "Make DEG videos" premakes the folders of the cursor's chunk and the N chunks before or
// after it (POST .../deg_videos, a job), so labelling there does not wait for deepethogram.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from './api';
import { useConsole } from './MessageConsole';
import { labelStyleOf, formatClock, formatDuration } from './EthogramTrack';

const API = '/api/ethogram';
// While labelling on the move, a jump forward of at most this many seconds (fast playback,
// Shift+→) also labels the seconds skipped; longer jumps label only the second reached.
const MAX_FILL = 10;
const MAX_PREMAKE = 50;   // deg_labels.MAX_PREMAKE

const storedPremake = () => {
  try { return Math.max(1, Math.min(MAX_PREMAKE, parseInt(localStorage.getItem('fh-deg-premake'), 10) || 3)); }
  catch { return 3; }
};

let actionCount = 0;
const newAction = () => `${Date.now().toString(36)}-${(actionCount += 1)}`;

const unwrap = (data) => (typeof data === 'string' ? JSON.parse(data) : data);

// key of the i-th preset: background on 0, the others 1, 2, ... in order
const keyOf = (name, i) => (name === 'background' ? '0' : i < 9 ? String(i + 1) : null);

// keys typed into a text / number field are not shortcuts; a focused fly dropdown or
// checkbox (focus stays there after a click) must not swallow the label keys
const NOT_TYPED = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file']);
const isTyping = (el) => !!el && (el.tagName === 'TEXTAREA' || el.isContentEditable
  || (el.tagName === 'INPUT' && !NOT_TYPED.has(el.type)));

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
  const [premakeN, setPremakeN] = useState(storedPremake);   // chunks to premake on one side
  const [premaking, setPremaking] = useState(false);

  useEffect(() => {
    try { localStorage.setItem('fh-deg-premake', String(premakeN)); } catch { /* ignore */ }
  }, [premakeN]);

  useEffect(() => { setError(null); setCustom([]); setPainting(false); }, [fly]);

  // ── Write queue ──
  const flyRef = useRef(fly);        // the fly shown now (the queue may outlive a switch)
  flyRef.current = fly;
  const queue = useRef([]);          // { fly, start, end, behaviors, name, action, quiet } or { fly, step: 'undo' | 'redo' }
  const sending = useRef(false);
  const actionRef = useRef(null);    // action of the last label applied

  const sendStep = useCallback(async (f, step) => {
    try {
      const result = unwrap((await api.post(`${API}/${f}/deg_labels/${step}`)).data);
      if (f === flyRef.current) onLabels(result);
      const { start, end, behaviors } = result[step === 'undo' ? 'undone' : 'redone'];
      log('info', `${f}: ${step === 'undo' ? 'undid' : 'redid'} ${behaviors ? `label ${behaviors.join('+')}` : 'label removal'}`
        + ` of ${formatClock(start)}–${formatClock(end)} (movie)`);
    } catch (err) {
      const message = err.response?.data?.error || err.message;
      setError(message);
      log('error', `${f}: could not ${step}: ${message}`);
    }
  }, [onLabels, log]);

  const send = useCallback(async ({ fly: f, start, end, behaviors, name, action, quiet, step }) => {
    if (step) return sendStep(f, step);
    try {
      const response = await api.post(`${API}/${f}/deg_labels`, { start, end, behaviors, action });
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
  }, [onLabels, log, trackJob, sendStep]);

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
    const same = last && !last.step && !item.step && last.fly === item.fly && last.end === item.start
      && last.action === item.action && JSON.stringify(last.behaviors) === JSON.stringify(item.behaviors);
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
    actionRef.current = newAction();
    enqueue({ fly, start: target[0], end: target[1], behaviors, name, action: actionRef.current });
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
    enqueue({ fly, start, end: second + 1, behaviors: lastLabel.columns, name: lastLabel.name,
              action: actionRef.current, quiet: true });
  }, [painting, lastLabel, cursorT, track, fly, enqueue]);

  const startPainting = () => {
    if (!lastLabel) return;
    actionRef.current = newAction();
    setPainting(true);
    log('info', `${fly}: labelling ${lastLabel.name} while the cursor moves`);
  };
  const stopPainting = () => {
    setPainting(false);
    log('info', `${fly}: stopped labelling while moving`);
  };

  // Undo / redo the last action (after the writes queued before it). Moving would label
  // again at once, so they also stop Label while moving.
  const history = useCallback((step) => {
    if (!fly) return;
    if (painting) {
      setPainting(false);
      log('info', `${fly}: stopped labelling while moving`);
    }
    actionRef.current = null;
    enqueue({ fly, step });
  }, [fly, painting, enqueue, log]);
  const undo = useCallback(() => history('undo'), [history]);
  const redo = useCallback(() => history('redo'), [history]);

  // ── Premake the DEG videos of the cursor's chunk and N chunks before / after it ──
  const premake = async (direction) => {
    if (!fly || cursorT == null) return;
    const f = fly;
    setPremaking(true);
    try {
      const response = await api.post(`${API}/${f}/deg_videos`,
        { t: Math.floor(cursorT), n: premakeN, direction });
      const job = await trackJob(unwrap(response.data));
      if (job.status !== 'done') throw new Error(job.error || `job ${job.status}`);
      const { chunks, made } = job.result;
      if (f === flyRef.current) onLabels(job.result);
      const failed = job.items.filter((item) => item.status === 'skipped' && item.error !== 'already made');
      log(failed.length ? 'warning' : 'info',
        `${f}: DEG videos of chunks ${chunks[0]}–${chunks[chunks.length - 1]}: ${made.length} made,`
        + ` ${chunks.length - made.length - failed.length} already there`
        + (failed.length ? `, ${failed.length} not possible (${failed.map((item) => item.error).join('; ')})` : ''));
    } catch (err) {
      const message = err.response?.data?.error || err.message;
      setError(message);
      log('error', `${f}: could not make DEG videos: ${message}`);
    } finally {
      setPremaking(false);
    }
  };

  const presets = labels ? labels.presets : [];   // [name, columns]

  // ── Keyboard: [ / ] selection start / end at the cursor, Esc drops it,
  //    0–9 preset and Delete clear (the selection, else the cursor's second) ──
  // Subscribed once, reading the current state from a ref: a listener re-added on every
  // render is dropped by the browser when another keydown listener re-renders us first.
  const keyState = useRef({});
  keyState.current = { active, labels, cursorT, track, selection, presets, onSelect, write, undo, redo };
  useEffect(() => {
    const onKey = (e) => {
      const { active, labels, cursorT, track, selection, presets, onSelect, write, undo, redo } = keyState.current;
      if (!active || !labels) return;
      if (isTyping(e.target)) return;
      if (e.ctrlKey && !e.metaKey && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'z' || key === 'y') {
          e.preventDefault();
          if (key === 'z' && !e.shiftKey) undo();
          else redo();
          return;
        }
      }
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
        <button onClick={undo} disabled={!labels.undo && !pending}
                title={labels.undo
                  ? `Undo the last label applied (Ctrl+Z): ${labels.undo.behaviors ? labels.undo.behaviors.join(' + ') : 'removal'}`
                    + ` of ${zt(labels.undo.start)} – ${zt(labels.undo.end)}; ${labels.undo.actions} action${labels.undo.actions === 1 ? '' : 's'}`
                    + ' can be undone (until the server restarts)'
                  : 'Nothing to undo (Ctrl+Z)'}>
          ↶ Undo{labels.undo?.actions > 1 ? <span className="eth-dim"> {labels.undo.actions}</span> : null}
        </button>
        <button onClick={redo} disabled={!labels.redo && !pending}
                title={labels.redo
                  ? `Redo the last label undone (Ctrl+Y or Ctrl+Shift+Z): ${labels.redo.behaviors ? labels.redo.behaviors.join(' + ') : 'removal'}`
                    + ` of ${zt(labels.redo.start)} – ${zt(labels.redo.end)}; ${labels.redo.actions} action${labels.redo.actions === 1 ? '' : 's'}`
                    + ' can be redone (until a new label is applied)'
                  : 'Nothing to redo (Ctrl+Y or Ctrl+Shift+Z)'}>
          ↷ Redo{labels.redo?.actions > 1 ? <span className="eth-dim"> {labels.redo.actions}</span> : null}
        </button>
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
        <div className="deg-buttons">
          <span>Make DEG videos of the cursor's chunk and</span>
          <input
            type="number" className="deg-premake-n" min={1} max={MAX_PREMAKE} step={1} value={premakeN}
            onChange={(e) => setPremakeN(Math.max(1, Math.min(MAX_PREMAKE, parseInt(e.target.value, 10) || 1)))}
            title={`Number of chunks (1–${MAX_PREMAKE}); each new DEG folder takes ~30 s`}
          />
          <span>chunk{premakeN === 1 ? '' : 's'}</span>
          <button onClick={() => premake('before')} disabled={premaking || cursorT == null}
                  title="Make the missing DEG video folders of the cursor's chunk and the chunks before it (progress in the console)">
            ◀ before
          </button>
          <button onClick={() => premake('after')} disabled={premaking || cursorT == null}
                  title="Make the missing DEG video folders of the cursor's chunk and the chunks after it (progress in the console)">
            after ▶
          </button>
          {premaking && <span className="eth-dim">making DEG videos… (progress in the console)</span>}
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
          <b> Delete</b> None: remove its labels · <b>Ctrl+Z</b> / <b>Ctrl+Y</b> undo / redo the last label applied · <b>Esc</b> drop the selection · <b>Label while moving</b>: the movie or ←/→ label each second
          they reach with the last label (a label key switches it).
          Each second writes {framerate} rows of its chunk's labels.csv; missing video folders are made with deepethogram.
        </div>
      </div>
    </div>
  );
}
