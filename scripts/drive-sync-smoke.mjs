// Syncing settings through Google Drive, in headless, muted Chrome at a CPU slowdown, with
// Google, Drive and the relay's sign-in helper stood in for (no Google account needed).
// Connects, checks the first sync takes Drive's settings and adds this browser's, syncs a
// change each way, opens with a change from another browser, syncs API keys and shared
// projects, and disconnects. The Google window itself isn't opened: the page's request for
// it is caught, and google.html is opened in a tab of its own with Google's answer.
// Usage: node scripts/drive-sync-smoke.mjs <devtools port> <site url> [screenshot.png] [slowdown]
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const [,, port, site, shot, slowdown = '6'] = process.argv;
const list = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket((await list()).find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map(), events = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } else events.forEach((f) => f(m));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expression) => {
  const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (m.result?.exceptionDetails) throw Error(JSON.stringify(m.result.exceptionDetails).slice(0, 400));
  return m.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (expression, tries = 200) => { for (let i = 0; i < tries; i++) { if (await js(expression).catch(() => false)) return; await sleep(250); } throw Error('Timed out: ' + expression); };
const shoot = async (name) => { if (!shot) return; const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(shot.replace(/\.png$/, `-${name}.png`), Buffer.from(s.result.data, 'base64')); };
const ls = (k) => js(`localStorage.getItem('scribecue.${k}')`);
const click = (sel) => js(`document.querySelector('${sel}').click(),true`);

// Google Drive, as far as Scribecue uses it: one file in the hidden app folder.
const drive = { id: '', body: null };
const there = (settings) => ({ scribecue: 'sync', version: 1, saved: Date.now(), settings });
const asked = [];
events.push(async (m) => {
  if (m.method !== 'Fetch.requestPaused') return;
  const { requestId, request } = m.params, url = new URL(request.url);
  const cors = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'GET, POST, PATCH' }];
  const reply = (body, { status = 200, type = 'application/json' } = {}) => send('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [...cors, { name: 'Content-Type', value: type }], body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)).toString('base64') });
  if (request.method === 'OPTIONS') return reply('');
  if (url.pathname.endsWith('/js/config.js')) {
    const r = await fetch(request.url);
    return reply((await r.text()).replace(/GOOGLE_CLIENT_ID = '[^']*'/, "GOOGLE_CLIENT_ID = 'test.apps.googleusercontent.com'"), { type: 'text/javascript' });
  }
  const body = request.postData ? request.postData : '';
  asked.push(`${request.method} ${url.host}${url.pathname}`);
  if (url.host === 'share.kyleadvoice.ca') {
    const path = url.pathname.split('/').pop();
    if (path === 'token') { assert.equal(JSON.parse(body).code, 'the-code'); return reply({ access: 'acc', expires: 3599, sealed: 'sealed-1', email: 'writer@example.com', scope: 'openid email https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.file' }); }
    if (path === 'refresh') return reply({ access: 'acc', expires: 3599 });
    if (path === 'revoke') return reply({ ok: true });
  }
  if (url.host === 'www.googleapis.com') {
    if (request.headers.authorization !== 'Bearer acc' && request.headers.Authorization !== 'Bearer acc') return reply({}, { status: 401 });
    if (url.pathname === '/drive/v3/files') return reply({ files: drive.id ? [{ id: drive.id }] : [] });
    if (url.pathname === `/drive/v3/files/${drive.id}` && url.searchParams.get('alt') === 'media') return reply(drive.body);
    if (url.pathname === '/upload/drive/v3/files' && request.method === 'POST') {
      drive.id = 'file-1';
      drive.body = JSON.parse(body.split('\r\n\r\n')[2].split('\r\n--')[0]);
      return reply({ id: drive.id });
    }
    if (url.pathname === `/upload/drive/v3/files/${drive.id}` && request.method === 'PATCH') { drive.body = JSON.parse(body); return reply({ id: drive.id }); }
    return reply({}, { status: 404 });
  }
  return send('Fetch.continueRequest', { requestId });
});

const measure = (ms) => js(`(async()=>{const L=[];const o=new PerformanceObserver(l=>L.push(...l.getEntries().map(e=>e.duration)));o.observe({type:'longtask'});
  await new Promise(r=>setTimeout(r,${ms}));o.disconnect();return {long:L.length,longest:Math.round(Math.max(0,...L))};})()`);

try {
  await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/js/config.js*' }, { urlPattern: '*share.kyleadvoice.ca/google/*' }, { urlPattern: '*www.googleapis.com/*' }] });
  await send('Emulation.setCPUThrottlingRate', { rate: +slowdown });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: site }); await sleep(800);
  await js(`localStorage.clear();sessionStorage.clear();for(const [k,v] of Object.entries({welcome:'1',seenVersion:'999.0.0',updates:'0',mode:'write',setupModes:'{"write":true,"transcribe":true,"record":true}',lead:'0',offset:'0.2','ai.keys':'{"openai":"sk-here"}'}))localStorage.setItem('scribecue.'+k,v);true`);
  // Another browser already put some settings in Drive.
  drive.id = 'file-1';
  drive.body = there({ lead: { v: '2.5', at: 1000 }, replay: { v: '0', at: 1000 } });
  await send('Page.reload'); await sleep(2500);
  await js(`window.__errors=[];addEventListener('error',e=>__errors.push(e.message));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));true`);

  // Connect, from Settings → Google Drive.
  await js(`window.open=(u,n)=>{window.__opened=true;const w={location:{set href(v){window.__google=v}}};return w};true`);
  await js(`(document.getElementById('settingsDlg').open||document.querySelector('[data-act="settings"]').click(),true)`);
  await wait(`document.getElementById('settingsDlg').open`);
  await click('#settab-drive');
  await wait(`!document.getElementById('gdOff').hidden`);
  await shoot('off');
  await click('#gdConnect');
  await wait(`!!window.__google`);
  const g = new URL(await js('window.__google'));
  assert.equal(g.host, 'accounts.google.com');
  assert.equal(g.searchParams.get('redirect_uri'), new URL('google.html', site).href);
  assert.equal(g.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(g.searchParams.get('access_type'), 'offline');
  assert.match(g.searchParams.get('scope'), /drive\.appdata/);
  assert.match(g.searchParams.get('scope'), /drive\.file/);
  assert.doesNotMatch(g.searchParams.get('scope'), /auth\/drive(\s|$)/, 'never all of Drive');
  assert.match(await js(`document.getElementById('gdStatus').textContent`), /Finish connecting in the Google window/);
  // Google sends the window back to google.html, which passes the code on and closes.
  const back = new URL('google.html', site);
  back.searchParams.set('code', 'the-code'); back.searchParams.set('state', g.searchParams.get('state'));
  const t0 = Date.now();
  const during = measure(4000);
  await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(back.href)}`, { method: 'PUT' });
  await wait(`!document.getElementById('gdOn').hidden && /Synced at/.test(document.getElementById('gdStatus').textContent)`);
  console.log(`connected and synced in ${Date.now() - t0} ms at ${slowdown}×; while syncing:`, await during);
  assert.equal(await js(`document.getElementById('gdWho').textContent`), 'writer@example.com');
  assert.equal(await ls('google'), JSON.stringify({ sealed: 'sealed-1', email: 'writer@example.com', projects: true }));
  // First sync: Drive's settings win, and this browser's are added. The click to connect
  // counts as working, so they wait for Scribecue to open again.
  assert.equal(drive.body.settings.lead.v, '2.5');
  assert.equal(drive.body.settings.offset.v, '0.2', 'this browser’s setting went up');
  assert.equal(drive.body.settings.mode, undefined, 'the mode stays with each browser');
  assert.equal(drive.body.settings['ai.keys'], undefined, 'API keys only sync when asked');
  assert.equal(await ls('lead'), '0', 'not used until Scribecue opens again');
  assert.equal(await js(`document.getElementById('gdPending').hidden`), false);
  await shoot('connected');
  await click('#gdReload');
  await sleep(3000);
  await wait(`document.readyState==='complete'`);
  assert.equal(await ls('lead'), '2.5', 'used after reloading');
  assert.equal(await ls('replay'), '0');

  // A change here goes up by itself, once it settles.
  await js(`localStorage.setItem('scribecue.offset','0.4');true`);
  const t1 = Date.now();
  for (let i = 0; i < 100 && drive.body.settings.offset.v !== '0.4'; i++) await sleep(250);
  assert.equal(drive.body.settings.offset.v, '0.4', 'a change here was synced');
  console.log(`a change here reached Drive in ${Date.now() - t1} ms`);

  // A change in another browser, while open: it waits, and says so.
  drive.body = there({ ...drive.body.settings, lead: { v: '1', at: Date.now() } });
  await click('#gdSync');
  await wait(`!document.getElementById('gdPending').hidden`);
  assert.match(await js(`document.getElementById('toast').textContent`), /New settings from Google Drive/);
  assert.equal(await ls('lead'), '2.5');

  // Opening with a change from another browser, before touching anything: it's used at once.
  drive.body = there({ ...drive.body.settings, replay: { v: '1', at: Date.now() } });
  await send('Page.reload');
  await sleep(4000);
  await wait(`document.readyState==='complete' && localStorage.getItem('scribecue.replay')==='1'`);
  await wait(`/Using your settings from Google Drive/.test(document.getElementById('toast').textContent)`);
  assert.equal(await ls('lead'), '1', 'the held change was used too');

  // API keys.
  await js(`(document.getElementById('settingsDlg').open||document.querySelector('[data-act="settings"]').click(),true)`);
  await wait(`document.getElementById('settingsDlg').open`);
  await click('#settab-drive');
  await wait(`!document.getElementById('gdOn').hidden`);
  await click('#gdKeys');
  for (let i = 0; i < 60 && !drive.body.settings['ai.keys']; i++) await sleep(250);
  assert.equal(drive.body.settings['ai.keys'].v, '{"openai":"sk-here"}');
  assert.equal(await js(`document.getElementById('gdKeys').getAttribute('aria-pressed')`), 'true');
  await shoot('keys');
  await click('#gdKeys');
  for (let i = 0; i < 60 && drive.body.settings['ai.keys']; i++) await sleep(250);
  assert.equal(drive.body.settings['ai.keys'], undefined, 'turning it off takes them out of Drive');
  assert.equal(await ls('ai.keys'), '{"openai":"sk-here"}', 'this browser keeps them');

  // Shared projects: always synced. One owned here goes up, without when it was opened; 50
  // joined in another browser come down, and are listed at once; one removed there goes here.
  const rec = (i, extra = {}) => ({ relay: 'wss://share.kyleadvoice.ca', room: 'room' + i, link: 'L' + i, role: 'edit', priv: 'k' + i, ownerPub: 'o', projectKey: 'pk', keys: ['pk'], w: 'w', project: 'p' + i, title: 'Episode ' + i, ...extra });
  await js(`localStorage.setItem('scribecue.share.mine',${JSON.stringify(JSON.stringify(rec(0, { link: 'owner', role: 'owner', n: 3, links: [], opened: 123 })))});true`);
  const joinedThere = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`share.p${i + 1}`, { v: JSON.stringify(rec(i + 1)), at: Date.now() }]));
  drive.body = there({ ...drive.body.settings, ...joinedThere });
  const shares = measure(5000);
  const t2 = Date.now();
  await click('#gdSync');
  await wait(`!!localStorage.getItem('scribecue.share.p50') && !!(${JSON.stringify(drive.id)})`);
  const came = Date.now() - t2;
  await wait(`/50 shared projects from Google Drive/.test(document.getElementById('toast').textContent)`);
  console.log(`50 shared projects came down in ${came} ms; while syncing:`, await shares);
  for (let i = 0; i < 60 && !drive.body.settings['share.mine']; i++) await sleep(250);
  const up = JSON.parse(drive.body.settings['share.mine'].v);
  assert.equal(up.n, 3);
  assert.equal(up.opened, undefined, 'when it was opened stays here');
  assert.equal(JSON.parse(await ls('share.mine')).opened, 123);
  assert.equal(await js(`document.getElementById('sharedBtn').hidden`), false, 'Shared projects is in File');
  drive.body = there({ ...drive.body.settings, 'share.p50': { v: null, at: Date.now() } });
  await click('#gdSync');
  await wait(`!localStorage.getItem('scribecue.share.p50')`);
  assert.ok(await ls('share.p49'));

  // Disconnect.
  await click('#gdDisconnect');
  await wait(`!document.getElementById('gdOff').hidden`);
  assert.equal(await ls('google'), null);
  assert.ok(asked.some((a) => a.endsWith('/google/revoke')), 'the token was revoked');
  assert.deepEqual(await js(`window.__errors||[]`), []);
  console.log('requests:', asked.length);
  console.log('drive sync smoke passed');
} finally { ws.close(); }
