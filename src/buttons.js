import React from 'react';
import {get_prev_chunk, get_next_chunk, get_chunk_back, get_chunk_forward, get_10seconds_back, get_10seconds_forward } from './utils';
import axios from 'axios';


const Buttons = ( {frameNumber, setFrameNumber, setIsPlaying} ) => {
    
    const play = () => {
      setIsPlaying(true);
    };
    
    const stop = () => {
      setIsPlaying(false);
    };
    
    const next_error = () => {
      axios.get(`http://localhost:5000/api/next_error/${parseInt(frameNumber)}`)
      .then(response => {
        setFrameNumber(response.data["frame_number"]);  
      });
    };

    const prev_error = () => {
      axios.get(`http://localhost:5000/api/prev_error/${parseInt(frameNumber)}`)
      .then(response => {
        setFrameNumber(response.data["frame_number"]);  
      })
    };

    const chunk_back = () => {
      setFrameNumber(get_chunk_back(frameNumber));
    };
    
    const chunk_forward = () => {
      setFrameNumber(get_chunk_forward(frameNumber));
    };
    
    const prev_chunk = () => {
        setFrameNumber(get_prev_chunk(frameNumber));
    };
    
    const next_chunk = () => {
      setFrameNumber(get_next_chunk(frameNumber));
    };
    
    const prev_frame = () => {
      setFrameNumber(prevFrameNumber => prevFrameNumber-1);
    };
    
    const next_frame = () => {
      setFrameNumber(prevFrameNumber => prevFrameNumber+1);
    };

    const seconds10_back = () => {
      setFrameNumber(get_10seconds_back(frameNumber));
    };
    
    const seconds10_forward = () => {
      setFrameNumber(get_10seconds_forward(frameNumber));
    };
    


    return(
      <div>
          <button onClick={chunk_back}>One chunk back</button>
          <button onClick={chunk_forward}>One chunk forward</button>
          <button onClick={prev_chunk}>Previous chunk</button>
          <button onClick={next_chunk}>Next chunk</button>
          <button onClick={prev_frame}>Previous frame</button>
          <button onClick={next_frame}>Next frame</button>
          <button onClick={seconds10_back}>Back 10 seconds</button>
          <button onClick={seconds10_forward}>Forward 10 seconds</button>
          <button onClick={prev_error}>Previous error</button>
          <button onClick={next_error}>Next error</button>
          <button onClick={play}>Play</button>
          <button onClick={stop}>Stop</button>
      </div>
    );
};

export default Buttons;