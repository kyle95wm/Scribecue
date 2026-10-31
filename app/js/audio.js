// Building audio from readings, shared by the page and track-worker.js.

// Writes mono 16-bit PCM samples as a WAV file.
export function writeWav(samples, rate) {
  const h = new DataView(new ArrayBuffer(44));
  const str = (o, t) => [...t].forEach((ch, i) => h.setUint8(o + i, ch.charCodeAt(0)));
  const bytes = samples.length * 2;
  str(0, 'RIFF'); h.setUint32(4, 36 + bytes, true); str(8, 'WAVE');
  str(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, rate, true); h.setUint32(28, rate * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true);
  str(36, 'data'); h.setUint32(40, bytes, true);
  return new Blob([h.buffer, samples.buffer], { type: 'audio/wav' });
}

// Mono samples at another rate, by straight lines between them: for putting readings by
// voices with different rates in one file.
export function resample(samples, from, to) {
  if (from === to || !samples.length) return samples;
  const n = Math.round(samples.length * to / from), out = new Int16Array(n), step = from / to;
  for (let i = 0; i < n; i++) {
    const x = i * step, j = Math.floor(x), f = x - j;
    out[i] = Math.round(samples[j] * (1 - f) + (samples[Math.min(j + 1, samples.length - 1)] ?? 0) * f);
  }
  return out;
}

// Lays readings out on a timeline: items [{ start, samples }], all at one sample rate,
// summed where they overlap. Returns mono samples covering secs.
// Levels in the exported track, in dBFS. Voices come out of Piper at full scale; the
// track leaves headroom for mixing and mastering instead. Each reading peaks at
// TRACK_PEAK_DB, so every block is the same level, and readings that overlap and add up
// never take the track past TRACK_MAX_DB.
export const TRACK_PEAK_DB = -8, TRACK_MAX_DB = -6;
const dbToLevel = (db) => 32767 * 10 ** (db / 20);
export function mixTrack(items, rate, secs, peakDb = TRACK_PEAK_DB, maxDb = TRACK_MAX_DB) {
  const mix = new Float32Array(Math.max(1, Math.ceil(secs * rate)));
  for (const { start, samples } of items) {
    let peak = 0;
    for (const s of samples) peak = Math.max(peak, Math.abs(s));
    const g = peak ? dbToLevel(peakDb) / peak : 0;
    const at = Math.round(start * rate);
    for (let i = Math.max(0, -at); i < samples.length && at + i < mix.length; i++) mix[at + i] += samples[i] * g;
  }
  let top = 0;
  for (const s of mix) top = Math.max(top, Math.abs(s));
  const g = top > dbToLevel(maxDb) ? dbToLevel(maxDb) / top : 1;
  const out = new Int16Array(mix.length);
  for (let i = 0; i < mix.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(mix[i] * g)));
  return out;
}

// Every reading laid out as the description track: readings [{ start, samples, rate,
// secs }] by any voices, the track as long as secs or the last reading. Voices make audio
// at different rates, so all of it goes at the highest. Returns { samples, rate,
// overlaps }, overlaps counting readings that run into the next one.
export function layTrack(readings, secs) {
  const rate = Math.max(0, ...readings.map((r) => r.rate)) || 22050;
  const items = readings.map((r) => ({ start: r.start, samples: resample(r.samples, r.rate, rate), secs: r.secs }));
  let overlaps = 0;
  for (let k = 0; k + 1 < items.length; k++) if (items[k].start + items[k].secs > items[k + 1].start + 0.0005) overlaps++;
  const end = Math.max(secs, ...items.map((i) => i.start + i.secs));
  return { samples: mixTrack(items, rate, end), rate, overlaps };
}
