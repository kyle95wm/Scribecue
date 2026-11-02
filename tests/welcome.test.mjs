import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modesSetUp } from '../app/js/welcome.js';

test('the modes set up so far are what was kept', () => {
  assert.deepEqual(modesSetUp({ write: true }, { welcomed: true, current: 'qc', loops: { transcribe: true } }), { write: true });
});

test('someone new has set up no mode yet', () => {
  assert.deepEqual(modesSetUp(null, { welcomed: false, current: 'write', loops: { write: true } }), {});
});

test('before this was kept, the mode in use and any whose loop was seen count as set up', () => {
  assert.deepEqual(modesSetUp(null, { welcomed: true, current: 'transcribe' }), { transcribe: true });
  assert.deepEqual(modesSetUp(null, { welcomed: true, current: 'transcribe', loops: { write: true } }), { transcribe: true, write: true });
  // someone already recording has set up Record mode
  assert.deepEqual(modesSetUp(null, { welcomed: true, current: 'record' }), { record: true });
  // and so has someone who chose a microphone, lead-in or sync for it
  assert.deepEqual(modesSetUp(null, { welcomed: true, current: 'write', recorded: true }), { write: true, record: true });
});
