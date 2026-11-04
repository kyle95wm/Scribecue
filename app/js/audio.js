// Building audio from readings, shared by the page and track-worker.js.

// Writes mono 16-bit PCM samples as a WAV file.
export function writeWav(samples, rate) {
  return wavFile(samples.buffer, samples.length * 2, rate);
}
// The same from 16-bit mono samples kept in a Blob, which can be bigger than memory allows.
export const pcmToWav = (pcm, rate) => wavFile(pcm, pcm.size, rate);
function wavFile(data, bytes, rate) {
  const h = new DataView(new ArrayBuffer(44));
  const str = (o, t) => [...t].forEach((ch, i) => h.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF'); h.setUint32(4, 36 + bytes, true); str(8, 'WAVE');
  str(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, rate, true); h.setUint32(28, rate * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true);
  str(36, 'data'); h.setUint32(40, bytes, true);
  return new Blob([h.buffer, data], { type: 'audio/wav' });
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
// A reading's gain makes it louder or quieter than the rest; if that takes the track over
// maxDb, all of it comes down, so the difference stays.
export function mixTrack(items, rate, secs, peakDb = TRACK_PEAK_DB, maxDb = TRACK_MAX_DB) {
  const out = new Int16Array(Math.max(1, Math.ceil(secs * rate)));
  let at = 0;
  for (const part of trackParts(items, rate, secs, peakDb, maxDb)) { out.set(part, at); at += part.length; }
  return out;
}

// The same in pieces, a minute of sound at a time by default, so a film's worth never has
// to be in memory at once. It goes through twice: once to find the track's peak, which
// sets its level, and once to give out the samples.
export function* trackParts(items, rate, secs, peakDb = TRACK_PEAK_DB, maxDb = TRACK_MAX_DB, partSecs = 60) {
  const n = Math.max(1, Math.ceil(secs * rate)), size = Math.max(1, Math.round(partSecs * rate));
  const laid = items.map(({ start, samples, gain = 1 }) => {
    let peak = 0;
    for (const s of samples) peak = Math.max(peak, Math.abs(s));
    return { at: Math.round(start * rate), samples, g: peak ? (dbToLevel(peakDb) / peak) * gain : 0 };
  });
  const part = new Float32Array(size);
  const mix = (from, to) => {
    part.fill(0);
    for (const { at, samples, g } of laid) {
      const a = Math.max(at, from, 0), b = Math.min(at + samples.length, to);
      for (let i = a; i < b; i++) part[i - from] += samples[i - at] * g;
    }
    return to - from;
  };
  let top = 0;
  for (let from = 0; from < n; from += size) {
    const len = mix(from, Math.min(n, from + size));
    for (let i = 0; i < len; i++) top = Math.max(top, Math.abs(part[i]));
  }
  const g = top > dbToLevel(maxDb) ? dbToLevel(maxDb) / top : 1;
  for (let from = 0; from < n; from += size) {
    const len = mix(from, Math.min(n, from + size)), out = new Int16Array(len);
    for (let i = 0; i < len; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(part[i] * g)));
    yield out;
  }
}

function layOut(readings, secs) {
  const rate = Math.max(0, ...readings.map((r) => r.rate)) || 22050;
  const items = readings.map((r) => ({ start: r.start, samples: resample(r.samples, r.rate, rate), secs: r.secs, gain: r.gain ?? 1 }));
  let overlaps = 0;
  for (let k = 0; k + 1 < items.length; k++) if (items[k].start + items[k].secs > items[k + 1].start + 0.0005) overlaps++;
  const end = Math.max(secs, ...items.map((i) => i.start + i.secs));
  return { items, rate, end, overlaps };
}
export function layTrack(readings, secs) {
  const { items, rate, end, overlaps } = layOut(readings, secs);
  return { samples: mixTrack(items, rate, end), rate, overlaps };
}
// The track as a Blob of 16-bit mono samples, which the browser can keep on disk.
export function layTrackBlob(readings, secs) {
  const { items, rate, end, overlaps } = layOut(readings, secs);
  const parts = [];
  for (const part of trackParts(items, rate, end)) parts.push(new Blob([part.buffer]));
  return { pcm: new Blob(parts), rate, overlaps };
}
