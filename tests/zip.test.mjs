import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeZip, readZip, crc32 } from '../app/js/zip.js';

test('crc32 matches the standard check value, and carries on across chunks', () => {
  const b = new TextEncoder().encode('123456789');
  assert.equal(crc32(b), 0xcbf43926);
  assert.equal(crc32(b.subarray(4), crc32(b.subarray(0, 4))), 0xcbf43926);
});

test('a stored zip reads back file by file, with progress as it goes', async () => {
  const big = new Uint8Array(3 * (1 << 20) + 5).map((_, i) => i % 251);
  const seen = [];
  const zip = await storeZip([{ name: 'lights-narration.wav', blob: new Blob([big]) }, { name: 'notes – é.txt', blob: new Blob(['Alts: 1\n']) }],
    { progress: (done, total) => seen.push([done, total]) });
  assert.equal(seen.at(-1)[0], seen.at(-1)[1], 'progress reaches the end');
  assert.ok(seen.length > 2);
  const files = await readZip(zip);
  assert.deepEqual(files.map((f) => f.name), ['lights-narration.wav', 'notes – é.txt']);
  assert.deepEqual(new Uint8Array(await files[0].blob.arrayBuffer()), big);
  assert.equal(await files[1].blob.text(), 'Alts: 1\n');
  // The checksum in the header is the file's.
  const head = new DataView(await zip.slice(0, 30).arrayBuffer());
  assert.equal(head.getUint32(14, true), crc32(big));
});

test('something that isn’t a zip reads as null', async () => {
  assert.equal(await readZip(new Blob(['RIFF....WAVE'])), null);
});
