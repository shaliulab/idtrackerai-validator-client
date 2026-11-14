// loadGuard.js: what may stop the loaded experiment from changing. The server holds one loaded experiment and the
// Annotate tab's saves are written into it (a save for another experiment answers 409), so loading another one while
// saves are on their way would lose them. The Annotate tab reports its state here; postLoad asks before loading.

let state = { saving: 0, unsaved: false };
const listeners = new Set();

// saving: saves still on their way (frames or chunk relabels); unsaved: edits not written yet
export function setAnnotateState(next) {
  if (next.saving === state.saving && next.unsaved === state.unsaved) return;
  state = next;
  listeners.forEach((fn) => fn());
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getAnnotateState = () => state;

// throws when the experiment must not change now (saves in flight, or unsaved edits the user keeps)
export function checkCanLoad() {
  if (state.saving > 0) {
    throw new Error('annotations are being saved: wait until the console says they are saved, then load again');
  }
  if (state.unsaved && !window.confirm('The Annotate tab has annotations not saved yet (Ctrl+S saves them). '
      + 'Loading another experiment drops them. Load anyway?')) {
    throw new Error('cancelled, the annotations not saved are kept');
  }
}
