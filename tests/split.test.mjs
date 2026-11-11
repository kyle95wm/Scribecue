import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usualWidth, widthOf, shareFor, stepShare, readShare, LIST_MIN, VIDEO_MIN, SNAP } from '../app/js/split.js';

const W = 1600;

test('the usual width matches the CSS: 38%, at least 380 px', () => {
  assert.equal(usualWidth(W), 608);
  assert.equal(usualWidth(900), 380);
  assert.equal(widthOf(null, W), 608);
});

test('dragging near the usual width snaps back to it', () => {
  assert.equal(shareFor(608, W), null);
  assert.equal(shareFor(608 + SNAP, W), null);
  assert.equal(shareFor(608 - SNAP, W), null);
  assert.notEqual(shareFor(608 + SNAP + 1, W), null);
});

test('dragging to the list side hides the list', () => {
  assert.equal(shareFor(LIST_MIN - 1, W), 0);
  assert.equal(shareFor(0, W), 0);
  assert.equal(shareFor(-50, W), 0);
  assert.equal(widthOf(0, W), 0);
  assert.equal(shareFor(LIST_MIN, W), LIST_MIN / W);
});

test('dragging to the video side leaves the video some room', () => {
  assert.equal(shareFor(W, W), (W - VIDEO_MIN) / W);
  assert.equal(shareFor(W + 200, W), (W - VIDEO_MIN) / W);
  assert.equal(widthOf(0.99, W), W - VIDEO_MIN);
});

test('a share holds when the window changes size', () => {
  const s = shareFor(1000, W);
  assert.equal(widthOf(s, 2000), 1250);
  assert.equal(widthOf(s, 600), 600 - VIDEO_MIN); // the video keeps its room
});

test('arrow keys step the width, stopping at the usual width and hiding at the edge', () => {
  assert.equal(stepShare(null, 1, W), (608 + 0.05 * W) / W);
  assert.equal(stepShare((608 + 0.05 * W) / W, -1, W), null); // stops at the usual width
  assert.equal(stepShare(LIST_MIN / W, -1, W), 0); // at the narrowest: hides
  assert.equal(stepShare(0, 1, W), LIST_MIN / W); // hidden: comes back at the narrowest
  assert.equal(stepShare((W - VIDEO_MIN) / W, 1, W), (W - VIDEO_MIN) / W);
  assert.equal(stepShare(null, 1, 0), null);
});

test('a stored width that makes no sense is the usual width', () => {
  assert.equal(readShare(null), null);
  assert.equal(readShare(''), null);
  assert.equal(readShare('abc'), null);
  assert.equal(readShare('1.5'), null);
  assert.equal(readShare('-1'), null);
  assert.equal(readShare('0'), 0);
  assert.equal(readShare('0.5'), 0.5);
});
