// Autosave: once a project has a file, changes are written to it a moment after you stop.
// Browsers only allow it where a page can write to a file you chose (Chrome and Edge),
// and after a reload they ask again before it may, which needs a click: until then it's
// paused, and says so next to the project name.

// Whether this browser can autosave at all: it needs to keep hold of a file you chose and
// write to it again later. Firefox and Safari can't, so they download a copy each save.
export function canAutosave(w = globalThis) {
  return typeof w.showSaveFilePicker === 'function' &&
    typeof w.FileSystemFileHandle?.prototype?.createWritable === 'function' &&
    typeof w.FileSystemFileHandle?.prototype?.queryPermission === 'function';
}

export const DELAY = 2000; // ms after the last change
export const MAX_WAIT = 30e3; // but no longer than this while changes keep coming

// What the status next to the project name shows, or '' for nothing. Autosave is always
// on. can: the browser can write to files. file: the project has one. permission: 'granted', 'prompt' or 'denied'. error: why the last write failed.
export function autosaveState({ can, file, permission, saving, dirty, error }) {
  if (!can || !file) return '';
  if (error) return 'error';
  if (permission !== 'granted') return 'paused';
  if (saving || dirty) return 'saving';
  return 'saved';
}

export const AUTOSAVE_LABEL = {
  error: 'autosave failed',
  paused: 'autosave paused',
  saving: 'saving…',
  saved: 'autosaved',
};

export const AUTOSAVE_TIP = {
  error: 'The last autosave didn’t work: {error}. Click to try again, or save with {mod}S',
  paused: 'Autosave is paused until you let Scribecue save to the project file again, which the browser asks after a reload. Click to resume',
  saving: 'Saving changes to the project file',
  saved: 'Changes are saved to the project file as you work',
};

// When the next autosave should run, in ms from now: DELAY after the last change, but
// never more than MAX_WAIT after the first unsaved one.
export function nextSave(now, lastChange, firstPending) {
  return Math.max(0, Math.min(lastChange + DELAY, firstPending + MAX_WAIT) - now);
}
