import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDawMarkers, tone } from '../app/js/dawmarkers.js';

const blocks = [
  { start: 1.798, end: 5.266, text: 'A painting of a snow-covered forest.' },
  { start: 5.839, end: 11.4, text: 'On a bookshelf,\nsits a tin. Café' },
];

async function parse(blob) {
  const b = new Uint8Array(await blob.arrayBuffer()), v = new DataView(b.buffer);
  const id = (o) => String.fromCharCode(...b.slice(o, o + 4));
  assert.equal(id(0), 'RIFF');
  assert.equal(v.getUint32(4, true), b.length - 8);
  assert.equal(id(8), 'WAVE');
  const out = {};
  for (let o = 12; o < b.length;) {
    const len = v.getUint32(o + 4, true);
    out[id(o)] = { at: o + 8, len };
    out.order = [...(out.order || []), id(o)];
    o += 8 + len + (len % 2);
  }
  return { b, v, c: out };
}

test('markers: mono 16-bit, a cue and a label per block, in the order DAWs expect', async () => {
  const { b, v, c } = await parse(buildDawMarkers({ blocks, secs: 12 }));
  assert.deepEqual(c.order, ['fmt ', 'data', 'cue ', 'LIST']);
  const f = c['fmt '].at;
  assert.deepEqual([v.getUint16(f, true), v.getUint16(f + 2, true), v.getUint32(f + 4, true), v.getUint16(f + 14, true)], [1, 1, 48000, 16]);
  assert.equal(c.data.len, 12 * 48000 * 2);
  const q = c['cue '].at;
  assert.equal(v.getUint32(q, true), 2);
  assert.equal(v.getUint32(q + 4 + 4, true), Math.round(1.798 * 48000));
  assert.equal(v.getUint32(q + 4 + 24 + 20, true), Math.round(5.839 * 48000));
  const list = new TextDecoder().decode(b.slice(c.LIST.at, c.LIST.at + c.LIST.len));
  assert.ok(list.startsWith('adtllabl'));
  assert.ok(list.includes('On a bookshelf, sits a tin. Café\0'), 'one line, UTF-8');
  assert.ok(!list.includes('ltxt'));
});

test('regions: labelled text with each block’s length and the purpose regn', async () => {
  const { b, v, c } = await parse(buildDawMarkers({ blocks, kind: 'regions' }));
  const at = c.LIST.at + 4;
  assert.equal(String.fromCharCode(...b.slice(at, at + 4)), 'ltxt');
  assert.equal(v.getUint32(at + 8, true), 1);
  assert.equal(v.getUint32(at + 12, true), Math.round(5.266 * 48000) - Math.round(1.798 * 48000));
  assert.equal(String.fromCharCode(...b.slice(at + 16, at + 20)), 'regn');
  assert.equal(new TextDecoder().decode(b.slice(at + 28, at + 28 + 9)), 'A paintin');
  assert.ok(!new TextDecoder().decode(b.slice(c.LIST.at, c.LIST.at + c.LIST.len)).includes('labl'));
  // Without secs, the file ends with the last block.
  assert.equal(c.data.len, Math.round(11.4 * 48000) * 2);
});

test('the tone plays while a block lasts and is silent between them', async () => {
  const { v, c } = await parse(buildDawMarkers({ blocks, secs: 12 }));
  const s = (t) => v.getInt16(c.data.at + Math.round(t * 48000) * 2, true);
  const peak = (a, z) => { let m = 0; for (let t = a; t < z; t += 1 / 4800) m = Math.max(m, Math.abs(s(t))); return m; };
  assert.equal(peak(0, 1.79), 0);
  assert.ok(peak(2, 5) > 6000);
  assert.equal(peak(5.27, 5.83), 0);
  assert.equal(peak(11.41, 11.99), 0);
});

test('the tone fades in and out, so it doesn’t click, and its pieces join smoothly', async () => {
  const t = new Int16Array(await new Blob(tone(150000)).arrayBuffer());
  assert.equal(t.length, 150000);
  for (let i = 1; i < t.length; i++) assert.ok(Math.abs(t[i] - t[i - 1]) < 400, `step at ${i}`);
  assert.ok(Math.abs(t[0]) < 50 && Math.abs(t[t.length - 1]) < 300);
  const top = t.reduce((m, x) => Math.max(m, x), 0);
  assert.ok(top > 6500 && top < 6600);
});

test('no blocks: just silence, without cue chunks', async () => {
  const { c } = await parse(buildDawMarkers({ blocks: [], secs: 1 }));
  assert.deepEqual(c.order, ['fmt ', 'data']);
});
