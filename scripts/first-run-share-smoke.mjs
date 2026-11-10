// A share link that starts someone's first visit: the tour and setup come first, then the
// link's password window opens by itself, before the mode's loop card. The link is made up,
// so no password is sent. Run it in a fresh, headless, muted Chrome profile; it slows the CPU
// 6×. Pass "skip" to skip setup, which asks about updates first (not on the web version).
// Usage: node scripts/first-run-share-smoke.mjs <DevTools port> <site url> [skip]
import assert from 'node:assert/strict';
const [,, port, site, skip] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, userGesture: true })).result.result.value;
const wait = async (e, what) => { for (let i = 0; i < 120; i++) { if (await js(e)) return; await sleep(250); } throw Error('Timed out: ' + what); };
const open = (dlg) => js(`!!document.getElementById(${JSON.stringify(dlg)})?.open`);
const tourUp = () => js(`!document.getElementById('tour').hidden`);
try {
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await send('Page.navigate', { url: `${site}#share=${'A'.repeat(22)}.${'B'.repeat(12)}.${'C'.repeat(22)}` });
  await wait(`!document.getElementById('tour').hidden`, 'the tour');
  await sleep(1500);
  assert.equal(await open('joinDlg'), false, 'the password window waits for the tour');
  await js(`document.getElementById('tourSkip').click()`);
  await wait(`document.getElementById('welcome').open`, 'setup');
  assert.equal(await open('joinDlg'), false, 'the password window waits for setup');
  if (skip === 'skip') await js(`document.getElementById('wzSkip').click()`);
  else for (let i = 0; i < 20 && await open('welcome'); i++) { await js(`document.getElementById('wzNext').click()`); await sleep(200); }
  const t0 = Date.now();
  // Skipped setup asks about updates first, outside the web version.
  await wait(`document.getElementById('updates')?.open ? (document.getElementById('updNo').click(), false) : document.getElementById('joinDlg').open`, 'the password window after setup');
  console.log(`Password window open ${Date.now() - t0} ms after setup`);
  assert.equal(await tourUp(), false, 'the loop card waits for the password window');
  await js(`document.getElementById('joinCancel').click()`);
  await wait(`!document.getElementById('tour').hidden`, 'the loop card');
  console.log('First-run share link: passed');
} finally { ws.close(); }
