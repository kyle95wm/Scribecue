// Browsers too old to run Scribecue would only show a blank page, so this says so instead.
// It's an ordinary script in old-style JavaScript, so it runs where the app can't, and
// it runs before the app does.
//
// Array.prototype.findLast is the newest thing the app relies on: Chrome and Edge 97,
// Firefox 104 and Safari 15.4, from 2022. Browsers with it have everything else too, such
// as modules, ??= and <dialog>.
function scribecueTooOld(w) {
  return !(w.Array && w.Array.prototype && typeof w.Array.prototype.findLast === 'function' &&
    typeof w.HTMLDialogElement === 'function' && typeof w.structuredClone === 'function');
}

if (typeof document !== 'undefined' && scribecueTooOld(window)) {
  var block = document.getElementById('oldBlock');
  if (block) {
    block.hidden = false;
    document.body.className += ' blocked';
  }
}
