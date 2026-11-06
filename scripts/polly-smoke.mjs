// Amazon Polly checks in headless, muted Chrome at 6× CPU slowdown. A made-up key goes to
// the real service, which shows the page's security rules let it through and that Amazon's
// refusal reads properly. After that a stand-in answers instead: no AWS account is needed,
// and no real reading is made. It checks the voice list, a retry after too many requests, the
// number of readings at once, stored audio, and that the page stays responsive through a
// big job.
// Usage: node scripts/polly-smoke.mjs <devtools port> <site url> [screenshot folder]
// (the site needs polly-test.mp4 and polly-test.mp3)
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
const wait = async (e, n = 300) => { for (let i = 0; i < n; i++) { if (await js(e)) return; await sleep(100); } throw Error('Timed out: ' + e); };
const shot = async (name) => {
  if (!shots) return;
  const m = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${shots}/${name}.png`, Buffer.from(m.result.data, 'base64'));
};
const BLOCKS = 300;
const blocks = Array.from({ length: BLOCKS }, (_, i) => ({ start: i * 2, end: i * 2 + 1.5, text: `Block ${i + 1} & more > less.` }));
const status = () => js(`document.getElementById('ttsPollyStatus').textContent`);

await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true });
await send('Page.enable');
await send('Emulation.setCPUThrottlingRate', { rate: 6 });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const open = async (keep = false) => {
  await send('Page.navigate', { url: site }); await sleep(800);
  if (!keep) {
    await js(`localStorage.clear();for(const [k,v] of Object.entries({welcome:'1',seenVersion:'999.0.0',updates:'0',mode:'write',setupModes:'{"write":true,"transcribe":true,"qc":true,"record":true}',loops:'{"write":true,"transcribe":true}'}))localStorage.setItem('scribecue.'+k,v);localStorage.setItem('scribecue.tts',${JSON.stringify(JSON.stringify({ on: true }))});localStorage.setItem('scribecue.v1',JSON.stringify({cues:${JSON.stringify(blocks)},dirty:false}));indexedDB.deleteDatabase('scribecue-readings');true`);
    await send('Page.reload', { ignoreCache: true });
  }
  await sleep(4000);
  await js(`(async()=>{const v=await fetch('/polly-test.mp4').then(r=>r.blob());const dt=new DataTransfer();dt.items.add(new File([v],'polly-test.mp4',{type:'video/mp4'}));window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));return 1})()`);
  await wait(`document.querySelector('video').readyState>=2`); await sleep(800);
};
const settings = async () => {
  await js(`document.querySelector('[data-act=settings]').click();true`); await sleep(400);
  await js(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Text to speech'&&b.offsetParent).click();true`);
  await wait(`document.getElementById('ttsDlg').open`);
};
const typeKey = (region) => js(`{const f=(i,v)=>{const e=document.getElementById(i);e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}))};
  f('ttsPollyRegion','${region}');f('ttsPollyKey','AKIDEXAMPLE');f('ttsPollySecret','not-a-real-secret');true}`);

// A made-up key, to the real service.
await open();
await settings();
await js(`document.getElementById('ttsPollyKey').value='AKIDEXAMPLE';document.getElementById('ttsPollyKey').dispatchEvent(new Event('change',{bubbles:true}));true`);
assert.match(await status(), /Add the secret key too/);
await typeKey('ca-central-1');
await wait(`/Amazon/.test(document.getElementById('ttsPollyStatus').textContent)&&!/Asking/.test(document.getElementById('ttsPollyStatus').textContent)`);
console.log('The real service says:', await status());
assert.match(await status(), /didn’t accept the access key/);
assert.equal(await js(`document.getElementById('ttsPollyStatus').classList.contains('err')`), true);

// From here on, a stand-in answers as Polly does.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `{
  const real = window.fetch;
  const stats = window.__polly = { voices: 0, speech: 0, retried: 0, now: 0, most: 0, ssml: '' };
  const voices = [
    { Id: 'Matthew', Name: 'Matthew', Gender: 'Male', LanguageCode: 'en-US', SupportedEngines: ['neural', 'standard', 'generative'] },
    { Id: 'Amy', Name: 'Amy', Gender: 'Female', LanguageCode: 'en-GB', SupportedEngines: ['neural', 'standard'] },
    { Id: 'Tiffany', Name: 'Tiffany', Gender: 'Female', LanguageCode: 'en-US', SupportedEngines: ['generative'] },
  ];
  window.fetch = async (url, init) => {
    if (!String(url).includes('amazonaws.com')) return real(url, init);
    if (String(url).includes('/v1/voices')) {
      stats.voices++;
      const next = String(url).includes('NextToken');
      return new Response(JSON.stringify(next ? { Voices: voices.slice(2) } : { Voices: voices.slice(0, 2), NextToken: 'more' }));
    }
    stats.speech++;
    if (stats.speech === 3) { stats.retried++; return new Response('{"message":"Rate exceeded"}', { status: 400, headers: { 'x-amzn-ErrorType': 'ThrottlingException' } }); }
    stats.now++; stats.most = Math.max(stats.most, stats.now);
    stats.ssml = JSON.parse(init.body).Text;
    await new Promise((r) => setTimeout(r, 150));
    stats.now--;
    return real('/polly-test.mp3');
  };
}` });
await open(true);
await settings();
await js(`{const e=document.getElementById('ttsPollyForget');e.click();true}`);
await sleep(500);
await typeKey('ca-central-1');
await wait(`/voices?, in the voice list/.test(document.getElementById('ttsPollyStatus').textContent)`);
assert.match(await status(), /^4 voices, in the voice list above/);
assert.equal(await js(`document.getElementById('ttsPollyRegion').value`), 'ca-central-1');
const menu = await js(`[...document.querySelectorAll('#ttsVoice optgroup')].filter(g=>g.children.length).map(g=>g.label+': '+[...g.children].map(o=>o.textContent).join(', '))`);
console.log(menu.find((g) => g.startsWith('Amazon Polly')));
assert.ok(menu.some((g) => /^Amazon Polly: the text is sent to Amazon: Polly Neural Matthew/.test(g)));
assert.equal(await js(`document.getElementById('ttsVoice').value`), 'polly:neural:en-US:Matthew');
assert.equal(await js(`document.getElementById('ttsMakeAll').disabled`), false);
assert.equal(await js(`[...document.querySelectorAll('#ttsDlg .cloudcost')].every(e=>!e.hidden)`), true);
await js(`document.getElementById('ttsPollyKey').scrollIntoView({block:'center'});true`);
await sleep(400); await shot('polly-settings');

// A whole script at once, with the page slowed down.
await js(`window.__long=[];new PerformanceObserver(l=>{for(const e of l.getEntries())__long.push(e.duration)}).observe({type:'longtask'});
  window.__frames=0;(function f(){__frames++;requestAnimationFrame(f)})();true`);
const started = Date.now();
await js(`document.getElementById('ttsMakeAll').click();true`);
await wait(`/Made \\d+ reading|Made \\d+ of|ready/.test(document.getElementById('ttsMakeStatus').textContent)`, 3000);
const secs = (Date.now() - started) / 1000;
const made = await js(`document.getElementById('ttsMakeStatus').textContent`);
const stats = await js(`__polly`);
const long = await js(`__long`);
const frames = await js(`__frames`);
const heap = await js(`Math.round(performance.memory.usedJSHeapSize/1e6)`);
console.log(`${made} ${secs.toFixed(1)} s for ${BLOCKS} blocks at 6× slowdown. ${(frames / secs).toFixed(0)} frames a second. ` +
  `${long.length} long tasks, longest ${Math.round(Math.max(0, ...long))} ms. At most ${stats.most} at once, ${stats.retried} retried. Heap ${heap} MB.`);
assert.match(made, new RegExp(`Made ${BLOCKS} readings`));
assert.equal(stats.retried, 1);
assert.ok(stats.most <= 3, `${stats.most} readings at once`);
assert.match(stats.ssml, /^<speak><prosody rate="\d+%">Block \d+ &amp; more &gt; less\.<\/prosody><\/speak>$/);

// The audio is kept, as a WAV file of the right length.
const kept = await js(`new Promise(ok=>{const q=indexedDB.open('scribecue-readings');q.onsuccess=()=>{const t=q.result.transaction('meta').objectStore('meta').getAll();t.onsuccess=()=>ok(t.result.map(e=>({key:e.key,secs:e.secs,bytes:e.bytes})))}})`);
assert.equal(kept.length, BLOCKS);
assert.ok(kept.every((e) => e.key.startsWith('polly:neural:en-US:Matthew|')), kept[0].key);
assert.ok(Math.abs(kept[0].secs - 1.5) < 0.1, `kept reading is ${kept[0].secs} s`);

// Reopening asks Amazon nothing, sends nothing again, and keeps the voices.
await open(true);
assert.deepEqual(await js(`[__polly.voices,__polly.speech]`), [0, 0]);
await settings();
await sleep(500);
assert.match(await status(), /^4 voices/);
await js(`document.getElementById('ttsMakeAll').click();true`);
await wait(`/already/.test(document.getElementById('ttsMakeStatus').textContent)`);
assert.equal(await js(`__polly.speech`), 0);

// Forget takes it all away.
await js(`document.getElementById('ttsPollyForget').click();true`);
await sleep(500);
assert.equal(await js(`localStorage.getItem('scribecue.pollyTts')`), null);
assert.equal(await js(`[...document.querySelectorAll('#ttsVoice option')].some(o=>o.value.startsWith('polly:'))`), false);
assert.equal(await js(`document.getElementById('ttsPollySecret').value`), '');
console.log('Polly checks passed');
process.exit(0);
