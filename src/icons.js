// src/icons.js
import React from 'react';
import { ReactComponent as OneBackIcon } from './assets/icons/oneback.svg';
import { ReactComponent as TenBackIcon } from './assets/icons/tenback.svg';
import { ReactComponent as ThirtyBackIcon } from './assets/icons/thirtyback.svg';
// import { ReactComponent as ThirtyBackIcon } from './assets/icons/tenback.svg';
import { ReactComponent as ChunkBackIcon } from './assets/icons/chunkback.svg';

import { ReactComponent as OneForthIcon } from './assets/icons/oneforth.svg';
import { ReactComponent as TenForthIcon } from './assets/icons/tenforth.svg';
import { ReactComponent as ThirtyForthIcon } from './assets/icons/thirtyforth.svg';
// import { ReactComponent as ThirtyForthIcon } from './assets/icons/tenforth.svg';
import { ReactComponent as ChunkForthIcon } from './assets/icons/chunkforth.svg';

import { ReactComponent as PreviousRejectionIcon } from './assets/icons/previousRejection.svg';
import { ReactComponent as NextRejectionIcon } from './assets/icons/nextRejection.svg';


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
