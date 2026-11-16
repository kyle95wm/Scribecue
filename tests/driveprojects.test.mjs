import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyName, filterProjects, isDriveRef, driveRef, changedElsewhere } from '../app/js/driveprojects.js';

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
