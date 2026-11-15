import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  partsOf, linesFrom, keepIn, openaiCost, span, timeLeft, openaiRequest, openaiHeard,
  PART_LOCAL, PART_ONLINE, OVERLAP, PAD, OPENAI_URL,
} from '../app/js/heardlane.js';

const near = (a, b) => Math.abs(a - b) < 1e-9;

test('the programme is heard in parts that run on a little either side', () => {
  const p = partsOf(200, 60);
  assert.deepEqual(p.map((x) => [x.start, x.end]), [[0, 60], [60, 120], [120, 180], [180, 200]]);
  assert.deepEqual([p[0].clipFrom, p[0].clipTo], [0, 60 + OVERLAP]);
  assert.deepEqual([p[1].clipFrom, p[1].clipTo], [60 - OVERLAP, 120 + OVERLAP]);
  assert.equal(p.at(-1).clipTo, 200, 'not past the end');
  assert.deepEqual(partsOf(122, 60).map((x) => [x.start, x.end]), [[0, 60], [60, 122]], 'a last sliver joins the part before');
  assert.deepEqual(partsOf(200, 60, 120).map((x) => x.start), [120, 180], 'carries on from where it stopped');
  assert.deepEqual(partsOf(0, 60), []);
  assert.ok(PART_ONLINE > PART_LOCAL);
});

test('sentences give the text, and their words the timing', () => {
  const lines = linesFrom({
    segments: [{ start: 0.5, end: 6, text: ' Where are you going?' }],
    words: [{ start: 0.6, end: 0.9, text: ' Where' }, { start: 0.9, end: 1.2, text: ' are' }, { start: 1.2, end: 1.4, text: ' you' }, { start: 1.4, end: 1.8, text: ' going?' }],
  }, 60);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'Where are you going?');
  assert.ok(near(lines[0].start, 60.6 - PAD) && near(lines[0].end, 61.8 + PAD), 'the words’ times, widened a little');
});

test('a long pause inside a sentence leaves room for a block', () => {
  const lines = linesFrom({
    segments: [{ start: 7, end: 14, text: 'I told you. Wait here.' }],
    words: [{ start: 7.2, end: 7.4, text: 'I' }, { start: 7.4, end: 7.7, text: 'told' }, { start: 7.7, end: 8, text: 'you.' }, { start: 11, end: 11.3, text: 'Wait' }, { start: 11.3, end: 11.7, text: 'here.' }],
  });
  assert.deepEqual(lines.map((l) => l.text), ['I told you.', 'Wait here.']);
  assert.ok(near(lines[0].end, 8 + PAD) && near(lines[1].start, 11 - PAD));
});

test('words alone are made into lines at pauses and sentence ends', () => {
  const w = (start, end, text) => ({ start, end, text });
  const lines = linesFrom({ segments: null, words: [w(0, 0.5, 'Come'), w(0.5, 1, 'here.'), w(3, 3.4, 'Now'), w(3.4, 3.9, 'please,'), w(3.9, 4.5, 'quickly'), w(4.5, 5.9, 'before'), w(6.2, 6.4, 'dark.'), w(6.5, 7, 'Go.')] });
  assert.deepEqual(lines.map((l) => l.text), ['Come here.', 'Now please, quickly before dark.', 'Go.']);
});

test('sentences alone are used as they are', () => {
  const lines = linesFrom({ segments: [{ start: 1, end: 3, text: 'Hello.' }, { start: 4, end: null, text: 'Stop.' }], words: null });
  assert.deepEqual(lines.map((l) => [l.start, l.end, l.text]), [[1 - PAD, 3 + PAD, 'Hello.'], [4 - PAD, 4.5 + PAD, 'Stop.']]);
});

test('what Whisper imagines in music and silence is left out', () => {
  const lines = linesFrom({ segments: [{ start: 0, end: 2, text: ' you' }, { start: 3, end: 5, text: '[Music]' }, { start: 6, end: 8, text: ' Thank you.' }, { start: 9, end: 10, text: 'run' }] });
  assert.deepEqual(lines.map((l) => l.text), ['Run']);
  assert.equal(linesFrom({ segments: [{ start: 0.1, end: 1, text: 'Hi.' }] })[0].start, 0, 'never before the start');
  assert.deepEqual(linesFrom(), []);
});

test('a line belongs to the part its middle is in, so overlaps are not doubled', () => {
  const part = { start: 60, end: 120 };
  const lines = [{ start: 58, end: 61, text: 'a' }, { start: 59, end: 63, text: 'b' }, { start: 118, end: 121, text: 'c' }, { start: 119, end: 122, text: 'd' }];
  assert.deepEqual(keepIn(lines, part).map((l) => l.text), ['b', 'c']);
});

test('the cost with OpenAI, and the time left, in words', () => {
  assert.equal(openaiCost(60), 'less than a cent');
  assert.equal(openaiCost(600), 'about 6 cents');
  assert.equal(openaiCost(7200), 'about 72 cents');
  assert.equal(openaiCost(36000), 'about $3.60');
  assert.equal(span(40), '40 s');
  assert.equal(span(720), '12 min');
  assert.equal(span(7500), '2 h 05 min');
  assert.equal(timeLeft(60, 2, 10), 'about 5 min left');
  assert.equal(timeLeft(0, 0, 10), '');
});

test('OpenAI is asked for word and sentence timings, and its reply is read', () => {
  const { url, init } = openaiRequest(new Uint8Array([1, 2, 3]), 'sk-test');
  assert.equal(url, OPENAI_URL);
  assert.equal(init.headers.Authorization, 'Bearer sk-test');
  assert.equal(init.body.get('model'), 'whisper-1');
  assert.equal(init.body.get('response_format'), 'verbose_json');
  assert.deepEqual(init.body.getAll('timestamp_granularities[]'), ['word', 'segment']);
  assert.equal(init.body.get('file').type, 'audio/wav');
  const heard = openaiHeard({ text: 'Hi there.', segments: [{ id: 0, start: 0.2, end: 1.4, text: ' Hi there.' }], words: [{ word: 'Hi', start: 0.3, end: 0.5 }, { word: 'there', start: 0.5, end: 0.9 }] });
  assert.deepEqual(heard.words[1], { start: 0.5, end: 0.9, text: 'there' });
  assert.deepEqual(linesFrom(heard).map((l) => l.text), ['Hi there.']);
  assert.deepEqual(openaiHeard({}), { segments: [], words: [] });
});

test('in the browser, a part and its overlap fit in one of Whisper’s 30-second windows', async () => {
  const { PART_WEB } = await import('../app/js/heardlane.js');
  const p = partsOf(600, PART_WEB);
  for (const d of [600, 572, 1000]) assert.ok(partsOf(d, PART_WEB).every((x) => x.clipTo - x.clipFrom <= 30), String(d));
});

test('a phantom at the end of a real sentence is cut off', () => {
  assert.deepEqual(linesFrom({ segments: [{ start: 1, end: 3, text: 'Wait for me, please. you' }] }).map((l) => l.text), ['Wait for me, please.']);
  assert.deepEqual(linesFrom({ segments: [{ start: 1, end: 3, text: 'I love you' }] }).map((l) => l.text), ['I love you'], 'not when it’s part of the sentence');
});

test('a word stretched over a pause is pulled back to the word it’s said with', () => {
  const w = (start, end, text) => ({ start, end, text });
  const lines = linesFrom({ words: [w(61, 61.5, 'between'), w(61.5, 61.9, 'two'), w(61.5, 72.8, 'parts.'), w(184.8, 200.9, 'There'), w(200.5, 201, 'now.')] });
  assert.deepEqual(lines.map((l) => [+(l.start + PAD).toFixed(2), +(l.end - PAD).toFixed(2), l.text]), [[61, 62.5, 'Between two parts.'], [199.9, 201, 'There now.']]);
});
