// Goes through all of Scribecue with a two-hour film and a big script, in headless Linux
// Chromium that's muted and runs inside scripts/slow-chromium.sh's container. For each
// step it reports how long it took, the page's long tasks, the longest gap between
// frames, the slowest response to a key or click, and memory.
// Readings come from a stand-in for Piper, so no voice is needed and timings are steady.
// Usage: scripts/slow-chromium.sh tour [cpus] [blocks] [slowdown] [sections]
// Sections: waveform, write, modes, panels, tts, exports, record (default: all of them).
// PROFILE=<pattern> also shows where the time went in the steps it matches.
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';

const [,, film, blocksArg = '1500', rateArg = '6', onlyArg = '', outFile = ''] = process.argv;
const BLOCKS = +blocksArg, RATE = +rateArg, only = onlyArg ? new Set(onlyArg.split(',')) : null;
const FILM_SECS = 7200;
const APP = new URL('../app/', import.meta.url).pathname;
const GUIDES = new URL('../Guides/', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };

// A silent-ish WAV as long as the words would take, like Piper's answer.
function reading(words) {
  const rate = 22050, n = Math.round(Math.max(0.5, words.length / 15) * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(6000 * Math.sin(i * 0.05)), 44 + i * 2);
  return b;
}

const server = createServer(async (req, res) => {
  const body = await new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/tts/voices') return res.end(JSON.stringify({ 'en_US-lessac-medium': {} }));
  if (path === '/tts/synthesize') {
    await sleep(120); // about what a short line takes Piper
    res.setHeader('content-type', 'audio/wav');
    return res.end(reading(JSON.parse(body).text));
  }
  if (path.endsWith('/')) path += 'index.html';
  try {
    const safe = normalize(path).replace(/^(\.\.[/\\])+/, '');
    const guide = safe.startsWith('/guides/') && safe.slice(8);
    const data = await readFile(guide === 'README.md' ? join(GUIDES, '../README.md') : guide ? join(GUIDES, guide) : join(APP, safe));
    res.setHeader('content-type', TYPES[path.slice(path.lastIndexOf('.'))] || 'application/octet-stream');
    res.end(data);
  } catch { res.statusCode = 404; res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));

const profile = await mkdtemp(join(tmpdir(), 'chromium-'));
const browser = spawn('chromium', ['--headless=new', '--mute-audio', '--no-sandbox', '--no-first-run',
  '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  '--enable-precise-memory-info', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((ok, no) => {
  let err = '';
  browser.stderr.on('data', (d) => { err += d; const m = /DevTools listening on (ws:\S+)/.exec(err); if (m) ok(m[1]); });
  setTimeout(() => no(Error(`Chromium didn’t start: ${err.slice(-400)}`)), 60e3);
});
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
const pageErrors = [];
let traceEvents = [], traceDone = null;
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); }
  if (m.method === 'Tracing.dataCollected') traceEvents.push(...m.params.value);
  if (m.method === 'Tracing.tracingComplete') traceDone?.();
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
});
let sessionId;
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const js = async (expression) => {
  const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (m.result?.exceptionDetails) throw Error(m.result.exceptionDetails.exception?.description || m.result.exceptionDetails.text || 'script error');
  return m.result.result.value;
};
const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
({ result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true }));
const site = `http://127.0.0.1:${server.address().port}/`;

// Every long task, gap between frames and slow response on the page, from its first moment.
const PROBE = `(() => {
  if (window.__m) return;
  const m = window.__m = { long: [], gaps: [], events: [], frames: 0, late: [] };
  try { new PerformanceObserver((l) => m.long.push(...l.getEntries().map((e) => e.duration))).observe({ type: 'longtask', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => m.events.push(...l.getEntries().map((e) => [e.name, e.duration]))).observe({ type: 'event', durationThreshold: 16 }); } catch {}
  let last = 0;
  const f = (t) => { if (last) m.gaps.push(t - last); last = t; m.frames++; requestAnimationFrame(f); };
  requestAnimationFrame(f);
  // When each reading really starts, against its block.
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { if (this.id !== 'video') m.late.push(document.getElementById('video')?.currentTime ?? -1); return play.apply(this, arguments); };
  // Downloads go nowhere: the sizes are kept instead.
  m.saved = [];
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download != null && this.href.startsWith('blob:')) { m.saved.push(this.download); return; } return click.apply(this, arguments); };
  window.confirm = () => true;
  // A new tab would put this page in the background and slow its frames.
  m.opened = [];
  window.open = (u) => { m.opened.push(String(u)); return null; };
})()`;

// Memory for the whole browser, workers included, from Linux. PSS shares out what
// processes have in common, so adding it up doesn't count anything twice.
function pssMB() {
  try {
    const out = execSync(`for p in $(pgrep -f chromium); do cat /proc/$p/smaps_rollup 2>/dev/null; done | awk '/^Pss:/ { s += $2 } END { print s }'`, { shell: '/bin/sh' });
    return Math.round(+out / 1024);
  } catch { return 0; }
}
let peakPss = 0, stepPeak = 0;
const watcher = setInterval(() => { const now = pssMB(); peakPss = Math.max(peakPss, now); stepPeak = Math.max(stepPeak, now); }, 1000);

const results = [];
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };
async function reset() { await js(`(() => { const m = window.__m; m.long.length = m.gaps.length = m.events.length = m.late.length = 0; })()`); }
async function collect() {
  // Lets the responses to the last keys and clicks arrive.
  await js('new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50)))');
  return js(`(() => { const m = window.__m; return { long: m.long.splice(0), gaps: m.gaps.splice(0), events: m.events.splice(0),
    heap: performance.memory.usedJSHeapSize, hidden: document.hidden || !document.hasFocus(),  nodes: document.getElementsByTagName('*').length }; })()`);
}
// Chrome makes up hover events after a scroll, carrying the time of the last real mouse
// move, so they look slow however quick the page is. Only what someone did counts.
const HOVER = /^(pointer|mouse)(over|out|enter|leave|move)$/;
function row(name, ms, s, note = '') {
  const felt = s.events.filter((e) => !HOVER.test(e[0]));
  const r = {
    name, ms: Math.round(ms), longTasks: s.long.length, longestTask: Math.round(Math.max(0, ...s.long)),
    blocked: Math.round(s.long.reduce((a, b) => a + Math.max(0, b - 50), 0)),
    worstGap: Math.round(Math.max(0, ...s.gaps)), p95Gap: Math.round(pct(s.gaps, 0.95)),
    worstResponse: Math.round(Math.max(0, ...felt.map((e) => e[1]))), responses: felt.length,
    heapMB: Math.round(s.heap / 1048576), pssMB: Math.max(pssMB(), stepPeak), note,
  };
  results.push(r);
  if (s.hidden) r.note += ' [page hidden]';
  console.log(`${name.padEnd(44)} ${String(r.ms).padStart(7)} ms | long ${String(r.longTasks).padStart(3)}, max ${String(r.longestTask).padStart(5)} | gap ${String(r.worstGap).padStart(5)} | resp ${String(r.worstResponse).padStart(5)} | heap ${String(r.heapMB).padStart(4)} | pss ${String(r.pssMB).padStart(5)}${note ? ` | ${note}` : ''}`);
  return r;
}
// PROFILE=<pattern> prints where the time went in the steps whose names match.
const PROFILE = process.env.PROFILE ? new RegExp(process.env.PROFILE, 'i') : null;
async function topFunctions(name) {
  await new Promise((r) => { traceDone = r; send('Tracing.end'); });
  const main = traceEvents.find((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
  const tally = new Map();
  for (const e of traceEvents) if (e.ph === 'X' && e.tid === main?.tid && e.pid === main?.pid && e.dur) tally.set(e.name, (tally.get(e.name) || [0, 0]).map((v, i) => v + [e.dur / 1000, 1][i]));
  const wanted = [...tally].filter(([k]) => !/^(ThreadControllerImpl|Scheduler|RunTask|SequenceManager|ThreadPool|EventDispatch|FunctionCall|v8\.|V8\.|TimerFire|FireAnimationFrame|EvaluateScript|HandlePostMessage)/.test(k)).sort((a, b) => b[1][0] - a[1][0]).slice(0, 22);
  const lays = traceEvents.filter((e) => e.name === 'Layout' && e.tid === main?.tid && e.args?.beginData);
  const sum = (f) => lays.reduce((t, e) => t + f(e), 0);
  if (lays.length) {
    console.log(`  -- ${lays.length} layouts: ${Math.round(sum((e) => e.dur / 1000))} ms, average ${Math.round(sum((e) => e.args.beginData.dirtyObjects) / lays.length)} of ${Math.round(sum((e) => e.args.beginData.totalObjects) / lays.length)} objects dirty`);
    const big = [...lays].sort((x, y) => y.dur - x.dur).slice(0, 3);
    for (const e of big) console.log(`     ${Math.round(e.dur / 1000)} ms, ${e.args.beginData.dirtyObjects} dirty of ${e.args.beginData.totalObjects}, partial ${e.args.beginData.partialLayout}, stack ${(e.args.beginData.stackTrace || []).slice(0, 2).map((f) => `${f.functionName}:${f.lineNumber}`).join(' < ')}`);
  }
  // The longest tasks, and what took the time inside them.
  const tasks = traceEvents.filter((e) => e.ph === 'X' && e.tid === main?.tid && e.pid === main?.pid && e.name === 'RunTask' && e.dur > 100e3).sort((x, y) => y.dur - x.dur).slice(0, 4);
  for (const t of tasks) {
    console.log(`  -- task of ${Math.round(t.dur / 1000)} ms`);
    const inside = traceEvents.filter((e) => e !== t && e.ph === 'X' && e.tid === t.tid && e.pid === t.pid && e.ts >= t.ts && e.ts + e.dur <= t.ts + t.dur && e.dur > t.dur / 12 && !/^(ThreadControllerImpl|SequenceManager|Scheduler)/.test(e.name));
    for (const e of inside.slice(0, 16)) console.log(`     +${String(Math.round((e.ts - t.ts) / 1000)).padStart(5)} ${String(Math.round(e.dur / 1000)).padStart(5)} ms  ${e.name}${e.args?.data?.type ? ` ${e.args.data.type}` : ''}${e.args?.data?.functionName ? ` ${e.args.data.functionName}` : ''}`);
  }
  console.log('  -- browser work');
  for (const [k, [ms, n]] of wanted) console.log(`     ${String(Math.round(ms)).padStart(7)} ms  ${n} × ${k}`);
  const { result: { profile: p } } = await send('Profiler.stop');
  const self = new Map(), byId = new Map(p.nodes.map((n) => [n.id, n]));
  p.samples.forEach((sid, i) => {
    const n = byId.get(sid), c = n.callFrame, k = `${c.functionName || '(anonymous)'} ${c.url.split('/').pop()}:${c.lineNumber + 1}`;
    self.set(k, (self.get(k) || 0) + (p.timeDeltas[i] || 0) / 1000);
  });
  const top = [...self].filter(([k]) => !/^\((idle|root)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 14);
  console.log(`  -- ${name}`);
  for (const [k, ms] of top) console.log(`     ${String(Math.round(ms)).padStart(7)} ms  ${k}`);
}
async function step(name, fn) {
  await reset();
  stepPeak = 0;
  const profiled = PROFILE?.test(name);
  if (profiled) { traceEvents = []; await send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'cc', 'blink.user_timing'], excludedCategories: ['*'] } }); await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 500 }); await send('Profiler.start'); }
  const t0 = Date.now();
  let note;
  try { note = await fn(); if (profiled) await topFunctions(name); } catch (e) {
    const s = await collect().catch(() => ({ long: [], gaps: [], events: [], heap: 0 }));
    return row(name, Date.now() - t0, s, `FAILED: ${String(e.message).split('\n')[0].slice(0, 160)}`);
  }
  const ms = Date.now() - t0;
  const got = await collect();
  if (profiled) console.log(`  -- slowest responses: ${got.events.filter((e) => !HOVER.test(e[0])).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([n, d]) => `${n} ${Math.round(d)}`).join(', ')}`);
  return row(name, ms, got, note || '');
}
const section = (name) => { if (only && !only.has(name)) return false; console.log(`\n== ${name}`); return true; };

// Real input, through the browser, as a person's would come.
const MODS = { alt: 1, ctrl: 2, cmd: 4, shift: 8 };
async function press(key, code, { mods = 0, text } = {}) {
  await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code, text, unmodifiedText: text, modifiers: mods, windowsVirtualKeyCode: VK[code] ?? key.toUpperCase().charCodeAt(0) });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers: mods, windowsVirtualKeyCode: VK[code] ?? key.toUpperCase().charCodeAt(0) });
}
const VK = { Enter: 13, Escape: 27, Space: 32, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Delete: 46, Backspace: 8, PageDown: 34, Comma: 188, Period: 190 };
async function type(text, gap = 90) {
  for (const ch of text) {
    const code = ch === ' ' ? 'Space' : `Key${ch.toUpperCase()}`;
    await press(ch, code, { text: ch });
    await sleep(gap);
  }
}
const mouse = (type, x, y, o = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...o });
const box = (sel) => js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
async function clickAt(sel) { const b = await box(sel); const x = b.x + b.w / 2, y = b.y + b.h / 2; await mouse('mousePressed', x, y, { clickCount: 1, buttons: 1 }); await mouse('mouseReleased', x, y, { clickCount: 1 }); }
const click = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).click(); 1`);
const until = async (expr, secs = 60, every = 100) => {
  const t0 = Date.now();
  while (Date.now() - t0 < secs * 1000) { if (await js(expr)) return Date.now() - t0; await sleep(every); }
  throw Error(`Timed out: ${expr}`);
};
const closeDialogs = () => js(`document.querySelectorAll('dialog[open]').forEach((d) => d.close()); 1`);
const setMode = (m) => click(`#modeSw [data-mode=${m}]`);
const seekTo = (t) => js(`new Promise((r) => { const v = document.getElementById('video'); const done = () => r(1); v.addEventListener('seeked', done, { once: true }); setTimeout(done, 8000); v.currentTime = ${t}; })`);
const playback = async (secs) => {
  await js(`(() => { const v = document.getElementById('video'); window.__q0 = v.getVideoPlaybackQuality(); window.__p0 = performance.now(); window.__v0 = v.currentTime; })()`);
  await press(' ', 'Space', { text: ' ' });
  await sleep(secs * 1000);
  const r = await js(`(() => { const v = document.getElementById('video'), q = v.getVideoPlaybackQuality(); const secs = (performance.now() - __p0) / 1000;
    const got = { paused: v.paused, moved: v.currentTime - __v0, secs, total: q.totalVideoFrames - __q0.totalVideoFrames, dropped: q.droppedVideoFrames - __q0.droppedVideoFrames }; return got; })()`);
  await press(' ', 'Space', { text: ' ' });
  return `${(r.moved / r.secs * 100).toFixed(0)}% of real time, ${r.dropped} of ${r.total} frames dropped`;
};

// A big script: a block about every five seconds, each about a line long.
const WORDS = 'the camera drifts over a quiet harbour while gulls wheel above grey water and a figure in a long coat walks along the wall towards the lighthouse'.split(' ');
const script = Array.from({ length: BLOCKS }, (_, i) => {
  const start = 20 + i * (FILM_SECS - 60) / BLOCKS, words = 8 + (i * 7) % 11;
  const text = Array.from({ length: words }, (_, k) => WORDS[(i * 3 + k) % WORDS.length]).join(' ');
  return { start: +start.toFixed(2), end: +(start + 3.2).toFixed(2), text: text[0].toUpperCase() + text.slice(1) + '.' };
});

const SETTINGS = { proof: '{"warn":false}', welcome: '1', seenVersion: '999.0.0', updates: '0', mode: 'write', setupModes: '{"write":true,"transcribe":true,"qc":true,"record":true}', loops: '{"write":true,"transcribe":true}',
  // SHARED_COPY=1 turns on the shared copy for live sharing (shared.js).
  ...(process.env.SHARED_COPY === '1' ? { sharedCopy: '1' } : {}) };
try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Browser.setPermission', { permission: { name: 'microphone' }, setting: 'granted', origin: site.slice(0, -1) }).catch(() => {});
  await send('Page.navigate', { url: site }); await sleep(2500);
  await send('Emulation.setCPUThrottlingRate', { rate: RATE });
  await js(`for (const [k, v] of Object.entries(${JSON.stringify(SETTINGS)})) localStorage.setItem('scribecue.' + k, v);
    localStorage.setItem('scribecue.v1', ${JSON.stringify(JSON.stringify({ subName: 'big-film.scribecue', dirty: false, cues: script }))}); 1`);

  console.log(`Tour: ${BLOCKS} blocks, 2-hour film, CPU slowdown ${RATE}×`);
  console.log(`${'step'.padEnd(44)} ${'took'.padStart(10)} | long tasks      | gap (ms)   | resp (ms)  | heap MB   | pss MB`);

  console.log('\n== start');
  {
    await js('sessionStorage.__x = 1; 1');
    const t0 = Date.now();
    await send('Page.navigate', { url: site });
    await sleep(300);
    await until(`document.readyState === 'complete' && document.querySelectorAll('#list .row').length === ${BLOCKS}`, 120);
    await js('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
    row('Open the app with the script', Date.now() - t0, await collect(), `${await js(`document.getElementsByTagName('*').length`)} elements on the page`);
    await sleep(1500);
  }
  await js(`new MutationObserver(() => { if (/waveform ready/i.test(document.getElementById('toast').textContent)) window.__waveDone = true; }).observe(document.getElementById('toast'), { childList: true, characterData: true, subtree: true }); 1`);
  await step('Open the film', async () => {
    await send('DOM.enable');
    const { result: { root } } = await send('DOM.getDocument');
    const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#fileVideo' });
    await send('DOM.setFileInputFiles', { nodeId, files: [film] });
    await until(`document.getElementById('video').readyState >= 2`, 120);
  });
  await step('Playback while the waveform builds, 12 s', async () => { await seekTo(1800); await sleep(500); return playback(12); });

  if (section('waveform')) {
    await step('Rest of the waveform', async () => {
      await until('window.__waveDone === true', 900, 1000);
      return 'built in the background while nothing else was happening';
    });
  }

  if (section('write')) {
    await setMode('write'); await sleep(300);
    await step('Playback, following blocks, 15 s', async () => { await seekTo(1200); await sleep(500); return playback(15); });
    await step('Scroll the list, 30 turns of the wheel', async () => {
      const b = await box('#list');
      for (let i = 0; i < 30; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: b.x + b.w / 2, y: b.y + b.h / 2, deltaX: 0, deltaY: 400 }); await sleep(50); }
    });
    await step('Click 8 rows in the list', async () => {
      for (let i = 0; i < 8; i++) {
        const y = await js(`(() => { const rows = [...document.querySelectorAll('#list .row')]; const b = document.getElementById('list').getBoundingClientRect(); const r = rows.find((e) => { const q = e.getBoundingClientRect(); return q.top > b.top + 20 && q.bottom < b.bottom - 20 && !e.classList.contains('sel'); }); const q = r.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; })()`);
        await mouse('mousePressed', y[0], y[1], { clickCount: 1, buttons: 1 }); await mouse('mouseReleased', y[0], y[1], { clickCount: 1 });
        await sleep(350);
        await press('Escape', 'Escape');
        await sleep(100);
      }
    });
    await step('Move through 20 blocks with the arrow key', async () => {
      await js('document.activeElement?.blur(); 1');
      for (let i = 0; i < 20; i++) { await press('ArrowDown', 'ArrowDown'); await sleep(120); }
    });
    await step('Jump far through the list, there and back', async () => {
      const spot = () => js(`(() => { const r = document.querySelector('#list .row.sel'), l = document.getElementById('list').getBoundingClientRect(); if (!r) return 'nothing selected'; const q = r.getBoundingClientRect(); return Math.round(q.top - l.top) + ' px of ' + Math.round(l.height); })()`);
      await seekTo(6000); await press('c', 'KeyC', { text: 'c' }); await sleep(900); const far = await spot();
      await seekTo(100); await press('c', 'KeyC', { text: 'c' }); await sleep(900); const back = await spot();
      await seekTo(3600); await press('c', 'KeyC', { text: 'c' }); await sleep(900);
      return `selected row sits ${far} down the list, then ${back}, after jumping`;
    });
    await step('Type 40 characters in a block', async () => {
      await press('Enter', 'Enter'); await sleep(400);
      await type('a figure turns and looks back at the sea');
    });
    await step('Finish editing', async () => { await press('Escape', 'Escape'); await sleep(300); });
    await step('Nudge a block ten times', async () => { for (let i = 0; i < 10; i++) { await press('.', 'Period', { text: '.' }); await sleep(120); } });
    await step('New block, delete it, undo, redo', async () => {
      await seekTo(1300); await press('n', 'KeyN', { text: 'n' }); await sleep(400);
      await press('Escape', 'Escape'); await sleep(200);
      await press('Delete', 'Delete'); await sleep(400);
      await press('z', 'KeyZ', { mods: MODS.ctrl }); await sleep(400);
      await press('z', 'KeyZ', { mods: MODS.ctrl | MODS.shift }); await sleep(400);
    });
    await step('Split and merge a block', async () => {
      await js('document.activeElement?.blur(); 1');
      await press('x', 'KeyX', { text: 'x' }); await sleep(400);
      await press('Escape', 'Escape'); await sleep(100);
      await press('m', 'KeyM', { text: 'm' }); await sleep(400);
    });
    await step('Zoom the timeline in and out, 12 steps', async () => {
      for (let i = 0; i < 6; i++) { await click('#tlZoom [data-zoom=in]'); await sleep(120); }
      for (let i = 0; i < 6; i++) { await click('#tlZoom [data-zoom=out]'); await sleep(120); }
    });
    await step('Whole film on the timeline', async () => { await click('#tlZoom [data-zoom=fit]'); await sleep(600); });
    await step('Pan the fitted timeline', async () => {
      const b = await box('#tl');
      for (let i = 0; i < 15; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: b.x + b.w / 2, y: b.y + b.h / 2, deltaX: 200, deltaY: 0 }); await sleep(60); }
    });
    await step('Drag a block on the timeline', async () => {
      for (let i = 0; i < 5; i++) await click('#tlZoom [data-zoom=in]');
      await sleep(300);
      await js(`document.querySelector('#list .row.sel')?.scrollIntoView({ block: 'center' }); 1`);
      const c = await box('#cues .cue.sel, #cues .cue');
      const x = c.x + c.w / 2, y = c.y + c.h / 2;
      await mouse('mousePressed', x, y, { clickCount: 1, buttons: 1 });
      for (let i = 1; i <= 30; i++) { await mouse('mouseMoved', x + i * 2, y, { buttons: 1 }); await sleep(30); }
      await mouse('mouseReleased', x + 60, y, { clickCount: 1 });
    });
    await step('Search the list for a word, as you type', async () => {
      await js(`document.getElementById('listSearch').focus(); 1`);
      await type('lighthouse', 120);
      await sleep(300);
    });
    await step('Clear the search', async () => {
      await press('Escape', 'Escape'); await sleep(400);
    });
    await step('Find and replace in every block', async () => {
      await press('f', 'KeyF', { mods: MODS.alt | MODS.shift }); await sleep(300);
      await js(`(() => { const f = document.getElementById('frFind'), w = document.getElementById('frWith'); f.value = 'harbour'; f.dispatchEvent(new Event('input')); w.value = 'bay'; w.dispatchEvent(new Event('input')); })()`);
      await sleep(100);
      await click('#frAll'); await sleep(500);
      const n = await js(`document.getElementById('frCount').textContent`);
      await click('#frClose');
      return n;
    });
    await step('Undo the replace', async () => { await js('document.activeElement?.blur(); 1'); await press('z', 'KeyZ', { mods: MODS.ctrl }); await sleep(600); });
    await step('Quick navigation: open, search, go', async () => {
      await press('F', 'KeyF', { mods: MODS.shift, text: 'F' }); await sleep(300);
      await type('gulls', 120); await sleep(200);
      await press('Enter', 'Enter'); await sleep(300);
      await press('Escape', 'Escape');
    });
  }

  if (section('modes')) {
    for (const m of ['transcribe', 'qc', 'write']) await step(`Change to ${m}`, async () => { await setMode(m); await sleep(500); });
    await step('Mark a block with H, playing', async () => {
      await setMode('transcribe'); await sleep(400);
      await seekTo(2400);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'h', code: 'KeyH', text: 'h', windowsVirtualKeyCode: 72 });
      await sleep(2500);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'h', code: 'KeyH', windowsVirtualKeyCode: 72 });
      await sleep(500);
      await press('Escape', 'Escape');
    });
    await step('Playback in Transcribe, 10 s', async () => { await seekTo(1500); await sleep(400); return playback(10); });
    await setMode('qc'); await sleep(500);
    await step('Playback in QC, 10 s', async () => { await seekTo(1600); await sleep(400); return playback(10); });
    await setMode('write'); await sleep(500);
  }

  if (section('panels')) {
    const open = (name, how, closeWith = closeDialogs) => step(name, async () => { await how(); await sleep(400); await closeWith(); await sleep(100); });
    await open('Settings', () => click('[data-act=settings]'));
    await open('Text to speech panel', () => press('V', 'KeyV', { mods: MODS.alt | MODS.shift, text: 'V' }));
    await open('Shortcuts', () => press('?', 'Slash', { mods: MODS.shift, text: '?' }), () => press('Escape', 'Escape'));
    await open('Keys panel, filtered', async () => { await js(`document.querySelector('#helpKeys')?.click(); 1`); await sleep(300); await js(`(() => { const f = document.getElementById('keysFind'); if (f) { f.value = 'block'; f.dispatchEvent(new Event('input')); } })()`); });
    await open('Guides window', async () => { await js(`document.getElementById('helpGuides')?.click(); 1`); await sleep(600); });
    await open('Comments drawer', () => js(`document.querySelector('[data-act=comments]').click(); 1`), () => js(`document.getElementById('commentsClose')?.click(); 1`));
    await open('AI help drawer', () => js(`document.querySelector('[data-act=ai]').click(); 1`), () => js(`document.getElementById('aiClose')?.click(); 1`));
    await open('Diagnostics', async () => { await js(`document.getElementById('setDiag').click(); 1`); await sleep(400); });
    await open('Export menu', () => click('#exportBtn'), () => press('Escape', 'Escape'));
    await step('Save the project', async () => { await js(`(() => { window.showSaveFilePicker = undefined; })()`); await press('s', 'KeyS', { mods: MODS.ctrl }); await sleep(800); });
    await step('Export SRT', async () => { await click('[data-act=exportSrt]'); await sleep(500); });
  }

  if (section('tts')) {
    await step('Turn on text to speech', async () => {
      await js(`(async () => { const t = await import('./js/tts.js'); await t.loadPiper(); t.setTtsOption('on', true); t.setTtsOption('voice', 'piper:en_US-lessac-medium'); return 1; })()`);
      await sleep(800);
    });
    await step('Make all readings', async () => {
      await press('V', 'KeyV', { mods: MODS.alt | MODS.shift, text: 'V' }); await sleep(500);
      await click('#ttsMakeAll'); await sleep(500);
      await closeDialogs();
      await until(`document.getElementById('jobBox').hidden`, 500, 500);
      return js(`document.getElementById('ttsMakeStatus').textContent`);
    });
    await step('Playback with readings, 30 s', async () => { await seekTo(900); await sleep(1000); return playback(30); });
    const panel = async () => { await press('V', 'KeyV', { mods: MODS.alt | MODS.shift, text: 'V' }); await sleep(500); };
    await step('Update all timings', async () => {
      await panel(); await click('#ttsAll'); await sleep(500); await closeDialogs(); await sleep(300);
      await until(`document.getElementById('jobBox').hidden`, 500, 500);
    });
    await step('Fit speeds to timings', async () => {
      await panel(); await click('#ttsFitAll'); await sleep(500); await closeDialogs(); await sleep(300);
      await until(`document.getElementById('jobBox').hidden`, 500, 500);
    });
    await step('Typing with readings on', async () => {
      await seekTo(1000); await press('c', 'KeyC', { text: 'c' }); await sleep(300);
      await press('Enter', 'Enter'); await sleep(400); await type('then the light goes out'); await press('Escape', 'Escape');
    });
  }

  if (section('exports')) {
    const saved = () => js('window.__m.saved.length');
    const exporting = (name, button, statusEl, secs) => step(name, async () => {
      await press('V', 'KeyV', { mods: MODS.alt | MODS.shift, text: 'V' }); await sleep(500);
      const n = await saved();
      await click(button);
      await until(`window.__m.saved.length > ${n}`, secs, 500);
      const said = await js(`document.getElementById('${statusEl}').textContent`);
      await closeDialogs();
      return said.slice(0, 90);
    });
    await js(`(async () => { const t = await import('./js/tts.js'); t.setTtsOption('trackAs', 'wav'); t.setTtsOption('mixAs', 'wav'); return 1; })()`);
    await exporting('Export description track, WAV', '#ttsExport', 'ttsExportStatus', 900);
    await js(`(async () => { const t = await import('./js/tts.js'); t.setTtsOption('trackAs', 'mp3-96'); return 1; })()`);
    await exporting('Export description track, MP3', '#ttsExport', 'ttsExportStatus', 900);
    await exporting('Export the full mix, WAV', '#ttsMixExport', 'ttsMixStatus', 1800);
    // The same with a pause for every block: without ffmpeg here, the extended video is the
    // audio and a filter file.
    await js(`document.getElementById('ttsExtendedAll').click(); 1`);
    await exporting('Export description track, extended', '#ttsExport', 'ttsExportStatus', 900);
    await exporting('Export the full mix, extended', '#ttsMixExport', 'ttsMixStatus', 1800);
    await exporting('Export extended video, no ffmpeg', '#ttsExtVideoExport', 'ttsExtStatus', 1800);
    await js(`document.getElementById('ttsExtendedAll').click(); 1`);
    await step('Export a QC package', async () => {
      await click('[data-act=exportQc]'); await sleep(500);
      const n = await saved();
      await click('#qcExportStart');
      await until(`window.__m.saved.length > ${n}`, 900, 500);
      await click('#qcExportClose');
    });
  }

  if (section('record')) {
    await step('Open a recording file', async () => {
      await js(`(async () => {
        const R = await import('./js/recording.js');
        const file = R.toRecordingFile({ blocks: ${JSON.stringify(script)}, fps: 24 });
        const dt = new DataTransfer(); dt.items.add(new File([JSON.stringify(file)], 'big-film.scribecue-rec'));
        window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
        return 1; })()`);
      await until(`document.body.classList.contains('mode-record') || document.getElementById('recSessionDlg').open`, 60);
      await until(`document.body.classList.contains('mode-record')`, 60);
      await sleep(800); await closeDialogs();
    });
    await step('Record a block, about 8 s', async () => {
      await js(`document.querySelectorAll('#list .row')[100].click(); 1`); await sleep(500);
      // Takes need a place first: here, in the browser.
      await click('#recSession'); await until(`document.getElementById('recSessionDlg').open`, 10, 50);
      await click('#recSessionBrowser'); await sleep(800);
      await click('#recGo');
      await until(`/Recording/.test(document.getElementById('recStatus').textContent)`, 30, 50).catch(async (e) => {
        throw Error(`${e.message.slice(0, 20)} status "${await js(`document.getElementById('recStatus').textContent`)}", toast "${await js(`document.getElementById('toast').textContent`)}", mode ${await js('document.body.className')}`);
      });
      await sleep(8000);
      await click('#recGo');
      await sleep(1500);
      return js(`document.getElementById('recStatus').textContent.slice(0, 80)`);
    });
    await step('Move through blocks in Record mode', async () => { for (let i = 0; i < 10; i++) { await press('ArrowDown', 'ArrowDown'); await sleep(150); } });
  }

} finally {
  clearInterval(watcher);
  console.log('New tabs asked for:', await js('JSON.stringify(window.__m.opened)').catch(() => '?'));
  if (outFile) await writeFile(outFile, JSON.stringify({ blocks: BLOCKS, rate: RATE, results, pageErrors, peakPss }, null, 1));
  console.log(`\nPeak memory, whole browser: ${peakPss} MB`);
  if (pageErrors.length) console.log(`Errors on the page:\n  ${[...new Set(pageErrors)].slice(0, 10).join('\n  ')}`);
  browser.kill();
  server.close();
}
process.exit(0);
