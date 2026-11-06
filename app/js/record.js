// Record mode: the narrator records each line against the video, keeps every take, and
// exports the chosen ones as one WAV for the mixer. The script is locked (app.js sees to
// that); this file does the recording. The guide is Guides/RECORDING.md.

import { drawLevel, sizeMeter, showLoudest } from './levelmeter.js';
import { slots, prevEnd, narrationTimeline, peakTrail, peakDb, judgePeak, dbText, runsOver, checkExport, exportReport, recordingId, placeTake, looksBluetooth, narrationNote, takeAt, nextTake, punchIn, PUNCH_MIN, pieces, placed, clampEdit, splitAt, cutPart, trimSilence, fitSlot, startAtBlock, snap, flatten, wavePeaks, clipAt, relink, takesKey, pickedUp, originalTake, checkPickups, checkAlts, isAlt, markerLabel, fromRecordingFile, asRecordingFile, DRIFT, PREROLL, RATE } from './recording.js';
import { storeZip } from './zip.js';
import { blockToHold, stillHeard, pauseList } from './extended.js';
import { fmtTime } from './formats.js';
import { to24, from24, wav24, buildBwf, WAV24_HEADER } from './bwf.js';
import { listTakes, saveTake, chooseTake, editTake, deleteTake, restoreTake, takeAudio, takesWhere, relinkTakes, moveTakes, openSession, useSession, currentSession,
  rememberedSession, rememberSession, browserFolder, canUseFolders, canKeepInBrowser, sessionFolder, unpackSession, forgetBrowserFolder } from './takestore.js';
import { SESSION_EXT } from './session.js';
import { picker } from './pickers.js';

const $ = (id) => document.getElementById(id);
const VIDEO_DB = -30; // the video's sound while recording, so the scene can still be followed
const LEAD = [3, 4, 5];
const LEVEL_WORDS = { good: 'in the pocket', note: 'fine', quiet: 'very quiet', loud: 'too loud: retake it' };
const get = (k) => { try { return localStorage.getItem('scribecue.rec.' + k); } catch { return null; } };
const put = (k, v) => { try { if (v == null) localStorage.removeItem('scribecue.rec.' + k); else localStorage.setItem('scribecue.rec.' + k, v); } catch { /* storage blocked */ } };

// h: { video, toast, blocks(), selIdx(), select(i), seek(t), baseName(), volume(on), app }
export function initRecord(h) {
  const { video } = h;
  const el = { go: $('recGo'), status: $('recStatus'), meter: $('recMeter'), fill: $('recSlotFill'), slot: $('recSlot'),
    dev: $('recDev'), lead: $('recLead'), sync: $('recSync'), test: $('recTest'), flash: $('recFlash'), takes: $('recTakes'),
    punch: $('recPunch'), count: $('recCount'), dlg: $('recExportDlg'), report: $('recReport'), go2: $('recExportGo'), title: $('recExportTitle'),
    sw: $('edAltSw'), where: $('recSession') };

  let rec = null;            // the recording file open: { id, start, fps, media, project?, version? }; id is where its takes are kept
  let takes = [];            // every take of this recording
  let state = 'idle';        // idle | arming | lead | rec | saving
  let cap = null;            // { stream, ctx, node, chunks, trail, t0, slot, prevEnd, block, inLatency, punch, from }
  let level = 0, hold = 0;   // meter: current and held peak, 0…1
  let loudest = 0;           // the loudest peak since a check started or was reset, 0…1
  let raf = 0, playing = null, warned = new Set();
  let leadSecs = LEAD.includes(+get('lead')) ? +get('lead') : 3;
  let syncMs = get('sync') != null ? +get('sync') : null; // null: use the browser's figure
  let wasPlaying = false;
  let where = 'browser';     // where takes are kept: 'folder' or 'browser' (a session), or 'docker'
  let keep = 'none';         // the session: ready | choose (no folder yet) | paused (the browser asks again) | moving
  let paused = null;         // the folder the browser asks about again, while paused
  let raw = null;            // the recording file as it was opened, kept in the session
  let editing = null;        // the take open in the list to fine-tune, always the chosen one: { id }
  let side = false;          // the Alt switch: true works on the selected block's alt, its wording and takes
  let drafts = {};           // alt wording typed for each block of this recording, by altKey; kept in the browser

  el.lead.value = leadSecs;
  el.sync.value = syncMs ?? '';
  const sl = () => slots(h.blocks());
  // a: the block's alt rather than the original.
  const blockTakes = (i, a = false) => takes.filter((t) => t.block === i && isAlt(t) === a).sort((x, z) => x.made - z.made);
  const chosenFor = (i, a = false) => takes.find((t) => t.block === i && t.chosen && isAlt(t) === a) || null;
  // Takes of a line that's since been reworded: in no block, shown under the one in their place.
  const oldTakes = (i, a = false) => {
    const b = h.blocks()[i];
    return takes.filter((t) => t.block < 0 && isAlt(t) === a && t.line && Math.min(t.line.end, b.end) > Math.max(t.line.start, b.start)).sort((x, z) => x.made - z.made);
  };
  // The take heard, shown and edited on the timeline for each block: with Alt on, its alt's
  // where it has one.
  const shownFor = (i) => (side && chosenFor(i, true)) || chosenFor(i);
  // All of them, in one pass over the takes: it's asked for on every frame while playing.
  const shownTakes = () => {
    const alt = side ? new Set(takes.filter((t) => t.chosen && isAlt(t)).map((t) => t.block)) : null;
    return takes.filter((t) => t.chosen && (isAlt(t) ? side : !alt?.has(t.block)));
  };
  // The alt's wording: as typed, else as last recorded, else the block's own to start from.
  const altKey = (b) => `${b.start}|${b.text.replace(/\s+/g, ' ').trim()}`;
  const altText = (i) => {
    const b = h.blocks()[i];
    return drafts[altKey(b)] ?? blockTakes(i, true).at(-1)?.alt ?? b.text;
  };
  // The wording to show over the video for block i: its alt's, with Alt on and one written.
  const altWording = (i) => {
    const b = h.blocks()[i];
    return side && b && (chosenFor(i, true) || altText(i) !== b.text) ? altText(i) : null;
  };
  const altCount = () => h.blocks().filter((_, i) => chosenFor(i, true)).length;
  const version = () => rec?.version || 0;
  const pickups = () => h.blocks().flatMap((b, i) => (b.pickup ? [i] : []));

  // ---- panel
  function status(msg) { el.status.textContent = msg; }
  function render() {
    h.redraw();
    if (editing && !takeOf(editing.id)?.chosen) editing = null; // another take was picked
    const busy = state !== 'idle';
    el.go.textContent = busy ? '■ Stop' : '● Record';
    el.go.classList.toggle('on', busy);
    el.go.disabled = state === 'arming' || state === 'saving';
    el.punch.disabled = busy;
    const i = h.selIdx(), n = h.blocks().length;
    const done = h.blocks().filter((_, k) => chosenFor(k)).length;
    const pk = pickups(), pd = pk.filter((k) => pickedUp(chosenFor(k), version())).length;
    const alts = altCount();
    el.count.textContent = rec ? `${done} of ${n} blocks have a take` + (pk.length ? ` · ${pd} of ${pk.length} pickups recorded` : '') + (alts ? ` · ${alts} alt${alts === 1 ? '' : 's'}` : '') : '';
    // Original | Alt, in the block editor: not while recording.
    el.sw.classList.toggle('alt', side);
    for (const b of el.sw.children) {
      const on = (b.dataset.side === 'alt') === side;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.disabled = busy;
    }
    $('recLinkRow').hidden = !rec?.project;
    $('recMoveRow').hidden = !rec || keep !== 'ready' || currentSession()?.where !== 'browser' || !canUseFolders();
    $('recMove').disabled = busy;
    const sn = currentSession()?.name;
    el.count.dataset.tip = where === 'folder' ? `Takes are kept in ${sn}, a folder you can copy to another computer`
      : where === 'docker' ? 'Takes are kept in Docker, on this computer'
      : currentSession() ? (canUseFolders() ? 'Takes are kept in this browser. Move them to a folder, under Microphone, lead-in and sync, to copy them to another computer'
        : 'Takes are kept in this browser. Export a session package to move them to another computer, or before clearing its data')
      : 'Takes are kept in this browser. Clearing its data for Scribecue loses them';
    el.where.hidden = !rec || (keep !== 'choose' && keep !== 'paused');
    el.where.textContent = keep === 'paused' ? `Resume in ${paused?.name}` : 'Choose where to keep takes';
    el.where.dataset.tip = keep === 'paused' ? `The browser asks again before Scribecue may keep takes in ${paused?.name}. Click to resume` : 'Choose a folder for this recording’s takes';
    el.takes.replaceChildren();
    const note = (text) => { const li = document.createElement('li'); li.className = 'dim'; li.textContent = text; el.takes.append(li); };
    if (i < 0) return note('Select a block to record it.');
    const slot = sl()[i];
    const list = blockTakes(i, side), b = h.blocks()[i];
    const orig = b.pickup && !side ? originalTake(list, oldTakes(i), version()) : null;
    const origTag = () => { const o = document.createElement('span'); o.className = 'num dim'; o.textContent = 'original'; return o; };
    if (b.pickup && !side) {
      // What the script's writer asked for, and whether it's been recorded since.
      const li = document.createElement('li'), tag = document.createElement('span'), done = pickedUp(chosenFor(i), version());
      tag.className = 'lvl ' + (done ? 'good' : 'quiet');
      tag.textContent = done ? 'Pickup recorded' : 'Pickup';
      li.append(tag);
      const why = b.pickup.note || (b.pickup.added ? 'A new line' : b.pickup.was != null ? 'Reworded' : '');
      if (why) li.append(why);
      // Both, one after the other, each from just before the block.
      if (done && orig) {
        const cmp = document.createElement('button');
        cmp.textContent = playing?.cmp ? 'Stop' : 'Compare';
        cmp.dataset.tip = 'Play the original take, then the pickup';
        cmp.addEventListener('click', () => (playing?.cmp ? stopPlay() : compare(orig, chosenFor(i))));
        li.append(cmp);
      }
      el.takes.append(li);
      if (b.pickup.was != null) { const w = document.createElement('li'); w.className = 'dim'; w.textContent = `Was: “${b.pickup.was}”`; el.takes.append(w); }
    }
    // An alt read before its wording was changed again: the take says what it was read as.
    const read = side && chosenFor(i, true);
    if (read && read.alt !== altText(i)) note(`The alt in the export was read as “${read.alt}”. Record it again to match the new wording.`);
    const what = side ? 'alt take' : 'take';
    if (busy && cap?.block === i && cap.slot.hold) note(`Recording ${what} ${list.length + 1} of block ${i + 1}. Read it when the video stops, then press Enter.`);
    else if (busy && cap?.block === i) note(cap.punch ? `Punching in: ${what} ${list.length + 1} of block ${i + 1}, from ${what} ${list.findIndex((t) => t.id === cap.punch.base.id) + 1}.` : `Recording ${what} ${list.length + 1} of block ${i + 1}.`);
    else if (!list.length && side) note(`Block ${i + 1} has no alt yet. Type your wording in the block and press Enter, then Enter or R to record it. Press A to go back to the original.`);
    else if (!list.length) note(`Block ${i + 1} has no takes yet. Press Enter or R to record it.` + (rec?.project && !takes.length ? ' Takes from an older recording file can be brought in, under Microphone, lead-in and sync.' : ''));
    list.forEach((t, k) => {
      const li = document.createElement('li');
      const j = judgePeak(t.peak), pt = placed(t), over = runsOver(pt, slot);
      li.className = 'take' + (over ? ' over' : '');
      // The take that goes into the export: one per block, like a radio button.
      const use = document.createElement('button');
      use.className = 'use';
      use.textContent = t.chosen ? 'In export' : 'Use';
      use.setAttribute('aria-pressed', String(!!t.chosen));
      use.setAttribute('aria-label', `Use ${what} ${k + 1} in the export`);
      use.addEventListener('click', async () => { if (!t.chosen) { await chooseTake(rec.id, t.id); await reload(); } });
      const name = document.createElement('span');
      name.textContent = `${side ? 'Alt take' : 'Take'} ${k + 1}`;
      if (side && t.alt !== altText(i)) name.dataset.tip = `Read as “${t.alt}”`;
      const len = document.createElement('span');
      len.className = 'num';
      len.textContent = `${pt.duration.toFixed(2)} s`;
      const lvl = document.createElement('span');
      lvl.className = 'lvl ' + j;
      lvl.textContent = `${dbText(t.peak)}, ${LEVEL_WORDS[j]}`;
      li.append(use, name, len, lvl);
      if (t === orig) li.append(origTag());
      if (t.punch != null) { const j2 = document.createElement('span'); j2.className = 'num dim'; j2.textContent = `joined at ${(t.punch - t.start).toFixed(2)} s`; li.append(j2); }
      if (over) { const o = document.createElement('span'); o.className = 'lvl loud'; o.textContent = 'runs past its slot'; li.append(o); }
      const play = document.createElement('button');
      play.textContent = playing?.t.id === t.id ? 'Stop' : 'Play';
      play.addEventListener('click', () => (playing?.t.id === t.id ? stopPlay() : playTake(t)));
      // Only the take in the export, as on the timeline: the same edits, by the millisecond.
      const ed = document.createElement('button');
      ed.textContent = 'Fine-tune';
      ed.dataset.tip = 'Move, trim or split this take by the millisecond, from the keyboard';
      ed.setAttribute('aria-expanded', String(editing?.id === t.id));
      ed.setAttribute('aria-label', `Fine-tune take ${k + 1}`);
      ed.hidden = !t.chosen;
      ed.addEventListener('click', () => { editing = editing?.id === t.id ? null : { id: t.id }; render(); });
      const del = document.createElement('button');
      del.textContent = 'Delete'; del.setAttribute('aria-label', `Delete ${what} ${k + 1}`);
      del.addEventListener('click', () => remove(t, `${what} ${k + 1} of block ${i + 1}`, () => {
        // Another take takes its place in the export, if this one was chosen.
        const left = blockTakes(i, isAlt(t)).filter((x) => x.id !== t.id);
        return t.chosen && left.length ? chooseTake(rec.id, left[left.length - 1].id) : null;
      }));
      li.append(play, ed, del);
      el.takes.append(li);
      if (editing?.id === t.id) el.takes.append(editor(t, i));
    });
    oldTakes(i, side).forEach((t, k) => {
      const li = document.createElement('li');
      li.className = 'take';
      const name = document.createElement('span');
      name.textContent = `Old take ${k + 1}`;
      name.dataset.tip = `Read as “${t.line.text}”. It can’t go into the export, since the line has changed`;
      const tag = document.createElement('span');
      tag.className = 'num';
      tag.textContent = 'old wording';
      const play = document.createElement('button');
      play.textContent = playing?.t.id === t.id ? 'Stop' : 'Play';
      play.addEventListener('click', () => (playing?.t.id === t.id ? stopPlay() : playTake(t)));
      const del = document.createElement('button');
      del.textContent = 'Delete'; del.setAttribute('aria-label', `Delete old take ${k + 1}`);
      del.addEventListener('click', () => remove(t, `old take ${k + 1} of block ${i + 1}`));
      li.append(name, tag);
      if (t === orig) li.append(origTag());
      li.append(play, del);
      el.takes.append(li);
    });
  }
  // Deletes a take. In a session it can be brought back until the recording closes, so it
  // doesn't ask first; elsewhere it's gone for good. what: how to name it, such as "take 2
  // of block 5". then: anything to do after, such as choosing another take.
  let deleted = []; // in a session: [{ id, chosen, what }], the latest last
  async function remove(t, what, then = () => null) {
    const undoable = !!currentSession();
    if (!undoable && !confirm(`Delete ${what}? This can’t be undone.`)) return;
    stopPlay();
    try { await deleteTake(rec.id, t.id); await then(); } catch (e) { h.toast(`Couldn’t delete ${what}: ${e.message}`); }
    await reload();
    if (!undoable) return;
    deleted.push({ id: t.id, chosen: t.chosen, what });
    h.toast(`Deleted ${what}. Undo: ⌘Z`, undoDelete);
  }
  // Brings back the take deleted last: false if there's none.
  async function undoDelete() {
    const d = rec && state === 'idle' && deleted.pop();
    if (!d) return false;
    try {
      if (!await restoreTake(rec.id, d.id)) throw new Error('it isn’t there any more');
      if (d.chosen) await chooseTake(rec.id, d.id);
    } catch (e) { h.toast(`Couldn’t bring back ${d.what}: ${e.message}`); return true; }
    await reload();
    h.toast(`Brought back ${d.what}`);
    return true;
  }

  // match: put takes with the blocks of this version of the script (see relink), as when
  // it's opened. A recording from before projects has only one script, so its takes just
  // get their lines.
  async function reload(match = false) {
    takes = rec && keep === 'ready' ? await listTakes(rec.id).catch(() => []) : [];
    if (rec && match) {
      const changes = relink(takes, h.blocks(), rec.project ? null : h.blocks());
      try { await relinkTakes(rec.id, changes); } catch (e) { h.toast(`Couldn’t match the takes to this script: ${e.message}`); }
      const by = new Map(changes.map((c) => [c.id, c]));
      takes = takes.map((t) => (by.has(t.id) ? { ...t, ...by.get(t.id) } : t));
    }
    for (const id of peakCache.keys()) if (!takeOf(id)) peakCache.delete(id);
    for (const id of fineCache.keys()) if (!takeOf(id)) fineCache.delete(id);
    if (pick && !takeOf(pick.id)) pick = null;
    render();
  }

  // ---- editing a take: split it, move the parts and trim their ends, against the slot.
  // The chosen takes are clips on the take track, under the timeline's lane (see drawTrack);
  // Fine-tune in the list does the same in milliseconds, from the keyboard.
  const prevEndOf = (i) => prevEnd(sl(), i);
  const takeOf = (id) => takes.find((t) => t.id === id) || null;
  let pick = null;           // the part of a take last clicked: { id, part }
  // Keeps an edit and shows it everywhere: false if it couldn't be kept.
  async function applyEdit(t, next) {
    const e = clampEdit(t, next, prevEndOf(t.block)), was = t.edit;
    t.edit = e; // shown straight away, so a dropped clip stays where it was dropped
    h.redraw();
    try { await editTake(rec.id, t.id, e); } catch (err) {
      t.edit = was; render();
      h.toast(`Couldn’t keep the edit: ${err.message}`);
      return false;
    }
    silence();
    render();
    return true;
  }
  // The recording itself, for Trim silence: only the last take asked for is kept.
  let held = null;           // { id, pcm }
  async function pcmOf(t) {
    if (held?.id !== t.id) held = { id: t.id, pcm: from24(new Uint8Array(await (await takeAudio(t)).arrayBuffer()).subarray(WAV24_HEADER)) };
    return held.pcm;
  }
  // The part still there nearest part k, since parts can be deleted.
  const nearPart = (t, k) => pieces(t).reduce((a, p) => (Math.abs(p.part - k) < Math.abs(a - k) ? p.part : a), Infinity);
  const pickedPart = (t) => nearPart(t, pick?.id === t.id ? pick.part : 0);
  // What the take menu, the keys and the editor's buttons do. Each gives the new edit, or null.
  const edits = {
    split(t) {
      const n = splitAt(t, video.currentTime);
      if (!n) { h.toast('Put the playhead inside the take, away from the ends of its parts, to split it'); return null; }
      const p = pieces(t).find((q) => video.currentTime > q.start && video.currentTime < q.start + q.duration);
      pick = { id: t.id, part: p.part + 1 };
      return n;
    },
    cut(t) {
      const n = cutPart(t, pickedPart(t));
      if (!n) { h.toast('A take keeps one part at least. Delete the take instead'); return null; }
      pick = { id: t.id, part: nearPart({ ...t, edit: n }, pickedPart(t)) };
      return n;
    },
    async silence(t) {
      try { return trimSilence(t, await pcmOf(t)); } catch (err) { h.toast(`Couldn’t read the take: ${err.message}`); return null; }
    },
    start: (t) => startAtBlock(t, sl()[t.block], prevEndOf(t.block)),
    fit: (t) => fitSlot(t, sl()[t.block], prevEndOf(t.block)),
    reset(t) { pick = { id: t.id, part: 0 }; return { splits: [], parts: [{}] }; },
  };
  async function doEdit(t, what) {
    const n = await edits[what](t);
    if (n) await applyEdit(t, n);
  }
  // The take X and Delete work on: the one open in the editor, else the one last clicked,
  // else the block's chosen take.
  function keyTake() {
    const i = h.selIdx(), mine = (t) => (t?.block === i ? t : null);
    return mine(editing && takeOf(editing.id)) || mine(pick && takeOf(pick.id)) || shownFor(i);
  }

  const MS = (v) => String(Math.round(v * 1000));
  function editor(t, i) {
    const li = document.createElement('li');
    li.className = 'takeedit';
    const slot = sl()[i], e = clampEdit(t, t.edit, prevEndOf(i)), ps = pieces(t), k = pickedPart(t), q = e.parts[k];
    const field = (label, key, tip) => {
      const l = document.createElement('label');
      l.dataset.tip = tip;
      const inp = document.createElement('input');
      inp.type = 'number'; inp.step = '10'; inp.dataset.edit = key; inp.value = MS(q[key]);
      inp.addEventListener('change', async () => {
        const n = parseFloat(inp.value);
        await applyEdit(t, { splits: e.splits, parts: e.parts.map((p, j) => (j === k ? { ...p, [key]: Number.isFinite(n) ? n / 1000 : 0 } : p)) });
        el.takes.querySelector(`[data-edit="${key}"]`)?.focus();
      });
      l.append(`${label} `, inp, ' ms');
      return l;
    };
    const btn = (text, tip, fn) => { const b = document.createElement('button'); b.textContent = text; b.dataset.tip = tip; b.addEventListener('click', fn); return b; };
    const which = document.createElement('span');
    which.className = 'num';
    const row = document.createElement('div');
    row.className = 'recrow';
    if (ps.length > 1) {
      const at = ps.findIndex((p) => p.part === k);
      which.textContent = `Part ${at + 1} of ${ps.length}:`;
      row.append(which, btn('Next part', 'Work on the next part of the take', () => { pick = { id: t.id, part: ps[(at + 1) % ps.length].part }; render(); }));
    }
    const cutBtn = btn('Delete part', 'Delete this part (Delete). Drag the end of the part beside it to bring its sound back', () => doEdit(t, 'cut'));
    cutBtn.disabled = ps.length < 2;
    row.append(field('Move', 'shift', 'Move this part: below 0 earlier, above 0 later'),
      field('Trim start', 'head', 'Cut this much off the start of this part. Below 0 brings back the sound before it'),
      field('Trim end', 'tail', 'Cut this much off the end of this part. Below 0 brings back the sound after it'),
      btn('Split', 'Split the take at the playhead, to move its parts apart or closer together (X)', () => doEdit(t, 'split')), cutBtn,
      btn('Trim silence', 'Cut the quiet off both ends of every part, keeping a moment of it', () => doEdit(t, 'silence')),
      btn('Start at block', 'Move the take so its sound starts where the block does', () => doEdit(t, 'start')),
      btn('Fit in slot', 'Trim the end so the take stops where its slot does', () => doEdit(t, 'fit')),
      btn('Reset', 'Undo the splits, moves and trims: the take as recorded', () => doEdit(t, 'reset')));
    const end = placed(t), over = runsOver(end, slot);
    const say = document.createElement('span');
    say.textContent = over ? `Ends ${(end.start + end.duration - slot.end).toFixed(2)} s past its slot` : 'Fits its slot';
    say.className = 'num ' + (over ? 'lvl loud' : 'dim');
    li.append(row, say);
    return li;
  }

  // ---- the take track: each block's chosen take as clips, under the video's lane. Drag a
  // clip to move it and its ends to trim it; double-click plays it; right-click for the rest.
  const PR = 200;            // waveform columns per second of a take
  const SHOW_WAVE = 12;      // pixels per second, at least, to draw takes' waveforms
  const track = $('takeTrack'), menu = $('clipMenu');
  const peakCache = new Map(); // take id → Float32Array, PR a second; null if unreadable
  // Zoomed in past PR, takes on screen get a close-up at FINE a second, for placing them
  // precisely. Only the last few are kept: they're ten times the size.
  const FINE = 2000, FINE_KEEP = 16;
  const fineCache = new Map(); // take id → Float32Array, FINE a second
  const peakWant = new Map();  // takes on screen whose waveform isn't read yet → whether close up
  let peakBusy = false;
  let view = { t0: 0, pps: 100 }; // as last drawn
  let tdrag = null;          // { t, k, mode, x0, e0, e, moved, snapped }
  // One take at a time, and only those on screen, so a long film's takes aren't all read.
  function loadPeaks() {
    if (peakBusy) return;
    const [id, fine] = peakWant.entries().next().value || [], t = id && takeOf(id);
    if (!t) return;
    peakWant.delete(id);
    peakBusy = true;
    takeAudio(t).then((w) => w.arrayBuffer()).then((b) => {
      const pcm = from24(new Uint8Array(b).subarray(WAV24_HEADER)), secs = pcm.length / RATE;
      if (!peakCache.has(id)) peakCache.set(id, wavePeaks(pcm, Math.max(1, Math.round(secs * PR))));
      if (fine) {
        fineCache.set(id, wavePeaks(pcm, Math.max(1, Math.round(secs * FINE))));
        for (const k of fineCache.keys()) if (fineCache.size > FINE_KEEP) fineCache.delete(k);
      }
    }, () => peakCache.set(id, null)).finally(() => { peakBusy = false; h.redraw(); });
  }
  let TK = null;
  // g: the track's canvas, already sized; t0 and pps: the timeline's view.
  function drawTrack(g, W, H, t0, pps) {
    view = { t0, pps };
    peakWant.clear();
    if (!rec) return;
    TK ||= Object.fromEntries(['ok', 'bad', 'play', 'line', 'dim', 'faint', 'accent', 'accent-bg', 'cue', 'cue-bg', 'text', 'mono'].map((n) => [n, tok('--' + n)]));
    const t1 = t0 + W / pps, x = (s) => (s - t0) * pps, mid = H / 2, sel = h.selIdx(), amp = mid - 9;
    g.fillStyle = TK.line;
    g.fillRect(0, Math.round(mid), W, 1);
    g.font = `10px ${TK.mono}`;
    const live = state === 'rec' && cap?.trail;
    if (!takes.length && !live) { g.fillStyle = TK.dim; g.fillText('Takes show here as you record them', 8, 16); return; }
    sl().forEach((slot, i) => {
      const slotEnd = slot.hold ? slot.mark : slot.end;
      const raw = shownFor(i), slotIn = slotEnd > t0 && slot.start < t1;
      const t = raw && tdrag?.t.id === raw.id ? { ...raw, edit: tdrag.e } : raw;
      const whole = t && placed(t), over = t && runsOver(whole, slot);
      if (slotIn) {
        g.fillStyle = `color-mix(in srgb, ${TK.ok} 10%, transparent)`;
        g.fillRect(x(slot.start), 0, x(slotEnd) - x(slot.start), H);
        g.fillStyle = over ? TK.bad : TK.ok;
        g.fillRect(x(slotEnd) - 1, 0, 2, H);
      }
      if (!t || whole.start > t1 || whole.start + whole.duration < t0) return;
      const wave = pps >= SHOW_WAVE, fine = pps > PR && peakCache.get(t.id) !== null;
      if (wave && !peakCache.has(t.id) || fine && !fineCache.has(t.id)) peakWant.set(t.id, fine);
      const close = fine && fineCache.get(t.id), rate = close ? FINE : PR;
      const pk = close || (wave ? peakCache.get(t.id) : null), on = i === sel, ps = pieces(t);
      const n = blockTakes(i, isAlt(t)).findIndex((q) => q.id === t.id) + 1, word = isAlt(t) ? 'Alt' : 'Take';
      ps.forEach((p, j) => {
        const a = x(p.start), z = x(p.start + p.duration);
        if (z < 0 || a > W) return;
        const picked = pick?.id === t.id && pick.part === p.part;
        g.beginPath();
        g.roundRect(a, 6, z - a, H - 12, 4);
        g.fillStyle = on ? TK['accent-bg'] : TK['cue-bg'];
        g.fill();
        g.strokeStyle = on ? TK.accent : TK.cue;
        g.lineWidth = picked ? 2 : 1;
        g.setLineDash(isAlt(t) ? [4, 3] : []); // an alt's clips are dashed
        g.stroke();
        g.setLineDash([]);
        const from = Math.max(0, Math.floor(a)), to = Math.min(W, Math.ceil(z));
        if (!pk) { g.fillStyle = TK.faint; g.fillRect(from, mid - 0.5, to - from, 1); }
        else {
          let last = '';
          for (let px = from; px < to; px++) {
            const s = t0 + px / pps, off = p.head + s - p.start;
            const i0 = Math.max(0, Math.floor(off * rate)), i1 = Math.min(pk.length, Math.max(i0 + 1, Math.floor((off + 1 / pps) * rate)));
            let m = 0;
            for (let k = i0; k < i1; k++) if (pk[k] > m) m = pk[k];
            const fill = s > slot.end ? TK.bad : on ? TK.accent : TK.dim;
            if (fill !== last) g.fillStyle = last = fill;
            const hh = Math.max(0.5, Math.min(1, m * 2) * amp);
            g.fillRect(px, mid - hh, 1, hh * 2);
          }
        }
        // The longest label that fits: "Take 2 · 1/2", "Take 2", or none ("Alt 2" for an alt's).
        const label = [ps.length > 1 ? `${word} ${n} · ${j + 1}/${ps.length}` : '', `${word} ${n}`].find((s) => s && g.measureText(s).width + 12 <= z - Math.max(a, 0));
        if (label) { g.fillStyle = on ? TK.accent : TK.cue; g.fillText(label, Math.max(a, 0) + 6, 17); }
      });
    });
    if (live) drawLive(g, W, H, x, mid, amp);
    if (tdrag?.snapped != null) { g.fillStyle = TK.text; g.fillRect(x(tdrag.snapped) - 1, 0, 2, H); }
    loadPeaks();
  }
  // The take being recorded, growing with the playhead, where it will be placed when it's saved.
  function drawLive(g, W, H, x, mid, amp) {
    const d = delayOf(cap), first = Math.max(0, cap.t0 - d), pk = cap.trail.peaks;
    const held = cap.heldAt ? (performance.now() - cap.heldAt) / 1000 : 0;
    const a = x(placeTake({ t0: cap.t0, delay: d, prevEnd: cap.prevEnd }).start), z = Math.max(a, x(video.currentTime + held - d));
    if (z < 0 || a > W) return;
    g.beginPath();
    g.roundRect(a, 6, z - a, H - 12, 4);
    g.fillStyle = `color-mix(in srgb, ${TK.play} 14%, transparent)`;
    g.fill();
    g.strokeStyle = TK.play;
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = TK.play;
    for (let px = Math.max(0, Math.floor(a)), to = Math.min(W, Math.ceil(z)); px < to; px++) {
      const s = view.t0 + px / view.pps - first, i0 = Math.max(0, Math.floor(s * PR)), i1 = Math.min(pk.length, Math.max(i0 + 1, Math.floor((s + 1 / view.pps) * PR)));
      if (i0 >= pk.length) break; // not heard yet
      let m = 0;
      for (let k = i0; k < i1; k++) if (pk[k] > m) m = pk[k];
      const hh = Math.max(0.5, Math.min(1, m * 2) * amp);
      g.fillRect(px, mid - hh, 1, hh * 2);
    }
    if (g.measureText('Recording').width + 12 <= z - Math.max(a, 0)) g.fillText('Recording', Math.max(a, 0) + 6, 17);
  }

  // A take of an extended block can lie under the blocks after it: those are on top.
  const hitAt = (px) => clipAt(shownTakes().sort((a, z) => z.block - a.block), view.t0 + px / view.pps, view.pps);
  const pxOf = (ev) => ev.clientX - track.getBoundingClientRect().left;
  const grab = (on) => { h.select(on.t.block); pick = { id: on.t.id, part: on.k }; render(); };
  track.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || !rec) return;
    ev.preventDefault();
    const px = pxOf(ev), on = state === 'idle' ? hitAt(px) : null;
    if (!on) { pick = null; h.seek(view.t0 + px / view.pps); render(); return; }
    grab(on);
    const e0 = clampEdit(on.t, on.t.edit, prevEndOf(on.t.block));
    tdrag = { ...on, x0: ev.clientX, e0, e: e0, moved: false, snapped: null };
    track.setPointerCapture(ev.pointerId);
  });
  track.addEventListener('pointermove', (ev) => {
    if (!tdrag) {
      const on = rec && state === 'idle' ? hitAt(pxOf(ev)) : null;
      track.style.cursor = !on ? '' : on.mode === 'shift' ? 'grab' : 'ew-resize';
      return;
    }
    const dx = ev.clientX - tdrag.x0;
    if (!tdrag.moved && Math.abs(dx) < 3) return;
    if (!tdrag.moved) {
      tdrag.moved = true;
      document.body.classList.add('dragging');
      if (tdrag.mode !== 'shift') document.body.classList.add('resize');
    }
    const { t, k, e0, mode } = tdrag, slot = sl()[t.block];
    // Edges snap to the block's start and the slot's end, the playhead, and the other parts.
    const all = pieces({ ...t, edit: e0 }), p0 = all.find((p) => p.part === k);
    const a0 = p0.start, z0 = p0.start + p0.duration, tol = 8 / view.pps;
    const targets = [slot.start, slot.end, video.currentTime, ...all.filter((p) => p !== p0).flatMap((p) => [p.start, p.start + p.duration])];
    let d = dx / view.pps;
    tdrag.snapped = null;
    const pull = (edge) => { const s = snap(edge + d, targets, tol); if (s !== edge + d) { d = s - edge; tdrag.snapped = s; } return tdrag.snapped != null; };
    if (mode === 'head') pull(a0);
    else if (mode === 'tail') pull(z0);
    else if (!pull(a0)) pull(z0);
    const o = e0.parts[k];
    const patch = mode === 'head' ? { head: o.head + d } : mode === 'tail' ? { tail: o.tail - d } : { shift: o.shift + d };
    tdrag.e = clampEdit(t, { splits: e0.splits, parts: e0.parts.map((p, j) => (j === k ? { ...p, ...patch } : p)) }, prevEndOf(t.block));
    const w = placed({ ...t, edit: tdrag.e });
    status(runsOver(w, slot) ? `Ends ${(w.start + w.duration - slot.end).toFixed(2)} s past its slot` : 'Fits its slot');
    h.redraw();
  });
  const drop = async () => {
    const d = tdrag;
    if (!d) return;
    tdrag = null;
    document.body.classList.remove('dragging', 'resize');
    if (d.moved) await applyEdit(d.t, d.e);
    h.redraw();
  };
  track.addEventListener('pointerup', drop);
  track.addEventListener('pointercancel', drop);
  track.addEventListener('dblclick', (ev) => {
    const on = rec && state === 'idle' ? hitAt(pxOf(ev)) : null;
    if (on) playTake(on.t);
  });
  track.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    const on = rec && state === 'idle' ? hitAt(pxOf(ev)) : null;
    if (!on) return;
    grab(on);
    menu.querySelector('[data-clip=cut]').disabled = pieces(on.t).length < 2;
    menu.hidden = false;
    // Above the pointer, since the track is at the bottom of the window.
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(ev.clientX, innerWidth - r.width - 8)) + 'px';
    menu.style.top = Math.max(8, ev.clientY - r.height) + 'px';
    menu.querySelector('[role=menuitem]:not(:disabled)').focus();
  });
  menu.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-clip]'), t = pick && takeOf(pick.id);
    if (!b) return;
    menu.hidden = true;
    if (!t) return;
    if (b.dataset.clip === 'play') playTake(t); else doEdit(t, b.dataset.clip);
  });

  // ---- devices
  async function devices() {
    try {
      const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications');
      const was = get('dev') || '';
      el.dev.replaceChildren(new Option('Default microphone', ''), ...all.filter((d) => d.deviceId && d.deviceId !== 'default').map((d, i) => new Option(d.label || `Microphone ${i + 1}`, d.deviceId)));
      el.dev.value = [...el.dev.options].some((o) => o.value === was) ? was : '';
    } catch { /* no devices to list */ }
  }
  el.dev.addEventListener('change', () => put('dev', el.dev.value || null));
  el.lead.addEventListener('change', () => { leadSecs = +el.lead.value; put('lead', leadSecs); });
  el.sync.addEventListener('change', () => {
    const v = parseInt(el.sync.value, 10);
    syncMs = Number.isFinite(v) ? Math.max(-500, Math.min(1000, v)) : null;
    el.sync.value = syncMs ?? '';
    put('sync', syncMs);
  });

  // ---- recording
  async function arm() {
    const base = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 };
    const id = el.dev.value;
    // Made first, while the key or click that started recording still counts as the
    // narrator's: Safari won't start sound otherwise, and resume() then never settles.
    const ctx = new AudioContext({ sampleRate: RATE, latencyHint: 'interactive' });
    const started = ctx.resume();
    let stream;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: id ? { ...base, deviceId: { exact: id } } : base });
      } catch (e) {
        if (id && e.name === 'OverconstrainedError') stream = await navigator.mediaDevices.getUserMedia({ audio: base });
        else throw e;
      }
      await Promise.race([started, new Promise((ok) => setTimeout(ok, 3000))]);
      if (ctx.state !== 'running') throw new Error('the browser didn’t let Scribecue start sound. Click Record to try again');
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
      throw e;
    }
    await ctx.audioWorklet.addModule('js/rec-worklet.js');
    const node = new AudioWorkletNode(ctx, 'rec-capture', { numberOfInputs: 1, numberOfOutputs: 1 });
    const mute = ctx.createGain();
    mute.gain.value = 0; // the narrator hears themselves through their interface, never through here
    ctx.createMediaStreamSource(stream).connect(node);
    node.connect(mute).connect(ctx.destination);
    const settings = stream.getAudioTracks()[0]?.getSettings?.() || {};
    cap = { stream, ctx, node, chunks: [], inLatency: settings.latency || 0, outLatency: (ctx.outputLatency || 0) };
    node.port.onmessage = (e) => {
      if (e.data.peak != null) { level = Math.max(level, e.data.peak); loudest = Math.max(loudest, e.data.peak); }
      if (e.data.pcm && cap) { cap.chunks.push(e.data.pcm); cap.trail?.add(e.data.pcm); }
      if (e.data.done) cap.finish?.();
    };
    devices();
    // What's worth saying about this setup: the sample rate it converts from, if any, and
    // whether the headphones look like Bluetooth.
    const out = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).find((d) => d.kind === 'audiooutput' && d.deviceId === 'default');
    return {
      rate: settings.sampleRate && settings.sampleRate !== RATE ? settings.sampleRate : 0,
      bluetooth: syncMs == null && looksBluetooth(out?.label, cap.outLatency),
    };
  }
  function warn({ rate, bluetooth }) {
    if (rate && !warned.has('rate')) {
      warned.add('rate');
      h.toast(`Your microphone runs at ${rate} Hz, so Scribecue converts it to 48 kHz. Setting your audio interface to 48 kHz avoids that`);
    }
    if (bluetooth && !warned.has('bt')) {
      warned.add('bt');
      h.toast('These headphones look like Bluetooth, which delays sound. Use wired headphones, or set the sync test below');
    }
  }
  function disarm() {
    if (!cap) return;
    cap.stream.getTracks().forEach((t) => t.stop());
    cap.ctx.close().catch(() => {});
    cap = null;
  }

  // punch: pick up the block's chosen take from the playhead, rather than record it afresh.
  async function begin(punch = false) {
    if (keep !== 'ready') {
      if (keep === 'choose') askWhere();
      return h.toast(keep === 'paused' ? `Click Resume in ${paused?.name} first, so Scribecue can keep the takes there`
        : keep === 'moving' ? 'Wait a moment: the takes are being moved' : 'Choose where to keep the takes first');
    }
    const i = h.selIdx();
    if (i < 0) return h.toast('Select a block, then record it');
    if (!h.hasVideo()) return h.toast('Open the video first');
    const s = sl()[i];
    if (punch && s.hold) return h.toast(`Block ${i + 1} is extended, so it’s read in one go. Press Enter to record it again`);
    // An alt needs wording of its own first.
    const alt = side ? altText(i).trim() : null, b = h.blocks()[i];
    if (side && (!alt || alt.replace(/\s+/g, ' ') === b.text.replace(/\s+/g, ' ').trim())) {
      h.altChanged(true);
      return h.toast('Write the alt’s wording first: it needs to differ from the block');
    }
    let p = null;
    if (punch) {
      const base = chosenFor(i, side), at = video.currentTime;
      if (!base) return h.toast(`Block ${i + 1} has no ${side ? 'alt take' : 'take'} to pick up from. Press Enter to record it`);
      if (side && base.alt !== alt) return h.toast('The alt’s wording has changed since that take. Press Enter to record it again');
      if (at < placed(base).start + PUNCH_MIN || at >= s.end) return h.toast(`Put the playhead where you want to pick up, inside block ${i + 1}’s take, then press Shift+Enter`);
      p = { base, at, ps: pieces(base), on: null };
    }
    const from = video.currentTime; // where Esc puts the playhead back
    stopPlay();
    state = 'arming'; status('Getting the microphone…'); render();
    if (check) stopCheck();
    try { warn(await arm()); } catch (e) {
      state = 'idle'; disarm(); status(''); render();
      return h.toast(e.name === 'NotAllowedError' ? 'Scribecue needs permission to use the microphone' : `Couldn’t use the microphone: ${e.message}`);
    }
    if (p) {
      // The earlier take plays in the lead-in, up to the join, so the narrator can match it.
      try { p.wav = await takeAudio(p.base); } catch (e) {
        state = 'idle'; disarm(); status(''); render();
        return h.toast(`Couldn’t get the take to pick up from: ${e.message}`);
      }
      p.audio = new Audio(URL.createObjectURL(p.wav));
    }
    cap.block = i; cap.slot = s; cap.prevEnd = prevEndOf(i); cap.punch = p; cap.alt = alt; cap.from = from;
    cap.trail = peakTrail(RATE / PR);
    cap.t0 = Math.max(0, (p ? p.at : s.start) - PREROLL);
    h.seek(Math.max(0, cap.t0 - leadSecs));
    h.volume(true, VIDEO_DB);
    wasPlaying = true;
    video.play().catch(() => {});
    state = 'lead'; render();
    loop();
  }

  function loop() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (!cap) return frame(); // stopped since this frame was asked for
      if (state === 'lead' && video.currentTime >= cap.t0) {
        cap.node.port.postMessage('start');
        state = 'rec';
      }
      const p = cap.punch;
      if (p) {
        p.on = follow(p.audio, p.ps, video.currentTime, p.on, p.at);
      }
      if (state === 'lead') status(p ? `Picks up in ${Math.max(0, p.at - video.currentTime).toFixed(1)} s` : `Starts in ${Math.ceil(Math.max(0, cap.slot.start - video.currentTime))} s: set your level`);
      if (state === 'rec' && cap.slot.hold) {
        // The video stops at the block, and the take runs as long as the reading does.
        if (!cap.heldAt && video.currentTime >= cap.slot.start) { video.pause(); cap.heldAt = performance.now(); }
        status(cap.heldAt ? 'Read it now' : `Starts in ${Math.ceil(Math.max(0, cap.slot.start - video.currentTime))}`);
        h.redraw();
      } else if (state === 'rec') {
        const left = cap.slot.end - video.currentTime;
        status(left >= 0 ? `Recording: ${left.toFixed(1)} s left in the slot` : `Recording: ${(-left).toFixed(1)} s over the slot`);
        const f = (video.currentTime - cap.slot.start) / (cap.slot.end - cap.slot.start);
        el.fill.style.width = Math.max(0, Math.min(1, f)) * 100 + '%';
        el.slot.classList.toggle('over', f > 1);
        if (video.ended) { finish(); return; }
        h.redraw(); // the take grows on the timeline
      }
      frame();
      if (state === 'lead' || state === 'rec') loop();
    });
  }

  // The sound reaches the narrator late and reaches Scribecue late: a take is placed that much earlier.
  const delayOf = (c) => c.inLatency + (syncMs != null ? syncMs / 1000 : c.outLatency);

  // discard: stop without keeping the take (Esc). In a session it's kept as deleted, so
  // ⌘Z can bring it back until the recording closes.
  async function finish(discard = false) {
    if (state !== 'lead' && state !== 'rec') return;
    const c = cap, wasRec = state === 'rec';
    state = 'saving'; status('Saving the take…'); render();
    video.pause();
    if (discard) h.seek(c.from);
    h.volume(false);
    if (c.punch) { c.punch.audio.pause(); URL.revokeObjectURL(c.punch.audio.src); }
    const samples = await new Promise((ok) => {
      if (!wasRec) return ok(new Float32Array(0));
      c.finish = () => {
        const n = c.chunks.reduce((a, x) => a + x.length, 0), all = new Float32Array(n);
        let o = 0;
        for (const x of c.chunks) { all.set(x, o); o += x.length; }
        ok(all);
      };
      c.node.port.postMessage('stop');
    });
    disarm();
    level = 0; frame(); el.fill.style.width = '0'; el.slot.classList.remove('over');
    if (samples.length < RATE * 0.3) { state = 'idle'; status(wasRec ? 'Too short to keep: nothing saved' : c.punch ? 'Stopped before the join: nothing saved' : 'Stopped before the block: nothing saved'); render(); return; }
    // The sound reaches the narrator late and reaches Scribecue late: take both off.
    const delay = delayOf(c);
    const { start, skip } = placeTake({ t0: c.t0, delay, prevEnd: c.prevEnd });
    let kept = samples.subarray(skip), at = start;
    if (c.punch) {
      const whole = from24(new Uint8Array(await c.punch.wav.arrayBuffer()).subarray(WAV24_HEADER));
      ({ start: at, pcm: kept } = punchIn(flatten(c.punch.base, whole), { start, pcm: kept }, c.punch.at));
    }
    const b = h.blocks()[c.block];
    const take = { id: crypto.randomUUID(), rec: rec.id, block: c.block, start: at, duration: kept.length / RATE,
      peak: peakDb(kept), made: Date.now(), wav: wav24(to24(kept), RATE), ...(c.punch && { punch: c.punch.at }),
      line: { start: b.start, end: b.end, text: b.text }, ver: version(), ...(c.alt != null && { alt: c.alt }) };
    const what = c.alt != null ? 'the alt take' : 'the take';
    if (discard && !currentSession()) { state = 'idle'; status(`Discarded ${what}`); render(); return; }
    try {
      await saveTake(take, !discard);
      if (discard) await deleteTake(rec.id, take.id);
    } catch (e) {
      state = 'idle'; render();
      return h.toast(`Couldn’t keep the take: ${e.message}` + (where === 'browser' ? '. The browser’s storage may be full' : ''));
    }
    state = 'idle';
    await reload();
    if (discard) {
      deleted.push({ id: take.id, chosen: true, what });
      status(`Discarded ${what}`);
      return h.toast(`Discarded ${what}. Undo: ⌘Z`, undoDelete);
    }
    const j = judgePeak(take.peak);
    status(`Saved ${c.alt != null ? 'alt take' : 'take'} ${blockTakes(c.block, c.alt != null).length}: ${dbText(take.peak)}, ${LEVEL_WORDS[j]}`);
    if (j === 'loud') h.toast('That take is too loud. Lower your gain and record it again: the export won’t go ahead with it');
  }

  const toggle = () => {
    if (!rec) return;
    if (state === 'idle') begin(); else finish();
  };
  const punch = () => {
    if (!rec) return;
    if (state === 'idle') begin(true); else finish();
  };
  // ---- Original | Alt in the block editor: the selected block's alt, with wording of the
  // narrator's own, typed in the block's text box (app.js sees to that).
  function setSide(on) {
    if (!rec || state !== 'idle' || on === side) return;
    side = on;
    editing = null; pick = null;
    silence();
    render();
    h.retext();
    h.altChanged(side);
  }
  el.sw.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { b.blur(); setSide(b.dataset.side === 'alt'); } });
  function setAltText(i, text) {
    const b = h.blocks()[i];
    if (!rec || !b) return;
    drafts[altKey(b)] = text;
    put(`alts.${rec.id}`, JSON.stringify(drafts));
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => currentSession()?.setDrafts({ ...drafts }).catch(() => {}), 500);
    render();
    h.retext();
  }

  el.go.addEventListener('click', toggle);
  el.punch.addEventListener('click', punch);

  // ---- where the takes are kept: the recording's session (see session.js). Chrome and Edge
  // keep it in a folder the narrator chooses; other browsers in their own storage.
  let draftTimer = 0;
  const sd = { dlg: $('recSessionDlg'), intro: $('recSessionIntro'), old: $('recSessionOld') };
  let answer = null; // resolves the dialog: a folder, 'browser', or null
  let sub = '';      // the name of a new folder for the session, inside one with other files
  // Asks where to keep a session: resolves to { dir, where }, or null if cancelled. old: how
  // many takes kept before sessions will move in. intro: the dialog's first line.
  function chooseWhere({ old = 0, from = 'browser', intro = 'Choose a folder for this recording. Each take is saved there as you record it.', sub: name = '' } = {}) {
    sd.intro.textContent = intro;
    sub = `${name || h.baseName() || 'Recording'} session`;
    sd.old.hidden = !old;
    sd.old.textContent = `The ${old} take${old === 1 ? '' : 's'} kept ${from === 'docker' ? 'in Docker' : 'in this browser'} for this recording will move there.`;
    $('recSessionBrowser').hidden = !canKeepInBrowser();
    answer?.(null);
    return new Promise((ok) => { answer = ok; sd.dlg.showModal(); });
  }
  const settle = (v) => { const a = answer; answer = null; if (sd.dlg.open) sd.dlg.close(); a?.(v); };
  sd.dlg.addEventListener('close', () => settle(null));
  $('recSessionBrowser').addEventListener('click', () => settle('browser'));
  $('recSessionPick').addEventListener('click', async () => {
    let dir;
    try { dir = await picker('folder'); } catch { return; }
    try { settle(await sessionFolder(dir, sub)); } catch (e) { h.toast(`Couldn’t use ${dir.name}: ${e.message}`); }
  });

  async function askWhere() {
    const r = rec;
    const old = (await listTakes(r.id).catch(() => [])).length, from = await takesWhere();
    if (rec !== r) return;
    const got = await chooseWhere({ old, from });
    if (rec !== r) return;
    if (!got) return render();
    await start(got === 'browser' ? await browserFolder(r.id) : got, got === 'browser' ? 'browser' : 'folder');
  }
  // Finds the recording's session: the folder it used last, else asks.
  async function attach() {
    const r = rec;
    useSession(null); keep = 'choose'; paused = null;
    const kept = await rememberedSession(r.id);
    if (rec !== r) return;
    if (kept === 'browser' && canKeepInBrowser()) return start(await browserFolder(r.id), 'browser');
    if (kept?.kind === 'directory') {
      let p = 'denied';
      try { p = await kept.queryPermission({ mode: 'readwrite' }); } catch { /* gone */ }
      if (rec !== r) return;
      if (p === 'granted') return start(kept, 'folder');
      keep = 'paused'; paused = kept; render();
      return;
    }
    if (canUseFolders()) { render(); return askWhere(); }
    if (canKeepInBrowser()) return start(await browserFolder(r.id), 'browser');
    keep = 'ready'; // the browser's IndexedDB, as before sessions
    await reload(true);
  }
  async function start(dir, at) {
    const r = rec;
    keep = 'moving'; render();
    let s;
    try { s = await openSession(dir, { key: r.id, recording: raw, where: at, app: h.app }); } catch (e) {
      if (rec !== r) return;
      keep = 'choose'; render();
      return h.toast(`Couldn’t keep takes in ${dir.name}: ${e.message}`);
    }
    if (rec !== r) return;
    useSession(s); where = at;
    rememberSession(r.id, at === 'browser' ? 'browser' : dir);
    if (Object.keys(s.drafts).length) drafts = { ...drafts, ...s.drafts };
    if (Object.keys(drafts).length) s.setDrafts({ ...drafts }).catch(() => {});
    try {
      const n = await s.adopt(r.id, (k, of) => status(`Moving takes into ${at === 'folder' ? s.name : 'this recording’s session'}: ${k} of ${of}…`));
      if (n) h.toast(`Moved ${n} take${n === 1 ? '' : 's'} into ${at === 'folder' ? s.name : 'this recording’s session'}`);
    } catch (e) { h.toast(`Couldn’t move the takes kept before: ${e.message}. They’re still where they were`); }
    if (rec !== r) return;
    status('');
    if (s.found) h.toast(`Found ${s.found} take${s.found === 1 ? '' : 's'} in ${s.name} that weren’t listed, and kept ${s.found === 1 ? 'it' : 'them'}`);
    if (s.missing) h.toast(`${s.missing} take${s.missing === 1 ? '' : 's'} listed in ${s.name} ${s.missing === 1 ? 'has' : 'have'} no WAV file there any more`);
    keep = 'ready';
    await reload(true);
  }
  el.where.addEventListener('click', async () => {
    if (!rec) return;
    if (keep === 'choose') return askWhere();
    if (keep !== 'paused') return;
    let p = 'denied';
    try { p = await paused.requestPermission({ mode: 'readwrite' }); } catch { /* gone */ }
    if (p === 'granted') return start(paused, 'folder');
    h.toast(`Scribecue can’t keep takes in ${paused.name} without your permission`);
  });

  // Moves a session kept in the browser to a folder the narrator chooses. The browser's copy
  // is deleted only once the folder's session has opened with every take.
  $('recMove').addEventListener('click', async () => {
    const s = currentSession(), r = rec;
    if (!r || !s || s.where !== 'browser' || state !== 'idle' || keep !== 'ready') return;
    let dir;
    try { dir = await picker('folder'); } catch { return; }
    stopPlay(); silence();
    keep = 'moving'; render();
    let moved = null;
    try {
      dir = await sessionFolder(dir, `${h.baseName() || 'Recording'} session`);
      const files = await s.files(), n = files.length - 1;
      await unpackSession(dir, files, (done, total) => status(`Moving takes to ${dir.name}: ${Math.round((done / total) * 100)}%…`));
      moved = await openSession(dir, { key: r.id, recording: raw, where: 'folder', app: h.app });
      if ((await moved.list(r.id)).length < n) throw new Error('not every take arrived');
    } catch (e) {
      if (rec === r) { keep = 'ready'; status(''); render(); }
      return h.toast(`Couldn’t move the takes to ${dir.name}: ${e.message}. They’re still in this browser`);
    }
    await rememberSession(r.id, dir);
    try { await forgetBrowserFolder(r.id); } catch { /* the folder has them: the browser's copy can be cleared in Settings */ }
    if (rec !== r) return;
    useSession(moved); where = 'folder'; keep = 'ready'; status('');
    await reload();
    h.toast(`Moved the takes to ${dir.name}. New takes are saved there too`);
  });

  // The session as one file, to move it to another computer: a zip of its folder.
  // Every take, or only those in the export: the chosen ones, and the take each pickup
  // replaced, so Compare still works on the other computer.
  const pack = { dlg: $('recPackDlg'), all: $('recPackAll'), chosen: $('recPackChosen') };
  const chosenIds = () => {
    const ids = new Set(takes.filter((t) => t.chosen).map((t) => t.id));
    for (const i of pickups()) { const o = originalTake(blockTakes(i), oldTakes(i), version()); if (o) ids.add(o.id); }
    return ids;
  };
  const mb = (list) => `${Math.max(1, Math.round(list.reduce((n, t) => n + (t.size || 0), 0) / 1e6))} MB`;
  const takesText = (n) => `${n} take${n === 1 ? '' : 's'}`;
  function exportSession() {
    if (!rec || state !== 'idle') return;
    if (!currentSession()) return h.toast(keep === 'ready' ? 'This browser keeps takes where they can’t be packaged. Use Chrome or Edge, or Firefox' : 'Choose where to keep the takes first');
    const ids = chosenIds(), some = takes.filter((t) => ids.has(t.id));
    if (some.length === takes.length) return packSession(null);
    pack.all.textContent = `${takesText(takes.length)}, ${mb(takes)}. Everything, as in the folder.`;
    pack.chosen.textContent = `${takesText(some.length)}, ${mb(some)}. The ones in the export, and the take each pickup replaced.`;
    pack.dlg.showModal();
    pack.dlg.querySelector('[data-choice="all"]').focus();
  }
  for (const b of pack.dlg.querySelectorAll('.wzchoice')) {
    b.addEventListener('click', () => { pack.dlg.close(); packSession(b.dataset.choice === 'chosen' ? chosenIds() : null); });
  }
  $('recPackCancel').addEventListener('click', () => pack.dlg.close());
  // only: the ids of the takes to package, or null for all.
  async function packSession(only) {
    const s = currentSession();
    if (!rec || !s || state !== 'idle') return;
    const name = `${h.baseName() || 'Recording'}${SESSION_EXT}`;
    let fh = null;
    if (window.showSaveFilePicker) {
      try { fh = await picker('session', { suggestedName: name }); }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    state = 'saving'; render();
    try {
      status('Packaging the session…');
      const files = await s.files(only);
      const zip = await storeZip(files, { progress: (d, t) => status(`Packaging the session: ${Math.round((d / t) * 100)}%…`) });
      if (fh) {
        const w = await fh.createWritable(), CH = 16 << 20;
        try {
          for (let at = 0; at < zip.size; at += CH) {
            await w.write(zip.slice(at, at + CH));
            status(`Saving the session package: ${Math.round((Math.min(zip.size, at + CH) / zip.size) * 100)}%…`);
          }
          await w.close();
        } catch (e) { await w.abort().catch(() => {}); throw e; }
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(zip); a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 60e3);
      }
      const n = files.length - 1;
      h.toast(`Saved ${fh?.name || name}: ${n} take${n === 1 ? '' : 's'}, ${Math.max(1, Math.round(zip.size / 1e6))} MB. Open it in Scribecue to carry on, on any computer`);
    } catch (e) { h.toast(`Couldn’t package the session: ${e.message}`); }
    finally { status(''); state = 'idle'; render(); }
  }

  const css = getComputedStyle(document.documentElement), tok = (n) => css.getPropertyValue(n).trim();

  // ---- meters: the one under the video, and a check's, while there is one
  function frame() {
    hold = Math.max(level, hold * 0.97);
    drawLevel(el.meter, level, hold);
    if (check) {
      drawLevel(check.meter, level, hold, { vertical: check.vertical, scale: true });
      showLoudest(check.out, loudest);
    }
    level *= 0.85;
  }

  // ---- playing a take back, against the video where it was read
  // Plays the recording in an <audio> in step with the video, part by part, until `until`.
  // on: the part playing, or null; returns the part playing now.
  function follow(audio, ps, now, on, until = Infinity) {
    const here = now < until ? takeAt(ps, now) : null;
    if (here && on !== here.take.key) { audio.currentTime = here.take.head + here.from; audio.play().catch(() => {}); return here.take.key; }
    if (!here && on) audio.pause();
    return here ? on : null;
  }
  // then: what to do when it plays to the end, rather than stop.
  async function playTake(raw, then = null, cmp = null) {
    stopPlay();
    const t = placed(raw), ps = pieces(raw), held = sl()[raw.block]?.hold;
    let wav;
    try { wav = await takeAudio(t); } catch (e) { return h.toast(`Couldn’t play the take: ${e.message}`); }
    const audio = new Audio(URL.createObjectURL(wav));
    playing = { t, audio, on: null, then, cmp };
    h.volume(false);
    h.seek(Math.max(0, t.start - 2));
    video.play().catch(() => {});
    render();
    // An extended block's take plays with the video stopped, on a clock of its own.
    let stoppedAt = 0;
    const when = () => (stoppedAt ? t.start + (performance.now() - stoppedAt) / 1000 : video.currentTime);
    const tick = () => {
      if (!playing) return;
      if (held && !stoppedAt && video.currentTime >= t.start) { video.pause(); stoppedAt = performance.now(); }
      playing.on = follow(audio, ps, when(), playing.on);
      const on = stoppedAt ? video.paused : !video.paused;
      if (!on || when() >= t.start + t.duration) {
        const next = on && playing.then;
        if (next) next(); else stopPlay();
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  }
  const compare = (orig, pick) => playTake(orig, () => playTake(pick, null, 'pickup'), 'original');
  function stopPlay() {
    if (!playing) return;
    playing.audio.pause();
    URL.revokeObjectURL(playing.audio.src);
    playing = null;
    video.pause();
    render();
  }

  // ---- hearing the chosen takes as the video plays, each where it was read. Only the take
  // playing and the next are decoded, so a long film never sits in memory.
  let hear = get('hear') !== '0';
  // id: the part playing (its key); tid: its take's; queued: the next part, already started on the audio clock.
  const pb = { ctx: null, gain: null, src: null, id: null, tid: null, queued: null, at: 0, from: 0, rate: 1, raf: 0, bufs: new Map() };
  const stops = (t) => !!sl()[t.block]?.hold;
  const chosenList = () => shownTakes().filter((t) => !stops(t)).flatMap(pieces).sort((a, z) => a.start - z.start);
  // An extended block's take, as the video plays: it stops there while the take plays.
  // pb.hold: { take, timer } while it does; pb.heard: its block, so it doesn't stop again.
  async function holdFor(t) {
    const hold = pb.hold = { take: t };
    pb.heard = t.block;
    video.pause();
    buffer(t);
    const buf = await pb.bufs.get(t.id);
    if (pb.hold !== hold) return;
    const ps = pieces(t), first = ps[0].start, at = pb.ctx.currentTime + 0.02;
    hold.srcs = buf ? ps.map((p) => {
      const src = pb.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(pb.gain);
      src.start(at + p.start - first, p.head, p.duration);
      return src;
    }) : [];
    const z = ps[ps.length - 1], secs = buf ? z.start + z.duration - first : 0;
    hold.timer = setTimeout(() => {
      if (pb.hold !== hold) return;
      endHold();
      video.play().catch(() => {});
    }, secs * 1000);
  }
  function endHold() {
    const hold = pb.hold;
    if (!hold) return;
    pb.hold = null;
    clearTimeout(hold.timer);
    for (const src of hold.srcs || []) stopSrc(src);
  }
  // Made on a key press or click: Safari won't play sound otherwise.
  const wake = () => {
    if (!rec || !hear) return;
    if (!pb.ctx) {
      pb.ctx = new AudioContext({ latencyHint: 'interactive' });
      pb.gain = pb.ctx.createGain();
      pb.gain.connect(pb.ctx.destination);
    }
    if (pb.ctx.state === 'suspended') pb.ctx.resume().catch(() => {});
  };
  document.addEventListener('keydown', wake, true);
  document.addEventListener('pointerdown', wake, true);

  const stopSrc = (src) => { try { src.stop(); } catch { /* not started */ } src.disconnect(); };
  function silence() {
    if (pb.src) stopSrc(pb.src);
    if (pb.queued) stopSrc(pb.queued.src);
    pb.src = null; pb.id = null; pb.tid = null; pb.queued = null;
  }
  // A take's sound, once it's decoded; until then, null, and it's on its way.
  function buffer(t) {
    let b = pb.bufs.get(t.id);
    if (!b) {
      b = takeAudio(t).then((w) => w.arrayBuffer()).then((a) => pb.ctx.decodeAudioData(a))
        .then((d) => { b.ready = d; return d; }, () => null);
      pb.bufs.set(t.id, b);
    }
    return b.ready || null;
  }
  // t: a part (see pieces()). when: on the audio clock, or 0 for now; from: seconds into the
  // part. queue: start it alongside the part playing, to follow straight on from it.
  function startAt(t, buf, when, from, queue = false) {
    if (!queue) silence();
    const src = pb.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = video.playbackRate;
    src.connect(pb.gain);
    src.start(when, t.head + from, Math.max(0, t.duration - from));
    const s = { src, id: t.key, tid: t.id, at: when || pb.ctx.currentTime, from, rate: video.playbackRate };
    if (queue) { if (pb.queued) stopSrc(pb.queued.src); pb.queued = s; } else Object.assign(pb, s);
  }
  function hearing() {
    cancelAnimationFrame(pb.raf);
    if (!rec || !hear || state !== 'idle' || playing || video.paused || pb.ctx?.state !== 'running') { silence(); return; }
    const now = video.currentTime, list = chosenList(), blocks = h.blocks();
    if (pb.heard != null && !stillHeard(blocks[pb.heard]?.start ?? -1, now)) pb.heard = null;
    const stop = blockToHold(blocks, pb.last ?? now, now, false, (b) => {
      const i = blocks.indexOf(b);
      return !!b.extended && i !== pb.heard && !!shownFor(i);
    });
    pb.last = now;
    if (stop) { pb.raf = 0; silence(); holdFor(shownFor(blocks.indexOf(stop))); return; }
    const here = takeAt(list, now), next = nextTake(list, now, 4);
    for (const id of pb.bufs.keys()) if (id !== here?.take.id && id !== next?.id && id !== pb.tid && id !== pb.queued?.tid) pb.bufs.delete(id);
    // The part queued to follow on has begun: it's the one playing now.
    if (here && pb.queued?.id === here.take.key) { if (pb.src) pb.src.disconnect(); Object.assign(pb, pb.queued); pb.queued = null; }
    if (here) {
      const buf = buffer(here.take);
      // Where the sound is now, if it's this part: put back in step if it's drifted.
      const pos = pb.id === here.take.key ? (pb.ctx.currentTime - pb.at) * pb.rate + pb.from : null;
      if (buf && (pos == null || Math.abs(pos - here.from) > DRIFT) && here.from < here.take.duration - 0.02) startAt(here.take, buf, 0, here.from);
    } else if (pb.id && pb.id !== next?.key) silence();
    // The next part starts on the audio clock, at its exact moment, rather than a frame late,
    // alongside the one playing if there is one.
    if (next && pb.id !== next.key && pb.queued?.id !== next.key) {
      const buf = buffer(next), wait = (next.start - now) / video.playbackRate;
      if (buf && wait < 0.25) startAt(next, buf, pb.ctx.currentTime + wait, 0, !!here);
    }
    pb.raf = requestAnimationFrame(hearing);
  }
  video.addEventListener('play', () => { endHold(); pb.last = video.currentTime; hearing(); });
  for (const ev of ['pause', 'seeking', 'ratechange']) video.addEventListener(ev, () => silence());
  video.addEventListener('seeking', () => { endHold(); pb.last = null; pb.heard = null; });
  function setHearing(on) {
    hear = on;
    put('hear', on ? null : '0');
    if (on) { wake(); hearing(); } else { silence(); endHold(); }
  }

  // ---- checking the microphone, recording nothing: in setup, and in Mic check. The
  // level shows on a meter of its own with the pocket numbered, and the loudest peak in
  // words on out.
  let check = null; // { meter, out, vertical, raf }
  async function startCheck(meter, out = null, vertical = false) {
    if (state !== 'idle') throw new Error('it’s recording. Stop first, then check it');
    if (check) return null;
    check = { meter, out, vertical, raf: 0 };
    sizeMeter(meter);
    loudest = 0;
    let notes;
    try { notes = await arm(); } catch (e) { check = null; disarm(); throw e; }
    if (!check) { disarm(); return null; } // stopped while the microphone was coming
    const draw = () => { frame(); if (check) check.raf = requestAnimationFrame(draw); };
    draw();
    return notes;
  }
  function stopCheck() {
    if (!check) return;
    cancelAnimationFrame(check.raf);
    const { meter, vertical } = check;
    check = null;
    disarm();
    level = hold = 0;
    drawLevel(meter, 0, 0, { vertical, scale: true });
    frame();
  }
  const resetLoudest = () => { loudest = 0; hold = 0; };

  // Mic check: a window with the meter standing up, to read a few lines against.
  const mic = { dlg: $('micDlg'), meter: $('micMeter'), out: $('micLoudest'), note: $('micNote') };
  async function micCheck() {
    if (state !== 'idle') return h.toast('Stop recording first, then check your microphone');
    stopPlay();
    mic.note.textContent = `Microphone: ${el.dev.selectedOptions[0]?.textContent || 'Default microphone'}. Change it under Microphone, lead-in and sync.`;
    mic.dlg.showModal();
    showLoudest(mic.out, 0);
    try {
      const got = await startCheck(mic.meter, mic.out, true);
      if (got?.rate) mic.note.textContent += ` It runs at ${got.rate} Hz: setting your interface to 48 kHz avoids converting.`;
    } catch (e) {
      mic.note.textContent = e.name === 'NotAllowedError' ? 'Scribecue needs permission to use the microphone. Allow it in the address bar, then try again.' : `Couldn’t use the microphone: ${e.message}`;
    }
  }
  $('recMic').addEventListener('click', micCheck);
  $('micReset').addEventListener('click', resetLoudest);
  $('micClose').addEventListener('click', () => mic.dlg.close());
  mic.dlg.addEventListener('close', stopCheck);

  // ---- sync test: a flash and a beep once a second; raise the number until they agree
  let test = null;
  function syncTest() {
    if (test) { clearInterval(test.timer); cancelAnimationFrame(test.raf); test.ctx.close(); test = null; el.flash.hidden = true; el.test.textContent = 'Sync test'; return; }
    const ctx = new AudioContext(), flashes = [];
    test = { ctx };
    let next = ctx.currentTime + 0.5;
    const schedule = () => {
      while (next < ctx.currentTime + 1.2) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 880; g.gain.value = 0.3;
        o.connect(g).connect(ctx.destination);
        o.start(next); o.stop(next + 0.06);
        flashes.push(next + (parseInt(el.sync.value, 10) || 0) / 1000);
        next += 1;
      }
    };
    schedule();
    test.timer = setInterval(schedule, 250);
    el.flash.hidden = false; el.test.textContent = 'Stop test';
    const draw = () => {
      while (flashes.length && flashes[0] <= ctx.currentTime) { flashes.shift(); el.flash.classList.add('on'); setTimeout(() => el.flash.classList.remove('on'), 90); }
      test.raf = requestAnimationFrame(draw);
    };
    draw();
  }
  el.test.addEventListener('click', syncTest);

  // ---- export
  // only: the pickups alone, recorded for this version, in a WAV as long as the rest, so
  // they land in place in the mixer's session.
  // With alts chosen, the narration is a package instead: a zip of the narration WAV, a WAV
  // of the alts alone as long as it, and the notes for the mixer.
  async function exportWav(only = false) {
    if (!rec) return;
    const blocks = h.blocks();
    if (only && !pickups().length) return h.toast('This recording file asks for no pickups');
    await reload();
    const all = blocks.map((_, i) => chosenFor(i)), altTakes = only ? [] : blocks.map((_, i) => chosenFor(i, true));
    const pack = altTakes.some(Boolean);
    // With extended blocks, the WAV follows the pauses, whichever takes it holds.
    const line = narrationTimeline(blocks, all.map((t) => t && placed(t)));
    const check = only ? checkPickups(blocks, all, version()) : checkExport(blocks, all.map((t) => t && placed(t)));
    if (pack) { const a = checkAlts(blocks, altTakes); check.stop.push(...a.stop); check.warn.push(...a.warn); }
    const chosen = only ? check.takes : all;
    if (only && !chosen.some(Boolean)) return h.toast('None of the pickups is recorded yet');
    const alts = altTakes.map((t) => t?.alt ?? null);
    // One WAV of the takes given, each in place, on a timeline as long as the programme.
    const wavOf = async (list, { markers, what, ...note }) => {
      const parts = [];
      for (const t of list.filter(Boolean)) {
        const wav = await takeAudio(t);
        for (const p of pieces(t)) {
          const from = WAV24_HEADER + Math.round(p.head * RATE) * 3;
          parts.push({ start: p.start + line.moved[t.block], pcm: wav.slice(from, from + Math.round(p.duration * RATE) * 3) });
        }
      }
      parts.sort((a, z) => a.start - z.start);
      const last = Math.max(0, ...list.filter(Boolean).map((t) => { const s = placed(t); return s.start + s.duration + line.moved[t.block]; }));
      return buildBwf({
        takes: parts, markers,
        note: narrationNote({ blocks, edited: rec.edited, project: rec.project, version: version(), alts, pauses: line.pauses, ...note }),
        secs: Math.max(h.duration() + line.added, last), rate: RATE, startSecs: rec.start, description: `${h.baseName()} ${what}`.slice(0, 256),
      });
    };
    const save = (blob, name) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    };
    const mention = check.warn.length ? `. ${check.warn.length} thing${check.warn.length === 1 ? '' : 's'} to mention to the mixer` : '';
    const go = async () => {
      const base = h.baseName();
      const markers = blocks.map((b, i) => ({ at: line.starts[i], label: markerLabel(b, i + 1) })).filter((_, i) => !only || chosen[i]);
      // Where the video stops, for whoever makes the extended video.
      const rows = blocks.flatMap((b, i) => (line.secs[i] ? [{ block: i + 1, programme: fmtTime(b.start, '.'), extended: fmtTime(line.starts[i], '.'), secs: line.secs[i], text: b.text }] : []));
      const pauseCsv = rows.length ? new Blob([pauseList(rows)], { type: 'text/csv;charset=utf-8' }) : null;
      const what = only ? `pickups${version() ? `, version ${version()}` : ''}: blocks ${chosen.flatMap((t, i) => (t ? [i + 1] : [])).join(', ')}` : 'narration';
      let main;
      try {
        main = await wavOf(chosen, { markers, what, only, picked: pickups().filter((k) => chosen[k] && pickedUp(chosen[k], version())).map((k) => k + 1) });
      } catch (e) { return h.toast(`Couldn’t get the takes: ${e.message}`); }
      if (!pack) {
        const name = `${base}-${only ? `pickups${version() ? `-v${version()}` : ''}` : 'narration'}.wav`;
        save(main, name);
        if (pauseCsv) { await new Promise((ok) => setTimeout(ok, 300)); save(pauseCsv, `${base}-pauses.csv`); }
        return h.toast(`Exported ${name}${pauseCsv ? ' and the pause list' : ''}${mention}`);
      }
      let zip;
      try {
        const altMarkers = blocks.flatMap((b, i) => (alts[i] != null ? [{ at: line.starts[i], label: markerLabel(b, i + 1, alts[i]) }] : []));
        const alt = await wavOf(altTakes, { markers: altMarkers, what: 'alts', altOnly: true });
        const report = exportReport(check), list = alts.flatMap((a, i) => (a != null ? [`Block ${i + 1}: “${a}” (was “${blocks[i].text}”)`] : []));
        const notes = [`Alts: ${list.length}`, ...list, ...(report ? ['', report] : [])].join('\n') + '\n';
        let shown = -1;
        zip = await storeZip([{ name: `${base}-narration.wav`, blob: main }, { name: `${base}-alts.wav`, blob: alt },
          { name: `${base}-notes.txt`, blob: new Blob([notes], { type: 'text/plain' }) },
          ...(pauseCsv ? [{ name: `${base}-pauses.csv`, blob: pauseCsv }] : [])], {
          progress: (done, total) => { const pc = Math.floor((done / total) * 100); if (pc !== shown) status(`Packing the narration: ${(shown = pc)}%`); },
        });
      } catch (e) { status(''); return h.toast(`Couldn’t make the package: ${e.message}`); }
      status('');
      const name = `${base}-narration-package.zip`;
      save(zip, name);
      h.toast(`Exported ${name}: the narration, ${altCount()} alt${altCount() === 1 ? '' : 's'} and the notes${mention}`);
    };
    if (!check.stop.length && !check.warn.length) return go();
    const stopped = check.stop.length > 0;
    el.title.textContent = stopped ? 'Retake these blocks first' : 'Export with these notes?';
    el.report.textContent = exportReport(check) + (stopped ? '\n\nThe export won’t go ahead until the blocks marked STOPPED are retaken.' : pack ? '\n\nThese notes go in the package.' : '\n\nSend this with the WAV.');
    el.go2.hidden = stopped;
    el.go2.onclick = () => { el.dlg.close(); go(); };
    el.dlg.showModal();
  }
  $('recExportCancel').addEventListener('click', () => el.dlg.close());

  // ---- pickups: the next block asked for again, after the selected one
  function nextPickup() {
    const pk = pickups();
    if (!pk.length) return h.toast('This recording file asks for no pickups');
    const i = pk.find((k) => k > h.selIdx()) ?? pk[0];
    h.select(i);
    h.seek(h.blocks()[i].start);
  }

  // ---- takes from a recording file made before projects, kept under its own script
  $('recLink').addEventListener('click', () => $('recLinkFile').click());
  $('recLinkFile').addEventListener('change', async (ev) => {
    const f = ev.target.files[0];
    ev.target.value = '';
    if (!f || !rec?.project || state !== 'idle') return;
    let old;
    try { old = fromRecordingFile(JSON.parse(await f.text())); } catch (e) { return h.toast(`Couldn’t open ${f.name}: ${e instanceof SyntaxError ? 'the file is damaged' : e.message}`); }
    const from = takesKey(old);
    if (from === rec.id) return h.toast(`${f.name} is this recording. Its takes are already here`);
    try {
      const theirs = await listTakes(from);
      if (!theirs.length) return h.toast(`There are no takes for ${f.name} here`);
      stopPlay(); silence();
      // Their lines first, from their own script, so they can be matched to this one.
      await relinkTakes(from, relink(theirs, old.blocks, old.blocks));
      const n = await moveTakes(from, rec.id);
      pb.bufs.clear();
      await reload(true);
      h.toast(`Brought in ${n} take${n === 1 ? '' : 's'} from ${f.name}. Lines that have changed since need recording again`);
    } catch (e) { h.toast(`Couldn’t bring in the takes: ${e.message}`); }
  });

  // ---- opening and leaving
  return {
    get active() { return state !== 'idle'; },
    get open() { return !!rec; },
    toggle, punch, exportWav, exportSession, chooseWhere, finish, render, nextPickup, undoDelete,
    get session() { return !!rec && !!currentSession(); },
    get pickups() { return rec ? pickups().length : 0; },
    // How many blocks have an alt in the export, and the Alt switch (A).
    get alts() { return rec ? altCount() : 0; },
    toggleAlt() { setSide(!side); },
    get side() { return !!rec && side; },
    altText: (i) => (rec && h.blocks()[i] ? altText(i) : ''),
    setAltText,
    altWording: (i) => (rec ? altWording(i) : null),
    // Block i's slot and its shown take, together, for Zoom to take (Z).
    span(i) {
      const s = sl()[i], t = rec && s && shownFor(i), p = t && placed(t);
      if (!s) return { start: 0, end: 1 };
      const end = s.hold ? s.mark : s.end;
      return p ? { start: Math.min(s.start, p.start), end: Math.max(end, p.start + p.duration) } : { start: s.start, end };
    },
    // Splits the selected block's take at the playhead (see keyTake): false if no block is selected.
    splitTake() {
      if (!rec || state !== 'idle' || h.selIdx() < 0) return false;
      const t = keyTake();
      if (t) doEdit(t, 'split'); else h.toast(`Block ${h.selIdx() + 1} has no take to split`);
      return true;
    },
    // Deletes the part of a take last clicked, or the one open in the editor.
    cutPart() {
      if (!rec || state !== 'idle') return false;
      const t = keyTake();
      if (t && (pick?.id === t.id || editing?.id === t.id)) doEdit(t, 'cut'); else h.toast('Click a part of a take on the timeline to delete it');
      return true;
    },
    drawTrack,
    // For setup: hears the microphone on the meter given, until stopped. Resolves to
    // { rate, bluetooth }, or null if stopped before the microphone came.
    startCheck, stopCheck, resetLoudest, micCheck,
    get checking() { return !!check; },
    stopSyncTest() { if (test) syncTest(); },
    listDevices: devices,
    refresh: () => reload(),
    get hearing() { return hear; },
    setHearing,
    stopPlayback: stopPlay,
    // raw: the recording file as opened, kept in its session.
    async open(file, rawFile = null) {
      rec = { ...file, id: takesKey(file) };
      raw = rawFile || asRecordingFile(file, h.app);
      state = 'idle';
      side = false;
      try { drafts = JSON.parse(get(`alts.${rec.id}`)) || {}; } catch { drafts = {}; }
      where = await takesWhere();
      status(''); devices();
      await attach();
    },
    // After Settings deleted the takes kept in the browser: a session there starts again.
    async refreshSession() {
      if (rec && currentSession()?.where === 'browser') await attach(); else await reload();
    },
    async close() {
      if (state === 'lead' || state === 'rec') await finish();
      stopPlay();
      silence(); pb.bufs.clear();
      if (test) syncTest();
      if (mic.dlg.open) mic.dlg.close();
      h.volume(false);
      clearTimeout(draftTimer);
      const s = currentSession();
      if (s && Object.keys(drafts).length) await s.setDrafts({ ...drafts }).catch(() => {});
      // Takes deleted while it was open go for good now.
      await s?.purge().catch(() => {});
      deleted = [];
      useSession(null);
      keep = 'none'; paused = null; raw = null;
      if (answer) settle(null);
      rec = null; takes = []; editing = null; pick = null; held = null; peakCache.clear(); fineCache.clear(); menu.hidden = true; render();
    },
  };
}
