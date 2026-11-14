// Floating video: double-click the video to take it out of its place beside the list, into
// a window you can move and resize, as in Logic. Closing that window, or double-clicking the
// video or the spot it left, puts it back.
//
// It floats in one of two ways, a setting:
//   panel   a window inside this tab. Works in every browser.
//   window  a window of its own (Document Picture-in-Picture), which can go on another
//           screen. Chrome and Edge only; elsewhere it floats as a panel.
//
// The text over the video covers the picture, docked or floating, and style.css sizes it
// against the picture, so it looks the same in any size of player. The keys pressed in a window of its own are passed
// to the app, so every shortcut still works.

export const KIND_KEY = 'scribecue.floatVideo';
export const RECT_KEY = 'scribecue.floatRect';
export const KINDS = ['panel', 'window'];
export const MIN_W = 240; // px: the narrowest picture a panel can be
export const BAR = 26; // px: the panel's title bar
const MARGIN = 16; // px kept from the window's edge for a new panel
const KEEP = 48; // px of a panel that always stays on the screen, to grab it back

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const readKind = (raw) => (KINDS.includes(raw) ? raw : 'panel');

// The picture inside a box, as object-fit: contain shows it. aspect is width / height.
export function fitPicture(boxW, boxH, aspect) {
  if (!(boxW > 0 && boxH > 0)) return { x: 0, y: 0, w: 0, h: 0 };
  if (!(aspect > 0)) return { x: 0, y: 0, w: boxW, h: boxH };
  const w = Math.min(boxW, boxH * aspect);
  const h = w / aspect;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

// A stored panel { x, y, w }, or null when it's missing or doesn't make sense.
export function readRect(raw) {
  let v = null;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!v || typeof v !== 'object') return null;
  const { x, y, w } = v;
  return [x, y, w].every(Number.isFinite) && w > 0 ? { x, y, w } : null;
}

// Where a new panel goes: the top right of the spot the video left (`spot`, a rect), a
// third of the window's width.
export function defaultRect(viewW, viewH, aspect, spot = { right: viewW, top: 0 }) {
  const a = aspect > 0 ? aspect : 16 / 9;
  const w = clamp(Math.round(viewW / 3), MIN_W, 640);
  return place({ x: spot.right - w - MARGIN, y: spot.top + MARGIN, w }, viewW, viewH, a);
}

// A panel kept to a sensible size, with enough of it on the screen to grab: its title bar
// can't go above the top, and at least KEEP px of it stay in view on the other sides.
export function place(r, viewW, viewH, aspect) {
  const a = aspect > 0 ? aspect : 16 / 9;
  // No wider than the window, nor taller than it with the title bar.
  const most = Math.max(MIN_W, Math.min(viewW, (viewH - BAR) * a));
  const w = clamp(r.w, MIN_W, most);
  const h = w / a + BAR;
  return {
    x: Math.round(clamp(r.x, KEEP - w, viewW - KEEP)),
    y: Math.round(clamp(r.y, 0, Math.max(0, viewH - Math.min(h, KEEP)))),
    w: Math.round(w),
  };
}

export const CORNERS = ['nw', 'ne', 'sw', 'se'];

// A panel resized by dragging one of its corners ('nw', 'ne', 'sw' or 'se') by dx, dy.
// The opposite corner stays put, and the picture keeps its shape, following whichever
// way the pointer went further.
export function resized(r, dx, dy, aspect, viewW, viewH, corner = 'se') {
  const a = aspect > 0 ? aspect : 16 / 9;
  const east = corner.includes('e'), south = corner.includes('s');
  const across = east ? dx : -dx, down = (south ? dy : -dy) * a;
  const w = r.w + (Math.abs(across) >= Math.abs(down) ? across : down);
  const right = r.x + r.w, bottom = r.y + r.w / a + BAR;
  const most = Math.max(MIN_W, Math.min(east ? viewW - r.x : right, ((south ? viewH - r.y : bottom) - BAR) * a));
  const nw = Math.round(clamp(w, MIN_W, most));
  return {
    x: east ? r.x : Math.round(right - nw),
    y: south ? r.y : Math.round(bottom - nw / a - BAR),
    w: nw,
  };
}

// Moving the picture by less than this many px is a click, not a drag.
export const DRAG_FROM = 4;
export const isDrag = (dx, dy) => Math.hypot(dx, dy) >= DRAG_FROM;

const get = (k) => { try { return globalThis.localStorage?.getItem(k) ?? null; } catch { return null; } };
const set = (k, v) => { try { globalThis.localStorage?.setItem(k, v); } catch { /* storage blocked */ } };

export const loadKind = () => readKind(get(KIND_KEY));
export const saveKind = (kind) => set(KIND_KEY, readKind(kind));
export const canOwnWindow = () => 'documentPictureInPicture' in globalThis && globalThis.isSecureContext !== false;

// Sets up floating for the video in `stage`. parts: what moves with the video (the
// overlay first). kind(): 'panel' or 'window'. canFloat(): whether there's a video to
// float. note(message): a toast. changed(floating): runs when it floats or docks.
// undoClick(): undoes what the video's first click did, when it turns out to be a double-click.
export function initFloat({ stage, video, parts, kind, canFloat = () => true, note = () => {}, changed = () => {}, undoClick = () => {} }) {
  const overlay = parts[0];
  const doc = document;

  // The spot the video leaves, which keeps its size so the text has something to scale by.
  const hold = doc.createElement('div');
  hold.className = 'floathold';
  hold.hidden = true;
  hold.innerHTML = '<p>The video is floating.</p><p class="dim small">Double-click here, or close its window, to put it back.</p>';
  const back = doc.createElement('button');
  back.type = 'button';
  back.textContent = 'Put it back';
  back.addEventListener('click', () => dock());
  hold.append(back);
  stage.append(hold);
  hold.addEventListener('dblclick', () => dock());

  // The panel: a title bar to drag, the picture, and a corner to resize by.
  const panel = doc.createElement('div');
  panel.className = 'floatwin';
  panel.id = 'floatWin';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Floating video');
  panel.hidden = true;
  const bar = doc.createElement('div');
  bar.className = 'floatbar';
  bar.dataset.tip = 'Drag here or the picture to move it, and a corner to resize it. Double-click the video to put it back';
  bar.innerHTML = '<span>Video</span>';
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'floatclose';
  close.setAttribute('aria-label', 'Put the video back');
  close.dataset.tip = 'Put the video back';
  close.textContent = '×';
  close.addEventListener('click', () => dock());
  bar.append(close);
  const box = doc.createElement('div');
  box.className = 'floatbox';
  const pic = doc.createElement('div');
  pic.className = 'floatpic';
  box.append(pic);
  const grips = CORNERS.map((corner) => {
    const g = doc.createElement('div');
    g.className = 'floatgrip';
    g.dataset.corner = corner;
    g.setAttribute('aria-hidden', 'true');
    return g;
  });
  panel.append(bar, box, ...grips);
  doc.body.append(panel);

  let floating = null; // 'panel' or 'window' while it floats
  let pip = null; // the window of its own
  let rect = readRect(get(RECT_KEY));
  const moving = [video, ...parts];
  const spots = moving.map((el) => [el, el.parentNode, el.nextSibling]);
  const aspect = () => (video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9);

  // Sizes the picture in its box, and puts the text over the picture. Floating, the
  // picture has a box of its own, which the text covers as it is.
  const cover = (el, r) => Object.assign(el.style, r ? { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` }
    : { left: '', top: '', width: '', height: '' });
  function layout() {
    if (!floating) return cover(overlay, fitPicture(stage.clientWidth, stage.clientHeight, aspect()));
    const host = floating === 'window' ? pip.document.body : box;
    cover(pic, fitPicture(host.clientWidth, host.clientHeight, aspect()));
    cover(overlay, null);
  }

  function showPanel() {
    const vw = innerWidth, vh = innerHeight;
    rect = place(rect || defaultRect(vw, vh, aspect(), stage.getBoundingClientRect()), vw, vh, aspect());
    Object.assign(panel.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.w / aspect() + BAR}px` });
    layout();
  }

  const saveRect = () => { if (rect) set(RECT_KEY, JSON.stringify(rect)); };

  // Dragging the title bar or the picture moves the panel; dragging a corner resizes it.
  // On the picture, a drag only starts once the pointer has moved a little, so a click
  // still plays or pauses and a double-click still puts the video back. The click that
  // ends a drag is kept from the video.
  let dragged = false;
  function dragging(el, move, { slack = false } = {}) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault();
      const from = { ...rect }, x0 = e.clientX, y0 = e.clientY;
      let on = false;
      dragged = false;
      const begin = () => {
        on = true;
        el.setPointerCapture(e.pointerId);
        doc.body.classList.add('floatdrag');
      };
      if (!slack) begin();
      const onMove = (ev) => {
        const dx = ev.clientX - x0, dy = ev.clientY - y0;
        if (!on) { if (!isDrag(dx, dy)) return; begin(); }
        dragged = true;
        rect = move(from, dx, dy);
        showPanel();
      };
      const onUp = () => {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
        if (!on) return;
        doc.body.classList.remove('floatdrag');
        saveRect();
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    });
  }
  const moveBy = (r, dx, dy) => place({ ...r, x: r.x + dx, y: r.y + dy }, innerWidth, innerHeight, aspect());
  dragging(bar, moveBy);
  dragging(box, moveBy, { slack: true });
  for (const g of grips) dragging(g, (r, dx, dy) => resized(r, dx, dy, aspect(), innerWidth, innerHeight, g.dataset.corner));
  box.addEventListener('click', (e) => { if (dragged) { dragged = false; e.stopPropagation(); e.preventDefault(); } }, true);

  // The window of its own gets the page's styles and appearance, and passes its keys on.
  function dress(w) {
    for (const el of doc.querySelectorAll('link[rel="stylesheet"], style')) w.document.head.append(el.cloneNode(true));
    w.document.title = 'Video · Scribecue';
    w.document.documentElement.classList.add('floatdoc');
    copyLook(w);
    for (const type of ['keydown', 'keyup']) {
      w.document.addEventListener(type, (e) => {
        const copy = new KeyboardEvent(type, {
          key: e.key, code: e.code, location: e.location, repeat: e.repeat, isComposing: e.isComposing,
          ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
          bubbles: true, cancelable: true,
        });
        if (!doc.body.dispatchEvent(copy)) e.preventDefault();
      });
    }
    w.addEventListener('resize', layout);
    w.addEventListener('pagehide', () => { if (pip === w) dock(); });
  }
  function copyLook(w = pip) {
    if (!w) return;
    const root = w.document.documentElement;
    for (const { name, value } of doc.documentElement.attributes) if (name.startsWith('data-')) root.setAttribute(name, value);
  }

  function move(into) { for (const el of moving) into.append(el); }

  async function float(how = kind()) {
    if (floating || !canFloat()) return;
    if (how === 'window' && canOwnWindow()) {
      try {
        const w = rect?.w || Math.round(stage.clientWidth);
        pip = await globalThis.documentPictureInPicture.requestWindow({ width: w, height: Math.round(w / aspect()) });
      } catch {
        pip = null;
        note('The video couldn’t open in its own window, so it floats in this tab');
      }
    } else if (how === 'window') {
      note('This browser can’t open the video in its own window, so it floats in this tab');
    }
    if (floating) return; // floated twice while waiting
    floating = pip ? 'window' : 'panel';
    move(pic);
    stage.classList.add('floating');
    hold.hidden = false;
    if (pip) {
      dress(pip);
      pip.document.body.append(pic);
    } else {
      box.append(pic);
      panel.hidden = false;
      showPanel();
    }
    layout();
    changed(true);
  }

  function dock() {
    if (!floating) return;
    const w = pip;
    floating = null;
    pip = null;
    for (const [el, parent, next] of spots) parent.insertBefore(el, next && next.parentNode === parent ? next : null);
    box.append(pic);
    panel.hidden = true;
    hold.hidden = true;
    stage.classList.remove('floating');
    try { w?.close(); } catch { /* already closed */ }
    layout();
    changed(false);
  }

  const toggle = () => (floating ? dock() : float());

  // Double-clicking the video floats it, or puts it back. Its first click has already
  // played or paused it, so the second click is left out and this one undoes the first.
  video.addEventListener('dblclick', (e) => { e.preventDefault(); undoClick(); toggle(); });

  new ResizeObserver(layout).observe(stage);
  new ResizeObserver(layout).observe(box);
  video.addEventListener('loadedmetadata', () => { if (floating === 'panel') showPanel(); else layout(); });
  addEventListener('resize', () => { if (floating === 'panel') { showPanel(); saveRect(); } });
  doc.addEventListener('scribecue:appearance', () => { copyLook(); layout(); });

  return {
    float, dock, toggle,
    get floating() { return floating; },
    // After the setting changes: a floating video moves to the new kind of window.
    refloat() { if (floating && floating !== kind()) { dock(); float(); } },
  };
}
