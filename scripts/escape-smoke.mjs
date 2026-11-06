// Esc checks in headless, muted Chrome at 6× CPU slowdown: from a field, slider, menu,
// dialog, drawer, overlay or the palette, Esc leaves the keys on the timeline.
// Usage: node scripts/escape-smoke.mjs <devtools port> <site url>
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
  if (m.result?.exceptionDetails) throw Error(JSON.stringify(m.result.exceptionDetails));
  return m.result.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = async (k, code, vk, text) => {
  const p = { key: k, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) };
  await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...p });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...p });
  await sleep(250);
};
const esc = () => key('Escape', 'Escape', 27);
const at = () => js(`document.activeElement === document.body || !document.activeElement`);
const name = () => js(`document.activeElement?.id || document.activeElement?.tagName`);
const expectTimeline = async (where) => { await sleep(100); assert.equal(await at(), true, `${where}: focus is on ${await name()}`); };
const focus = (el) => js(`document.getElementById('${el}').focus(); document.activeElement.id`);

await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Network.enable'); await send('Network.setBypassServiceWorker', { bypass: true });
await send('Emulation.setCPUThrottlingRate', { rate: 6 });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: site }); await sleep(800);
await js(`localStorage.clear();for(const [k,v] of Object.entries({welcome:'1',seenVersion:'999.0.0',updates:'0',mode:'write',setupModes:'{"write":true,"transcribe":true,"qc":true,"record":true}'}))localStorage.setItem('scribecue.'+k,v);localStorage.setItem('scribecue.v1',JSON.stringify({cues:[{start:4,end:7,text:'He walks towards the door.'},{start:9,end:11,text:'She waits.'}],dirty:false}));true`);
await send('Page.reload', { ignoreCache: true }); await sleep(5000);
await js(`window.__errors=[];addEventListener('error',e=>__errors.push(e.message));true`);

// Sliders, menus and boxes under the video.
for (const el of ['mix', 'trackSel', 'dialSel']) {
  await js(`document.getElementById('${el}').disabled=false;document.getElementById('${el}').closest('[hidden]')?.removeAttribute('hidden');true`);
  assert.equal(await focus(el), el, `${el} takes focus`);
  await esc(); await expectTimeline(el);
}

// A field of the open block closes the block; a select in it does too.
await js(`document.querySelector('#list .row').click();true`); await sleep(500);
assert.equal(await js(`!document.getElementById('editor').hidden`), true, 'the block opens');
await focus('edText'); await esc(); await expectTimeline('block text');
await key('Enter', 'Enter', 13, '\r'); await sleep(400);
await js(`document.getElementById('edSpeed').closest('[hidden]')?.removeAttribute('hidden');document.getElementById('edTts').hidden=false;true`);
await focus('edSpeed'); await esc(); await expectTimeline('block speed menu');

// Search, palette, overlay.
await key('/', 'Slash', 191, '/'); assert.equal(await name(), 'listSearch'); await esc(); await expectTimeline('search');
await js(`document.querySelector('[aria-haspopup]').focus();true`);
await js(`document.querySelector('[aria-haspopup]').click();true`); await sleep(300);
assert.equal(await js(`!!document.activeElement.closest('.navmenu')`), true, 'the menu takes focus');
await esc(); await expectTimeline('menu');
assert.equal(await js(`[...document.querySelectorAll('.navmenu')].every(m=>m.hidden)`), true, 'the menu closes');

// A dialog opened from a button comes back to the timeline, not to the button.
await js(`const b=document.querySelector('[aria-haspopup]');b.focus();document.getElementById('diagDlg').showModal();true`); await sleep(300);
await esc(); await sleep(300);
assert.equal(await js(`document.getElementById('diagDlg').open`), false, 'the dialog closes');
await expectTimeline('dialog');

// A dialog opened while typing in a block goes back to the typing.
await key('Enter', 'Enter', 13, '\r'); await sleep(400); await focus('edText');
await js(`document.getElementById('diagDlg').showModal();true`); await sleep(300);
await esc(); await sleep(300);
assert.equal(await name(), 'edText', 'typing carries on in the block');
await esc(); await expectTimeline('block after dialog');

// One dialog over another: Esc steps back one at a time.
await js(`document.getElementById('diagDlg').showModal();document.getElementById('whatsNew').showModal();document.getElementById('wnClose').focus();true`); await sleep(300);
await esc(); await sleep(300);
assert.equal(await js(`document.getElementById('diagDlg').open`), true, 'the dialog underneath stays');
assert.equal(await at(), false, 'focus stays in the dialog underneath');
await esc(); await sleep(300); await expectTimeline('second dialog');

// The Comments drawer.
await js(`document.getElementById('commentsBtn').click();true`); await sleep(400);
await focus('commentText'); await esc();
assert.equal(await js(`document.getElementById('commentsDrawer').hidden`), true, 'the drawer closes');
await expectTimeline('Comments');

// The keys work straight after: Space plays nothing here, but ? opens the overlay.
await key('?', 'Slash', 191, '?');
assert.equal(await js(`!document.getElementById('help').hidden`), true, 'keys work on the timeline');
await js(`document.querySelector('[aria-haspopup]').focus();true`);
await esc(); await expectTimeline('shortcuts overlay');

assert.deepEqual(await js(`__errors`), []);
console.log('Escape smoke passed at 6× slowdown');
ws.close();
