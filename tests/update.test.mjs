import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERSION, newer } from '../app/js/update.js';

test('VERSION is a plain x.y.z number', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});

test('newer compares versions number by number', () => {
  assert.equal(newer('v0.2.1', '0.2.0'), true);
  assert.equal(newer('0.10.0', '0.9.9'), true);
  assert.equal(newer('1.0.0', '0.99.99'), true);
  assert.equal(newer('v0.2.0', '0.2.0'), false);
  assert.equal(newer('0.1.9', '0.2.0'), false);
  assert.equal(newer('0.3.0-beta', '0.2.0'), true);
  assert.equal(newer('v1', '0.9.0'), true);
});
