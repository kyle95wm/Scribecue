import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autosaveState, nextSave, DELAY, MAX_WAIT, AUTOSAVE_LABEL, AUTOSAVE_TIP } from '../app/js/autosave.js';

const base = { can: true, on: true, file: true, permission: 'granted', saving: false, dirty: false, error: '' };

test('the status next to the project name says what autosave is doing', () => {
  assert.equal(autosaveState(base), 'saved');
  assert.equal(autosaveState({ ...base, dirty: true }), 'saving');
  assert.equal(autosaveState({ ...base, saving: true }), 'saving');
  assert.equal(autosaveState({ ...base, permission: 'prompt' }), 'paused');
  assert.equal(autosaveState({ ...base, error: 'the file has been moved' }), 'error');
  assert.equal(autosaveState({ ...base, on: false }), 'off');
  for (const s of ['saved', 'saving', 'paused', 'error', 'off']) assert.ok(AUTOSAVE_LABEL[s] && AUTOSAVE_TIP[s], s);
});

test('there’s no status without a project file, or where browsers can’t write files', () => {
  assert.equal(autosaveState({ ...base, file: false }), '');
  assert.equal(autosaveState({ ...base, can: false }), '');
});

test('saves a moment after the last change, but not later than MAX_WAIT', () => {
  const t = 1e6;
  assert.equal(nextSave(t, t, t), DELAY);
  assert.equal(nextSave(t + 500, t + 500, t), DELAY);
  // Changes keep coming: it still saves MAX_WAIT after the first one.
  assert.equal(nextSave(t + MAX_WAIT - 100, t + MAX_WAIT - 100, t), 100);
  assert.equal(nextSave(t + MAX_WAIT + 5, t + MAX_WAIT + 5, t), 0);
});
