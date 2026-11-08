// QC packages that leave out Piper audio, in headless, muted Chrome at 6× CPU slowdown: the
// export, live readings during playback, a missing voice, and comparing a returned review.
// Usage: node scripts/qc-live-smoke.mjs <devtools port> <site url with demo.mkv and Piper>
import assert from 'node:assert/strict';
const [,, port, site] = process.argv;
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expression) => {
  const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (m.result?.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails));
  return m.result.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (expression, tries = 300) => { for (let i = 0; i < tries; i++) { if (await js(expression)) return; await sleep(100); } throw new Error('Timed out: ' + expression); };
const click = (el) => js(`document.getElementById(${JSON.stringify(el)}).click(); true`);
const info = () => js(`document.getElementById('qcBlockInfo').textContent`);
const dialog = (name) => `document.getElementById(${JSON.stringify(name)}).open`;
const openFiles = (expr) => js(`(async()=>{const d=new DataTransfer();for(const f of ${expr})d.items.add(f);document.dispatchEvent(new DragEvent('drop',{dataTransfer:d,bubbles:true,cancelable:true}));return 1})()`);
try {
  await send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Page.navigate', { url: site }); await sleep(800);
  const cues = [[3, 6, 'The first block is read here.'], [8, 11, 'The second block follows it.'], [13, 16, 'The third block ends the scene.']].map(([start, end, text]) => ({ start, end, text }));
  await js(`localStorage.clear();localStorage.setItem('scribecue.proof','{"warn":false}');localStorage.setItem('scribecue.welcome','1');localStorage.setItem('scribecue.setupModes',JSON.stringify({write:true,transcribe:true,qc:true,record:true}));localStorage.setItem('scribecue.seenVersion','999.0.0');localStorage.setItem('scribecue.updates','0');localStorage.setItem('scribecue.mode','write');localStorage.setItem('scribecue.loops',JSON.stringify({write:true,transcribe:true,qc:true}));localStorage.setItem('scribecue.v1',JSON.stringify({cues:${JSON.stringify(cues)},dirty:false}));location.reload();true`);
  await sleep(1600);
  await js(`window.confirm=()=>true;window.__errors=[];addEventListener('error',e=>__errors.push(e.message));window.__long=[];new PerformanceObserver(l=>__long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'});window.showSaveFilePicker=async()=>({name:'writer.scribecue',queryPermission:async()=>'granted',requestPermission:async()=>'granted',createWritable:async()=>({write:async t=>{window.__saved=t},close:async()=>{}})});HTMLAnchorElement.prototype.click=function(){if(this.download.endsWith('.scribecueqc'))window.__download=this.href;};true`);
  await wait(`(async()=>{const t=await import('./js/tts.js');return t.reviewVoices().some(v=>v.id.startsWith('piper:'));})()`);
  const voice = await js(`(async()=>{const t=await import('./js/tts.js');const v=t.reviewVoices().find(v=>v.id.startsWith('piper:'));t.setTtsOption('voice',v.id);return v.id})()`);

  // The export reads nothing and the file stays small.
  await js(`document.querySelector('[data-act=exportQc]').click();true`); await sleep(300);
  assert.match(await js(`document.getElementById('qcExportVoices').textContent`), /read on the reviewer’s computer/);
  const started = Date.now();
  await click('qcExportStart'); await wait(`!!window.__download`);
  const made = await js(`(async()=>{const q=await import('./js/qc.js');window.__package=await fetch(__download).then(r=>r.blob());const r=await q.openReview(__package);return {readings:r.readings.length,live:r.live,bytes:__package.size};})()`);
  assert.deepEqual([made.readings, made.live], [0, true]);
  assert.ok(made.bytes < 100000, `${made.bytes} bytes`);
  console.log('Package:', JSON.stringify({ ...made, ms: Date.now() - started }));
  await click('qcExportClose');
  await js(`document.body.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyS',key:'s',metaKey:true,bubbles:true,cancelable:true}));true`);
  await wait(`!!window.__saved`);
  await js(`window.__writer=new File([__saved],'writer.scribecue');true`);

  // A reviewer hears each block from this computer, on time.
  await openFiles(`[new File([__package],'review.scribecueqc'),new File([await fetch('/demo.mkv').then(r=>r.blob())],'demo.mkv')]`);
  await wait(`document.body.classList.contains('mode-qc')&&document.body.classList.contains('qc-package')&&document.getElementById('subName').textContent.includes('review')`);
  await wait(`document.querySelector('video').readyState>=3`);
  await sleep(600);
  assert.equal(await js(dialog('qcVoiceDlg')), false);
  assert.match(await js(`document.querySelector('#ind [data-key=qc]').textContent`), /ORIGINAL READINGS/);
  await js(`document.querySelector('#list .row').click();true`); await sleep(300);
  assert.match(await info(), /^Read here with /);
  await js(`window.__heard=[];(async()=>{const t=await import('./js/tts.js'),v=document.querySelector('video');let was=null;const look=()=>{const s=t.tts.speaking?.id??null;if(s!==null&&s!==was)__heard.push({at:v.currentTime,paused:v.paused,playing:!t.tts.speaking?.silent});was=s;if(!window.__stopLook)requestAnimationFrame(look);};look();v.currentTime=1.5;})();true`);
  await sleep(500); await js(`__long.length=0;document.getElementById('edText').blur();document.body.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',key:' ',bubbles:true,cancelable:true}));true`);
  await wait(`document.querySelector('video').currentTime>=15.5`, 400);
  await js(`window.__stopLook=true;document.body.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',key:' ',bubbles:true,cancelable:true}));true`);
  const heard = await js(`__heard`), long = await js(`({count:__long.length,max:Math.round(Math.max(0,...__long))})`);
  assert.equal(heard.length, 3, JSON.stringify(heard));
  const late = heard.map((h, i) => Math.round((h.at - cues[i].start) * 1000));
  assert.ok(late.slice(1).every((ms) => ms < 500), JSON.stringify(late));
  console.log('Live readings started late by (ms):', JSON.stringify(late), 'long tasks:', JSON.stringify(long));

  // Without the voice, the review says so and offers it.
  await js(`(async()=>{const t=await import('./js/tts.js');window.__fetch=fetch;window.fetch=(u,o)=>String(u).includes('tts/voices')?Promise.resolve(new Response('{}')):__fetch(u,o);await t.loadPiper();})()`);
  await openFiles(`[new File([__package],'review2.scribecueqc')]`);
  await wait(dialog('qcVoiceDlg'));
  assert.match(await js(`document.getElementById('qcVoiceList2').textContent`), new RegExp(await js(`(async()=>(await import('./js/tts.js')).voiceLabel(${JSON.stringify(voice)}))()`).then((s) => s.replace(/[()]/g, '\\$&'))));
  await click('qcVoiceLater');
  await js(`document.querySelector('#list .row').click();true`); await sleep(300);
  assert.match(await info(), /^Needs /);
  await js(`(async()=>{const t=await import('./js/tts.js');window.fetch=__fetch;await t.loadPiper();})()`); await sleep(400);
  await wait(`document.getElementById('qcBlockInfo').textContent.startsWith('Read here')`);

  // A comment comes back, and the writer's project hears the same blocks afterwards.
  await click('edComment');
  await js(`document.getElementById('commentText').value='Check this name';document.getElementById('commentPost').click();document.getElementById('commentsClose').click();true`);
  await sleep(500);
  // The reviewer saves the package and sends that file back.
  await js(`window.__saved=null;document.body.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyS',key:'s',metaKey:true,bubbles:true,cancelable:true}));true`);
  await wait(`!!window.__saved`);
  await js(`window.__returned=new Blob([__saved]);true`);
  await openFiles(`[__writer]`);
  await wait(`!document.body.classList.contains('qc-package')&&document.getElementById('subName').textContent.includes('writer')`);
  await js(`document.querySelector('#modeSw [data-mode=qc]').click();true`); await sleep(300);
  await js(`document.querySelector('#ind [data-key=qc]').click();true`); await wait(dialog('qcPlaybackDlg'));
  await click('qcCompareReturned'); await wait(dialog('reviewCompareDlg'));
  await js(`(()=>{const d=new DataTransfer();d.items.add(new File([__returned],'returned.scribecueqc'));const i=document.getElementById('reviewCompareFile');i.files=d.files;i.dispatchEvent(new Event('change'));})()`);
  await wait(`!document.getElementById('reviewCompareSave').hidden&&!document.getElementById('reviewCompareSave').disabled`);
  await click('reviewCompareSave');
  await wait(`!document.getElementById('reviewCompareDlg').open`);
  await sleep(500);
  await click('commentsBtn'); await sleep(300);
  assert.match(await js(`document.getElementById('commentsLog').textContent`), /Check this name/);
  await click('commentsClose');
  await js(`document.querySelector('#list .row').click();true`); await sleep(300);
  assert.match(await info(), /^Read here with /);
  assert.deepEqual(await js(`__errors`), []);
  console.log('Live QC readings passed');
} catch (e) {
  console.error(e); console.error(await js(`[document.getElementById('toast')?.textContent,document.getElementById('reviewCompareStatus')?.textContent]`).catch(() => ''));
  process.exitCode = 1;
}
ws.close();
