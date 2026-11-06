// Plays only the short readings needed now. Original audio may overlap a block's end,
// so each active reading has its own player; the programme can keep playing underneath.
export function createQcPlayer({ now, duck, error }) {
  let entries = [], file = null, cursor = 0, last = null, longest = 0, ctx = null, limit = null;
  const active = new Map();
  function drop(id) {
    const p = active.get(id); if (!p) return;
    const done = p.done;
    p.audio.onended = p.audio.onerror = p.audio.onloadedmetadata = null;
    p.audio.pause(); p.audio.removeAttribute('src'); p.audio.load(); p.node?.disconnect(); p.gain?.disconnect(); URL.revokeObjectURL(p.url); active.delete(id);
    duck(active.size > 0);
    done?.();
  }
  function stop() { for (const id of [...active.keys()]) drop(id); last = null; }
  function unlock() {
    try {
      if (!ctx) { ctx = new AudioContext(); limit = ctx.createDynamicsCompressor(); limit.threshold.value = -3; limit.knee.value = 0; limit.ratio.value = 20; limit.connect(ctx.destination); }
      ctx.resume().catch(() => {});
    } catch { /* a browser without Web Audio can still play at normal level */ }
  }
  function configure(nextFile, nextEntries) {
    if (file === nextFile && nextEntries.length === entries.length && nextEntries.every((r, i) => r.key === entries[i].key && r.start === entries[i].start && r.gain === entries[i].gain && r.dip === entries[i].dip && r.dipBy === entries[i].dipBy && r.held === entries[i].held)) return;
    stop(); file = nextFile; entries = nextEntries; longest = entries.reduce((m, r) => Math.max(m, r.secs), 0);
  }
  // held: an extended block's whole reading, with the clock stopped. done: as it ends.
  function add(r, rate, level, done = null) {
    const url = URL.createObjectURL(file.slice(r.offset, r.offset + r.bytes, 'audio/wav')), audio = new Audio();
    const p = { audio, url, done }; active.set(r.id, p);
    if (ctx) { p.node = ctx.createMediaElementSource(audio); p.gain = ctx.createGain(); p.node.connect(p.gain); p.gain.connect(limit); }
    const gain = level * r.gain;
    if (p.gain) p.gain.gain.value = gain; else audio.volume = Math.min(1, gain);
    audio.playbackRate = rate; audio.preservesPitch = true;
    audio.onended = () => drop(r.id);
    audio.onerror = () => { drop(r.id); error('A packaged reading could not play. Ask the writer for a fresh QC package'); };
    audio.onloadedmetadata = () => {
      if (active.get(r.id) !== p) return;
      const offset = done ? 0 : Math.max(0, now() - r.start);
      if (offset >= audio.duration) return drop(r.id);
      audio.currentTime = offset; duck(true);
      audio.play().catch(() => { if (active.get(r.id) === p) { drop(r.id); error('Click Play to allow original QC readings to play'); } });
    };
    audio.src = url;
  }
  function sync(t, playing, rate, level) {
    if (!playing || !file) { if (active.size) stop(); return; }
    if (last == null || t < last || t - last > 0.5) {
      stop();
      // A seek need only inspect readings that could still be sounding.
      let lo = 0, hi = entries.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (entries[mid].start < t - longest) lo = mid + 1; else hi = mid; }
      cursor = lo;
    }
    while (cursor < entries.length && entries[cursor].start <= t) {
      const r = entries[cursor++]; if (!r.held && r.start + r.secs > t) add(r, rate, level);
    }
    for (const [id, p] of active) {
      const r = entries[id];
      p.audio.playbackRate = rate;
      const gain = level * r.gain; if (p.gain) p.gain.gain.value = gain; else p.audio.volume = Math.min(1, gain);
    }
    last = t;
  }
  const has = (uid) => entries.some((r) => r.uid === uid);
  function hold(uid, rate, level, done) { stop(); add(entries.find((r) => r.uid === uid), rate, level, done); }
  return { configure, sync, stop, unlock, has, hold, activeCount: () => active.size, activeReadings: () => [...active.keys()].map((id) => entries[id]) };
}
