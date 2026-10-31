// Turns the description track into an MP3, away from the page so it stays smooth. Uses
// lamejs (vendor/lame.min.js), a JavaScript version of the LAME encoder, served from
// Scribecue itself.
//
// in:  { samples, rate, kbps }   mono 16-bit samples
// out: { type: 'progress', done: 0..1 } ... then { type: 'done', blob } or { type: 'error', message }

importScripts('../vendor/lame.min.js');

const CHUNK = 1152 * 64; // samples handed to the encoder at a time

self.onmessage = ({ data: { samples, rate, kbps } }) => {
  try {
    const enc = new lamejs.Mp3Encoder(1, rate, kbps), parts = [];
    let last = 0;
    for (let i = 0; i < samples.length; i += CHUNK) {
      const out = enc.encodeBuffer(samples.subarray(i, i + CHUNK));
      if (out.length) parts.push(out);
      const now = Date.now();
      if (now - last > 200) { last = now; postMessage({ type: 'progress', done: i / samples.length }); }
    }
    const end = enc.flush();
    if (end.length) parts.push(end);
    postMessage({ type: 'done', blob: new Blob(parts, { type: 'audio/mpeg' }) });
  } catch (e) {
    postMessage({ type: 'error', message: e?.message || String(e) });
  }
};
