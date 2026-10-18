// src/icons.js
import React from 'react';
import OneBackIcon from './assets/icons/oneback.svg?react';
import TenBackIcon from './assets/icons/tenback.svg?react';
import ThirtyBackIcon from './assets/icons/thirtyback.svg?react';
// import ThirtyBackIcon from './assets/icons/tenback.svg?react';
import ChunkBackIcon from './assets/icons/chunkback.svg?react';

import OneForthIcon from './assets/icons/oneforth.svg?react';
import TenForthIcon from './assets/icons/tenforth.svg?react';
import ThirtyForthIcon from './assets/icons/thirtyforth.svg?react';
// import ThirtyForthIcon from './assets/icons/tenforth.svg?react';
import ChunkForthIcon from './assets/icons/chunkforth.svg?react';

import PreviousRejectionIcon from './assets/icons/previousRejection.svg?react';
import NextRejectionIcon from './assets/icons/nextRejection.svg?react';


// One icon button of the transport bar; `title` names the action and its key.
const iconButton = (Icon, title) => {
  const IconButton = ({ onClick }) => (
    <button className="icon-btn" onClick={onClick} title={title}>
      <Icon />
    </button>
  );
  IconButton.displayName = `IconButton(${title})`;
  return IconButton;
};

const ChunkBackButton = iconButton(ChunkBackIcon, 'Previous chunk (1)');
const ThirtySecondsBackButton = iconButton(ThirtyBackIcon, 'Back 30 s');
const TenSecondsBackButton = iconButton(TenBackIcon, 'Back 10 s (2)');
const OneSecondBackButton = iconButton(OneBackIcon, 'Back 1 s (3)');
const OneSecondForthButton = iconButton(OneForthIcon, 'Forward 1 s (5)');
const TenSecondsForthButton = iconButton(TenForthIcon, 'Forward 10 s (6)');
const ThirtySecondsForthButton = iconButton(ThirtyForthIcon, 'Forward 30 s');
const ChunkForthButton = iconButton(ChunkForthIcon, 'Next chunk (7)');
const PreviousRejectionButton = iconButton(PreviousRejectionIcon, 'Previous rejection (8)');
const NextRejectionButton = iconButton(NextRejectionIcon, 'Next rejection (9)');

const TogglePlayButton = ({ isPlaying, play, pause }) => (
  <button
    className="icon-btn primary"
    onClick={isPlaying ? pause : play}
    title={`${isPlaying ? 'Pause' : 'Play'} (4 or middle click on the frame)`}
  >
    <i className={`fa ${isPlaying ? 'fa-pause' : 'fa-play'}`} />
  </button>
);

export { 
    OneSecondBackButton,TenSecondsBackButton, ThirtySecondsBackButton, ChunkBackButton,
    OneSecondForthButton,TenSecondsForthButton, ThirtySecondsForthButton, ChunkForthButton,
    NextRejectionButton, PreviousRejectionButton, TogglePlayButton
};
