import React, { useRef, useCallback } from 'react';
import _ from 'lodash';
import { CHUNK_SECONDS } from './constants.js'


const Slider = ({ isPlaying, recordingFramerate, frameNumber, setFrameNumber }) => {
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
    const min_fn = 20 * fr * CHUNK_SECONDS;
    const max_fn = 400 * fr * CHUNK_SECONDS;

    return (
        <input
            style={{ width: '100%' }}
            type="range"
            min={min_fn.toString()}
            max={max_fn.toString()}
            value={frameNumber}
            onChange={e => {
                if (!isPlaying) debouncedSetFrameNumber(e.target.value);
            }}
            onMouseDown={() => { isDragging.current = true; }}
            onMouseUp={() => { isDragging.current = false; }}
        />
    );
};

export default Slider

