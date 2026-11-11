// Diagnostics: what to send with a problem report, gathered in this browser and shown in
// Settings to copy or save. Nothing is sent anywhere. Recent errors, warnings and messages
// are kept in memory only, and file names are left out unless asked for.

export const MAX_LOG = 200;
const MAX_TEXT = 500;

// The last `max` things that happened: { at, kind, text }. kind: 'error', 'warning' or 'message'.
export function createLog(max = MAX_LOG, clock = () => Date.now()) {
  const entries = [];
  return {
    add(kind, text) {
      const t = String(text ?? '').replace(/\s+/g, ' ').trim();
      if (!t) return;
      entries.push({ at: clock(), kind, text: t.length > MAX_TEXT ? t.slice(0, MAX_TEXT - 1) + '…' : t });
      if (entries.length > max) entries.splice(0, entries.length - max);
    },
    get entries() { return entries.slice(); },
  };
}

// One line for anything thrown or logged.
export function describe(v) {
  if (v instanceof Error || (v && typeof v === 'object' && 'message' in v && 'name' in v)) return `${v.name}: ${v.message}`;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
}

// Adds the page's errors, and what it logs as errors and warnings, to the log. The console
// still shows them as before.
export function watchErrors(log, w = globalThis) {
  w.addEventListener?.('error', (e) => {
    if (!e.message) return; // a file that failed to load, already reported where it's used
    const where = e.filename ? ` (${e.filename.replace(/^.*\//, '')}:${e.lineno})` : '';
    log.add('error', e.message + where);
  });
  w.addEventListener?.('unhandledrejection', (e) => log.add('error', describe(e.reason)));
  for (const [level, kind] of [['error', 'error'], ['warn', 'warning']]) {
    const real = w.console?.[level];
    if (!real) continue;
    w.console[level] = (...args) => { log.add(kind, args.map(describe).join(' ')); real.apply(w.console, args); };
  }
}

// Typical and slowest of some durations, in ms.
export function spread(ms) {
  if (!ms.length) return null;
  const s = [...ms].sort((a, b) => a - b);
  return { n: s.length, typical: s[Math.floor((s.length - 1) / 2)], slowest: s[s.length - 1] };
}

// How long a picture can stay the same while the film moves on, in seconds of film.
export const FREEZE_AFTER = 3;
const MOVED = 0.5, JUMPED = 1, STEP = 1, KEEP = 20;

// Whether the picture really changes, which the browser's own events can't say: a decoder
// can finish a jump, and the sound can play on, with the same frame on screen. Fed from the
// video's events, with times in seconds of film and `at` in ms. Nothing here runs per frame.
export function pictureWatch() {
  const jumps = [];
  let frameTime = null, lastTime = null, jumpAt = null, stuck = 0, freezes = 0, longest = 0;
  const thaw = () => {
    if (stuck >= FREEZE_AFTER) { freezes++; longest = Math.max(longest, stuck); }
    stuck = 0;
  };
  return {
    get jumping() { return jumpAt != null; },
    // A picture was shown. During a jump, only one from somewhere else ends it.
    frame(time, at) {
      thaw();
      const moved = frameTime == null || Math.abs(time - frameTime) >= MOVED;
      frameTime = time;
      lastTime = time;
      if (jumpAt == null || !moved) return;
      jumps.push(at - jumpAt);
      if (jumps.length > KEEP) jumps.shift();
      jumpAt = null;
    },
    // The film has reached `time` while playing. Steps are capped, so a page that was busy
    // for a while doesn't look like a frozen picture.
    playing(time) {
      if (lastTime != null && time > lastTime) stuck += Math.min(time - lastTime, STEP);
      lastTime = time;
    },
    // A jump began. A small step may land on the same frame, so no new picture comes.
    jump(time, at) {
      thaw();
      if (jumpAt == null && (lastTime == null || Math.abs(time - lastTime) >= JUMPED)) jumpAt = at;
      lastTime = time;
    },
    rest() { thaw(); lastTime = null; },
    // Out of sight the browser stops showing frames, so nothing can be measured.
    away() { this.rest(); jumpAt = null; },
    clear() { frameTime = lastTime = jumpAt = null; stuck = freezes = longest = 0; jumps.length = 0; },
    info(at) {
      const now = stuck >= FREEZE_AFTER ? stuck : 0;
      return { jumps: jumps.slice(), waiting: jumpAt == null ? 0 : at - jumpAt, freezes: freezes + (now ? 1 : 0), longest: Math.max(longest, now), frozen: !!now };
    },
  };
}

// Each name in the text, as ‹file›: whole words only, so a film called "Short" leaves
// "shortcuts" alone.
export function hideNames(text, names) {
  let out = text;
  for (const n of [...names].sort((a, b) => b.length - a.length)) {
    if (!n || n.length < 3) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'giu');
    out = out.replace(re, '‹file›');
  }
  return out;
}

const secs = (ms) => (ms < 1e3 ? `${Math.round(ms)} ms` : ms < 10e3 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`);
const size = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.round(b / 1e3)} KB`);
const clock = (s) => {
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
};
const ago = (ms) => `−${clock(Math.max(0, ms) / 1000)}`;
const pad = (label) => `  ${label.padEnd(13)}`;
const two = (n) => String(n).padStart(2, '0');

// The report, as plain text. info is gathered by the page (see diagnosticsInfo in app.js);
// any part can be missing. names: whether file names stay in.
export function report(info, { names = false } = {}) {
  const L = [];
  const row = (label, value) => { if (value != null && value !== '') L.push(pad(label) + value); };
  const d = new Date(info.now);
  L.push('Scribecue diagnostics');
  L.push(`Made ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`);

  const a = info.app || {};
  L.push('', 'App');
  row('Version', [a.version, a.web ? 'web version' : 'run with Docker', a.installed && 'installed app'].filter(Boolean).join(', '));
  row('Mode', a.mode);

  const b = info.browser || {};
  L.push('', 'Computer');
  row('Browser', b.name);
  row('System', b.platform);
  row('CPU cores', b.cores);
  if (b.memory) row('Memory', b.memory >= 8 ? '8 GB or more' : `${b.memory} GB`);
  if (b.screen) row('Screen', `${b.screen} at ${b.dpr}×`);
  if (info.storage) row('Storage', `${size(info.storage.used)} used of ${size(info.storage.quota)}`);

  const v = info.video;
  L.push('', 'Video');
  if (!v) L.push(pad('') + 'none open');
  else {
    row('File', names ? v.name : '(name left out)');
    row('Size', [v.bytes && size(v.bytes), v.duration && clock(v.duration)].filter(Boolean).join(', '));
    row('Picture', [v.width && `${v.width}×${v.height}`, v.codec, v.fps && `${+v.fps.toFixed(3)} fps`].filter(Boolean).join(', '));
    if (v.decode?.supported === false) row('Decoding', 'this browser says it can’t decode this video');
    else if (v.decode) row('Decoding', `${v.decode.smooth ? 'smooth' : 'not smooth'}, ${v.decode.powerEfficient ? 'power-efficient (likely the graphics chip)' : 'not power-efficient (likely without the graphics chip)'}`);
    if (v.audio?.length) row('Audio', v.audio.join(', ') + (v.separate ? '; the chosen track plays alongside the video' : ''));
    if (v.frames?.total) row('Frames', `${Math.max(0, v.frames.total - v.frames.dropped)} shown, ${v.frames.dropped} dropped (${(100 * v.frames.dropped / v.frames.total).toFixed(1)}%)`);
  }

  L.push('', 'Performance');
  const w = info.waveform;
  if (w) row('Waveform', w.building ? `building, ${w.building}` : w.kept ? 'from the saved copy' : w.ms ? `built in ${secs(w.ms)}` : 'none');
  const j = spread(info.jumps || []);
  row('Jumps', j ? `last ${j.n}: typical ${secs(j.typical)}, slowest ${secs(j.slowest)}` : 'none yet');
  const p = info.picture;
  if (p) {
    const shown = spread(p.jumps), late = p.waiting >= 1e3 ? `not shown yet after ${secs(p.waiting)}` : '';
    row('Jump picture', [shown ? `last ${shown.n}: typical ${secs(shown.typical)}, slowest ${secs(shown.slowest)}` : !late && 'none yet', late].filter(Boolean).join('; '));
    row('Frozen video', p.freezes ? `${p.freezes} while playing, longest ${secs(p.longest * 1e3)}${p.frozen ? ', frozen now' : ''}` : 'none while playing');
  }
  const lt = info.longTasks;
  if (lt) row('Long tasks', lt.count ? `${lt.count} in the last ${lt.minutes} min, longest ${Math.round(lt.longest)} ms` : `none in the last ${lt.minutes} min`);

  const log = info.log || [];
  L.push('', `Recent messages${log.length ? ', newest last' : ''}`);
  if (!log.length) L.push(pad('') + 'none');
  for (const e of log.slice(-50)) L.push(`  ${ago(info.now - e.at).padStart(8)}  ${e.kind.padEnd(8)} ${e.text}`);

  const text = L.join('\n') + '\n';
  return names ? text : hideNames(text, info.names || []);
}

// The same report as in Settings, for a tool driving the browser, such as Claude Code's
// browser, to read without opening Settings: `await scribecueDiagnostics()`. It only reads.
// File names are left out unless { names: true } is passed. gather is diagnosticsInfo.
export function exposeReport(gather, w = globalThis) {
  Object.defineProperty(w, 'scribecueDiagnostics', {
    value: async ({ names = false } = {}) => report(await gather(), { names: names === true }),
    configurable: true,
  });
}
