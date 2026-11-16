// Subtitles from OpenSubtitles in headless, muted Chrome, at a CPU slowdown, with
// OpenSubtitles stood in for (no key or account needed): opens a video with no subtitles,
// searches, picks a result with a film's worth of subtitles, and measures how the page copes
// while it plays.
// Usage: node scripts/opensubs-smoke.mjs <devtools port> <site url> <video file> [screenshot.png] [slowdown] [cues]
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const [,, port, site, videoFile, shot, slowdown = '6', cueCount = '1800'] = process.argv;
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
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
const wait = async (expression, tries = 400) => { for (let i = 0; i < tries; i++) { if (await js(expression)) return; await sleep(250); } throw Error('Timed out: ' + expression); };
const shoot = async (name) => { if (!shot) return; const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(shot.replace(/\.png$/, `-${name}.png`), Buffer.from(s.result.data, 'base64')); };
const setFile = async (selector, file) => {
  const { result: { root } } = await send('DOM.getDocument');
  const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
  await send('DOM.setFileInputFiles', { nodeId, files: [file] });
};
const measure = (act, ms) => js(`(async()=>{const L=[];const o=new PerformanceObserver(l=>L.push(...l.getEntries().map(e=>e.duration)));o.observe({type:'longtask'});
  let frames=0,run=true;const tick=()=>{frames++;if(run)requestAnimationFrame(tick)};requestAnimationFrame(tick);const t0=performance.now();
  const stop=${act};await new Promise(r=>setTimeout(r,${ms}));stop?.();run=false;o.disconnect();
  return {fps:Math.round(frames/((performance.now()-t0)/1000)),long:L.length,longest:Math.round(Math.max(0,...L))};})()`);

// A two-hour film's subtitles.
const t = (s) => { const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = (s % 60).toFixed(3).padStart(6, '0').replace('.', ','); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${x}`; };
const srt = Array.from({ length: +cueCount }, (_, i) => `${i + 1}\n${t(i * 4)} --> ${t(i * 4 + 2.5)}\nLine ${i + 1}, said by someone.\n`).join('\n');
const result = (fileId, matches) => ({ id: String(fileId), attributes: {
  language: 'en', download_count: 1000 - fileId, release: `Test.Film.2020.1080p.Release${fileId}`, fps: 23.976, moviehash_match: matches,
  feature_details: { feature_type: 'Movie', title: 'Test Film', year: 2020 }, files: [{ file_id: fileId, file_name: `${fileId}.srt` }],
} });
const asked = [];
events.push(async (m) => {
  if (m.method !== 'Fetch.requestPaused') return;
  const { requestId, request } = m.params, url = request.url;
  asked.push(`${request.method} ${url.replace(/\?.*/, '')}`);
  const cors = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'GET, POST, DELETE' }];
  const reply = (body, type = 'application/json') => send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [...cors, { name: 'Content-Type', value: type }], body: Buffer.from(body).toString('base64') });
  if (request.method === 'OPTIONS') return reply('');
  if (url.includes('/subtitles')) return reply(JSON.stringify({ data: url.includes('moviehash') ? [result(1, true)] : [result(1, false), result(2, false), result(3, false)] }));
  if (url.endsWith('/download')) return reply(JSON.stringify({ link: 'https://www.opensubtitles.com/download/test.srt', remaining: 4 }));
  if (url.includes('/download/')) return reply(srt, 'text/plain');
  return send('Fetch.continueRequest', { requestId });
});

try {
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true });
  await send('DOM.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*opensubtitles.com*' }] });
  await send('Emulation.setCPUThrottlingRate', { rate: +slowdown });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: site }); await sleep(800);
  await js(`localStorage.clear();sessionStorage.clear();for(const [k,v] of Object.entries({welcome:'1',seenVersion:'999.0.0',updates:'0',mode:'write',setupModes:'{"write":true,"transcribe":true,"record":true}','ai.keys':'{"opensubtitles":"test-key"}'}))localStorage.setItem('scribecue.'+k,v);indexedDB.deleteDatabase('scribecue-dialogue');true`);
  await send('Page.reload'); await sleep(2000);
  const sum = `(()=>{const t=performance.now();let x=0;for(let i=0;i<3e7;i++)x+=i%7;return performance.now()-t})()`;
  const slow = await js(sum);
  await send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const full = await js(sum);
  await send('Emulation.setCPUThrottlingRate', { rate: +slowdown });
  console.log(`page speed: ${(slow / full).toFixed(1)}× slower (${Math.round(full)} ms -> ${Math.round(slow)} ms)`);
  await js(`window.__errors=[];addEventListener('error',e=>__errors.push(e.message));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));true`);

  await setFile('#fileVideo', videoFile);
  await wait(`!document.getElementById('dialPick').hidden`);
  await sleep(1500);
  assert.ok(await js(`[...document.getElementById('dialSel').options].some(o=>o.value==='opensubs')`), 'the picker offers OpenSubtitles');
  await js(`document.querySelector('video').play();true`); await sleep(500);

  // Search and pick while the video plays.
  let t0 = Date.now();
  const searching = measure(`(()=>{const s=document.getElementById('dialSel');s.value='opensubs';s.dispatchEvent(new Event('change'));setTimeout(()=>document.getElementById('osGo').click(),300);return null})()`, 3000);
  await wait(`document.querySelectorAll('#osList li').length===3`);
  const searchMs = Date.now() - t0;
  console.log(`searching: results in ${searchMs} ms; while searching:`, await searching);
  assert.equal(await js(`document.querySelector('#osList li .osfit')?.textContent`), 'Fits this file', 'the hash match is first');
  assert.match(await js(`document.getElementById('osStatus').textContent`), /3 found\. One fits this file exactly/);
  await shoot('results');
  t0 = Date.now();
  const picking = measure(`(document.querySelector('#osList li button').click(),null)`, 3000);
  await wait(`!document.getElementById('osDlg').open`);
  const pickMs = Date.now() - t0;
  console.log(`picking: lane in ${pickMs} ms; while picking:`, await picking);
  assert.match(await js(`document.getElementById('toast').textContent`), new RegExp(`Dialogue lane: ${(+cueCount).toLocaleString('en')} subtitles from OpenSubtitles\\. 4 downloads left today`));
  assert.match(await js(`document.getElementById('dialSel').selectedOptions[0].textContent`), /^OpenSubtitles: Test\.Film/);
  assert.equal(await js(`document.getElementById('dialTrack').hidden`), false, 'the lane shows');
  console.log('playing with the lane:', await measure(`null`, 4000), await js(`(()=>{const q=document.querySelector('video').getVideoPlaybackQuality();return {shown:q.totalVideoFrames,dropped:q.droppedVideoFrames}})()`));
  await js(`document.querySelector('video').pause();true`);
  await shoot('lane');
  const searched = asked.filter((a) => a.startsWith('GET') && a.includes('/subtitles'));
  assert.equal(searched.length, 2, 'one search by hash, one by title');
  // It comes back when the video is opened again, with no download.
  const downloads = asked.filter((a) => a.startsWith('POST')).length;
  await send('Page.reload'); await sleep(2500);
  await setFile('#fileVideo', videoFile);
  await wait(`document.getElementById('dialSel').value==='file'`, 200);
  assert.equal(asked.filter((a) => a.startsWith('POST')).length, downloads, 'no new download');
  assert.deepEqual(await js(`window.__errors||[]`), []);
  console.log('opensubs smoke passed');
} finally { ws.close(); }
