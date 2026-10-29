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
