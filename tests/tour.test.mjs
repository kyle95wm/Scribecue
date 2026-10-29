import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, stepsFor } from '../app/js/tour.js';

test('the tour covers both modes, privacy and how to find it again', () => {
  for (const s of STEPS) {
    assert.ok(s.title && s.text('write') && s.text('transcribe'), s.title);
  }
  const titles = STEPS.map((s) => s.title);
  assert.ok(titles.includes('Your work stays yours'));
  assert.match(STEPS.at(-1).text('write'), /shortcuts overlay can show you this tour again/);
  // what's said changes with the mode
  const tl = STEPS.find((s) => s.target === '#tl');
  assert.match(tl.text('transcribe'), /Holding H/);
  assert.match(tl.text('write'), /Enter makes a block/);
});

test('steps only show what is there to see', () => {
  const write = stepsFor('write'), transcribe = stepsFor('transcribe');
  assert.ok(write.some((s) => s.title === 'Text to speech'));
  assert.ok(!transcribe.some((s) => s.title === 'Text to speech'));
  // a part of the page that's hidden is skipped, while steps without one stay
  const without = stepsFor('write', (sel) => sel !== '#aiBtn');
  assert.ok(!without.some((s) => s.target === '#aiBtn'));
  assert.equal(without[0].title, 'Welcome to Scribecue');
});
