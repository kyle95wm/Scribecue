import { test } from 'node:test';
import assert from 'node:assert/strict';

// The browser parts text to speech touches, as stand-ins that take anything.
const stored = new Map();
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) };
const anything = () => new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'open' ? false : k === 'value' || k === 'textContent' ? '' : anything()),
  set: () => true,
  apply: () => anything(),
});
globalThis.document = { getElementById: () => anything(), querySelectorAll: () => [], createElement: () => anything(), addEventListener() {} };
const { tts, initTts, setTtsOption, useProjectVoice, VOICE_LOCKED } = await import('../app/js/tts.js');

test('in a shared project only its owner changes the voice; the owner’s voice reads here', () => {
  let locked = false;
  const toasts = [];
  try { initTts({ toast: (m) => toasts.push(m), voiceLocked: () => locked, changed() {} }); } catch { /* the panel's parts are stand-ins */ }
  setTtsOption('voice', 'google:en-US-Standard-C');
  assert.equal(tts.voice, 'google:en-US-Standard-C', 'not locked: it changes');
  locked = true;
  setTtsOption('voice', 'piper:en_US-lessac-medium');
  assert.equal(tts.voice, 'google:en-US-Standard-C', 'locked: it stays');
  assert.deepEqual(toasts, [VOICE_LOCKED]);
  useProjectVoice('polly:Joanna');
  assert.equal(tts.voice, 'polly:Joanna', 'the owner’s voice is used');
  assert.match(stored.get('scribecue.tts'), /polly:Joanna/);
});
