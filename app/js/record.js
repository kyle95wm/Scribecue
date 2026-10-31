// Record mode: the narrator records each line against the video, keeps every take, and
// exports the chosen ones as one WAV for the mixer. The script is locked (app.js sees to
// that); this file does the recording. The plan is in RECORDING.md.

import { slots, peakDb, judgePeak, runsOver, checkExport, exportReport, recordingId, placeTake, looksBluetooth, narrationNote, PREROLL, RATE } from './recording.js';
import { to24, wav24, buildBwf, WAV24_HEADER } from './bwf.js';
import { listTakes, saveTake, chooseTake, deleteTake } from './takestore.js';

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
    count: $('recCount'), dlg: $('recExportDlg'), report: $('recReport'), go2: $('recExportGo'), title: $('recExportTitle') };

  let rec = null;            // { id, start, fps, media }
  let takes = [];            // every take of this recording
  let state = 'idle';        // idle | arming | lead | rec | saving
  let cap = null;            // { stream, ctx, node, chunks, t0, slot, prevEnd, block, inLatency }
  let level = 0, hold = 0;   // meter: current and held peak, 0…1
  let raf = 0, playing = null, warned = new Set();
  let leadSecs = LEAD.includes(+get('lead')) ? +get('lead') : 3;
  let syncMs = get('sync') != null ? +get('sync') : null; // null: use the browser's figure
  let wasPlaying = false;

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
    const i = h.selIdx(), n = h.blocks().length;
    const done = h.blocks().filter((_, k) => chosenFor(k)).length;
    el.count.textContent = rec ? `${done} of ${n} lines have a take` : '';
    el.takes.replaceChildren();
    if (i < 0) { const li = document.createElement('li'); li.className = 'dim'; li.textContent = 'Select a line to record it.'; el.takes.append(li); return; }
    const slot = sl()[i];
    const list = blockTakes(i);
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'dim';
      li.textContent = `Line ${i + 1} has no takes yet. Press Enter or R to record it.`;
      el.takes.append(li);
    }
    list.forEach((t, k) => {
      const li = document.createElement('li');
      const j = judgePeak(t.peak), over = runsOver(t, slot);
      li.className = 'take' + (over ? ' over' : '');
      const use = document.createElement('input');
      use.type = 'radio'; use.name = 'recUse'; use.checked = t.chosen; use.setAttribute('aria-label', `Use take ${k + 1} in the export`);
      use.addEventListener('change', async () => { await chooseTake(rec.id, t.id); await reload(); });
      const name = document.createElement('span');
      name.textContent = `Take ${k + 1} · ${t.duration.toFixed(1)} s`;
      const lvl = document.createElement('span');
      lvl.className = 'lvl ' + j;
      lvl.textContent = `${isFinite(t.peak) ? t.peak.toFixed(1) : '−∞'} dBFS, ${LEVEL_WORDS[j]}`;
      li.append(use, name, lvl);
      if (over) { const o = document.createElement('span'); o.className = 'lvl loud'; o.textContent = 'runs past its slot'; li.append(o); }
      const play = document.createElement('button');
      play.textContent = playing?.t.id === t.id ? 'Stop' : 'Play';
      play.addEventListener('click', () => (playing?.t.id === t.id ? stopPlay() : playTake(t)));
      const del = document.createElement('button');
      del.textContent = 'Delete'; del.setAttribute('aria-label', `Delete take ${k + 1}`);
      del.addEventListener('click', async () => {
        if (!confirm(`Delete take ${k + 1} of line ${i + 1}? This can’t be undone.`)) return;
        stopPlay();
        await deleteTake(t.id);
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
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: id ? { ...base, deviceId: { exact: id } } : base });
    } catch (e) {
      if (id && e.name === 'OverconstrainedError') stream = await navigator.mediaDevices.getUserMedia({ audio: base });
      else throw e;
    }
    const ctx = new AudioContext({ sampleRate: RATE, latencyHint: 'interactive' });
    await ctx.resume(); // a context made after waiting for the microphone may start suspended
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

  async function begin() {
    const i = h.selIdx();
    if (i < 0) return h.toast('Select a line, then record it');
    if (!h.hasVideo()) return h.toast('Open the video first');
    stopPlay();
    state = 'arming'; status('Getting the microphone…'); render();
    try { await arm(); } catch (e) {
      state = 'idle'; disarm(); render();
      return h.toast(e.name === 'NotAllowedError' ? 'Scribecue needs permission to use the microphone' : `Couldn’t use the microphone: ${e.message}`);
    }
    const s = sl()[i];
    cap.block = i; cap.slot = s; cap.prevEnd = i ? sl()[i - 1].end : 0; cap.t0 = Math.max(0, s.start - PREROLL);
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
      if (state === 'lead') status(`Starts in ${Math.ceil(Math.max(0, cap.slot.start - video.currentTime))} s: set your level`);
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
    if (samples.length < RATE * 0.3) { state = 'idle'; status(wasRec ? 'Too short to keep: nothing saved' : 'Stopped before the line: nothing saved'); render(); return; }
    // The sound reaches the narrator late and reaches Scribecue late: take both off.
    const delay = c.inLatency + (syncMs != null ? syncMs / 1000 : c.outLatency);
    const { start, skip } = placeTake({ t0: c.t0, delay, prevEnd: c.prevEnd });
    const kept = samples.subarray(skip);
    const take = { id: crypto.randomUUID(), rec: rec.id, block: c.block, start, duration: kept.length / RATE,
      peak: peakDb(kept), made: Date.now(), wav: wav24(to24(kept), RATE) };
    try { await saveTake(take, true); } catch (e) {
      state = 'idle'; render();
      return h.toast(`Couldn’t keep the take: ${e.message}. The browser’s storage may be full`);
    }
    state = 'idle';
    await reload();
    const j = judgePeak(take.peak);
    status(`Saved take ${blockTakes(c.block).length}: ${isFinite(take.peak) ? take.peak.toFixed(1) : '−∞'} dBFS, ${LEVEL_WORDS[j]}`);
    if (j === 'loud') h.toast('That take is too loud. Lower your gain and record it again: the export won’t go ahead with it');
  }

  const toggle = () => {
    if (!rec) return;
    if (state === 'idle') begin(); else finish();
  };
  el.go.addEventListener('click', toggle);

  // ---- meter
  const ctx2 = el.meter.getContext('2d');
  function drawMeter() {
    const w = el.meter.width, hgt = el.meter.height;
    ctx2.clearRect(0, 0, w, hgt);
    const x = (db) => Math.round((Math.max(-48, Math.min(0, db)) + 48) / 48 * w);
    ctx2.fillStyle = 'rgba(80,200,120,.25)'; ctx2.fillRect(x(-12), 0, x(-8) - x(-12), hgt); // the target zone
    ctx2.fillStyle = 'rgba(230,80,70,.25)'; ctx2.fillRect(x(-6), 0, w - x(-6), hgt);
    const db = level > 0 ? 20 * Math.log10(level) : -48;
    ctx2.fillStyle = db > -6 ? '#e65046' : db >= -16 ? '#50c878' : '#6c8ba8';
    ctx2.fillRect(0, 3, x(db), hgt - 6);
    hold = Math.max(level, hold * 0.97);
    if (hold > 0) { ctx2.fillStyle = '#fff'; ctx2.fillRect(x(20 * Math.log10(hold)), 0, 2, hgt); }
    level *= 0.85;
  }

  // ---- playing a take back, against the video where it was read
  function playTake(t) {
    stopPlay();
    const audio = new Audio(URL.createObjectURL(t.wav));
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
    const go = () => {
      const media = h.duration();
      const last = Math.max(0, ...chosen.filter(Boolean).map((t) => t.start + t.duration));
      const blob = buildBwf({
        takes: chosen.filter(Boolean).sort((a, z) => a.start - z.start).map((t) => ({ start: t.start, pcm: t.wav.slice(WAV24_HEADER) })),
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
    el.title.textContent = stopped ? 'Retake these lines first' : 'Export with these notes?';
    el.report.textContent = exportReport(check) + (stopped ? '\n\nThe export won’t go ahead until the lines marked STOPPED are retaken.' : '\n\nSend this with the WAV.');
    el.go2.hidden = stopped;
    el.go2.onclick = () => { el.dlg.close(); go(); };
    el.dlg.showModal();
  }
  $('recExportCancel').addEventListener('click', () => el.dlg.close());

  // ---- opening and leaving
  return {
    get active() { return state !== 'idle'; },
    get open() { return !!rec; },
    toggle, exportWav, finish, render,
    stopPlayback: stopPlay,
    async open(file) {
      rec = { ...file, id: recordingId(file) };
      state = 'idle';
      status(''); devices();
      await reload();
    },
    async close() {
      if (state === 'lead' || state === 'rec') await finish();
      stopPlay();
      if (test) syncTest();
      h.volume(false);
      rec = null; takes = []; render();
    },
  };
}
