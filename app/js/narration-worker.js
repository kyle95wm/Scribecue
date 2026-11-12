// Reads the takes out of a narration WAV, a slice at a time, off the page.
// in:  { file, at, len, rate }: the WAV, where its sound starts and how many bytes it is
// out: { type: 'progress', done } … then { type: 'done', runs: [{ start, samples }] }
//      or { type: 'error', message }
import { createScan } from './narrationscan.js';

const SLICE = 3 * (1 << 20); // bytes: a whole number of 24-bit samples

self.onmessage = async ({ data: { file, at, len, rate } }) => {
  try {
    const scan = createScan(rate);
    for (let o = 0; o < len; o += SLICE) {
      scan.push(new Uint8Array(await file.slice(at + o, at + Math.min(len, o + SLICE)).arrayBuffer()));
      self.postMessage({ type: 'progress', done: Math.min(1, (o + SLICE) / len) });
    }
    const runs = scan.end();
    self.postMessage({ type: 'done', runs }, runs.map((r) => r.samples.buffer));
  } catch (e) {
    self.postMessage({ type: 'error', message: e.message });
  }
};
