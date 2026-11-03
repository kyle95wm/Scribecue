// Measures playback and jumps in a long film, in headless Linux Chromium that's muted and
// runs inside scripts/slow-chromium.sh's container. The container's CPU limit slows the
// whole browser, video decoding included, which DevTools' CPU slowdown doesn't.
// Usage (in the container): node scripts/slow-chromium.mjs <film>
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';

const [,, film] = process.argv;
const APP = new URL('../app/', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };

const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  try {
    const body = await readFile(join(APP, normalize(path).replace(/^(\.\.[/\\])+/, '')));
    res.setHeader('content-type', TYPES[path.slice(path.lastIndexOf('.'))] || 'application/octet-stream');
    res.end(body);
  } catch { res.statusCode = 404; res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));

const profile = await mkdtemp(join(tmpdir(), 'chromium-'));
const browser = spawn('chromium', ['--headless=new', '--mute-audio', '--no-sandbox', '--no-first-run', '--autoplay-policy=no-user-gesture-required',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((ok, no) => {
  let err = '';
  browser.stderr.on('data', (d) => { err += d; const m = /DevTools listening on (ws:\S+)/.exec(err); if (m) ok(m[1]); });
  setTimeout(() => no(Error(`Chromium didn’t start: ${err.slice(-400)}`)), 60e3);
});
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } });
let sessionId;
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const js = async (expression) => {
  const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (m.result?.exceptionDetails) throw Error(m.result.exceptionDetails.exception?.description || 'script error');
  return m.result.result.value;
};
const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
({ result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true }));
const site = `http://127.0.0.1:${server.address().port}/`;

const results = [];
const row = (what, value) => { results.push([what, value]); console.log(`${what}: ${value}`); };
try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: site }); await sleep(3000);
  await js(`for (const [k, v] of Object.entries({ welcome: '1', seenVersion: '999.0.0', updates: '0', mode: 'write', setupModes: '{"write":true,"transcribe":true,"qc":true,"record":true}', loops: '{"write":true,"transcribe":true}' })) localStorage.setItem('scribecue.' + k, v); location.reload(); 1`);
  await sleep(5000);
  await send('DOM.enable');
  const { result: { root } } = await send('DOM.getDocument');
  const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#fileVideo' });
  await send('DOM.setFileInputFiles', { nodeId, files: [film] });
  await js(`new Promise((r) => { const v = document.getElementById('video'); const go = () => v.readyState >= 2 ? r(1) : setTimeout(go, 100); go(); })`);
  await sleep(2000);
  // Every picture shown, and every long task on the page.
  await js(`(() => { const v = document.getElementById('video'); window.__frames = []; window.__long = []; window.__wait = [];
    const f = (n, m) => { __frames.push([performance.now(), m.mediaTime]); v.requestVideoFrameCallback(f); }; v.requestVideoFrameCallback(f);
    new PerformanceObserver((l) => __long.push(...l.getEntries().map((e) => e.duration))).observe({ type: 'longtask' });
    new MutationObserver(() => { const w = document.getElementById('vidWait'); if (!w.hidden) __wait.push(w.textContent); }).observe(document.getElementById('vidWait'), { attributes: true, childList: true });
    return 1; })()`);
  const dur = await js(`document.getElementById('video').duration`);
  const quality = await js(`(() => { const v = document.getElementById('video'); return [v.videoWidth, v.videoHeight].join('×'); })()`);
  row('Film', `${quality}, ${Math.round(dur / 60)} min`);
  const seekTo = (t) => js(`new Promise((r) => { const v = document.getElementById('video'); v.addEventListener('seeked', () => r(1), { once: true }); v.currentTime = ${t}; })`);
  const longTasks = async () => { const l = await js('__long.splice(0)'); return l.length ? `${l.length}, longest ${Math.round(Math.max(...l))} ms` : 'none'; };

  // 1. Playback, 10 seconds from 10 minutes in.
  await seekTo(Math.min(600, dur / 2)); await sleep(500); await longTasks();
  const p0 = await js(`(() => { const v = document.getElementById('video'); window.__p0 = performance.now(); window.__q0 = v.getVideoPlaybackQuality(); v.play(); return 1; })()`);
  await sleep(10e3);
  const play = await js(`(() => { const v = document.getElementById('video'); v.pause(); const q = v.getVideoPlaybackQuality(), secs = (performance.now() - __p0) / 1000;
    const shown = __frames.filter((f) => f[0] > __p0).length;
    return { fps: (shown / secs).toFixed(1), dropped: q.droppedVideoFrames - __q0.droppedVideoFrames, total: q.totalVideoFrames - __q0.totalVideoFrames }; })()`);
  row('Playback', `${play.fps} pictures a second, ${play.dropped} of ${play.total} frames dropped`);
  row('Long tasks while playing', await longTasks());
  void p0;

  // 2. Clicks on the bar under the video: a minute in to three quarters, then back.
  const bar = await js(`(() => { const r = document.getElementById('scrubMarks').getBoundingClientRect(); return { x: r.x, w: r.width, y: r.y + r.height / 2 }; })()`);
  const at = (frac) => ({ x: bar.x + bar.w * frac, y: bar.y });
  const landed = (target) => js(`new Promise((r) => { const v = document.getElementById('video'); const go = () => {
    const last = __frames.at(-1);
    if (last && last[0] > __t0 && Math.abs(last[1] - ${target}) < 1 && !v.seeking) return r(Math.round(last[0] - __t0) + ' ms');
    if (performance.now() - __t0 > 60e3) return r('over a minute');
    setTimeout(go, 20); }; go(); })`);
  for (const [from, to] of [[60, 0.75], [0.75 * dur, 0.1]]) {
    await seekTo(from); await sleep(800); await js('__wait = []; 1');
    await js('window.__t0 = performance.now(); 1');
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...at(to), button: 'left', clickCount: 1 });
    const ms = await landed(to * dur);
    const shown = (await js('__wait')).includes('Seeking…') ? ', Seeking… shown' : '';
    row(`Click from ${Math.round(from / 60)} min to ${Math.round(to * dur / 60)} min`, ms + shown);
  }

  // 3. A drag from 5% to 60% in 30 moves over 3 seconds.
  await seekTo(60); await sleep(800);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at(0.05), button: 'left', clickCount: 1 });
  await js('window.__d0 = performance.now(); 1');
  for (let i = 1; i <= 30; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at(0.05 + 0.55 * i / 30), button: 'left', buttons: 1 }); await sleep(100); }
  await js('window.__t0 = performance.now(); 1');
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at(0.6), button: 'left', clickCount: 1 });
  const pictures = await js(`new Set(__frames.filter((f) => f[0] > __d0 && f[0] < __t0).map((f) => f[1].toFixed(2))).size`);
  row('Drag across the film', `${pictures} pictures during the drag, final one ${await landed(0.6 * dur)} after letting go`);
  row('Long tasks while jumping', await longTasks());
} finally {
  browser.kill();
  server.close();
}
process.exit(0);
