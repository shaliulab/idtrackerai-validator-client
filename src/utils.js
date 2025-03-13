import { CHUNKSIZE, RECORDING_FRAMERATE, MAX_FN, MIN_FN } from './constants.js'

export const get_prev_chunk = (value) => {
  return(Math.max(CHUNKSIZE*Math.floor(parseInt(value) / CHUNKSIZE)-CHUNKSIZE, MIN_FN))
}

export const get_next_chunk = (value) => {
  return(Math.min(CHUNKSIZE*Math.floor(parseInt(value) / CHUNKSIZE)+CHUNKSIZE, MAX_FN))
}
  
export const get_chunk_back = (value) => {
  return(Math.max(parseInt(value) - CHUNKSIZE, MIN_FN))
}

export const get_chunk_forward = (value) => {
  return(Math.min(parseInt(value) + CHUNKSIZE, MAX_FN))
}

export const get_1seconds_back = (value) => {
  return(Math.max(parseInt(value) - RECORDING_FRAMERATE*1, MIN_FN))
}

export const get_1seconds_forward = (value) => {
  return(Math.min(parseInt(value) + RECORDING_FRAMERATE*1, MAX_FN))
}
export const get_10seconds_back = (value) => {
  return(Math.max(parseInt(value) - RECORDING_FRAMERATE*10, MIN_FN))
}

export const get_10seconds_forward = (value) => {
  return(Math.min(parseInt(value) + RECORDING_FRAMERATE*10, MAX_FN))
}