// Runs first, before anything reads its settings: uses settings that came from Google Drive
// while Scribecue was open, which wait until it opens again (see drivesync.js).
import { STATE, AUTH, readState, applyPending } from './drivesync.js';

export let appliedAtStart = [];
try {
  if (localStorage.getItem(AUTH)) {
    const state = readState(localStorage.getItem(STATE));
    if (Object.keys(state.pending).length) {
      appliedAtStart = applyPending(localStorage, state);
      const { first, ...keep } = state;
      localStorage.setItem(STATE, JSON.stringify(keep));
    }
  }
} catch { /* storage blocked: nothing to do */ }
