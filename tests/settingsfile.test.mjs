import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exportSettings, readSettingsFile, settingsChanges, applySettings, importQuestion, settingNames, secretNames,
} from '../app/js/settingsfile.js';

const memory = (entries = {}) => {
  const m = new Map(Object.entries(entries));
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
// A browser that's been used a while: settings, work, shared projects, caches and keys.
const used = () => memory({
  'scribecue.reviewer': 'Sam Lee',
  'scribecue.mode': 'write',
  'scribecue.replay': '0',
  'scribecue.lead': '2',
  'scribecue.offset': '0.25',
  'scribecue.tts': JSON.stringify({ on: true, voice: 'piper:en_GB-alba', favourites: ['piper:en_GB-alba'], dipDb: 15 }),
  'scribecue.keys': JSON.stringify({ play: ['KeyP'] }),
  'scribecue.ai': JSON.stringify({ provider: 'ollama', models: { ollama: 'llava' } }),
  'scribecue.rec.lead': '5',
  'scribecue.rec.dev': 'mic-1234', // this computer's microphone
  'scribecue.rec.sync': '42', // measured on this computer
  'scribecue.v1': JSON.stringify({ cues: [{ text: 'A door opens.' }] }),
  'scribecue.share.p1': JSON.stringify({ room: 'r', key: 'secret' }),
  'scribecue.editor': 'ed-1',
  'scribecue.seenVersion': '0.95.0',
  'scribecue.loops': '{"write":true}',
  'scribecue.updateCheck': '{"at":1}',
  'scribecue.googleTts': JSON.stringify({ key: 'AIza-google', voices: [] }),
  'scribecue.pollyTts': JSON.stringify({ key: 'AKIA', secret: 'shh', region: 'eu-west-1' }),
  'scribecue.ai.keys': JSON.stringify({ anthropic: 'sk-ant', tmdb: 'tmdb-key' }),
});

test('a backup has the preferences and nothing else', () => {
  const f = exportSettings(used(), { version: '0.96.0', now: new Date('2026-11-08T12:00:00Z') });
  assert.equal(f.scribecue, 'settings');
  assert.equal(f.version, 1);
  assert.equal(f.app, '0.96.0');
  assert.equal(f.saved, '2026-11-08T12:00:00.000Z');
  assert.deepEqual(Object.keys(f.settings).sort(), ['ai', 'keys', 'lead', 'mode', 'offset', 'rec.lead', 'replay', 'reviewer', 'tts'].sort());
  assert.equal(f.settings.reviewer, 'Sam Lee');
  assert.deepEqual(f.settings.tts.favourites, ['piper:en_GB-alba']);
  assert.equal(f.secrets, undefined);
  const text = JSON.stringify(f);
  for (const left of ['A door opens', 'secret', 'ed-1', 'mic-1234', 'AIza', 'AKIA', 'sk-ant', 'tmdb-key']) assert.ok(!text.includes(left), left);
});

test('API keys go in only when asked for', () => {
  const f = exportSettings(used(), { secrets: true });
  assert.deepEqual(Object.keys(f.secrets).sort(), ['ai.keys', 'googleTts', 'pollyTts']);
  assert.equal(f.secrets.googleTts.key, 'AIza-google');
  assert.ok(!JSON.stringify(f).includes('room'), 'shared-project keys never go in');
  // With no keys kept, there's nothing to include.
  assert.equal(exportSettings(memory({ 'scribecue.mode': 'qc' }), { secrets: true }).secrets, undefined);
});

test('no setting or secret is ever a project, a share or a cache', () => {
  for (const n of [...settingNames(), ...secretNames()]) {
    assert.ok(!/^(v1|share\.|editor|ai\.pkce|updateCheck|recOpen|rec\.dev|rec\.sync)/.test(n), n);
  }
});

test('damaged stored values are left out rather than breaking the export', () => {
  const f = exportSettings(memory({ 'scribecue.tts': '{not json', 'scribecue.keys': '[1,2]', 'scribecue.mode': 'qc' }));
  assert.deepEqual(f.settings, { mode: 'qc' });
});

test('a backup imports into an empty browser and gives the same settings', () => {
  const from = used(), to = memory();
  const file = readSettingsFile(JSON.parse(JSON.stringify(exportSettings(from, { secrets: true }))));
  assert.deepEqual(file.skipped, []);
  assert.deepEqual(settingsChanges(file, to), ['Your name', 'Mode', 'Editing', 'Transcribing', 'Text to speech', 'AI help', 'Keyboard shortcuts', 'Recording', 'Google key', 'Amazon Polly key', 'AI and TMDB keys']);
  assert.equal(applySettings(file, to), 12);
  assert.equal(to.getItem('scribecue.reviewer'), 'Sam Lee');
  assert.deepEqual(JSON.parse(to.getItem('scribecue.tts')), JSON.parse(from.getItem('scribecue.tts')));
  assert.equal(to.getItem('scribecue.v1'), null);
  assert.equal(to.getItem('scribecue.rec.dev'), null);
  // Importing it again changes nothing.
  assert.deepEqual(settingsChanges(file, to), []);
  assert.equal(applySettings(file, to), 0);
});

test('importing leaves settings and work the file doesn’t have, and adds to AI keys', () => {
  const to = memory({
    'scribecue.v1': '{"cues":[]}', 'scribecue.lead': '3', 'scribecue.ai.keys': JSON.stringify({ openai: 'sk-open', tmdb: 'old' }),
  });
  const file = readSettingsFile({ scribecue: 'settings', version: 1, settings: { mode: 'qc' }, secrets: { 'ai.keys': { tmdb: 'new' } } });
  applySettings(file, to);
  assert.equal(to.getItem('scribecue.mode'), 'qc');
  assert.equal(to.getItem('scribecue.lead'), '3');
  assert.equal(to.getItem('scribecue.v1'), '{"cues":[]}');
  assert.deepEqual(JSON.parse(to.getItem('scribecue.ai.keys')), { openai: 'sk-open', tmdb: 'new' });
});

test('files that aren’t settings files are refused, saying why', () => {
  for (const bad of [null, 42, [], 'text', {}, { scribecue: 'project' }, { scribecue: 'settings' }, { scribecue: 'settings', settings: [] }]) {
    assert.throws(() => readSettingsFile(bad), /isn’t a Scribecue settings file/);
  }
  assert.throws(() => readSettingsFile({ scribecue: 'shortcuts', version: 1, keys: {} }), /shortcuts file. Import it under Keyboard shortcuts/);
});

test('a file from a newer version imports what it can', () => {
  const file = readSettingsFile({
    scribecue: 'settings', version: 7, app: '2.0.0',
    settings: { mode: 'record', lead: 1.5, replay: false, futureThing: { x: 1 }, tts: 'not an object', reviewer: ['Sam'] },
    secrets: { googleTts: { key: 'k' }, somethingNew: 'x' },
  });
  assert.equal(file.newer, true);
  assert.equal(file.app, '2.0.0');
  assert.deepEqual([...file.values.keys()], ['mode', 'lead', 'replay', 'googleTts']);
  assert.equal(file.values.get('lead'), '1.5');
  assert.equal(file.values.get('replay'), '0');
  assert.deepEqual(file.skipped, ['futureThing', 'tts', 'reviewer', 'somethingNew']);
});

test('an older file, with fewer settings, imports what it has', () => {
  const file = readSettingsFile({ scribecue: 'settings', version: 0, settings: { offset: '0.1' } });
  assert.equal(file.newer, false);
  assert.deepEqual(settingsChanges(file, memory()), ['Transcribing']);
});

test('secrets only count from the secrets part, and settings only from theirs', () => {
  const file = readSettingsFile({ scribecue: 'settings', version: 1, settings: { googleTts: { key: 'k' } }, secrets: { mode: 'qc' } });
  assert.equal(file.values.size, 0);
  assert.deepEqual(file.skipped, ['googleTts', 'mode']);
});

test('the question says what will change, and what won’t', () => {
  const q = importQuestion(['Your name', 'Text to speech', 'Keyboard shortcuts'], { name: 'mine.json', newer: true, skipped: 2 });
  assert.match(q, /^Replace these settings with the ones in mine\.json: Your name, Text to speech and Keyboard shortcuts\?/);
  assert.match(q, /Projects aren’t touched/);
  assert.match(q, /newer version/);
  assert.match(q, /2 settings couldn’t be used and are left out/);
  assert.match(q, /reloads/);
  assert.doesNotMatch(importQuestion(['Mode']), /newer|couldn’t/);
});
