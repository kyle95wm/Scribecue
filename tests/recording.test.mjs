import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toRecordingFile, fromRecordingFile, narrationNote, compareScript, sameVideo, slots, peakDb, judgePeak, checkExport, exportReport, recordingId, placeTake, looksBluetooth, runsOver } from '../app/js/recording.js';
import { buildBwf, wav24, to24, readNote } from '../app/js/bwf.js';

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
