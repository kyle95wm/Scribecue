// The AI help drawer: settings for the person's AI provider, a chat about the scene, and
// "Draft this block". The requests themselves are built in ai.js.
import {
  PROVIDERS, buildRequest, recentFrames, systemWith, readReply, failure, listModels, fitBudget, draftPrompt, chatContext,
  pkcePair, openRouterAuthUrl, openRouterKey,
} from './ai.js';
import { tts, chosenVoice, DEFAULT_CPS } from './tts.js';
import { HOSTED } from './config.js';

const $ = (id) => document.getElementById(id);
const KEY = 'scribecue.ai', KEYS = 'scribecue.ai.keys', PKCE = 'scribecue.ai.pkce';
const load = (store, k) => { try { return JSON.parse(store.getItem(k)) || {}; } catch { return {}; } };
const keep = (store, k, v) => { try { store.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

// { provider, models: { provider: model }, lists: { provider: [models] }, base, frames, remember }
const ai = { provider: '', models: {}, lists: {}, base: PROVIDERS.ollama.base, frames: 3, remember: true, ...load(localStorage, KEY) };
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
const save = () => { const { provider, models, lists, base, frames, remember } = ai; keep(localStorage, KEY, { provider, models, lists, base, frames, remember }); };

const ready = () => !!ai.provider && !!ai.models[ai.provider] && (PROVIDERS[ai.provider]?.local || !!keys()[ai.provider]);

let hooks = {
  cues: () => [], selIndex: () => -1, playhead: () => 0, video: () => null, apply: () => {}, toast: () => {}, writing: () => true,
  notes: () => '', setNotes: () => {},
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
// Stills from the video at these times, from a hidden copy so the playhead stays put.
async function grabFrames(times) {
  const v = hooks.video();
  if (!v?.currentSrc || !v.videoWidth || !times.length) return [];
  if (!grabber || grabber.src !== v.currentSrc) {
    grabber = document.createElement('video');
    grabber.muted = true;
    grabber.preload = 'auto';
    grabber.src = v.currentSrc;
    await once(grabber, 'loadeddata', 10000);
  }
  const w = Math.min(768, grabber.videoWidth), h = Math.round(w * grabber.videoHeight / grabber.videoWidth);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const out = [];
  for (const at of times) {
    grabber.currentTime = Math.max(0, Math.min(at, (grabber.duration || at + 1) - 0.05));
    await once(grabber, 'seeked', 5000);
    cv.getContext('2d').drawImage(grabber, 0, 0, w, h);
    const url = cv.toDataURL('image/jpeg', 0.75);
    out.push({ at, url, data: url.slice(url.indexOf(',') + 1) });
  }
  return out;
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
// block it's for, which adds buttons to use the reply.
async function send(msg, shown, frames, draft = null) {
  if (!ready()) { openSettings(); return note('Connect a provider first, in the settings above.'); }
  if (running) return;
  if (unreachable()) return renderOffline();
  bubble('user', shown, frames);
  const turn = { role: 'user', text: msg, images: frames.map(({ data, at }) => ({ data, at })) };
  const provider = ai.provider, model = ai.models[provider];
  const req = buildRequest(provider, { key: keys()[provider], model, base: ai.base, system: systemWith(hooks.notes()), messages: recentFrames([...chat, turn]) });
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
    if (draft && reply.text.trim()) addDraftButtons(out, draft, reply.text.trim().replace(/^["“]|["”]$/g, ''));
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
  use.textContent = `Use for block #${draft.n}`;
  use.addEventListener('click', () => {
    if (hooks.apply(draft.id, text)) { use.disabled = true; use.textContent = 'Used ✓'; }
  });
  const again = document.createElement('button');
  again.textContent = 'Try again';
  again.addEventListener('click', () => draftBlock(draft.id, 'Write a different version.'));
  acts.append(use, again);
  out.append(acts);
}

async function draftBlock(id = null, extra = '') {
  if (!hooks.writing()) return hooks.toast('Drafting descriptions is part of Write mode');
  const cues = hooks.cues();
  const i = id == null ? hooks.selIndex() : cues.findIndex((c) => c.id === id);
  if (i < 0) return note('Select the block to draft first: click it in the list or on the timeline.');
  const c = cues[i];
  // What a block can hold depends on the voice and the block's speed.
  const budget = fitBudget(c.end - c.start, tts.cps[chosenVoice()] || DEFAULT_CPS, c.speed ?? tts.speed);
  let frames = [];
  try { frames = await grabFrames(framesFor(c.start, c.end, ai.frames)); } catch (e) { note(`No frames: ${e.message}.`); }
  const prompt = draftPrompt(cues, i, budget, frames.map((f) => f.at)) + (extra ? `\n${extra}` : '');
  await send(prompt, `Draft block #${i + 1}${extra ? ` · ${extra}` : ''}`, frames, { id: c.id, n: i + 1 });
}

async function sendChat() {
  const text = $('aiInput').value.trim();
  if (!text || running) return;
  $('aiInput').value = '';
  let frames = [];
  if ($('aiFrame').checked) {
    try { frames = await grabFrames([hooks.playhead()]); } catch (e) { note(`No frame: ${e.message}.`); }
  }
  const ctx = chatContext(hooks.cues(), hooks.selIndex(), hooks.playhead());
  await send(`${ctx}\n\n${text}`, text, frames);
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
function openSettings(show = true) {
  $('aiSetup').hidden = !show;
  if (show) { $('aiProvider').value = ai.provider || 'anthropic'; renderSetup(); }
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
    openSettings(false);
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
    if (await loadModels('openrouter')) { renderWho(); openSettings(false); note(`Signed in to OpenRouter. Using ${ai.models.openrouter}; change it in Settings.`); }
  } catch (e) {
    hooks.toast(`OpenRouter sign-in didn't finish: ${e.message}`);
  }
  return true;
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
}
function toggleNotes(show = $('aiNotesBox').hidden) {
  $('aiNotesBox').hidden = !show;
  if (show) { $('aiSetup').hidden = true; $('aiNotes').value = hooks.notes(); $('aiNotes').focus(); }
}

// ---- drawer

export function toggleAi(open = $('aiDrawer').hidden) {
  $('aiDrawer').hidden = !open;
  $('aiBtn').classList.toggle('on', open);
  if (!open) { document.activeElement?.blur(); return; }
  renderWho();
  if (!ready()) openSettings(true);
  if (!$('aiLog').childElementCount) note('Ask about the scene, or select a block and click Draft this block. Drafts appear here for you to use, change or try again; nothing changes until you choose.');
  setTimeout(() => (ready() ? $('aiInput') : $('aiProvider')).focus(), 50);
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
  $('aiSettings').addEventListener('click', () => { $('aiNotesBox').hidden = true; openSettings($('aiSetup').hidden); });
  $('aiNotesBtn').addEventListener('click', () => toggleNotes());
  $('aiNotes').addEventListener('input', () => { hooks.setNotes($('aiNotes').value); showNotesState(); });
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
