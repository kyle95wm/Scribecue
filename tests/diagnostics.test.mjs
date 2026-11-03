import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createLog, describe, watchErrors, spread, hideNames, report, MAX_LOG } from '../app/js/diagnostics.js';

test('the log keeps the most recent entries, on one line each', () => {
  let t = 0;
  const log = createLog(3, () => ++t);
  for (const s of ['a', 'b\n  c', '', 'd', 'e']) log.add('message', s);
  assert.deepEqual(log.entries.map((e) => e.text), ['b c', 'd', 'e'], 'empty ones are skipped, the oldest go');
  log.add('error', 'x'.repeat(2000));
  assert.ok(log.entries.at(-1).text.length <= 500);
  assert.equal(MAX_LOG, 200);
});

test('errors, rejections and console errors and warnings are logged, and still reach the console', () => {
  const handlers = {}, seen = [];
  const w = {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    console: { error: (...a) => seen.push(['error', ...a]), warn: (...a) => seen.push(['warn', ...a]), log() {} },
  };
  const log = createLog();
  watchErrors(log, w);
  handlers.error({ message: 'Boom', filename: 'http://x/js/app.js', lineno: 12 });
  handlers.error({ message: '' });
  handlers.unhandledrejection({ reason: new TypeError('bad type') });
  w.console.error('Couldn’t read', new RangeError('too far'));
  w.console.warn({ a: 1 });
  assert.deepEqual(log.entries.map((e) => [e.kind, e.text]), [
    ['error', 'Boom (app.js:12)'],
    ['error', 'TypeError: bad type'],
    ['error', 'Couldn’t read RangeError: too far'],
    ['warning', '{"a":1}'],
  ]);
  assert.equal(seen.length, 2, 'the console still gets them');
  assert.equal(describe(null), 'null');
});

test('jump times show as typical and slowest', () => {
  assert.equal(spread([]), null);
  assert.deepEqual(spread([300, 2100, 400, 500]), { n: 4, typical: 400, slowest: 2100 });
});

test('file names are left out unless asked for', () => {
  assert.equal(hideNames('Couldn’t open Alien.mkv or Alien.mkv', ['Alien.mkv', '', 'ab']), 'Couldn’t open ‹file› or ‹file›');
  assert.equal(hideNames('Press ? for shortcuts. Loaded short (1).mp4, short', ['short (1).mp4', 'short']),
    'Press ? for shortcuts. Loaded ‹file›, ‹file›', 'whole names only, the longest first');
  const now = new Date(2026, 10, 3, 14, 5).getTime();
  const info = {
    now, names: ['Alien Theatrical.mkv'],
    app: { version: '0.77.4', web: true, installed: true, mode: 'Write' },
    browser: { name: 'Chromium 131', platform: 'Linux', cores: 4, memory: 8, screen: '1920×1080', dpr: 1 },
    storage: { used: 1.2e9, quota: 50e9 },
    video: { name: 'Alien Theatrical.mkv', bytes: 4.2e9, duration: 6710, width: 1920, height: 1080, codec: 'H.264', fps: 23.976,
      decode: { smooth: true, powerEfficient: false }, audio: ['AAC'], frames: { total: 1000, dropped: 25 } },
    waveform: { ms: 99e3 },
    jumps: [400, 2100, 500, 40],
    longTasks: { count: 3, longest: 120.4, minutes: 5 },
    log: [{ at: now - 12e3, kind: 'message', text: 'Couldn’t open Alien Theatrical.mkv' }, { at: now - 3e3, kind: 'error', text: 'TypeError: x' }],
  };
  const text = report(info);
  assert.match(text, /Made 2026-11-03 14:05/);
  assert.match(text, /Version {6}0\.77\.4, web version, installed app/);
  assert.match(text, /Memory {7}8 GB or more/);
  assert.match(text, /Storage {6}1\.2 GB used of 50\.0 GB/);
  assert.match(text, /File {9}\(name left out\)/);
  assert.match(text, /Size {9}4\.2 GB, 1:51:50/);
  assert.match(text, /Picture {6}1920×1080, H\.264, 23\.976 fps/);
  assert.match(text, /Decoding {5}smooth, not power-efficient \(likely without the graphics chip\)/);
  assert.match(text, /Frames {7}1000 shown, 25 dropped \(2\.5%\)/);
  assert.match(text, /Waveform {5}built in 99 s/);
  assert.match(text, /Jumps {8}last 4: typical 400 ms, slowest 2\.1 s/);
  assert.match(text, /Long tasks {3}3 in the last 5 min, longest 120 ms/);
  assert.match(text, / {3}−0:12 {2}message {2}Couldn’t open ‹file›/);
  assert.match(text, / {3}−0:03 {2}error {4}TypeError: x/);
  assert.ok(!text.includes('Alien'), 'no file name anywhere');
  assert.match(report(info, { names: true }), /File {9}Alien Theatrical\.mkv/);
  assert.match(report({ ...info, video: { ...info.video, decode: { supported: false } } }), /Decoding {5}this browser says it can’t/);
  assert.match(report({ now }), /none open[\s\S]*Jumps {8}none yet[\s\S]*Recent messages\n {2}/);
});

test('the diagnostics skill explains every row of the report, for Claude and Codex', () => {
  const skill = '.claude/skills/scribecue-diagnostics/SKILL.md';
  const text = readFileSync(skill, 'utf8');
  assert.match(text, /^---\nname: scribecue-diagnostics\ndescription: .+\n---\n/);
  assert.equal(realpathSync('.agents/skills/scribecue-diagnostics/SKILL.md'), realpathSync(skill));
  const code = readFileSync('app/js/diagnostics.js', 'utf8');
  const rows = [...code.matchAll(/row\('([^']+)'/g)].map((m) => m[1]);
  assert.ok(rows.length >= 15);
  for (const label of new Set(rows)) assert.ok(text.includes(`| **${label}** |`), `${label} is missing from the skill`);
  for (const section of ['App', 'Computer', 'Video', 'Performance']) assert.ok(text.includes(`### ${section}\n`), section);
  const form = readFileSync('.github/ISSUE_TEMPLATE/bug_report.yml', 'utf8');
  assert.match(form, /id: diagnostics\n\s+attributes:\n\s+label: Diagnostics\n[\s\S]*?render: text/);
  for (const heading of ['Diagnostics', 'What happened', 'What you expected', 'Steps to make it happen', 'Analysis']) {
    assert.ok(form.includes(`label: ${heading}\n`), `${heading} is missing from the bug form`);
    assert.ok(text.includes(`### ${heading}\n`), `${heading} is missing from the skill's draft`);
  }
});
