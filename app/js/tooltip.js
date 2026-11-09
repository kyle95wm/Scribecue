// Tooltips: the text in an element's data-tip, shown after a short pause on hover or keyboard
// focus. One tooltip for the whole page, in the browser's top layer, so no panel, list or
// dialog cuts it off, and kept inside the window: below its element, or above when there's
// more room there.

// Where a tooltip goes. `a`: its element's box ({ left, top, right, bottom }); `size`:
// the tooltip's { width, height }; `view`: the window's. Below unless `above`; the other
// side when it doesn't fit; always inside the window, `margin` from its edges.
export function placeTip(a, size, view, { above = false, gap = 8, margin = 8 } = {}) {
  const maxX = view.width - size.width - margin;
  const x = Math.max(margin, Math.min((a.left + a.right) / 2 - size.width / 2, maxX));
  const below = a.bottom + gap, over = a.top - gap - size.height;
  const fitsBelow = below + size.height <= view.height - margin, fitsAbove = over >= margin;
  let side = above ? (fitsAbove || !fitsBelow ? 'above' : 'below') : (fitsBelow || !fitsAbove ? 'below' : 'above');
  // Fits neither way: the side with more room.
  if (!fitsBelow && !fitsAbove) side = view.height - a.bottom > a.top ? 'below' : 'above';
  const y = Math.max(margin, Math.min(side === 'below' ? below : over, view.height - size.height - margin));
  return { x: Math.round(x), y: Math.round(y), side };
}

export const TIP_DELAY = 350;

export function startTips(doc = document) {
  const win = doc.defaultView;
  const tip = doc.createElement('div');
  tip.id = 'tip';
  tip.setAttribute('aria-hidden', 'true'); // screen readers get the element's own label
  if ('showPopover' in tip) tip.popover = 'manual';
  doc.body.append(tip);
  let anchor = null, timer = 0, shown = false, watch = null, frame = 0;

  const raise = (on) => {
    if (!tip.popover) return;
    try { if (on) { if (tip.matches(':popover-open')) tip.hidePopover(); tip.showPopover(); } else tip.hidePopover(); } catch { /* already so */ }
  };
  function hide() {
    clearTimeout(timer); timer = 0;
    cancelAnimationFrame(frame); frame = 0;
    watch?.disconnect(); watch = null;
    anchor = null;
    if (!shown) return;
    shown = false;
    tip.classList.remove('on');
    raise(false);
  }
  function place() {
    const r = anchor.getBoundingClientRect(), view = { width: doc.documentElement.clientWidth, height: doc.documentElement.clientHeight };
    // Its element scrolled out of sight, or went.
    if (!anchor.isConnected || !r.width && !r.height || r.bottom < 0 || r.top > view.height || r.right < 0 || r.left > view.width) { hide(); return; }
    const p = placeTip(r, { width: tip.offsetWidth, height: tip.offsetHeight }, view, { above: !!anchor.closest('.status') });
    tip.style.left = p.x + 'px'; tip.style.top = p.y + 'px';
    tip.dataset.side = p.side;
  }
  function show() {
    timer = 0;
    const text = anchor?.isConnected && !doc.body.classList.contains('dragging') ? anchor.getAttribute('data-tip') : '';
    if (!text) { hide(); return; }
    tip.textContent = text;
    // On top of any dialog opened since.
    raise(true);
    if (!shown) { shown = true; tip.classList.remove('on'); }
    place(); // measures it, so it fades in from where it is
    if (anchor) tip.classList.add('on');
  }
  function want(el, delay = TIP_DELAY) {
    if (el === anchor) return;
    hide();
    anchor = el;
    // Its text can change while it shows, as for who's here.
    watch = new MutationObserver(() => { if (shown) show(); });
    watch.observe(el, { attributes: true, attributeFilter: ['data-tip'] });
    if (delay) timer = setTimeout(show, delay); else show();
  }
  const tipOf = (t) => (t instanceof win.Element ? t.closest('[data-tip]') : null);

  doc.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = tipOf(e.target);
    if (el) want(el); else if (anchor) hide();
  });
  doc.addEventListener('pointerout', (e) => {
    if (anchor && !(e.relatedTarget && anchor.contains(e.relatedTarget))) hide();
  });
  doc.addEventListener('focusin', (e) => {
    const el = tipOf(e.target);
    if (el && e.target.matches(':focus-visible')) want(el);
  });
  doc.addEventListener('focusout', (e) => { if (anchor && anchor.contains(e.target)) hide(); });
  doc.addEventListener('pointerdown', hide, true);
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); }, true);
  win.addEventListener('blur', hide);
  // Moving with its element, as a list scrolls under it.
  const follow = () => { if (shown && !frame) frame = requestAnimationFrame(() => { frame = 0; if (anchor) place(); }); };
  doc.addEventListener('scroll', follow, true);
  win.addEventListener('resize', follow);

  return { el: tip, show: (el) => want(el, 0), hide };
}
