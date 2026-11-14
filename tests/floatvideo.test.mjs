import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fitPicture, readRect, readKind, defaultRect, place, resized, isDrag, MIN_W, BAR } from '../app/js/floatvideo.js';
import { settingNames } from '../app/js/settingsfile.js';

test('the picture fits its box as the video shows it', () => {
  assert.deepEqual(fitPicture(1600, 450, 16 / 9), { x: 400, y: 0, w: 800, h: 450 });
  assert.deepEqual(fitPicture(800, 800, 16 / 9), { x: 0, y: 175, w: 800, h: 450 });
  assert.deepEqual(fitPicture(0, 300, 16 / 9), { x: 0, y: 0, w: 0, h: 0 });
  // Before the video says its size, the picture is the whole box.
  assert.deepEqual(fitPicture(640, 300, 0), { x: 0, y: 0, w: 640, h: 300 });
});

test('a stored panel is read back, and anything else is ignored', () => {
  assert.deepEqual(readRect('{"x":10,"y":20,"w":400}'), { x: 10, y: 20, w: 400 });
  for (const raw of [null, '', 'nope', '[]', '{"x":1,"y":2}', '{"x":1,"y":2,"w":0}', '{"x":"1","y":2,"w":300}']) assert.equal(readRect(raw), null, raw);
});

test('the kind of window is a tab panel unless it says otherwise', () => {
  assert.equal(readKind('window'), 'window');
  assert.equal(readKind('panel'), 'panel');
  assert.equal(readKind(null), 'panel');
  assert.equal(readKind('fullscreen'), 'panel');
});

test('a new panel goes at the top right of the spot the video left', () => {
  const r = defaultRect(1500, 900, 16 / 9, { right: 1500, top: 44 });
  assert.equal(r.w, 500);
  assert.equal(r.x, 1500 - 500 - 16);
  assert.equal(r.y, 44 + 16);
});

test('a panel stays big enough, and on the screen', () => {
  const a = 16 / 9;
  assert.equal(place({ x: 0, y: 0, w: 50 }, 1280, 800, a).w, MIN_W);
  // No wider than the window, nor taller with its title bar.
  assert.ok(place({ x: 0, y: 0, w: 5000 }, 1280, 800, a).w / a + BAR <= 800);
  // Dragged off to the left or the bottom: some of it stays in view.
  const off = place({ x: -2000, y: 5000, w: 400 }, 1280, 800, a);
  assert.ok(off.x + 400 >= 48);
  assert.ok(off.y <= 800 - 48);
  // Its title bar never goes above the top, so it can always be grabbed.
  assert.equal(place({ x: 100, y: -300, w: 400 }, 1280, 800, a).y, 0);
});

test('resizing by the corner keeps the picture its shape', () => {
  const a = 16 / 9, r = { x: 100, y: 100, w: 400 };
  assert.equal(resized(r, 160, 0, a, 1280, 800).w, 560);
  // Down further than across: the height leads.
  assert.equal(resized(r, 0, 90, a, 1280, 800).w, 560);
  assert.equal(resized(r, -1000, -1000, a, 1280, 800).w, MIN_W);
  // Straight in, or straight up: it gets smaller.
  assert.equal(resized(r, -100, 0, a, 1280, 800).w, 300);
  assert.equal(resized(r, 0, -45, a, 1280, 800).w, 320);
  // It can't grow past the window's edge.
  assert.ok(resized(r, 5000, 0, a, 1280, 800).w <= 1280 - 100);
});

test('resizing by any corner keeps the opposite corner where it was', () => {
  const a = 16 / 9, r = { x: 400, y: 300, w: 400 };
  const right = (q) => q.x + q.w, bottom = (q) => q.y + q.w / a + BAR;
  const nw = resized(r, -160, 0, a, 1280, 800, 'nw');
  assert.equal(nw.w, 560);
  assert.equal(right(nw), right(r));
  assert.ok(Math.abs(bottom(nw) - bottom(r)) < 1);
  const ne = resized(r, 160, 0, a, 1280, 800, 'ne');
  assert.equal(ne.x, r.x);
  assert.ok(Math.abs(bottom(ne) - bottom(r)) < 1);
  const sw = resized(r, 160, 0, a, 1280, 800, 'sw');
  assert.equal(sw.w, MIN_W, 'dragging the left corner right makes it smaller');
  assert.equal(right(sw), right(r));
  assert.equal(sw.y, r.y);
  // The top left can't push the panel off the left or top of the window.
  const big = resized(r, -5000, -5000, a, 1280, 800, 'nw');
  assert.ok(big.x >= 0 && big.y >= 0);
});

test('a small move on the picture is a click, a bigger one a drag', () => {
  assert.equal(isDrag(0, 0), false);
  assert.equal(isDrag(2, 2), false);
  assert.equal(isDrag(4, 0), true);
  assert.equal(isDrag(-3, -3), true);
});

test('the setting goes in the settings file, and the page has its buttons', () => {
  assert.ok(settingNames().includes('floatVideo'));
  const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  for (const v of ['panel', 'window']) assert.match(html, new RegExp(`id="floatKind"[^\\n]*data-value="${v}"`));
});
