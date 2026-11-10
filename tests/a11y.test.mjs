import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { speakable, blockLabel, keepsFocusAfterDialog, toastMs } from '../app/js/a11y.js';

test('key symbols are read as words', () => {
  assert.equal(speakable('Undo with ⌘Z'), 'Undo with Command Z');
  assert.equal(speakable('⌥⇧H opens it'), 'Option Shift H opens it');
  assert.equal(speakable('⌥⇧H opens it', false), 'Alt Shift H opens it');
  assert.equal(speakable('Block #3 marked — type it, then ↵ or Esc to carry on'), 'Block #3 marked, type it, then Enter or Esc to carry on');
  assert.equal(speakable('Start of this block (⌥⇧←)'), 'Start of this block (Option Shift Left arrow)');
  assert.equal(speakable('text → IN → OUT'), 'text Right arrow IN Right arrow OUT');
});

test('a block in the list is read with its number, time, length and text', () => {
  assert.equal(blockLabel({ n: 3, start: '00:00:20.000', secs: '3.80', text: 'A pale <i>blue</i> streak.' }),
    'Block 3, at 00:00:20.000, 3.80 seconds: A pale blue streak.');
  assert.equal(blockLabel({ n: 6, start: '00:00:47.000', secs: '2.50', text: '' }), 'Block 6, at 00:00:47.000, 2.50 seconds: empty');
  assert.match(blockLabel({ n: 1, start: '00:00:01.000', secs: '1.00', text: 'Long line', tooLong: true }), /too long to read in time/);
});

test('a block whose reading is ready says so', () => {
  assert.equal(blockLabel({ n: 2, start: '00:00:11.500', secs: '2.50', text: 'The colours fold.', ready: true }),
    'Block 2, at 00:00:11.500, 2.50 seconds, reading ready: The colours fold.');
});

test('every Export item sits in a named group', () => {
  const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  const menu = html.slice(html.indexOf('id="exportMenu"'), html.indexOf('id="qcPermission"'));
  const groups = menu.split('role="group"').slice(1);
  assert.equal(groups.length, 7);
  for (const g of groups) {
    const id = /aria-labelledby="(\w+)"/.exec(g)?.[1];
    assert.ok(id && g.includes(`class="menuhead" id="${id}"`), `group ${id} has no heading`);
  }
  assert.equal(groups.join('').match(/role="menuitem"/g).length, menu.match(/role="menuitem"/g).length);
});

test('a reviewer with a QC package open in QC has no Export menu: they save and send the package', () => {
  const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app/css/style.css', import.meta.url), 'utf8');
  assert.match(html, /<span class="navwrap export-wrap">\s*<button data-act="exportMenu"/);
  assert.match(css, /\.mode-qc\.qc-package \.export-wrap \{ display: none; \}/);
  assert.ok(!html.includes('exportReturn'), 'no Return package item');
});

test('Esc out of a dialog goes to the timeline, unless a dialog, block or drawer is still in use', () => {
  const inside = (found) => ({ closest: (s) => (found && s.includes(found) ? {} : null) });
  assert.equal(keepsFocusAfterDialog(inside(null), false), false);
  assert.equal(keepsFocusAfterDialog(null, false), false);
  assert.equal(keepsFocusAfterDialog(inside(null), true), true);
  assert.equal(keepsFocusAfterDialog(inside('#editor'), false), true);
  assert.equal(keepsFocusAfterDialog(inside('.aidrawer'), false), true);
});

test('messages show in a slice under the header, not in the footer', () => {
  const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  const at = html.indexOf('id="toast"');
  assert.ok(at > html.indexOf('</header>') && at < html.indexOf('<main>'), 'the slice sits between the header and the main area');
  const footer = html.slice(html.indexOf('<footer class="status">'), html.indexOf('</footer>'));
  assert.ok(!footer.includes('id="toast"'));
  assert.ok(footer.includes('id="announce"'), 'screen readers still hear messages');
});

test('a running job shows its progress and Stop in a slice under the header, above messages', () => {
  const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  const at = html.indexOf('id="jobBox"');
  assert.ok(at > html.indexOf('</header>') && at < html.indexOf('<main>'), 'the job slice sits between the header and the main area');
  assert.ok(at < html.indexOf('id="toast"'), 'messages show under a running job');
  const box = html.slice(at, html.indexOf('</div>', at));
  for (const id of ['jobText', 'jobBar', 'jobStop']) assert.ok(box.includes(`id="${id}"`), id);
  const footer = html.slice(html.indexOf('<footer class="status">'), html.indexOf('</footer>'));
  assert.ok(!footer.includes('id="jobBox"'));
});

test('messages stay up long enough to read, longer for longer ones', () => {
  assert.equal(toastMs('Saved'), 6000);
  assert.ok(toastMs('x'.repeat(100)) > toastMs('x'.repeat(60)));
  assert.equal(toastMs('x'.repeat(500)), 12000);
});

test('a message closes when clicked', () => {
  const app = readFileSync(new URL('../app/js/app.js', import.meta.url), 'utf8');
  assert.match(app, /toastEl\.onclick = \(\) => \{ hideToast\(\);/);
  const css = readFileSync(new URL('../app/css/style.css', import.meta.url), 'utf8');
  assert.match(css, /#toast\.fade \{[^}]*pointer-events: none/);
});

test('a message that needs reading is a dialog with OK', () => {
  const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  assert.match(html, /<dialog id="noticeDlg" class="updbox" aria-labelledby="noticeTitle" aria-describedby="noticeText">/);
  assert.match(html, /id="noticeOk" class="hl">OK</);
  const app = readFileSync(new URL('../app/js/app.js', import.meta.url), 'utf8');
  for (const why of ['endedNotice(detail, false)', 'endedNotice(detail, true)', 'refusedNotice(detail)', "notice('Autosave stopped'", "notice('Project not saved'"]) assert.ok(app.includes(why), why);
  const rec = readFileSync(new URL('../app/js/record.js', import.meta.url), 'utf8');
  assert.ok(rec.includes("h.notice('Take not kept'"));
});
