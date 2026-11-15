// Puts the full mix in a copy of the video, in the browser, for when ffmpeg isn't running.
// The picture and the video's own sound tracks are copied packet by packet; only the mix
// is encoded, as AAC (Opus in a WebM). The video is read a piece at a time and the copy is
// written straight to the file chosen, so a long film never has to fit in memory.
//
//   in:  { video: File, mix: Blob (16-bit WAV), handle: FileSystemFileHandle, ext, replace }
//   out: { type: 'progress', done }  ...  then { type: 'done', wasmAac }
//        or { type: 'error', message }
// Mediabunny doesn't read subtitle tracks, so they're left out.
importScripts('../vendor/mediabunny.js');
const M = self.Mediabunny;
let plan = null;

self.onmessage = async ({ data: job }) => {
  try {
    plan ??= await import('./muxplan.js');
    postMessage({ type: 'done', ...(await mux(job)) });
  } catch (e) {
    postMessage({ type: 'error', message: e?.message || String(e) });
  }
};

// AAC from the browser where it can, else FFmpeg's encoder, loaded only then.
async function aacReady(config) {
  if (await M.canEncodeAudio('aac', config)) return false;
  importScripts('../vendor/mediabunny-aac.js');
  self.MediabunnyAacEncoder.registerAacEncoder();
  return true;
}

async function mux({ video, mix, handle, ext, replace }) {
  const input = new M.Input({ source: new M.BlobSource(video), formats: M.ALL_FORMATS });
  const tracks = await input.getTracks();
  const pictures = tracks.filter((t) => t.isVideoTrack());
  const sounds = replace ? [] : tracks.filter((t) => t.isAudioTrack());
  if (!pictures.length) throw new Error('the video has no picture to copy');
  const duration = await input.computeDuration() || 1;

  const head = new DataView(await mix.slice(0, 4096).arrayBuffer());
  const wav = plan.wavInfo(head);
  const { codec, bitrate, sampleRate } = plan.mixCodec(ext);
  const wasmAac = codec === 'aac' && await aacReady({ numberOfChannels: wav.channels, sampleRate: wav.rate, bitrate });

  const format = new M[plan.OUT_FORMATS[ext]](ext === 'mkv' || ext === 'webm' ? {} : { fastStart: false });
  const can = format.getSupportedCodecs();
  for (const t of [...pictures, ...sounds]) {
    if (!t.codec) throw new Error(`it can’t read the video’s ${t.isVideoTrack() ? 'picture' : 'sound'}`);
    if (!can.includes(t.codec)) throw new Error(`a .${ext} file can’t hold its ${t.codec.toUpperCase()} ${t.isVideoTrack() ? 'picture' : 'sound'}`);
  }

  const writable = await handle.createWritable();
  const output = new M.Output({ format, target: new M.StreamTarget(writable, { chunked: true }) });
  // Each stream: its next time (or null at the end), and a step that adds that item.
  const streams = [];
  for (const t of [...pictures, ...sounds]) {
    const src = t.isVideoTrack() ? new M.EncodedVideoPacketSource(t.codec) : new M.EncodedAudioPacketSource(t.codec);
    const meta = plan.copiedMetadata({ languageCode: t.languageCode, name: t.name, disposition: t.disposition, rotation: t.isVideoTrack() ? t.rotation : 0 });
    if (t.isVideoTrack()) output.addVideoTrack(src, meta); else output.addAudioTrack(src, meta);
    const decoderConfig = await t.getDecoderConfig();
    const it = new M.EncodedPacketSink(t).packets();
    let first = true, cur = (await it.next()).value ?? null;
    streams.push({
      src, at: () => cur?.timestamp ?? null,
      step: async () => {
        await src.add(cur, first ? { decoderConfig } : undefined);
        first = false;
        cur = (await it.next()).value ?? null;
      },
    });
  }
  const mixSrc = new M.AudioSampleSource({ codec, bitrate, ...(sampleRate && sampleRate !== wav.rate ? { transform: { sampleRate } } : {}) });
  output.addAudioTrack(mixSrc, plan.mixMetadata(replace));
  // The mix, half a second at a time.
  const frame = 2 * wav.channels, step = Math.round(wav.rate / 2) * frame, end = wav.start + wav.bytes;
  let pos = wav.start;
  streams.push({
    src: mixSrc, at: () => (pos < end ? (pos - wav.start) / frame / wav.rate : null),
    step: async () => {
      const bytes = await mix.slice(pos, Math.min(end, pos + step)).arrayBuffer();
      const usable = bytes.byteLength - (bytes.byteLength % frame);
      const sample = new M.AudioSample({ data: new Int16Array(bytes, 0, usable / 2), format: 's16', numberOfChannels: wav.channels, sampleRate: wav.rate, timestamp: (pos - wav.start) / frame / wav.rate });
      pos += bytes.byteLength || end;
      await mixSrc.add(sample);
      sample.close();
    },
  });

  try {
    await output.start();
    let told = -1;
    for (let i; (i = plan.nextStream(streams.map((s) => s.at()))) >= 0;) {
      const done = Math.min(1, Math.max(0, streams[i].at() / duration));
      if (done - told >= 0.005) { told = done; postMessage({ type: 'progress', done }); }
      await streams[i].step();
    }
    for (const s of streams) s.src.close();
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    await writable.abort?.().catch(() => {});
    throw e;
  }
  return { wasmAac };
}
