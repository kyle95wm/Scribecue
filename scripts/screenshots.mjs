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
await js(`localStorage.clear(); localStorage.setItem('scribecue.updates', '0'); localStorage.setItem('scribecue.welcome', '1'); localStorage.setItem('scribecue.setupModes', JSON.stringify({ write: true, transcribe: true, qc: true, record: true })); localStorage.setItem('scribecue.loops', JSON.stringify({ write: true, transcribe: true })); localStorage.setItem('scribecue.seenVersion', '999.0.0'); localStorage.setItem('scribecue.tts', JSON.stringify({ on: true, favourites: ['piper:en_US-lessac-medium', 'piper:en_GB-alba-medium'] })); localStorage.setItem('scribecue.mode', 'write'); localStorage.setItem('scribecue.v1', JSON.stringify({subName:'lights-ad.scribecue', dirty:false, cues:${JSON.stringify(cues)}})); location.reload(); 1`);
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

// QC comments beside the same editor and timeline.
await js(`document.querySelector('#modeSw [data-mode=qc]').click(); 1`); await sleep(300);
await js(`document.getElementById('edComment').click(); document.getElementById('commentAuthor').value = 'Sam'; document.getElementById('commentText').value = 'Could we describe the direction of the light here?'; document.getElementById('commentPost').click(); document.getElementById('commentsClose').click(); document.getElementById('commentsBtn').click(); document.getElementById('commentAt').value = '00:00:26:00'; document.getElementById('commentText').value = 'Check the pause before the next reading.'; document.getElementById('commentPost').click(); document.getElementById('toast').classList.add('fade'); document.activeElement?.blur(); 1`);
await sleep(400); await shot('comments');
await js(`document.querySelector('[data-act=newProject]').click(); 1`); await sleep(200);
await shot('qc-new-project', '#newDlg', 0);
await js(`document.getElementById('newCancel').click(); 1`);
// This package's creator permits edits; reviewers have no permission switch.
await js(`(async()=>{
 const q=await import('./js/qc.js'),t=await import('./js/tts.js'),p=await import('./js/project.js');
 const saved=JSON.parse(localStorage.getItem('scribecue.v1'));
 const project=p.toProject({blocks:saved.cues,comments:saved.comments,settings:{mode:'qc',ttsVoice:t.tts.voice||t.chosenVoice(),ttsBase:t.tts.base,ttsSkipNotes:t.tts.skipNotes}});
 const file=await q.buildReview(project,b=>t.reviewAudio(t.soundsLike(b.text,b.say),b.speed||1,b.voice||project.settings.ttsVoice),{allowEdits:true});
 window.__writer=project;window.confirm=()=>true;const d=new DataTransfer();d.items.add(new File([file],'lights-qc.scribecueqc'));window.dispatchEvent(new DragEvent('drop',{dataTransfer:d,bubbles:true,cancelable:true}));
 for(let i=0;i<100&&!document.body.classList.contains('qc-editing');i++)await new Promise(r=>setTimeout(r,50));
 document.querySelectorAll('#list .row')[1].click();if(document.getElementById('commentsDrawer').hidden)document.getElementById('commentsBtn').click();document.getElementById('toast').classList.add('fade');return 1;
})()`); await sleep(300); await shot('qc-editing');
await js(`document.getElementById('commentsClose').click(); document.querySelector('#ind [data-key=qc]').click(); 1`); await sleep(300);
await shot('qc-playback', '#qcPlaybackDlg', 0);
// QC packages are made from the writer's project, not from a package: open it as one.
await js(`(async () => { document.getElementById('qcPlaybackClose').click();
 const d = new DataTransfer(); d.items.add(new File([JSON.stringify(__writer)], 'lights.scribecue')); window.dispatchEvent(new DragEvent('drop', { dataTransfer: d, bubbles: true, cancelable: true }));
 for (let i = 0; i < 100 && !document.getElementById('subName').textContent.startsWith('lights.scribecue'); i++) await new Promise((r) => setTimeout(r, 50));
 document.querySelectorAll('dialog[open]').forEach((d) => d.close());
 document.querySelector('#modeSw [data-mode=write]').click(); document.querySelector('[data-act=exportQc]').click(); return 1; })()`); await sleep(300);
await shot('qc-package', '#qcExportDlg', 0);
await js(`document.getElementById('qcExportClose').click(); 1`); await sleep(300);

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

// Record mode: the same script as a recording file, with takes made up from shaped noise,
// so no real voice is involved. Block 2's take runs past its slot; block 3's is split.
await closeDialogs(); await sleep(300);
await js(`(async () => {
  window.confirm = () => true;
  window.showDirectoryPicker = undefined; // takes stay in the browser, without the folder dialog
  const R = await import('./js/recording.js'), B = await import('./js/bwf.js'), T = await import('./js/takestore.js');
  const file = R.toRecordingFile({ blocks: ${JSON.stringify(cues)}, fps: 25 });
  const rec = R.recordingId(R.fromRecordingFile(JSON.parse(JSON.stringify(file))));
  let seed = 7;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const voice = (secs, level) => {
    const n = Math.round(secs * 48000), pcm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / 48000, words = Math.max(0, Math.sin(2 * Math.PI * 4.3 * t) * Math.sin(2 * Math.PI * 1.1 * t + 1));
      const edge = Math.min(1, Math.max(0, (t - 0.25) * 8), Math.max(0, (secs - 0.3 - t) * 8));
      pcm[i] = noise() * level * (0.04 + words) * edge;
    }
    return pcm;
  };
  const takes = [
    { block: 0, start: 3.05, secs: 3.4, level: 0.32 },
    { block: 0, start: 3.1, secs: 3.1, level: 0.3 },
    { block: 1, start: 11.6, secs: 4.1, level: 0.3 },
    { block: 2, start: 20.0, secs: 3.9, level: 0.1 },
    { block: 2, start: 20.1, secs: 3.9, level: 0.31, edit: { splits: [2.1], parts: [{ shift: 0, head: 0.1, tail: 0 }, { shift: -0.3, head: 0.35, tail: 0 }] } },
    { block: 3, start: 30.3, secs: 2.1, level: 0.29 },
  ];
  let made = 1;
  for (const t of takes) {
    const pcm = voice(t.secs, t.level);
    await T.saveTake({ id: crypto.randomUUID(), rec, block: t.block, start: t.start, duration: pcm.length / 48000, peak: R.peakDb(pcm), made: made++, wav: B.wav24(B.to24(pcm), 48000), ...(t.edit && { edit: t.edit }) }, true);
  }
  const dt = new DataTransfer(); dt.items.add(new File([JSON.stringify(file)], 'lights.scribecue-rec'));
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  for (let i = 0; i < 60 && !document.body.classList.contains('mode-record'); i++) await new Promise((r) => setTimeout(r, 100));
  return 1;
})()`);
await sleep(1200);
await key('Digit0', '0', { altKey: true }); await sleep(200);
await key('Equal', '=', { altKey: true }); await sleep(200);
await js(`document.querySelectorAll('#list .row')[2].click(); 1`); await sleep(300);
await seek(21.2); await sleep(800);
await js(`document.activeElement?.blur(); document.getElementById('toast').classList.add('fade'); 1`); await sleep(500);
await shot('recording');
// The take menu, on block 2's take, with room beside it.
const at = await js(`(() => { const c = document.querySelector('.cue[data-id="' + document.querySelectorAll('#list .row')[1].dataset.id + '"]').getBoundingClientRect(), t = document.getElementById('takeTrack').getBoundingClientRect(); return [c.left + c.width * 1.6, t.top + t.height / 2]; })()`);
for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: at[0], y: at[1], button: 'right', buttons: type === 'mousePressed' ? 2 : 0, clickCount: 1 });
await sleep(400);
await js(`document.activeElement?.blur(); 1`); await sleep(200);
const area = await js(`(() => { const a = document.getElementById('tl').getBoundingClientRect(), m = document.getElementById('clipMenu').getBoundingClientRect(); const top = Math.min(a.top, m.top - 4), left = Math.max(0, m.left - 560); return [left, top, m.right + 16 - left, a.bottom - top]; })()`);
fs.writeFileSync(`${outDir}/recording-menu.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip: { x: area[0], y: area[1], width: area[2], height: area[3], scale: 1 } })).result.data, 'base64'));
console.log('saved recording-menu');
await js(`document.getElementById('clipMenu').hidden = true; 1`);
// The notes for the mixer, before exporting.
await js(`document.querySelector('[data-act=exportNarration]').click(); 1`); await sleep(800);
await shot('recording-export', '#recExportDlg', 0);
await closeDialogs();

// Pickups. The producer has sent version 1, then rewords block 2 and marks block 4.
const v1 = cues.map(({ start, end, text }) => ({ start, end, text }));
const v2 = cues.map((c, i) => (i === 1 ? { ...c, text: 'The colours fold slowly into each other.' } : i === 3 ? { ...c, pickup: { note: 'Softer: the scene is winding down' } } : c));
const producer = JSON.stringify({ subName: 'lights-ad.scribecue', dirty: false, cues: v2, recording: { id: 'lights0demo00001', version: 1, sent: v1 } });
const asProducer = async (state) => {
  await js(`localStorage.setItem('scribecue.v1', ${JSON.stringify(state)}); localStorage.removeItem('scribecue.recOpen'); localStorage.setItem('scribecue.mode', 'write'); location.reload(); 1`);
  await sleep(1800);
};
await asProducer(producer);
await js(`document.querySelectorAll('#list .row')[3].click(); 1`); await sleep(400);
await js(`document.activeElement?.blur(); document.getElementById('toast').classList.add('fade'); 1`); await sleep(300);
await shot('pickup-mark', '#editor', 12);

// The narrator opens version 2: takes from version 1, and the two pickups recorded since.
await js(`(async () => {
  window.confirm = () => true;
  window.showDirectoryPicker = undefined; // takes stay in the browser, without the folder dialog
  const R = await import('./js/recording.js'), B = await import('./js/bwf.js'), T = await import('./js/takestore.js');
  const file = R.toRecordingFile({ blocks: ${JSON.stringify(v2)}, fps: 25, project: 'lights0demo00001', version: 2, sent: ${JSON.stringify(v1)} });
  const rec = R.takesKey(R.fromRecordingFile(JSON.parse(JSON.stringify(file))));
  let seed = 11;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const voice = (secs, level) => {
    const n = Math.round(secs * 48000), pcm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / 48000, words = Math.max(0, Math.sin(2 * Math.PI * 4.1 * t) * Math.sin(2 * Math.PI * 1.3 * t + 1));
      const edge = Math.min(1, Math.max(0, (t - 0.25) * 8), Math.max(0, (secs - 0.3 - t) * 8));
      pcm[i] = noise() * level * (0.04 + words) * edge;
    }
    return pcm;
  };
  const v1 = ${JSON.stringify(v1)}, v2 = ${JSON.stringify(v2.map(({ start, end, text }) => ({ start, end, text })))};
  const takes = [
    ...v1.map((b, i) => ({ block: i, line: b, ver: 1, start: b.start + 0.1, secs: Math.min(b.end - b.start - 0.2, 3.6), chosen: i !== 1 && i !== 3 })),
    { block: 1, line: v2[1], ver: 2, start: v2[1].start + 0.05, secs: 2.3, chosen: true },
    { block: 3, line: v2[3], ver: 2, start: v2[3].start + 0.1, secs: 2.1, chosen: true },
  ];
  let made = 1;
  for (const t of takes) {
    const pcm = voice(t.secs, 0.3);
    await T.saveTake({ id: crypto.randomUUID(), rec, block: t.block, start: t.start, duration: pcm.length / 48000, peak: R.peakDb(pcm), made: made++, wav: B.wav24(B.to24(pcm), 48000), line: t.line, ver: t.ver }, t.chosen);
  }
  window.__got = {};
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download?.endsWith('.wav')) window.__got[this.download] = this.href; else click.call(this); };
  const dt = new DataTransfer(); dt.items.add(new File([JSON.stringify(file)], 'lights-v2.scribecuerec'));
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  for (let i = 0; i < 60 && !document.body.classList.contains('mode-record'); i++) await new Promise((r) => setTimeout(r, 100));
  return 1;
})()`);
await sleep(1500);
await js(`(async()=>{const b=await fetch('/demo.mkv').then(r=>r.blob()); const dt=new DataTransfer(); dt.items.add(new File([b],'lights.mkv',{type:'video/x-matroska'})); window.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true})); return 1})()`);
for (let i = 0; i < 40 && !(await js(`document.getElementById('video').readyState >= 2`)); i++) await sleep(500);
await sleep(1500);
await key('Digit0', '0', { altKey: true }); await sleep(200);
await key('Equal', '=', { altKey: true }); await sleep(200);
await js(`document.querySelectorAll('#list .row')[1].click(); 1`); await sleep(300);
await seek(12.4); await sleep(800);
await js(`document.activeElement?.blur(); document.getElementById('toast').classList.add('fade'); 1`); await sleep(500);
await shot('recording-pickups');

// The pickups WAV, checked by the producer: first against the script as sent, then after
// block 5 has changed since.
await js(`document.querySelector('[data-act=exportPickups]').click(); 1`);
for (let i = 0; i < 40 && !(await js(`Object.keys(window.__got || {}).length`)); i++) await sleep(250);
const wav = await js(`(async () => { const b = await fetch(Object.values(__got)[0]).then((r) => r.blob()); await (await caches.open('shots')).put('/pickups.wav', new Response(b)); return b.size })()`);
console.log('pickups WAV', wav, 'bytes');
const check = async (state, name) => {
  await asProducer(state);
  await js(`(async () => { const b = await (await (await caches.open('shots')).match('/pickups.wav')).blob(); const dt = new DataTransfer(); dt.items.add(new File([b], 'lights-ad-pickups-v2.wav', { type: 'audio/wav' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); return 1 })()`);
  for (let i = 0; i < 40 && !(await js(`document.getElementById('narrDlg').open`)); i++) await sleep(250);
  await sleep(300);
  await shot(name, '#narrDlg', 0);
};
await check(JSON.stringify({ ...JSON.parse(producer), recording: { id: 'lights0demo00001', version: 2, sent: v2.map(({ start, end, text }) => ({ start, end, text })) } }), 'check-pickups');
await check(JSON.stringify({ ...JSON.parse(producer), cues: v2.map((c, i) => (i === 4 ? { ...c, text: 'Green light spreads in from the left.', end: 42.4 } : c)) }), 'check-mismatch');
await js(`caches.delete('shots')`);
await closeDialogs();
ws.close();

// QC returned-review comparison also checks save failures and original audio.
const { spawnSync } = await import('node:child_process');
const reviewRun = spawnSync(process.execPath, [new URL('./qc-review-smoke.mjs', import.meta.url).pathname,
  port, site, `${outDir}/qc-compare.png`], { stdio: 'inherit' });
if (reviewRun.status !== 0) throw new Error('QC comparison screenshot checks failed');

const authorRun = spawnSync(process.execPath, [new URL('./author-review-smoke.mjs', import.meta.url).pathname,
  port, site, `${outDir}/qc-accept.png`], { stdio: 'inherit' });
if (authorRun.status !== 0) throw new Error('Author review acceptance screenshot checks failed');

const speechRun = spawnSync(process.execPath, [new URL('./qcspeech-smoke.mjs', import.meta.url).pathname,
  port, site, `${outDir}/qc-google-rewrite.png`], { stdio: 'inherit' });
if (speechRun.status !== 0) throw new Error('Google QC review screenshot checks failed');
