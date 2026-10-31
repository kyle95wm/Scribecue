// Writes the narrator's chosen takes as one Broadcast WAV (BWF): mono, 24-bit, silent
// apart from the takes, stamped with the programme's start so a DAW can place it, with a
// marker per block. The file is put together from small pieces and a shared run of
// silence, so a two-hour programme never has to sit in memory as one array.

const SILENCE = 1 << 16; // bytes in the shared silent piece
const NOTE = 'scbc'; // Scribecue's chunk: the script a narration was recorded against

const ascii = (view, o, t, max = t.length) => { for (let i = 0; i < Math.min(t.length, max); i++) view.setUint8(o + i, t.charCodeAt(i) & 0x7f); };

function chunk(id, body) {
  const len = body.byteLength ?? body.size, pad = len % 2;
  const head = new DataView(new ArrayBuffer(8));
  ascii(head, 0, id); head.setUint32(4, len, true);
  return [head.buffer, body, ...(pad ? [new Uint8Array(1)] : [])];
}

// Float32 samples (−1…1) as little-endian 24-bit.
export function to24(samples) {
  const out = new Uint8Array(samples.length * 3);
  for (let i = 0, o = 0; i < samples.length; i++, o += 3) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    const n = Math.round(v * 0x7fffff);
    out[o] = n & 255; out[o + 1] = (n >> 8) & 255; out[o + 2] = (n >> 16) & 255;
  }
  return out;
}

// Raw 24-bit samples back to floats, as to24 made them.
export function from24(bytes) {
  const out = new Float32Array(Math.floor(bytes.length / 3));
  for (let i = 0, o = 0; i < out.length; i++, o += 3) {
    const n = (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16)) << 8 >> 8;
    out[i] = n / 0x7fffff;
  }
  return out;
}

// A 24-bit mono WAV file from raw 24-bit samples (a Blob or bytes): what a take is kept as.
export function wav24(pcm, rate = 48000) {
  const len = pcm.byteLength ?? pcm.size;
  const h = new DataView(new ArrayBuffer(44));
  ascii(h, 0, 'RIFF'); h.setUint32(4, 36 + len, true); ascii(h, 8, 'WAVE'); ascii(h, 12, 'fmt ');
  h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true); h.setUint32(24, rate, true);
  h.setUint32(28, rate * 3, true); h.setUint16(32, 3, true); h.setUint16(34, 24, true);
  ascii(h, 36, 'data'); h.setUint32(40, len, true);
  return new Blob([h.buffer, pcm], { type: 'audio/wav' });
}
export const WAV24_HEADER = 44;

// takes: [{ start, samples }] (seconds from programme start; Float32Array at `rate`) or
// [{ start, pcm }] (raw 24-bit samples, a Blob or bytes), in time order and not
// overlapping. markers: [{ at, label }] (seconds).
// startSecs: the programme's start timecode as seconds since midnight (for bext).
// note: the script it was recorded against, kept in a chunk of Scribecue's own (see
// readNote). DAWs skip chunks they don't know.
// Returns a Blob. Throws if the file would be over 4 GB.
export function buildBwf({ takes, markers = [], note = null, secs, rate = 48000, startSecs = 0, description = '', originator = 'Scribecue', date = new Date() }) {
  const total = Math.round(secs * rate);
  const bytes = total * 3;
  if (bytes > 0xf0000000) throw new Error('the programme is too long for a WAV file (over 4 GB)');

  const fmt = new DataView(new ArrayBuffer(16));
  fmt.setUint16(0, 1, true); fmt.setUint16(2, 1, true); fmt.setUint32(4, rate, true);
  fmt.setUint32(8, rate * 3, true); fmt.setUint16(12, 3, true); fmt.setUint16(14, 24, true);

  const history = 'A=PCM,F=' + rate + ',W=24,M=mono,T=Scribecue\r\n';
  const bext = new DataView(new ArrayBuffer(602 + history.length));
  ascii(bext, 0, description, 256); ascii(bext, 256, originator, 32);
  const iso = date.toISOString();
  ascii(bext, 320, iso.slice(0, 10)); ascii(bext, 330, iso.slice(11, 19));
  const ref = Math.round(startSecs * rate);
  bext.setUint32(338, ref % 0x100000000, true); bext.setUint32(342, Math.floor(ref / 0x100000000), true);
  bext.setUint16(346, 1, true); // version 1 (no loudness fields filled)
  ascii(bext, 602, history);

  const data = [];
  const silence = new Uint8Array(Math.min(SILENCE, Math.max(bytes, 1)));
  const gap = (n) => { for (; n > 0; n -= silence.length) data.push(n >= silence.length ? silence : silence.subarray(0, n)); };
  let at = 0; // sample position
  for (const t of takes) {
    const from = Math.max(at, Math.round(t.start * rate));
    if (from >= total) continue;
    gap((from - at) * 3);
    const count = t.samples ? t.samples.length : (t.pcm.byteLength ?? t.pcm.size) / 3;
    const keep = Math.min(count, total - from);
    if (keep > 0) data.push(t.samples ? to24(t.samples.subarray(0, keep)) : t.pcm.slice(0, keep * 3));
    at = from + Math.max(keep, 0);
  }
  gap((total - at) * 3);

  const parts = [...chunk('fmt ', fmt.buffer), ...chunk('bext', bext.buffer),
    ...(note ? chunk(NOTE, new TextEncoder().encode(JSON.stringify(note))) : []), ...chunk('data', new Blob(data))];

  if (markers.length) {
    const cue = new DataView(new ArrayBuffer(4 + markers.length * 24));
    cue.setUint32(0, markers.length, true);
    const labels = [];
    markers.forEach((m, i) => {
      const o = 4 + i * 24, pos = Math.round(m.at * rate);
      cue.setUint32(o, i + 1, true); cue.setUint32(o + 4, pos, true); ascii(cue, o + 8, 'data');
      cue.setUint32(o + 12, 0, true); cue.setUint32(o + 16, 0, true); cue.setUint32(o + 20, pos, true);
      const text = new TextEncoder().encode(m.label.slice(0, 200) + '\0');
      const body = new Uint8Array(4 + text.length); new DataView(body.buffer).setUint32(0, i + 1, true); body.set(text, 4);
      labels.push(...chunk('labl', body));
    });
    parts.push(...chunk('cue ', cue.buffer));
    const adtl = new Blob(['adtl', ...labels]);
    parts.push(...chunk('LIST', adtl));
  }

  const size = parts.reduce((n, p) => n + (p.byteLength ?? p.size), 4);
  const head = new DataView(new ArrayBuffer(12));
  ascii(head, 0, 'RIFF'); head.setUint32(4, size, true); ascii(head, 8, 'WAVE');
  return new Blob([head.buffer, ...parts], { type: 'audio/wav' });
}

// The script a narration WAV was recorded against, or null for any other file. Reads
// only the chunk headers and that chunk, so a long WAV isn't loaded.
export async function readNote(file) {
  const bytes = async (o, n) => new Uint8Array(await file.slice(o, o + n).arrayBuffer());
  const id = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  try {
    const head = await bytes(0, 12);
    if (head.length < 12 || id(head, 0) !== 'RIFF' || id(head, 8) !== 'WAVE') return null;
    for (let o = 12, i = 0; o + 8 <= file.size && i < 64; i++) {
      const h = await bytes(o, 8), len = new DataView(h.buffer).getUint32(4, true);
      if (id(h, 0) === NOTE) {
        const note = JSON.parse(new TextDecoder().decode(await bytes(o + 8, len)));
        return note?.scribecueNarration && Array.isArray(note.blocks) ? note : null;
      }
      o += 8 + len + (len % 2);
    }
  } catch { /* not a WAV we can read */ }
  return null;
}
