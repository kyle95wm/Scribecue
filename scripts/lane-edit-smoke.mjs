// Editing the dialogue lane in headless, muted Chrome, at a CPU slowdown: takes lines out,
// trims them by dragging and with keys, undoes, reloads, and puts the lines back.
// The video should be about a minute long; the subtitles should have lines at 2–4, 5–8,
// 10–13, 13.5–16, 20–23 and 30–33 s, the 10–16 s ones being song lyrics nobody marked.
// Also corrects a line's words, with a double-click and with Enter.
// Usage: node scripts/lane-edit-smoke.mjs <devtools port> <site url> <video file> <subtitle file> [screenshot.png] [slowdown]
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const [,, port, site, videoFile, subFile, shot, slowdown = '6'] = process.argv;
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expression) => {
  const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (m.result?.exceptionDetails) throw Error(JSON.stringify(m.result.exceptionDetails).slice(0, 400));
  return m.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (expression, tries = 400) => { for (let i = 0; i < tries; i++) { if (await js(expression)) return; await sleep(250); } throw Error('Timed out: ' + expression); };
// key: the KeyboardEvent key, code, Windows key code; mods: 1 Alt, 2 Ctrl, 4 Meta, 8 Shift.
const key = async (k, code, vk, mods = 0) => {
  const p = { key: k, code, windowsVirtualKeyCode: vk, modifiers: mods };
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...p }); await send('Input.dispatchKeyEvent', { type: 'keyUp', ...p });
  await sleep(400);
};
const letter = (c, mods = 0) => key(c, `Key${c.toUpperCase()}`, c.toUpperCase().charCodeAt(0), mods);
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
const shoot = async (name) => { if (!shot) return; const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(shot.replace(/\.png$/, `-${name}.png`), Buffer.from(s.result.data, 'base64')); };
const setFile = async (selector, file) => {
  const { result: { root } } = await send('DOM.getDocument');
  const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
  await send('DOM.setFileInputFiles', { nodeId, files: [file] });
};
const toast = () => js(`document.getElementById('toast').textContent`);
const seekTo = async (t) => { await js(`document.querySelector('video').currentTime=${t};true`); await sleep(400); };
const edits = () => js(`Object.values(JSON.parse(localStorage.getItem('scribecue.v1')||'{}').laneEdits||{})[0]||{}`);
const mod = (await js(`/Mac/.test(navigator.platform)`)) ? 4 : 2;
let lane; // where the lane is, and its scale once fitted
const xOf = (t) => lane.left + t * lane.pps;
const yMid = () => lane.top + lane.height / 2;
const click = async (t) => { await mouse('mousePressed', xOf(t), yMid()); await mouse('mouseReleased', xOf(t), yMid()); await sleep(400); };

async function openBoth() {
  await setFile('#fileVideo', videoFile);
  await wait(`!document.getElementById('dialPick').hidden && document.querySelector('video').duration > 0`);
  if (await js(`document.getElementById('dialSel').value!=='file'`)) {
    await js(`window.showOpenFilePicker=undefined;document.getElementById('fileDialogue').click=()=>{};(()=>{const s=document.getElementById('dialSel');s.value='load';s.dispatchEvent(new Event('change'))})();true`);
    await sleep(300);
    await setFile('#fileDialogue', subFile);
    await wait(`document.getElementById('dialSel').value==='file'`);
  }
  await js(`document.querySelector('#tlZoom [data-zoom=fit]').click();true`); await sleep(600);
  lane = await js(`(()=>{const r=document.getElementById('dialTrack').getBoundingClientRect(),w=document.getElementById('tl').getBoundingClientRect().width;return {left:r.left,top:r.top,height:r.height,pps:w/document.querySelector('video').duration}})()`);
}

try {
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true });
  await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: site }); await sleep(800);
  await js(`localStorage.clear();for(const [k,v] of Object.entries({welcome:'1',seenVersion:'999.0.0',updates:'0',mode:'write',setupModes:'{"write":true,"transcribe":true,"record":true}'}))localStorage.setItem('scribecue.'+k,v);indexedDB.deleteDatabase('scribecue-dialogue');indexedDB.deleteDatabase('scribecue-waves');true`);
  await send('Page.reload'); await sleep(2000);
  await send('Emulation.setCPUThrottlingRate', { rate: +slowdown });
  await js(`window.__errors=[];addEventListener('error',e=>__errors.push(e.message));addEventListener('unhandledrejection',e=>__errors.push(String(e.reason)));true`);
  await openBoth();

  // Before: the gap after "By the river" ends where the lyrics start.
  await seekTo(7.9); await letter('d');
  assert.equal(await toast(), 'Gap of 2.0 s', 'gap before the lyrics');

  // A click on a line selects it and moves the playhead there.
  await click(11);
  assert.ok(Math.abs(await js(`document.querySelector('video').currentTime`) - 11) < 0.2, 'the click seeks');
  await shoot('selected');
  // Delete takes it out and selects the next, so the second goes with another Delete.
  await key('Delete', 'Delete', 46);
  assert.match(await toast(), /^Dialogue line removed/);
  await key('Delete', 'Delete', 46);
  assert.equal(Object.values(await edits()).filter((e) => e.cut).length, 2, 'both lyrics lines taken out');
  await seekTo(7.9); await letter('d');
  assert.equal(await toast(), 'Gap of 12.0 s', 'the gap opens up to the next line');
  await shoot('removed');

  // Undo brings the second back; redo takes it out again.
  await letter('z', mod);
  await seekTo(7.9); await letter('d');
  assert.equal(await toast(), 'Gap of 5.5 s', 'undo puts the second line back');
  await letter('z', mod | 8);
  await seekTo(7.9); await letter('d');
  assert.equal(await toast(), 'Gap of 12.0 s', 'redo takes it out again');

  // Dragging the start of the first line (2–4 s) to 2.5 s, measuring the page meanwhile.
  await js(`window.__long=[];new PerformanceObserver(l=>__long.push(...l.getEntries().map(e=>e.duration))).observe({type:'longtask'});true`);
  await mouse('mousePressed', xOf(2) + 1, yMid());
  for (let i = 1; i <= 20; i++) { await mouse('mouseMoved', xOf(2) + 1 + (xOf(2.5) - xOf(2)) * i / 20, yMid()); await sleep(16); }
  await mouse('mouseReleased', xOf(2.5) + 1, yMid()); await sleep(600);
  const long = await js(`__long`);
  console.log(`dragging a line's start: ${long.length} long tasks, longest ${Math.round(Math.max(0, ...long))} ms`);
  const first = Object.entries(await edits()).find(([k]) => k.startsWith('2000|'))?.[1];
  assert.ok(first && Math.abs(first.start - 2.5) < 0.1 && first.end === 4, `dragged start (${JSON.stringify(first)})`);

  // Keys on the second line (5–8 s): S sets its end to the playhead, Q takes 100 ms off its start.
  await click(6); await seekTo(7.2); await letter('s'); await letter('q');
  const second = Object.entries(await edits()).find(([k]) => k.startsWith('5000|'))?.[1];
  assert.ok(second && Math.abs(second.end - 7.2) < 0.05 && Math.abs(second.start - 4.9) < 1e-6, `keys retime the line (${JSON.stringify(second)})`);
  await shoot('trimmed');

  // Esc lets go: S is for blocks again.
  await key('Escape', 'Escape', 27);
  await letter('s');
  assert.match(await toast(), /^No text block selected/, 'S goes back to blocks');

  // Correcting words: a double-click opens a field over the line; Enter keeps the words.
  const fifth = async () => Object.entries(await edits()).find(([k]) => k.startsWith('20000|'))?.[1];
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: xOf(21), y: yMid(), button: 'left', buttons: 1, clickCount: 2 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: xOf(21), y: yMid(), button: 'left', buttons: 0, clickCount: 2 });
  await sleep(400);
  assert.equal(await js(`!document.getElementById('dialEdit').hidden && document.activeElement.id`), 'dialEdit', 'a double-click opens the field');
  assert.equal(await js(`document.getElementById('dialEdit').value`), 'You should have called.');
  await shoot('words');
  await send('Input.insertText', { text: 'You should’ve called me.' });
  await key('Enter', 'Enter', 13);
  assert.equal((await fifth())?.text, 'You should’ve called me.', 'Enter keeps the words');
  assert.equal(await js(`document.getElementById('dialEdit').hidden`), true);
  // Enter on the selected line opens it again; Esc leaves the words as they were.
  await key('Enter', 'Enter', 13);
  assert.equal(await js(`document.activeElement.id`), 'dialEdit', 'Enter opens the field');
  await send('Input.insertText', { text: 'Not this.' });
  await key('Escape', 'Escape', 27);
  assert.equal((await fifth())?.text, 'You should’ve called me.', 'Esc keeps the old words');
  // A trim after a correction keeps the words.
  await letter('w');
  const after = await fifth();
  assert.ok(after.text === 'You should’ve called me.' && Math.abs(after.start - 20.1) < 1e-6, `trim keeps the words (${JSON.stringify(after)})`);
  await key('Escape', 'Escape', 27);

  // Kept in the project: after a reload, the lane comes back with its edits.
  await sleep(800);
  await send('Page.reload'); await sleep(2500);
  await js(`window.__errors=[];addEventListener('error',e=>__errors.push(e.message));true`);
  await openBoth();
  await seekTo(7); await letter('d');
  assert.equal(await toast(), 'Gap of 12.9 s', 'edits come back after a reload');

  // Put back the original lines.
  assert.match(await js(`document.querySelector('#dialSel option[value=original]')?.textContent||''`), /^Put back the original lines \(5 changed\)$/);
  await js(`(()=>{const s=document.getElementById('dialSel');s.value='original';s.dispatchEvent(new Event('change'))})();true`); await sleep(400);
  assert.match(await toast(), /^5 dialogue lines put back/);
  await seekTo(7); await letter('d');
  assert.equal(await toast(), 'Gap of 2.0 s', 'the lyrics are back');
  assert.equal(await js(`!!document.querySelector('#dialSel option[value=original]')`), false, 'nothing left to put back');

  assert.deepEqual(await js(`window.__errors||[]`), []);
  console.log('lane edit smoke passed');
} finally { ws.close(); }
