// Takes the README screenshots by driving headless Chrome over its DevTools protocol.
// Run through scripts/screenshots.sh, which sets everything up.
const [,, port, outDir, site] = process.argv;
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fs = await import('node:fs');
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  console.log('saved', name);
};
const key = (code, k, o = {}) => js(`document.body.dispatchEvent(new KeyboardEvent('keydown',{code:'${code}',key:'${k}',bubbles:true,cancelable:true,...${JSON.stringify(o)}})); 1`);
const seek = (t) => js(`(async()=>{const v=document.getElementById('video'); v.currentTime=${t}; await Promise.race([new Promise(r=>v.addEventListener('seeked',r,{once:true})), new Promise(r=>setTimeout(r,2000))]); return 1})()`);

await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
await send('Page.enable');
await send('Page.navigate', { url: site });
await sleep(1000);
const cues = [
  [3.0, 6.2, 'Bands of teal and violet light drift across a dark sky.'],
  [11.5, 14.0, 'The colours slowly fold into one another.'],
  [20.0, 23.8, 'A pale blue streak cuts diagonally through the darkness.'],
  [30.2, 32.5, 'The violet glow fades.', 1.15],
  [38.0, 41.6, 'Deep green spreads in from the left edge.'],
].map(([start, end, text, speed]) => ({ start, end, text, speed }));
await js(`localStorage.clear(); localStorage.setItem('scribecue.updates', '0'); localStorage.setItem('scribecue.welcome', '1'); localStorage.setItem('scribecue.tts', JSON.stringify({ on: true })); localStorage.setItem('scribecue.mode', 'write'); localStorage.setItem('scribecue.v1', JSON.stringify({subName:'lights-ad.scribecue', dirty:false, cues:${JSON.stringify(cues)}})); location.reload(); 1`);
await sleep(1500);
await js(`(async()=>{const b=await fetch('/demo.mkv').then(r=>r.blob()); const f=new File([b],'lights.mkv',{type:'video/x-matroska'}); const dt=new DataTransfer(); dt.items.add(f); window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true})); return 1})()`);
for (let i = 0; i < 60; i++) {
  await sleep(500);
  const s = await js(`document.getElementById('toast').textContent + '|' + document.getElementById('trackSel').value`);
  if (/ready/i.test(s) && s.endsWith('|1')) break;
}
console.log(await js(`document.getElementById('toast').textContent + ' track=' + document.getElementById('trackSel').value`));

// main view: whole file fitted, block 3 selected with the playhead inside it
await key('Digit0', '0', { altKey: true });
await sleep(200);
await js(`document.querySelectorAll('#list .row')[2].click(); 1`);
await sleep(300);
await seek(21.6);
await sleep(600);
await js(`document.activeElement?.blur(); document.getElementById('toast').classList.add('fade'); 1`);
await sleep(500);
await shot('main');

await js(`document.querySelector('#modeSw [data-mode=transcribe]').click(); document.getElementById('toast').classList.add('fade'); 1`); await sleep(200);
// hold-to-mark in progress, while playing, zoomed in around it
await seek(44);
await sleep(300);
await key('Equal', '=', { altKey: true });
await sleep(300);
await seek(46.6);
await js(`(async()=>{const v=document.getElementById('video'); await v.play().catch(()=>{}); const t0=performance.now(); while(v.currentTime<47.2 && performance.now()-t0<8000) await new Promise(r=>setTimeout(r,5)); document.body.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyH',key:'h',bubbles:true,cancelable:true})); while(v.currentTime<49.5 && performance.now()-t0<12000) await new Promise(r=>setTimeout(r,5)); return 1})()`);
await shot('hold-to-mark');
await js(`document.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyH',key:'h',bubbles:true})); 1`);
await sleep(500);
await js(`document.activeElement?.blur(); 1`);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 2, mobile: false });
await sleep(300);
await key('Slash', '?', { shiftKey: true });
await sleep(400);
await shot('shortcuts');

await js(`document.querySelector('#modeSw [data-mode=write]').click(); 1`); await sleep(200);
// text to speech panel
await key('Escape', 'Escape'); await sleep(200);
// taller, so the whole panel fits
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1500, deviceScaleFactor: 2, mobile: false });
await sleep(300);
console.log('voices', await js('speechSynthesis.getVoices().length'));
await key('KeyV', 'V', { altKey: true, shiftKey: true }); await sleep(500);
await shot('text-to-speech');
ws.close();
