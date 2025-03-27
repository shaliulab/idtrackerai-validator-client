
export const PLACEHOLDER_IMAGE="./assets/placeholder.png"
export const BACKEND_SERVER="10.43.207.98"; // TODO Update this if the IP of the server changes
export const BACKEND_PORT = process.env.REACT_APP_BACKEND_PORT || 5000;
console.log(`Backend is running on ${BACKEND_PORT}`);

export const CHUNKSIZE=45000
export const FRAMERATE=10;
export const RECORDING_FRAMERATE=150;
export const MAX_FN=CHUNKSIZE*450-1;
export const MIN_FN=CHUNKSIZE*0;
export const DEFAULT_CHUNK=50;

export const SQUARE_HEIGHT=100;
export const SQUARE_WIDTH=100;
export const TEXT_SIZE=20;
export const TEXT_FAMILY="Arial";
