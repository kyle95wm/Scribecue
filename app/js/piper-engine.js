// Piper voices running inside the browser, for the web version of Scribecue, where
// there's no Piper container to ask. It is the same Piper: espeak-ng turns the words into
// sounds (the piper_phonemize WebAssembly build) and ONNX Runtime runs the voice model.
// Readings come back as 16-bit PCM WAV files, just as the container sends them, so the
// rest of Scribecue treats both the same way.
//
// The engine and the voices are downloaded when someone chooses to (see piper-worker.js)
// and served from Scribecue's own site; the files are listed in scripts/web-piper.sh.
// This file doesn't fetch anything itself: it's handed the files' contents, which keeps
// it testable outside a browser.

// files: { ort, createPhonemize, phonemizeWasm, phonemizeData, ortWasm }
//   ort: the onnxruntime-web module; createPhonemize: piper_phonemize's factory;
//   the rest are ArrayBuffers.
export function createEngine(files) {
  const { ort } = files;
  ort.env.wasm.numThreads = 1; // threads need cross-origin isolation, which Pages can't give
  if (files.ortWasm) ort.env.wasm.wasmBinary = files.ortWasm;
  const voices = new Map(); // id -> Promise<{ session, config }>

  // espeak-ng's sounds for the text, as the ids this voice was trained on. One copy of
  // the phonemizer is kept and run again for each line; it's made afresh if it fails.
  let phonemizer = null;
  let lines = [];
  const failed = [];
  const loadPhonemizer = () => (phonemizer ||= files.createPhonemize({
    print: (line) => lines.push(line),
    printErr: (line) => failed.push(line),
    wasmBinary: files.phonemizeWasm,
    getPreloadedPackage: () => files.phonemizeData,
    locateFile: (name) => name,
    noInitialRun: true,
  }));
  async function phonemeIds(text, espeakVoice) {
    const mod = await loadPhonemizer();
    lines = [];
    failed.length = 0;
    try {
      mod.callMain(['-l', espeakVoice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
    } catch (e) {
      phonemizer = null;
      throw e;
    }
    if (!lines.length) {
      phonemizer = null;
      throw new Error('Piper couldn’t read that text' + (failed.length ? `: ${failed.join(' ')}` : ''));
    }
    return JSON.parse(lines[0]).phoneme_ids;
  }

  return {
    // model: ArrayBuffer of the .onnx file; config: its parsed .onnx.json.
    async addVoice(id, model, config) {
      if (!voices.has(id)) {
        const p = ort.InferenceSession.create(model, { executionProviders: ['wasm'] }).then((session) => ({ session, config }));
        p.catch(() => voices.delete(id));
        voices.set(id, p);
      }
      await voices.get(id);
    },
    hasVoice: (id) => voices.has(id),
    removeVoice(id) { voices.delete(id); },

    // Reads the text aloud at this speed (1 is normal) and returns a WAV ArrayBuffer.
    // Random variation in timing is off, as with the container, so the same line at the
    // same speed always comes out the same length.
    async synthesize(id, text, speed = 1) {
      const v = await voices.get(id);
      if (!v) throw new Error(`The voice ${id} isn’t downloaded`);
      const { session, config } = v;
      const ids = await phonemeIds(text.trim(), config.espeak.voice);
      const inf = config.inference || {};
      const feeds = {
        input: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
        input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
        scales: new ort.Tensor('float32', Float32Array.from([inf.noise_scale ?? 0.667, (inf.length_scale ?? 1) / speed, 0]), [3]),
      };
      if (config.num_speakers > 1) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
      const { output } = await session.run(feeds);
      return toWav(output.data, config.audio.sample_rate);
    },
  };
}

// Float samples to a 16-bit mono WAV, louder parts brought up to full scale as Piper does.
export function toWav(samples, rate) {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const gain = 32767 / Math.max(0.01, peak);
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(samples[i] * gain))), true);
  return buf;
}
