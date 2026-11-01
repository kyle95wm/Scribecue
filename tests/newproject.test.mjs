import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startNewProject } from '../app/js/newproject.js';

test('saving finishes before the current project is replaced', async () => {
  let dirty = true;
  const events = [];
  assert.equal(await startNewProject({ saveFirst: true,
    save: async () => { events.push('saving'); await Promise.resolve(); dirty = false; events.push('saved'); },
    isDirty: () => dirty, start: () => events.push('new') }), true);
  assert.deepEqual(events, ['saving', 'saved', 'new']);
});
test('a cancelled or failed save keeps the unsaved review open', async () => {
  let started = false;
  assert.equal(await startNewProject({ saveFirst: true, save: async () => {},
    isDirty: () => true, start: () => { started = true; } }), false);
  assert.equal(started, false);
  await assert.rejects(startNewProject({ saveFirst: true, save: async () => { throw Error('Disk full'); },
    isDirty: () => true, start: () => { started = true; } }), /Disk full/);
  assert.equal(started, false);
});
test('explicitly starting without saving does not call save', async () => {
  let started = false;
  assert.equal(await startNewProject({ saveFirst: false, save: () => assert.fail('unexpected save'),
    isDirty: () => true, start: () => { started = true; } }), true);
  assert.equal(started, true);
});
