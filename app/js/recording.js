// Recording narration: the recording file the narrator opens, the slot each line is read
// in, and how takes are judged. Plain functions, so they can be tested without a browser.
// The plan is in RECORDING.md.

// Letters only: Chrome's file picker refuses an extension with a hyphen in it.
export const RECORDING_EXT = '.scribecuerec';
// Earlier builds saved .scribecue-rec, which still opens.
export const isRecordingFile = (name) => /\.scribecue-?rec$/i.test(name);
export const RECORDING_FORMAT = 1;
export const GRACE = 1; // seconds a take may run past its block, never into the next one
export const RATE = 48000;

const num = (v) => typeof v === 'number' && Number.isFinite(v);

const hash = (text) => {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

// The script's fingerprint: its lines' text and timings. It catches a recording file
// edited by hand, though not someone set on hiding it, since the sum is no secret.
export const scriptPrint = (blocks) => hash(JSON.stringify(blocks.map((b) => [b.start, b.end, b.text]))) + '-' + blocks.length;

// The recording file: a locked script, the video it belongs to, and where the programme
// starts. state: { blocks, media, startTC, fps, app }. startTC is in seconds.
export function toRecordingFile({ blocks, media = null, start = 0, fps = 25, app = '' }) {
  const lines = blocks.filter((b) => b.text.trim()).map(({ start: s, end, text, voice, speed }) => ({
    start: s, end, text,
    ...(voice ? { voice } : {}),
    ...(speed ? { speed } : {}),
  }));
  return {
    scribecueRecording: RECORDING_FORMAT,
    app,
    saved: new Date().toISOString(),
    media: media && media.name ? { name: media.name, size: media.size ?? null, duration: num(media.duration) ? media.duration : null } : null,
    start: Math.max(0, start),
    fps,
    print: scriptPrint(lines),
    blocks: lines,
  };
}

// Reads a parsed recording file. Throws an Error in words for the narrator. `edited` is
// true when its script no longer matches the fingerprint it was saved with.
export function fromRecordingFile(json) {
  if (!json || typeof json !== 'object' || !('scribecueRecording' in json)) throw new Error('this isn’t a Scribecue recording file');
  if (!num(json.scribecueRecording) || json.scribecueRecording > RECORDING_FORMAT) {
    throw new Error('it was made by a newer version of Scribecue. Update Scribecue to open it');
  }
  if (!Array.isArray(json.blocks)) throw new Error('it has no blocks');
  const blocks = json.blocks
    .filter((b) => b && num(b.start) && num(b.end) && typeof b.text === 'string')
    .map((b) => ({
      start: Math.max(0, b.start), end: Math.max(b.start, b.end), text: b.text,
      ...(typeof b.voice === 'string' && b.voice ? { voice: b.voice.slice(0, 300) } : {}),
      ...(num(b.speed) ? { speed: b.speed } : {}),
    }))
    .sort((a, z) => a.start - z.start);
  const m = json.media;
  return {
    blocks,
    media: m && typeof m.name === 'string' ? { name: m.name, size: num(m.size) ? m.size : null, duration: num(m.duration) ? m.duration : null } : null,
    start: num(json.start) ? Math.max(0, json.start) : 0,
    fps: num(json.fps) && json.fps > 0 ? json.fps : 25,
    edited: typeof json.print === 'string' && json.print !== scriptPrint(blocks),
  };
}

// What goes into the narration WAV so the script it was recorded against can be checked.
export const narrationNote = ({ blocks, edited = false }) => ({
  scribecueNarration: 1, print: scriptPrint(blocks), edited: !!edited,
  blocks: blocks.map(({ start, end, text }) => ({ start, end, text })),
});

// Compares the script a narration was recorded against with the one open now.
// Returns { same, edited, lines: [{ line, why }], more } (line is 1-based, at most `max`).
export function compareScript(note, blocks, max = 20) {
  const ours = blocks.filter((b) => b.text.trim()), theirs = note.blocks || [];
  const near = (a, z) => Math.abs(a - z) < 0.0005;
  const all = [];
  for (let i = 0; i < Math.max(ours.length, theirs.length); i++) {
    const a = theirs[i], b = ours[i], line = i + 1;
    if (!a) all.push({ line, why: 'isn’t in the narration' });
    else if (!b) all.push({ line, why: 'is in the narration, but not in this script' });
    else {
      if (a.text.trim() !== b.text.trim()) all.push({ line, why: 'has different text' });
      if (!near(a.start, b.start) || !near(a.end, b.end)) all.push({ line, why: 'has different timings' });
    }
  }
  return { same: !all.length, edited: !!note.edited, lines: all.slice(0, max), more: Math.max(0, all.length - max) };
}

// Whether the narrator's video is the one the script was timed to: same name, and a
// length within a frame or two. (Size is not checked; a re-encode keeps the picture.)
export function sameVideo(saved, file) {
  if (!saved) return true;
  if (saved.name !== file.name) return false;
  return !num(saved.duration) || !num(file.duration) || Math.abs(saved.duration - file.duration) < 0.1;
}

// Where each line may be recorded: from its block's start to its end plus the grace,
// but never past the next block's start. Returns [{ start, end }] in block order.
export function slots(blocks, grace = GRACE) {
  return blocks.map((b, i) => {
    const next = blocks[i + 1];
    const end = Math.min(b.end + grace, next ? Math.max(next.start, b.end) : Infinity);
    return { start: b.start, end };
  });
}

// Loudest sample, in dBFS (−Infinity for silence). samples: Float32Array in −1…1.
export function peakDb(samples) {
  let p = 0;
  for (let i = 0; i < samples.length; i++) { const v = Math.abs(samples[i]); if (v > p) p = v; }
  return p ? 20 * Math.log10(p) : -Infinity;
}

// A peak for people to read, with a real minus sign.
export const dbText = (db) => (Number.isFinite(db) ? db.toFixed(1).replace('-', '−') : '−∞') + ' dBFS';

// Judges a take by its peak. 'good' is −12…−8; 'note' is a gentle word either side;
// 'quiet' (below −16) is flagged; 'loud' (above −6) stops the export.
export function judgePeak(db) {
  if (db > -6) return 'loud';
  if (db < -16) return 'quiet';
  if (db >= -12 && db <= -8) return 'good';
  return 'note';
}

// A take that runs past its slot is marked in red. take: { start, duration }, slot as above.
export const runsOver = (take, slot) => (take.start ?? slot.start) + take.duration > slot.end + 1e-6;

// Editing a take. The narrator can split it into parts, at points in the recording, then
// move each part (`shift`, in seconds, later if positive) and trim `head` and `tail` seconds
// off its ends. The audio itself is never changed, so Reset brings it all back.
// edit: { splits: [seconds into the recording], parts: [{ shift, head, tail }] }, with one
// part more than splits. Takes saved before splitting existed have { shift, head, tail }.
export const EDIT_MIN = 0.1; // seconds of sound a part keeps, at least
const NO_EDIT = { shift: 0, head: 0, tail: 0 };
export function fullEdit(t) {
  const e = t.edit || {};
  const splits = Array.isArray(e.splits) ? e.splits : [];
  const parts = Array.isArray(e.parts) ? e.parts : [e];
  return { splits, parts: [...splits, 0].map((_, k) => ({ ...NO_EDIT, ...parts[k] })) };
}
const bounds = (t, splits) => [0, ...splits, t.duration];

// The parts of a take as heard and exported, in time order: { ...t, start, duration, head,
// part, key }, where head is how far into the recording the part's sound begins.
export function pieces(t) {
  const { splits, parts } = fullEdit(t), b = bounds(t, splits);
  return parts.map((p, k) => {
    const head = b[k] + p.head;
    return { ...t, start: t.start + head + p.shift, duration: Math.max(0, b[k + 1] - p.tail - head), head, part: k, key: `${t.id}:${k}` };
  });
}

// The whole take as edited, from its first sound to its last: { ...t, start, duration }.
export function placed(t) {
  const ps = pieces(t), a = ps[0], z = ps[ps.length - 1];
  return { ...t, start: a.start, duration: z.start + z.duration - a.start };
}

// An edit kept within bounds: each part keeps some sound, none starts before 0 or before the
// previous block's slot ends, and none overlaps the part before it (a later part is pushed
// along instead). Rounded to the millisecond.
export function clampEdit(t, edit, prevEnd = 0) {
  const ms = (v) => Math.round(v * 1000) / 1000;
  const { splits, parts } = fullEdit({ ...t, edit }), b = bounds(t, splits);
  let floor = Math.max(0, prevEnd);
  return {
    splits: splits.map(ms),
    parts: parts.map((p, k) => {
      const len = b[k + 1] - b[k];
      const head = ms(Math.max(0, Math.min(p.head, len - EDIT_MIN)));
      const tail = ms(Math.max(0, Math.min(p.tail, len - head - EDIT_MIN)));
      let shift = ms(p.shift);
      const at = t.start + b[k] + head + shift;
      if (at < floor - 1e-9) shift = ms(shift + floor - at);
      floor = t.start + b[k + 1] - tail + shift;
      return { shift, head, tail };
    }),
  };
}

// Splits the take at `time` on the video, inside one of its parts: the new edit, or null if
// `time` isn't far enough inside one.
export function splitAt(t, time) {
  const { splits, parts } = fullEdit(t);
  const p = pieces(t).find((x) => time > x.start + EDIT_MIN && time < x.start + x.duration - EDIT_MIN);
  if (!p) return null;
  const at = Math.round((p.head + time - p.start) * 1000) / 1000, k = p.part, old = parts[k];
  return {
    splits: [...splits.slice(0, k), at, ...splits.slice(k)],
    parts: [...parts.slice(0, k), { ...old, tail: 0 }, { ...old, head: 0 }, ...parts.slice(k + 1)],
  };
}

// Where the sound begins and ends in a stretch of recording: { head, tail } to trim, in
// seconds, keeping `pad` of quiet at each end. Quiet is below `floorDb`. pcm: Float32Array.
export function silenceEnds(pcm, rate = RATE, { floorDb = -45, pad = 0.05 } = {}) {
  const floor = 10 ** (floorDb / 20);
  let a = 0, z = pcm.length - 1;
  while (a < pcm.length && Math.abs(pcm[a]) < floor) a++;
  while (z > a && Math.abs(pcm[z]) < floor) z--;
  if (a >= pcm.length) return { head: 0, tail: 0 }; // all quiet: leave it for the narrator
  const p = Math.round(pad * rate);
  return { head: Math.max(0, a - p) / rate, tail: Math.max(0, pcm.length - 1 - z - p) / rate };
}

// Trim silence: the quiet cut off both ends of every part. pcm: the whole recording.
export function trimSilence(t, pcm, rate = RATE) {
  const { splits, parts } = fullEdit(t), b = bounds(t, splits);
  return { splits, parts: parts.map((p, k) => ({ ...p, ...silenceEnds(pcm.subarray(Math.round(b[k] * rate), Math.round(b[k + 1] * rate)), rate) })) };
}

// Trimmed to end where its slot does, and moved to the slot's start first if it begins too
// late. Only the last part is trimmed.
export function fitSlot(t, slot, prevEnd = 0) {
  const e = fullEdit(t), p = placed(t);
  if (p.start > slot.end - EDIT_MIN) e.parts = e.parts.map((x) => ({ ...x, shift: x.shift + slot.start - p.start }));
  const q = placed({ ...t, edit: e }), last = e.parts[e.parts.length - 1];
  // Rounded up to the millisecond, so rounding the edit can't leave it a hair over.
  if (q.start + q.duration > slot.end) last.tail += Math.ceil((q.start + q.duration - slot.end) * 1000 - 1e-6) / 1000;
  return clampEdit(t, e, prevEnd);
}

// The take as edited, in one stretch from its first sound to its last, with silence between
// parts: { start, pcm }. pcm: the whole recording.
export function flatten(t, pcm, rate = RATE) {
  const ps = pieces(t), start = ps[0].start, z = ps[ps.length - 1];
  const out = new Float32Array(Math.round((z.start + z.duration - start) * rate));
  for (const p of ps) {
    const from = Math.round(p.head * rate), at = Math.round((p.start - start) * rate);
    out.set(pcm.subarray(from, from + Math.min(Math.round(p.duration * rate), out.length - at)), at);
  }
  return { start, pcm: out };
}

// The loudest sample in each of `cols` columns, for drawing a take. pcm: Float32Array.
export function wavePeaks(pcm, cols) {
  const out = new Float32Array(cols), per = pcm.length / cols;
  for (let c = 0; c < cols; c++) {
    let m = 0;
    for (let i = Math.floor(c * per), end = Math.min(pcm.length, Math.floor((c + 1) * per)); i < end; i++) { const v = Math.abs(pcm[i]); if (v > m) m = v; }
    out[c] = m;
  }
  return out;
}

// Checks the chosen takes before export. chosen[i] is block i's take
// ({ peak, duration }) or null. Returns { stop, warn }: lists of { block, why }, where
// block is a 1-based number. Any item in stop means the export must not go ahead.
export function checkExport(blocks, chosen, grace = GRACE) {
  const sl = slots(blocks, grace), stop = [], warn = [];
  blocks.forEach((b, i) => {
    const t = chosen[i], block = i + 1;
    if (!t) { warn.push({ block, why: 'has no take' }); return; }
    const j = judgePeak(t.peak);
    if (j === 'loud') stop.push({ block, why: `peaks at ${dbText(t.peak)}, above −6: retake it quieter` });
    else if (j === 'quiet') warn.push({ block, why: `is too quiet (${dbText(t.peak)})` });
    if (runsOver(t, sl[i])) warn.push({ block, why: 'runs past its slot' });
  });
  return { stop, warn };
}

// The short report to send with the WAV.
export function exportReport({ stop, warn }) {
  const line = (x) => `Block ${x.block} ${x.why}`;
  return [...stop.map((x) => `STOPPED: ${line(x)}`), ...warn.map(line)].join('\n');
}

// Which recording a set of takes belongs to: the same script, starting at the same time.
export const recordingId = ({ blocks, start }) => hash(JSON.stringify([start, blocks.map((b) => [b.start, b.end, b.text])])) + '-' + blocks.length;

// How long recording starts before the block's first moment: a breath of room.
export const PREROLL = 0.2;

// Where a take sits on the timeline. Capture starts when the picture reaches `t0`; what
// the microphone sent then was said `delay` seconds earlier (the sound reaching the
// narrator, plus the sound reaching Scribecue). The start never goes before the previous
// slot ends, so takes can't overlap: `skip` is how many leading samples to drop for that.
export function placeTake({ t0, delay, prevEnd = 0, rate = RATE }) {
  const first = Math.max(0, t0 - delay);
  const floor = Math.max(0, prevEnd);
  const skip = first < floor ? Math.ceil((floor - first) * rate) : 0;
  return { start: first + skip / rate, skip };
}

// Punching in: the narrator picks up partway through a take. The new take keeps the earlier
// one up to `at` (video seconds) and the new recording from there, with a short crossfade so
// the join doesn't click. A gap after the earlier take, if it stopped short, stays silent.
// base, add: { start, pcm: Float32Array }. Returns { start, pcm }.
export const PUNCH_FADE = 0.01;
export const PUNCH_MIN = 0.3; // seconds of the earlier take to keep, at least
export function punchIn(base, add, at, rate = RATE) {
  const c = Math.round((at - base.start) * rate);
  const a = Math.round((at - add.start) * rate);
  const h = Math.max(0, Math.min(Math.round(PUNCH_FADE / 2 * rate), c, a));
  const tail = Math.max(0, add.pcm.length - (a - h));
  const pcm = new Float32Array(c - h + tail);
  pcm.set(base.pcm.subarray(0, Math.min(c - h, base.pcm.length)));
  for (let k = 0; k < tail; k++) {
    const x = add.pcm[a - h + k] ?? 0;
    if (k < 2 * h) {
      // Linear, so the join is never louder than either take: the same voice in the
      // same room is alike on both sides, and an equal-power fade would lift it by 3 dB.
      const w = (k + 0.5) / (2 * h);
      pcm[c - h + k] = (base.pcm[c - h + k] ?? 0) * (1 - w) + x * w;
    } else pcm[c - h + k] = x;
  }
  return { start: base.start, pcm };
}

// Hearing the chosen takes while the video plays. takes: the chosen ones, in time order
// and not overlapping ({ start, duration }). What plays at `t`, and how far into it:
// { take, from }, or null.
export function takeAt(takes, t) {
  for (const take of takes) {
    if (take.start > t) break;
    if (t < take.start + take.duration) return { take, from: t - take.start };
  }
  return null;
}

// The next take to start after `t`, within `ahead` seconds, or null: it's got ready early,
// so it can start on time.
export const nextTake = (takes, t, ahead) => takes.find((x) => x.start > t && x.start - t <= ahead) || null;

// How far a playing take may drift from the picture before it's put back in step: about
// two frames, which nobody hears, while a jump back would be heard.
export const DRIFT = 0.08;

// Whether the sound output looks like Bluetooth, which delays sound by 150 to 300 ms,
// by its name or the delay the browser reports (seconds).
export const looksBluetooth = (label = '', latency = 0) => /bluetooth|airpods|buds|wireless|\bBT\b/i.test(label) || latency > 0.12;
