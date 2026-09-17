// constants.js

export const PLACEHOLDER_IMAGE = "/assets/placeholder.png";

export const FRAMERATE = 10;
export const FIRST_FRAME = 5000000;
export const CHUNK_SECONDS = 300;
export const SQUARE_HEIGHT = 100;
export const SQUARE_WIDTH = 100;
export const TEXT_SIZE = 20;
export const TEXT_FAMILY = "Arial";
export const PRINT_CONTOUR = false;

// Target display size on the client.
export const DISPLAY_SIZE = 2000;


export const LABEL_FIELD = "identity";

// Fields offered in the frame-label dropdown. Only those actually present in
// the current tracking rows are shown.
export const LABEL_FIELD_CANDIDATES = [
  "identity",
  "local_identity",
  "in_frame_index",
  "fragment",
  "area",
  "modified",
  "ZT",
  "t",
  "frame_number",
];