// buttons.js
import React, { useEffect } from 'react';
import {
  get_prev_chunk,
  get_next_chunk,
  get_chunk_back,
  get_chunk_forward,
  get_30seconds_back,
  get_30seconds_forward,
  get_10seconds_back,
  get_10seconds_forward,
  get_1seconds_back,
  get_1seconds_forward
} from './utils';
import api from './api';
import { 
  ChunkBackButton, 
  ThirtySecondsBackButton, 
  TenSecondsBackButton, 
  OneSecondBackButton, 
  ChunkForthButton, 
  ThirtySecondsForthButton, 
  TenSecondsForthButton, 
  OneSecondForthButton, 
  PreviousRejectionButton, 
  NextRejectionButton, 
  TogglePlayButton 
} from './icons';

const Buttons = ({ frameNumber, setFrameNumber, isPlaying, setIsPlaying, requestQueue, recordingFramerate }) => {
  const frameRate = recordingFramerate;

  const play = () => {
    setFrameNumber(frameNumber);
    setIsPlaying(true);
  };
    
  const pause = () => {
    setIsPlaying(false);
    requestQueue.cancelAll();
  };
  
  const prev_chunk = () => {
    if (frameRate == null) return;
    setFrameNumber((prev) => get_prev_chunk(prev, frameRate));
  };
    
  const next_chunk = () => {
    if (frameRate == null) return;
    setFrameNumber((prev) => get_next_chunk(prev, frameRate));
  };
  
  const seconds1_back = () => {
    if (frameRate == null) return;
    setFrameNumber((prev) => get_1seconds_back(prev, frameRate));
  };
    
  const seconds1_forward = () => {
    if (frameRate == null) return;
    setFrameNumber((prev) => get_1seconds_forward(prev, frameRate));
  };

  const seconds10_back = () => {
    if (frameRate == null) return;
    setFrameNumber((prev) => get_10seconds_back(prev, frameRate));
  };
    
  const seconds10_forward = () => {
    if (frameRate == null) return;
    setFrameNumber((prev) => get_10seconds_forward(prev, frameRate));
  };
  
  const seconds30_back = () => {
    if (frameRate == null) return;
    setFrameNumber((prev) => get_30seconds_back(prev, frameRate));
  };
    
  const seconds30_forward = () => {
    if (frameRate == null) return;
    setFrameNumber((prev) => get_30seconds_forward(prev, frameRate));
  };

  const prev_rejection = () => {
    api.get(`/api/prev_rejection/${parseInt(frameNumber, 10)}`)
      .then((response) => {
        const data =
          typeof response.data === 'string'
            ? JSON.parse(response.data)
            : response.data;
        if (data?.frame_number != null) setFrameNumber(data.frame_number);
      })
      .catch((error) => {
        console.error('Error fetching previous rejection:', error);
      });
  };

  const next_rejection = () => {
    api.get(`/api/next_rejection/${parseInt(frameNumber, 10)}`)
      .then((response) => {
        const data =
          typeof response.data === 'string'
            ? JSON.parse(response.data)
            : response.data;
        if (data?.frame_number != null) setFrameNumber(data.frame_number);
      })
      .catch((error) => {
        console.error('Error fetching next rejection:', error);
      });
  };

  // Keyboard shortcuts
  // Deps are the values the handlers actually close over: everything else is
  // either an updater-form setState or a stable prop.
  useEffect(() => {
    const handleKeyDown = (event) => {
      const tag = event.target.tagName.toLowerCase();
      const editable = event.target.isContentEditable;
      
      if (tag === 'input' || tag === 'textarea' || editable) {
        return;
      }
    
      switch (event.key) {
        case '1':
          prev_chunk();
          break;
        case '2':
          seconds10_back();
          break;
        case '3':
          seconds1_back();
          break;
        case '4':
          isPlaying ? pause() : play();
          break;
        case '5':
          seconds1_forward();
          break;
        case '6':
          seconds10_forward();
          break;
        case '7':
          next_chunk();
          break;
        case '8':
          prev_rejection();
          break;
        case '9':
          next_rejection();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, frameNumber, frameRate]);

  return (
    <div className="button-group">
      <ChunkBackButton onClick={prev_chunk} />
      <ThirtySecondsBackButton onClick={seconds30_back} />
      <TenSecondsBackButton onClick={seconds10_back} />
      <OneSecondBackButton onClick={seconds1_back} />
      <TogglePlayButton isPlaying={isPlaying} play={play} pause={pause} />
      <OneSecondForthButton onClick={seconds1_forward} />
      <TenSecondsForthButton onClick={seconds10_forward} />
      <ThirtySecondsForthButton onClick={seconds30_forward} />
      <ChunkForthButton onClick={next_chunk} />
      <PreviousRejectionButton onClick={prev_rejection} />
      <NextRejectionButton onClick={next_rejection} />
    </div>
  );
};

export default Buttons;