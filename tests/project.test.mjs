import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toProject, fromProject, sameMedia, PROJECT_FORMAT } from '../app/js/project.js';

const state = {
  app: '0.10.0',
  blocks: [
    { id: 7, start: 3, end: 6.2, text: 'Bands of teal.', speed: 1.15, pinned: true, dip: 0 },
    { id: 8, start: 11.5, end: 14, text: 'The colours fold.', voice: 'kokoro:bf_emma', auto: true, say: [['colours', 'kul-ers']], vol: 140 },
    { id: 9, start: 20, end: 23, text: 'Fitted.', speed: 0.83, fit: true, dipBy: -4, vol: 60 },
    { id: 10, start: 25, end: 26, text: 'Old.', dip: 12 },
  ],
  media: { name: 'lights.mkv', size: 2376368, duration: 60.02 },
  settings: { mode: 'write', offset: 0.2, ttsSpeed: 1, ttsBase: 1.05, ttsVoice: 'piper:en_US-lessac-medium',
    ttsDuck: true, ttsDipDb: 13, ttsDipFade: 0.5, ttsMix: -0.25 },
  view: { playhead: 21.6, selected: 1 },
};

test('a project keeps blocks, their speeds, voices, dips and auto ends, settings, view and media', () => {
  const saved = JSON.parse(JSON.stringify(toProject(state)));
  assert.equal(saved.scribecue, PROJECT_FORMAT);
  assert.equal(saved.app, '0.10.0');
  assert.ok(!('id' in saved.blocks[0]), 'block ids are internal and not saved');
  const p = fromProject(saved);
  assert.deepEqual(p.blocks, [
    { start: 3, end: 6.2, text: 'Bands of teal.', speed: 1.15, dip: 0, pinned: true },
    { start: 11.5, end: 14, text: 'The colours fold.', voice: 'kokoro:bf_emma', vol: 140, auto: true, say: [['colours', 'kul-ers']] },
    { start: 20, end: 23, text: 'Fitted.', speed: 0.83, dipBy: -4, vol: 60, fit: true },
    { start: 25, end: 26, text: 'Old.', dip: 12 },
  ]);
  const bad = fromProject({ ...saved, blocks: [{ start: 0, end: 1, text: 'x', dipBy: 41, vol: 300 }, { start: 0, end: 1, text: 'y', dipBy: 2.5, vol: 10 }] });
  assert.deepEqual(bad.blocks.map((b) => [b.dipBy, b.vol]), [[undefined, undefined], [undefined, undefined]]);
  assert.deepEqual(p.settings, state.settings);
  assert.deepEqual(p.view, state.view);
  assert.deepEqual(p.media, state.media);
});

test('the dip and the Video / TTS slider come back only when they make sense', () => {
  const saved = JSON.parse(JSON.stringify(toProject(state)));
  const s = (settings) => fromProject({ ...saved, settings }).settings;
  assert.deepEqual(s({ ttsDuck: false, ttsDipDb: 40, ttsDipFade: 0, ttsMix: 1 }), { ttsDuck: false, ttsDipDb: 40, ttsDipFade: 0, ttsMix: 1 });
  assert.deepEqual(s({ ttsDuck: 'yes', ttsDipDb: 0, ttsDipFade: 9, ttsMix: -2 }), {}, 'nonsense is left out');
  assert.deepEqual(s({ ttsDipDb: 12.5 }), {}, 'whole dB only');
  assert.deepEqual(s({}), {}, 'older projects have none, and leave the settings alone');
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

test('damaged sounds like words are dropped', () => {
  const p = fromProject({ scribecue: 1, blocks: [{ start: 1, end: 2, text: 'A', say: [['A', 'ay'], ['', 'x'], ['B'], 'C', [' D ', ' dee ']] }, { start: 3, end: 4, say: 'nope' }] });
  assert.deepEqual(p.blocks[0].say, [['A', 'ay'], ['D', 'dee']]);
  assert.equal(p.blocks[1].say, undefined);
});

test('project notes for AI help are kept, and left out when empty', () => {
  const p = fromProject(JSON.parse(JSON.stringify(toProject({ ...state, notes: 'Mara: red coat.' }))));
  assert.equal(p.notes, 'Mara: red coat.');
  assert.ok(!('notes' in toProject({ ...state, notes: '  ' })));
  assert.equal(fromProject({ scribecue: 1, blocks: [] }).notes, '');
  assert.equal(fromProject({ scribecue: 1, blocks: [], notes: 42 }).notes, '');
});

test('a project keeps its pickup marks and its recording files’ id, version and lines sent', () => {
  const recording = { id: 'abcdefgh12345678', version: 2, sent: [{ start: 1, end: 2, text: 'A.', extra: 1 }] };
  const p = fromProject(JSON.parse(JSON.stringify(toProject({ blocks: [{ start: 1, end: 2, text: 'A.', pickup: { note: 'Siobhan: shi-VAWN' } }, { start: 3, end: 4, text: 'B.' }], recording }))));
  assert.deepEqual(p.blocks.map((b) => b.pickup || null), [{ note: 'Siobhan: shi-VAWN' }, null]);
  assert.deepEqual(p.recording, { id: 'abcdefgh12345678', version: 2, sent: [{ start: 1, end: 2, text: 'A.' }] });
  assert.equal(fromProject({ scribecue: 1, blocks: [], recording: { id: 'nope' } }).recording, null);
  assert.equal(fromProject({ scribecue: 1, blocks: [] }).recording, null, 'projects from before recording files');
});

test('persistent project and block identities survive file and QC round trips', async () => {
  const { newIdentity, validIdentity } = await import('../app/js/project.js');
  const { resaveReview, openReview } = await import('../app/js/qc.js');
  const projectId = newIdentity(), uid = newIdentity();
  assert.ok(validIdentity(uid));
  assert.notEqual(uid, projectId);
  const saved = toProject({ ...state, projectId, blocks: [{ ...state.blocks[0], uid }] });
  const p = fromProject(JSON.parse(JSON.stringify(saved)));
  assert.equal(p.projectId, projectId);
  assert.equal(p.blocks[0].uid, uid);
  const packaged = resaveReview({ file: new Blob(['SCQC0001']), audioEnd: 8, readings: [], permissions: { allowEdits: true } }, saved);
  const review = await openReview(packaged);
  assert.equal(review.parsed.projectId, projectId);
  assert.equal(review.parsed.blocks[0].uid, uid);
  assert.ok(!('id' in saved.blocks[0]), 'temporary editor ids remain private to the session');
});

test('legacy files stay readable; invalid identities are dropped and duplicates refused', async () => {
  const { newIdentity } = await import('../app/js/project.js');
  const uid = newIdentity();
  const block = { uid, start: 1, end: 2, text: 'A' };
  assert.throws(() => fromProject({ scribecue: 1, blocks: [block, block] }), /same identity/);
  const p = fromProject({ scribecue: 1, projectId: 'wrong', blocks: [{ ...block, uid: 'wrong' }] });
  assert.ok(!('projectId' in p));
  assert.ok(!('uid' in p.blocks[0]));
  assert.ok(!('projectId' in fromProject(toProject(state))));
});

test('authoring projects keep only a valid original-readings reference, never permission flags', () => {
  const baselineId='a'.repeat(64);
  const saved=toProject({...state,reviewAudio:{baselineId,allowEdits:true,owner:true}});
  assert.deepEqual(fromProject(saved).reviewAudio,{baselineId});
  assert.throws(()=>fromProject({...saved,reviewAudio:{baselineId:'bad'}}),/reference is damaged/);
});

test('a project keeps each block’s notes for the narrator, and drops blank or malformed ones', () => {
  const blocks = [{ start: 1, end: 2, text: 'A.', notes: 'Siobhan: shi-VAWN.\nWarm, unhurried.' }, { start: 3, end: 4, text: 'B.', notes: '   ' }, { start: 5, end: 6, text: 'C.' }];
  const saved = JSON.parse(JSON.stringify(toProject({ blocks })));
  assert.ok(!('notes' in saved.blocks[1]), 'blank notes are not saved');
  const p = fromProject({ ...saved, blocks: [...saved.blocks, { start: 7, end: 8, text: 'D.', notes: 42 }] });
  assert.deepEqual(p.blocks.map((b) => b.notes ?? null), ['Siobhan: shi-VAWN.\nWarm, unhurried.', null, null, null]);
  assert.equal(fromProject({ ...saved, blocks: [{ start: 1, end: 2, text: 'A.', notes: 'x'.repeat(3000) }] }).blocks[0].notes.length, 2000);
});
