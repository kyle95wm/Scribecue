// Record mode: the narrator records each line against the video, keeps every take, and
// exports the chosen ones as one WAV for the mixer. The script is locked (app.js sees to
// that); this file does the recording. The guide is Guides/RECORDING.md.

import { slots, peakDb, judgePeak, dbText, runsOver, checkExport, exportReport, recordingId, placeTake, looksBluetooth, narrationNote, takeAt, nextTake, punchIn, PUNCH_MIN, pieces, placed, fullEdit, clampEdit, splitAt, cutPart, trimSilence, fitSlot, startAtBlock, snap, flatten, wavePeaks, DRIFT, PREROLL, RATE } from './recording.js';
import { to24, from24, wav24, buildBwf, WAV24_HEADER } from './bwf.js';
import { listTakes, saveTake, chooseTake, editTake, deleteTake, takeAudio, takesWhere } from './takestore.js';

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

  let rec = null;            // { id, start, fps, media }
  let takes = [];            // every take of this recording
  let state = 'idle';        // idle | arming | lead | rec | saving
  let cap = null;            // { stream, ctx, node, chunks, t0, slot, prevEnd, block, inLatency, punch }
  let level = 0, hold = 0;   // meter: current and held peak, 0…1
  let raf = 0, playing = null, warned = new Set();
  let leadSecs = LEAD.includes(+get('lead')) ? +get('lead') : 3;
  let syncMs = get('sync') != null ? +get('sync') : null; // null: use the browser's figure
  let wasPlaying = false;
  let where = 'browser';     // where takes are kept: 'docker' or 'browser'
  let editing = null;        // the take being moved or trimmed: { id, pcm }

  el.lead.value = leadSecs;
  el.sync.value = syncMs ?? '';
  const sl = () => slots(h.blocks());
  const blockTakes = (i) => takes.filter((t) => t.block === i).sort((a, z) => a.made - z.made);
  const chosenFor = (i) => takes.find((t) => t.block === i && t.chosen) || null;

  // ---- panel
  function status(msg) { el.status.textContent = msg; }
  function render() {
    const busy = state !== 'idle';
    el.go.textContent = busy ? '■ Stop' : '● Record';
    el.go.classList.toggle('on', busy);
    el.go.disabled = state === 'arming' || state === 'saving';
    el.punch.disabled = busy;
    const i = h.selIdx(), n = h.blocks().length;
    const done = h.blocks().filter((_, k) => chosenFor(k)).length;
    el.count.textContent = rec ? `${done} of ${n} blocks have a take` : '';
    el.count.dataset.tip = where === 'docker' ? 'Takes are kept in Docker, on this computer' : 'Takes are kept in this browser. Clearing its data for Scribecue loses them';
    el.takes.replaceChildren();
    const note = (text) => { const li = document.createElement('li'); li.className = 'dim'; li.textContent = text; el.takes.append(li); };
    if (i < 0) return note('Select a block to record it.');
    const slot = sl()[i];
    const list = blockTakes(i);
    if (busy && cap?.block === i) note(cap.punch ? `Punching in: take ${list.length + 1} of block ${i + 1}, from take ${list.findIndex((t) => t.id === cap.punch.base.id) + 1}.` : `Recording take ${list.length + 1} of block ${i + 1}.`);
    else if (!list.length) note(`Block ${i + 1} has no takes yet. Press Enter or R to record it.`);
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
      if (t.punch != null) { const j2 = document.createElement('span'); j2.className = 'num dim'; j2.textContent = `joined at ${(t.punch - t.start).toFixed(2)} s`; li.append(j2); }
      if (over) { const o = document.createElement('span'); o.className = 'lvl loud'; o.textContent = 'runs past its slot'; li.append(o); }
      const play = document.createElement('button');
      play.textContent = playing?.t.id === t.id ? 'Stop' : 'Play';
      play.addEventListener('click', () => (playing?.t.id === t.id ? stopPlay() : playTake(t)));
      const ed = document.createElement('button');
      ed.textContent = 'Edit';
      ed.setAttribute('aria-expanded', String(editing?.id === t.id));
      ed.setAttribute('aria-label', `Move or trim take ${k + 1}`);
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
  }
  async function reload() {
    takes = rec ? await listTakes(rec.id).catch(() => []) : [];
    render();
  }

  // ---- editing a take: split it, move the parts and trim their ends, against the slot
  const MS = (v) => String(Math.round(v * 1000));
  function editor(t, i) {
    const li = document.createElement('li');
    li.className = 'takeedit';
    const slot = sl()[i], prevEnd = i ? sl()[i - 1].end : 0;
    let e = clampEdit(t, t.edit, prevEnd);
    const cur = () => ({ ...t, edit: e });
    // The part the fields change: the one last clicked, or the nearest one left.
    const near = (k) => pieces(cur()).reduce((a, p) => (Math.abs(p.part - k) < Math.abs(a - k) ? p.part : a), Infinity);
    let sel = near(Math.min(editing.part || 0, e.parts.length - 1));
    const setPart = (k, patch) => ({ splits: e.splits, parts: e.parts.map((p, j) => (j === k ? { ...p, ...patch } : p)) });
    // Where each part's stretch of the recording sits, trimmed ends and all.
    const raw = () => { const b = [0, ...e.splits, t.duration]; return e.parts.map((p, k) => [t.start + b[k] + p.shift, t.start + b[k + 1] + p.shift]); };
    // The view stays put while dragging, so the parts move and not the scale.
    const r0 = raw();
    const v0 = Math.min(slot.start, ...r0.map((r) => r[0])) - 0.3, v1 = Math.max(slot.end, ...r0.map((r) => r[1])) + 0.3;
    const cv = document.createElement('canvas');
    cv.width = 640; cv.height = 56;
    cv.setAttribute('role', 'img');
    const g = cv.getContext('2d');
    const x = (s) => (s - v0) / (v1 - v0) * cv.width;
    const tAt = (px) => v0 + px / cv.width * (v1 - v0);
    const field = (label, key, tip) => {
      const l = document.createElement('label');
      l.dataset.tip = tip;
      const inp = document.createElement('input');
      inp.type = 'number'; inp.step = '10'; inp.dataset.edit = key;
      if (key !== 'shift') inp.min = '0';
      inp.addEventListener('change', () => {
        const n = parseFloat(inp.value);
        commit(setPart(sel, { [key]: Number.isFinite(n) ? n / 1000 : 0 }));
      });
      l.append(`${label} `, inp, ' ms');
      return [l, inp];
    };
    const which = document.createElement('span');
    which.className = 'num';
    const [lMove, fMove] = field('Move', 'shift', 'Move this part: below 0 earlier, above 0 later');
    const [lHead, fHead] = field('Trim start', 'head', 'Cut this much off the start of this part');
    const [lTail, fTail] = field('Trim end', 'tail', 'Cut this much off the end of this part');
    const btn = (text, tip, fn) => { const b = document.createElement('button'); b.textContent = text; b.dataset.tip = tip; b.addEventListener('click', fn); return b; };
    const say = document.createElement('span');
    const silenceBtn = btn('Trim silence', 'Cut the quiet off both ends of every part, keeping a moment of it', () => {
      if (editing?.pcm) commit(trimSilence(cur(), editing.pcm));
    });
    silenceBtn.disabled = !editing?.pcm;
    const split = () => {
      const n = splitAt(cur(), video.currentTime);
      if (!n) return h.toast('Put the playhead inside the take, away from the ends of its parts, to split it');
      const p = pieces(cur()).find((q) => video.currentTime > q.start && video.currentTime < q.start + q.duration);
      sel = editing.part = p.part + 1;
      commit(n);
    };
    const cut = () => {
      const n = cutPart(cur(), sel);
      if (!n) return h.toast('A take keeps one part at least. Delete the take instead');
      e = n;
      sel = editing.part = near(sel);
      commit(n);
    };
    const cutBtn = btn('Delete part', 'Delete the part you last clicked. Reset brings it back (Delete)', cut);
    cutBtn.disabled = pieces(cur()).length < 2;
    const row = document.createElement('div');
    row.className = 'recrow';
    row.append(which, lMove, lHead, lTail,
      btn('Split', 'Split the take at the playhead, to move its parts apart or closer together (X)', split), cutBtn, silenceBtn,
      btn('Start at block', 'Move the take so its sound starts where the block does', () => commit(startAtBlock(cur(), slot, prevEnd))),
      btn('Fit in slot', 'Trim the end so the take stops where its slot does', () => commit(fitSlot(cur(), slot, prevEnd))),
      btn('Reset', 'Undo the splits, moves and trims: the take as recorded', () => { sel = editing.part = 0; commit({ splits: [], parts: [{}] }); }));
    li.append(cv, row, say);

    function draw() {
      const css = getComputedStyle(document.documentElement), tk = (n) => css.getPropertyValue(n).trim();
      const ps = pieces(cur()), over = runsOver(placed(cur()), slot), r = raw();
      g.clearRect(0, 0, cv.width, cv.height);
      g.fillStyle = `color-mix(in srgb, ${tk('--ok')} 18%, transparent)`;
      g.fillRect(x(slot.start), 0, x(slot.end) - x(slot.start), cv.height);
      g.fillStyle = over ? tk('--bad') : tk('--ok');
      g.fillRect(x(slot.end) - 1, 0, 2, cv.height);
      const cols = Math.max(1, Math.round(x(v0 + t.duration) - x(v0)));
      if (editing?.pcm && editing.peaks?.length !== cols) editing.peaks = wavePeaks(editing.pcm, cols);
      const pk = editing?.pcm ? editing.peaks : null, mid = cv.height / 2;
      ps.forEach((p) => {
        const k = p.part, kept = (s) => s >= p.start && s < p.start + p.duration;
        if (!pk) {
          g.fillStyle = tk('--faint');
          g.fillRect(x(r[k][0]), mid - 1, x(r[k][1]) - x(r[k][0]), 2);
          return;
        }
        // This part's columns of the recording's waveform, drawn where the part sits now.
        const c0 = Math.round((r[k][0] - t.start - e.parts[k].shift) / t.duration * cols);
        const c1 = Math.round((r[k][1] - t.start - e.parts[k].shift) / t.duration * cols);
        for (let c = c0; c < c1; c++) {
          const s = r[k][0] + (c - c0) / cols * t.duration;
          g.fillStyle = !kept(s) ? tk('--faint') : over && s > slot.end ? tk('--bad') : k === sel ? tk('--accent') : tk('--dim');
          const hh = Math.max(1, Math.min(1, pk[c] * 2) * (mid - 2));
          g.fillRect(x(r[k][0]) + (c - c0), mid - hh, 1, hh * 2);
        }
      });
      for (const p of ps) {
        g.fillStyle = p.part === sel ? tk('--text') : tk('--dim');
        for (const s of [p.start, p.start + p.duration]) g.fillRect(x(s) - 1, 4, 2, cv.height - 8);
      }
      const now = video.currentTime;
      if (now > v0 && now < v1) { g.fillStyle = tk('--play'); g.fillRect(x(now) - 0.5, 0, 1, cv.height); }
      // What a dragged edge has snapped to.
      if (drag?.snapped != null) { g.fillStyle = tk('--text'); g.fillRect(x(drag.snapped) - 1, 0, 2, cv.height); }
      const end = placed(cur());
      say.textContent = over ? `Ends ${(end.start + end.duration - slot.end).toFixed(2)} s past its slot` : 'Fits its slot';
      say.className = 'num ' + (over ? 'lvl loud' : 'dim');
      which.textContent = ps.length > 1 ? `Part ${ps.findIndex((p) => p.part === sel) + 1} of ${ps.length}:` : '';
      cv.setAttribute('aria-label', `Take from ${end.start.toFixed(2)} s to ${(end.start + end.duration).toFixed(2)} s${ps.length > 1 ? `, in ${ps.length} parts` : ''}. ${say.textContent}`);
      const q = e.parts[sel];
      fMove.value = MS(q.shift); fHead.value = MS(q.head); fTail.value = MS(q.tail);
    }
    async function commit(next) {
      e = clampEdit(t, next, prevEnd);
      draw();
      try { await editTake(rec.id, t.id, e); } catch (err) { return h.toast(`Couldn’t keep the edit: ${err.message}`); }
      t.edit = e;
      silence();
      const f = document.activeElement?.dataset.edit;
      render();
      if (f) el.takes.querySelector(`[data-edit="${f}"]`)?.focus();
    }

    // Drag a part's end to trim it, or its middle to move it. Clicking a part picks it for the fields.
    const hit = (px) => {
      const ps = pieces(cur());
      for (const p of ps) {
        if (Math.abs(px - x(p.start)) < 6) return { k: p.part, mode: 'head' };
        if (Math.abs(px - x(p.start + p.duration)) < 6) return { k: p.part, mode: 'tail' };
      }
      const p = ps.find((q) => px > x(q.start) && px < x(q.start + q.duration));
      return p ? { k: p.part, mode: 'shift' } : null;
    };
    const pxOf = (ev) => { const r = cv.getBoundingClientRect(); return (ev.clientX - r.left) / r.width * cv.width; };
    let drag = null;
    cv.addEventListener('pointerdown', (ev) => {
      const px = pxOf(ev), on = hit(px);
      if (!on) return;
      sel = editing.part = on.k;
      drag = { ...on, t0: tAt(px), e0: e };
      cv.setPointerCapture(ev.pointerId);
      draw();
    });
    cv.addEventListener('pointermove', (ev) => {
      const px = pxOf(ev);
      if (!drag) {
        const on = hit(px);
        cv.style.cursor = !on ? '' : on.mode === 'shift' ? 'grab' : 'ew-resize';
        return;
      }
      let d = tAt(px) - drag.t0;
      const o = drag.e0.parts[drag.k];
      // Edges snap to the block's start and the slot's end, the playhead, and the other parts.
      const all = pieces({ ...t, edit: drag.e0 }), p0 = all.find((p) => p.part === drag.k);
      const a0 = p0.start, z0 = p0.start + p0.duration, tol = 8 / cv.width * (v1 - v0);
      const targets = [slot.start, slot.end, video.currentTime, ...all.filter((p) => p !== p0).flatMap((p) => [p.start, p.start + p.duration])];
      drag.snapped = null;
      const pull = (edge) => { const s = snap(edge + d, targets, tol); if (s !== edge + d) { d = s - edge; drag.snapped = s; } return drag.snapped != null; };
      if (drag.mode === 'head') pull(a0);
      else if (drag.mode === 'tail') pull(z0);
      else if (!pull(a0)) pull(z0);
      const patch = drag.mode === 'head' ? { head: o.head + d } : drag.mode === 'tail' ? { tail: o.tail - d } : { shift: o.shift + d };
      e = clampEdit(t, { splits: drag.e0.splits, parts: drag.e0.parts.map((p, j) => (j === drag.k ? { ...p, ...patch } : p)) }, prevEnd);
      draw();
    });
    const drop = () => { if (drag) { drag = null; commit(e); } };
    cv.addEventListener('pointerup', drop);
    cv.addEventListener('pointercancel', drop);

    // The sound, for the waveform and Trim silence: only this take's, while it's open.
    if (!editing.pcm && !editing.loading) {
      editing.loading = true;
      takeAudio(t).then((w) => w.arrayBuffer()).then((b) => {
        if (editing?.id !== t.id) return;
        editing.pcm = from24(new Uint8Array(b).subarray(WAV24_HEADER));
        render();
      }, (err) => h.toast(`Couldn’t read the take: ${err.message}`));
    }
    editing.draw = draw;
    editing.split = split;
    editing.cut = cut;
    draw();
    return li;
  }
  for (const ev of ['timeupdate', 'seeked']) video.addEventListener(ev, () => editing?.draw?.());

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
    const take = { id: crypto.randomUUID(), rec: rec.id, block: c.block, start: at, duration: kept.length / RATE,
      peak: peakDb(kept), made: Date.now(), wav: wav24(to24(kept), RATE), ...(c.punch && { punch: c.punch.at }) };
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
  async function playTake(raw) {
    stopPlay();
    const t = placed(raw), ps = pieces(raw);
    let wav;
    try { wav = await takeAudio(t); } catch (e) { return h.toast(`Couldn’t play the take: ${e.message}`); }
    const audio = new Audio(URL.createObjectURL(wav));
    playing = { t, audio, on: null };
    h.volume(false);
    h.seek(Math.max(0, t.start - 2));
    video.play().catch(() => {});
    render();
    const tick = () => {
      if (!playing) return;
      playing.on = follow(audio, ps, video.currentTime, playing.on);
      if (video.paused || video.currentTime >= t.start + t.duration) { stopPlay(); return; }
      requestAnimationFrame(tick);
    };
    tick();
  }
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
  async function exportWav() {
    if (!rec) return;
    const blocks = h.blocks();
    await reload();
    const chosen = blocks.map((_, i) => chosenFor(i));
    const spans = chosen.map((t) => t && placed(t));
    const check = checkExport(blocks, spans);
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
      const blob = buildBwf({
        takes: parts,
        markers: blocks.map((b, i) => ({ at: b.start, label: `${i + 1} ${b.text.replace(/\s+/g, ' ').slice(0, 40)}` })),
        note: narrationNote({ blocks, edited: rec.edited }),
        secs: Math.max(media, last), rate: RATE, startSecs: rec.start, description: `${h.baseName()} narration`,
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${h.baseName()}-narration.wav`;
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

  // ---- opening and leaving
  return {
    get active() { return state !== 'idle'; },
    get open() { return !!rec; },
    toggle, punch, exportWav, finish, render,
    // Splits the take open in the editor at the playhead: false if none is open.
    splitTake() { if (!editing?.split || state !== 'idle') return false; editing.split(); return true; },
    // Deletes the part picked in the editor: false if no take is open there.
    cutPart() { if (!editing?.cut || state !== 'idle') return false; editing.cut(); return true; },
    refresh: () => reload(),
    get hearing() { return hear; },
    setHearing,
    stopPlayback: stopPlay,
    async open(file) {
      rec = { ...file, id: recordingId(file) };
      state = 'idle';
      where = await takesWhere();
      status(''); devices();
      await reload();
    },
    async close() {
      if (state === 'lead' || state === 'rec') await finish();
      stopPlay();
      silence(); pb.bufs.clear();
      if (test) syncTest();
      h.volume(false);
      rec = null; takes = []; editing = null; render();
    },
  };
}
