import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { kindOf, kindLabel, addRecent, filterRecents, whenText, MAX_RECENTS } from '../app/js/recents.js';

const entry = (name, at = 0) => ({ name, kind: kindOf(name), at });
const sameName = (a, b) => a.name === b.name;

test('each kind of file is named as it is', () => {
  assert.equal(kindOf('Lights.scribecue'), 'project');
  assert.equal(kindOf('Lights.scribecueqc'), 'qc');
  assert.equal(kindOf('Lights.scribecuerec'), 'recording');
  assert.equal(kindOf('Lights.scribecue-rec'), 'recording');
  assert.equal(kindOf('Lights.scribesession'), 'session');
  assert.equal(kindOf('Lights.scribecuesession'), 'session');
  assert.deepEqual(['project', 'qc', 'recording', 'session'].map(kindLabel), ['Project', 'QC package', 'Recording file', 'Session package']);
});

test('a file opened again moves to the top, once, and the oldest drop off', () => {
  let list = [entry('a.scribecue', 1), entry('b.scribecue', 2)];
  list = addRecent(list, entry('b.scribecue', 3), sameName);
  assert.deepEqual(list.map((e) => [e.name, e.at]), [['b.scribecue', 3], ['a.scribecue', 1]]);
  for (let i = 0; i < MAX_RECENTS + 5; i++) list = addRecent(list, entry(`f${i}.scribecue`, i), sameName);
  assert.equal(list.length, MAX_RECENTS);
  assert.equal(list[0].name, `f${MAX_RECENTS + 4}.scribecue`);
});

test('search finds every word typed, in any order, within a kind', () => {
  const list = [entry('Lights episode 1.scribecue'), entry('Lights episode 2.scribecueqc'), entry('Sing.scribecuerec')];
  assert.deepEqual(filterRecents(list, { text: '2 LIGHTS' }).map((e) => e.name), ['Lights episode 2.scribecueqc']);
  assert.deepEqual(filterRecents(list, { kind: 'project' }).map((e) => e.name), ['Lights episode 1.scribecue']);
  assert.deepEqual(filterRecents(list, { text: 'lights', kind: 'recording' }), []);
  assert.equal(filterRecents(list, { text: '  ' }).length, 3);
});

test('when: a time today, yesterday with a time, then a date', () => {
  const now = new Date(2026, 10, 15, 18, 0).getTime();
  assert.doesNotMatch(whenText(new Date(2026, 10, 15, 9, 30).getTime(), now), /Yesterday|Nov/);
  assert.match(whenText(new Date(2026, 10, 14, 23, 0).getTime(), now), /^Yesterday /);
  assert.doesNotMatch(whenText(new Date(2026, 10, 1).getTime(), now), /2026/);
  assert.match(whenText(new Date(2025, 10, 1).getTime(), now), /2025/);
});

test('Recents is in the File menu, with its key, and only takes files off the list', () => {
  const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  const keymap = readFileSync(new URL('../app/js/keymap.js', import.meta.url), 'utf8');
  const file = html.slice(html.indexOf('id="fileMenu"'), html.indexOf('</div>', html.indexOf('id="fileMenu"')));
  assert.match(file, /data-act="recents"/);
  assert.match(keymap, /\['recents', '[^']+', \['Alt\+Shift\+KeyR'\]\]/);
  assert.match(html, /<dialog id="recentsDlg"[\s\S]*?only takes it off this list/);
});
