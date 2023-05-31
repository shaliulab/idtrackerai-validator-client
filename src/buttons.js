import React from 'react';
import {
  get_prev_chunk, get_next_chunk, get_chunk_back, get_chunk_forward,
  get_10seconds_back, get_10seconds_forward, get_1seconds_back, get_1seconds_forward } from './utils';
import axios from 'axios';
import { BACKEND_SERVER } from './constants'

const Buttons = ( {frameNumber, setFrameNumber, setIsPlaying, requestQueue } ) => {
    
    const play = () => {
      setFrameNumber(frameNumber);
      setIsPlaying(true);
    };
    
    const stop = () => {
      setIsPlaying(false);
      requestQueue.cancelAll();
    };
    
    const next_error = () => {
      axios.get(`http://${BACKEND_SERVER}:5000/api/next_error/${parseInt(frameNumber)}`)
      .then(response => {
        setFrameNumber(response.data["frame_number"]);  
      });
    };

    const prev_error = () => {
      axios.get(`http://${BACKEND_SERVER}:5000/api/prev_error/${parseInt(frameNumber)}`)
      .then(response => {
        setFrameNumber(response.data["frame_number"]);  
      })
    };

    const next_ok = () => {
      axios.get(`http://${BACKEND_SERVER}:5000/api/next_ok/${parseInt(frameNumber)}`)
      .then(response => {
        const frame_number = response.data["frame_number"]
        if(frame_number == null) {
          console.log("No next ok")
        } else {
          setFrameNumber(frame_number);  
        }
      })
    };
    const prev_ok = () => {
      axios.get(`http://${BACKEND_SERVER}:5000/api/prev_ok/${parseInt(frameNumber)}`)
      .then(response => {
        const frame_number = response.data["frame_number"]
        if(frame_number == null) {
          console.log("No prev ok")
        } else {
          setFrameNumber(frame_number);  
        }
      })
    };

    const next_ai = () => {
      axios.get(`http://${BACKEND_SERVER}:5000/api/next_ai/${parseInt(frameNumber)}`)
      .then(response => {
        console.log(response.data["ai"]);
        setFrameNumber(response.data["frame_number"]);
      });
    };

    const prev_ai = () => {
      axios.get(`http://${BACKEND_SERVER}:5000/api/prev_ai/${parseInt(frameNumber)}`)
      .then(response => {
        console.log(response.data["ai"]);
        setFrameNumber(response.data["frame_number"]);
      })
    };
    
    const close = () => {
      axios.post(`http://${BACKEND_SERVER}:5000/shutdown`)
      .then(response => {
        const message=response.data["message"];
        console.log(message);
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
      setFrameNumber(prevFrameNumber => parseInt(prevFrameNumber)-1);
    };
    
    const next_frame = () => {
      setFrameNumber(prevFrameNumber => parseInt(prevFrameNumber)+1);
    };

    const seconds1_back = () => {
      setFrameNumber(get_1seconds_back(frameNumber));
    };
    
    const seconds1_forward = () => {
      setFrameNumber(get_1seconds_forward(frameNumber));
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
          <button onClick={seconds1_back}>Back 1 second</button>
          <button onClick={seconds1_forward}>Forward 1 second</button>
          <button onClick={prev_error}>Previous error</button>
          <button onClick={next_error}>Next error</button>
          <button onClick={prev_ok}>Previous OK</button>
          <button onClick={next_ok}>Next OK</button>
          <button onClick={prev_ai}>Previous AI</button>
          <button onClick={next_ai}>Next AI</button>
          <button onClick={play}>Play</button>
          <button onClick={stop}>Stop</button>
          <button onClick={close}>Close</button>
      </div>
    );
};

export default Buttons;