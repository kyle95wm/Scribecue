// Putting the full mix in a copy of the video in the browser, without ffmpeg (mux-worker.js
// does the work with Mediabunny). The picture and the video's own sound are copied as they
// are; only the mix is encoded. These are the parts that need no browser.

// The videos it works with, and the Mediabunny format each is written as.
export const OUT_FORMATS = { mp4: 'Mp4OutputFormat', m4v: 'Mp4OutputFormat', mov: 'MovOutputFormat', mkv: 'MkvOutputFormat', webm: 'WebMOutputFormat' };
export const canMux = (ext) => Object.hasOwn(OUT_FORMATS, ext);

// The mix as ffmpeg codes it (ffcmd.js): AAC, or Opus in a WebM, which holds only Opus or
// Vorbis. Opus is always 48 kHz.
export const mixCodec = (ext) => (ext === 'webm'
  ? { codec: 'opus', bitrate: 192000, sampleRate: 48000 }
  : { codec: 'aac', bitrate: 256000 });

// How the mix is marked, as ffmpeg marks it: an extra track is audio description and not
// the default; in place of the sound, it is the default.
export const mixMetadata = (replace) => (replace
  ? { disposition: { default: true } }
  : { name: 'Audio description', disposition: { default: false, visuallyImpaired: true } });

// A WAV's format and where its samples are, from its first bytes (a DataView). Throws for
// anything but 16-bit PCM, which is what the mixer makes.
export function wavInfo(dv) {
  const tag = (o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  if (dv.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('the mix isn’t a WAV');
  let fmt = null;
  for (let at = 12; at + 8 <= dv.byteLength;) {
    const id = tag(at), size = dv.getUint32(at + 4, true);
    if (id === 'fmt ') fmt = { format: dv.getUint16(at + 8, true), channels: dv.getUint16(at + 10, true), rate: dv.getUint32(at + 12, true), bits: dv.getUint16(at + 22, true) };
    if (id === 'data') {
      if (!fmt || fmt.format !== 1 || fmt.bits !== 16) throw new Error('the mix isn’t 16-bit PCM');
      return { channels: fmt.channels, rate: fmt.rate, start: at + 8, bytes: size };
    }
    at += 8 + size + (size & 1);
  }
  throw new Error('the mix has no samples');
}

// Which of several streams goes next, so the file is written in time order and none runs
// far ahead: the one whose next item is earliest. heads: each stream's next time, or null
// once it has ended. Returns -1 when all have.
export function nextStream(heads) {
  let best = -1;
  for (let i = 0; i < heads.length; i++) if (heads[i] != null && (best < 0 || heads[i] < heads[best])) best = i;
  return best;
}

// Each copied track's metadata, from what Mediabunny reads in the video.
export const copiedMetadata = (t) => ({
  ...(t.languageCode && t.languageCode !== 'und' ? { languageCode: t.languageCode } : {}),
  ...(t.name ? { name: t.name } : {}),
  ...(t.disposition ? { disposition: t.disposition } : {}),
  ...(t.rotation ? { rotation: t.rotation } : {}),
});
