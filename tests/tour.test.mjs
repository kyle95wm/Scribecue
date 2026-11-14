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
  // the setup is only mentioned when it really comes next, on a first visit
  assert.match(STEPS.at(-1).text('write', { setupNext: true }), /Next comes a short setup/);
  assert.doesNotMatch(STEPS.at(-1).text('write'), /setup/);
  // Settings is where text to speech or speech to text is turned on, by mode
  const set = STEPS.find((s) => s.title === 'Settings');
  assert.match(set.text('write'), /Text to speech/);
  assert.match(set.text('transcribe'), /Whisper/);
  assert.doesNotMatch(set.text('write'), /Whisper/);
  assert.match(set.text('transcribe'), /Search at the top finds any setting/);
  // what's said changes with the mode
  const tl = STEPS.find((s) => s.target === '#tl');
  assert.match(tl.text('transcribe'), /Holding H/);
  assert.match(tl.text('write'), /Enter makes a block/);
  const ind = STEPS.find((s) => s.target === '#ind');
  assert.match(ind.text('write'), /TTS turns text to speech off or on for this project/);
  assert.doesNotMatch(ind.text('transcribe'), /TTS/);
});

test('the tour covers sharing, comments, exports and what sharing sends', () => {
  const share = STEPS.find((s) => s.target === '#shareBtn');
  assert.equal(share.title, 'Working together');
  assert.match(share.text('write'), /link and a password/);
  // Transcribe mode has no comments.
  assert.match(share.text('write'), /Comments/);
  assert.doesNotMatch(share.text('transcribe'), /Comments/);
  // Bookmarks are the writer's: their button is hidden in QC, so the step is too.
  const marks = STEPS.find((s) => s.target === '#bookmarksBtn');
  assert.equal(marks.title, 'Bookmarks');
  assert.match(marks.text('write'), /flag on the ruler/);
  assert.match(marks.text('transcribe'), /Frazier/);
  assert.equal(STEPS.indexOf(marks), STEPS.indexOf(share) + 1, 'right after Share and Comments, as in the header');
  const out = STEPS.find((s) => s.title === 'Projects and exports');
  assert.match(out.text('write'), /QC package for a reviewer, a recording file for a narrator/);
  assert.doesNotMatch(out.text('transcribe'), /QC package|narrator/);
  assert.match(out.text('transcribe'), /SRT or WebVTT/);
  for (const mode of ['write', 'transcribe']) assert.match(out.text(mode), /DAW markers and a video with subtitles|DAW markers or a video with subtitles/);
  const privacy = STEPS.find((s) => s.title === 'Your work stays yours').text('write');
  assert.match(privacy, /sharing/);
  assert.match(privacy, /encrypted on your computer/);
  // Scripts can be shared now; video and audio never leave the computer.
  assert.doesNotMatch(privacy, /scripts are opened/);
  assert.match(privacy, /video and audio are opened straight from your computer and never uploaded/);
});

test('steps only show what is there to see', () => {
  const write = stepsFor('write'), transcribe = stepsFor('transcribe');
  assert.ok(write.some((s) => s.title === 'Settings') && transcribe.some((s) => s.title === 'Settings'));
  assert.ok(write.some((s) => s.title === 'What’s on'));
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
  assert.equal(step.title('record'), 'The recording loop');
  const r = loop('record', (id) => ({ ...keys, blockNext: '⌥⇧→' })[id]);
  assert.match(r, /1\. Record it\. Press Enter or R/);
  assert.match(r, /2\. Tidy it\. S trims the silence/);
  assert.match(r, /next block with ⌥⇧→/);
  assert.match(r, /Punch in: E puts the playhead at the end of the take/);
  assert.match(r, /Shift\+Enter or Shift\+R records from there/);
  assert.doesNotMatch(r, /Hold|narrator speaks/, 'not the transcribing loop');
  // a changed key shows in the loop
  assert.match(loop('transcribe', (id) => (id === 'hold' ? 'Y' : keys[id])), /Hold Y while/);
});


test('the QC loop explains fixed timings and commenting without editing instructions', () => {
  const text = loop('qc');
  assert.match(text, /timings stay fixed/);
  assert.match(text, /Comment/);
  assert.doesNotMatch(text, /Hold|Drag|Type the line/);
});
