// Record mode: the narrator records each line against the video, keeps every take, and
// exports the chosen ones as one WAV for the mixer. The script is locked (app.js sees to
// that); this file does the recording. The guide is Guides/RECORDING.md.

import { slots, peakDb, judgePeak, dbText, runsOver, checkExport, exportReport, recordingId, placeTake, looksBluetooth, narrationNote, takeAt, nextTake, punchIn, PUNCH_MIN, pieces, placed, clampEdit, splitAt, cutPart, trimSilence, fitSlot, startAtBlock, snap, flatten, wavePeaks, clipAt, relink, takesKey, pickedUp, originalTake, checkPickups, markerLabel, fromRecordingFile, DRIFT, PREROLL, RATE } from './recording.js';
import { to24, from24, wav24, buildBwf, WAV24_HEADER } from './bwf.js';
import { listTakes, saveTake, chooseTake, editTake, deleteTake, takeAudio, takesWhere, relinkTakes, moveTakes } from './takestore.js';

const $ = (id) => document.getElementById(id);
const VIDEO_DB = -30; // the video's sound while recording, so the scene can still be followed
const LEAD = [3, 4, 5];
const LEVEL_WORDS = { good: 'on target', note: 'fine', quiet: 'too quiet', loud: 'too loud: retake it' };
const get = (k) => { try { return localStorage.getItem('scribecue.rec.' + k); } catch { return null; } };
const put = (k, v) => { try { if (v == null) localStorage.removeItem('scribecue.rec.' + k); else localStorage.setItem('scribecue.rec.' + k, v); } catch { /* storage blocked */ } };

// h: { video, toast, blocks(), selIdx(), select(i), seek(t), baseName(), volume(on) }
export function initRecord(h) {
  const { video } = h;
  const el = { go: $('recGo'), status: $('recStatus'), meter: $('recMeter'), fill: $('recSlotFill'), slot: $('recSlot'),
    dev: $('recDev'), lead: $('recLead'), sync: $('recSync'), test: $('recTest'), flash: $('recFlash'), takes: $('recTakes'),
    punch: $('recPunch'), count: $('recCount'), dlg: $('recExportDlg'), report: $('recReport'), go2: $('recExportGo'), title: $('recExportTitle') };

  let rec = null;            // the recording file open: { id, start, fps, media, project?, version? }; id is where its takes are kept
  let takes = [];            // every take of this recording
  let state = 'idle';        // idle | arming | lead | rec | saving
  let cap = null;            // { stream, ctx, node, chunks, t0, slot, prevEnd, block, inLatency, punch }
  let level = 0, hold = 0;   // meter: current and held peak, 0…1
  let raf = 0, playing = null, warned = new Set();
  let leadSecs = LEAD.includes(+get('lead')) ? +get('lead') : 3;
  let syncMs = get('sync') != null ? +get('sync') : null; // null: use the browser's figure
  let wasPlaying = false;
  let where = 'browser';     // where takes are kept: 'docker' or 'browser'
  let editing = null;        // the take open in the list to fine-tune, always the chosen one: { id }

  el.lead.value = leadSecs;
  el.sync.value = syncMs ?? '';
  const sl = () => slots(h.blocks());
  const blockTakes = (i) => takes.filter((t) => t.block === i).sort((a, z) => a.made - z.made);
  const chosenFor = (i) => takes.find((t) => t.block === i && t.chosen) || null;
  // Takes of a line that's since been reworded: in no block, shown under the one in their place.
  const oldTakes = (i) => {
    const b = h.blocks()[i];
    return takes.filter((t) => t.block < 0 && t.line && Math.min(t.line.end, b.end) > Math.max(t.line.start, b.start)).sort((a, z) => a.made - z.made);
  };
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
    el.count.textContent = rec ? `${done} of ${n} blocks have a take` + (pk.length ? ` · ${pd} of ${pk.length} pickups recorded` : '') : '';
    $('recLinkRow').hidden = !rec?.project;
    el.count.dataset.tip = where === 'docker' ? 'Takes are kept in Docker, on this computer' : 'Takes are kept in this browser. Clearing its data for Scribecue loses them';
    el.takes.replaceChildren();
    const note = (text) => { const li = document.createElement('li'); li.className = 'dim'; li.textContent = text; el.takes.append(li); };
    if (i < 0) return note('Select a block to record it.');
    const slot = sl()[i];
    const list = blockTakes(i), b = h.blocks()[i];
    const orig = b.pickup ? originalTake(list, oldTakes(i), version()) : null;
    const origTag = () => { const o = document.createElement('span'); o.className = 'num dim'; o.textContent = 'original'; return o; };
    if (b.pickup) {
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
    if (busy && cap?.block === i) note(cap.punch ? `Punching in: take ${list.length + 1} of block ${i + 1}, from take ${list.findIndex((t) => t.id === cap.punch.base.id) + 1}.` : `Recording take ${list.length + 1} of block ${i + 1}.`);
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
      use.setAttribute('aria-label', `Use take ${k + 1} in the export`);
      use.addEventListener('click', async () => { if (!t.chosen) { await chooseTake(rec.id, t.id); await reload(); } });
      const name = document.createElement('span');
      name.textContent = `Take ${k + 1}`;
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
      del.textContent = 'Delete'; del.setAttribute('aria-label', `Delete take ${k + 1}`);
      del.addEventListener('click', async () => {
        if (!confirm(`Delete take ${k + 1} of block ${i + 1}? This can’t be undone.`)) return;
        stopPlay();
        await deleteTake(rec.id, t.id);
        // Another take takes its place in the export, if this one was chosen.
        const left = blockTakes(i).filter((x) => x.id !== t.id);
        if (t.chosen && left.length) await chooseTake(rec.id, left[left.length - 1].id);
        await reload();
      });
      li.append(play, ed, del);
      el.takes.append(li);
      if (editing?.id === t.id) el.takes.append(editor(t, i));
    });
    oldTakes(i).forEach((t, k) => {
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
      del.addEventListener('click', async () => {
        if (!confirm(`Delete old take ${k + 1} of block ${i + 1}? This can’t be undone.`)) return;
        stopPlay();
        await deleteTake(rec.id, t.id);
        await reload();
      });
      li.append(name, tag);
      if (t === orig) li.append(origTag());
      li.append(play, del);
      el.takes.append(li);
    });
  }
  // match: put takes with the blocks of this version of the script (see relink), as when
  // it's opened. A recording from before projects has only one script, so its takes just
  // get their lines.
  async function reload(match = false) {
    takes = rec ? await listTakes(rec.id).catch(() => []) : [];
    if (rec && match) {
      const changes = relink(takes, h.blocks(), rec.project ? null : h.blocks());
      try { await relinkTakes(rec.id, changes); } catch (e) { h.toast(`Couldn’t match the takes to this script: ${e.message}`); }
      const by = new Map(changes.map((c) => [c.id, c]));
      takes = takes.map((t) => (by.has(t.id) ? { ...t, ...by.get(t.id) } : t));
    }
    for (const id of peakCache.keys()) if (!takeOf(id)) peakCache.delete(id);
    if (pick && !takeOf(pick.id)) pick = null;
    render();
  }

  // ---- editing a take: split it, move the parts and trim their ends, against the slot.
  // The chosen takes are clips on the take track, under the timeline's lane (see drawTrack);
  // Fine-tune in the list does the same in milliseconds, from the keyboard.
  const prevEndOf = (i) => (i ? sl()[i - 1].end : 0);
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
    return mine(editing && takeOf(editing.id)) || mine(pick && takeOf(pick.id)) || chosenFor(i);
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
      if (key !== 'shift') inp.min = '0';
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
    const cutBtn = btn('Delete part', 'Delete this part. Reset brings it back (Delete)', () => doEdit(t, 'cut'));
    cutBtn.disabled = ps.length < 2;
    row.append(field('Move', 'shift', 'Move this part: below 0 earlier, above 0 later'),
      field('Trim start', 'head', 'Cut this much off the start of this part'),
      field('Trim end', 'tail', 'Cut this much off the end of this part'),
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
  const peakWant = new Set();  // takes on screen whose waveform isn't read yet
  let peakBusy = false;
  let view = { t0: 0, pps: 100 }; // as last drawn
  let tdrag = null;          // { t, k, mode, x0, e0, e, moved, snapped }
  // One take at a time, and only those on screen, so a long film's takes aren't all read.
  function loadPeaks() {
    if (peakBusy) return;
    const id = peakWant.values().next().value, t = id && takeOf(id);
    if (!t) return;
    peakWant.delete(id);
    peakBusy = true;
    takeAudio(t).then((w) => w.arrayBuffer()).then((b) => {
      const pcm = from24(new Uint8Array(b).subarray(WAV24_HEADER));
      peakCache.set(id, wavePeaks(pcm, Math.max(1, Math.round(pcm.length / RATE * PR))));
    }, () => peakCache.set(id, null)).finally(() => { peakBusy = false; h.redraw(); });
  }
  let TK = null;
  // g: the track's canvas, already sized; t0 and pps: the timeline's view.
  function drawTrack(g, W, H, t0, pps) {
    view = { t0, pps };
    peakWant.clear();
    if (!rec) return;
    TK ||= Object.fromEntries(['ok', 'bad', 'line', 'dim', 'faint', 'accent', 'accent-bg', 'cue', 'cue-bg', 'text', 'mono'].map((n) => [n, tok('--' + n)]));
    const t1 = t0 + W / pps, x = (s) => (s - t0) * pps, mid = H / 2, sel = h.selIdx(), amp = mid - 9;
    g.fillStyle = TK.line;
    g.fillRect(0, Math.round(mid), W, 1);
    g.font = `10px ${TK.mono}`;
    if (!takes.length) { g.fillStyle = TK.dim; g.fillText('Takes show here as you record them', 8, 16); return; }
    sl().forEach((slot, i) => {
      const raw = chosenFor(i), slotIn = slot.end > t0 && slot.start < t1;
      const t = raw && tdrag?.t.id === raw.id ? { ...raw, edit: tdrag.e } : raw;
      const whole = t && placed(t), over = t && runsOver(whole, slot);
      if (slotIn) {
        g.fillStyle = `color-mix(in srgb, ${TK.ok} 10%, transparent)`;
        g.fillRect(x(slot.start), 0, x(slot.end) - x(slot.start), H);
        g.fillStyle = over ? TK.bad : TK.ok;
        g.fillRect(x(slot.end) - 1, 0, 2, H);
      }
      if (!t || whole.start > t1 || whole.start + whole.duration < t0) return;
      const wave = pps >= SHOW_WAVE;
      if (wave && !peakCache.has(t.id)) peakWant.add(t.id);
      const pk = wave ? peakCache.get(t.id) : null, on = i === sel, ps = pieces(t);
      const n = blockTakes(i).findIndex((q) => q.id === t.id) + 1;
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
        g.stroke();
        const from = Math.max(0, Math.floor(a)), to = Math.min(W, Math.ceil(z));
        if (!pk) { g.fillStyle = TK.faint; g.fillRect(from, mid - 0.5, to - from, 1); }
        else {
          let last = '';
          for (let px = from; px < to; px++) {
            const s = t0 + px / pps, off = p.head + s - p.start;
            const i0 = Math.max(0, Math.floor(off * PR)), i1 = Math.min(pk.length, Math.max(i0 + 1, Math.floor((off + 1 / pps) * PR)));
            let m = 0;
            for (let k = i0; k < i1; k++) if (pk[k] > m) m = pk[k];
            const fill = s > slot.end ? TK.bad : on ? TK.accent : TK.dim;
            if (fill !== last) g.fillStyle = last = fill;
            const hh = Math.max(0.5, Math.min(1, m * 2) * amp);
            g.fillRect(px, mid - hh, 1, hh * 2);
          }
        }
        // The longest label that fits: "Take 2 · 1/2", "Take 2", or none.
        const label = [ps.length > 1 ? `Take ${n} · ${j + 1}/${ps.length}` : '', `Take ${n}`].find((s) => s && g.measureText(s).width + 12 <= z - Math.max(a, 0));
        if (label) { g.fillStyle = on ? TK.accent : TK.cue; g.fillText(label, Math.max(a, 0) + 6, 17); }
      });
    });
    if (tdrag?.snapped != null) { g.fillStyle = TK.text; g.fillRect(x(tdrag.snapped) - 1, 0, 2, H); }
    loadPeaks();
  }

  const hitAt = (px) => clipAt(takes.filter((t) => t.chosen), view.t0 + px / view.pps, view.pps);
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
      if (e.data.peak != null) level = Math.max(level, e.data.peak);
      if (e.data.pcm && cap) cap.chunks.push(e.data.pcm);
      if (e.data.done) cap.finish?.();
    };
    devices();
    if (settings.sampleRate && settings.sampleRate !== RATE && !warned.has('rate')) {
      warned.add('rate');
      h.toast(`Your microphone runs at ${settings.sampleRate} Hz, so Scribecue converts it to 48 kHz. Setting your audio interface to 48 kHz avoids that`);
    }
    const out = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).find((d) => d.kind === 'audiooutput' && d.deviceId === 'default');
    if (syncMs == null && looksBluetooth(out?.label, cap.outLatency) && !warned.has('bt')) {
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
    const i = h.selIdx();
    if (i < 0) return h.toast('Select a block, then record it');
    if (!h.hasVideo()) return h.toast('Open the video first');
    const s = sl()[i];
    let p = null;
    if (punch) {
      const base = chosenFor(i), at = video.currentTime;
      if (!base) return h.toast(`Block ${i + 1} has no take to pick up from. Press Enter to record it`);
      if (at < placed(base).start + PUNCH_MIN || at >= s.end) return h.toast(`Put the playhead where you want to pick up, inside block ${i + 1}’s take, then press Shift+Enter`);
      p = { base, at, ps: pieces(base), on: null };
    }
    stopPlay();
    state = 'arming'; status('Getting the microphone…'); render();
    try { await arm(); } catch (e) {
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
    cap.block = i; cap.slot = s; cap.prevEnd = i ? sl()[i - 1].end : 0; cap.punch = p;
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
      if (!cap) return drawMeter(); // stopped since this frame was asked for
      if (state === 'lead' && video.currentTime >= cap.t0) {
        cap.node.port.postMessage('start');
        state = 'rec';
      }
      const p = cap.punch;
      if (p) {
        p.on = follow(p.audio, p.ps, video.currentTime, p.on, p.at);
      }
      if (state === 'lead') status(p ? `Picks up in ${Math.max(0, p.at - video.currentTime).toFixed(1)} s` : `Starts in ${Math.ceil(Math.max(0, cap.slot.start - video.currentTime))} s: set your level`);
      if (state === 'rec') {
        const left = cap.slot.end - video.currentTime;
        status(left >= 0 ? `Recording: ${left.toFixed(1)} s left in the slot` : `Recording: ${(-left).toFixed(1)} s over the slot`);
        const f = (video.currentTime - cap.slot.start) / (cap.slot.end - cap.slot.start);
        el.fill.style.width = Math.max(0, Math.min(1, f)) * 100 + '%';
        el.slot.classList.toggle('over', f > 1);
        if (video.ended) { finish(); return; }
      }
      drawMeter();
      if (state === 'lead' || state === 'rec') loop();
    });
  }

  async function finish() {
    if (state !== 'lead' && state !== 'rec') return;
    const c = cap, wasRec = state === 'rec';
    state = 'saving'; status('Saving the take…'); render();
    video.pause();
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
    level = 0; drawMeter(); el.fill.style.width = '0'; el.slot.classList.remove('over');
    if (samples.length < RATE * 0.3) { state = 'idle'; status(wasRec ? 'Too short to keep: nothing saved' : c.punch ? 'Stopped before the join: nothing saved' : 'Stopped before the block: nothing saved'); render(); return; }
    // The sound reaches the narrator late and reaches Scribecue late: take both off.
    const delay = c.inLatency + (syncMs != null ? syncMs / 1000 : c.outLatency);
    const { start, skip } = placeTake({ t0: c.t0, delay, prevEnd: c.prevEnd });
    let kept = samples.subarray(skip), at = start;
    if (c.punch) {
      const whole = from24(new Uint8Array(await c.punch.wav.arrayBuffer()).subarray(WAV24_HEADER));
      ({ start: at, pcm: kept } = punchIn(flatten(c.punch.base, whole), { start, pcm: kept }, c.punch.at));
    }
    const b = h.blocks()[c.block];
    const take = { id: crypto.randomUUID(), rec: rec.id, block: c.block, start: at, duration: kept.length / RATE,
      peak: peakDb(kept), made: Date.now(), wav: wav24(to24(kept), RATE), ...(c.punch && { punch: c.punch.at }),
      line: { start: b.start, end: b.end, text: b.text }, ver: version() };
    try { await saveTake(take, true); } catch (e) {
      state = 'idle'; render();
      return h.toast(`Couldn’t keep the take: ${e.message}` + (where === 'browser' ? '. The browser’s storage may be full' : ''));
    }
    state = 'idle';
    await reload();
    const j = judgePeak(take.peak);
    status(`Saved take ${blockTakes(c.block).length}: ${dbText(take.peak)}, ${LEVEL_WORDS[j]}`);
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
  el.go.addEventListener('click', toggle);
  el.punch.addEventListener('click', punch);

  // ---- meter
  const ctx2 = el.meter.getContext('2d');
  const css = getComputedStyle(document.documentElement), tok = (n) => css.getPropertyValue(n).trim();
  const C = { ok: tok('--ok'), bad: tok('--bad'), quiet: tok('--faint'), hold: tok('--text') };
  // The zones behind the bar: the target in the colour for good, too loud in the one for bad.
  const zone = (c) => `color-mix(in srgb, ${c} 25%, transparent)`;
  function drawMeter() {
    const w = el.meter.width, hgt = el.meter.height;
    ctx2.clearRect(0, 0, w, hgt);
    const x = (db) => Math.round((Math.max(-48, Math.min(0, db)) + 48) / 48 * w);
    ctx2.fillStyle = zone(C.ok); ctx2.fillRect(x(-12), 0, x(-8) - x(-12), hgt);
    ctx2.fillStyle = zone(C.bad); ctx2.fillRect(x(-6), 0, w - x(-6), hgt);
    const db = level > 0 ? 20 * Math.log10(level) : -48;
    ctx2.fillStyle = db > -6 ? C.bad : db >= -16 ? C.ok : C.quiet;
    ctx2.fillRect(0, 3, x(db), hgt - 6);
    hold = Math.max(level, hold * 0.97);
    if (hold > 0) { ctx2.fillStyle = C.hold; ctx2.fillRect(x(20 * Math.log10(hold)), 0, 2, hgt); }
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
    const t = placed(raw), ps = pieces(raw);
    let wav;
    try { wav = await takeAudio(t); } catch (e) { return h.toast(`Couldn’t play the take: ${e.message}`); }
    const audio = new Audio(URL.createObjectURL(wav));
    playing = { t, audio, on: null, then, cmp };
    h.volume(false);
    h.seek(Math.max(0, t.start - 2));
    video.play().catch(() => {});
    render();
    const tick = () => {
      if (!playing) return;
      playing.on = follow(audio, ps, video.currentTime, playing.on);
      if (video.paused || video.currentTime >= t.start + t.duration) {
        const next = !video.paused && playing.then;
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
  const chosenList = () => takes.filter((t) => t.chosen).flatMap(pieces).sort((a, z) => a.start - z.start);
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
    const now = video.currentTime, list = chosenList();
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
  video.addEventListener('play', () => hearing());
  for (const ev of ['pause', 'seeking', 'ratechange']) video.addEventListener(ev, () => silence());
  function setHearing(on) {
    hear = on;
    put('hear', on ? null : '0');
    if (on) { wake(); hearing(); } else silence();
  }

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
  async function exportWav(only = false) {
    if (!rec) return;
    const blocks = h.blocks();
    if (only && !pickups().length) return h.toast('This recording file asks for no pickups');
    await reload();
    const all = blocks.map((_, i) => chosenFor(i));
    const check = only ? checkPickups(blocks, all, version()) : checkExport(blocks, all.map((t) => t && placed(t)));
    const chosen = only ? check.takes : all, spans = chosen.map((t) => t && placed(t));
    if (only && !chosen.some(Boolean)) return h.toast('None of the pickups is recorded yet');
    const go = async () => {
      const media = h.duration();
      const parts = [];
      try {
        for (const t of chosen.filter(Boolean)) {
          const wav = await takeAudio(t);
          for (const p of pieces(t)) {
            const from = WAV24_HEADER + Math.round(p.head * RATE) * 3;
            parts.push({ start: p.start, pcm: wav.slice(from, from + Math.round(p.duration * RATE) * 3) });
          }
        }
        parts.sort((a, z) => a.start - z.start);
      } catch (e) { return h.toast(`Couldn’t get the takes: ${e.message}`); }
      const last = Math.max(0, ...spans.filter(Boolean).map((t) => t.start + t.duration));
      const marked = blocks.map((b, i) => ({ at: b.start, label: markerLabel(b, i + 1) })).filter((_, i) => !only || chosen[i]);
      const what = only ? `pickups${version() ? `, version ${version()}` : ''}: blocks ${chosen.flatMap((t, i) => (t ? [i + 1] : [])).join(', ')}` : 'narration';
      const blob = buildBwf({
        takes: parts,
        markers: marked,
        note: narrationNote({ blocks, edited: rec.edited, project: rec.project, version: version(), only,
          picked: pickups().filter((k) => chosen[k] && pickedUp(chosen[k], version())).map((k) => k + 1) }),
        secs: Math.max(media, last), rate: RATE, startSecs: rec.start, description: `${h.baseName()} ${what}`.slice(0, 256),
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${h.baseName()}-${only ? `pickups${version() ? `-v${version()}` : ''}` : 'narration'}.wav`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      h.toast(`Exported ${a.download}` + (check.warn.length ? `. ${check.warn.length} thing${check.warn.length === 1 ? '' : 's'} to mention to the mixer` : ''));
    };
    if (!check.stop.length && !check.warn.length) return go();
    const stopped = check.stop.length > 0;
    el.title.textContent = stopped ? 'Retake these blocks first' : 'Export with these notes?';
    el.report.textContent = exportReport(check) + (stopped ? '\n\nThe export won’t go ahead until the blocks marked STOPPED are retaken.' : '\n\nSend this with the WAV.');
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
    toggle, punch, exportWav, finish, render, nextPickup,
    get pickups() { return rec ? pickups().length : 0; },
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
    refresh: () => reload(),
    get hearing() { return hear; },
    setHearing,
    stopPlayback: stopPlay,
    async open(file) {
      rec = { ...file, id: takesKey(file) };
      state = 'idle';
      where = await takesWhere();
      status(''); devices();
      await reload(true);
    },
    async close() {
      if (state === 'lead' || state === 'rec') await finish();
      stopPlay();
      silence(); pb.bufs.clear();
      if (test) syncTest();
      h.volume(false);
      rec = null; takes = []; editing = null; pick = null; held = null; peakCache.clear(); menu.hidden = true; render();
    },
  };
}
