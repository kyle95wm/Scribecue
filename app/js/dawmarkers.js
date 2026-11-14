// DAW markers: a WAV for recording and placing lines in another program. It plays a tone
// while each block lasts and is silent between them, and names each block: as a marker at
// its start (Logic Pro reads these), or as a region from its start to its end (Reaper).
// Mono, 16-bit, as the DAWs import it. The silence is one shared piece, so a two-hour
// programme never sits in memory as one array.

export const DAW_KINDS = ['markers', 'regions'];
const TONE = 440; // Hz
const LEVEL = 0.2; // about −14 dBFS
const FADE = 0.005; // seconds at each end of a tone, so it doesn't click
const SILENCE = 1 << 24; // bytes in the shared silent piece

const ascii = (view, o, t) => { for (let i = 0; i < t.length; i++) view.setUint8(o + i, t.charCodeAt(i) & 0x7f); };
function chunk(id, body) {
  const len = body.byteLength ?? body.size, pad = len % 2;
  const head = new DataView(new ArrayBuffer(8));
  ascii(head, 0, id); head.setUint32(4, len, true);
  return [head.buffer, body, ...(pad ? [new Uint8Array(1)] : [])];
}

// Sample i of a tone n samples long, faded in and out.
function sample(i, n, rate, fade) {
  const edge = fade ? Math.min(1, (i + 0.5) / fade, (n - i - 0.5) / fade) : 1;
  return Math.round(Math.sin(2 * Math.PI * TONE * i / rate) * LEVEL * edge * 0x7fff);
}
const samples = (from, to, n, rate, fade) => Int16Array.from({ length: Math.max(0, to - from) }, (_, k) => sample(from + k, n, rate, fade));

// A tone n samples long, as pieces: its faded ends, made here, and its middle, taken from
// a second of the tone (a whole number of cycles, so the pieces join without a step).
export function tone(n, rate = 48000, second = new Blob([samples(0, rate, rate, rate, 0)])) {
  const fade = Math.min(Math.round(FADE * rate), n >> 1), parts = [samples(0, fade, n, rate, fade)];
  for (let i = fade; i < n - fade;) {
    const off = i % rate, take = Math.min(rate - off, n - fade - i);
    parts.push(second.slice(off * 2, (off + take) * 2));
    i += take;
  }
  parts.push(samples(Math.max(fade, n - fade), n, n, rate, fade));
  return parts;
}

// A block's name in a DAW: its text on one line.
const label = (text) => String(text).replace(/\s+/g, ' ').trim().slice(0, 1000);

// blocks: [{ start, end, text }] in seconds, sorted by start. secs: how long the file is
// (at least to the last block's end). kind: 'markers' or 'regions'. Returns a Blob.
export function buildDawMarkers({ blocks, secs = 0, kind = 'markers', rate = 48000 }) {
  const regions = kind === 'regions';
  const items = blocks.map((b) => {
    const from = Math.max(0, Math.round(b.start * rate));
    return { from, len: Math.max(0, Math.round(b.end * rate) - from), text: label(b.text) };
  });
  const total = Math.max(Math.round(secs * rate), ...items.map((b) => b.from + b.len), 0);
  if (total * 2 > 0xf0000000) throw new Error('the programme is too long for a WAV file (over 4 GB)');

  const fmt = new DataView(new ArrayBuffer(16));
  fmt.setUint16(0, 1, true); fmt.setUint16(2, 1, true); fmt.setUint32(4, rate, true);
  fmt.setUint32(8, rate * 2, true); fmt.setUint16(12, 2, true); fmt.setUint16(14, 16, true);

  const data = [], second = new Blob([samples(0, rate, rate, rate, 0)]);
  const silence = new Blob([new Uint8Array(Math.min(SILENCE, Math.max(total * 2, 2)))]);
  const gap = (n) => { for (; n > 0; n -= silence.size) data.push(n >= silence.size ? silence : silence.slice(0, n)); };
  let at = 0;
  for (const b of items) {
    // Overlapping blocks: the tone carries on to the later one's end.
    const from = Math.max(at, b.from), to = Math.max(from, b.from + b.len);
    gap((from - at) * 2);
    if (to > from) data.push(...tone(to - from, rate, second));
    at = to;
  }
  gap((total - at) * 2);

  const cue = new DataView(new ArrayBuffer(4 + items.length * 24));
  cue.setUint32(0, items.length, true);
  const notes = [];
  items.forEach((b, i) => {
    const o = 4 + i * 24;
    cue.setUint32(o, i + 1, true); cue.setUint32(o + 4, b.from, true); ascii(cue, o + 8, 'data');
    cue.setUint32(o + 12, 0, true); cue.setUint32(o + 16, 0, true); cue.setUint32(o + 20, b.from, true);
    // Ended with a zero, and padded to an even length inside the chunk, as DAWs write them.
    const raw = new TextEncoder().encode(b.text);
    const text = new Uint8Array((raw.length + 2) & ~1);
    text.set(raw);
    // A marker is a label; a region is labelled text with a length, its purpose 'regn'.
    const head = regions ? 20 : 4;
    const body = new Uint8Array(head + text.length), v = new DataView(body.buffer);
    v.setUint32(0, i + 1, true);
    if (regions) { v.setUint32(4, b.len, true); ascii(v, 8, 'regn'); }
    body.set(text, head);
    notes.push(...chunk(regions ? 'ltxt' : 'labl', body));
  });

  const parts = [...chunk('fmt ', fmt.buffer), ...chunk('data', new Blob(data))];
  if (items.length) parts.push(...chunk('cue ', cue.buffer), ...chunk('LIST', new Blob(['adtl', ...notes])));
  const size = parts.reduce((n, p) => n + (p.byteLength ?? p.size), 4);
  const head = new DataView(new ArrayBuffer(12));
  ascii(head, 0, 'RIFF'); head.setUint32(4, size, true); ascii(head, 8, 'WAVE');
  return new Blob([head.buffer, ...parts], { type: 'audio/wav' });
}
