import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyName, filterProjects, isDriveRef, driveRef, changedElsewhere, oneAtATime, firstSaveGoes, projectName, newerInDrive } from '../app/js/driveprojects.js';

test('a copy gets the first free number, whatever the case', () => {
  assert.equal(copyName('Pilot.scribecue', []), 'Pilot.scribecue');
  assert.equal(copyName('Pilot.scribecue', ['Pilot.scribecue']), 'Pilot (2).scribecue');
  assert.equal(copyName('Pilot.scribecue', ['pilot.scribecue', 'Pilot (2).scribecue']), 'Pilot (3).scribecue');
  assert.equal(copyName('Pilot (2).scribecue', ['Pilot (2).scribecue']), 'Pilot (3).scribecue', 'not Pilot (2) (2)');
  assert.equal(copyName('Notes', ['Notes']), 'Notes (2)');
});

test('the Drive list is newest first, and search needs every word', () => {
  const files = [
    { name: 'Lights episode 1.scribecue', modifiedTime: '2026-11-10T10:00:00Z' },
    { name: 'Lights episode 2.scribecue', modifiedTime: '2026-11-15T10:00:00Z' },
    { name: 'Pilot.scribecue', modifiedTime: '2026-11-12T10:00:00Z' },
  ];
  assert.deepEqual(filterProjects(files).map((f) => f.name), ['Lights episode 2.scribecue', 'Pilot.scribecue', 'Lights episode 1.scribecue']);
  assert.deepEqual(filterProjects(files, 'episode LIGHTS 1').map((f) => f.name), ['Lights episode 1.scribecue']);
});

test('a Drive project is kept as plain data, and a change elsewhere is spotted', () => {
  const ref = driveRef({ id: 'a', name: 'P.scribecue', revision: 'r1', getFile() {} });
  assert.deepEqual(ref, { kind: 'drive', id: 'a', name: 'P.scribecue', revision: 'r1' });
  assert.ok(isDriveRef(structuredClone(ref)));
  assert.ok(!isDriveRef({ kind: 'file', name: 'x' }));
  assert.ok(changedElsewhere('r1', 'r2'));
  assert.ok(!changedElsewhere('r1', 'r1'));
  assert.ok(!changedElsewhere('', 'r2'), 'nothing known yet: not a conflict');
});

test('a new project’s first save asks, unless the setting says where', () => {
  assert.equal(firstSaveGoes(null, true), 'ask', 'nothing set yet: ask');
  assert.equal(firstSaveGoes('ask', true), 'ask');
  assert.equal(firstSaveGoes('drive', true), 'drive');
  assert.equal(firstSaveGoes('local', true), 'local');
  assert.equal(firstSaveGoes('nonsense', true), 'ask');
  assert.equal(firstSaveGoes('drive', false), 'local', 'Drive not connected here: save as before');
  assert.equal(firstSaveGoes('ask', false), 'local');
});

test('a typed project name is made safe for a file', () => {
  assert.equal(projectName('  Pilot  ', 'script'), 'Pilot');
  assert.equal(projectName('Pilot.scribecue', 'script'), 'Pilot');
  assert.equal(projectName('Pilot.SCRIBECUE', 'script'), 'Pilot');
  assert.equal(projectName('Ep 1/2: "Cold open"', 'script'), 'Ep 1 2 Cold open');
  assert.equal(projectName('', 'script'), 'script');
  assert.equal(projectName('  ..  ', 'script'), 'script');
  assert.equal(projectName('a'.repeat(300), 'script').length, 120);
});

test('saves to Drive run one at a time, and a failed one doesn’t stop the next', async () => {
  const run = oneAtATime();
  const log = [];
  const job = (name, ms, fail) => () => new Promise((ok, no) => {
    log.push(`start ${name}`);
    setTimeout(() => { log.push(`end ${name}`); fail ? no(new Error(name)) : ok(name); }, ms);
  });
  const a = run(job('autosave', 20));
  const b = run(job('save', 1, true));
  const c = run(job('again', 1));
  assert.equal(await a, 'autosave');
  await assert.rejects(b, /save/);
  assert.equal(await c, 'again');
  assert.deepEqual(log, ['start autosave', 'end autosave', 'start save', 'end save', 'start again', 'end again']);
});

test('a newer version in Drive opens, or asks when there are changes here', () => {
  const meta = (rev, trashed = false) => ({ id: 'f1', name: 'Ep 4.scribecue', headRevisionId: rev, trashed });
  assert.equal(newerInDrive('r1', meta('r1'), false), 'same');
  assert.equal(newerInDrive('r1', meta('r1'), true), 'same');
  assert.equal(newerInDrive('r1', meta('r2'), false), 'open');
  assert.equal(newerInDrive('r1', meta('r2'), true), 'ask');
  assert.equal(newerInDrive('r1', null, true), 'gone');
  assert.equal(newerInDrive('r1', meta('r2', true), false), 'gone');
  // A revision never known (an old handle) isn't taken for a change.
  assert.equal(newerInDrive('', meta('r2'), true), 'same');
});
