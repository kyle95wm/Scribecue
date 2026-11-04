// Turns the description track into an MP3, away from the page so it stays smooth. Uses
// lamejs (vendor/lame.min.js), a JavaScript version of the LAME encoder, served from
// Scribecue itself.
//
// in:  { pcm, rate, kbps }   a Blob of mono 16-bit samples, read a piece at a time
// out: { type: 'progress', done: 0..1 } ... then { type: 'done', blob } or { type: 'error', message }

importScripts('../vendor/lame.min.js');

const CHUNK = 1152 * 64; // samples handed to the encoder at a time

self.onmessage = async ({ data: { pcm, rate, kbps } }) => {
  try {
    const enc = new lamejs.Mp3Encoder(1, rate, kbps), parts = [];
    let last = 0;
    for (let at = 0; at < pcm.size; at += CHUNK * 2) {
      const samples = new Int16Array(await pcm.slice(at, at + CHUNK * 2).arrayBuffer());
      const out = enc.encodeBuffer(samples);
      if (out.length) parts.push(out);
      const now = Date.now();
      if (now - last > 200) { last = now; postMessage({ type: 'progress', done: at / pcm.size }); }
    }
    const end = enc.flush();
    if (end.length) parts.push(end);
    postMessage({ type: 'done', blob: new Blob(parts, { type: 'audio/mpeg' }) });
  } catch (e) {
    postMessage({ type: 'error', message: e?.message || String(e) });
  }
};
