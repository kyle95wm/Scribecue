import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { entriesBetween, renderNotes } from '../app/js/whatsnew.js';
import { VERSION, newer } from '../app/js/update.js';

const log = JSON.parse(readFileSync(new URL('../app/changelog.json', import.meta.url), 'utf8'));

test('every release has notes, newest first, including this version', () => {
  // Notes for the next release can be written ahead of it, but never left out.
  assert.ok(log.some((e) => e.version === VERSION), `add notes for ${VERSION} to app/changelog.json`);
  assert.ok(!newer(VERSION, log[0].version), 'the newest notes are older than this version');
  for (let i = 1; i < log.length; i++) assert.ok(newer(log[i - 1].version, log[i].version), `${log[i - 1].version} should come before ${log[i].version}`);
  for (const e of log) {
    assert.match(e.version, /^\d+\.\d+\.\d+$/);
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(e.notes.trim(), `${e.version} has no notes`);
  }
  const versions = log.map((e) => e.version);
  assert.equal(new Set(versions).size, versions.length, 'a version is listed twice');
});

test('an update shows every release since the version someone was on', () => {
  const sample = [{ version: '0.3.0' }, { version: '0.2.1' }, { version: '0.2.0' }, { version: '0.1.0' }].map((e) => ({ ...e, date: '2026-01-01', notes: 'x' }));
  assert.deepEqual(entriesBetween(sample, '0.2.0', '0.3.0').map((e) => e.version), ['0.3.0', '0.2.1']);
  assert.deepEqual(entriesBetween(sample, '0.1.0', '0.2.1').map((e) => e.version), ['0.2.1', '0.2.0']);
  assert.deepEqual(entriesBetween(sample, null, '0.2.1').map((e) => e.version), ['0.2.1']);
  assert.deepEqual(entriesBetween(sample, '0.3.0', '0.3.0'), []);
});

test('notes become simple HTML, and nothing else in them does', () => {
  const html = renderNotes('## New\n\n- **Bold** and `code`, see [the guide](https://example.com/x).\n- <img src=x onerror=alert(1)>\n\nA [bad link](javascript:alert(1)) stays text.');
  assert.match(html, /<h4>New<\/h4><ul><li><strong>Bold<\/strong> and <code>code<\/code>, see <a href="https:\/\/example.com\/x" target="_blank" rel="noopener noreferrer">the guide<\/a>\.<\/li>/);
  assert.match(html, /<li>&lt;img src=x onerror=alert\(1\)&gt;<\/li>/);
  assert.doesNotMatch(html, /href="javascript/);
  assert.match(html, /<p>A \[bad link\]\(javascript:alert\(1\)\) stays text\.<\/p>/);
  // every real release renders without leaving markdown markers behind
  for (const e of log) assert.doesNotMatch(renderNotes(e.notes), /^#|\*\*/m, e.version);
});
