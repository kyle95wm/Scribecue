import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTime, fmtTime, fmtTC, parseTC, isDropFrame, parseSubs, parseAdc, adcText, toSRT, toVTT } from '../app/js/formats.js';

test('timecode counts frames at the video’s rate', () => {
  assert.equal(fmtTC(0, 25), '00:00:00:00');
  assert.equal(fmtTC(3723.48, 25), '01:02:03:12');
  assert.equal(fmtTC(1 / 25 - 1e-9, 25), '00:00:00:01'); // a hair before a frame counts as it
  assert.equal(fmtTC(59.99, 24), '00:00:59:23');
  // 23.976 counts all 24 frame numbers, so its timecode runs behind the clock.
  assert.equal(isDropFrame(24000 / 1001), false);
  assert.equal(fmtTC(1001 / 24000 * 24 * 60, 24000 / 1001), '00:01:00:00');
});

test('drop-frame timecode for 29.97 and 59.94 skips frame numbers to keep to the clock', () => {
  const ntsc = 30000 / 1001;
  assert.equal(isDropFrame(ntsc), true);
  assert.equal(isDropFrame(60000 / 1001), true);
  assert.equal(isDropFrame(30), false);
  assert.equal(fmtTC(1799 / ntsc, ntsc), '00:00:59;29');
  assert.equal(fmtTC(1800 / ntsc, ntsc), '00:01:00;02'); // ;00 and ;01 are skipped
  assert.equal(fmtTC(17982 / ntsc, ntsc), '00:10:00;00'); // but not on every tenth minute
  assert.equal(fmtTC(3600, ntsc), '01:00:00;00'); // an hour of video is an hour of timecode
  assert.equal(fmtTC(3600, 24000 / 1001), '00:59:56:09'); // 23.976 doesn't drop, so falls behind
  assert.equal(fmtTC(1800 / (60000 / 1001) * 2, 60000 / 1001), '00:01:00;04');
});

test('typed timecode goes back to the same frame', () => {
  for (const fps of [24000 / 1001, 24, 25, 30000 / 1001, 30, 50, 60000 / 1001]) {
    for (const n of [0, 1, 1799, 1800, 17982, 53947, 107892]) {
      const t = n / fps;
      assert.equal(Math.round(parseTC(fmtTC(t, fps), fps) * fps), n, `${fps} fps, frame ${n}`);
    }
  }
  assert.equal(parseTC('00:00:01:10', 25), 1.4);
  assert.equal(parseTC('00:00:01.500', 25), 1.5); // seconds still work
  assert.ok(Number.isNaN(parseTC('00:00:01:25', 25))); // no frame 25 at 25 fps
});

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

test('block voices are kept in VTT as notes and read back', () => {
  const cues = [{ start: 1, end: 2, text: 'Subtitle', speed: 1.15, voice: 'kokoro:bf_emma' }, { start: 3, end: 4, text: 'Description' }];
  const vtt = toVTT(cues);
  assert.match(vtt, /NOTE Scribecue text to speech voice: kokoro:bf_emma\n\n1\n/);
  assert.deepEqual(parseSubs(vtt), cues);
  assert.doesNotMatch(toSRT(cues), /voice/);
});

test('block dips are kept in VTT as notes and read back, not lowered (0) too', () => {
  const cues = [{ start: 1, end: 2, text: 'Music', dip: 0 }, { start: 3, end: 4, text: 'Explosion', dip: 32 }, { start: 5, end: 6, text: 'Plain' }];
  const vtt = toVTT(cues);
  assert.match(vtt, /NOTE Scribecue programme lowered by \(dB\): 0\n\n1\n/);
  assert.deepEqual(parseSubs(vtt).map((c) => c.dip), [0, 32, undefined]);
  assert.doesNotMatch(toSRT(cues), /lowered/);
});

test('dips more or less than set, and reading volumes, are kept in VTT too', () => {
  const cues = [{ start: 1, end: 2, text: 'Loud', dipBy: 7, vol: 150 }, { start: 3, end: 4, text: 'Quiet', dipBy: -3 }, { start: 5, end: 6, text: 'Soft', vol: 40 }];
  const vtt = toVTT(cues);
  assert.match(vtt, /NOTE Scribecue programme lowered more than set by \(dB\): \+7\n/);
  assert.match(vtt, /NOTE Scribecue reading volume \(%\): 150\n/);
  assert.deepEqual(parseSubs(vtt), cues);
});

test('parseAdc gives a block a voice of its own only when it differs from the document’s', () => {
  const doc = JSON.stringify({ voice: 'en-US-Standard-J', cue_points: [
    { start: 0, end: 500, text: 'a', voice: 'en-US-Standard-J' },
    { start: 1000, end: 1500, text: 'b', voice: 'en-GB-Standard-A' },
    { start: 2000, end: 2500, text: 'c', voice: '' },
    { start: 3000, end: 3500, text: 'd', voice: 'not a voice' },
  ] });
  assert.deepEqual(parseAdc(doc).cues.map((c) => c.voice), [undefined, 'google:en-GB-Standard-A', undefined, undefined]);
});
