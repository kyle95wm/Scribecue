import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeTip } from '../app/js/tooltip.js';

const view = { width: 1280, height: 720 };
const box = (left, top, width = 60, height = 28) => ({ left, top, right: left + width, bottom: top + height });
const inside = (p, size) => p.x >= 8 && p.y >= 8 && p.x + size.width <= view.width - 8 && p.y + size.height <= view.height - 8;

test('a tooltip goes centred below its element', () => {
  const size = { width: 200, height: 40 };
  assert.deepEqual(placeTip(box(500, 100), size, view), { x: 430, y: 136, side: 'below' });
});

test('a tooltip near an edge stays inside the window', () => {
  const size = { width: 260, height: 60 };
  const right = placeTip(box(1230, 10, 48), size, view);
  assert.equal(right.x, 1280 - 8 - 260, 'pulled in from the right');
  assert.ok(inside(right, size));
  const left = placeTip(box(0, 10, 30), size, view);
  assert.equal(left.x, 8, 'pulled in from the left');
});

test('a tooltip goes above when there is no room below, and below when there is none above', () => {
  const size = { width: 200, height: 60 };
  const low = placeTip(box(500, 690), size, view);
  assert.equal(low.side, 'above');
  assert.equal(low.y, 690 - 8 - 60);
  // The footer asks for above; at the top of the window it goes below anyway.
  assert.equal(placeTip(box(500, 690), size, view, { above: true }).side, 'above');
  assert.equal(placeTip(box(500, 10), size, view, { above: true }).side, 'below');
});

test('a tooltip that fits neither way takes the side with more room, still inside', () => {
  const size = { width: 200, height: 300 };
  const tall = box(500, 300, 60, 200); // 300 above, 220 below
  const p = placeTip(tall, size, view);
  assert.equal(p.side, 'above');
  assert.ok(inside(p, size));
});

test('a tooltip wider than the window starts at its margin', () => {
  assert.equal(placeTip(box(100, 100), { width: 2000, height: 40 }, view).x, 8);
});
