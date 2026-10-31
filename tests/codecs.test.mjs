// Which formats the browser can't play, and what Scribecue says about it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { videoName, missing, advice, copyKind, TESTS, COMMON } from '../app/js/codecs.js';
import { missingFeatures } from '../app/js/browser.js';

// A Chromium build without the licensed codecs.
const open = (t) => (/avc1|hvc1|mp4a/.test(t) ? '' : 'probably');

test('codecs as files name them', () => {
  assert.equal(videoName('avc1'), 'H.264');
  assert.equal(videoName('avc3'), 'H.264');
  assert.equal(videoName('hev1'), 'HEVC');
  assert.equal(videoName('V_MPEG4/ISO/AVC'), 'H.264');
  assert.equal(videoName('V_VP9'), 'VP9');
  assert.equal(videoName('encv'), '');
  for (const n of COMMON) assert.ok(TESTS[n]);
});

test('only what the browser lacks, once each, and nothing it has no test for', () => {
  assert.deepEqual(missing(['H.264', 'AAC', 'AAC', 'AC-3', ''], open), ['H.264', 'AAC']);
  assert.deepEqual(missing(['VP9', 'Opus'], open), []);
  assert.deepEqual(missing(['H.264', 'AAC'], () => 'maybe'), []);
});

test('the message names what is missing and what to do', () => {
  const one = advice(['AAC'], { file: 'Film.mp4' });
  assert.match(one, /can’t play AAC, which Film\.mp4 uses/);
  assert.match(one, /leave it out/);
  assert.match(one, /WebM copy/);
  assert.match(advice(['H.264', 'AAC'], { file: 'Film.mp4', ffmpeg: true }), /H\.264 or AAC.*leave them out.*Make a copy/);
  assert.match(advice([], { file: 'Film.avi' }), /^This browser can’t play Film\.avi\. /);
});

test('the copy keeps the picture only when it plays and fits in an MP4', () => {
  assert.equal(copyKind('H.264', ['AAC']), 'mp4');
  assert.equal(copyKind('H.264', ['H.264', 'AAC']), 'webm');
  assert.equal(copyKind('', ['AAC']), 'webm');
  assert.equal(copyKind('MPEG-4 video', ['AAC']), 'webm');
});

test('the start-up notice says when most MP4s won’t play', () => {
  const w = { document: { createElement: () => ({ canPlayType: open }) }, AudioDecoder: 1, showSaveFilePicker: 1, onbeforeinstallprompt: null, speechSynthesis: 1 };
  assert.deepEqual(missingFeatures(w), ['playing most MP4 videos, which use H.264 and AAC. Use a WebM copy instead']);
  w.document.createElement = () => ({ canPlayType: () => 'probably' });
  assert.deepEqual(missingFeatures(w), []);
});
