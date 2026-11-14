import { test } from 'node:test';
import assert from 'node:assert/strict';
import { narrationTimeline, prevEnd, scriptPrint, RECORDING_EXT, isRecordingFile, punchIn, PUNCH_FADE, pieces, placed, fullEdit, clampEdit, splitAt, cutPart, silenceEnds, trimSilence, fitSlot, startAtBlock, trimAndStart, snap, flatten, wavePeaks, peakTrail, clipAt, pickupsFor, relink, pickedUp, originalTake, checkPickups, checkAlts, isAlt, markerLabel, takesKey, newProjectId, nextRecording, START_OVER, typedStartOver, EDIT_MIN, takeAt, nextTake, toRecordingFile, fromRecordingFile, asRecordingFile, narrationNote, compareScript, sameVideo, slots, GRACE, GRACES, readGrace, peakDb, judgePeak, checkExport, exportReport, recordingId, placeTake, looksBluetooth, runsOver, videoDb, videoDbText, VIDEO_DB_MIN, leadInParts, partEnds, stepEnd, EDGE_FADE } from '../app/js/recording.js';
import { buildBwf, wav24, to24, from24, readNote, fadeEnds24 } from '../app/js/bwf.js';

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

test('a recording file keeps the grace its writer picked, and older files get half a second', () => {
  const r = fromRecordingFile(JSON.parse(JSON.stringify(toRecordingFile({ blocks, grace: 2 }))));
  assert.equal(r.grace, 2);
  assert.deepEqual(slots(r.blocks, r.grace).map((x) => x.end), [5.4, 10, 24]);
  assert.equal(fromRecordingFile(JSON.parse(JSON.stringify(toRecordingFile({ blocks, grace: 0 })))).grace, 0);
  const old = JSON.parse(JSON.stringify(toRecordingFile({ blocks })));
  delete old.grace;
  assert.equal(fromRecordingFile(old).grace, GRACE);
  assert.equal(fromRecordingFile({ ...old, grace: 99 }).grace, GRACE, 'a grace not offered falls back');
  assert.equal(fromRecordingFile({ ...old, grace: '1' }).grace, GRACE);
  assert.ok(GRACES.includes(GRACE));
  assert.equal(readGrace(0.25), 0.25);
  assert.equal(asRecordingFile(r).grace, 2, 'a session rebuilds the file with its grace');
});

test('the export check uses the recording file’s grace', () => {
  const take = { block: 2, start: 20, duration: 3, rate: 48000 }; // runs a second past the last block
  const runs = (g) => checkExport(blocks, [null, null, take], g).warn.some((w) => w.block === 3 && /runs past/.test(w.why));
  assert.ok(!runs(2));
  assert.ok(runs(0));
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

test('a slot runs half a second past its block, and the grace never reaches the next block', () => {
  assert.equal(GRACE, 0.5);
  assert.deepEqual(slots(blocks), [{ start: 2, end: 5.4 }, { start: 5.4, end: 8.5 }, { start: 20, end: 22.5 }]);
  assert.deepEqual(slots(blocks, 0), [{ start: 2, end: 5 }, { start: 5.4, end: 8 }, { start: 20, end: 22 }]);
  assert.deepEqual(slots(blocks, 1), [{ start: 2, end: 5.4 }, { start: 5.4, end: 9 }, { start: 20, end: 23 }]);
});

test('peaks are judged against the targets', () => {
  const s = new Float32Array([0, 0.5, -0.25]);
  assert.ok(Math.abs(peakDb(s) + 6.02) < 0.01);
  assert.equal(peakDb(new Float32Array(4)), -Infinity);
  // the pocket is −12 to −6; quieter is fine; above −6 is too loud
  assert.deepEqual([-5, -7, -10, -14, -20].map(judgePeak), ['loud', 'good', 'good', 'note', 'quiet']);
  assert.equal(judgePeak(-6), 'good');
  assert.equal(judgePeak(-12), 'good');
  assert.equal(judgePeak(-5.9), 'loud');
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

test('Trim silence leaves out the click of the key that stopped the recording', () => {
  const R = 1000, pcm = new Float32Array(5 * R);
  // Two words with a pause, then 1.5 s of quiet, then a 20 ms click as the narrator stops.
  pcm.fill(0.3, 1 * R, 1.6 * R); pcm.fill(0.3, 1.8 * R, 2.5 * R);
  pcm.fill(0.2, 4.0 * R, 4.02 * R);
  const s = silenceEnds(pcm, R, { pad: 0.05 });
  assert.ok(Math.abs(s.head - 0.95) < 0.002, `head ${s.head}`);
  assert.ok(Math.abs(s.tail - 2.45) < 0.002, `the click is trimmed with the quiet: tail ${s.tail}`);
  // A tap before speaking goes too.
  const tap = new Float32Array(4 * R);
  tap.fill(0.2, 0.2 * R, 0.23 * R); tap.fill(0.3, 1 * R, 2 * R);
  assert.ok(Math.abs(silenceEnds(tap, R).head - 0.95) < 0.002);
  // A short word on its own is kept: it's all there is.
  const one = new Float32Array(2 * R);
  one.fill(0.3, 0.5 * R, 0.6 * R);
  assert.ok(Math.abs(silenceEnds(one, R).head - 0.45) < 0.002);
  // A soft ending close to the last word stays, such as a final "t".
  const t = new Float32Array(4 * R);
  t.fill(0.3, 1 * R, 2 * R); t.fill(0.05, 2.1 * R, 2.13 * R);
  assert.ok(Math.abs(silenceEnds(t, R).tail - (4 - 2.13 - 0.05)) < 0.003);
});

test('Trim silence allows for a noisy room', () => {
  const R = 1000, pcm = new Float32Array(4 * R);
  let seed = 3; const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < pcm.length; i++) pcm[i] = noise() * 0.01; // room noise at −40 dBFS, above the −45 floor
  for (let i = 1 * R; i < 2.5 * R; i++) pcm[i] = 0.3 * Math.sin(i);
  const s = silenceEnds(pcm, R);
  assert.ok(Math.abs(s.head - 0.95) < 0.003, `head ${s.head}`);
  assert.ok(Math.abs(s.tail - 1.45) < 0.003, `tail ${s.tail}`);
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

test('trimming a part back out brings back sound a split took away', () => {
  const t = { id: 'a', start: 10, duration: 4 };
  // Split at 12 s and 12.5 s, and the middle deleted by mistake: the start of a word with it.
  const two = splitAt(t, 12), three = splitAt({ ...t, edit: two }, 12.5);
  const gap = cutPart({ ...t, edit: three }, 1);
  const at = (e) => pieces({ ...t, edit: clampEdit(t, e) }).map((p) => [+p.start.toFixed(3), +p.duration.toFixed(3), +p.head.toFixed(3)]);
  assert.deepEqual(at(gap), [[10, 2, 0], [12.5, 1.5, 2.5]]);
  const head = (v) => ({ ...gap, parts: gap.parts.map((p, k) => (k === 2 ? { ...p, head: v } : p)) });
  assert.deepEqual(at(head(-0.3)), [[10, 2, 0], [12.2, 1.8, 2.2]], 'the start of the word is back');
  assert.deepEqual(at(head(-2)), [[10, 2, 0], [12, 2, 2]], 'no further than the part before it');
  const tail = (v) => ({ ...gap, parts: gap.parts.map((p, k) => (k === 0 ? { ...p, tail: v } : p)) });
  assert.deepEqual(at(tail(-0.3)), [[10, 2.3, 0], [12.5, 1.5, 2.5]], 'the end of the first part reaches in too');
  assert.deepEqual(at(tail(-1)), [[10, 2.5, 0], [12.5, 1.5, 2.5]], 'no further than the part after it');
  assert.deepEqual(at({ splits: [], parts: [{ head: -1, tail: -1 }] }), [[10, 4, 0]], 'nothing from before or after the recording');
  // Split where a part reaches past its split point: the halves keep the sound either side.
  const reach = clampEdit(t, head(-0.3)), again = splitAt({ ...t, edit: reach }, 12.35);
  assert.deepEqual(at(again), [[10, 2, 0], [12.2, 0.15, 2.2], [12.35, 1.65, 2.35]]);
});

test('Trim silence keeps sound a part reaches back for', () => {
  const R = 1000, pcm = new Float32Array(4 * R);
  pcm.fill(0.3, 1.5 * R, 1.7 * R); pcm.fill(0.3, 2.4 * R, 4 * R); // a word starting before the split at 2 s
  const t = { start: 0, duration: 4, edit: { splits: [2], parts: [{ shift: 0, head: 0, tail: 0, cut: true }, { shift: 0, head: -0.8, tail: 0 }] } };
  const e = trimSilence(t, pcm, R);
  assert.ok(Math.abs(e.parts[1].head + 0.55) < 0.002, JSON.stringify(e));
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

test('Trim and start at block cuts a late start and puts the sound at the block’s start', () => {
  const R = 1000, pcm = new Float32Array(3 * R);
  pcm.fill(0.3, 0.8 * R, 2.5 * R); // recorded from 9.5 s; the narrator came in 0.8 s later
  const t = { start: 9.5, duration: 3, edit: { splits: [], parts: [{}] } }, slot = { start: 10, end: 13 };
  const e = trimAndStart(t, pcm, slot, 0, R), p = placed({ ...t, edit: e });
  assert.equal(+p.start.toFixed(3), 10, 'its sound starts at the block');
  assert.ok(Math.abs(e.parts[0].head - 0.75) < 0.002, `the silence before it is trimmed, keeping a moment: ${e.parts[0].head}`);
  assert.ok(Math.abs(p.duration - 1.8) < 0.003, `and the silence after: ${p.duration}`);
  // Not into the block before.
  assert.equal(+placed({ ...t, edit: trimAndStart(t, pcm, slot, 10.1, R) }).start.toFixed(3), 10.1);
});

test('a dragged edge snaps to the nearest target in reach', () => {
  assert.equal(snap(10.04, [10, 12], 0.05), 10);
  assert.equal(snap(10.1, [10, 12], 0.05), 10.1, 'out of reach');
  assert.equal(snap(11.98, [10, 11.97, 12], 0.05), 11.97, 'the nearest wins');
  assert.equal(snap(5, [NaN, undefined], 1), 5);
});

test('on the take track, a clip is grabbed by its ends to trim it and by its middle to move it', () => {
  const t = { id: 'a', start: 10, duration: 2 }, pps = 100; // a 200 px clip
  assert.deepEqual(clipAt([t], 10.02, pps), { t, k: 0, mode: 'head' });
  assert.equal(clipAt([t], 9.96, pps).mode, 'head', 'just outside the start still grabs it');
  assert.equal(clipAt([t], 11, pps).mode, 'shift');
  assert.equal(clipAt([t], 11.99, pps).mode, 'tail');
  assert.equal(clipAt([t], 9.9, pps), null);
  assert.equal(clipAt([t], 11, 6).mode, 'shift', 'a narrow clip keeps a middle');
});

test('on the take track, each part of a split take is its own clip', () => {
  const t = { id: 'a', start: 10, duration: 4, edit: { splits: [2], parts: [{}, { shift: 1 }] } };
  assert.equal(clipAt([t], 11, 100).k, 0);
  assert.equal(clipAt([t], 13.5, 100).k, 1);
  assert.equal(clipAt([t], 12.5, 100), null, 'the gap between the parts');
  const cut = { ...t, edit: { splits: [2], parts: [{}, { shift: 1, cut: true }] } };
  assert.equal(clipAt([cut], 13.5, 100), null, 'a deleted part is not there');
});

const line = (start, end, text) => ({ start, end, text });

test('a new version of a recording file asks for new and reworded lines, and marked ones', () => {
  const sent = [line(2, 5, 'She opens the door.'), line(9, 13, 'A hallway.'), line(20, 24, 'He turns.')];
  const now = [line(2, 5, 'She opens the door.'), { ...line(9, 13, 'A long hallway, lit by one bulb.') }, { ...line(20, 24, 'He turns.'), pickup: { note: 'Stress “turns”' } }, line(30, 33, 'Rain.')];
  assert.deepEqual(pickupsFor(now, sent), [null, { was: 'A hallway.' }, { note: 'Stress “turns”' }, { added: true }]);
  assert.deepEqual(pickupsFor(now, null), [null, null, { note: 'Stress “turns”' }, null], 'the first version: only marked lines');
  assert.deepEqual(pickupsFor([line(2, 5, '  She opens  the door. ')], sent), [null], 'spacing doesn’t count as a change');
});

test('a recording file keeps its project, version and pickups', () => {
  const blocks = [line(2, 5, 'A.'), { ...line(9, 13, 'B.'), pickup: { note: 'Siobhan: shi-VAWN' } }];
  const f = fromRecordingFile(JSON.parse(JSON.stringify(toRecordingFile({ blocks, project: 'abcdefgh12345678', version: 2, sent: [line(2, 5, 'A.'), line(9, 13, 'B.')] }))));
  assert.equal(f.project, 'abcdefgh12345678');
  assert.equal(f.version, 2);
  assert.equal(f.edited, false);
  assert.deepEqual(f.blocks.map((b) => b.pickup || null), [null, { note: 'Siobhan: shi-VAWN' }]);
  assert.equal(takesKey(f), 'abcdefgh12345678-0');
  const old = fromRecordingFile(JSON.parse(JSON.stringify(toRecordingFile({ blocks }))));
  assert.equal(old.project, undefined, 'without a project, as before');
  assert.equal(takesKey(old), recordingId(old));
  assert.equal(fromRecordingFile({ scribecueRecording: 1, project: '../../etc', blocks: [] }).project, undefined, 'an id that isn’t one is dropped');
  assert.match(newProjectId(), /^[a-z0-9]{16}$/);
});

test('takes follow their lines to a new version of the script', () => {
  const take = (id, block, l, extra = {}) => ({ id, block, start: l.start + 0.1, line: l, chosen: true, made: 1, ...extra });
  const a = line(2, 5, 'She opens the door.'), b = line(9, 13, 'A hallway.'), c = line(20, 24, 'He turns.');
  const takes = [take('a', 0, a), take('b', 1, b), take('c', 2, c)];
  // Block 2 reworded, a line added before block 1, and block 3 moved 1 s later.
  const now = [line(1, 1.8, 'Night.'), a, line(9, 13, 'A long hallway.'), line(21, 25, 'He turns.')];
  const ch = Object.fromEntries(relink(takes, now).map((x) => [x.id, x]));
  assert.deepEqual([ch.a.block, ch.a.start, ch.a.chosen], [1, 2.1, true], 'renumbered, kept');
  assert.deepEqual([ch.b.block, ch.b.chosen, ch.b.line.text], [-1, false, 'A hallway.'], 'reworded: kept, out of the export, with its old line');
  assert.equal(ch.c.block, 3);
  assert.ok(Math.abs(ch.c.start - 21.1) < 1e-9, 'moved with its block');
  assert.deepEqual(ch.c.line, line(21, 25, 'He turns.'));
  assert.deepEqual(relink(takes, [a, b, c]), [], 'nothing changed, nothing to save');
});

test('takes from before lines were kept take them from their own script', () => {
  const old = [line(2, 5, 'A.'), line(9, 13, 'B.')];
  const ch = relink([{ id: 'x', block: 1, start: 9.1, chosen: true, made: 1 }], old, old);
  assert.deepEqual(ch, [{ id: 'x', block: 1, start: 9.1, line: line(9, 13, 'B.'), chosen: true, alt: null }]);
});

test('when two lines become one, one take stays chosen', () => {
  const a = line(2, 5, 'He nods.'), b = line(9, 12, 'He nods.');
  const takes = [{ id: 'old', block: 0, start: 2.1, line: a, chosen: true, made: 1 }, { id: 'new', block: 1, start: 9.1, line: b, chosen: true, made: 2 }];
  const ch = relink(takes, [b]);
  assert.equal(ch.find((x) => x.id === 'new').chosen, true);
  assert.equal(ch.find((x) => x.id === 'old').chosen, false);
});

test('a pickup is done once it is recorded for this version', () => {
  assert.equal(pickedUp({ ver: 2 }, 2), true);
  assert.equal(pickedUp({ ver: 1 }, 2), false);
  assert.equal(pickedUp({}, 1), false, 'takes from before versions');
  assert.equal(pickedUp(null, 1), false);
  const blocks = [line(2, 5, 'A.'), { ...line(9, 13, 'B.'), pickup: { note: 'n' } }, { ...line(20, 24, 'C.'), pickup: { was: 'c' } }];
  const t = (start, ver) => ({ start, duration: 2, peak: -10, ver });
  const r = checkPickups(blocks, [t(2.1, 1), t(9.1, 1), t(20.1, 2)], 2);
  assert.deepEqual(r.warn, [{ block: 2, why: 'isn’t recorded again yet' }], 'only pickups are checked');
  assert.deepEqual(r.takes.map(Boolean), [false, false, true]);
});

test('a pickup is compared with the take from before it', () => {
  const t = (id, ver, chosen = false) => ({ id, ver, chosen });
  assert.equal(originalTake([t('a', 1, true), t('b', 1)], [], 2).id, 'a', 'the one in the export');
  assert.equal(originalTake([t('a', 1), t('b', 1), t('p', 2, true)], [], 2).id, 'b', 'the latest once the pickup is in');
  assert.equal(originalTake([t('p', 2, true)], [t('o', 1)], 2).id, 'o', 'the old wording');
  assert.equal(originalTake([{ id: 'x' }], [], 1).id, 'x', 'takes from before versions');
  assert.equal(originalTake([t('p', 2, true)], [], 2), null);
});

test('a pickup’s marker in the WAV carries its note', () => {
  assert.equal(markerLabel(line(2, 5, 'She opens the door.'), 1), '1 She opens the door.');
  assert.equal(markerLabel({ ...line(2, 5, 'Siobhan waves.'), pickup: { note: 'Siobhan: shi-VAWN' } }, 3), '3 PICKUP: Siobhan: shi-VAWN | Siobhan waves.');
  assert.equal(markerLabel({ ...line(2, 5, 'B.'), pickup: { was: 'A.' } }, 4), '4 PICKUP: reworded | B.');
});

test('a recording file carries each block’s notes, which leave the script’s fingerprint alone', () => {
  const plain = [line(2, 5, 'A.'), line(9, 13, 'B.')];
  const noted = [line(2, 5, 'A.'), { ...line(9, 13, 'B.'), notes: 'Siobhan: shi-VAWN' }];
  const file = JSON.parse(JSON.stringify(toRecordingFile({ blocks: noted })));
  assert.equal(file.print, toRecordingFile({ blocks: plain }).print, 'notes are not part of what is read');
  const r = fromRecordingFile(file);
  assert.deepEqual(r.blocks.map((b) => b.notes ?? null), [null, 'Siobhan: shi-VAWN']);
  assert.equal(r.edited, false);
});

test('an alt take follows its block, and has a chosen take of its own beside the original’s', () => {
  const a = line(2, 5, 'He walks towards the door.'), b = line(9, 12, 'Rain.');
  const takes = [{ id: 'o', block: 0, start: 2.1, line: a, chosen: true, made: 1 }, { id: 'x', block: 0, start: 2.2, line: a, chosen: true, made: 2, alt: 'He walks toward the door.' }];
  assert.ok(isAlt(takes[1]) && !isAlt(takes[0]));
  const moved = [line(3, 6, a.text), b];
  const ch = Object.fromEntries(relink(takes, moved).map((x) => [x.id, x]));
  assert.equal(ch.x.block, 0);
  assert.equal(ch.x.start, 3.2, 'it moves with its block');
  assert.equal(ch.x.alt, 'He walks toward the door.');
  assert.equal(ch.x.chosen, true, 'both stay chosen: one is the original, one the alt');
  assert.equal(ch.o.chosen, true);
});

test('once the writer uses an alt, its takes become the block’s own', () => {
  const was = line(2, 5, 'He walks towards the door.');
  const takes = [{ id: 'o', block: 0, start: 2.1, line: was, chosen: true, made: 1 }, { id: 'x', block: 0, start: 2.2, line: was, chosen: true, made: 2, alt: 'He walks toward the door.' }];
  const ch = Object.fromEntries(relink(takes, [line(2, 5, 'He walks toward the door.')]).map((x) => [x.id, x]));
  assert.deepEqual({ block: ch.x.block, alt: ch.x.alt, chosen: ch.x.chosen }, { block: 0, alt: null, chosen: true });
  assert.equal(ch.o.block, -1, 'the old wording’s take belongs to no block');
});

test('an alt goes in the narration note and the alts WAV’s markers, and is checked like a take', () => {
  const blocks = [line(2, 5, 'He walks towards the door.'), line(9, 12, 'Rain.')];
  const note = narrationNote({ blocks, alts: ['He walks toward the door.', null], altOnly: true });
  assert.equal(note.altOnly, true);
  assert.deepEqual(note.blocks.map((b) => b.alt ?? null), ['He walks toward the door.', null]);
  assert.equal(markerLabel(blocks[0], 1, 'He walks toward the door.'), '1 ALT | He walks toward the door.');
  const loud = { start: 2.1, duration: 2, peak: -3 };
  const c = checkAlts(blocks, [loud, null]);
  assert.equal(c.stop.length, 1);
  assert.match(c.stop[0].why, /^\(alt\) peaks/);
  assert.deepEqual(c.warn, [], 'a block without an alt isn’t mentioned');
});

test('a recording file made again from what was read opens the same, pickups and all', () => {
  const sent = [{ start: 1, end: 3, text: 'She opens the door.' }];
  const file = toRecordingFile({ project: 'abcdefghijklmnop', version: 2, sent, fps: 24, start: 5, media: { name: 'film.mp4', size: 10, duration: 60 },
    blocks: [{ start: 1, end: 3, text: 'She shoves the door open.', notes: 'Firmly' }, { start: 4, end: 6, text: 'Rain.', pickup: { note: 'Softer' } }] });
  const read = fromRecordingFile(JSON.parse(JSON.stringify(file)));
  const again = fromRecordingFile(JSON.parse(JSON.stringify(asRecordingFile(read, '1.0'))));
  assert.deepEqual(again, read);
  assert.equal(again.blocks[0].pickup.was, 'She opens the door.');
  assert.equal(takesKey(again), takesKey(read));
});

test('a take’s waveform grows as its sound arrives, the same as drawn from the whole take', () => {
  const pcm = new Float32Array(48000 * 3).map((_, i) => Math.sin(i / 50) * (i % 7000) / 7000);
  const trail = peakTrail(240);
  for (let i = 0; i < pcm.length; i += 4096) trail.add(pcm.subarray(i, i + 4096));
  assert.equal(trail.peaks.length, 600);
  assert.deepEqual([...trail.peaks], [...wavePeaks(pcm, 600)]);
  trail.add(new Float32Array(100).fill(0.9));
  assert.equal(trail.peaks.length, 600, 'a column shows once it’s full');
});

// ---- Extended blocks

const held = [
  { start: 1, end: 3, text: 'one' },
  { start: 4, end: 4.1, text: 'two', extended: true },
  { start: 5, end: 7, text: 'three' },
  { start: 9, end: 9.1, text: 'four', extended: true },
];

test('a recording file says which blocks are extended, and survives the round trip', () => {
  const file = toRecordingFile({ blocks: held });
  const back = fromRecordingFile(JSON.parse(JSON.stringify(file)));
  assert.deepEqual(back.blocks.map((b) => !!b.extended), [false, true, false, true]);
  assert.equal(back.edited, false);
});

test('marking a block extended changes the fingerprint, and old files keep theirs', () => {
  const plain = held.map(({ extended, ...b }) => b);
  assert.notEqual(scriptPrint(held), scriptPrint(plain));
  assert.equal(scriptPrint(plain), scriptPrint(JSON.parse(JSON.stringify(plain))));
});

test('an extended block has a slot with no end, and leaves the next block its start', () => {
  const sl = slots(held);
  assert.deepEqual(sl[1], { start: 4, end: Infinity, hold: true, mark: 4.1 });
  assert.equal(prevEnd(sl, 0), 0);
  assert.equal(prevEnd(sl, 1), 3.5);
  assert.equal(prevEnd(sl, 2), 4);
  assert.equal(runsOver({ start: 4, duration: 60 }, sl[1]), false);
});

test('the narration stretches by each extended take, from the block’s start', () => {
  const takes = [{ start: 1, duration: 2 }, { start: 3.9, duration: 3.1 }, null, { start: 8.95, duration: 2.05 }];
  const { starts, moved, pauses, added } = narrationTimeline(held, takes);
  assert.deepEqual(pauses.map((p) => [p.at, +p.secs.toFixed(3)]), [[4, 3], [9, 2]]);
  assert.deepEqual(starts.map((s) => +s.toFixed(3)), [1, 4, 8, 12]);
  assert.deepEqual(moved.map((s) => +s.toFixed(3)), [0, 0, 3, 3]);
  assert.equal(+added.toFixed(3), 5);
});

test('an extended block with no take pauses nothing', () => {
  assert.equal(narrationTimeline(held, [null, null, null, null]).added, 0);
});

test('the narration’s note gives the pauses, and a changed block shows up when compared', () => {
  const note = narrationNote({ blocks: held, pauses: [{ at: 4, secs: 3 }] });
  assert.deepEqual(note.pauses, [{ at: 4, secs: 3 }]);
  assert.equal(note.blocks[1].extended, true);
  const plain = held.map(({ extended, ...b }) => b);
  assert.deepEqual(compareScript(note, plain).lines.map((l) => l.line), [2, 4]);
  assert.equal(compareScript(note, held).same, true);
});

test('the video sound in Record mode stays between 0 and −30 dB, and starts at −30', () => {
  assert.equal(VIDEO_DB_MIN, -30);
  assert.equal(videoDb(null), -30);
  assert.equal(videoDb(''), -30);
  assert.equal(videoDb('junk'), -30);
  assert.equal(videoDb('-12'), -12);
  assert.equal(videoDb('0'), 0);
  assert.equal(videoDb(-40), -30);
  assert.equal(videoDb(6), 0);
  assert.equal(videoDb('-6.4'), -6);
  assert.equal(videoDbText(-18), '−18 dB');
  assert.equal(videoDbText(0), '0 dB');
});

test('recording a block, the lead-in plays the other blocks’ takes that start before the recording', () => {
  const list = [{ block: 0, start: 2 }, { block: 1, start: 6 }, { block: 2, start: 9 }, { block: 3, start: 14 }];
  // block 2 records from 8.8: block 1's take, started at 6, plays on; block 2's own and block 3's don't.
  assert.deepEqual(leadInParts(list, 2, 8.8).map((p) => p.block), [0, 1]);
  // punching into block 2 at 11: its own take is played separately, up to the join.
  assert.deepEqual(leadInParts(list, 2, 11).map((p) => p.block), [0, 1]);
});

test('E steps the playhead through the ends of a take’s parts, going round', () => {
  const t = { id: 'a', start: 10, duration: 4, edit: { splits: [2], parts: [{}, {}] } };
  const ends = partEnds(t);
  assert.deepEqual(ends.map((e) => +e.toFixed(3)), [12, 14]);
  assert.equal(stepEnd(ends, 5), 12);
  assert.equal(stepEnd(ends, 12), 14); // already at an end: on to the next
  assert.equal(stepEnd(ends, 14), 12); // past the last: round to the first
  assert.equal(stepEnd(ends, 13, -1), 12);
  assert.equal(stepEnd(ends, 12, -1), 14);
  assert.equal(stepEnd([], 3), null);
  assert.deepEqual(partEnds({ id: 'b', start: 1, duration: 2 }), [3]);
});

test('the next recording file carries on the project, or starts a new one at version 1', () => {
  const first = nextRecording(null);
  assert.match(first.id, /^[a-z0-9]{16}$/);
  assert.equal(first.version, 1); assert.equal(first.sent, null);
  const sent = [{ start: 1, end: 2, text: 'One.' }];
  const last = { id: 'abcdefghijklmnop', version: 3, sent };
  assert.deepEqual(nextRecording(last), { id: 'abcdefghijklmnop', version: 4, sent });
  const fresh = nextRecording(last, true);
  assert.notEqual(fresh.id, last.id);
  assert.equal(fresh.version, 1); assert.equal(fresh.sent, null);
  // Old takes are from another project, so none counts as a pickup recorded for it.
  assert.notEqual(takesKey({ project: fresh.id }), takesKey({ project: last.id }));
});

test('starting over needs START OVER typed exactly, in capitals', () => {
  assert.equal(START_OVER, 'START OVER');
  assert.ok(typedStartOver('START OVER'));
  assert.ok(typedStartOver('  START OVER\n'));
  for (const t of ['start over', 'Start Over', 'START OVER!', 'STARTOVER', 'START  OVER', '', null, undefined]) assert.equal(typedStartOver(t), false, String(t));
});

test('each part of a take fades in and out, except where it carries straight on', () => {
  const t = { id: 'a', start: 10, duration: 4 };
  const [whole] = pieces(t);
  assert.deepEqual([whole.fadeIn, whole.fadeOut], [EDGE_FADE, EDGE_FADE], 'a take on its own');
  const split = { ...t, edit: splitAt(t, 12) };
  const [a, b] = pieces(split);
  assert.deepEqual([a.fadeIn, a.fadeOut, b.fadeIn, b.fadeOut], [EDGE_FADE, 0, 0, EDGE_FADE], 'a split nobody moved plays on without a dip');
  const moved = { ...t, edit: { splits: [2], parts: [{ shift: 0, head: 0, tail: 0 }, { shift: 0.5, head: 0, tail: 0 }] } };
  assert.deepEqual(pieces(moved).map((p) => [p.fadeIn, p.fadeOut]), [[EDGE_FADE, EDGE_FADE], [EDGE_FADE, EDGE_FADE]], 'moved apart');
  const trimmed = { ...t, edit: { splits: [2], parts: [{ shift: 0, head: 0, tail: 0.3 }, { shift: -0.3, head: 0, tail: 0 }] } };
  assert.deepEqual(pieces(trimmed).map((p) => [p.fadeIn, p.fadeOut]), [[EDGE_FADE, EDGE_FADE], [EDGE_FADE, EDGE_FADE]], 'a pause cut out');
  const tiny = pieces({ id: 'b', start: 0, duration: 0.004 })[0];
  assert.equal(tiny.fadeIn, 0.002, 'never more than half the part');
});

test('a part’s ends are faded from and to silence in the export', async () => {
  const n = 1000, flat = new Float32Array(n).fill(0.5);
  const out = from24(new Uint8Array(await (await fadeEnds24(new Blob([to24(flat)]), 10, 20)).arrayBuffer()));
  assert.equal(out.length, n);
  assert.ok(Math.abs(out[0] - 0.025) < 1e-4, 'starts near silence');
  assert.ok(out[0] < out[5] && out[5] < out[9]);
  assert.ok(Math.abs(out[10] - 0.5) < 1e-6 && Math.abs(out[n - 21] - 0.5) < 1e-6, 'the middle is as recorded');
  assert.ok(Math.abs(out[n - 1] - 0.0125) < 1e-4, 'ends near silence');
  const same = new Blob([to24(flat)]);
  assert.equal(await fadeEnds24(same, 0, 0), same, 'nothing to fade: the same Blob');
  const short = from24(new Uint8Array(await (await fadeEnds24(new Blob([to24(flat.subarray(0, 4))]), 10, 10)).arrayBuffer()));
  assert.equal(short.length, 4, 'a fade longer than the part keeps its length');
});

test('the BWF export fades each part where it was cut', async () => {
  const pcm = await fadeEnds24(new Blob([to24(new Float32Array(480).fill(0.5))]), 240, 240);
  const wav = buildBwf({ takes: [{ start: 0, pcm }], secs: 0.02, rate: 48000 });
  const bytes = new Uint8Array(await wav.arrayBuffer());
  const data = bytes.length - 960 * 3; // the samples are at the end
  const s = from24(bytes.subarray(data));
  assert.ok(s[0] < 0.01 && s[479] < 0.01 && s[240] > 0.49, 'silence at the cuts, full in the middle');
});
