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
      const w = (k + 0.5) / (2 * h) * Math.PI / 2;
      pcm[c - h + k] = (base.pcm[c - h + k] ?? 0) * Math.cos(w) + x * Math.sin(w);
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
