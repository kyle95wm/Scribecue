import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offerDocker } from '../app/js/dockertip.js';

test('the Docker note shows once in the web version, after setup and the loop card', () => {
  const ready = { hosted: true, welcomed: true, loopSeen: true, seen: false };
  assert.equal(offerDocker(ready), true);
  // Already running with Docker.
  assert.equal(offerDocker({ ...ready, hosted: false }), false);
  // Still setting up, or not yet shown how the editor works.
  assert.equal(offerDocker({ ...ready, welcomed: false }), false);
  assert.equal(offerDocker({ ...ready, loopSeen: false }), false);
  // Only once.
  assert.equal(offerDocker({ ...ready, seen: true }), false);
});
