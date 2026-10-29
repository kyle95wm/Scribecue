import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserName, supported, missingFeatures, knownIssues, noticeItems } from '../app/js/browser.js';

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
