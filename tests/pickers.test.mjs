import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { PICKERS, refused } from '../app/js/pickers.js';

// scripts/picker-check.mjs asks Chrome about PICKERS, so a picker opened anywhere else
// would go unchecked.
test('every file picker opens through pickers.js', () => {
  for (const f of readdirSync(new URL('../app/js/', import.meta.url))) {
    if (!f.endsWith('.js') || f === 'pickers.js') continue;
    const src = readFileSync(new URL(`../app/js/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /show(Open|Save)FilePicker\(|showDirectoryPicker\(/, f);
  }
});

test('picker extensions follow Chrome’s rules', () => {
  for (const [name, { types = [] }] of Object.entries(PICKERS)) {
    for (const ext of types.flatMap((t) => Object.values(t.accept).flat())) {
      assert.match(ext, /^\.[a-z0-9+.]{1,15}$/i, `${name}: ${ext}`);
      assert.ok(!ext.endsWith('.'), `${name}: ${ext}`);
    }
  }
});

test('only a picker Chrome refused counts as refused', () => {
  assert.ok(refused(new TypeError('Extension too long')));
  for (const name of ['AbortError', 'SecurityError', 'NotAllowedError']) assert.ok(!refused(new DOMException('x', name)));
});
