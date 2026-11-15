import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gapsToDraft, splitGap, cutSamples, frameDiff, findCuts, dialogueAround, withBlock, estimate, estimateText, heardSpeech,
  DRAFT_MIN, SPLIT_OVER, PIECE_MIN, PIECE_MAX, PIECE_PAUSE,
} from '../app/js/aiscript.js';
import { draftPrompt, fitBudget } from '../app/js/ai.js';
import { GAP_MARGIN } from '../app/js/dialogue.js';

const close = (a, b) => Math.abs(a - b) < 1e-6;

test('gaps keep a margin from the dialogue, and short ones are left out', () => {
  const free = [{ start: 1, end: 6 }, { start: 10, end: 11.5 }, { start: 20, end: 30 }];
  const out = gapsToDraft(free);
  assert.equal(out.length, 2);
  assert.ok(close(out[0].start, 1 + GAP_MARGIN) && close(out[0].end, 6 - GAP_MARGIN));
  assert.ok(out.every((g) => g.end - g.start >= DRAFT_MIN));
});

test('a range cuts gaps, with no margin at the cut', () => {
  const out = gapsToDraft([{ start: 0, end: 20 }, { start: 30, end: 40 }], 5, 35);
  assert.deepEqual(out.map((g) => [g.start, g.end]), [[5, 20 - GAP_MARGIN], [30 + GAP_MARGIN, 35]]);
  assert.deepEqual(gapsToDraft([{ start: 0, end: 20 }], 25, 30), []);
});

test('a short gap stays whole', () => {
  assert.deepEqual(splitGap({ start: 3, end: 3 + SPLIT_OVER }), [{ start: 3, end: 3 + SPLIT_OVER }]);
});

test('a long gap splits evenly without cuts, with every piece in bounds', () => {
  for (const len of [10.5, 13, 14, 19, 27, 40, 95]) {
    const pieces = splitGap({ start: 100, end: 100 + len });
    assert.ok(pieces.length >= 2, `${len} s splits`);
    assert.ok(close(pieces[0].start, 100) && close(pieces.at(-1).end, 100 + len));
    for (const p of pieces) {
      const l = p.end - p.start;
      assert.ok(l >= PIECE_MIN - PIECE_PAUSE && l <= PIECE_MAX + 1e-6, `${len} s: piece of ${l}`);
    }
    for (let i = 1; i < pieces.length; i++) assert.ok(close(pieces[i].start - pieces[i - 1].end, PIECE_PAUSE));
  }
});

test('a long gap splits at the cut nearest the aim', () => {
  const pieces = splitGap({ start: 0, end: 30 }, [2, 5.5, 8, 16, 25]);
  assert.ok(close(pieces[0].end, 8 - PIECE_PAUSE / 2));
  assert.ok(close(pieces[1].start, 8 + PIECE_PAUSE / 2));
  assert.ok(close(pieces[1].end, 16 - PIECE_PAUSE / 2));
});

test('cut samples cover the gap', () => {
  assert.deepEqual(cutSamples({ start: 1, end: 3 }), [1, 1.5, 2, 2.5, 3]);
});

const still = (v) => new Uint8Array(32 * 18).fill(v);
const drift = (v, k) => Uint8Array.from({ length: 32 * 18 }, (_, i) => Math.min(255, v + ((i + k) % 7)));

test('frames differ by their mean pixel difference', () => {
  assert.equal(frameDiff(still(10), still(10)), 0);
  assert.equal(frameDiff(still(10), still(60)), 50);
});

test('a hard change is a cut; a moving camera is not', () => {
  const samples = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({ at: k * 0.5, px: drift(k < 4 ? 40 : 180, k) }));
  assert.deepEqual(findCuts(samples), [1.75]);
  const pan = [0, 1, 2, 3, 4, 5].map((k) => ({ at: k * 0.5, px: still(40 + k * 8) }));
  assert.deepEqual(findCuts(pan), []);
  assert.deepEqual(findCuts([]), []);
});

test('dialogue around a stretch: lines before and after', () => {
  const lines = [{ start: 0, end: 2, text: 'A' }, { start: 2.5, end: 4, text: 'B' }, { start: 9, end: 10, text: 'C' }, { start: 11, end: 12, text: 'D' }];
  assert.deepEqual(dialogueAround(lines, 4.2, 8.8, 1), { before: ['B'], after: ['C'] });
  assert.deepEqual(dialogueAround(lines, 4.2, 8.8), { before: ['A', 'B'], after: ['C', 'D'] });
});

test('a new block goes in its place in the script', () => {
  const cues = [{ start: 0, end: 1, text: 'a' }, { start: 10, end: 11, text: 'b' }];
  const { cues: all, i } = withBlock(cues, { start: 5, end: 7 });
  assert.equal(i, 1);
  assert.deepEqual(all.map((c) => c.text), ['a', '', 'b']);
  assert.equal(withBlock(cues, { start: 20, end: 22 }).i, 2);
});

test('the draft prompt includes the dialogue either side', () => {
  const cues = [{ start: 5, end: 8, text: '' }];
  const p = draftPrompt(cues, 0, fitBudget(3), [6], { before: ['Where were you?'], after: ['Out.'] });
  assert.match(p, /Dialogue around it/);
  assert.match(p, /"Where were you\?"/);
  assert.match(p, /After:\n {2}"Out\."/);
  assert.doesNotMatch(draftPrompt(cues, 0, fitBudget(3), [6]), /Dialogue around it/);
});

test('estimates: known models in cents, Ollama free, others unpriced', () => {
  const e = estimate(400, 'claude-sonnet-5-5');
  assert.deepEqual(e.cents.map(Math.round), [240, 480]);
  assert.match(estimateText(e, 'Claude'), /^400 blocks: about \$2\.40–\$4\.80, and 27 min–67 min\.$/);
  assert.ok(estimate(10, 'anthropic/claude-haiku-5.5').cents); // through OpenRouter
  assert.equal(estimate(10, 'mystery').cents, null);
  assert.match(estimateText(estimate(10, 'mystery'), 'OpenRouter'), /OpenRouter’s usual price/);
  assert.match(estimateText(estimate(1, 'gemma4:12b', 3, true), 'Ollama', true), /^1 block\. Free with Ollama/);
  assert.deepEqual(estimate(10, 'claude-opus-5-5', 6).cents, [20, 40]);
});

test('speech to text: words count, its phantoms for music don’t', () => {
  assert.equal(heardSpeech(''), '');
  for (const t of ['you', 'You.', 'Thank you.', 'Thanks for watching!', 'Bye.', 'Hmm']) assert.equal(heardSpeech(t), '', t);
  assert.equal(heardSpeech('Come here, quickly.'), 'Come here, quickly.');
  assert.equal(heardSpeech('Hello?'), 'Hello?');
  assert.equal(heardSpeech('a'.repeat(300)).length, 200);
});

test('the prompt says when someone may be speaking with no subtitle', () => {
  const cues = [{ start: 5, end: 8, text: '' }];
  const p = draftPrompt(cues, 0, fitBudget(3), [6], { before: [], after: [], heard: 'Over here!' });
  assert.match(p, /Someone may be speaking during this block, with no subtitle: "Over here!"/);
  assert.doesNotMatch(p, /Dialogue around it/);
});
