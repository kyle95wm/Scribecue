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

test('branchTag names a test build, and nothing for a release', async () => {
  const { branchTag } = await import('../app/js/update.js');
  assert.equal(branchTag('dev'), 'dev');
  assert.equal(branchTag('fix/playhead'), 'fix/playhead');
  assert.equal(branchTag('main'), '');
  assert.equal(branchTag(''), '');
  assert.equal(branchTag(undefined), '');
});

test('the checked-in config names no branch, so releases show none', async () => {
  const { BRANCH } = await import('../app/js/config.js');
  assert.equal(BRANCH, '');
});

test('the Docker build can only set the branch line it looks for', async () => {
  const { readFile } = await import('node:fs/promises');
  const config = await readFile(new URL('../app/js/config.js', import.meta.url), 'utf8');
  const docker = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(config, /^export const BRANCH = '';$/m);
  assert.ok(docker.includes("s|^export const BRANCH = '';|"));
});
