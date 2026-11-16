import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncedSettings, syncedSecrets, readState, readRemote, noteChanges, merge, nextState, applyPending, localValues, KEYS } from '../app/js/drivesync.js';

function store(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => ['scribecue.' + k, v]));
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const names = () => [...syncedSettings(), ...syncedSecrets()];
const local = (init) => localValues(store(init), names());
const remote = (settings) => readRemote({ scribecue: 'sync', version: 1, saved: 1, settings });
const synced = (seen, extra = {}) => ({ ...readState(JSON.stringify({ seen })), ...extra });

test('each browser keeps its own mode and list width', () => {
  assert.ok(!syncedSettings().includes('mode'));
  assert.ok(!syncedSettings().includes('listWidth'));
  assert.ok(syncedSettings().includes('appearance'));
  assert.ok(syncedSettings().includes(KEYS));
});

test('the first sync takes what Drive has, and adds what it lacks', () => {
  const r = merge({ local: local({ replay: '1', lead: '2' }), state: readState(null), remote: remote({ replay: { v: '0', at: 5 } }), now: 100 });
  assert.deepEqual(r.apply, { replay: '0' });
  assert.equal(r.upload, true);
  assert.deepEqual(r.file.settings.lead, { v: '2', at: 100 });
  assert.deepEqual(r.file.settings.replay, { v: '0', at: 5 });
});

test('the first sync with nothing in Drive uploads this browser’s settings', () => {
  const r = merge({ local: local({ lead: '2' }), state: readState(null), remote: null, now: 100 });
  assert.deepEqual(r.apply, {});
  assert.equal(r.upload, true);
  assert.deepEqual(Object.keys(r.file.settings), ['lead']);
});

test('a change here goes up; a change there comes down; nothing changed, nothing to do', () => {
  const seen = { lead: { v: '2', at: 10 }, replay: { v: '1', at: 10 } };
  const r1 = merge({ local: local({ lead: '3', replay: '1' }), state: synced(seen), remote: remote(seen), now: 50 });
  assert.equal(r1.upload, true);
  assert.deepEqual(r1.file.settings.lead, { v: '3', at: 50 });
  assert.deepEqual(r1.apply, {});
  const r2 = merge({ local: local({ lead: '2', replay: '1' }), state: synced(seen), remote: remote({ ...seen, replay: { v: '0', at: 40 } }), now: 50 });
  assert.equal(r2.upload, false);
  assert.deepEqual(r2.apply, { replay: '0' });
  const r3 = merge({ local: local({ lead: '2', replay: '1' }), state: synced(seen), remote: remote(seen), now: 50 });
  assert.equal(r3.upload, false);
  assert.deepEqual(r3.apply, {});
});

test('when both changed, the later change wins', () => {
  const seen = { lead: { v: '2', at: 10 } };
  const there = remote({ lead: { v: '4', at: 30 } });
  const later = merge({ local: local({ lead: '3' }), state: synced(seen, { changed: { lead: 40 } }), remote: there, now: 50 });
  assert.deepEqual(later.file.settings.lead, { v: '3', at: 50 });
  assert.deepEqual(later.apply, {});
  const earlier = merge({ local: local({ lead: '3' }), state: synced(seen, { changed: { lead: 20 } }), remote: there, now: 50 });
  assert.deepEqual(earlier.apply, { lead: '4' });
});

test('a setting removed here is removed everywhere', () => {
  const seen = { lead: { v: '2', at: 10 } };
  const r = merge({ local: local({}), state: synced(seen), remote: remote(seen), now: 50 });
  assert.deepEqual(r.file.settings.lead, { v: null, at: 50 });
  const there = merge({ local: local({ lead: '2' }), state: synced(seen), remote: remote({ lead: { v: null, at: 50 } }), now: 60 });
  assert.deepEqual(there.apply, { lead: null });
});

test('API keys sync only while Sync API keys is on, and turning it off takes them out of Drive', () => {
  const keys = '{"openai":"sk-1"}';
  const off = merge({ local: local({ 'ai.keys': keys }), state: synced({}), remote: remote({}), now: 50 });
  assert.equal(off.file.settings['ai.keys'], undefined);
  const on = merge({ local: local({ 'ai.keys': keys, [KEYS]: '1' }), state: synced({}), remote: remote({}), now: 50 });
  assert.deepEqual(on.file.settings['ai.keys'], { v: keys, at: 50 });
  const seen = { [KEYS]: { v: '1', at: 50 }, 'ai.keys': { v: keys, at: 50 } };
  const turnedOff = merge({ local: local({ 'ai.keys': keys, [KEYS]: '0' }), state: synced(seen), remote: remote(seen), now: 60 });
  assert.equal(turnedOff.upload, true);
  assert.equal(turnedOff.file.settings['ai.keys'], undefined);
  assert.deepEqual(turnedOff.apply, {}, 'this browser keeps its keys');
});

test('keys turned on elsewhere arrive, and Drive’s win over this browser’s older ones', () => {
  const seen = { [KEYS]: { v: '0', at: 10 } };
  const there = remote({ [KEYS]: { v: '1', at: 40 }, 'ai.keys': { v: '{"a":"new"}', at: 40 } });
  const r = merge({ local: local({ [KEYS]: '0', 'ai.keys': '{"a":"old"}' }), state: synced(seen), remote: there, now: 50 });
  assert.deepEqual(r.apply, { [KEYS]: '1', 'ai.keys': '{"a":"new"}' });
});

test('Drive’s copy is checked: unknown names and bad entries are left out', () => {
  assert.equal(readRemote({ scribecue: 'settings' }), null);
  const r = readRemote({ scribecue: 'sync', version: 2, settings: { lead: { v: '1', at: 3 }, nope: { v: 'x', at: 1 }, replay: { v: 5, at: 1 }, mode: { v: 'qc', at: 1 } } });
  assert.deepEqual(r.settings, { lead: { v: '1', at: 3 } });
  assert.equal(r.newer, true);
});

test('changes noticed here keep the time they were first seen', () => {
  const state = synced({ lead: { v: '2', at: 10 } });
  const a = noteChanges({ lead: '3' }, state, 100);
  assert.deepEqual(a, { changed: { lead: 100 }, any: true });
  const b = noteChanges({ lead: '4' }, { ...state, changed: a.changed }, 200);
  assert.deepEqual(b.changed, { lead: 100 });
  assert.deepEqual(noteChanges({ lead: '2' }, state, 300), { changed: {}, any: false });
});

test('changes from Drive held until Scribecue opens again don’t look like changes here', () => {
  const seen = { lead: { v: '2', at: 10 } };
  const here = { ...local({ lead: '2' }) };
  const result = merge({ local: here, state: synced(seen), remote: remote({ lead: { v: '5', at: 40 } }), now: 50 });
  const next = nextState({ state: synced(seen), result, local: here, hold: true, fileId: 'f', now: 50 });
  assert.deepEqual(next.pending, { lead: '5' });
  assert.deepEqual(next.seen.lead, { v: '2', at: 40 });
  const state = readState(JSON.stringify(next));
  assert.equal(noteChanges(here, state, 60).any, false);
  const s = store({ lead: '2' });
  assert.deepEqual(applyPending(s, state), ['lead']);
  assert.equal(s.getItem('scribecue.lead'), '5');
  assert.deepEqual(state.seen.lead, { v: '5', at: 40 });
});

test('a held change isn’t used if the setting changed here since', () => {
  const state = readState(JSON.stringify({ seen: { lead: { v: '2', at: 40 } }, pending: { lead: '5' } }));
  const s = store({ lead: '3' });
  assert.deepEqual(applyPending(s, state), []);
  assert.equal(s.getItem('scribecue.lead'), '3');
});
