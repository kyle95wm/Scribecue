// Drafting the whole script with AI: which gaps get a block, where long gaps are split,
// where the picture cuts, and what a run will cost. The run itself is in aidrawer.js.
import { placeInGap } from './dialogue.js';

// A gap shorter than this isn't drafted: too short for a useful description.
export const DRAFT_MIN = 2;
// A gap longer than this is split into several blocks, each about PIECE_MIN–PIECE_MAX long.
export const SPLIT_OVER = 10;
export const PIECE_MIN = 4;
export const PIECE_MAX = 10;
const PIECE_AIM = 7;
// The pause left between two blocks made from one gap.
export const PIECE_PAUSE = 0.3;
// How often the picture is sampled to find cuts in a long gap, in seconds.
export const CUT_STEP = 0.5;

// The free gaps between from and to, as the stretches a block would take, without the
// short ones. free: from freeGaps in dialogue.js, in order.
export function gapsToDraft(free, from = 0, to = Infinity, min = DRAFT_MIN) {
  const out = [];
  for (const g of free) {
    const start = Math.max(g.start, from), end = Math.min(g.end, to);
    if (end - start <= 0) continue;
    // A gap cut by the range keeps no margin at the cut: there's no dialogue there.
    const placed = placeInGap({ start, end });
    const s = start > g.start ? start : placed.start, e = end < g.end ? end : placed.end;
    if (e - s >= min) out.push({ start: s, end: e });
  }
  return out;
}

// A gap as the blocks to draft in it: whole when it's short, otherwise split near the
// picture's cuts (times in seconds), or evenly where there are none to use.
export function splitGap(gap, cuts = []) {
  const len = gap.end - gap.start;
  if (len <= SPLIT_OVER) return [{ start: gap.start, end: gap.end }];
  const pieces = [];
  let at = gap.start;
  while (gap.end - at > PIECE_MAX) {
    const left = gap.end - at;
    // Leave enough for a last piece that's long enough.
    const hi = Math.min(at + PIECE_MAX, gap.end - PIECE_MIN), lo = at + PIECE_MIN;
    const near = cuts.filter((t) => t >= lo && t <= hi);
    const aim = left < PIECE_MAX + PIECE_MIN ? at + left / 2 : at + PIECE_AIM;
    const cut = near.length ? near.reduce((a, b) => (Math.abs(b - aim) < Math.abs(a - aim) ? b : a)) : Math.min(aim, hi);
    pieces.push({ start: at, end: cut - PIECE_PAUSE / 2 });
    at = cut + PIECE_PAUSE / 2;
  }
  pieces.push({ start: at, end: gap.end });
  return pieces.map(({ start, end }) => ({ start: round(start), end: round(end) }));
}
const round = (t) => Math.round(t * 1000) / 1000;

// The times at which to sample a long gap for cuts.
export function cutSamples(gap, step = CUT_STEP) {
  const out = [];
  for (let t = gap.start; t <= gap.end; t += step) out.push(round(t));
  return out;
}

// How different two small greyscale stills are: the mean difference per pixel, 0–255.
export function frameDiff(a, b) {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
  return sum / n;
}

// Where the picture cuts, from stills sampled in order: [{ at, px }], px greyscale. A cut is
// a change well above both a fixed floor and the usual change from one still to the next,
// so a moving camera isn't taken for a cut. Returns the time halfway between the two stills.
export function findCuts(samples, floor = 28, factor = 3) {
  const diffs = [];
  for (let i = 1; i < samples.length; i++) diffs.push(frameDiff(samples[i - 1].px, samples[i].px));
  if (!diffs.length) return [];
  const usual = [...diffs].sort((a, b) => a - b)[Math.floor(diffs.length / 2)];
  const cuts = [];
  diffs.forEach((d, i) => {
    if (d >= floor && d >= usual * factor) cuts.push(round((samples[i].at + samples[i + 1].at) / 2));
  });
  return cuts;
}

// Subtitle lines just before and after a stretch, for the AI to know what's being said.
// lines: the dialogue lane's, in order.
export function dialogueAround(lines, start, end, n = 3) {
  const before = lines.filter((l) => l.end <= start + 0.05).slice(-n).map((l) => l.text);
  const after = lines.filter((l) => l.start >= end - 0.05).slice(0, n).map((l) => l.text);
  return { before, after };
}

// The script with a new, empty block put in its place, and where it is. Used to ask for a
// draft of a block that isn't in the script yet.
export function withBlock(cues, block) {
  const i = cues.findIndex((c) => c.start > block.start);
  const at = i < 0 ? cues.length : i;
  return { cues: [...cues.slice(0, at), { ...block, text: '' }, ...cues.slice(at)], i: at };
}

// Rough cost of one draft with three frames, in US cents, from the AI guide's figures.
// Models not listed aren't estimated.
const CENTS = [
  [/claude-opus/, 1, 2], [/claude-sonnet/, 0.6, 1.2], [/claude-haiku/, 0.1, 0.3], [/claude-fable/, 1, 2],
  [/gpt-6(\.\d)?-astra/, 2, 3], [/gpt-6(\.\d)?-sol/, 0.4, 0.7], [/gpt-6(\.\d)?-luna/, 0.02, 0.1],
];
// What a run of count drafts will roughly cost and take. cents: [low, high] or null when
// the model isn't known (or runs on this computer, for free). secs: [low, high], online only.
export function estimate(count, model = '', frames = 3, local = false) {
  const scale = Math.max(1, frames) / 3;
  const row = local ? null : CENTS.find(([re]) => re.test(model.replace(/^[a-z-]+\//, '')));
  return {
    count,
    cents: local ? [0, 0] : row ? [row[1] * scale * count, row[2] * scale * count] : null,
    secs: local ? null : [count * 4, count * 10],
  };
}

// The estimate in words, for the dialog.
export function estimateText(e, providerName = 'the provider', local = false) {
  const n = `${e.count} block${e.count === 1 ? '' : 's'}`;
  if (local) return `${n}. Free with Ollama, from a couple of seconds to a minute a block, depending on your computer.`;
  const money = e.cents ? `about ${dollars(e.cents[0])}–${dollars(e.cents[1])}` : `${providerName}’s usual price for each draft`;
  return `${n}: ${money}, and ${duration(e.secs[0])}–${duration(e.secs[1])}.`;
}
const dollars = (c) => (c < 100 ? `${Math.max(1, Math.round(c))}¢` : `$${(c / 100).toFixed(c < 1000 ? 2 : 0)}`);
function duration(s) {
  if (s < 90) return `${Math.max(1, Math.round(s))} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

// What Whisper heard in a gap, as speech the subtitles may have missed, or '' for none.
// Whisper invents a few words for music and noise, such as "you" or "Thank you.", so a
// reply that's only those isn't counted. text: already cleaned by cleanText in stt.js.
const PHANTOMS = /^(you|thank you|thanks|thanks for watching|thank you for watching|bye|okay|oh|uh|um|hmm|mm|so|music)$/;
export function heardSpeech(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const bare = t.toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, '').replace(/\s+/g, ' ').trim();
  if (!bare || PHANTOMS.test(bare)) return '';
  return t.slice(0, 200);
}

// ---- scene summaries: a first pass that tells each draft the story so far

// A stretch summarised at once aims for this long, ending in a dialogue gap between the
// shortest and longest, so a conversation isn't cut in two.
export const SCENE_AIM = 150;
export const SCENE_MIN = 120;
export const SCENE_MAX = 180;
// Stills sent with each summary, and how much of the story so far goes with a request.
export const SCENE_STILLS = 8;
export const STORY_CHARS = 1500;

// The stretches to summarise, as [{ start, end }], covering 0 to duration. gaps: the
// dialogue's gaps ({ start, end }, in order), or [] without a dialogue lane.
export function sceneStretches(duration, gaps = []) {
  const out = [];
  let at = 0;
  while (duration - at > SCENE_MAX) {
    const lo = at + SCENE_MIN, hi = at + SCENE_MAX, aim = at + SCENE_AIM;
    const mids = gaps.map((g) => (g.start + g.end) / 2).filter((t) => t >= lo && t <= hi);
    const cut = mids.length ? mids.reduce((a, b) => (Math.abs(b - aim) < Math.abs(a - aim) ? b : a)) : aim;
    out.push({ start: round(at), end: round(cut) });
    at = cut;
  }
  if (duration - at > 0) out.push({ start: round(at), end: round(duration) });
  return out;
}

// Scenes as saved: [{ start, end, text, edited }], in order, without broken ones.
export function cleanScenes(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => s && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start && s.start >= 0)
    .map((s) => ({ start: s.start, end: s.end, text: typeof s.text === 'string' ? s.text.slice(0, 2000) : '', ...(s.edited === true ? { edited: true } : {}) }))
    .sort((a, b) => a.start - b.start);
}

// The scenes for a programme: the ones there are, or new empty stretches when there are none.
export const scenesFor = (scenes, duration, gaps) => (scenes.length ? scenes : sceneStretches(duration, gaps).map((s) => ({ ...s, text: '' })));

// The scene a time falls in, or -1.
export const sceneIndex = (scenes, t) => scenes.findIndex((s) => t >= s.start && t < s.end);

// What's happened before scene i: the last three summaries whole, the first sentence of
// earlier ones, and no more than STORY_CHARS, keeping the most recent.
export function storySoFar(scenes, i, max = STORY_CHARS) {
  const told = scenes.slice(0, Math.max(0, i)).filter((s) => s.text.trim());
  const parts = told.map((s, k) => {
    const t = s.text.trim().replace(/\s+/g, ' ');
    return k >= told.length - 3 ? t : (t.match(/^.*?[.!?](\s|$)/)?.[0] || t).trim();
  });
  let out = '';
  for (let k = parts.length - 1; k >= 0; k--) {
    const next = out ? `${parts[k]} ${out}` : parts[k];
    if (next.length > max) break;
    out = next;
  }
  return out;
}

// What a draft or chat message is told about where it is: { summary, story }, or null.
export function sceneContext(scenes, t) {
  const i = sceneIndex(scenes, t);
  if (i < 0) return null;
  const summary = scenes[i].text.trim(), story = storySoFar(scenes, i);
  return summary || story ? { summary, story } : null;
}

// The request for one scene's summary.
export function summaryPrompt(scene, lines, story, frameTimes, clockOf) {
  const said = lines.filter((l) => l.end > scene.start && l.start < scene.end).map((l) => `  ${clockOf(l.start)} "${l.text}"`);
  return [
    `Summarise this part of the programme, from ${clockOf(scene.start)} to ${clockOf(scene.end)}, for the writer drafting its audio description.`,
    story ? `The story so far, for context only: ${story}` : 'This is the start of the programme.',
    said.length ? `What's said, from the subtitles:\n${said.join('\n')}` : 'There are no subtitles here.',
    frameTimes.length ? `The stills are from ${frameTimes.map(clockOf).join(', ')}.` : '',
    'In 2 to 4 plain sentences: who is there, using the names the notes or dialogue give; where they are; what happens; and what has changed since before. Only this part: don’t retell the story so far. Only what the stills and dialogue show. Reply with only the summary.',
  ].filter(Boolean).join('\n\n');
}
