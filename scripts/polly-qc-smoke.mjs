// New Amazon Polly readings in QC, in headless, muted Chrome at 6× CPU slowdown. A stand-in
// answers as Polly does, so no AWS account is needed and no real reading is made.
// Usage: node scripts/polly-qc-smoke.mjs <devtools port> <site url> [screenshot folder]
// (the site needs polly-test.mp3)
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const [,, port, site, shots] = process.argv;
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expression) => {
  const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (m.result?.exceptionDetails) throw Error(JSON.stringify(m.result.exceptionDetails));
  return m.result.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (e, n = 200) => { for (let i = 0; i < n; i++) { if (await js(e)) return; await sleep(100); } throw Error('Timed out: ' + e + '\n' + await js(`document.getElementById('qcBlockInfo')?.textContent`)); };
const shot = async (name) => {
  if (!shots) return;
  const m = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${shots}/${name}.png`, Buffer.from(m.result.data, 'base64'));
};
const VOICE = 'polly:neural:en-US:Matthew';
const REVIEW = { key: 'AKIAREVIEW', secret: 'review-secret', region: 'ca-central-1' };
const MINE = { key: 'AKIAMINE', secret: 'my-secret', region: 'us-east-1', voices: [{ Id: 'Matthew', Name: 'Matthew', Gender: 'Male', LanguageCode: 'en-US', SupportedEngines: ['neural'] }] };

await send('Page.enable');
await send('Emulation.setCPUThrottlingRate', { rate: 6 });
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__calls=[];window.__ssml=[];window.__offers=0;
  window.confirm=()=>{__offers++;return true};
  const real=window.fetch;
  window.fetch=async(url,init)=>{
    if(!String(url).includes('amazonaws.com'))return real(url,init);
    if(String(url).includes('/v1/voices'))return new Response(JSON.stringify({Voices:${JSON.stringify(MINE.voices)}}));
    __calls.push(/Credential=(\\w+)\\//.exec(init.headers.authorization)[1]);__ssml.push(JSON.parse(init.body).Text);
    await new Promise(r=>setTimeout(r,200));
    return real('/polly-test.mp3');
  };
  const click=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){if(this.download)window.__download=real(this.href).then(r=>r.blob());else click.call(this)};
` });

const seed = async (aws) => {
  await send('Page.navigate', { url: site }); await sleep(700);
  await js(`localStorage.clear();for(const [k,v] of Object.entries({proof:'{"warn":false}',welcome:'1',updates:'0',seenVersion:'999.0.0',setupModes:'{"write":true,"transcribe":true,"qc":true,"record":true}',loops:'{"write":true,"transcribe":true}'}))localStorage.setItem('scribecue.'+k,v);
    localStorage.setItem('scribecue.tts',${JSON.stringify(JSON.stringify({ on: true, voice: VOICE }))});
    ${aws ? `localStorage.setItem('scribecue.pollyTts',${JSON.stringify(JSON.stringify(aws))});` : ''}true`);
  await send('Page.reload', { ignoreCache: true });
  await wait(`!!document.getElementById('qcExportStart')`); await sleep(1500);
};
// A package as the writer's export makes it, opened by the reviewer.
const openPackage = async (extra) => {
  await js(`(async()=>{
    const {toProject,newIdentity}=await import('./js/project.js');const {buildReview}=await import('./js/qc.js');const {writeWav}=await import('./js/tts.js');
    const wav=writeWav(new Int16Array(48000),48000);
    const p=toProject({projectId:newIdentity(),blocks:[{uid:newIdentity(),start:3,end:6,text:'Mara opens the blue door.'}],settings:{mode:'qc',ttsVoice:'${VOICE}',ttsBase:1}});
    window.__original=await buildReview(p,async()=>({blob:wav,secs:1,voice:'${VOICE}'}),{handoff:true,allowEdits:true,...${JSON.stringify(extra)}});
    const d=new DataTransfer();d.items.add(new File([__original],'review.scribecueqc'));document.dispatchEvent(new DragEvent('drop',{dataTransfer:d,bubbles:true,cancelable:true}));
  })()`);
  await wait(`document.getElementById('subName').textContent.includes('review')&&document.querySelectorAll('#list .row').length===1`);
  await js(`document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.querySelector('#list .row').click();true`);
  await sleep(500);
};
const edit = (text) => js(`(()=>{const f=document.getElementById('edText');f.focus();f.value=${JSON.stringify(text)};f.dispatchEvent(new Event('input',{bubbles:true}));f.blur()})()`);
const info = () => js(`document.getElementById('qcBlockInfo').textContent`);
const made = (n) => wait(`__calls.length===${n}&&!document.getElementById('qcBlockInfo').textContent.startsWith('Making')`);

// No key anywhere: the block says what it needs, and nothing is sent.
await seed(null);
await openPackage({});
await edit('Mara opens the green door.');
await wait(`document.getElementById('qcBlockInfo').textContent==='Needs an AWS key'`);
assert.equal(await js(`__calls.length`), 0);
console.log('No key:', await info());

// The package's key reads a changed block, once, and its end follows the reading.
await seed(null);
await openPackage({ pollyReviewKey: REVIEW });
assert.equal(await js(`__calls.length`), 0, 'opening reads nothing');
assert.equal(await js(`document.getElementById('edVoiceWrap').hidden`), true, 'the block keeps its voice');
await js(`window.__long=[];new PerformanceObserver(l=>{for(const e of l.getEntries())__long.push(e.duration)}).observe({type:'longtask'});true`);
await edit('Mara opens the green & red door.');
await made(1);
assert.deepEqual(await js(`__calls`), ['AKIAREVIEW']);
assert.match((await js(`__ssml[0]`)), /^<speak><prosody rate="100%">Mara opens the green &amp; red door\.<\/prosody><\/speak>$/);
await wait(`document.getElementById('qcBlockInfo').textContent.startsWith('New reading')`);
console.log('Package’s key:', await info(), '·', await js(`document.getElementById('edDur').textContent`));
const long = await js(`__long`);
console.log(`Long tasks during the reading: ${long.length}, longest ${Math.round(Math.max(0, ...long))} ms at 6× slowdown`);
await shot('polly-qc-block');
// Changing the words back uses the original, with nothing sent.
await edit('Mara opens the blue door.');
await sleep(900);
assert.equal(await js(`__calls.length`), 1);
assert.match(await info(), /^Original/);

// The reviewer's own key goes first.
await seed(MINE);
await openPackage({ pollyReviewKey: REVIEW });
await edit('Mara opens the red door.');
await made(1);
assert.deepEqual(await js(`__calls`), ['AKIAMINE']);
assert.equal(await js(`__offers`), 0);

// The writer's export window.
await seed(MINE);
await js(`localStorage.setItem('scribecue.v1',JSON.stringify({cues:[{start:1,end:3,text:'Mara arrives.'}],dirty:false}));true`);
await send('Page.reload', { ignoreCache: true });
await wait(`!!document.getElementById('qcExportStart')`); await sleep(2000);
await js(`document.querySelector('[data-act=exportQc]').click();true`);
await wait(`document.getElementById('qcExportDlg').open`); await sleep(400);
assert.equal(await js(`document.getElementById('qcPollyAccess').hidden`), true, 'comments-only packages hold no key');
await js(`document.getElementById('qcExportAllowEdits').click();true`); await sleep(200);
assert.equal(await js(`document.getElementById('qcPollyAccess').hidden`), false);
assert.equal(await js(`document.getElementById('qcPollyKeyRow').hidden`), true);
await js(`document.getElementById('qcExportPolly').click();true`); await sleep(200);
assert.equal(await js(`document.getElementById('qcPollyKeyRow').hidden`), false);
assert.equal(await js(`document.getElementById('qcPollyRegion').value`), 'us-east-1', 'starts at the writer’s region');
assert.equal(await js(`document.getElementById('qcPollyKey').value`), '', 'the writer’s key is never filled in');
await js(`document.getElementById('qcExportStart').click();true`); await sleep(200);
assert.match(await js(`document.getElementById('qcExportStatus').textContent`), /Paste the separate access key/);
await js(`document.getElementById('qcPollyKey').value='AKIAMINE';document.getElementById('qcPollySecret').value='x';document.getElementById('qcExportStart').click();true`); await sleep(200);
assert.match(await js(`document.getElementById('qcExportStatus').textContent`), /main AWS key/);
await js(`document.getElementById('qcPollyKey').value='${REVIEW.key}';document.getElementById('qcPollySecret').value='${REVIEW.secret}';document.getElementById('qcPollyRegion').value='${REVIEW.region}';true`);
await shot('polly-qc-export');
await js(`document.getElementById('qcExportStart').click();true`);
await wait(`/QC package saved/.test(document.getElementById('qcExportStatus').textContent)`, 300);
const kept = await js(`(async()=>{const q=await import('./js/qc.js');const r=await q.readReview(await __download);return {access:r.reviewAccess,voices:[...r.rereadVoices],read:r.readings.length}})()`);
assert.deepEqual(kept.access, { polly: REVIEW });
assert.deepEqual(kept.voices, [VOICE]);
assert.equal(kept.read, 1);
assert.equal(await js(`document.getElementById('qcPollySecret').disabled`), false);
await js(`document.getElementById('qcExportDlg').close();true`); await sleep(100);
assert.equal(await js(`document.getElementById('qcPollySecret').value`), '', 'closing clears the key');
console.log('Polly QC checks passed');
process.exit(0);
