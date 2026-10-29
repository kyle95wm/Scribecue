import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, stepsFor, loop, LOOP_STEP } from '../app/js/tour.js';

test('the tour covers both modes, privacy and how to find it again', () => {
  for (const s of STEPS) {
    assert.ok(s.title && s.text('write') && s.text('transcribe'));
  }
  const titles = STEPS.map((s) => (typeof s.title === 'function' ? s.title('write') : s.title));
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

test('the loop for each mode, in the keys the person uses, has a card of its own', () => {
  assert.ok(!STEPS.some((s) => typeof s.title === 'function'), 'the loop is no longer a tour step');
  const step = LOOP_STEP;
  assert.equal(step.title('write'), 'The writing loop');
  assert.equal(step.title('transcribe'), 'The transcribing loop');
  const keys = { play: 'Space', frameBack: '←', frameFwd: '→', createEdit: '↵', read: 'V', hold: 'H', loopBlock: 'L' };
  const w = loop('write', (id) => keys[id]);
  assert.match(w, /1\. Find a gap\. Space plays/);
  assert.match(w, /3\. Hear it\. V reads it/);
  const t = loop('transcribe', (id) => keys[id]);
  assert.match(t, /Hold H while the narrator speaks/);
  assert.match(t, /L loops its block/);
  // a changed key shows in the loop
  assert.match(loop('transcribe', (id) => (id === 'hold' ? 'Y' : keys[id])), /Hold Y while/);
});
