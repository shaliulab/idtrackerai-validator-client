import React, { useRef, useCallback } from 'react';
import _ from 'lodash';
import { CHUNK_SECONDS } from './constants.js'


const Slider = ({ isPlaying, recordingFramerate, frameNumber, setFrameNumber, minFrame, maxFrame }) => {
    const isDragging = useRef(false);

    const debouncedSetFrameNumber = useCallback(
        _.debounce((value) => {
            if (!isNaN(value)) {
                setFrameNumber(parseInt(value));
            }
        }, 50),
        [setFrameNumber]
    );

    const fr = recordingFramerate || 47;
    const min_fn = minFrame ?? 20 * fr * CHUNK_SECONDS;   // ?? keeps a valid 0
    const max_fn = maxFrame ?? 400 * fr * CHUNK_SECONDS;

    const value = Math.min(Math.max(frameNumber, min_fn), max_fn);

    return (
        <input
            style={{ width: '100%' }}
            type="range"
            min={min_fn.toString()}
            max={max_fn.toString()}
            value={value}
            onChange={e => {
                if (!isPlaying) debouncedSetFrameNumber(e.target.value);
            }}
            onMouseDown={() => { isDragging.current = true; }}
            onMouseUp={() => { isDragging.current = false; }}
        />
    );
};

export default Slider

