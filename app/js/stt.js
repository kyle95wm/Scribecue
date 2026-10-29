// Speech to text, for Transcribe mode: Whisper listens to the audio of each block you mark
// and fills in what the narrator says, ready to check. The timing stays yours.
//
// It runs on this computer either way: the web version downloads Whisper into the browser
// (whisper-worker.js), and the Docker version uses the optional Whisper container, under
// /stt/ on Scribecue's own server. Nothing is sent anywhere else.
import { HOSTED } from './config.js';
import { browserName, knownIssues } from './browser.js';
import { britishSpelling, defaultSpelling } from './spelling.js';

const $ = (id) => document.getElementById(id);
const KEY = 'scribecue.stt';
export const RATE = 16000; // what Whisper takes

export const stt = {
  on: false, // fill in blocks as they're marked
  engine: null, // 'web' | 'server' | null when there's none
  ready: false, // can transcribe now
  offered: null, // web: { model, bytes } the site offers
  model: '', // server: the container's model
  downloading: null, // web: { loaded, total }
  batch: null, // { done, total, stop } while transcribing every empty block
  spelling: defaultSpelling(globalThis.navigator?.language), // 'us', or 'uk' for British and Canadian
};
try {
  const o = JSON.parse(localStorage.getItem(KEY)) || {};
  stt.on = !!o.on;
  if (o.spelling === 'us' || o.spelling === 'uk') stt.spelling = o.spelling;
} catch { /* ignore */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ on: stt.on, spelling: stt.spelling })); } catch { /* ignore */ } };
// Whisper writes American spelling; this is what goes in the block.
const spelled = (text) => (stt.spelling === 'uk' ? britishSpelling(text) : text);

// Whisper's own notes for what isn't speech, such as [BLANK_AUDIO] or (music), which are
// no use in a description.
export function cleanText(s) {
  return String(s || '')
    .replace(/\[[^\]]*\]|\((?:music|applause|laughter|silence|inaudible|blank_audio|no speech)[^)]*\)|[♪♫]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 16 kHz mono float samples as a 16-bit WAV file, for the container.
export function toWav(samples, rate = RATE) {
  const dv = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); dv.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) dv.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  return new Blob([dv.buffer], { type: 'audio/wav' });
}

// The blocks to fill in: those with no text yet, in order.
export const emptyBlocks = (cues) => cues.filter((c) => !c.text.replace(/<[^>]*>|\{[^}]*\}/g, '').trim());

// ---------------------------------------------------------------- engines

let worker = null, askId = 0;
const asks = new Map();
function ask(op, data = {}, transfer = []) {
  if (!worker) {
    worker = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', ({ data: m }) => {
      if (m.op === 'progress') { stt.downloading = m; render(); return; }
      const a = asks.get(m.id);
      if (!a) return;
      asks.delete(m.id);
      if (m.ok) a.resolve(m.result); else a.reject(new Error(m.error));
    });
    worker.addEventListener('error', () => {
      for (const a of asks.values()) a.reject(new Error('Whisper didn’t start'));
      asks.clear();
      worker = null;
    });
  }
  const id = ++askId;
  return new Promise((resolve, reject) => {
    asks.set(id, { resolve, reject });
    worker.postMessage({ id, op, ...data }, transfer);
  });
}

// Finds out what's available: in the web version, whether Whisper is downloaded; in
// Docker, whether the container is running.
export async function checkStt() {
  if (HOSTED) {
    try {
      const s = await ask('status');
      Object.assign(stt, { engine: s.offered || s.ready ? 'web' : null, offered: s.offered, ready: s.ready });
    } catch { Object.assign(stt, { engine: null, ready: false }); }
  } else {
    try {
      const r = await fetch('stt/status', { cache: 'no-store' });
      const s = r.ok ? await r.json() : null;
      Object.assign(stt, { engine: s ? 'server' : null, ready: !!s, model: s?.model || '' });
    } catch { Object.assign(stt, { engine: null, ready: false }); }
  }
  render();
  return stt.ready;
}

// Whether audio is too quiet to hold any words. Whisper makes some up for silence, such
// as "you", so it isn't asked. The threshold is about −50 dBFS, well under quiet speech.
export function silent(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return !samples.length || Math.sqrt(sum / samples.length) < 0.003;
}

// The text Whisper hears in some audio (16 kHz mono).
export async function transcribe(samples) {
  if (silent(samples)) return '';
  if (stt.engine === 'web') return spelled(cleanText(await ask('transcribe', { audio: samples }, [samples.buffer])));
  const r = await fetch('stt/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: toWav(samples) });
  if (!r.ok) throw new Error(r.status === 502 || r.status === 504 ? 'the Whisper container isn’t answering' : `Whisper answered ${r.status}`);
  return spelled(cleanText((await r.json()).text));
}

// Loads the model ahead of the first block, which would otherwise wait for it.
export function warmStt() {
  if (stt.engine === 'web' && stt.ready) ask('warm').catch(() => {});
}

async function download() {
  stt.downloading = { loaded: 0, total: stt.offered?.bytes || 0 };
  render();
  navigator.storage?.persist?.().catch(() => {}); // keep it when space runs low
  try {
    await ask('download');
    stt.on = true;
    save();
    hooks.toast('Whisper downloaded. Blocks you mark with H now fill in by themselves');
  } catch (e) {
    hooks.toast(`Whisper didn’t download: ${e.message}`);
  }
  stt.downloading = null;
  await checkStt();
  warmStt();
}

async function remove() {
  if (!confirm('Remove Whisper from your browser? You can download it again later.')) return;
  await ask('remove').catch(() => {});
  await checkStt();
}

// ---------------------------------------------------------------- every empty block

// Fills in every block with no text, one at a time. hooks.batch does the work for each.
async function transcribeAll() {
  if (stt.batch) return;
  const todo = emptyBlocks(hooks.cues());
  if (!todo.length) return hooks.toast('Every block has text already');
  stt.batch = { done: 0, total: todo.length, filled: 0, stop: false };
  render();
  hooks.beforeBatch();
  try {
    for (const c of todo) {
      if (stt.batch.stop) break;
      if (await hooks.fill(c)) stt.batch.filled++;
      stt.batch.done++;
      render();
    }
    const { filled, done, total } = stt.batch;
    hooks.toast(`${stt.batch.stop ? `Stopped after ${done} of ${total}. ` : ''}Filled in ${filled} block${filled === 1 ? '' : 's'}. Check them as you go; ⌘Z undoes it`);
  } catch (e) {
    hooks.toast(`Transcribing stopped: ${e.message}`);
  } finally {
    stt.batch = null;
    render();
  }
}

// ---------------------------------------------------------------- the panel

const mb = (bytes) => `${Math.round(bytes / 1e6)} MB`;
function render() {
  if (!$('sttDlg')?.open) return;
  const usable = !!stt.engine;
  $('sttOn').checked = stt.on;
  $('sttSpelling').value = stt.spelling;
  $('sttOn').disabled = !stt.ready;
  const name = browserName(navigator.userAgent, navigator.userAgentData?.brands || []);
  $('sttBrowser').hidden = !knownIssues(name).some((t) => t.startsWith('speech to text'));
  $('sttBrowser').textContent = `In ${name}, the video’s sound can stutter or stop while blocks are transcribed. Speech to text works best in Chrome or Edge.`;
  $('sttWeb').hidden = !HOSTED;
  $('sttServer').hidden = HOSTED;
  if (HOSTED) {
    const d = stt.downloading;
    $('sttGet').hidden = stt.ready || !!d || !stt.offered;
    $('sttRemove').hidden = !stt.ready || !!d;
    $('sttBar').hidden = !d;
    if (d) $('sttBar').value = d.total ? d.loaded / d.total : 0;
    $('sttWebStatus').textContent = d ? `Downloading… ${mb(d.loaded)} of ${mb(d.total)}`
      : stt.ready ? 'Downloaded, and works offline'
        : stt.offered ? `${mb(stt.offered.bytes)} to download` : 'Not available offline until it’s downloaded';
  } else {
    $('sttServerStatus').textContent = stt.ready
      ? `The Whisper container is running, with the ${stt.model} model.`
      : 'The Whisper container isn’t running. To add it, put whisper in COMPOSE_PROFILES in your .env file and run docker compose up -d --build (see INSTALL.md).';
    $('sttServerStatus').classList.toggle('warnbox', !stt.ready);
  }
  const b = stt.batch;
  $('sttAll').disabled = !stt.ready || !!b;
  $('sttAllStop').hidden = !b;
  $('sttAllBar').hidden = !b;
  if (b) $('sttAllBar').value = b.total ? b.done / b.total : 0;
  $('sttAllStatus').textContent = b ? `${b.done} of ${b.total}` : usable && stt.ready ? `${emptyBlocks(hooks.cues()).length} empty` : '';
}

export function openStt() {
  const d = $('sttDlg');
  if (!d.open) d.showModal();
  render();
  checkStt();
}

let hooks = { toast: () => {}, cues: () => [], fill: async () => false, beforeBatch: () => {}, changed: () => {}, transcribing: () => true };
export function initStt(h) {
  hooks = { ...hooks, ...h };
  const d = $('sttDlg');
  $('sttClose').addEventListener('click', () => d.close());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  document.addEventListener('keydown', (e) => { if (d.open) e.stopPropagation(); }, true); // keep the editor's keys from firing behind it
  $('sttOn').addEventListener('change', () => { stt.on = $('sttOn').checked; save(); hooks.changed(); if (stt.on) warmStt(); });
  $('sttSpelling').addEventListener('change', (e) => { stt.spelling = e.target.value; save(); });
  $('sttGet').addEventListener('click', download);
  $('sttRemove').addEventListener('click', remove);
  $('sttAll').addEventListener('click', transcribeAll);
  $('sttAllStop').addEventListener('click', () => { if (stt.batch) stt.batch.stop = true; });
  checkStt().then((ok) => { if (ok && stt.on && hooks.transcribing()) warmStt(); hooks.changed(); });
}
