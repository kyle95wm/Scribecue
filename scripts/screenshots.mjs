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
// clip: a CSS selector to crop to, with a margin around it, or the whole window.
const shot = async (name, clip = null, pad = 16) => {
  let params = { format: 'png' };
  if (clip) {
    const b = await js(`(() => { const r = document.querySelector(${JSON.stringify(clip)}).getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`);
    params = { ...params, clip: { x: Math.max(0, b[0] - pad), y: Math.max(0, b[1] - pad), width: b[2] + pad * 2, height: b[3] + pad * 2, scale: 1 } };
  }
  const r = await send('Page.captureScreenshot', params);
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
await js(`localStorage.clear(); localStorage.setItem('scribecue.updates', '0'); localStorage.setItem('scribecue.welcome', '1'); localStorage.setItem('scribecue.loops', JSON.stringify({ write: true, transcribe: true })); localStorage.setItem('scribecue.seenVersion', '999.0.0'); localStorage.setItem('scribecue.tts', JSON.stringify({ on: true, favourites: ['piper:en_US-lessac-medium', 'piper:en_GB-alba-medium'] })); localStorage.setItem('scribecue.mode', 'write'); localStorage.setItem('scribecue.v1', JSON.stringify({subName:'lights-ad.scribecue', dirty:false, cues:${JSON.stringify(cues)}})); location.reload(); 1`);
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
// text to speech settings
await key('Escape', 'Escape'); await sleep(200);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
await sleep(300);
console.log('voices', await js('speechSynthesis.getVoices().length'));
await key('KeyV', 'V', { altKey: true, shiftKey: true }); await sleep(500);
await shot('text-to-speech', '#settingsDlg', 0);

// Settings, at General
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
await js(`document.getElementById('settab-general').click(); document.activeElement?.blur(); 1`); await sleep(400);
await shot('settings');

// sounds like: a word selected in block 3, then Alt+Shift+P
await js(`document.querySelectorAll('dialog[open]').forEach((d) => d.close()); 1`); await sleep(300);
await js(`(async () => {
  document.querySelectorAll('#list .row')[2].click();
  await new Promise((r) => setTimeout(r, 300));
  const t = document.getElementById('edText'), w = 'diagonally', i = t.value.indexOf(w);
  t.focus(); t.setSelectionRange(i, i + w.length);
  t.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'P', altKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 300));
  const say = document.activeElement; say.value = 'dye-AG-nuh-lee'; say.dispatchEvent(new Event('input'));
  return document.getElementById('sayDlg').open;
})()`);
await sleep(400);
await shot('sounds-like', '#sayDlg', 0);

// AI help: a draft for block 2, from a stand-in for Ollama so no AI is needed
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
await js(`document.querySelectorAll('dialog[open]').forEach((d) => d.close()); 1`); await sleep(300);
await js(`(async () => {
  const f = window.fetch;
  window.fetch = (u, o) => {
    u = String(u);
    if (u.endsWith('/api/tags')) return Promise.resolve(new Response(JSON.stringify({ models: [{ name: 'gemma3:12b' }] })));
    if (u.endsWith('/api/chat')) {
      const words = 'Violet ribbons ripple and fold together, then drift apart.'.split(/(?<= )/);
      const body = new ReadableStream({ async start(c) {
        for (const w of words) { c.enqueue(new TextEncoder().encode(JSON.stringify({ message: { content: w } }) + '\\n')); await new Promise((r) => setTimeout(r, 20)); }
        c.enqueue(new TextEncoder().encode(JSON.stringify({ message: { content: '' }, done: true }) + '\\n')); c.close();
      } });
      return Promise.resolve(new Response(body));
    }
    return f(u, o);
  };
  document.querySelectorAll('#list .row')[1].click();
  await new Promise((r) => setTimeout(r, 300));
  // Connected first, in Settings, as it would be by the time anyone drafts.
  const p = document.getElementById('aiProvider'); p.value = 'ollama'; p.dispatchEvent(new Event('change'));
  document.getElementById('aiConnect').click();
  await new Promise((r) => setTimeout(r, 600));
  document.getElementById('aiLog').textContent = '';
  document.getElementById('aiBtn').click();
  await new Promise((r) => setTimeout(r, 300));
  document.getElementById('aiDraft').click();
  for (let i = 0; i < 40 && !document.querySelector('#aiLog .draft .acts'); i++) await new Promise((r) => setTimeout(r, 150));
  document.activeElement?.blur();
  document.getElementById('toast').classList.add('fade');
  return !!document.querySelector('#aiLog .draft .acts');
})()`);
await sleep(700);
await shot('ai-help');
await js(`document.getElementById('aiClose').click(); 1`); await sleep(300);

// the Did you know? box, which only shows without Piper: hide Piper from this page.
// (A made-up Esc key doesn't close a dialog, so close them directly.)
const closeDialogs = () => js(`document.querySelectorAll('dialog[open]').forEach((d) => d.close()); 1`);
await closeDialogs(); await sleep(300);
await js(`(() => { const f = window.fetch; window.fetch = (u, o) => String(u).includes('tts/') ? Promise.resolve(new Response('', { status: 502 })) : f(u, o); return 1; })()`);
await key('KeyV', 'V', { altKey: true, shiftKey: true }); await sleep(800);
await js(`document.getElementById('ttsTip').scrollIntoView({ block: 'center' }); 1`); await sleep(300);
await shot('piper-tip', '#ttsTip');

// the question when a script is opened in Write mode
await closeDialogs(); await sleep(300);
await js(`(async () => {
  window.confirm = () => true;
  const srt = '1\\n00:00:03,000 --> 00:00:06,200\\nBands of teal and violet light drift across a dark sky.\\n\\n2\\n00:00:11,500 --> 00:00:14,000\\nThe colours slowly fold into one another.\\n';
  const dt = new DataTransfer(); dt.items.add(new File([srt], 'lights-ad.srt', { type: 'text/plain' }));
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 800));
  return document.getElementById('importDlg').open;
})()`);
await sleep(300);
await shot('import-timings', '#importDlg', 0);
ws.close();
