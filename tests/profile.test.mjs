import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, savedName, saveName, NAME_MAX } from '../app/js/profile.js';
const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };

test('a saved name is tidied and read back', () => {
  const s = memory();
  assert.equal(saveName('  Sam   Lee ', s), 'Sam Lee');
  assert.equal(savedName(s), 'Sam Lee');
});

test('saving an empty name forgets it, so nothing is kept', () => {
  const s = memory();
  saveName('Sam', s); saveName('   ', s);
  assert.equal(savedName(s), '');
  assert.equal(s.m.size, 0);
});

test('names are capped and storage errors never break comments', () => {
  assert.equal(cleanName('x'.repeat(NAME_MAX + 20)).length, NAME_MAX);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} };
  assert.equal(savedName(broken), '');
  assert.equal(saveName('Sam', broken), 'Sam');
  assert.equal(savedName(undefined), '');
});
