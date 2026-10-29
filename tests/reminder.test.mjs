import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueReminder, reminderText, REMIND_AFTER, ACTIVE, SNOOZE } from '../app/js/reminder.js';

const min = 60e3, t0 = 1e9;
const at = (o) => dueReminder({ blocks: 12, unsavedSince: t0, lastChange: t0 + 19 * min, now: t0 + 21 * min, ...o });

test('reminds after a while of unsaved work, while someone is working', () => {
  assert.equal(REMIND_AFTER, 20 * min);
  assert.ok(at({}));
  assert.ok(!at({ now: t0 + 19 * min, lastChange: t0 + 18 * min }), 'not before 20 minutes');
  assert.ok(!at({ unsavedSince: null }), 'not when everything is saved');
  assert.ok(!at({ blocks: 0 }), 'not with no blocks');
});

test('leaves an idle tab alone, and waits after Later', () => {
  assert.ok(!at({ lastChange: t0 + 21 * min - ACTIVE - 1 }), 'no change for over 5 minutes');
  const later = t0 + 21 * min;
  assert.ok(!at({ snoozedUntil: later + SNOOZE, now: later + 10 * min, lastChange: later + 9 * min }));
  assert.ok(at({ snoozedUntil: later + SNOOZE, now: later + SNOOZE, lastChange: later + SNOOZE - min }));
});

test('says the work is only in the browser until there’s a project file', () => {
  assert.match(reminderText({ blocks: 3, hasFile: false }).text, /Your 3 blocks are only kept in this browser/);
  assert.match(reminderText({ blocks: 1, hasFile: false }).text, /Your 1 block is only kept/);
  const saved = reminderText({ blocks: 3, hasFile: true, name: 'ep1.scribecue' });
  assert.equal(saved.title, 'Save your changes');
  assert.match(saved.text, /ep1\.scribecue/);
});
