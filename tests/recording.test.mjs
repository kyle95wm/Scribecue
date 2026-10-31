import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECORDING_EXT, isRecordingFile, punchIn, PUNCH_FADE, pieces, placed, fullEdit, clampEdit, splitAt, cutPart, silenceEnds, trimSilence, fitSlot, startAtBlock, snap, flatten, wavePeaks, EDIT_MIN, takeAt, nextTake, toRecordingFile, fromRecordingFile, narrationNote, compareScript, sameVideo, slots, peakDb, judgePeak, checkExport, exportReport, recordingId, placeTake, looksBluetooth, runsOver } from '../app/js/recording.js';
import { buildBwf, wav24, to24, from24, readNote } from '../app/js/bwf.js';

const blocks = [
  { start: 2, end: 5, text: 'One.', speed: 1.1 },
  { start: 5.4, end: 8, text: 'Two.' },
  { start: 20, end: 22, text: 'Three.', voice: 'piper:x' },
];

test('a recording file keeps the script, video and start, and drops empty blocks', () => {
  const f = JSON.parse(JSON.stringify(toRecordingFile({ blocks: [...blocks, { start: 30, end: 31, text: '  ' }], media: { name: 'a.mp4', size: 9, duration: 60 }, start: 3600, fps: 24, app: '1' })));
  const r = fromRecordingFile(f);
  assert.equal(r.blocks.length, 3);
  assert.deepEqual(r.blocks[0], { start: 2, end: 5, text: 'One.', speed: 1.1 });
  assert.equal(r.start, 3600); assert.equal(r.fps, 24);
  assert.deepEqual(r.media, { name: 'a.mp4', size: 9, duration: 60 });
});

test('opening something that is not a recording file says so', () => {
  assert.throws(() => fromRecordingFile({ scribecue: 1, blocks: [] }), /isn’t a Scribecue recording/);
  assert.throws(() => fromRecordingFile({ scribecueRecording: 99, blocks: [] }), /newer/);
  assert.throws(() => fromRecordingFile({ scribecueRecording: 1 }), /no blocks/);
});

test('the video must match by name and length', () => {
  const saved = { name: 'a.mp4', duration: 60 };
  assert.ok(sameVideo(saved, { name: 'a.mp4', duration: 60.04 }));
  assert.ok(!sameVideo(saved, { name: 'b.mp4', duration: 60 }));
  assert.ok(!sameVideo(saved, { name: 'a.mp4', duration: 75 }));
});

test('a slot gets 1 second of grace but never reaches the next block', () => {
  assert.deepEqual(slots(blocks), [{ start: 2, end: 5.4 }, { start: 5.4, end: 9 }, { start: 20, end: 23 }]);
});

test('peaks are judged against the targets', () => {
  const s = new Float32Array([0, 0.5, -0.25]);
  assert.ok(Math.abs(peakDb(s) + 6.02) < 0.01);
  assert.equal(peakDb(new Float32Array(4)), -Infinity);
  assert.deepEqual([-5, -7, -10, -14, -20].map(judgePeak), ['loud', 'note', 'good', 'note', 'quiet']);
  assert.equal(judgePeak(-6), 'note');
  assert.equal(judgePeak(-16), 'note');
});

test('export is stopped by loud takes and only warned by the rest', () => {
  const chosen = [{ peak: -10, duration: 3 }, { peak: -4, duration: 2 }, null];
  const c = checkExport(blocks, chosen);
  assert.deepEqual(c.stop.map((x) => x.block), [2]);
  assert.deepEqual(c.warn, [{ block: 3, why: 'has no take' }]);
  const over = checkExport(blocks, [{ peak: -20, duration: 9 }, { peak: -10, duration: 1 }, { peak: -9, duration: 1 }]);
  assert.deepEqual(over.warn.map((x) => x.block), [1, 1]);
  assert.match(exportReport(c), /STOPPED: Block 2/);
});

const u32 = (b, o) => b.readUInt32LE(o);
test('the BWF is mono 24-bit, stamped, silent between takes, with a marker per block', async () => {
  const rate = 8000;
  const take = new Float32Array(rate).fill(0.5); // one second at half scale
  const blob = buildBwf({ takes: [{ start: 2, samples: take }], markers: [{ at: 2, label: '1 One.' }, { at: 5, label: '2 Two' }],
    secs: 10, rate, startSecs: 3600, description: 'test', date: new Date('2026-01-02T03:04:05Z') });
  const b = Buffer.from(await blob.arrayBuffer());
  assert.equal(b.toString('latin1', 0, 4), 'RIFF');
  assert.equal(u32(b, 4), b.length - 8);
  assert.equal(b.toString('latin1', 8, 12), 'WAVE');
  const chunks = {};
  for (let o = 12; o < b.length;) { const id = b.toString('latin1', o, o + 4), n = u32(b, o + 4); chunks[id] = { o: o + 8, n }; o += 8 + n + (n % 2); }
  assert.deepEqual(Object.keys(chunks), ['fmt ', 'bext', 'data', 'cue ', 'LIST']);
  const f = chunks['fmt '].o;
  assert.equal(b.readUInt16LE(f), 1); assert.equal(b.readUInt16LE(f + 2), 1);
  assert.equal(u32(b, f + 4), rate); assert.equal(b.readUInt16LE(f + 14), 24);
  const x = chunks.bext.o;
  assert.equal(b.toString('latin1', x, x + 4), 'test');
  assert.equal(b.toString('latin1', x + 320, x + 330), '2026-01-02');
  assert.equal(u32(b, x + 338), 3600 * rate);
  const d = chunks.data;
  assert.equal(d.n, 10 * rate * 3);
  assert.equal(b.readIntLE(d.o + 3 * rate * 2 - 3, 3), 0, 'silent just before the take');
  assert.equal(b.readIntLE(d.o + 3 * rate * 2, 3), Math.round(0.5 * 0x7fffff), 'take at 2 s');
  assert.equal(b.readIntLE(d.o + 3 * rate * 3, 3), 0, 'silent after the take');
  const cue = chunks['cue '].o;
  assert.equal(u32(b, cue), 2); assert.equal(u32(b, cue + 4 + 24 + 4), 5 * rate);
  assert.match(b.toString('latin1', chunks.LIST.o, chunks.LIST.o + chunks.LIST.n), /adtl[\s\S]*labl[\s\S]*1 One\.[\s\S]*2 Two/);
});

test('a take that runs past the end is cut, and too long a file is refused', () => {
  const blob = buildBwf({ takes: [{ start: 0.5, samples: new Float32Array(8000) }], secs: 1, rate: 8000 });
  assert.ok(blob.size > 8000 * 3);
  assert.throws(() => buildBwf({ takes: [], secs: 3 * 3600 * 48000 / 48000 * 1000, rate: 48000 }), /4 GB/);
});

test('takes in the same script share an id, and an edited script does not', () => {
  const a = recordingId({ blocks, start: 0 });
  assert.equal(a, recordingId({ blocks: blocks.map((b) => ({ ...b })), start: 0 }));
  assert.notEqual(a, recordingId({ blocks, start: 3600 }));
  assert.notEqual(a, recordingId({ blocks: [{ ...blocks[0], text: 'Changed.' }, ...blocks.slice(1)], start: 0 }));
});

test('a take is moved earlier by the delay and never back into the previous slot', () => {
  assert.deepEqual(placeTake({ t0: 10, delay: 0.1, prevEnd: 5 }), { start: 9.9, skip: 0 });
  const p = placeTake({ t0: 10, delay: 0.1, prevEnd: 9.95, rate: 1000 });
  assert.equal(p.skip, 50); assert.ok(Math.abs(p.start - 9.95) < 1e-9);
  assert.equal(placeTake({ t0: 0.05, delay: 0.3 }).start, 0);
  assert.ok(runsOver({ start: 4, duration: 2 }, { start: 2, end: 5.4 }));
  assert.ok(!runsOver({ start: 2, duration: 3 }, { start: 2, end: 5.4 }));
});

test('Bluetooth outputs are spotted by name or delay', () => {
  assert.ok(looksBluetooth('Default - AirPods Pro')); assert.ok(looksBluetooth('', 0.2));
  assert.ok(!looksBluetooth('MacBook Pro Speakers', 0.02));
});

test('a kept take is a 24-bit WAV that goes into the BWF as it is', async () => {
  const pcm = to24(new Float32Array(100).fill(-0.5));
  const w = Buffer.from(await wav24(pcm, 48000).arrayBuffer());
  assert.equal(w.toString('latin1', 0, 4), 'RIFF'); assert.equal(w.readUInt16LE(34), 24); assert.equal(w.length, 44 + 300);
  const b = Buffer.from(await buildBwf({ takes: [{ start: 0.5, pcm: new Blob([pcm]) }], secs: 1, rate: 1000 }).arrayBuffer());
  const at = b.indexOf('data') + 8;
  assert.equal(b.readIntLE(at + 500 * 3, 3), Math.round(-0.5 * 0x7fffff));
  assert.equal(b.readIntLE(at + 499 * 3, 3), 0);
});

test('a recording file edited by hand is noticed', () => {
  const f = JSON.parse(JSON.stringify(toRecordingFile({ blocks, start: 3600 })));
  assert.equal(fromRecordingFile(f).edited, false);
  f.blocks[1].text = 'Something else.';
  assert.equal(fromRecordingFile(f).edited, true);
  delete f.print; // from before there was a fingerprint
  assert.equal(fromRecordingFile(f).edited, false);
});

test('a narration is compared line by line with the script open now', () => {
  const note = narrationNote({ blocks, edited: false });
  assert.deepEqual(compareScript(note, [...blocks, { start: 40, end: 41, text: ' ' }]), { same: true, edited: false, lines: [], more: 0 });
  const ours = [blocks[0], { ...blocks[1], text: 'Changed.' }, { ...blocks[2], end: 23 }, { start: 30, end: 31, text: 'Four.' }];
  assert.deepEqual(compareScript(note, ours).lines, [
    { line: 2, why: 'has different text' }, { line: 3, why: 'has different timings' }, { line: 4, why: 'isn’t in the narration' }]);
  assert.equal(compareScript({ ...note, edited: true }, blocks).edited, true);
  const many = Array.from({ length: 30 }, (_, i) => ({ start: i, end: i + 0.5, text: `L${i}` }));
  const r = compareScript(narrationNote({ blocks: many }), many.map((b) => ({ ...b, text: b.text + '!' })), 20);
  assert.equal(r.lines.length, 20); assert.equal(r.more, 10);
});

test('the narration WAV carries the script, and other WAVs have none', async () => {
  const note = narrationNote({ blocks, edited: true });
  const wav = buildBwf({ takes: [{ start: 2, samples: new Float32Array(480).fill(0.3) }], markers: [{ at: 2, label: '1 One.' }], note, secs: 5 });
  assert.deepEqual(await readNote(wav), JSON.parse(JSON.stringify(note)));
  assert.equal(await readNote(buildBwf({ takes: [], secs: 1 })), null);
  assert.equal(await readNote(wav24(new Uint8Array(30))), null);
  assert.equal(await readNote(new Blob(['not a wav'])), null);
});

test('while the video plays, the take under the playhead plays from the right point', () => {
  const takes = [{ id: 'a', start: 2, duration: 3 }, { id: 'b', start: 6, duration: 1 }, { id: 'c', start: 20, duration: 2 }];
  assert.equal(takeAt(takes, 1.9), null);
  assert.deepEqual(takeAt(takes, 3.5), { take: takes[0], from: 1.5 });
  assert.equal(takeAt(takes, 5), null, 'a take ends where its sound does');
  assert.equal(takeAt(takes, 6).take.id, 'b');
  assert.equal(takeAt(takes, 30), null);
  assert.equal(takeAt([], 3), null);
  assert.equal(nextTake(takes, 5.2, 1).id, 'b');
  assert.equal(nextTake(takes, 3, 1), null, 'too far ahead to get ready yet');
  assert.equal(nextTake(takes, 6, 20).id, 'c', 'not the one already playing');
});

test('the recording file has an extension the file picker takes, and old files still open', () => {
  // Chrome's showOpenFilePicker throws on anything but letters, digits, + and dots.
  assert.match(RECORDING_EXT, /^\.[a-z0-9.+]{1,15}$/);
  assert.ok(isRecordingFile('Film.scribecuerec'));
  assert.ok(isRecordingFile('film.SCRIBECUE-REC'));
  assert.ok(!isRecordingFile('film.scribecue'));
  assert.ok(!isRecordingFile('film.srt'));
});

test('24-bit samples read back as they were written', () => {
  const x = Float32Array.from([0, 0.5, -0.5, 1, -1, 1e-6]);
  const back = from24(to24(x));
  x.forEach((v, i) => assert.ok(Math.abs(back[i] - v) < 1 / 0x7fffff, `sample ${i}`));
  assert.deepEqual(to24(back), to24(x));
});

test('a punch-in keeps the earlier take up to the join, and the new one after it', () => {
  const R = 1000, fade = PUNCH_FADE / 2 * R; // 5 samples each side
  const base = { start: 10, pcm: new Float32Array(3 * R).fill(0.25) }; // 10 s to 13 s
  const add = { start: 11.8, pcm: new Float32Array(2 * R).fill(-0.5) }; // recorded from 11.8 s
  const { start, pcm } = punchIn(base, add, 12, R);
  assert.equal(start, 10);
  assert.equal(pcm.length, 2 * R + (2 * R - 0.2 * R)); // the earlier take to 12 s, then the rest of the new one
  assert.equal(pcm[0], 0.25);
  assert.equal(pcm[2 * R - fade - 1], 0.25); // untouched right up to the crossfade
  assert.equal(pcm[2 * R + fade], -0.5); // the new take from just after the join
  assert.equal(pcm.at(-1), -0.5);
  // The crossfade moves from one to the other without a jump.
  for (let k = 2 * R - fade; k < 2 * R + fade; k++) assert.ok(Math.abs(pcm[k] - pcm[k - 1]) < 0.2, `sample ${k}`);
  // Two takes of the same sound join no louder than either.
  const tone = (start, n) => ({ start, pcm: Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 50 * (start + i / R))) });
  const same = punchIn(tone(10, 3 * R), tone(11.8, 2 * R), 12, R).pcm;
  assert.ok(Math.max(...same.map(Math.abs)) <= 0.5 + 1e-6);
});

test('a punch-in after a take that stopped short leaves the gap silent', () => {
  const R = 1000;
  const base = { start: 10, pcm: new Float32Array(R).fill(0.25) }; // stops at 11 s
  const add = { start: 11.3, pcm: new Float32Array(R).fill(-0.5) };
  const { pcm } = punchIn(base, add, 11.5, R);
  assert.equal(pcm.length, 1.5 * R + 0.8 * R);
  assert.equal(pcm[R - 10], 0.25);
  assert.equal(pcm[R + 100], 0); // the gap
  assert.equal(pcm.at(-1), -0.5);
});

test('a moved and trimmed take sits where the narrator put it', () => {
  const t = { id: 'a', start: 10, duration: 3, peak: -10 };
  assert.deepEqual(placed(t), { ...t, start: 10, duration: 3 }, 'unedited: as recorded');
  const e = { splits: [], parts: [{ shift: -0.25, head: 0.5, tail: 1 }] };
  const [p] = pieces({ ...t, edit: e });
  assert.equal(p.start, 10.25); // moved 0.25 s earlier, with 0.5 s off the front
  assert.equal(p.duration, 1.5);
  assert.equal(p.head, 0.5);
  assert.ok(!runsOver(placed({ ...t, edit: e }), { start: 10, end: 12 }), 'trimmed back inside its slot');
  assert.ok(runsOver(placed(t), { start: 10, end: 12 }));
});

test('a split take is squeezed together by moving its second part', () => {
  const t = { id: 'a', start: 10, duration: 4 }; // a pause from 11.5 s to 12.5 s
  const e = splitAt(t, 12);
  assert.deepEqual(e.splits, [2]);
  assert.equal(splitAt(t, 10.05), null, 'too near an end');
  const squeezed = clampEdit(t, { splits: [2], parts: [{ shift: 0, head: 0, tail: 0.5 }, { shift: -1, head: 0.5, tail: 0 }] });
  const [a, b] = pieces({ ...t, edit: squeezed });
  assert.deepEqual([a.start, a.duration, b.start, b.duration, b.head], [10, 1.5, 11.5, 1.5, 2.5]);
  assert.equal(b.key, 'a:1');
  assert.deepEqual(placed({ ...t, edit: squeezed }).duration, 3, 'a second shorter');
  // Moved further, the second part stops at the first: parts never overlap.
  const [, c] = pieces({ ...t, edit: clampEdit(t, { splits: [2], parts: [squeezed.parts[0], { ...squeezed.parts[1], shift: -2 }] }) });
  assert.equal(c.start, 11.5);
});

test('an edit stays within bounds', () => {
  const t = { start: 10, duration: 3 };
  const one = (p) => ({ splits: [], parts: [p] });
  assert.deepEqual(clampEdit(t, one({ head: 5, tail: 5 })), one({ shift: 0, head: 3 - EDIT_MIN, tail: 0 }), 'some sound is always kept');
  assert.deepEqual(clampEdit(t, one({ head: -1, tail: -1, shift: 0 })), one({ shift: 0, head: 0, tail: 0 }));
  assert.deepEqual(clampEdit(t, one({ shift: -4 }), 8), one({ shift: -2, head: 0, tail: 0 }), 'not before the previous slot ends');
  assert.deepEqual(clampEdit(t, one({ shift: -20 })), one({ shift: -10, head: 0, tail: 0 }), 'not before the start of the video');
  assert.deepEqual(clampEdit(t, one({ shift: 0.12345 })), one({ shift: 0.123, head: 0, tail: 0 }));
  assert.deepEqual(clampEdit(t, undefined), one({ shift: 0, head: 0, tail: 0 }));
  assert.deepEqual(fullEdit({ ...t, edit: { shift: 1, head: 0, tail: 0 } }), one({ shift: 1, head: 0, tail: 0 }), 'an edit from before splitting');
});

test('Trim silence finds where the sound begins and ends', () => {
  const R = 1000, pcm = new Float32Array(3 * R);
  pcm.fill(0.3, 1.2 * R, 2.5 * R); // sound from 1.2 s to 2.5 s, quiet around it
  pcm[100] = 0.001; // a breath of noise under the floor
  const s = silenceEnds(pcm, R, { pad: 0.05 });
  assert.ok(Math.abs(s.head - 1.15) < 0.002, `head ${s.head}`);
  assert.ok(Math.abs(s.tail - 0.45) < 0.002, `tail ${s.tail}`);
  assert.deepEqual(silenceEnds(new Float32Array(R), R), { head: 0, tail: 0 }, 'all quiet: left alone');
  // Every part's ends: a split in a pause trims both sides of it.
  const two = new Float32Array(4 * R);
  two.fill(0.3, 0, 1.5 * R); two.fill(0.3, 2.5 * R, 4 * R);
  const e = trimSilence({ start: 0, duration: 4, edit: { splits: [2], parts: [{}, {}] } }, two, R);
  assert.ok(Math.abs(e.parts[0].tail - 0.45) < 0.002 && Math.abs(e.parts[1].head - 0.45) < 0.002, JSON.stringify(e));
});

test('Fit in slot trims a take that runs past its slot', () => {
  const slot = { start: 10, end: 12 };
  const e = fitSlot({ start: 9.8, duration: 3 }, slot);
  const p = placed({ start: 9.8, duration: 3, edit: e });
  assert.ok(Math.abs(p.start + p.duration - 12) < 0.002);
  assert.ok(!runsOver(p, slot));
  const odd = { start: 9.8004, duration: 2.5371 };
  assert.ok(!runsOver(placed({ ...odd, edit: fitSlot(odd, slot) }), slot), 'not a hair over after rounding');
  assert.equal(e.parts[0].head, 0);
  const late = fitSlot({ start: 14, duration: 1 }, slot);
  assert.equal(placed({ start: 14, duration: 1, edit: late }).start, 10, 'a take after its slot moves to its start');
  assert.deepEqual(fitSlot({ start: 10, duration: 1 }, slot), { splits: [], parts: [{ shift: 0, head: 0, tail: 0 }] }, 'already fits');
});

test('a split take flattens to one stretch, silent between its parts', () => {
  const R = 10, t = { start: 5, duration: 2, edit: { splits: [1], parts: [{ shift: 0, head: 0, tail: 0 }, { shift: 0.5, head: 0, tail: 0 }] } };
  const pcm = Float32Array.from({ length: 20 }, (_, i) => i + 1);
  const f = flatten(t, pcm, R);
  assert.equal(f.start, 5);
  assert.deepEqual([...f.pcm], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0, 0, 0, 0, 0, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
});

test('the waveform has the loudest sample of each column', () => {
  const pcm = Float32Array.from([0, 0.5, -0.8, 0.1, 0, 0.2]);
  assert.deepEqual([...wavePeaks(pcm, 3)].map((v) => +v.toFixed(2)), [0.5, 0.8, 0.2]);
});

test('a deleted part is gone from the take, and the rest stays put', () => {
  const t = { id: 'a', start: 10, duration: 4 };
  const split = splitAt(t, 12); // parts: 10–12 s and 12–14 s
  const right = cutPart({ ...t, edit: split }, 1);
  assert.deepEqual(pieces({ ...t, edit: right }).map((p) => [p.start, p.duration, p.part]), [[10, 2, 0]]);
  assert.equal(placed({ ...t, edit: right }).duration, 2);
  const left = clampEdit(t, cutPart({ ...t, edit: split }, 0));
  assert.deepEqual(pieces({ ...t, edit: left }).map((p) => [p.start, p.duration, p.head]), [[12, 2, 2]]);
  assert.equal(cutPart({ ...t, edit: right }, 0), null, 'the last part stays');
  assert.equal(cutPart({ ...t, edit: right }, 1), null, 'already gone');
  // Fit in slot trims the last part that's left, and a deleted part leaves nothing to clear.
  const fit = fitSlot({ ...t, edit: right }, { start: 10, end: 11.5 });
  assert.ok(Math.abs(placed({ ...t, edit: fit }).duration - 1.5) < 0.002);
  const pushed = clampEdit(t, { splits: [2], parts: [{ shift: 0, head: 0, tail: 0, cut: true }, { shift: -2, head: 0, tail: 0 }] });
  assert.equal(pieces({ ...t, edit: pushed })[0].start, 10, 'the part after a deleted one can move into its place');
});

test('Start at block puts a trimmed take’s sound at the block’s start', () => {
  const slot = { start: 10, end: 13 };
  // Recorded from 9.8 s, a late reaction: 0.6 s trimmed off the front leaves it starting at 10.4 s.
  const t = { start: 9.8, duration: 3, edit: { splits: [], parts: [{ shift: 0, head: 0.6, tail: 0 }] } };
  assert.equal(placed(t).start, 10.4);
  const e = startAtBlock(t, slot);
  assert.equal(placed({ ...t, edit: e }).start, 10);
  assert.equal(e.parts[0].head, 0.6, 'the trim stays');
  // A split take moves as one, its parts keeping their spacing.
  const split = { ...t, edit: splitAt(t, 11.5) };
  const moved = pieces({ ...t, edit: startAtBlock(split, slot) });
  assert.deepEqual(moved.map((p) => +p.start.toFixed(3)), [10, 11.1]);
  // Not into the block before.
  assert.equal(+placed({ ...t, edit: startAtBlock(t, slot, 10.2) }).start.toFixed(3), 10.2);
});

test('a dragged edge snaps to the nearest target in reach', () => {
  assert.equal(snap(10.04, [10, 12], 0.05), 10);
  assert.equal(snap(10.1, [10, 12], 0.05), 10.1, 'out of reach');
  assert.equal(snap(11.98, [10, 11.97, 12], 0.05), 11.97, 'the nearest wins');
  assert.equal(snap(5, [NaN, undefined], 1), 5);
});
