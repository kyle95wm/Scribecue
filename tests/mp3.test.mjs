// The MP3 export: the encoder worker runs under Node, loading lamejs as the browser would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInThisContext } from 'node:vm';
import { TRACK_FORMATS, trackFormat, MP3_DELAY, forMp3 } from '../app/js/mp3.js';

const app = (f) => new URL(`../app/${f}`, import.meta.url);
let sink = () => {};
globalThis.self = globalThis;
globalThis.postMessage = (m) => sink(m);
globalThis.importScripts = (f) => runInThisContext(readFileSync(new URL(f, app('js/'))), { filename: f });
await import('../app/js/mp3-worker.js');

function encode(samples, rate, kbps) {
  return new Promise((resolve) => {
    const msgs = [];
    sink = (m) => { msgs.push(m); if (m.type !== 'progress') resolve({ end: m, msgs }); };
    self.onmessage({ data: { samples, rate, kbps } });
  });
}
const tone = (rate, secs) => Int16Array.from({ length: rate * secs }, (_, i) => Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)));

test('the encoder is lamejs 1.2.1, unchanged', () => {
  const sum = createHash('sha256').update(readFileSync(app('vendor/lame.min.js'))).digest('hex');
  assert.equal(sum, '15d285e2587b3bdbfd18a68de6ce07cc074f7480a82c3815da2dc1c348ec6df4');
  assert.match(readFileSync(app('vendor/lame-LICENSE.txt'), 'utf8'), /Lesser General Public License/);
});

for (const [rate, kbps] of [[22050, 96], [24000, 160], [22050, 64]]) {
  test(`a ${rate} Hz track makes an MP3 at ${kbps} kbps, about the size it should be`, async () => {
    const { end } = await encode(tone(rate, 4), rate, kbps);
    assert.equal(end.type, 'done');
    assert.equal(end.blob.type, 'audio/mpeg');
    const b = new Uint8Array(await end.blob.arrayBuffer());
    assert.ok(b[0] === 0xff && (b[1] & 0xe0) === 0xe0, 'starts with an MP3 frame');
    const want = (4 * kbps * 1000) / 8;
    assert.ok(Math.abs(b.length - want) < want * 0.15, `${b.length} bytes, expected about ${want}`);
  });
}

test('an empty track still makes a file', async () => {
  assert.equal((await encode(new Int16Array(0), 22050, 96)).end.type, 'done');
});

test('the formats match the choices in the settings, and anything else is a WAV', () => {
  const html = readFileSync(app('index.html'), 'utf8');
  const sel = html.match(/<select id="ttsTrackAs">([\s\S]*?)<\/select>/)[1];
  assert.deepEqual([...sel.matchAll(/value="([^"]+)"/g)].map((m) => m[1]), Object.keys(TRACK_FORMATS));
  for (const [k, f] of Object.entries(TRACK_FORMATS)) {
    assert.equal(f.ext, k === 'wav' ? 'wav' : 'mp3');
    if (f.kbps) assert.ok([64, 96, 160].includes(f.kbps));
  }
  assert.equal(trackFormat('flac'), TRACK_FORMATS.wav);
  assert.equal(trackFormat(undefined), TRACK_FORMATS.wav);
});

test('the encoder’s delay is taken off the start, so readings stay on time', () => {
  const s = Int16Array.from({ length: 5000 }, (_, i) => i);
  assert.equal(forMp3(s)[0], MP3_DELAY);
  assert.equal(forMp3(s).length, 5000 - MP3_DELAY);
  assert.equal(forMp3(new Int16Array(10)).length, 0);
});
