// A dialogue lane from the programme's own audio, for a video with no subtitles: speech to
// text listens to it a part at a time, and what it hears, with its timings, becomes the
// lines of the lane. It runs on this computer (stt.js), or on OpenAI with the key from AI
// help. Everything here can be tested without a browser; the job itself is in app.js.
import { heardSpeech } from './aiscript.js';
import { cleanText } from './stt.js';

export const LABEL = 'Speech to text';
// A part's length: on this computer, short enough for Stop and progress to keep up; online,
// longer, as each request has its own wait. Five minutes of 16 kHz WAV is about 9.6 MB.
export const PART_LOCAL = 60;
export const PART_ONLINE = 300;
// Whisper in the browser gives each sentence's times only, and they go wrong where it
// joins its own 30-second windows. So its parts, with their overlap, fit in one window.
export const PART_WEB = 19;
// Each part's audio runs on either side, so a sentence at a join is heard whole: cut off,
// Whisper can misplace its words. A line belongs to the part its middle is in.
export const OVERLAP = 5;
// Speech to text's timings are looser than subtitles', so each line is widened by this much
// at both ends: a gap shrinks a little rather than a draft running into speech.
export const PAD = 0.2;
// A pause this long inside one of Whisper's sentences splits it: there may be room for a
// block there.
export const SPLIT = 1.5;
// With words alone, a line ends at a pause, or at a sentence's end once it's this long.
export const PAUSE = 0.7;
export const LINE_LONG = 3;
export const LINE_MAX = 10;
// A word said for longer than this has been stretched over a pause, which word timings
// sometimes do at the edge of one. It's pulled back to the word it's said with.
export const WORD_MAX = 1.5;
export const WORD_SAY = 0.6;
// OpenAI's whisper-1: $0.006 a minute.
export const OPENAI_CENTS_A_MINUTE = 0.6;
export const OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions';

// The parts from `from` to the end: { start, end } is what the part decides, and
// { clipFrom, clipTo } the audio it hears.
export function partsOf(duration, size, from = 0) {
  const out = [];
  if (!(duration > 0) || !(size > 0)) return out;
  for (let t = Math.max(0, from); t < duration - 0.01; t += size) {
    const end = Math.min(duration, t + size);
    out.push({ start: t, end, clipFrom: Math.max(0, t - OVERLAP), clipTo: Math.min(duration, end + OVERLAP) });
  }
  // A last sliver joins the part before, unless the parts are short to fit a window.
  if (out.length > 1 && out.at(-1).end - out.at(-1).start < 5 && size >= 30) {
    const last = out.pop();
    Object.assign(out.at(-1), { end: last.end, clipTo: last.clipTo });
  }
  return out;
}

const tidy = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const timed = (x) => Number.isFinite(+x?.start) ? { start: +x.start, end: Number.isFinite(+x.end) && +x.end > +x.start ? +x.end : +x.start + 0.5, text: tidy(x.text) } : null;
const joined = (ws) => ws.map((w) => w.text).join(' ').replace(/\s+([,.?!;:])/g, '$1');
const ends = (w) => /[.?!]["'”’)]*$/.test(w.text);

// Words stretched over a pause, pulled back to the word next to them: the next word, if it
// follows straight on, else the one before. On its own, a word is left as it is.
function unstretched(words) {
  return words.map((w, i) => {
    if (w.end - w.start <= WORD_MAX) return w;
    const next = words[i + 1], prev = words[i - 1];
    if (next && next.start - w.end < PAUSE) return { ...w, start: Math.max(w.start, Math.min(w.end, next.start) - WORD_SAY) };
    if (prev && w.start - prev.end < PAUSE) return { ...w, end: Math.max(w.start, prev.end) + WORD_SAY };
    return w;
  });
}

// Words in runs, split where the speaker pauses for `gap`.
function runs(words, gap) {
  const out = [];
  for (const w of words) {
    const run = out.at(-1);
    if (run && w.start - run.at(-1).end < gap) run.push(w);
    else out.push([w]);
  }
  return out;
}

// Words alone (no sentences): a line ends at a pause, at a sentence's end once it's long
// enough, or when it gets too long.
function wordLines(words) {
  const out = [];
  let line = [];
  for (const w of words) {
    const prev = line.at(-1);
    if (prev && (w.start - prev.end >= PAUSE || (ends(prev) && prev.end - line[0].start >= LINE_LONG) || w.end - line[0].start > LINE_MAX)) {
      out.push(line);
      line = [];
    }
    line.push(w);
  }
  if (line.length) out.push(line);
  return out.map((ws) => ({ start: ws[0].start, end: ws.at(-1).end, text: joined(ws) }));
}

// What speech to text heard in a part, { segments, words } with times from the part's
// start, as the lane's lines from the programme's start, `at` being where the part begins.
// Sentences give the text; words, where there are some, give tighter timings.
export function linesFrom({ segments, words } = {}, at = 0) {
  const ws = unstretched((words || []).map(timed).filter((w) => w && w.text).sort((a, b) => a.start - b.start));
  const segs = (segments || []).map(timed).filter((s) => s && s.text).sort((a, b) => a.start - b.start);
  let lines;
  if (!segs.length) lines = wordLines(ws);
  else {
    lines = [];
    segs.forEach((s, i) => {
      const next = segs[i + 1]?.start ?? Infinity;
      const mine = ws.filter((w) => w.start >= s.start - 0.05 && w.start < Math.min(s.end + 0.05, next));
      if (!mine.length) { lines.push(s); return; }
      const parts = runs(mine, SPLIT);
      if (parts.length === 1) lines.push({ start: mine[0].start, end: mine.at(-1).end, text: s.text });
      else for (const p of parts) lines.push({ start: p[0].start, end: p.at(-1).end, text: joined(p) });
    });
  }
  return lines
    // Whisper's phantoms can end a real sentence too: "Wait for me, please. you".
    .map((l) => ({ ...l, text: heardSpeech(cleanText(l.text).replace(/([.?!])\s+(?:you|thank you|thanks for watching)[.!]?$/i, '$1')) }))
    .filter((l) => l.text)
    .map((l) => ({ start: Math.max(0, at + l.start - PAD), end: at + l.end + PAD, text: l.text }));
}

// The lines that belong to a part: those whose middle is in it.
export const keepIn = (lines, part) => lines.filter((l) => {
  const mid = (l.start + l.end) / 2;
  return mid >= part.start && mid < part.end;
});

// What OpenAI would cost for `secs` of audio, in words.
export function openaiCost(secs) {
  const cents = (secs / 60) * OPENAI_CENTS_A_MINUTE;
  if (cents < 1) return 'less than a cent';
  if (cents < 100) return `about ${Math.round(cents)} cents`;
  return `about $${(cents / 100).toFixed(2)}`;
}

// Minutes and seconds as people read them: "1 h 05 min", "12 min", "40 s".
export function span(secs) {
  const s = Math.max(0, Math.round(secs));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

// How long is left, from how fast the parts so far went.
export function timeLeft(elapsed, done, left) {
  if (!(done > 0) || !(elapsed > 0)) return '';
  return `about ${span((elapsed / done) * left)} left`;
}

// A request for OpenAI to hear a WAV, with the timings of its sentences and words.
export function openaiRequest(wav, key) {
  const body = new FormData();
  body.append('file', new Blob([wav], { type: 'audio/wav' }), 'part.wav');
  body.append('model', 'whisper-1');
  body.append('response_format', 'verbose_json');
  body.append('timestamp_granularities[]', 'word');
  body.append('timestamp_granularities[]', 'segment');
  return { url: OPENAI_URL, init: { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body } };
}

// OpenAI's reply as { segments, words }.
export const openaiHeard = (json) => ({
  segments: (json?.segments || []).map((s) => ({ start: s.start, end: s.end, text: s.text })),
  words: (json?.words || []).map((w) => ({ start: w.start, end: w.end, text: w.word })),
});
