import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('setup offers the modes in the mode switch, and Record mode only with a recording file', () => {
  const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  const choices = [...html.matchAll(/name="wzMode" value="(\w+)"/g)].map((m) => m[1]);
  const modes = [...html.matchAll(/data-mode="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(choices, modes);
  assert.ok(!choices.includes('record'));
});

test('the pickups export hides when no pickups were asked for, even in Record mode', () => {
  const css = readFileSync(new URL('../app/css/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.mode-record \.record-only\[hidden\] \{ display: none; \}/);
});

test('Move takes to a folder hides once the takes are in a folder', () => {
  const css = readFileSync(new URL('../app/css/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.recrow\[hidden\] \{ display: none; \}/);
});
