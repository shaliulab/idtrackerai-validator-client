// src/icons.js
import React from 'react';
import { ReactComponent as OneBackIcon } from './assets/icons/oneback.svg';
import { ReactComponent as TenBackIcon } from './assets/icons/tenback.svg';
import { ReactComponent as ChunkBackIcon } from './assets/icons/chunkback.svg';

import { ReactComponent as OneForthIcon } from './assets/icons/oneforth.svg';
import { ReactComponent as TenForthIcon } from './assets/icons/tenforth.svg';
import { ReactComponent as ChunkForthIcon } from './assets/icons/chunkforth.svg';

import { ReactComponent as PreviousRejectionIcon } from './assets/icons/previousRejection.svg';
import { ReactComponent as NextRejectionIcon } from './assets/icons/nextRejection.svg';


const OneSecondBackButton = ({ onClick }) => (
    <button className="btn" onClick={onClick}>
      <OneBackIcon />
    </button>
  );
  
  const TenSecondsBackButton = ({ onClick }) => (
    <button className="btn" onClick={onClick}>
      <TenBackIcon/>
    </button>
  );
  
  const ChunkBackButton = ({ onClick }) => (
  <button className="btn" onClick={onClick}>
    <ChunkBackIcon />
  </button>
);


const OneSecondForthButton = ({ onClick }) => (
    <button className="btn" onClick={onClick}>
      <OneForthIcon />
    </button>
  );
  
  
  const TenSecondsForthButton = ({ onClick }) => (
    <button className="btn" onClick={onClick}>
      <TenForthIcon />
    </button>
  );
  
  const ChunkForthButton = ({ onClick }) => (
  <button className="btn" onClick={onClick}>
    <ChunkForthIcon />
  </button>
);

const PreviousRejectionButton = ({ onClick }) => (
  <button className="btn" onClick={onClick}>
    <PreviousRejectionIcon />
  </button>
);


const NextRejectionButton = ({ onClick }) => (
  <button className="btn" onClick={onClick}>
    <NextRejectionIcon />
  </button>
);

  const TogglePlayButton = ({ isPlaying, play, pause }) => {
    const togglePlay = () => {
      if (isPlaying) {
        pause();
      } else {
        play();
      }
    };
  
    return (
      <button className="btn" onClick={togglePlay}>
        <i
          className={`fa ${isPlaying ? 'fa-pause' : 'fa-play'}`}
          style={{ fontSize: '72px', width: '72px', height: '72px' }}
        ></i>
      </button>
    );
  };

export { 
    OneSecondBackButton,TenSecondsBackButton, ChunkBackButton,
    OneSecondForthButton,TenSecondsForthButton, ChunkForthButton,
    NextRejectionButton, PreviousRejectionButton, TogglePlayButton
};
