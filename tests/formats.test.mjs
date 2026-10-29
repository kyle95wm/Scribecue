import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTime, fmtTime, parseSubs, toSRT, toVTT } from '../app/js/formats.js';

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
