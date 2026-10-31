// Record mode: the narrator records each line against the video, keeps every take, and
// exports the chosen ones as one WAV for the mixer. The script is locked (app.js sees to
// that); this file does the recording. The plan is in RECORDING.md.

import { slots, peakDb, judgePeak, dbText, runsOver, checkExport, exportReport, recordingId, placeTake, looksBluetooth, narrationNote, takeAt, nextTake, punchIn, PUNCH_MIN, DRIFT, PREROLL, RATE } from './recording.js';
import { to24, from24, wav24, buildBwf, WAV24_HEADER } from './bwf.js';
import { listTakes, saveTake, chooseTake, deleteTake, takeAudio, takesWhere } from './takestore.js';

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
      const j = judgePeak(t.peak), over = runsOver(t, slot);
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
      len.textContent = `${t.duration.toFixed(2)} s`;
      const lvl = document.createElement('span');
      lvl.className = 'lvl ' + j;
      lvl.textContent = `${dbText(t.peak)}, ${LEVEL_WORDS[j]}`;
      li.append(use, name, len, lvl);
      if (t.punch != null) { const j2 = document.createElement('span'); j2.className = 'num dim'; j2.textContent = `joined at ${(t.punch - t.start).toFixed(2)} s`; li.append(j2); }
      if (over) { const o = document.createElement('span'); o.className = 'lvl loud'; o.textContent = 'runs past its slot'; li.append(o); }
      const play = document.createElement('button');
      play.textContent = playing?.t.id === t.id ? 'Stop' : 'Play';
      play.addEventListener('click', () => (playing?.t.id === t.id ? stopPlay() : playTake(t)));
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
      li.append(play, del);
      el.takes.append(li);
    });
  }
  async function reload() {
    takes = rec ? await listTakes(rec.id).catch(() => []) : [];
    render();
  }

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
      if (at < base.start + PUNCH_MIN || at >= s.end) return h.toast(`Put the playhead where you want to pick up, inside block ${i + 1}’s take, then press Shift+Enter`);
      p = { base, at };
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
      if (state === 'lead' && video.currentTime >= cap.t0) {
        cap.node.port.postMessage('start');
        state = 'rec';
      }
      const p = cap.punch;
      if (p) {
        const now = video.currentTime, on = now >= p.base.start && now < Math.min(p.at, p.base.start + p.base.duration);
        if (on && p.audio.paused && !p.done) { p.audio.currentTime = now - p.base.start; p.audio.play().catch(() => {}); }
        if (!on && !p.audio.paused) { p.audio.pause(); p.done = now >= p.at; }
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
      const base = from24(new Uint8Array(await c.punch.wav.arrayBuffer()).subarray(WAV24_HEADER));
      ({ start: at, pcm: kept } = punchIn({ start: c.punch.base.start, pcm: base }, { start, pcm: kept }, c.punch.at));
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
  async function playTake(t) {
    stopPlay();
    let wav;
    try { wav = await takeAudio(t); } catch (e) { return h.toast(`Couldn’t play the take: ${e.message}`); }
    const audio = new Audio(URL.createObjectURL(wav));
    playing = { t, audio, started: false };
    h.volume(false);
    h.seek(Math.max(0, t.start - 2));
    video.play().catch(() => {});
    render();
    const tick = () => {
      if (!playing) return;
      if (!playing.started && video.currentTime >= t.start) { playing.started = true; audio.play().catch(() => {}); }
      if (video.paused || audio.ended) { stopPlay(); return; }
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
  const pb = { ctx: null, gain: null, src: null, id: null, at: 0, from: 0, rate: 1, raf: 0, bufs: new Map() };
  const chosenList = () => takes.filter((t) => t.chosen).sort((a, z) => a.start - z.start);
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

  function silence() {
    if (pb.src) {
      try { pb.src.stop(); } catch { /* not started */ }
      pb.src.disconnect();
    }
    pb.src = null; pb.id = null;
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
  // when: on the audio clock, or 0 for now; from: seconds into the take.
  function startAt(t, buf, when, from) {
    silence();
    const src = pb.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = video.playbackRate;
    src.connect(pb.gain);
    src.start(when, from);
    Object.assign(pb, { src, id: t.id, at: when || pb.ctx.currentTime, from, rate: video.playbackRate });
  }
  function hearing() {
    cancelAnimationFrame(pb.raf);
    if (!rec || !hear || state !== 'idle' || playing || video.paused || pb.ctx?.state !== 'running') { silence(); return; }
    const now = video.currentTime, list = chosenList();
    const here = takeAt(list, now), next = nextTake(list, now, 4);
    for (const id of pb.bufs.keys()) if (id !== here?.take.id && id !== next?.id && id !== pb.id) pb.bufs.delete(id);
    if (here) {
      const buf = buffer(here.take);
      // Where the sound is now, if it's this take: put back in step if it's drifted.
      const pos = pb.id === here.take.id ? (pb.ctx.currentTime - pb.at) * pb.rate + pb.from : null;
      if (buf && (pos == null || Math.abs(pos - here.from) > DRIFT) && here.from < buf.duration - 0.02) startAt(here.take, buf, 0, here.from);
    } else if (pb.id && pb.id !== next?.id) silence();
    // The next take starts on the audio clock, at its exact moment, rather than a frame late.
    if (!here && next && pb.id !== next.id) {
      const buf = buffer(next), wait = (next.start - now) / video.playbackRate;
      if (buf && wait < 0.25) startAt(next, buf, pb.ctx.currentTime + wait, 0);
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
    const check = checkExport(blocks, chosen);
    const go = async () => {
      const media = h.duration();
      const pieces = [];
      try {
        for (const t of chosen.filter(Boolean).sort((a, z) => a.start - z.start)) pieces.push({ start: t.start, pcm: (await takeAudio(t)).slice(WAV24_HEADER) });
      } catch (e) { return h.toast(`Couldn’t get the takes: ${e.message}`); }
      const last = Math.max(0, ...chosen.filter(Boolean).map((t) => t.start + t.duration));
      const blob = buildBwf({
        takes: pieces,
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
      rec = null; takes = []; render();
    },
  };
}
