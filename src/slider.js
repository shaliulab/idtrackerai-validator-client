import React, { useState, useCallback, useRef, useEffect } from 'react';
import _ from 'lodash';
import { MIN_FN, MAX_FN } from './constants.js'

const Slider = ({ isPlaying, frameNumber, setFrameNumber, sliderWidth }) => {
    const [updateFromSlider, setUpdateFromSlider] = useState(true);

    // const debouncedSetFrameNumber = useCallback(
    //     _.debounce(setFrameNumber, 300),
    //     [] // debounce time
    //   );


    const debouncedSetFrameNumber = useCallback(
        _.debounce((value) => setFrameNumber(value), 300), 
        [setFrameNumber]
    );

    // const debouncedSetFrameNumber = useRef(_.debounce((value) => setFrameNumber(value), 300));

    // useEffect(() => {
    //     return () => {
    //         debouncedSetFrameNumber.current.cancel();
    //     }
    // }, []);


    const watchSlider = (value) => {
        if (!isPlaying && updateFromSlider) {
            debouncedSetFrameNumber(value)
        }
    };
    return(
        <input  style={{ width: sliderWidth }}  type="range" min={MIN_FN.toString()} max={MAX_FN.toString()} value={frameNumber}
            onChange={e => watchSlider(e.target.value)}
            onMouseDown={() => setUpdateFromSlider(true)}
            onMouseUp={() => setUpdateFromSlider(false)}        
    />
    )
};

export default Slider