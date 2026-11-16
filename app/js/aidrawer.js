// The AI help drawer: settings for the person's AI provider, a chat about the scene, and
// "Draft this block". The requests themselves are built in ai.js.
import {
  PROVIDERS, buildRequest, recentFrames, withNotes, SYSTEM, readReply, failure, listModels, fitBudget, shortenPrompt, draftPrompt, draftSpeed, toPace, PACES, chatContext, clock, SCENE_SYSTEM,
  pkcePair, openRouterAuthUrl, openRouterKey,
} from './ai.js';
import { tts, chosenVoice, DEFAULT_CPS, atBase, estimate as readTime, speedLabel } from './tts.js';
import { HOSTED } from './config.js';
import { lookup as lookUpCast, KEY_PAGE as TMDB_KEY_PAGE } from './tmdb.js';
import { openSettings as showSettings } from './settings.js';
import { parseTime } from './formats.js';
import { englishFor } from './spelling.js';
import {
  gapsToDraft, splitGap, cutSamples, findCuts, dialogueAround, withBlock, estimate, estimateText, heardSpeech, SPLIT_OVER, DRAFT_MIN,
  scenesFor, sceneContext, storySoFar, summaryPrompt, SCENE_STILLS, RECAP_SYSTEM, recapPrompt, splitRecap,
} from './aiscript.js';

const $ = (id) => document.getElementById(id);
const KEY = 'scribecue.ai', KEYS = 'scribecue.ai.keys', PKCE = 'scribecue.ai.pkce';
const load = (store, k) => { try { return JSON.parse(store.getItem(k)) || {}; } catch { return {}; } };
const keep = (store, k, v) => { try { store.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

// { provider, models: { provider: model }, lists: { provider: [models] }, base, frames, remember, notes, pace }
// notes: the writer's notes for every project, in Settings. pace: the fastest speed a draft may be read at.
const ai = { provider: '', models: {}, lists: {}, base: PROVIDERS.ollama.base, frames: 3, remember: true, listen: true, notes: '', ...load(localStorage, KEY) };
// Keys live apart from the settings: in this browser only, or for this tab only.
const keys = () => ({ ...load(sessionStorage, KEYS), ...load(localStorage, KEYS) });
function setKey(provider, key) {
  for (const store of [localStorage, sessionStorage]) {
    const k = load(store, KEYS);
    delete k[provider];
    keep(store, KEYS, k);
  }
  if (!key) return;
  const store = ai.remember ? localStorage : sessionStorage;
  keep(store, KEYS, { ...load(store, KEYS), [provider]: key });
}
const save = () => { const { provider, models, lists, base, frames, remember, listen, notes, pace } = ai; keep(localStorage, KEY, { provider, models, lists, base, frames, remember, listen, notes, pace }); };

// The notes for every project, which go with the project's own to every request.
export const generalNotes = () => (typeof ai.notes === 'string' ? ai.notes : '');
const instructions = (base = SYSTEM) => withNotes(base, { english: englishFor(hooks.language()), general: generalNotes(), notes: hooks.notes() });

// Other services' keys, kept with these: OpenSubtitles' key and sign-in.
export const storedKey = (name) => keys()[name] || '';
export const storeKey = (name, value) => setKey(name, value);

// The OpenAI key, if there is one: a dialogue lane can be found with it too.
export const openaiKey = () => keys().openai || '';

const ready = () => !!ai.provider && !!ai.models[ai.provider] && (PROVIDERS[ai.provider]?.local || !!keys()[ai.provider]);

let hooks = {
  cues: () => [], selIndex: () => -1, playhead: () => 0, video: () => null, apply: () => {}, speaks: () => false, toast: () => {}, writing: () => true,
  notes: () => '', setNotes: () => {},
  dialogueLines: () => [], freeGaps: () => null, duration: () => 0, noLane: '', identity: () => null, isFree: () => true,
  jobBusy: () => false, runJob: async () => null, laneHeard: () => false, insertDraft: () => null, undoKey: () => 'Ctrl+Z', nextKey: () => '',
  canListen: () => false, setUpListening: () => {}, listen: async () => '',
  scenes: () => [], setScenes: () => {}, dialogueGaps: () => [], seek: () => {}, language: () => 'en-us',
};
let chat = []; // the conversation, as ai.js messages
let running = null; // AbortController of the request under way

// ---- frames

let grabber = null;
const once = (el, ev, ms) => new Promise((ok, no) => {
  const t = setTimeout(() => { el.removeEventListener(ev, h); no(new Error(`the video didn't answer (${ev})`)); }, ms);
  const h = () => { clearTimeout(t); ok(); };
  el.addEventListener(ev, h, { once: true });
});
// The hidden copy of the video stills come from, so the playhead stays put. One job uses
// it at a time: a draft asked for while the script is being drafted waits its turn.
let grabTurn = Promise.resolve();
function withGrabber(fn) {
  const go = grabTurn.then(async () => {
    const v = hooks.video();
    if (!v?.currentSrc || !v.videoWidth) return null;
    if (!grabber || grabber.src !== v.currentSrc) {
      grabber = document.createElement('video');
      grabber.muted = true;
      grabber.preload = 'auto';
      grabber.src = v.currentSrc;
      await once(grabber, 'loadeddata', 10000);
    }
    return fn(grabber);
  });
  grabTurn = go.catch(() => {});
  return go;
}
const seekTo = async (g, at) => {
  g.currentTime = Math.max(0, Math.min(at, (g.duration || at + 1) - 0.05));
  await once(g, 'seeked', 5000);
};
// Stills from the video at these times, as JPEGs for the AI, at most width pixels wide.
async function grabFrames(times, width = 768) {
  if (!times.length) return [];
  return (await withGrabber(async (g) => {
    const w = Math.min(width, g.videoWidth), h = Math.round(w * g.videoHeight / g.videoWidth);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const out = [];
    for (const at of times) {
      await seekTo(g, at);
      cv.getContext('2d').drawImage(g, 0, 0, w, h);
      const url = cv.toDataURL('image/jpeg', 0.75);
      out.push({ at, url, data: url.slice(url.indexOf(',') + 1) });
    }
    return out;
  })) || [];
}
// Tiny greyscale stills, enough to see where the picture cuts. Stops between stills when
// signal is aborted.
async function grabGrey(times, signal) {
  return (await withGrabber(async (g) => {
    const cv = document.createElement('canvas');
    cv.width = 32; cv.height = 18;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    const out = [];
    for (const at of times) {
      if (signal?.aborted) break;
      await seekTo(g, at);
      cx.drawImage(g, 0, 0, 32, 18);
      const rgba = cx.getImageData(0, 0, 32, 18).data, px = new Uint8Array(32 * 18);
      for (let i = 0; i < px.length; i++) px[i] = (rgba[i * 4] * 77 + rgba[i * 4 + 1] * 150 + rgba[i * 4 + 2] * 29) >> 8;
      out.push({ at, px });
    }
    return out;
  })) || [];
}
// n times spread across a block, away from its very edges where shots often change.
export function framesFor(start, end, n) {
  if (n <= 0) return [];
  if (n === 1) return [(start + end) / 2];
  const pad = (end - start) * 0.1;
  return Array.from({ length: n }, (_, k) => start + pad + (end - start - 2 * pad) * k / (n - 1));
}

// ---- the conversation

function bubble(cls, text = '', frames = []) {
  const d = document.createElement('div');
  d.className = `aimsg ${cls}`;
  if (frames.length) {
    const f = document.createElement('div');
    f.className = 'frames';
    for (const im of frames) { const i = new Image(); i.src = im.url; i.alt = ''; f.append(i); }
    d.append(f);
  }
  d.append(document.createTextNode(text));
  $('aiLog').append(d);
  d.scrollIntoView({ block: 'end' });
  return d;
}
const note = (text, cls = 'note') => bubble(cls, text);

// Online providers can't be reached without a connection; Ollama, on this computer, can.
const unreachable = () => navigator.onLine === false && !!ai.provider && !PROVIDERS[ai.provider]?.local;
function renderOffline() {
  const off = unreachable();
  $('aiOffline').hidden = !off;
  if (off) $('aiOffline').textContent = `You’re offline, so ${PROVIDERS[ai.provider].name} can’t be reached. Ollama, on this computer, works offline: choose it in Settings.`;
  if (!running) { $('aiSend').disabled = off; $('aiDraft').disabled = off; }
}
addEventListener('online', () => renderOffline());
addEventListener('offline', () => renderOffline());

function busy(on) {
  $('aiSend').disabled = on || unreachable();
  $('aiDraft').disabled = on || unreachable();
  $('aiStop').hidden = !on;
  $('aiStatus').textContent = on ? 'Thinking…' : '';
}

// Sends the conversation so far plus this message; shows the reply as it arrives. draft: { id, n } of the
// block it's for, which adds buttons to use the reply. Returns the reply, or nothing if it failed.
async function send(msg, shown, frames, draft = null) {
  if (!ready()) { openAiSettings(); return note('Connect a provider first, in Settings, under AI help.'); }
  if (running) return;
  if (unreachable()) return renderOffline();
  bubble('user', shown, frames);
  const turn = { role: 'user', text: msg, images: frames.map(({ data, at }) => ({ data, at })) };
  const provider = ai.provider, model = ai.models[provider];
  const req = buildRequest(provider, { key: keys()[provider], model, base: ai.base, system: instructions(), messages: recentFrames([...chat, turn]) });
  const out = bubble(`assistant${draft ? ' draft' : ''}`);
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = draft ? `Draft for block #${draft.n}` : model;
  out.prepend(tag);
  const body = document.createTextNode('');
  out.append(body);
  running = new AbortController();
  busy(true);
  try {
    const r = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: running.signal });
    if (!r.ok) throw new Error(await failure(provider, r));
    const reply = await readReply(provider, r, (_, all) => { body.data = all; out.scrollIntoView({ block: 'end' }); });
    if (reply.stop === 'refusal' || (!reply.text && reply.stop)) {
      out.classList.add('error');
      body.data = 'The model declined to answer this. Try rewording it, or another model.';
      return;
    }
    chat.push(turn, { role: 'assistant', text: reply.text, ...(reply.raw ? { raw: reply.raw } : {}) });
    const text = unquote(reply.text);
    if (draft && text) addDraftButtons(out, draft, text);
    return text;
  } catch (e) {
    out.classList.add('error');
    body.data = e.name === 'AbortError' ? (body.data ? `${body.data} [stopped]` : 'Stopped.')
      : e instanceof TypeError ? `Couldn't reach ${PROVIDERS[provider].name}. ${PROVIDERS[provider].local ? 'Is Ollama running, and does it allow this page? See AI settings.' : 'Check your connection.'}`
        : e.message;
  } finally {
    running = null;
    busy(false);
  }
}

function addDraftButtons(out, draft, text) {
  const acts = document.createElement('div');
  acts.className = 'acts';
  const use = document.createElement('button');
  use.className = 'hl';
  // A draft that needs a faster pace says so, and sets the block's speed when it's used.
  const speed = draft.pace ? draft.pace(text).speed : null;
  const sped = speed != null && speed > draft.from + 1e-9;
  use.textContent = `Use for block #${draft.n}${sped ? ` at ${speedLabel(speed)}` : ''}`;
  if (sped) use.dataset.tip = 'Read a little faster, so it fits the block';
  use.addEventListener('click', () => {
    if (hooks.apply(draft.id, text, sped ? speed : null)) { use.disabled = true; use.textContent = 'Used ✓'; }
  });
  const again = document.createElement('button');
  again.textContent = 'Try again';
  again.addEventListener('click', () => draftBlock(draft.id, 'Write a different version.'));
  acts.append(use, again);
  out.append(acts);
}

// A block's room, and what fits in it with the chosen voice at the block's speed. fast: what
// fits at the fastest pace drafts may use, with text to speech on. pace(text): the speed a
// draft needs, from draftSpeed. Drafting never slows a block down.
function room(b, speed = 1) {
  const secs = b.end - b.start, cps = tts.cps[chosenVoice()] || DEFAULT_CPS, at = atBase(speed, tts.base);
  const max = hooks.speaks() ? Math.max(speed, toPace(ai.pace)) : speed;
  return {
    secs, budget: fitBudget(secs, cps, at),
    fast: max > speed ? fitBudget(secs, cps, atBase(max, tts.base)) : null,
    said: (text) => readTime(text, cps, at),
    pace: (text) => draftSpeed(readTime(text, cps, atBase(1, tts.base)), secs, speed, max),
  };
}

async function draftBlock(id = null, extra = '') {
  if (!hooks.writing()) return hooks.toast('Drafting descriptions is part of Write mode');
  const cues = hooks.cues();
  const i = id == null ? hooks.selIndex() : cues.findIndex((c) => c.id === id);
  if (i < 0) return note('Select the block to draft first: click it in the list or on the timeline.');
  const c = cues[i];
  // What a block can hold depends on the voice and the block's speed.
  const { secs, budget, fast, said, pace } = room(c, c.speed ?? 1);
  let frames = [];
  try { frames = await grabFrames(framesFor(c.start, c.end, ai.frames)); } catch (e) { note(`No frames: ${e.message}.`); }
  const prompt = draftPrompt(cues, i, budget, frames.map((f) => f.at), dialogueAround(hooks.dialogueLines(), c.start, c.end), sceneContext(hooks.scenes(), c.start), fast) + (extra ? `\n${extra}` : '');
  const draft = { id: c.id, n: i + 1, pace, from: c.speed ?? 1 };
  const text = await send(prompt, `Draft block #${i + 1}${extra ? ` · ${extra}` : ''}`, frames, draft);
  // Too long to read in the block, even at the fastest pace: asked once to shorten it, in
  // the same conversation.
  if (text && !pace(text).fits) {
    const long = said(text);
    await send(shortenPrompt(text, long, secs, fast || budget), `Too long: about ${long.toFixed(1)} s for ${secs.toFixed(1)} s. Shorten it.`, [], draft);
  }
}

async function sendChat() {
  const text = $('aiInput').value.trim();
  if (!text || running) return;
  $('aiInput').value = '';
  let frames = [];
  if ($('aiFrame').checked) {
    try { frames = await grabFrames([hooks.playhead()]); } catch (e) { note(`No frame: ${e.message}.`); }
  }
  const ctx = chatContext(hooks.cues(), hooks.selIndex(), hooks.playhead(), sceneContext(hooks.scenes(), hooks.playhead()));
  await send(`${ctx}\n\n${text}`, text, frames);
}

// ---- drafting the whole script

const pause = (ms, signal) => new Promise((ok, no) => {
  const t = setTimeout(ok, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); no(new DOMException('Stopped', 'AbortError')); }, { once: true });
});
const unquote = (t) => t.trim().replace(/^["“]|["”]$/g, '').trim();
// One draft, outside the chat. Busy providers are tried again after a wait. Returns
// { text }, { declined: true } or { failed: message } for this block alone; throws when
// no other block would do better either, such as a key that's refused.
async function requestDraft(text, frames, signal, system = instructions()) {
  const provider = ai.provider, name = PROVIDERS[provider].name;
  const req = buildRequest(provider, {
    key: keys()[provider], model: ai.models[provider], base: ai.base, system,
    messages: [{ role: 'user', text, images: frames.map(({ data, at }) => ({ data, at })) }],
  });
  for (let attempt = 0; ; attempt++) {
    let r;
    try {
      r = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      if (attempt < 2) { await pause(5000 * (attempt + 1), signal); continue; }
      throw new Error(`Couldn’t reach ${name}. ${PROVIDERS[provider].local ? 'Is Ollama running?' : 'Check your connection.'}`);
    }
    if (r.ok) {
      const reply = await readReply(provider, r);
      if (reply.stop === 'refusal' || (!reply.text && reply.stop)) return { declined: true };
      return { text: unquote(reply.text) };
    }
    if ((r.status === 429 || r.status >= 500) && attempt < 4) {
      const wait = +r.headers.get('retry-after');
      await pause(wait > 0 ? Math.min(wait, 120) * 1000 : 5000 * 2 ** attempt, signal);
      continue;
    }
    const msg = await failure(provider, r);
    if ([400, 413, 422].includes(r.status)) return { failed: msg };
    throw new Error(msg);
  }
}

// The story so far, for the next episode of a series, from the recap before and this
// episode's scene summaries. null when AI help isn't connected or the provider says no;
// throws when it can't be reached.
export const aiConnected = () => ready();
export async function writeRecap(previous, scenes, episode, signal) {
  if (!ready()) return null;
  const system = withNotes(RECAP_SYSTEM, { english: englishFor(hooks.language()), general: generalNotes(), notes: splitRecap(hooks.notes()).notes });
  const r = await requestDraft(recapPrompt(previous, scenes, episode), [], signal, system);
  return r.text?.trim() || null;
}

// The stretches a run would draft, between from and to, before looking for cuts.
function planFor(from, to) {
  const free = hooks.freeGaps(DRAFT_MIN);
  if (!free) return null;
  const gaps = gapsToDraft(free, from, to);
  return { gaps, count: gaps.reduce((n, g) => n + splitGap(g).length, 0) };
}

async function draftScript(from, to, listen = false) {
  const project = hooks.identity();
  const out = await hooks.runJob(async (signal, progress) => {
    const { gaps } = planFor(from, to) || { gaps: [] };
    let total = gaps.reduce((n, g) => n + splitGap(g).length, 0), done = 0, made = 0, empty = 0, heardIn = 0, over = 0, faster = 0, stopped = '', deaf = '';
    progress(0, `0 of ${total}`);
    const lost = () => hooks.identity() !== project || !hooks.writing();
    try {
      for (const g of gaps) {
        if (signal.aborted || lost()) break;
        let pieces = splitGap(g);
        if (g.end - g.start > SPLIT_OVER) {
          progress(done / total, `${done} of ${total}, looking for cuts`);
          const found = splitGap(g, findCuts(await grabGrey(cutSamples(g), signal)));
          total += found.length - pieces.length;
          pieces = found;
        }
        for (const p of pieces) {
          if (signal.aborted || lost()) break;
          progress(done / total, `${done} of ${total}`);
          if (!hooks.isFree(p)) { done++; continue; } // someone wrote a block there meanwhile
          let frames = [];
          try { frames = await grabFrames(framesFor(p.start, p.end, ai.frames)); } catch { /* drafted from the script alone */ }
          // Speech the subtitles miss, such as a song or talk in the background. The block is
          // still drafted, and marked; if speech to text fails, the run carries on without it.
          let heard = '';
          if (listen && !deaf) {
            try { heard = heardSpeech(await hooks.listen(p)); } catch (e) { deaf = e.message; }
            if (signal.aborted) break;
          }
          const { cues, i } = withBlock(hooks.cues(), p);
          const { secs, budget, fast, said, pace } = room(p);
          const prompt = `${draftPrompt(cues, i, budget, frames.map((f) => f.at), { ...dialogueAround(hooks.dialogueLines(), p.start, p.end), heard }, sceneContext(hooks.scenes(), p.start), fast)}
This is one of a run of drafts through the whole programme, in order. Don't repeat what the blocks before it say.`;
          const r = await requestDraft(prompt, frames, signal);
          // Too long to read in the gap, even at the fastest pace: asked once to shorten it,
          // and the shorter one kept. What still runs over is read at the fastest pace.
          let fit = pace(r.text || '');
          if (r.text && !fit.fits) {
            const long = said(r.text);
            const s = await requestDraft(shortenPrompt(r.text, long, secs, fast || budget), [], signal);
            if (s.text && said(s.text) < long) r.text = s.text;
            fit = pace(r.text);
            if (!fit.fits) over++;
          }
          if (signal.aborted || lost()) break;
          if (!hooks.isFree(p)) { done++; continue; }
          hooks.insertDraft(p, r.text || '', heard, r.text ? fit.speed : 1);
          if (r.text && fit.speed > 1) faster++;
          if (r.text) made++; else empty++;
          if (heard) heardIn++;
          done++;
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') stopped = e.message;
    }
    return { made, empty, heardIn, over, faster, deaf, stopped, aborted: signal.aborted, lost: lost() };
  });
  if (!out) return;
  const n = out.made + out.empty;
  const what = n ? `${out.made} AI draft${out.made === 1 ? '' : 's'} added${out.empty ? `, and ${out.empty} empty block${out.empty === 1 ? '' : 's'} the AI couldn’t draft` : ''}` : 'No AI drafts added';
  const why = out.stopped ? `. Stopped: ${out.stopped}` : out.lost ? '. Stopped when the project or mode changed' : out.aborted ? '. Stopped' : '';
  const next = n ? `. ${hooks.nextKey() || 'The next key'} goes to the next one to check${out.undoable ? `; ${hooks.undoKey()} takes them all back` : ''}` : '';
  const heard = out.heardIn ? ` Speech to text heard speech under ${out.heardIn}, marked “speech under it?”: U goes to them.` : '';
  const deaf = out.deaf ? ` Speech to text stopped listening: ${out.deaf}.` : '';
  const faster = out.faster ? ` ${out.faster === 1 ? '1 reads' : `${out.faster} read`} a little faster, to fit.` : '';
  const over = out.over ? ` ${out.over === 1 ? '1 is' : `${out.over} are`} still too long to read in time, even shortened.` : '';
  hooks.toast(`${what}${why}${next}`);
  if (n) note(`${what}${why}. They’re tagged AI draft until you edit or accept them.${faster}${over}${heard}${deaf}`);
}

// ---- scene summaries

const short = (t) => clock(t).replace(/^00:/, '').replace(/\.\d+$/, '');
const sceneLabel = (s) => `${short(s.start)}–${short(s.end)}`;
// The list in the Notes box: each stretch's times, its summary to check, and Again.
function renderScenes() {
  const list = $('aiScenes'), scenes = hooks.scenes();
  const done = scenes.filter((s) => s.text.trim()).length;
  $('aiScenesStatus').textContent = !scenes.length ? 'None yet.' : `${done} of ${scenes.length} summarised.`;
  // Typing in one keeps its place: only a different list is drawn again.
  const sig = scenes.map((s) => `${s.start}|${s.end}`).join(',');
  if (list.dataset.sig === sig) {
    [...list.children].forEach((li, k) => { const ta = li.querySelector('textarea'); if (document.activeElement !== ta) ta.value = scenes[k].text; });
    return;
  }
  list.dataset.sig = sig;
  list.textContent = '';
  scenes.forEach((s, k) => {
    const li = document.createElement('li');
    const when = Object.assign(document.createElement('button'), { className: 'when', textContent: sceneLabel(s) });
    when.dataset.tip = 'Go to this scene';
    when.addEventListener('click', () => hooks.seek(hooks.scenes()[k].start));
    const again = Object.assign(document.createElement('button'), { textContent: 'Again' });
    again.dataset.tip = 'Summarise this scene again, replacing what’s here';
    again.addEventListener('click', () => summariseScenes(0, Infinity, k));
    const ta = Object.assign(document.createElement('textarea'), { rows: 3, value: s.text, placeholder: 'Not summarised yet' });
    ta.setAttribute('aria-label', `Summary of ${sceneLabel(s)}`);
    ta.spellcheck = true;
    ta.addEventListener('input', () => {
      const all = hooks.scenes().map((x, j) => (j === k ? { ...x, text: ta.value, edited: true } : x));
      hooks.setScenes(all);
      $('aiScenesStatus').textContent = `${all.filter((x) => x.text.trim()).length} of ${all.length} summarised.`;
    });
    li.append(when, again, ta);
    list.append(li);
  });
}

// Summarises the stretches between from and to that have no summary yet, in order, or
// only scene `only`, replacing it. Runs as a job under the header.
async function summariseScenes(from = 0, to = Infinity, only = null) {
  if (!hooks.writing()) return hooks.toast('Drafting descriptions is part of Write mode');
  if (!ready()) { toggleAi(true); openAiSettings(); return; }
  if (unreachable()) return hooks.toast(`You’re offline, so ${PROVIDERS[ai.provider].name} can’t be reached`);
  if (!hooks.video()) return hooks.toast('Open the video first');
  const project = hooks.identity();
  hooks.setScenes(scenesFor(hooks.scenes(), hooks.duration(), hooks.dialogueGaps()));
  renderScenes();
  const todo = hooks.scenes().map((s, k) => k).filter((k) => {
    const s = hooks.scenes()[k];
    return only != null ? k === only : !s.text.trim() && s.end > from && s.start < to;
  });
  if (!todo.length) { hooks.toast('Every scene here has a summary'); return true; }
  const out = await hooks.runJob(async (signal, progress) => {
    let done = 0, stopped = '';
    const lost = () => hooks.identity() !== project || !hooks.writing();
    try {
      for (const k of todo) {
        if (signal.aborted || lost()) break;
        progress(done / todo.length, `${done} of ${todo.length}`);
        const s = hooks.scenes()[k];
        let frames = [];
        try { frames = await grabFrames(framesFor(s.start, s.end, SCENE_STILLS), 512); } catch { /* the subtitles alone */ }
        const prompt = summaryPrompt(s, hooks.dialogueLines(), storySoFar(hooks.scenes(), k), frames.map((f) => f.at), short);
        const r = await requestDraft(prompt, frames, signal, instructions(SCENE_SYSTEM));
        if (signal.aborted || lost()) break;
        // Someone may have typed one meanwhile: theirs stays, unless they asked for this one again.
        const now = hooks.scenes();
        if (r.text && now[k] && (only != null || !now[k].text.trim())) {
          hooks.setScenes(now.map((x, j) => (j === k ? { start: x.start, end: x.end, text: r.text } : x)));
          renderScenes();
        }
        done++;
      }
    } catch (e) {
      if (e.name !== 'AbortError') stopped = e.message;
    }
    return { done, stopped, aborted: signal.aborted };
  }, 'Scene summaries');
  if (!out) return false;
  const all = hooks.scenes(), have = all.filter((s) => s.text.trim()).length;
  const why = out.stopped ? ` Stopped: ${out.stopped}.` : out.aborted ? ' Stopped.' : '';
  hooks.toast(`${out.done} scene${out.done === 1 ? '' : 's'} summarised.${why} Check them in Notes, then draft`);
  toggleAi(true);
  toggleNotes(true, true);
  note(`${have} of ${all.length} scenes summarised.${why} Check them in Notes, under Scenes: fix names and anything the AI got wrong. Drafts use them as they are.`);
  return !out.stopped && !out.aborted;
}

// The dialog: what to draft, and what it'll cost, before anything is sent.
const dlg = () => $('aiScriptDlg');
function rangeOf() {
  const how = $('aiScriptRange').value, dur = hooks.duration();
  if (how === 'playhead') return { from: hooks.playhead(), to: dur };
  if (how === 'between') {
    const from = parseTime($('aiScriptFrom').value), to = parseTime($('aiScriptTo').value);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
    return { from, to: Math.min(to, dur) };
  }
  return { from: 0, to: dur };
}
function renderScriptDlg() {
  $('aiScriptTimes').hidden = $('aiScriptRange').value !== 'between';
  const r = rangeOf(), plan = r && planFor(r.from, r.to);
  const P = PROVIDERS[ai.provider], local = !!P?.local;
  $('aiScriptGo').disabled = !plan?.count;
  $('aiScriptScenes').textContent = '';
  $('aiScriptScenesGo').hidden = true;
  if (!r) { $('aiScriptCount').textContent = 'Type a start and an end, such as 1:30 and 12:00.'; return; }
  if (!plan.count) { $('aiScriptCount').textContent = 'No free gaps of 2 s or more here: every gap already has a block, or there’s dialogue throughout.'; return; }
  $('aiScriptCount').textContent = `About ${estimateText(estimate(plan.count, ai.models[ai.provider], ai.frames, local), P.name, local)}`;
  // Scenes: drafts go better once the story is summarised and checked.
  const scenes = scenesFor(hooks.scenes(), hooks.duration(), hooks.dialogueGaps()).filter((s) => s.end > r.from && s.start < r.to);
  const told = scenes.filter((s) => s.text.trim()).length;
  $('aiScriptScenes').textContent = told === scenes.length
    ? `All ${scenes.length} scene${scenes.length === 1 ? ' is' : 's are'} summarised. Drafts use the summaries.`
    : `${told} of ${scenes.length} scenes here are summarised. Summaries help drafts get names and the story right: ${scenes.length - told} more request${scenes.length - told === 1 ? '' : 's'}, each with ${SCENE_STILLS} stills.`;
  $('aiScriptScenesGo').hidden = told === scenes.length;
  const can = hooks.canListen(), on = can && ai.listen;
  $('aiScriptListen').disabled = !can;
  $('aiScriptListen').setAttribute('aria-pressed', String(on));
  const heard = hooks.laneHeard();
  $('aiScriptListenNote').textContent = heard ? 'The dialogue lane comes from speech to text already, so the gaps are where it heard none.'
    : !can ? 'It needs speech to text, which isn’t set up yet.'
    : on ? 'Speech to text listens to each gap first, on this computer, and marks blocks where it hears words with no subtitle. It adds a few seconds a block.'
      : 'Gaps come from the subtitles alone. Speech with no subtitle, such as a song, can end up under a draft.';
  $('aiScriptListenSetup').hidden = can || heard;
  $('aiScriptPrivacy').textContent = local ? 'Everything stays on this computer.'
    : `${ai.frames} still${ai.frames === 1 ? '' : 's'} from each gap, the nearby blocks and subtitles, and your notes go to ${P.name}.`;
}
export function openDraftScript() {
  if (!hooks.writing()) return hooks.toast('Drafting descriptions is part of Write mode');
  if (!ready()) { toggleAi(true); openAiSettings(); return; }
  if (hooks.freeGaps() == null) return hooks.toast(hooks.noLane);
  if (hooks.jobBusy()) return hooks.toast('Another job is running. Wait for it to finish, or press Stop at the top');
  if (unreachable()) return hooks.toast(`You’re offline, so ${PROVIDERS[ai.provider].name} can’t be reached`);
  $('aiScriptModel').textContent = `${PROVIDERS[ai.provider].name} · ${ai.models[ai.provider]} · ${ai.frames} still${ai.frames === 1 ? '' : 's'} a block`;
  renderScriptDlg();
  dlg().showModal();
  $('aiScriptRange').focus();
}

// ---- settings

function renderSetup() {
  const p = $('aiProvider').value || ai.provider || 'anthropic';
  const P = PROVIDERS[p];
  $('aiKeyRow').hidden = !!P.local;
  $('aiBaseRow').hidden = !P.local;
  $('aiOllamaNote').hidden = !P.local;
  $('aiOllamaWeb').hidden = !HOSTED;
  $('aiSignInRow').hidden = !P.signIn;
  $('aiKeyLink').href = P.keyUrl || '#';
  $('aiKey').placeholder = P.keyHint || '';
  $('aiKey').value = keys()[p] || '';
  $('aiBase').value = ai.base;
  $('aiRemember').checked = ai.remember;
  $('aiFrames').value = String(ai.frames);
  $('aiPace').value = String(toPace(ai.pace));
  const sel = $('aiModel'), list = ai.lists[p] || [], cur = ai.models[p] || P.defaultModel || '';
  sel.textContent = '';
  for (const m of [...new Set([cur, ...list].filter(Boolean))]) {
    const o = document.createElement('option');
    o.value = m; o.textContent = m;
    sel.append(o);
  }
  sel.value = cur;
  if (!sel.options.length) { const o = document.createElement('option'); o.value = ''; o.textContent = 'Load models first'; sel.append(o); }
  $('aiPrivacy').textContent = P.local
    ? 'Everything stays on this computer: Ollama runs the model here.'
    : `When you send a message or draft a block, the nearby blocks and frames from the video go to ${P.name}, under its terms. Don't use an online provider for programmes you mustn't share; Ollama keeps everything on this computer.`;
  $('aiForget').hidden = !keys()[p] && !(P.local && ai.provider === p);
}
function renderWho() {
  renderOffline();
  $('aiWho').textContent = ready() ? `${PROVIDERS[ai.provider].name} · ${ai.models[ai.provider]}` : 'not connected';
}
// The provider's settings are in Settings, under AI help, with the TMDB key.
export function openAiSettings() {
  $('aiProvider').value = ai.provider || 'anthropic';
  renderSetup();
  renderTmdb();
  $('setAiNotesText').value = generalNotes();
  showSettings('ai');
}
function renderTmdb() {
  const k = keys().tmdb || '';
  $('setTmdbKey').value = k;
  $('setTmdbForget').hidden = !k;
}

async function loadModels(p) {
  $('aiSetupStatus').textContent = 'Asking for models…';
  try {
    const list = await listModels(p, { key: $('aiKey').value.trim() || keys()[p], base: $('aiBase').value.trim() || ai.base });
    ai.lists[p] = list;
    if (!ai.models[p] || !list.includes(ai.models[p])) ai.models[p] = list.includes(PROVIDERS[p].defaultModel) ? PROVIDERS[p].defaultModel : (ai.models[p] || list[0]);
    save();
    renderSetup();
    // Only models that can see the frames are listed, so say why the list might be empty.
    $('aiSetupStatus').textContent = list.length ? `${list.length} model${list.length > 1 ? 's' : ''} that can see the frames`
      : PROVIDERS[p].local ? 'None of your Ollama models can see images. Download one, such as gemma4:12b (the AI guide suggests others), then Load models again.'
        : 'This provider has no models that can see images for your key.';
    return true;
  } catch (e) {
    $('aiSetupStatus').textContent = e instanceof TypeError ? `Couldn't reach ${PROVIDERS[p].name}.` : e.message;
    return false;
  }
}

async function connect() {
  const p = $('aiProvider').value;
  ai.remember = $('aiRemember').checked;
  ai.frames = +$('aiFrames').value;
  if (PROVIDERS[p].local) ai.base = $('aiBase').value.trim() || PROVIDERS.ollama.base;
  else setKey(p, $('aiKey').value.trim());
  if ($('aiModel').value) ai.models[p] = $('aiModel').value;
  ai.provider = p;
  save();
  if (!PROVIDERS[p].local && !keys()[p]) return ($('aiSetupStatus').textContent = 'Paste a key first.');
  if (await loadModels(p)) {
    renderWho();
    $('aiSetupStatus').textContent = `Connected to ${PROVIDERS[p].name}, using ${ai.models[p]}.`;
    note(`Connected to ${PROVIDERS[p].name}, using ${ai.models[p]}.`);
  }
}

// OpenRouter sign-in, in a pop-up so the open video and work stay as they are. The
// pop-up comes back to Scribecue with a code, swaps it for a key, and closes.
async function signIn() {
  const { verifier, challenge } = await pkcePair();
  keep(localStorage, PKCE, { verifier, at: Date.now() });
  const back = `${location.origin}${location.pathname}?openrouter=1`;
  const url = openRouterAuthUrl(back, challenge);
  if (!window.open(url, 'scribecue-openrouter', 'popup,width=520,height=720')) location.href = url;
  $('aiSetupStatus').textContent = 'Finish signing in in the OpenRouter window…';
}
async function finishSignIn() {
  const q = new URLSearchParams(location.search);
  if (!q.has('openrouter') || !q.get('code')) return false;
  const { verifier } = load(localStorage, PKCE);
  localStorage.removeItem(PKCE);
  window.history.replaceState(null, '', location.pathname);
  try {
    const key = await openRouterKey(q.get('code'), verifier);
    ai.provider = 'openrouter';
    setKey('openrouter', key);
    save();
    keep(localStorage, `${KEY}.signedIn`, Date.now());
    if (window.opener) { window.close(); return true; }
    toggleAi(true);
    if (await loadModels('openrouter')) { renderWho(); note(`Signed in to OpenRouter. Using ${ai.models.openrouter}; change it in Settings.`); }
  } catch (e) {
    hooks.toast(`OpenRouter sign-in didn't finish: ${e.message}`);
  }
  return true;
}

// ---- questions from other parts of the app

// Whether AI help can be asked, and who would be asked.
export const aiStatus = () => ({ ready: ready(), offline: unreachable(), name: PROVIDERS[ai.provider]?.name || '', local: !!PROVIDERS[ai.provider]?.local });
// One question on its own, outside the chat. Returns the reply's text.
export async function askAi(system, text, signal) {
  const provider = ai.provider;
  const req = buildRequest(provider, { key: keys()[provider], model: ai.models[provider], base: ai.base, system, messages: [{ role: 'user', text }] });
  const r = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal });
  if (!r.ok) throw new Error(await failure(provider, r));
  const reply = await readReply(provider, r);
  if (reply.stop === 'refusal' || (!reply.text && reply.stop)) throw new Error('the model declined to answer');
  return reply.text;
}

// ---- project notes

// The notes button says when there are notes, so it's clear they're being sent.
function showNotesState() {
  const n = hooks.notes().trim();
  $('aiNotesBtn').textContent = n ? 'Notes ✓' : 'Notes';
  $('aiNotesBtn').classList.toggle('on', !!n);
}
// Called when a project is opened or a new one started.
export function aiNotesChanged() {
  if (document.activeElement !== $('aiNotes')) $('aiNotes').value = hooks.notes();
  showNotesState();
  renderScenes();
}
function toggleNotes(show = $('aiNotesBox').hidden, scenes = false) {
  $('aiNotesBox').hidden = !show;
  if (!show) return;
  $('aiNotes').value = hooks.notes();
  renderScenes();
  if (scenes) $('aiScenes').closest('.aiscenes').scrollIntoView({ block: 'start' });
  else $('aiNotes').focus();
}

// ---- drawer

export function toggleAi(open = $('aiDrawer').hidden) {
  if (open && !document.getElementById('commentsDrawer').hidden) document.getElementById('commentsClose').click();
  if (open && document.getElementById('bookmarksDrawer')?.hidden === false) document.getElementById('bookmarksClose').click();
  $('aiDrawer').hidden = !open;
  $('aiBtn').setAttribute('aria-pressed', String(open));
  if (!open) { document.activeElement?.blur(); return; }
  renderWho();
  if (!ready()) note('To start, connect an AI provider: click Settings, above. Scribecue sends it nothing until you send a message or ask for a draft.');
  if (!$('aiLog').childElementCount) note('Ask about the scene, or select a block and click Draft this block. Drafts appear here for you to use, change or try again; nothing changes until you choose.');
  setTimeout(() => (ready() ? $('aiInput') : $('aiSettings')).focus(), 50);
}

// Looks the programme up on TMDB with the person's own key, and adds its characters to
// the notes, below what's there already.
async function lookUpForNotes() {
  const q = $('aiLookup').value.trim(), status = $('aiLookupStatus');
  const key = $('aiTmdbKey').value.trim() || keys().tmdb;
  if (!q) { status.textContent = 'Paste an IMDb link, or type the title.'; $('aiLookup').focus(); return; }
  if (!key) {
    $('aiTmdbRow').hidden = false;
    status.textContent = 'Looking up needs your own free TMDB key: get one, paste it here, then Look up.';
    $('aiTmdbKey').focus();
    return;
  }
  if (navigator.onLine === false) { status.textContent = 'You’re offline, so TMDB can’t be reached.'; return; }
  status.textContent = 'Looking it up…';
  $('aiLookupGo').disabled = true;
  try {
    const { title, text } = await lookUpCast(q, key);
    setKey('tmdb', key);
    $('aiTmdbKey').value = '';
    $('aiTmdbRow').hidden = true;
    const notes = $('aiNotes');
    notes.value = notes.value.trim() ? `${notes.value.replace(/\s+$/, '')}\n\n${text}` : text;
    notes.dispatchEvent(new Event('input'));
    notes.scrollTop = notes.scrollHeight;
    $('aiLookup').value = '';
    status.textContent = `Added the characters from ${title}. Check them, and add how to tell people apart. Not the right one? Paste its IMDb link instead.`;
  } catch (e) {
    const badKey = /key/.test(e.message);
    if (badKey) { setKey('tmdb', ''); $('aiTmdbRow').hidden = false; }
    status.textContent = e instanceof TypeError ? 'Couldn’t reach TMDB. Check your connection.' : `${e.message}.`;
  } finally {
    $('aiLookupGo').disabled = false;
  }
}

export function initAi(h) {
  hooks = { ...hooks, ...h };
  const sel = $('aiProvider');
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const o = document.createElement('option');
    o.value = id; o.textContent = p.name;
    sel.append(o);
  }
  sel.addEventListener('change', renderSetup);
  for (const [v, label] of PACES) $('aiPace').add(new Option(label, String(v)));
  $('aiPace').value = String(toPace(ai.pace));
  $('aiPace').addEventListener('change', (e) => { ai.pace = +e.target.value; save(); });
  $('aiSettings').addEventListener('click', openAiSettings);
  $('setTmdbGet').href = TMDB_KEY_PAGE;
  $('setTmdbKey').addEventListener('change', (e) => {
    setKey('tmdb', e.target.value.trim());
    renderTmdb();
    $('setTmdbStatus').textContent = e.target.value ? 'Saved.' : 'Forgotten.';
  });
  $('setTmdbForget').addEventListener('click', () => { setKey('tmdb', ''); renderTmdb(); $('setTmdbStatus').textContent = 'Forgotten.'; });
  $('setAiNotesText').value = generalNotes();
  $('setAiNotesText').addEventListener('input', (e) => { ai.notes = e.target.value; save(); });
  $('aiNotesGeneral').addEventListener('click', openAiSettings);
  $('aiNotesBtn').addEventListener('click', () => toggleNotes());
  $('aiNotes').addEventListener('input', () => { hooks.setNotes($('aiNotes').value); showNotesState(); });
  $('aiTmdbGet').href = TMDB_KEY_PAGE;
  $('aiLookupGo').addEventListener('click', lookUpForNotes);
  for (const id of ['aiLookup', 'aiTmdbKey']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lookUpForNotes(); } });
  $('aiClose').addEventListener('click', () => toggleAi(false));
  $('aiConnect').addEventListener('click', connect);
  $('aiRefresh').addEventListener('click', () => loadModels($('aiProvider').value));
  $('aiSignIn').addEventListener('click', signIn);
  $('aiForget').addEventListener('click', () => {
    const p = $('aiProvider').value;
    setKey(p, '');
    delete ai.models[p]; delete ai.lists[p];
    if (ai.provider === p) ai.provider = '';
    save(); renderSetup(); renderWho();
    $('aiSetupStatus').textContent = 'Forgotten.';
  });
  $('aiNew').addEventListener('click', () => { if (running) running.abort(); chat = []; $('aiLog').textContent = ''; note('New conversation.'); });
  $('aiDraft').addEventListener('click', () => draftBlock());
  $('aiScript').addEventListener('click', openDraftScript);
  $('aiScenesGo').addEventListener('click', () => summariseScenes());
  for (const id of ['aiScriptRange', 'aiScriptFrom', 'aiScriptTo']) $(id).addEventListener('input', renderScriptDlg);
  $('aiScriptCancel').addEventListener('click', () => dlg().close());
  $('aiScriptGo').addEventListener('click', () => {
    const r = rangeOf();
    if (!r) return;
    dlg().close();
    draftScript(r.from, r.to, hooks.canListen() && ai.listen);
  });
  $('aiScriptListen').addEventListener('click', () => { ai.listen = !ai.listen; save(); renderScriptDlg(); });
  $('aiScriptScenesGo').addEventListener('click', () => {
    const r = rangeOf();
    if (!r) return;
    dlg().close();
    summariseScenes(r.from, r.to);
  });
  $('aiScriptListenSetup').addEventListener('click', () => { dlg().close(); hooks.setUpListening(); });
  // Typing in the dialog leaves the editor's keys alone.
  dlg().addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
  $('aiSend').addEventListener('click', sendChat);
  $('aiStop').addEventListener('click', () => running?.abort());
  $('aiInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  const drawer = $('aiDrawer');
  // While typing in the drawer, the editor's own keys stay out of the way.
  drawer.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); toggleAi(false); }
  });
  // Signed in from the pop-up.
  window.addEventListener('storage', (e) => {
    if (e.key !== `${KEY}.signedIn`) return;
    Object.assign(ai, load(localStorage, KEY));
    renderSetup(); renderWho();
    loadModels('openrouter').then((ok) => ok && note(`Signed in to OpenRouter. Using ${ai.models.openrouter}; change it in Settings.`));
  });
  renderWho();
  aiNotesChanged();
  return finishSignIn();
}
