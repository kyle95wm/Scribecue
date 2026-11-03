// Asks headless Chrome whether it accepts every file picker's options (app/js/pickers.js).
// Chrome checks them before it checks for a click, so with no click a good picker fails
// with SecurityError and never opens, and a bad one fails with TypeError. Then checks that
// a plain file input still opens after a refused picker, which Open falls back to.
// Usage: node scripts/picker-check.mjs   (CHROME=/path/to/chrome to choose the browser)
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';

const APP = new URL('../app/', import.meta.url).pathname;
const which = (c) => { try { return execFileSync('which', [c], { encoding: 'utf8' }).trim(); } catch { return ''; } };
const chrome = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'].find(existsSync) ||
  ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].map(which).find(Boolean);
if (!chrome) { console.error('No Chrome or Chromium found. Set CHROME to its path.'); process.exit(1); }

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/') return res.end('<!doctype html><title>Picker check</title><input type="file" id="f">');
  try {
    const body = await readFile(join(APP, normalize(path).replace(/^(\.\.[/\\])+/, '')));
    res.setHeader('content-type', path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    res.end(body);
  } catch { res.statusCode = 404; res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.on('listening', r));
const site = `http://127.0.0.1:${server.address().port}/`;

const profile = await mkdtemp(join(tmpdir(), 'scribecue-pickers-'));
// GitHub's Ubuntu runners can't always start Chrome's sandbox. The page is only our own files.
const sandbox = process.env.CI ? ['--no-sandbox'] : [];
const browser = spawn(chrome, ['--headless=new', '--mute-audio', '--no-first-run', ...sandbox, '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let failed = false;
try {
  const wsUrl = await new Promise((ok, no) => {
    let err = '';
    browser.stderr.on('data', (d) => { err += d; const m = /DevTools listening on (ws:\S+)/.exec(err); if (m) ok(m[1]); });
    browser.on('exit', () => no(Error(`Chrome exited: ${err.slice(-400)}`)));
    setTimeout(() => no(Error('Chrome didn’t start')), 20e3);
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map(), events = [];
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } else events.push(m); });
  const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const { result: { targetId } } = await send('Target.createTarget', { url: site });
  const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
  const js = async (expression, userGesture = false) => {
    const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture }, sessionId);
    if (m.result?.exceptionDetails) throw Error(m.result.exceptionDetails.exception?.description || 'script error');
    return m.result.result.value;
  };
  for (let i = 0; i < 50 && !(await js('document.readyState === "complete"').catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));

  const results = await js(`import('./js/pickers.js').then(async ({ PICKERS, picker }) => {
    const out = {};
    for (const name of Object.keys(PICKERS)) out[name] = await picker(name, { suggestedName: 'x' }).then(() => 'opened', (e) => e.name + ': ' + e.message);
    return out;
  })`);
  for (const [name, r] of Object.entries(results)) {
    const ok = r.startsWith('SecurityError');
    if (!ok) failed = true;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: ${r}`}`);
  }

  // A refused picker leaves the click unused, so the plain file input opens in its place.
  await send('Page.enable', {}, sessionId);
  await send('Page.setInterceptFileChooserDialog', { enabled: true }, sessionId);
  await js(`showOpenFilePicker({ types: [{ description: 'x', accept: { 'text/plain': ['.longer-than-sixteen'] } }] }).catch((e) => { if (e.name === 'TypeError') document.getElementById('f').click(); })`, true);
  await new Promise((r) => setTimeout(r, 500));
  const fallback = events.some((e) => e.method === 'Page.fileChooserOpened');
  if (!fallback) failed = true;
  console.log(`${fallback ? 'ok  ' : 'FAIL'} file input opens after a refused picker`);
} catch (e) {
  failed = true;
  console.error(e.message);
} finally {
  browser.kill();
  server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
process.exit(failed ? 1 : 0);
