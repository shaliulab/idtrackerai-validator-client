import React, { useState, useCallback } from 'react';
import _ from 'lodash';
import { MIN_FN, MAX_FN } from './constants.js'

const Slider = ({ isPlaying, frameNumber, setFrameNumber, sliderWidth }) => {
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

    return(
        <input  style={{ width: sliderWidth }}  type="range" min={MIN_FN.toString()} max={MAX_FN.toString()}
            value={frameNumber}
            onChange={e => watchSlider(e.target.value)}
            onMouseDown={() => setUpdateFromSlider(true)}
            onMouseUp={() => setUpdateFromSlider(false)}        
    />
    )
};

export default Slider

