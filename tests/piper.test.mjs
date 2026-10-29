import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toWav } from '../app/js/piper-engine.js';
import { readWav } from '../app/js/tts.js';

test('readings made in the browser are WAV files the rest of Scribecue reads like the container’s', () => {
  const samples = Float32Array.from({ length: 2205 }, (_, i) => 0.25 * Math.sin(i / 10));
  const w = readWav(toWav(samples, 22050));
  assert.equal(w.rate, 22050);
  assert.equal(w.samples.length, 2205);
  assert.ok(Math.abs(w.secs - 0.1) < 1e-9);
  // brought up to full scale, as Piper does
  assert.ok(Math.max(...Array.from(w.samples, Math.abs)) > 32700);
});

test('silence stays silent rather than being amplified', () => {
  const w = readWav(toWav(new Float32Array(100), 16000));
  assert.ok(w.samples.every((s) => s === 0));
});

test('the web build fetches the same voices as the Piper container', () => {
  const docker = readFileSync(new URL('../piper/Dockerfile', import.meta.url), 'utf8').match(/PIPER_VOICES="([^"]+)"/)[1].split(' ');
  const web = readFileSync(new URL('../scripts/web-piper.sh', import.meta.url), 'utf8').match(/^VOICES="([^"]+)"/m)[1]
    .split(' ').map((v) => `${v.replace('/', '-')}-medium`);
  assert.deepEqual(web, docker);
});

test('long jobs outlast the phonemizer wearing out', async () => {
  const { createEngine, PHONEMIZER_RUNS } = await import('../app/js/piper-engine.js');
  let made = 0;
  // Like the real one: each copy aborts after 86 lines.
  const createPhonemize = async ({ print }) => {
    made++;
    let used = 0;
    return { callMain() { if (++used > 86) throw new Error('Aborted()'); print('{"phoneme_ids":[1,2,3]}'); } };
  };
  const ort = {
    env: { wasm: {} },
    Tensor: class { constructor(type, data, dims) { Object.assign(this, { type, data, dims }); } },
    InferenceSession: { create: async () => ({ run: async () => ({ output: { data: new Float32Array(220) } }) }) },
  };
  const e = createEngine({ ort, createPhonemize });
  await e.addVoice('v', new ArrayBuffer(1), { espeak: { voice: 'en-us' }, audio: { sample_rate: 22050 }, inference: {} });
  for (let k = 0; k < 300; k++) await e.synthesize('v', `Line ${k}`, 1);
  assert.equal(made, Math.ceil(300 / PHONEMIZER_RUNS));

  // and a copy that fails early is replaced, and the line read again
  let flaky = 0;
  const e2 = createEngine({ ort, createPhonemize: async ({ print }) => ({ callMain() { if (flaky++ === 0) throw new Error('Aborted()'); print('{"phoneme_ids":[1]}'); } }) });
  await e2.addVoice('v', new ArrayBuffer(1), { espeak: { voice: 'en-us' }, audio: { sample_rate: 22050 }, inference: {} });
  const wav = await e2.synthesize('v', 'Hello', 1);
  assert.ok(wav.byteLength > 44);
});
