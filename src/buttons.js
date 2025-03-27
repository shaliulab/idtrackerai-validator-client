import React from 'react';
import {
  get_prev_chunk,
  get_next_chunk,
  get_chunk_back,
  get_chunk_forward,
  get_10seconds_back,
  get_10seconds_forward,
  get_1seconds_back,
  get_1seconds_forward
} from './utils';
import axios from 'axios';
import { BACKEND_SERVER } from './constants';
import { BACKEND_PORT } from './constants';
import { ChunkBackButton, TenSecondsBackButton, OneSecondBackButton, ChunkForthButton, TenSecondsForthButton, OneSecondForthButton, PreviousRejectionButton, NextRejectionButton, TogglePlayButton } from './icons'; // Updated import

const Buttons = ({ frameNumber, setFrameNumber, isPlaying, setIsPlaying, requestQueue }) => {
  
  const play = () => {
    setFrameNumber(frameNumber);
    setIsPlaying(true);
  };
    
  const pause = () => {
    setIsPlaying(false);
    requestQueue.cancelAll();
  };
    
  const close = () => {
    axios
      .post(`http://${BACKEND_SERVER}:${BACKEND_PORT}/shutdown`)
      .then(response => {
        const message = response.data["message"];
        console.log(message);
      });
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

  const prev_rejection = () => {
    axios.get(`http://${BACKEND_SERVER}:${BACKEND_PORT}/api/prev_rejection/${parseInt(frameNumber)}`)
    .then(response => {
      setFrameNumber(response.data["frame_number"]);  
    });
  };

  const next_rejection = () => {
    axios.get(`http://${BACKEND_SERVER}:${BACKEND_PORT}/api/next_rejection/${parseInt(frameNumber)}`)
    .then(response => {
      setFrameNumber(response.data["frame_number"]);  
    });
  };
 
 
    
  return (
    <div className="button-group">
      <ChunkBackButton onClick={prev_chunk} />
      <TenSecondsBackButton onClick={seconds10_back}/>
      <OneSecondBackButton onClick={seconds1_back}/>
      <TogglePlayButton isPlaying={isPlaying} play={play} pause={pause} />
      <OneSecondForthButton onClick={seconds1_forward}/>
      <TenSecondsForthButton onClick={seconds10_forward}/>
      <ChunkForthButton onClick={next_chunk} />
      <PreviousRejectionButton onClick={prev_rejection}/>
      <NextRejectionButton onClick={next_rejection}/>
    </div>
  );
};

export default Buttons;
