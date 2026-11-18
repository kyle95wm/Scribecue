// A shared project's video, sent by its owner and downloaded by someone it's shared with, each
// in their own headless, muted Chrome at a CPU slowdown. Serves Scribecue itself, with Google
// (the sign-in helper and Drive) stood in for by this script, on the same address: real
// resumable uploads, links anyone can read, and ranged downloads.
//
// A opens a video, shares the project and sends the video. B opens the link, downloads the
// video, stops halfway and carries on, plays it, and after a reload it opens from the copy
// kept in the browser, with no download. A reloads and is offered the video it sent. A opens another video and sends it instead: the old
// one goes from Drive and B is offered the new one. A stops sharing: the video goes from Drive.
//
// Uses the relay at RELAY, by default one running locally (`npm run dev` in relay/).
// Usage: node scripts/shared-video-smoke.mjs <A's DevTools port> <B's DevTools port> <video> [other video] [slowdown] [screenshot folder]
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const [,, portA, portB, videoPath, otherPath, slowdown = '6', shots] = process.argv;
const RELAY = process.env.RELAY || 'ws://127.0.0.1:8787';
const KEY = 'test-api-key';
const APP = fileURLToPath(new URL('../app/', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Scribecue, and Google as far as it's used, on one address

const files = new Map(), uploads = new Map(), ranges = [];
// The owner's storage, and after how many upload requests Drive says it's full (null: never).
let quota = { limit: null, usage: 0 }, fullAfter = null;
let n = 0;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.onnx': 'application/octet-stream' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), origin = `http://127.0.0.1:${server.address().port}`;
  const cors = {
    'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE',
    'access-control-allow-headers': req.headers['access-control-request-headers'] || '*',
    'access-control-expose-headers': 'Location, Range, Content-Range',
  };
  const json = (body, status = 200, more = {}) => { res.writeHead(status, { ...cors, 'content-type': 'application/json', ...more }); res.end(JSON.stringify(body)); };
  const body = () => new Promise((ok) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => ok(Buffer.concat(parts))); });
  const p = url.pathname;
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (p.startsWith('/google/')) return json({ access: 'acc', expires: 3599 });
  if (p === '/drive/v3/about') return json({ storageQuota: { ...(quota.limit == null ? {} : { limit: String(quota.limit) }), usage: String(quota.usage) } });
  if (p === '/drive/v3/files' && req.method === 'GET') {
    const q = url.searchParams.get('q') || '';
    let list = [...files.values()];
    if (q.includes('vnd.google-apps.folder')) list = list.filter((f) => f.folder);
    else if (q.includes('appProperties')) list = list.filter((f) => f.project);
    else if (q.includes('in parents')) list = list.filter((f) => f.parent === q.match(/'([^']+)' in parents/)[1]);
    else list = [];
    return json({ files: list.map((f) => ({ id: f.id, name: f.name })) });
  }
  if (p === '/drive/v3/files' && req.method === 'POST') {
    const meta = JSON.parse(await body()), id = `folder${++n}xxxxxx`;
    files.set(id, { id, name: meta.name, folder: true });
    return json({ id });
  }
  if (p === '/upload/drive/v3/files' && req.method === 'POST' && url.searchParams.get('uploadType') === 'resumable') {
    const meta = JSON.parse(await body()), u = `up${++n}`;
    uploads.set(u, { meta, size: Number(req.headers['x-upload-content-length']), parts: [], got: 0 });
    return json({}, 200, { location: `${origin}/upload/drive/v3/files?uploadType=resumable&upload_id=${u}` });
  }
  if (p === '/upload/drive/v3/files' && req.method === 'PUT') {
    const u = uploads.get(url.searchParams.get('upload_id'));
    if (!u) return json({ error: 'gone' }, 404);
    const range = req.headers['content-range'] || '', bytes = await body();
    if (fullAfter != null && u.parts.length >= fullAfter) {
      return json({ error: { code: 403, message: 'The user\'s Drive storage quota has been exceeded.', errors: [{ reason: 'storageQuotaExceeded' }] } }, 403);
    }
    const m = range.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if (m) {
      assert.equal(+m[1], u.got, 'each piece follows the last');
      assert.equal(bytes.length, +m[2] - +m[1] + 1);
      assert.equal(+m[3], u.size);
      if (+m[2] + 1 < u.size) assert.equal(bytes.length % (256 * 1024), 0, 'pieces are whole multiples of 256 KiB');
      u.parts.push(bytes); u.got += bytes.length;
    }
    if (u.got < u.size) { res.writeHead(308, { ...cors, range: `bytes=0-${u.got - 1}` }); return res.end(); }
    const id = `video${++n}AbCdEfGh`;
    files.set(id, { id, name: u.meta.name, parent: u.meta.parents[0], props: u.meta.appProperties, body: Buffer.concat(u.parts), anyone: false });
    return json({ id });
  }
  const perm = p.match(/^\/drive\/v3\/files\/([^/]+)\/permissions$/);
  if (perm && req.method === 'POST') {
    const f = files.get(perm[1]), want = JSON.parse(await body());
    assert.deepEqual(want, { role: 'reader', type: 'anyone' });
    f.anyone = true;
    return json({ id: 'anyoneWithLink' });
  }
  const one = p.match(/^\/drive\/v3\/files\/([^/]+)$/);
  if (one && req.method === 'DELETE') { files.delete(one[1]); res.writeHead(204, cors); return res.end(); }
  if (one && url.searchParams.get('alt') === 'media') {
    const f = files.get(one[1]);
    if (!f) return json({ error: 'notFound' }, 404);
    if (url.searchParams.get('key') !== KEY || !f.anyone || req.headers.authorization) return json({ error: 'forbidden' }, 403);
    const from = Number((req.headers.range || '').match(/^bytes=(\d+)-$/)?.[1] || 0);
    ranges.push(from);
    res.writeHead(from ? 206 : 200, { ...cors, 'content-type': 'application/octet-stream', 'content-length': f.body.length - from, ...(from ? { 'content-range': `bytes ${from}-${f.body.length - 1}/${f.body.length}` } : {}) });
    // About 10 MB a second, so stopping partway can be tried.
    for (let at = from; at < f.body.length && !res.destroyed; at += 256 * 1024) {
      if (!res.write(f.body.subarray(at, Math.min(at + 256 * 1024, f.body.length)))) await new Promise((r) => res.once('drain', r));
      await sleep(25);
    }
    return res.end();
  }
  // The app, with Google pointed here.
  let path = normalize(join(APP, decodeURIComponent(p === '/' ? '/index.html' : p)));
  if (!path.startsWith(APP)) { res.writeHead(403); return res.end(); }
  try { if (statSync(path).isDirectory()) path = join(path, 'index.html'); } catch { res.writeHead(404); return res.end(); }
  let text = readFileSync(path);
  if (p.endsWith('/js/config.js')) {
    text = String(text).replace(/GOOGLE_CLIENT_ID = '[^']*'/, "GOOGLE_CLIENT_ID = 'test.apps.googleusercontent.com'")
      .replace(/GOOGLE_API_KEY = '[^']*'/, `GOOGLE_API_KEY = '${KEY}'`).replace(/export const SIGNIN = .*/, `export const SIGNIN = '${origin}';`);
  }
  if (p.endsWith('/js/googledrive.js')) text = String(text).replaceAll('https://www.googleapis.com', origin);
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(text);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const site = `http://127.0.0.1:${server.address().port}/`;

// ---- the two browsers

async function browser(port) {
  const t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const js = async (expression) => { const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (m.result?.exceptionDetails) throw Error(JSON.stringify(m.result.exceptionDetails).slice(0, 500)); return m.result.result.value; };
  const wait = async (expression, what = expression, tries = 480) => { for (let i = 0; i < tries; i++) { if (await js(expression).catch(() => false)) return; await sleep(250); } throw Error('Timed out: ' + what + ' — toast: ' + await js(`document.getElementById('toast').textContent`).catch(() => '?')); };
  await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true }); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('DOM.enable');
  await send('Emulation.setCPUThrottlingRate', { rate: +slowdown });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const watch = () => js(`window.__errors=[];addEventListener('error',e=>__errors.push(e.message));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));window.__long=[];new PerformanceObserver(l=>__long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'});true`);
  const report = async () => { const long = await js(`__long`); assert.deepEqual(await js(`__errors`), []); return `${long.length} long tasks${long.length ? ` (longest ${Math.round(Math.max(...long))} ms)` : ''}`; };
  const shot = async (name) => { if (!shots) return; const m = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${shots}/${name}.png`, Buffer.from(m.result.data, 'base64')); };
  const click = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).click();true`);
  const openVideo = async (path) => {
    const doc = await send('DOM.getDocument');
    const node = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#fileVideo' });
    await send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files: [path] });
  };
  return { send, js, wait, watch, report, shot, click, openVideo };
}
const settings = (name, drive) => `window.__stale=1;localStorage.clear();for(const [k,v] of Object.entries({welcome:'1',seenVersion:'999.0.0',updates:'0',mode:'write',reviewer:${JSON.stringify(name)},sharedCopy:'1',relay:${JSON.stringify(RELAY)},setupModes:'{"write":true,"transcribe":true,"qc":true,"record":true}',loops:'{"write":true,"transcribe":true}'${drive ? `,google:'{"sealed":"s","email":"owner@example.com","projects":true}',googleSync:'{"seen":{},"synced":1}'` : ''}}))localStorage.setItem('scribecue.'+k,v);
  localStorage.setItem('scribecue.v1',JSON.stringify({dirty:false,projectId:crypto.randomUUID(),cues:[{uid:crypto.randomUUID(),start:1,end:3,text:'A door opens.'}]}));
  navigator.storage.getDirectory().then(async r=>{for await (const k of r.keys()) await r.removeEntry(k,{recursive:true})}).finally(()=>{Storage.prototype.setItem=()=>{};location.reload()});true`;
const online = `window.scribecueRelay?.status==='online' && !window.scribecueRelay.unsent()`;
const videos = () => [...files.values()].filter((f) => f.props?.scribecue === 'video');
const toast = (b) => b.js(`document.getElementById('toast').textContent`);
const size = statSync(videoPath).size;

const a = await browser(portA), b = await browser(portB);
try {
  await a.send('Page.navigate', { url: site }); await b.send('Page.navigate', { url: site }); await sleep(1000);
  await a.js(settings('Kyle', true)); await b.js(settings('Sam', false));
  await a.wait(`!window.__stale && window.scribecueSharing && !document.getElementById('shareBtn').hidden`, 'A ready');
  await b.wait(`!window.__stale && document.readyState==='complete' && !!document.getElementById('list')`, 'B ready');
  await a.watch(); await b.watch();

  // A opens the video and shares the project.
  await a.openVideo(videoPath);
  await a.wait(`document.body.classList.contains('has-video')`, 'A’s video open');
  await a.click('#shareBtn');
  await a.wait(`document.getElementById('shareDlg').open`, 'Share window');
  assert.match(await a.js(`document.getElementById('shareIntro').textContent`), /you can send the video too/);
  assert.equal(await a.js(`document.getElementById('shareVideo').hidden`), true, 'no video section before sharing');
  await a.js(`window.scribecueSharing.make('edit','blue door').then(()=>true)`);
  await a.wait(`document.querySelector('.sharelink') && ${online}`, 'A shared');
  const link = await a.js(`document.querySelector('.sharelink').value`);
  assert.equal(await a.js(`document.getElementById('shareVideo').hidden`), false, 'the video section shows');
  assert.match(await a.js(`document.getElementById('shareVideoInfo').textContent`), /^Send .+ with the project/);
  await a.shot('owner-before');

  // A Drive without room: refused before anything is uploaded.
  quota = { limit: 15e9, usage: 15e9 - 5e6 };
  await a.click('#shareVideoOn');
  await a.wait(`/^There isn’t room in your Google Drive\\. The video needs 20 MB, and 5 MB is free\\./.test(document.getElementById('toast').textContent)`, 'told there isn’t room');
  assert.equal(uploads.size, 0, 'nothing uploaded');
  // Room by Drive's count, but it fills up partway.
  quota = { limit: null, usage: 0 }; fullAfter = 1;
  await a.js(`document.getElementById('toast').textContent='';true`);
  await a.click('#shareVideoOn');
  await a.wait(`/^There isn’t room in your Google Drive\\. The video needs 20 MB\\. Free up space/.test(document.getElementById('toast').textContent)`, 'told Drive filled up');
  assert.equal(videos().length, 0, 'no video file');
  assert.equal(await a.js(`window.scribecueShared.video()`), '', 'nothing sent');
  assert.equal(await a.js(`document.getElementById('shareVideoOn').disabled`), false, 'can try again');
  fullAfter = null;
  await a.js(`document.getElementById('toast').textContent='';true`);

  // A sends it.
  await sleep(4000); // the video's waveform and sound settle first
  await a.js(`__long.length=0;window.__loaf=[];new PerformanceObserver(l=>__loaf.push(...l.getEntries().filter(e=>e.duration>200).map(e=>({d:Math.round(e.duration),s:e.scripts.map(s=>s.sourceFunctionName+'@'+s.sourceURL.split('/').pop()+':'+s.sourceCharPosition+' '+Math.round(s.duration)).join(' | ')})))).observe({type:'long-animation-frame'});true`);
  if (process.env.PROFILE) { await a.send('Profiler.enable'); await a.send('Profiler.start'); }
  let t0 = performance.now();
  await a.click('#shareVideoOn');
  await a.wait(`/^Sending the video/.test(document.getElementById('jobText').textContent)`, 'progress shows');
  await a.wait(`/^Sent /.test(document.getElementById('toast').textContent)`, 'A sent the video');
  console.log(`A sent ${(size / 1e6).toFixed(1)} MB in ${Math.round(performance.now() - t0)} ms at ${slowdown}× slowdown; A: ${await a.report()}`);
  if (process.env.VERBOSE) console.log(JSON.stringify(await a.js(`__loaf`), null, 1));
  if (process.env.PROFILE) {
    const { profile } = (await a.send('Profiler.stop')).result, self = new Map(), dt = profile.timeDeltas, byId = new Map(profile.nodes.map((x) => [x.id, x]));
    profile.samples.forEach((sid, i) => { const f = byId.get(sid).callFrame, k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0) / 1000); });
    console.log([...self].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, v]) => `${Math.round(v)} ms  ${k}`).join('\n'));
  }
  assert.equal(videos().length, 1);
  const sent = videos()[0];
  assert.equal(sent.anyone, true, 'anyone with the link can read it');
  assert.ok(sent.name.endsWith('.scribecuevideo'));
  const info = JSON.parse(await a.js(`window.scribecueShared.video()`));
  assert.equal(info.id, sent.id);
  assert.equal(info.size, size);
  assert.equal(sent.body.length, size + 16 * Math.ceil(size / (4 * 1024 * 1024 - 16)), 'sealed: 16 bytes more a piece');
  assert.equal(sent.body.subarray(0, 4096).equals(readFileSync(videoPath).subarray(0, 4096)), false, 'Drive doesn’t get the video as it is');
  assert.equal(await a.js(`document.getElementById('shareVideoOn').getAttribute('aria-pressed')`), 'true');
  await a.shot('owner-sent');
  await a.wait(online, 'A’s change sent');

  // B opens the link.
  await b.js(`location.href=${JSON.stringify(link.replace(/^https?:\/\/[^/]+\//, site))};true`);
  await sleep(1500);
  await b.watch();
  await b.js(`window.scribecueSharing ? true : new Promise(r=>{const t=setInterval(()=>{if(window.scribecueSharing){clearInterval(t);r(true)}},100)})`);
  await b.js(`(document.getElementById('joinDlg')?.open && document.getElementById('joinDlg').close(), window.scribecueSharing.join(location.href,'blue door')).then(()=>true)`);
  await b.wait(`!document.getElementById('reopenVideo').hidden && !!document.getElementById('reopenVideo').dataset.shared`, 'B is offered the video');
  assert.match(await b.js(`document.getElementById('reopenVideo').textContent`), /^Download the video, .+ \(\d+ MB\)$/);
  await b.shot('editor-offered');

  // B downloads, stops partway, then carries on.
  ranges.length = 0;
  await b.click('#reopenVideo');
  await b.wait(`document.getElementById('jobBar').value > 0.3`, 'partway');
  await b.click('#jobStop');
  await b.wait(`/Download stopped/.test(document.getElementById('toast').textContent)`, 'stopped');
  assert.equal(await b.js(`document.body.classList.contains('has-video')`), false);
  t0 = performance.now();
  await b.click('#reopenVideo');
  await b.wait(`document.body.classList.contains('has-video')`, 'B downloaded the video');
  console.log(`B downloaded the rest in ${Math.round(performance.now() - t0)} ms; B: ${await b.report()}`);
  assert.equal(ranges[0], 0);
  assert.ok(ranges[1] > 0 && ranges[1] % (4 * 1024 * 1024) === 0, `carried on from a whole piece, at ${ranges[1]}`);
  await b.wait(`document.body.classList.contains('has-video') && document.getElementById('video').readyState >= 2`, 'B’s video ready');
  assert.equal(await b.js(`(async()=>{const r=await fetch(document.getElementById('video').src);const x=new Uint8Array(await r.arrayBuffer());return x.length})()`), size);
  const same = await b.js(`(async()=>{const x=new Uint8Array(await (await fetch(document.getElementById('video').src)).arrayBuffer());let h=0;for(let i=0;i<x.length;i+=997)h=(h*31+x[i])>>>0;return h})()`);
  const want = (() => { const x = readFileSync(videoPath); let h = 0; for (let i = 0; i < x.length; i += 997) h = (h * 31 + x[i]) >>> 0; return h; })();
  assert.equal(same, want, 'the video B has is the one A sent');
  await b.js(`document.getElementById('video').play().then(()=>true)`);
  await sleep(1500);
  assert.ok(await b.js(`document.getElementById('video').currentTime`) > 0.3, 'it plays');
  await b.js(`document.getElementById('video').pause(),true`);
  await b.shot('editor-playing');

  // After a reload, it opens from the copy kept here.
  ranges.length = 0;
  await b.send('Page.reload'); await sleep(1500);
  await b.watch();
  await b.wait(`document.body.classList.contains('has-video')`, 'B’s video reopened');
  assert.deepEqual(ranges, [], 'no download after reloading');

  // A reloads. A's video was opened without a handle, so this browser can't reopen it: the
  // video A sent is offered instead, as it is to others, and downloads from Drive.
  await a.wait(online, 'A online');
  await a.send('Page.reload'); await sleep(1500);
  await a.watch();
  await a.wait(`!document.getElementById('reopenVideo').hidden && !!document.getElementById('reopenVideo').dataset.shared`, 'A is offered the video it sent');
  assert.match(await a.js(`document.getElementById('reopenVideo').dataset.tip`), /^The video you sent/);
  await a.shot('owner-offered');
  ranges.length = 0;
  await a.click('#reopenVideo');
  await a.wait(`document.body.classList.contains('has-video')`, 'A downloaded the video it sent');
  assert.ok(ranges.length > 0, 'from Drive');
  console.log(`A got the video it sent back after a reload; A: ${await a.report()}`);
  await a.watch();
  await a.click('#shareBtn'); // closed by the reload
  await a.wait(`document.getElementById('shareDlg').open`, 'Share window again');

  // A sends another video instead: the old one goes from Drive, and B is offered the new one.
  if (otherPath) {
    await a.js(`document.getElementById('toast').textContent='';true`);
    await a.openVideo(otherPath);
    await a.wait(`/Others still get /.test(document.getElementById('toast').textContent)`, 'A is told others still get the old one');
    await a.wait(`!document.getElementById('shareVideoSwap').hidden`, 'Send this video instead');
    await a.shot('owner-other');
    await a.click('#shareVideoSwap');
    await a.wait(`JSON.parse(window.scribecueShared.video()||'{}').name==='pilot-v2.mp4'`, 'A sent the other video');
    for (let i = 0; i < 40 && videos().length > 1; i++) await sleep(250);
    assert.equal(videos().length, 1, 'the old video went from Drive');
    assert.notEqual(videos()[0].id, sent.id);
    await b.wait(`/The owner sent a new video/.test(document.getElementById('toast').textContent)`, 'B is told');
  }

  // A stops sharing: the video goes from Drive.
  await a.wait(online, 'A online');
  await a.js(`window.confirm=()=>true;true`);
  await a.click('#shareStop');
  await a.wait(`/Stopped sharing/.test(document.getElementById('toast').textContent)`, 'A stopped sharing');
  for (let i = 0; i < 40 && videos().length; i++) await sleep(250);
  assert.equal(videos().length, 0, 'the video went from Drive');
  console.log(`A: ${await a.report()}; B: ${await b.report()}`);
  console.log('Shared video: all passed');
} finally {
  server.close();
  setTimeout(() => process.exit(), 100);
}
