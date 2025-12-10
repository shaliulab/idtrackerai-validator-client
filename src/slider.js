import React, { useState, useCallback } from 'react';
import _ from 'lodash';
import { CHUNK_SECONDS } from './constants.js'


const Slider = ({ isPlaying, recordingFramerate, frameNumber, setFrameNumber, sliderWidth }) => {
    const [updateFromSlider, setUpdateFromSlider] = useState(true);

    const debouncedSetFrameNumber = useCallback(
        
        _.debounce((value) => {
            if (!isNaN(value)) {
            const value_int = parseInt(value);
            console.log(value_int);
            setFrameNumber(value_int);
          }
        }, 50), 
        [setFrameNumber]
    );

    const watchSlider = (value) => {
        if (!isPlaying && updateFromSlider) {
            debouncedSetFrameNumber(value)
        }
    };


    const min_fn = 20*recordingFramerate*CHUNK_SECONDS;
    const max_fn = 400*recordingFramerate*CHUNK_SECONDS;
    
    return(
        <input  style={{ width: sliderWidth }}  type="range" min={min_fn.toString()} max={max_fn.toString()}
            value={frameNumber}
            onChange={e => watchSlider(e.target.value)}
            onMouseDown={() => setUpdateFromSlider(true)}
            onMouseUp={() => setUpdateFromSlider(false)}        
    />
    )
};

export default Slider

