// slider.js

import React, { useRef, useMemo, useState, useEffect } from 'react';
import _ from 'lodash';
import { CHUNK_SECONDS } from './constants.js';

const Slider = ({ isPlaying, recordingFramerate, frameNumber, setFrameNumber, minFrame, maxFrame }) => {
    const isDragging = useRef(false);

    // useMemo, not useCallback: lodash returns a wrapped function whose
    // dependencies ESLint cannot see, which is what the warning was about.
    // The debounced function is created once per setFrameNumber identity.
    const debouncedSetFrameNumber = useMemo(
        () => _.debounce((value) => {
            const parsed = parseInt(value, 10);
            if (!Number.isNaN(parsed)) setFrameNumber(parsed);
        }, 50),
        [setFrameNumber],
    );

    // Cancel any pending call when the component unmounts or the debounced
    // function is replaced, so a late invocation cannot set state afterwards.
    useEffect(() => () => debouncedSetFrameNumber.cancel(), [debouncedSetFrameNumber]);

    const fr = recordingFramerate || 47;
    const min_fn = minFrame ?? 20 * fr * CHUNK_SECONDS;   // ?? keeps a valid 0
    const max_fn = maxFrame ?? 400 * fr * CHUNK_SECONDS;

    const clamped = Math.min(Math.max(frameNumber, min_fn), max_fn);

    // While dragging, the thumb follows the pointer immediately. Without this
    // the input is controlled by `frameNumber`, which only updates 50ms after
    // the last movement — so the thumb visibly lags and snaps back mid-drag.
    const [dragValue, setDragValue] = useState(null);
    const value = dragValue ?? clamped;

    // Drop the local value once the parent has caught up, so external changes
    // (playback, keyboard shortcuts, jump-to-frame) move the thumb again.
    useEffect(() => {
        if (!isDragging.current) setDragValue(null);
    }, [frameNumber]);

    const endDrag = () => {
        isDragging.current = false;
        debouncedSetFrameNumber.flush();   // apply the final position at once
        setDragValue(null);
    };

    return (
        <input
            style={{ width: '100%' }}
            type="range"
            min={min_fn}
            max={max_fn}
            value={value}
            disabled={isPlaying}
            onChange={(e) => {
                const next = Number(e.target.value);
                setDragValue(next);
                if (!isPlaying) debouncedSetFrameNumber(next);
            }}
            onPointerDown={() => { isDragging.current = true; }}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={(e) => e.stopPropagation()}
        />
    );
};

export default Slider;