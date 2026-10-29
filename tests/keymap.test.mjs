import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, RESERVED, comboOf, bindings, lookup, assign, unassign, resetAction, ownerOf, exportKeys, importKeys, keyLabels, comboText } from '../app/js/keymap.js';

test('the defaults are the Frazier layout, with no key doing two things', () => {
  const seen = new Map();
  for (const { id, keys } of ACTIONS) {
    for (const k of keys) {
      assert.ok(!seen.has(k), `${k} is on both ${seen.get(k)} and ${id}`);
      assert.ok(!RESERVED[k], `${k} on ${id} is reserved`);
      seen.set(k, id);
    }
  }
  const m = lookup();
  assert.equal(m.get('Space'), 'play');
  assert.equal(m.get('Alt+Shift+ArrowLeft'), 'blockBack');
  assert.equal(m.get('KeyH'), 'hold');
});

test('a key press becomes a combo, and Ctrl/Cmd combinations are left alone', () => {
  assert.equal(comboOf({ code: 'ArrowLeft', altKey: true, shiftKey: true }), 'Alt+Shift+ArrowLeft');
  assert.equal(comboOf({ code: 'KeyN' }), 'KeyN');
  assert.equal(comboOf({ code: 'KeyS', metaKey: true }), null);
  assert.equal(comboOf({ code: 'ShiftLeft', shiftKey: true }), null);
  assert.equal(comboOf({ code: '' }), null);
});

test('giving a key to an action takes it from the one that had it', () => {
  let { changes, movedFrom } = assign({}, 'split', 'KeyN');
  assert.equal(movedFrom, 'newBlock');
  assert.deepEqual(bindings(changes).split, ['KeyX', 'KeyN']);
  assert.deepEqual(bindings(changes).newBlock, []);
  assert.equal(ownerOf(changes, 'KeyN'), 'split');
  changes = unassign(changes, 'split', 'KeyX');
  assert.deepEqual(bindings(changes).split, ['KeyN']);
  changes = resetAction(changes, 'split');
  assert.deepEqual(bindings(changes).split, ['KeyX']);
  // only changes are kept
  assert.deepEqual(Object.keys(changes), ['newBlock']);
  assert.deepEqual(assign({}, 'play', 'Escape').refused, RESERVED.Escape);
  assert.deepEqual(assign({}, 'play', 'Space').changes, {}); // already its own
});

test('shortcuts go out to a file and come back', () => {
  const { changes } = assign({}, 'split', 'Alt+KeyS');
  const file = JSON.parse(JSON.stringify(exportKeys(changes)));
  assert.equal(file.scribecue, 'shortcuts');
  assert.deepEqual(file.keys.split, ['KeyX', 'Alt+KeyS']);
  assert.deepEqual(importKeys(file).changes, changes);
  assert.throws(() => importKeys({ keys: {} }), /isn’t a Scribecue shortcuts file/);
  assert.throws(() => importKeys({ scribecue: 'shortcuts', version: 9, keys: {} }), /newer version/);
});

test('a shared file with mistakes is read as far as it can be', () => {
  const { changes, skipped } = importKeys({ scribecue: 'shortcuts', version: 1, keys: {
    play: ['KeyP'], split: ['Escape', 'KeyP', 'not a key', 'KeyY'], nonsense: ['KeyZ'],
  } });
  const b = bindings(changes);
  assert.deepEqual(b.play, ['KeyP']);
  assert.deepEqual(b.split, ['KeyY']); // reserved, already used and malformed keys dropped
  assert.ok(skipped.includes('nonsense'));
  assert.ok(skipped.includes('split: Escape'));
  // an action the file didn't mention keeps its defaults
  assert.deepEqual(b.newBlock, ['KeyN']);
});

test('keys are shown for each platform', () => {
  assert.deepEqual(keyLabels('Alt+Shift+ArrowLeft'), ['⌥', '⇧', '←']);
  assert.deepEqual(keyLabels('Alt+Shift+ArrowLeft', false), ['Alt', 'Shift', '←']);
  assert.equal(comboText('Shift+KeyV'), '⇧V');
  assert.equal(comboText('Shift+KeyV', false), 'Shift+V');
  assert.equal(comboText('Alt+Digit0'), '⌥0');
  assert.equal(comboText('Backslash'), '\\');
  assert.equal(comboText('BracketLeft'), '[');
  assert.equal(comboText('Escape'), 'Esc');
});
