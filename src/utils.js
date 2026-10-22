// utils.js
import { CHUNK_SECONDS } from './constants.js';

const toInt = (value) => Number.parseInt(value, 10);

const getChunkSize = (recordingFramerate) => recordingFramerate * CHUNK_SECONDS;

// Keep navigation inside the experiment's tracked frames (/api/frame_range);
// unbounded while the range is unknown.
const clampToRange = (n, range) =>
  Math.min(Math.max(n, range?.min ?? 0), range?.max ?? Infinity);

export const get_prev_chunk = (value, recordingFramerate, range) => {
  const chunksize = getChunkSize(recordingFramerate);
  return clampToRange(chunksize * Math.floor(toInt(value) / chunksize) - chunksize, range);
};

export const get_next_chunk = (value, recordingFramerate, range) => {
  const chunksize = getChunkSize(recordingFramerate);
  return clampToRange(chunksize * Math.floor(toInt(value) / chunksize) + chunksize, range);
};

const shiftSeconds = (seconds) => (value, recordingFramerate, range) =>
  clampToRange(Math.round(toInt(value) + recordingFramerate * seconds), range);

export const get_1seconds_back = shiftSeconds(-1);
export const get_1seconds_forward = shiftSeconds(1);
export const get_10seconds_back = shiftSeconds(-10);
export const get_10seconds_forward = shiftSeconds(10);
export const get_30seconds_back = shiftSeconds(-30);
export const get_30seconds_forward = shiftSeconds(30);

// Copy `text` to the clipboard. navigator.clipboard only exists on https or
// localhost, so on the lab network fall back to a hidden textarea + execCommand.
export async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    if (!document.execCommand('copy')) throw new Error('The browser refused to copy');
  } finally {
    document.body.removeChild(area);
  }
}
