import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserName, supported, missingFeatures, knownIssues, noticeItems, isMobile } from '../app/js/browser.js';

const brands = (...b) => b.map((brand) => ({ brand, version: '1' }));

test('Chrome and Edge are recognised and need no notice', () => {
  assert.equal(browserName('Mozilla/5.0 Chrome/140.0 Safari/537.36', brands('Google Chrome', 'Chromium', 'Not=A?Brand')), 'Chrome');
  assert.equal(browserName('Mozilla/5.0 Chrome/140.0 Safari/537.36 Edg/140.0', brands('Microsoft Edge', 'Chromium')), 'Edge');
  assert.equal(browserName('Mozilla/5.0 HeadlessChrome/140.0 Safari/537.36', brands('Chromium')), 'Chrome');
  assert.ok(supported('Chrome') && supported('Edge'));
});

test('other browsers are named, so the notice can say which', () => {
  assert.equal(browserName('Mozilla/5.0 (Macintosh) Gecko/20100101 Firefox/131.0'), 'Firefox');
  assert.equal(browserName('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'), 'Safari');
  assert.equal(browserName('Mozilla/5.0 Chrome/140.0 Safari/537.36', brands('Brave', 'Chromium')), 'Brave');
  assert.equal(browserName('Mozilla/5.0 Chrome/140.0 Safari/537.36 OPR/115.0', brands('Opera', 'Chromium')), 'Opera');
  assert.equal(browserName('Mozilla/5.0 Chrome/140.0', brands('Chromium', 'Not_A Brand')), 'this browser');
  assert.ok(!supported('Safari') && !supported('Firefox') && !supported('Brave'));
});

test('the notice lists only the features this browser lacks', () => {
  assert.deepEqual(missingFeatures({ AudioDecoder: 1, showSaveFilePicker: () => {}, onbeforeinstallprompt: null, speechSynthesis: {} }), []);
  const firefox = missingFeatures({ AudioDecoder: 1, speechSynthesis: {} });
  assert.equal(firefox.length, 2);
  assert.match(firefox[0], /autosave, and saving a project/);
  assert.match(firefox[1], /Install app/);
  assert.equal(missingFeatures({}).length, 4);
});

test('Firefox’s known problems are listed after what it lacks', () => {
  const items = noticeItems('Firefox', { AudioDecoder: 1, speechSynthesis: {} });
  assert.equal(items.length, 4);
  assert.match(items[2], /description track/);
  assert.match(items[3], /speech to text/);
  assert.deepEqual(knownIssues('Chrome'), []);
  assert.deepEqual(knownIssues('Safari'), []);
});

test('phones and tablets are recognised, so they get the notice', () => {
  assert.ok(isMobile({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148' }));
  assert.ok(isMobile({ ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/140.0 Mobile Safari/537.36' }));
  assert.ok(isMobile({ ua: 'Mozilla/5.0 (Linux; Android 14; SM-X710) Chrome/140.0 Safari/537.36' }), 'Android tablet');
  assert.ok(isMobile({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15', touchPoints: 5 }), 'iPad as a Mac');
  assert.ok(isMobile({ ua: 'Mozilla/5.0 Chrome/140.0', mobile: true }));
  assert.ok(!isMobile({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0 Safari/537.36', touchPoints: 0 }));
  assert.ok(!isMobile({ ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Safari/537.36 Edg/140.0', touchPoints: 10 }), 'a Windows touch laptop');
});

test('browsers too old for Scribecue are told so, instead of seeing a blank page', async () => {
  const { readFileSync } = await import('node:fs');
  const vm = await import('node:vm');
  const ctx = {};
  vm.runInNewContext(readFileSync(new URL('../app/js/old.js', import.meta.url), 'utf8'), ctx);
  const now = { Array: { prototype: { findLast() {} } }, HTMLDialogElement: function () {}, structuredClone() {} };
  assert.equal(ctx.scribecueTooOld(now), false);
  assert.equal(ctx.scribecueTooOld({ ...now, Array: { prototype: {} } }), true, 'no findLast: before 2022');
  assert.equal(ctx.scribecueTooOld({ ...now, HTMLDialogElement: undefined }), true);
  assert.equal(ctx.scribecueTooOld({}), true);
  // It has to parse in old browsers: no arrows, let/const, classes or template strings.
  const code = readFileSync(new URL('../app/js/old.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /=>|\blet\b|\bconst\b|\bclass\b|`|\?\.|\?\?/);
});
