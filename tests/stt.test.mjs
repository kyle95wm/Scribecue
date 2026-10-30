// Speech to text's pieces that don't need a browser or Whisper itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanText, toWav, silent, emptyBlocks, RATE } from '../app/js/stt.js';

test('drops Whisper’s notes for what isn’t speech', () => {
  assert.equal(cleanText(' [BLANK_AUDIO] '), '');
  assert.equal(cleanText('(music) She opens the door. ♪'), 'She opens the door.');
  assert.equal(cleanText('He  waves.\n [Applause]  Tom   smiles.'), 'He waves. Tom smiles.');
  // Brackets that are part of the description stay.
  assert.equal(cleanText('Tom (now older) smiles.'), 'Tom (now older) smiles.');
  assert.equal(cleanText(undefined), '');
});

test('a block’s text starts with a capital letter', () => {
  assert.equal(cleanText('they speed off.'), 'They speed off.');
  assert.equal(cleanText(' …and then she runs.'), '…And then she runs.');
  assert.equal(cleanText('"we\'re late," says Tom.'), '"We\'re late," says Tom.');
  assert.equal(cleanText('élise smiles.'), 'Élise smiles.');
  assert.equal(cleanText('iPhone in hand, Tom waits.'), 'iPhone in hand, Tom waits.', 'words with capitals of their own stay');
  assert.equal(cleanText('3 men enter.'), '3 men enter.', 'a number first stays');
  assert.equal(cleanText('Already right.'), 'Already right.');
});

test('writes 16 kHz mono 16-bit WAV for the container', async () => {
  const samples = Float32Array.from([0, 0.5, -0.5, 1, -1, 2]);
  const dv = new DataView(await toWav(samples).arrayBuffer());
  assert.equal(dv.byteLength, 44 + samples.length * 2);
  assert.equal(dv.getUint32(24, true), RATE);
  assert.equal(dv.getUint16(22, true), 1);
  assert.equal(dv.getUint16(34, true), 16);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => dv.getInt16(44 + i * 2, true)), [0, 16384, -16383, 32767, -32767, 32767]);
});

test('treats near silence as having no words', () => {
  assert.ok(silent(new Float32Array(16000)));
  assert.ok(silent(new Float32Array(0)));
  const hiss = Float32Array.from({ length: 16000 }, (_, i) => 0.001 * Math.sin(i));
  assert.ok(silent(hiss));
  const speech = Float32Array.from({ length: 16000 }, (_, i) => 0.05 * Math.sin(i / 3));
  assert.ok(!silent(speech));
});

test('only blocks without text are filled in', () => {
  const cues = [{ id: 1, text: '' }, { id: 2, text: 'Tom waves.' }, { id: 3, text: ' <i></i> ' }, { id: 4, text: '{\\an8}' }];
  assert.deepEqual(emptyBlocks(cues).map((c) => c.id), [1, 3, 4]);
});

test('the web version’s Whisper files are fetched and checked like Piper’s', () => {
  const pages = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  assert.match(pages, /scripts\/web-whisper\.sh _site/);
  const script = readFileSync(new URL('../scripts/web-whisper.sh', import.meta.url), 'utf8');
  // Every file the worker loads is pinned and checked.
  for (const f of ['transformers.min.js', 'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm', 'encoder_model.onnx', 'decoder_model_merged_quantized.onnx', 'tokenizer.json']) {
    assert.match(script, new RegExp(`${f.replace(/\./g, '\\.')}[" ]+[0-9a-f]{64}|check "\\$out/${f.replace(/\./g, '\\.')}" [0-9a-f]{64}`), f);
  }
  const worker = readFileSync(new URL('../app/js/whisper-worker.js', import.meta.url), 'utf8');
  assert.match(worker, /ort-wasm-simd-threaded\.asyncify\.wasm/);
});

test('the Docker version reaches Whisper only through Scribecue’s server', () => {
  const nginx = readFileSync(new URL('../nginx.conf', import.meta.url), 'utf8');
  assert.match(nginx, /location = \/stt\/transcribe/);
  const compose = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');
  const whisper = compose.slice(compose.indexOf('\n  whisper:'), compose.indexOf('\n  ollama:'));
  assert.match(whisper, /profiles: \[whisper\]/);
  assert.match(whisper, /networks: \[voices\]/);
  assert.doesNotMatch(whisper, /ports:/);
});
