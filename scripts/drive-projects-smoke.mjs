// Projects in Google Drive, in headless, muted Chrome at a CPU slowdown, with Google, Drive
// and the relay's sign-in helper stood in for. Saves a 1500-block project to Drive, autosaves
// an edit, saves a copy when another computer changed it, keeps saving to Drive after a
// reload, and opens a project from the list. A new project's first save asks for a name and
// where it goes, and can remember that.
// Usage: node scripts/drive-projects-smoke.mjs <devtools port> <site url> [screenshot.png] [slowdown]
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const [,, port, site, shot, slowdown = '6'] = process.argv;
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
const wait = async (expression, tries = 160) => { for (let i = 0; i < tries; i++) { if (await js(expression).catch(() => false)) return; await sleep(250); } throw Error('Timed out: ' + expression); };
const waitFor = async (test, what, tries = 160) => { for (let i = 0; i < tries; i++) { if (test()) return; await sleep(250); } throw Error('Timed out: ' + what); };
const shoot = async (name) => { if (!shot) return; const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(shot.replace(/\.png$/, `-${name}.png`), Buffer.from(s.result.data, 'base64')); };
const open = async (n) => { await js(`document.activeElement?.blur();[...document.querySelectorAll('#list .row')][${n}].click();true`); await sleep(400); };
const key = async (k, code) => { const p = { key: k, code, windowsVirtualKeyCode: { Escape: 27, Enter: 13 }[k] }; await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...p }); await send('Input.dispatchKeyEvent', { type: 'keyUp', ...p }); await sleep(150); };
const type = async (text) => { for (const ch of text) await send('Input.insertText', { text: ch }); };
const toast = () => js(`document.getElementById('toast').textContent`);

// Google Drive, as far as Scribecue uses it: files with names, parents, marks and revisions.
const files = new Map(); let n = 0;
const make = (meta, body) => { const f = { id: `f${++n}`, revision: `r${n}-1`, modifiedTime: new Date().toISOString(), trashed: false, ...meta, body }; files.set(f.id, f); return f; };
const meta = (f) => ({ id: f.id, name: f.name, headRevisionId: f.revision, modifiedTime: f.modifiedTime, trashed: f.trashed });
const bodyOf = (request) => request.postDataEntries ? Buffer.concat(request.postDataEntries.map((e) => Buffer.from(e.bytes || '', 'base64'))).toString() : (request.postData || '');
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
  asked.push(`${request.method} ${url.pathname}${url.search.includes('alt=media') ? '?media' : ''}`);
  if (url.host === 'share.kyleadvoice.ca') return reply({ access: 'acc', expires: 3599 });
  const q = url.searchParams.get('q') || '';
  const p = url.pathname;
  if (p === '/drive/v3/files' && request.method === 'GET') {
    if (q.includes("appDataFolder") || url.searchParams.get('spaces') === 'appDataFolder') return reply({ files: [] });
    let list = [...files.values()].filter((f) => !f.trashed);
    if (q.includes('vnd.google-apps.folder')) list = list.filter((f) => f.folder);
    else if (q.includes('appProperties')) list = list.filter((f) => f.project);
    else if (q.includes('in parents')) list = list.filter((f) => f.parent === q.match(/'([^']+)' in parents/)[1]);
    return reply({ files: list.map(meta) });
  }
  if (p === '/drive/v3/files' && request.method === 'POST') { const f = make({ ...JSON.parse(bodyOf(request)), folder: true }); return reply(meta(f)); }
  const one = p.match(/^\/drive\/v3\/files\/([^/]+)$/);
  if (one) {
    const f = files.get(one[1]);
    if (!f) return reply({}, { status: 404 });
    return url.searchParams.get('alt') === 'media' ? reply(f.body) : reply(meta(f));
  }
  if (p === '/upload/drive/v3/files' && request.method === 'POST') {
    const text = bodyOf(request), boundary = (request.headers['Content-Type'] || request.headers['content-type']).match(/boundary=(.+)/)[1];
    const [, head, content] = text.split(`--${boundary}`);
    const m2 = JSON.parse(head.split('\r\n\r\n')[1]);
    const f = make({ name: m2.name, parent: m2.parents[0], project: m2.appProperties?.scribecue === 'project' }, content.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''));
    return reply(meta(f));
  }
  const up = p.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/);
  if (up && request.method === 'PATCH') {
    const f = files.get(up[1]);
    f.body = bodyOf(request); f.revision = `${f.id}-${Date.now()}`; f.modifiedTime = new Date().toISOString();
    return reply(meta(f));
  }
  return reply({}, { status: 404 });
});
const projects = () => [...files.values()].filter((f) => f.project);

try {
  await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/js/config.js*' }, { urlPattern: '*share.kyleadvoice.ca/google/*' }, { urlPattern: '*www.googleapis.com/*' }] });
  await send('Emulation.setCPUThrottlingRate', { rate: +slowdown });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: site }); await sleep(800);
  // Connected already, with projects allowed, and an unsaved 1500-block script.
  await js(`localStorage.clear();sessionStorage.clear();indexedDB.deleteDatabase('scribecue');
    for(const [k,v] of Object.entries({welcome:'1',seenVersion:'999.0.0',updates:'0',mode:'write',setupModes:'{"write":true,"transcribe":true,"record":true}',
      google:'{"sealed":"s","email":"writer@example.com","projects":true}',googleSync:'{"seen":{},"synced":1}'}))localStorage.setItem('scribecue.'+k,v);
    localStorage.setItem('scribecue.v1',JSON.stringify({dirty:true,subName:'Pilot.srt',cues:Array.from({length:1500},(_,i)=>({uid:'b'+String(i).padStart(7,'0')+'-0000-4000-8000-000000000000',start:i*4.8,end:i*4.8+3,text:'Block number '+(i+1)+' describes the scene.'}))}));true`);
  await send('Page.reload'); await sleep(3500);
  await js(`window.__errors=[];addEventListener('error',e=>__errors.push(e.message));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));
    window.__long=[];new PerformanceObserver(l=>__long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'});true`);
  assert.equal(await js(`document.getElementById('saveDriveItem').hidden`), false, 'File has Save to Google Drive');

  // Save to Google Drive.
  let t0 = Date.now();
  await js(`document.querySelector('[data-act="saveDrive"]').click(),true`);
  // A new project asks for its name first. From this menu item, Drive is the only choice.
  await wait(`document.getElementById('firstSaveDlg').open`);
  assert.equal(await js(`document.getElementById('firstSaveName').value`), 'Pilot');
  assert.equal(await js(`document.getElementById('firstSaveLocal').hidden && document.getElementById('firstSaveAlwaysRow').hidden`), true);
  await shoot('name');
  await key('Enter', 'Enter');
  await wait(`/to Google Drive\\. Changes save there/.test(document.getElementById('toast').textContent)`);
  console.log(`saved 1500 blocks to Drive in ${Date.now() - t0} ms`);
  assert.equal(projects().length, 1);
  const first = projects()[0];
  assert.equal(first.name, 'Pilot.scribecue');
  assert.ok([...files.values()].some((f) => f.folder && f.name === 'Scribecue' && f.id === first.parent), 'in the Scribecue folder');
  assert.equal(JSON.parse(first.body).blocks.length, 1500);
  await wait(`document.getElementById('autosaveBtn').textContent==='saved to Drive'`);
  await shoot('saved');

  // An edit autosaves to it.
  await open(1);
  await type(' Edited here.');
  await key('Escape', 'Escape');
  t0 = Date.now();
  await waitFor(() => first.body.includes('Edited here.'), 'the edit reached Drive');
  console.log(`an edit reached Drive in ${Date.now() - t0} ms`);

  // After a reload, the next autosave still goes to the same file: the revision autosave
  // wrote was kept, so it isn't taken for a change on another computer.
  await send('Page.reload'); await sleep(3500);
  await js(`window.__errors=[];addEventListener('error',e=>__errors.push(e.message));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));
    window.__long=[];new PerformanceObserver(l=>__long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'});true`);
  await open(1);
  await type(' Then reloaded.');
  await key('Escape', 'Escape');
  await waitFor(() => first.body.includes('Then reloaded.'), 'the edit after reloading reached the same file');
  assert.equal(projects().length, 1, 'no copy after reloading');
  // Save while an autosave may be running: still no copy.
  await open(3);
  await type(' Saved by hand.');
  await js(`document.querySelector('[data-act="saveProject"]').click(),true`);
  await key('Escape', 'Escape');
  await waitFor(() => first.body.includes('Saved by hand.'), 'the save by hand reached the same file');
  await sleep(2500);
  assert.equal(projects().length, 1, 'no copy when Save and autosave meet');

  // Renamed in Drive: the next save goes to the same file, and the new name shows, after a
  // reload too. A rename doesn't change the file's revision in Drive.
  first.name = 'Pilot final.scribecue';
  await open(4);
  await type(' After renaming.');
  await key('Escape', 'Escape');
  await waitFor(() => first.body.includes('After renaming.'), 'the edit after renaming reached the same file');
  await wait(`document.getElementById('subName').textContent.startsWith('Pilot final.scribecue')`);
  await send('Page.reload'); await sleep(3500);
  await js(`window.__errors=[];addEventListener('error',e=>__errors.push(e.message));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));
    window.__long=[];new PerformanceObserver(l=>__long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'});true`);
  assert.ok((await js(`document.getElementById('subName').textContent`)).startsWith('Pilot final.scribecue'), 'the new name after reloading');
  await open(5);
  await type(' Renamed and reloaded.');
  await key('Escape', 'Escape');
  await waitFor(() => first.body.includes('Renamed and reloaded.'), 'saving after renaming and reloading');
  assert.equal(projects().length, 1, 'no copy after renaming');
  // And back, as after tidying up copies: "Pilot (5)" renamed to "Pilot".
  first.name = 'Pilot.scribecue';
  await open(6);
  await type(' Named back.');
  await key('Escape', 'Escape');
  await waitFor(() => first.body.includes('Named back.'), 'saving after naming it back');
  await wait(`document.getElementById('subName').textContent.startsWith('Pilot.scribecue')`);
  assert.equal(projects().length, 1, 'no copy after naming it back');

  // Another computer saves it; the next save here goes into a copy beside it.
  first.revision = 'elsewhere'; first.body = first.body.replace('Edited here.', 'Edited there.');
  await open(2);
  await type(' Second edit.');
  await key('Escape', 'Escape');
  await waitFor(() => projects().length === 2, 'a copy was made');
  const copy = projects()[1];
  assert.equal(copy.name, 'Pilot (2).scribecue');
  assert.ok(copy.body.includes('Second edit.') && copy.body.includes('Edited here.'));
  assert.ok(first.body.includes('Edited there.') && !first.body.includes('Second edit.'), 'the other computer’s save is untouched');
  await wait(`/was changed on another computer, so this was saved beside it as Pilot \\(2\\)/.test(document.getElementById('toast').textContent)`);
  await shoot('copy');

  const before = await js(`window.__long`);
  console.log(`long tasks before reloading: ${before.length}, longest ${Math.round(Math.max(0, ...before))} ms`);
  // After a reload, saving still goes to the copy in Drive.
  await send('Page.reload'); await sleep(3500);
  await js(`window.__errors=[];addEventListener('error',e=>__errors.push(e.message));window.__long=[];new PerformanceObserver(l=>__long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'});true`);
  await wait(`document.getElementById('autosaveBtn').textContent==='saved to Drive'`);
  await open(3);
  await type(' After reload.');
  await key('Escape', 'Escape');
  await waitFor(() => copy.body.includes('After reload.'), 'saved to the copy after reloading');
  assert.equal(projects().length, 2, 'no new copy');

  // Open from Google Drive lists both, newest first, and opens one.
  await js(`window.confirm=()=>true;document.querySelector('[data-act="openDrive"]').click(),true`);
  await wait(`document.getElementById('driveDlg').open && document.querySelectorAll('#driveList .sharedrow').length===2`);
  assert.equal(await js(`document.querySelector('#driveList .sharedrow strong').textContent`), 'Pilot (2).scribecue');
  await shoot('open');
  await js(`document.getElementById('driveFind').value='pilot.';document.getElementById('driveFind').dispatchEvent(new Event('input'));true`);
  assert.equal(await js(`document.querySelectorAll('#driveList .sharedrow').length`), 1);
  await js(`document.querySelector('#driveList .sharedrow').click(),true`);
  await wait(`!document.getElementById('driveDlg').open`);
  await wait(`[...document.querySelectorAll('#list .row')].some(r=>r.textContent.includes('Edited there.'))`);
  assert.match(await js(`document.title`), /^Pilot\.scribecue/);
  const long = await js(`window.__long`);
  console.log(`long tasks after reloading: ${long.length}, longest ${Math.round(Math.max(0, ...long))} ms`);

  // A new project's first Save asks where. Always remembers it, and Settings shows it.
  const fresh = (name) => js(`localStorage.setItem('scribecue.v1',JSON.stringify({dirty:true,subName:'${name}',cues:[{uid:'c0000000-0000-4000-8000-000000000000',start:1,end:3,text:'A new block.'}]}));true`);
  await fresh('untitled.srt');
  await send('Page.reload'); await sleep(3500);
  await js(`window.__errors=[];addEventListener('error',e=>__errors.push(e.message));true`);
  await js(`document.querySelector('[data-act="saveProject"]').click(),true`);
  await wait(`document.getElementById('firstSaveDlg').open`);
  assert.equal(await js(`!document.getElementById('firstSaveLocal').hidden && !document.getElementById('firstSaveAlwaysRow').hidden`), true, 'both places offered');
  assert.equal(await js(`document.querySelector('#firstSaveDlg .updbtns .hl').id`), 'firstSaveLocal', 'Chrome can save here, so this computer comes first');
  await js(`const f=document.getElementById('firstSaveName');f.value='Episode two.scribecue';document.getElementById('firstSaveAlways').click();true`);
  await shoot('ask');
  await js(`document.getElementById('firstSaveDrive').click(),true`);
  await waitFor(() => projects().some((f) => f.name === 'Episode two.scribecue'), 'saved under the typed name');
  assert.equal(await js(`localStorage.getItem('scribecue.saveNew')`), 'drive');
  assert.equal(await js(`document.getElementById('gdSaveNew').value`), 'drive');
  assert.equal(await js(`document.getElementById('gdSaveNewRow').hidden`), false);

  // The next new project goes straight to Drive.
  await fresh('Episode 3.srt');
  await send('Page.reload'); await sleep(3500);
  await js(`document.querySelector('[data-act="saveProject"]').click(),true`);
  await waitFor(() => projects().some((f) => f.name === 'Episode 3.scribecue'), 'saved straight to Drive');
  assert.equal(await js(`document.getElementById('firstSaveDlg').open`), false, 'not asked');
  await wait(`document.getElementById('autosaveBtn').textContent==='saved to Drive'`);
  // Once it's in Drive, Save saves it there, without asking.
  await js(`document.querySelector('[data-act="saveProject"]').click(),true`);
  await sleep(1000);
  assert.equal(await js(`document.getElementById('firstSaveDlg').open`), false);
  assert.equal(projects().filter((f) => f.name.startsWith('Episode 3')).length, 1);
  assert.deepEqual(await js(`window.__errors||[]`), []);
  console.log('requests:', asked.length);
  console.log('drive projects smoke passed');
} finally { ws.close(); }
