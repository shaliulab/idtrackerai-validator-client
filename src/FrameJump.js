// FrameJump.js  —  Frame and Chunk inputs that go to any frame of the recording, whether
// or not it has tracking (unlike the blobs table's inputs, which exist per detected fly).
import React, { useRef, useState } from 'react';
import { useConsole } from './MessageConsole';

// Shows `value` until focused; the typed number is applied on Enter or leaving the field,
// so typing 1234 does not load frames 1, 12 and 123 on the way. Esc drops it.
const JumpInput = ({ label, value, onCommit, disabled, title }) => {
  const [draft, setDraft] = useState(null);
  const cancelled = useRef(false);
  return (
    <label className="field frame-jump-field" title={title}>{label}
      <input
        type="number"
        min={0}
        disabled={disabled}
        value={draft ?? value ?? ''}
        onFocus={(e) => { setDraft(String(value ?? '')); e.target.select(); }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = parseInt(draft, 10);
          if (!cancelled.current && Number.isFinite(n) && n >= 0 && n !== value) onCommit(n);
          cancelled.current = false;
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.target.blur();
          else if (e.key === 'Escape') { cancelled.current = true; e.target.blur(); }
        }}
        onWheel={(e) => e.target.blur()}
      />
    </label>
  );
};

// min, max: frames of the recording, when known; numbers outside go to the nearest one.
const FrameJump = ({ frameNumber, chunksize, min, max, onSeek, disabled }) => {
  const { log } = useConsole();
  const seek = (n) => {
    const clamped = Math.min(Math.max(n, min ?? 0), max ?? Infinity);
    if (clamped !== n) log('warning', `Frame ${n} is outside the recording (frames ${min}–${max}): going to ${clamped}`);
    onSeek(clamped);
  };
  const chunk = chunksize > 0 && frameNumber != null ? Math.floor(frameNumber / chunksize) : null;
  return (
    <span className="frame-jump">
      <JumpInput label="Frame" value={frameNumber} disabled={disabled} onCommit={seek}
                 title="Go to this frame number (Enter), with or without tracking" />
      <JumpInput label="Chunk" value={chunk} disabled={disabled || !(chunksize > 0)}
                 onCommit={(c) => seek(c * chunksize)}
                 title="Go to the first frame of this chunk (Enter), with or without tracking" />
    </span>
  );
};

export default FrameJump;
