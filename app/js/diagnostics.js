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
    if (v.frames?.total) row('Frames', `${v.frames.total} shown, ${v.frames.dropped} dropped (${(100 * v.frames.dropped / v.frames.total).toFixed(1)}%)`);
  }

  L.push('', 'Performance');
  const w = info.waveform;
  if (w) row('Waveform', w.building ? `building, ${w.building}` : w.kept ? 'from the saved copy' : w.ms ? `built in ${secs(w.ms)}` : 'none');
  const j = spread(info.jumps || []);
  row('Jumps', j ? `last ${j.n}: typical ${secs(j.typical)}, slowest ${secs(j.slowest)}` : 'none yet');
  const lt = info.longTasks;
  if (lt) row('Long tasks', lt.count ? `${lt.count} in the last ${lt.minutes} min, longest ${Math.round(lt.longest)} ms` : `none in the last ${lt.minutes} min`);

  const log = info.log || [];
  L.push('', `Recent messages${log.length ? ', newest last' : ''}`);
  if (!log.length) L.push(pad('') + 'none');
  for (const e of log.slice(-50)) L.push(`  ${ago(info.now - e.at).padStart(8)}  ${e.kind.padEnd(8)} ${e.text}`);

  const text = L.join('\n') + '\n';
  return names ? text : hideNames(text, info.names || []);
}
