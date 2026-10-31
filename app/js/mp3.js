// Saving the description track as an MP3 rather than a WAV: a fifth of the size or less.
// The encoding happens in mp3-worker.js.

// What the track can be saved as, as Settings → Text to speech offers it. Bitrates are
// ones MP3 has at every rate the voices use.
export const TRACK_FORMATS = {
  wav: { ext: 'wav' },
  'mp3-160': { ext: 'mp3', kbps: 160 },
  'mp3-96': { ext: 'mp3', kbps: 96 },
  'mp3-64': { ext: 'mp3', kbps: 64 },
};
export const trackFormat = (k) => TRACK_FORMATS[k] || TRACK_FORMATS.wav;

// The same for the full mix, which is stereo at the programme's rate (usually 48 kHz),
// so it takes higher bitrates. With ffmpeg in Docker (ffmpeg/server.py), it can also be
// AAC, AC-3 or E-AC-3: the mix is made as a WAV, and ffmpeg turns it into those.
export const MIX_FORMATS = {
  wav: { ext: 'wav' },
  'mp3-320': { ext: 'mp3', kbps: 320 },
  'mp3-192': { ext: 'mp3', kbps: 192 },
  'mp3-128': { ext: 'mp3', kbps: 128 },
  aac: { ext: 'm4a', ffmpeg: 'aac' },
  ac3: { ext: 'ac3', ffmpeg: 'ac3' },
  eac3: { ext: 'eac3', ffmpeg: 'eac3' },
};
export const mixFormat = (k) => MIX_FORMATS[k] || MIX_FORMATS.wav;

// MP3 encoders put this many samples of silence before the audio (LAME's 576, and 529
// more as a player decodes it). Without a gapless header, which players only partly
// honour, everything would sound that much late, so they're taken off the start.
export const MP3_DELAY = 1105;
export const forMp3 = (samples) => samples.subarray(Math.min(MP3_DELAY, samples.length));

// Mono 16-bit samples as an MP3 Blob. progress(0..1) as it goes.
export function encodeMp3(samples, rate, kbps, progress = () => {}) {
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker(new URL('./mp3-worker.js', import.meta.url)); } catch { return reject(new Error('workers are unavailable')); }
    const end = (f, v) => { w.terminate(); f(v); };
    w.onmessage = ({ data: m }) => {
      if (m.type === 'progress') progress(m.done);
      else if (m.type === 'done') end(resolve, m.blob);
      else end(reject, new Error(m.message));
    };
    w.onerror = (e) => { e.preventDefault(); end(reject, new Error(e.message || 'the MP3 encoder didn’t load')); };
    const copy = forMp3(samples).slice();
    w.postMessage({ samples: copy, rate, kbps }, [copy.buffer]);
  });
}
