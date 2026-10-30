import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTime, fmtTime, parseSubs, parseAdc, adcText, toSRT, toVTT } from '../app/js/formats.js';

test('parseTime reads SRT, VTT and short forms', () => {
  assert.equal(parseTime('01:02:03,456'), 3723.456);
  assert.equal(parseTime('01:02:03.456'), 3723.456);
  assert.equal(parseTime('02:03.5'), 123.5);
  assert.equal(parseTime('1:02'), 62);
  assert.equal(parseTime(' 3.5 '), 3.5);
  assert.ok(Number.isNaN(parseTime('abc')));
  assert.ok(Number.isNaN(parseTime('1:2:3:4')));
});

test('fmtTime pads and rounds to the millisecond', () => {
  assert.equal(fmtTime(0), '00:00:00,000');
  assert.equal(fmtTime(3723.456), '01:02:03,456');
  assert.equal(fmtTime(59.9996, '.'), '00:01:00.000');
  assert.equal(fmtTime(-1), '00:00:00,000');
});

test('parseSubs reads SRT with CRLF, a BOM and multi-line text', () => {
  const srt = '﻿1\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\nthere\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n<i>Bye</i>\r\n';
  assert.deepEqual(parseSubs(srt), [
    { start: 1, end: 2.5, text: 'Hello\nthere' },
    { start: 3, end: 4, text: '<i>Bye</i>' },
  ]);
});

test('parseSubs reads VTT with cue settings, skips junk and sorts', () => {
  const vtt = 'WEBVTT\n\nNOTE a comment\n\nb\n00:05.000 --> 00:06.000 align:start\nSecond\n\na\n00:01.000 --> 00:02.000\nFirst\n\nbroken --> nope\nx\n';
  assert.deepEqual(parseSubs(vtt), [
    { start: 1, end: 2, text: 'First' },
    { start: 5, end: 6, text: 'Second' },
  ]);
});

test('parseSubs never returns an end before the start', () => {
  assert.equal(parseSubs('1\n00:00:05,000 --> 00:00:04,000\nX\n')[0].end, 5);
});

test('toSRT and toVTT round-trip through parseSubs', () => {
  const cues = [{ start: 1.2, end: 3.4, text: 'One\ntwo' }, { start: 3725.001, end: 3726, text: 'Three' }];
  const srt = toSRT(cues);
  assert.match(srt, /^1\n00:00:01,200 --> 00:00:03,400\nOne\ntwo\n\n2\n01:02:05,001 --> 01:02:06,000\nThree\n$/);
  assert.deepEqual(parseSubs(srt), cues);
  const vtt = toVTT(cues);
  assert.ok(vtt.startsWith('WEBVTT\n\n1\n00:00:01.200 --> 00:00:03.400\n'));
  assert.deepEqual(parseSubs(vtt), cues);
});

test('blank lines inside a block are collapsed so the file stays valid', () => {
  assert.equal(toSRT([{ start: 0, end: 1, text: 'a\n\n\nb' }]), '1\n00:00:00,000 --> 00:00:01,000\na\nb\n');
});

test('block speeds are kept in VTT as notes and read back', () => {
  const cues = [{ start: 1, end: 2, text: 'Fast', speed: 1.15 }, { start: 3, end: 4, text: 'Default' }, { start: 5, end: 6, text: 'Slow', speed: 0.7 }];
  const vtt = toVTT(cues);
  assert.match(vtt, /NOTE Scribecue text to speech speed: 1\.15\n\n1\n00:00:01\.000/);
  assert.equal((vtt.match(/^NOTE/gm) || []).length, 2);
  assert.deepEqual(parseSubs(vtt), cues);
});

test('other notes and SRT files leave block speeds unset', () => {
  const vtt = 'WEBVTT\n\nNOTE written by someone else\n\n00:01.000 --> 00:02.000\nA\n';
  assert.equal(parseSubs(vtt)[0].speed, undefined);
  const srt = toSRT([{ start: 1, end: 2, text: 'A', speed: 1.3 }]);
  assert.doesNotMatch(srt, /NOTE|speed/);
  assert.equal(parseSubs(srt)[0].speed, undefined);
});

test('a speed note only applies to the block right after it', () => {
  const vtt = 'WEBVTT\n\nNOTE Scribecue text to speech speed: 1.3\n\n00:01.000 --> 00:02.000\nA\n\n00:03.000 --> 00:04.000\nB\n';
  assert.deepEqual(parseSubs(vtt).map((c) => c.speed), [1.3, undefined]);
});

test('sounds like words are kept in VTT as notes, alongside a speed, and read back', () => {
  const cues = [
    { start: 1, end: 2, text: 'Siobhan waves.', speed: 1.15, say: [['Siobhan', 'shiv-awn'], ['A = B', 'x = y']] },
    { start: 3, end: 4, text: 'Plain.' },
  ];
  const vtt = toVTT(cues);
  assert.match(vtt, /NOTE Scribecue sounds like:\nSiobhan = shiv-awn\nA = B = x = y\n\n1\n/);
  const back = parseSubs(vtt);
  assert.equal(back[0].speed, 1.15);
  assert.deepEqual(back[0].say[0], ['Siobhan', 'shiv-awn']);
  assert.equal(back[1].say, undefined);
  assert.doesNotMatch(toSRT(cues), /NOTE|shiv/);
});

test('adcText turns HTML into plain text, and speech marks into sounds-like words', () => {
  assert.deepEqual(adcText('<p>Vee nods.&nbsp;</p>'), { text: 'Vee nods.', say: [] });
  assert.deepEqual(adcText('<p>Text reads "<abbr class="speech" title="far far away">Far, far away</abbr> from Wilson Hall."</p>'),
    { text: 'Text reads "Far, far away from Wilson Hall."', say: [['Far, far away', 'far far away']] });
  assert.deepEqual(adcText('<p>One &amp; <strong>two</strong></p><p>Three&#39;s<br>four &#x2014; five</p>'),
    { text: "One & two\nThree's\nfour — five", say: [] });
  // A word marked twice is said one way; other abbreviations are only text.
  assert.deepEqual(adcText('<abbr class="speech" title="a">X</abbr> <abbr class="speech" title="b">X</abbr> <abbr title="Doctor">Dr.</abbr>'),
    { text: 'X X Dr.', say: [['X', 'a']] });
  assert.deepEqual(adcText(null), { text: '', say: [] });
});

test('parseAdc reads Frazier speed codes and the base speed', () => {
  const adc = (base, speeds) => JSON.stringify({ base_speed: base, cue_points: speeds.map((speed, i) => ({ start: i * 1000, end: i * 1000 + 500, text: 'x', speed })) });
  const { cues, base } = parseAdc(adc(100, [0, 1, 2, 99, 98, 3, 4, 7]));
  assert.deepEqual(cues.map((c) => c.speed), [undefined, 1.15, 1.3, 0.85, 0.7, 1.5, 2, undefined]);
  assert.equal(base, 1);
  assert.equal(parseAdc(adc(105, [1])).base, 1.05);
  assert.equal(parseAdc(adc(105, [1])).cues[0].speed, 1.15);
  for (const odd of [undefined, 0, 49, 151, 'x']) assert.equal(parseAdc(adc(odd, [0])).base, 1);
});

test('parseAdc reads Frazier cue points in milliseconds, sorted, skipping broken ones', () => {
  const adc = JSON.stringify({ title: 'T', cue_points: [
    { start: 56855, end: 59239, text: '<p>Second <abbr class="speech" title="matthew">Mathieu</abbr></p>', speed: 0 },
    { start: 6804, end: 8718, text: '<p>First.&nbsp;</p>' },
    { start: 'x', end: 1, text: '<p>Broken</p>' },
    { start: 9000, end: 8000, text: '<p>Backwards</p>' },
  ] });
  assert.deepEqual(parseAdc('﻿' + adc).cues, [
    { start: 6.804, end: 8.718, text: 'First.' },
    { start: 9, end: 9, text: 'Backwards' },
    { start: 56.855, end: 59.239, text: 'Second Mathieu', say: [['Mathieu', 'matthew']] },
  ]);
  assert.deepEqual(parseAdc('not json'), { cues: [], base: 1 });
  assert.deepEqual(parseAdc('{"cue_points": null}'), { cues: [], base: 1 });
});
