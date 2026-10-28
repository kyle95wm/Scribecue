import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toProject, fromProject, sameMedia, PROJECT_FORMAT } from '../app/js/project.js';

const state = {
  app: '0.10.0',
  blocks: [
    { id: 7, start: 3, end: 6.2, text: 'Bands of teal.', speed: 1.15 },
    { id: 8, start: 11.5, end: 14, text: 'The colours fold.', auto: true },
  ],
  media: { name: 'lights.mkv', size: 2376368, duration: 60.02 },
  settings: { mode: 'write', offset: 0.2, ttsSpeed: 1, ttsVoice: 'piper:en_US-lessac-medium' },
  view: { playhead: 21.6, selected: 1 },
};

test('a project keeps blocks, their speeds and auto ends, settings, view and media', () => {
  const saved = JSON.parse(JSON.stringify(toProject(state)));
  assert.equal(saved.scribecue, PROJECT_FORMAT);
  assert.equal(saved.app, '0.10.0');
  assert.ok(!('id' in saved.blocks[0]), 'block ids are internal and not saved');
  const p = fromProject(saved);
  assert.deepEqual(p.blocks, [
    { start: 3, end: 6.2, text: 'Bands of teal.', speed: 1.15 },
    { start: 11.5, end: 14, text: 'The colours fold.', auto: true },
  ]);
  assert.deepEqual(p.settings, state.settings);
  assert.deepEqual(p.view, state.view);
  assert.deepEqual(p.media, state.media);
});

test('files that are not projects, or are from a newer version, are refused with a reason', () => {
  assert.throws(() => fromProject({ blocks: [] }), /isn’t a Scribecue project/);
  assert.throws(() => fromProject(null), /isn’t a Scribecue project/);
  assert.throws(() => fromProject({ scribecue: PROJECT_FORMAT + 1, blocks: [] }), /newer version/);
  assert.throws(() => fromProject({ scribecue: 1 }), /no blocks/);
});

test('damaged blocks and settings are dropped or repaired rather than breaking the project', () => {
  const p = fromProject({
    scribecue: 1,
    blocks: [{ start: 5, end: 4, text: 'end before start' }, { start: 'x', end: 2 }, null, { start: 1, end: 2 }],
    settings: { mode: 'subtitles', offset: 'lots', ttsVoice: '' },
    view: { playhead: -3, selected: 1.5 },
    media: { size: 3 },
  });
  assert.deepEqual(p.blocks, [{ start: 1, end: 2, text: '' }, { start: 5, end: 5, text: 'end before start' }]);
  assert.deepEqual(p.settings, {});
  assert.deepEqual(p.view, { playhead: 0 });
  assert.equal(p.media, null);
});

test('the saved video is recognised by name and size', () => {
  const saved = { name: 'lights.mkv', size: 100 };
  assert.equal(sameMedia(saved, { name: 'lights.mkv', size: 100 }), true);
  assert.equal(sameMedia(saved, { name: 'lights.mkv', size: 99 }), false);
  assert.equal(sameMedia(saved, { name: 'other.mkv', size: 100 }), false);
  assert.equal(sameMedia(null, { name: 'anything.mp4', size: 1 }), true);
});
