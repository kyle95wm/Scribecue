// "Don't have ffmpeg?" under the ffmpeg commands: the install command for this system.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemOf, systemsFor, installSentence, dockerLine, SYSTEMS } from '../app/js/ffhelp.js';

test('the system comes from either platform name the browser gives', () => {
  assert.equal(systemOf('Win32'), 'windows');
  assert.equal(systemOf('Windows'), 'windows');
  assert.equal(systemOf('MacIntel'), 'mac');
  assert.equal(systemOf('macOS'), 'mac');
  assert.equal(systemOf('Linux x86_64'), 'linux');
  assert.equal(systemOf('Linux'), 'linux');
  assert.equal(systemOf('Linux armv8l Android'), null);
  assert.equal(systemOf('Chrome OS'), null);
  assert.equal(systemOf(''), null);
  assert.equal(systemOf(), null);
});

test('only this system’s help shows, or all of them when it isn’t known', () => {
  assert.deepEqual(systemsFor('MacIntel'), ['mac']);
  assert.deepEqual(systemsFor('Chrome OS'), ['windows', 'mac', 'linux']);
});

test('each system has an install command, a note and how to open a terminal', () => {
  for (const s of Object.values(SYSTEMS)) {
    assert.match(s.install, /ffmpeg/i);
    assert.ok(s.after && s.terminal.startsWith('To open a terminal'));
  }
  assert.equal(SYSTEMS.windows.install, 'winget install --id Gyan.FFmpeg -e');
  assert.equal(SYSTEMS.mac.install, 'brew install ffmpeg');
});

test('a message gets one sentence on installing', () => {
  assert.equal(installSentence('Win32'), 'To install ffmpeg on Windows, run winget install --id Gyan.FFmpeg -e in a terminal.');
  assert.equal(installSentence('Chrome OS'), 'To install ffmpeg, see ffmpeg.org.');
});

test('the web version points to Docker, Docker without ffmpeg to adding it', () => {
  assert.match(dockerLine(true), /^Or run Scribecue in Docker/);
  assert.match(dockerLine(false), /^Or add ffmpeg/);
});
