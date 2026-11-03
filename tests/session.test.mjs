import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSession, fromSession, cleanTake, rebuild, takeNote, isSessionPackage, SESSION_FILE } from '../app/js/session.js';
import { openSession } from '../app/js/takestore.js';
import { wav24, withTakeNote, readTakeNote, plainTake, readNote, WAV24_HEADER } from '../app/js/bwf.js';
import { crc32, storeZip, readZip } from '../app/js/zip.js';

// A folder in memory, with the parts of the File System Access API the session uses.
let clock = 1;
const notFound = () => Object.assign(new Error('not found'), { name: 'NotFoundError' });
class FileH {
  kind = 'file';
  constructor(name) { this.name = name; this.data = new File([], name, { lastModified: clock++ }); }
  async getFile() { return this.data; }
  async createWritable() {
    const parts = [];
    return { write: async (d) => { parts.push(d); }, close: async () => { this.data = new File(parts, this.name, { lastModified: clock++ }); }, abort: async () => {} };
  }
}
class DirH {
  kind = 'directory';
  constructor(name) { this.name = name; this.kids = new Map(); }
  async getFileHandle(n, { create = false } = {}) {
    let h = this.kids.get(n);
    if (!h) { if (!create) throw notFound(); h = new FileH(n); this.kids.set(n, h); }
    return h;
  }
  async getDirectoryHandle(n, { create = false } = {}) {
    let h = this.kids.get(n);
    if (!h) { if (!create) throw notFound(); h = new DirH(n); this.kids.set(n, h); }
    return h;
  }
  async removeEntry(n) { if (!this.kids.delete(n)) throw notFound(); }
  async *entries() { yield* this.kids.entries(); }
}

const KEY = 'abcdefghijklmnop-0';
const recording = { scribecueRecording: 1, project: 'abcdefghijklmnop', version: 1, blocks: [{ start: 1, end: 3, text: 'She opens the door.' }] };
const sound = (n = 4801) => wav24(new Uint8Array(n * 3).map((_, i) => i % 200));
let ids = 0;
const take = (over = {}) => ({ id: `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`, rec: KEY, block: 0, start: 1.02, duration: 0.1,
  peak: -9, made: 1000 + ids, line: { start: 1, end: 3, text: 'She opens the door.' }, ver: 1, wav: sound(), ...over });

test('a session keeps its takes, choices and edits, and opens again the same', async () => {
  const dir = new DirH('Lights narration');
  const s = await openSession(dir, { key: KEY, recording });
  const a = take(), b = take(), c = take({ alt: 'She shoves the door open.' });
  await s.save(a, true); await s.save(b, true); await s.save(c, true);
  let list = await s.list(KEY);
  assert.deepEqual(list.filter((t) => t.chosen).map((t) => t.id).sort(), [b.id, c.id].sort(), 'the newest of each side is chosen');
  await s.choose(KEY, a.id);
  await s.edit(KEY, a.id, { shift: 0.2, head: 0, tail: 0.05 });
  await s.setDrafts({ 'x': 'She shoves the door open.' });
  const again = await openSession(dir, { key: KEY, recording });
  list = await again.list(KEY);
  assert.equal(list.length, 3);
  assert.deepEqual(list.find((t) => t.id === a.id).edit, { shift: 0.2, head: 0, tail: 0.05 });
  assert.equal(list.find((t) => t.id === a.id).chosen, true);
  assert.equal(list.find((t) => t.id === b.id).chosen, false);
  assert.equal(list.find((t) => t.id === c.id).chosen, true, 'the alt keeps its own choice');
  assert.deepEqual(again.drafts, { x: 'She shoves the door open.' });
  assert.equal(again.found, 0);
});

test('a take saved again by its id replaces it, with or without its sound', async () => {
  const s = await openSession(new DirH('n'), { key: KEY, recording });
  const a = take();
  await s.save(a, true);
  const [listed] = await s.list(KEY);
  await s.save({ ...listed, peak: -12 }, true);
  const list = await s.list(KEY);
  assert.equal(list.length, 1);
  assert.equal(list[0].peak, -12);
  assert.equal(list[0].crc, listed.crc);
  await assert.rejects(s.save({ ...take(), wav: undefined }), /no sound/);
});

test('a deleted take can be brought back until it’s purged, and isn’t packaged', async () => {
  const dir = new DirH('n');
  const s = await openSession(dir, { key: KEY, recording });
  const a = take(), b = take();
  await s.save(a, true); await s.save(b, true);
  await s.remove(KEY, b.id);
  assert.deepEqual((await s.list(KEY)).map((t) => t.id), [a.id]);
  assert.deepEqual((await s.files()).map((f) => f.name), [SESSION_FILE, `takes/${a.id}.wav`]);
  assert.equal(await s.restore(KEY, b.id), true);
  assert.equal((await s.list(KEY)).length, 2);
  await s.remove(KEY, b.id);
  assert.equal(await s.purge(), 1);
  assert.equal(await s.restore(KEY, b.id), false);
  assert.equal((await dir.getDirectoryHandle('takes')).kids.size, 1, 'its WAV is gone');
});

test('a take deleted when Scribecue last stopped goes when the session opens', async () => {
  const dir = new DirH('n');
  const s = await openSession(dir, { key: KEY, recording });
  const a = take();
  await s.save(a, true); await s.remove(KEY, a.id);
  const again = await openSession(dir, { key: KEY, recording });
  assert.deepEqual(await again.list(KEY), []);
  assert.equal((await dir.getDirectoryHandle('takes')).kids.size, 0);
});

test('a package can hold only some takes, with a session.json to match', async () => {
  const s = await openSession(new DirH('n'), { key: KEY, recording });
  const a = take(), b = take();
  await s.save(a, true); await s.save(b, true);
  const files = await s.files(new Set([b.id]));
  assert.deepEqual(files.map((f) => f.name), [SESSION_FILE, `takes/${b.id}.wav`]);
  assert.deepEqual(fromSession(JSON.parse(await files[0].blob.text())).takes.map((t) => t.id), [b.id]);
});

test('a take saved just before Scribecue stopped comes back from its own WAV', async () => {
  const dir = new DirH('n');
  const s = await openSession(dir, { key: KEY, recording });
  const a = take();
  await s.save(a, true);
  const before = await (await dir.getFileHandle(SESSION_FILE)).getFile();
  const b = take();
  await s.save(b, true);
  // As if session.json hadn't been written after the second take.
  (await dir.getFileHandle(SESSION_FILE)).data = before;
  const again = await openSession(dir, { key: KEY, recording });
  const list = await again.list(KEY);
  assert.equal(again.found, 1);
  assert.deepEqual(list.map((t) => [t.id, t.chosen]), [[a.id, false], [b.id, true]]);
  assert.deepEqual(list[1].line, a.line);
});

test('a take whose WAV has gone is left out, and another recording’s folder is refused', async () => {
  const dir = new DirH('n');
  const s = await openSession(dir, { key: KEY, recording });
  const a = take(), b = take();
  await s.save(a, true); await s.save(b, false);
  await (await dir.getDirectoryHandle('takes')).removeEntry(`${a.id}.wav`);
  const again = await openSession(dir, { key: KEY, recording });
  assert.equal(again.missing, 1);
  assert.deepEqual((await again.list(KEY)).map((t) => t.id), [b.id]);
  await assert.rejects(openSession(dir, { key: 'zzzzzzzzzzzzzzzz-0', recording }), /another recording/);
});

test('a take’s sound comes back as a plain WAV, and packaging uses the checksum kept', async () => {
  const dir = new DirH('n');
  const s = await openSession(dir, { key: KEY, recording });
  const a = take();
  await s.save(a, true);
  const back = await s.audio({ id: a.id });
  assert.deepEqual(new Uint8Array(await back.arrayBuffer()), new Uint8Array(await a.wav.arrayBuffer()));
  const files = await s.files();
  assert.deepEqual(files.map((f) => f.name), [SESSION_FILE, `takes/${a.id}.wav`]);
  assert.equal(files[1].crc, crc32(new Uint8Array(await files[1].blob.arrayBuffer())));
  // The package holds the session as it is on disk.
  const zip = await readZip(await storeZip(files));
  assert.equal(fromSession(JSON.parse(await zip[0].blob.text())).takes[0].id, a.id);
  assert.equal((await readTakeNote(zip[1].blob)).id, a.id);
});

test('a take’s note sits after its sound, where players skip it', async () => {
  const wav = sound(3), note = takeNote(take());
  const kept = await withTakeNote(wav, note);
  const v = new DataView(await kept.arrayBuffer());
  assert.equal(v.getUint32(4, true), kept.size - 8, 'the RIFF size covers the note');
  assert.equal(v.getUint32(40, true), 9);
  assert.deepEqual(await readTakeNote(kept), JSON.parse(JSON.stringify(note)));
  assert.equal(await readNote(kept), null, 'it isn’t a narration');
  const plain = await plainTake(kept);
  assert.equal(plain.size, WAV24_HEADER + 9);
  assert.deepEqual(new Uint8Array(await plain.arrayBuffer()), new Uint8Array(await wav.arrayBuffer()));
});

test('session files are checked as they’re read', () => {
  assert.throws(() => fromSession({}), /isn’t a Scribecue recording session/);
  assert.throws(() => fromSession({ scribecueSession: 2, key: KEY, recording }), /newer version/);
  assert.throws(() => fromSession({ scribecueSession: 1, recording }), /damaged/);
  const t = take();
  const s = fromSession(JSON.parse(JSON.stringify(toSession({ key: KEY, recording, takes: [t, t, { id: 'nope' }], drafts: { a: 1, b: 'two' } }))));
  assert.equal(s.takes.length, 1, 'bad and repeated takes are dropped');
  assert.deepEqual(s.drafts, { b: 'two' });
  assert.equal(s.takes[0].peak, -9);
  assert.equal(cleanTake({ ...t, peak: null }).peak, -Infinity);
  assert.equal(cleanTake({ ...t, block: -1, chosen: true }).chosen, false, 'a take in no block isn’t chosen');
  assert.ok(isSessionPackage('Lights.scribesession'));
  assert.ok(isSessionPackage('Lights.scribecuesession'), 'packages from 0.77.0 still open');
  assert.ok(!isSessionPackage('Lights.scribecuerec'));
});

test('rebuild adds unlisted WAVs in the order they were made', () => {
  const a = cleanTake(take()), b = take(), c = take();
  const { takes, found, missing } = rebuild([{ ...a, chosen: true }], [
    { id: a.id, note: null }, { id: c.id, note: takeNote({ ...c, chosen: true }) }, { id: b.id, note: takeNote({ ...b, chosen: true }) }, { id: 'x', note: { nope: 1 } }]);
  assert.equal(found, 2);
  assert.equal(missing, 0);
  assert.deepEqual(takes.map((t) => [t.id, t.chosen]), [[a.id, false], [b.id, false], [c.id, true]]);
});
