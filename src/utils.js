// utils.js
import { CHUNK_SECONDS } from './constants.js';

const toInt = (value) => Number.parseInt(value, 10);

const getChunkSize = (recordingFramerate) => recordingFramerate * CHUNK_SECONDS;

export const get_prev_chunk = (value, recordingFramerate) => {
  const chunksize = getChunkSize(recordingFramerate);
  const v = toInt(value);
  const min_fn = Math.floor(recordingFramerate*CHUNK_SECONDS*20);

  return Math.max(chunksize * Math.floor(v / chunksize) - chunksize, min_fn);
};

export const get_next_chunk = (value, recordingFramerate) => {
  const chunksize = getChunkSize(recordingFramerate);
  const v = toInt(value);
  const max_fn = Math.floor(recordingFramerate*CHUNK_SECONDS*400);

  return Math.min(chunksize * Math.floor(v / chunksize) + chunksize, max_fn);
};

export const get_chunk_back = (value, recordingFramerate) => {
  const v = toInt(value);
  const chunksize = getChunkSize(recordingFramerate);
  const min_fn = Math.floor(recordingFramerate*CHUNK_SECONDS*20);
  return Math.max(v - chunksize, min_fn);
};

export const get_chunk_forward = (value, recordingFramerate) => {
  const v = toInt(value);
  const chunksize = getChunkSize(recordingFramerate);
  const max_fn = Math.floor(recordingFramerate*CHUNK_SECONDS*400);
    return Math.min(v + chunksize, max_fn);
};

export const get_1seconds_back = (value, recordingFramerate) => {
  const v = toInt(value);
  const min_fn = Math.floor(recordingFramerate*CHUNK_SECONDS*20);
  return Math.max(Math.floor(v - recordingFramerate * 1), min_fn);
};

export const get_1seconds_forward = (value, recordingFramerate) => {
  const v = toInt(value);
  const max_fn = Math.floor(recordingFramerate*CHUNK_SECONDS*400);
  return Math.min(Math.ceil(v + recordingFramerate * 1), max_fn);
};

export const get_10seconds_back = (value, recordingFramerate) => {
  const v = toInt(value);
  const min_fn = Math.floor(recordingFramerate*CHUNK_SECONDS*20);
  return Math.max(v - recordingFramerate * 10, min_fn);
};

export const get_10seconds_forward = (value, recordingFramerate) => {
  const v = toInt(value);
  const max_fn = Math.floor(recordingFramerate*CHUNK_SECONDS*400);
  return Math.min(v + recordingFramerate * 10, max_fn);
};


export const get_30seconds_back = (value, recordingFramerate) => {
  const v = toInt(value);
  const min_fn = Math.floor(recordingFramerate*CHUNK_SECONDS*20);
  return Math.max(v - recordingFramerate * 30, min_fn);
};

export const get_30seconds_forward = (value, recordingFramerate) => {
  const v = toInt(value);
  const max_fn = Math.floor(recordingFramerate*CHUNK_SECONDS*400);
  return Math.min(v + recordingFramerate * 30, max_fn);
};

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
