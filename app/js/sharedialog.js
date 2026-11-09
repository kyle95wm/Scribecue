// The Share dialog: for the owner, a link for each kind of access, each with its own
// password; for someone who joined, what they can do and a way to leave. Also the small
// tag in the header that says whether the project is connected.

export const ROLE_TEXT = {
  edit: { name: 'Can edit', what: 'Changes blocks and comments, in Write.' },
  review: { name: 'Can review', what: 'Works in QC. Block changes wait in Pending review for you to accept.' },
  comment: { name: 'Can comment', what: 'Works in QC. Adds and answers comments only.' },
};
export const STATUS_TEXT = {
  online: ['Shared', 'Connected. Others see each block once you’ve finished it.'],
  connecting: ['Connecting', 'Connecting to the sharing service…'],
  offline: ['Offline', 'Offline. Your changes are kept here and sent when you’re back online.'],
  'old-app': ['Update needed', 'This version of Scribecue can’t connect to the sharing service. Update Scribecue and open the project again. Your changes are kept here.'],
  'old-relay': ['Update needed', 'The sharing service needs updating before this project connects. Your changes are kept here.'],
};

// `deps`: $, toast, record(), status(), base(), name(), setName(v), make(role, password, days),
// turnOff(id), stop(), leave(), googleKey() (null with no shared copy), shareGoogleKey(key)
// → resolves to '' or what's wrong, myExpiry() (when a joined person's link stops working),
// maxDays, recovery() (the recovery link, or null), makeRecovery(password), turnOffRecovery(),
// recoveryMin.
// When a link stops working, as people read it.
export function expiryText(at, now = Date.now()) {
  const days = Math.max(1, Math.round((at - now) / 86_400_000));
  const when = new Date(at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return at - now < 86_400_000 * 0.75 ? `Expires ${when}, within a day` : `Expires ${when}, in ${days} day${days === 1 ? '' : 's'}`;
}
// A number of days typed for a link: null for none, NaN if it isn't one.
export function readDays(text, max) {
  const t = String(text).trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : NaN;
}
export function shareDialog(deps) {
  const { $ } = deps;
  const dlg = $('shareDlg'), list = $('shareLinks');
  let busy = false, keyOpen = false;
  // What's typed for each link not yet made, kept when the dialog redraws.
  const drafts = {};
  // A name is needed to share: others see it. One typed but not yet kept counts.
  const named = () => {
    const typed = $('shareName').value.trim();
    if (typed && typed !== deps.name()) deps.setName(typed);
    return !!deps.name();
  };

  function row(role, link) {
    const t = ROLE_TEXT[role];
    const sec = document.createElement('section');
    sec.className = 'sharerow';
    const head = document.createElement('h3'); head.textContent = t.name;
    const what = document.createElement('p'); what.className = 'dim small'; what.textContent = t.what;
    sec.append(head, what);
    const line = document.createElement('p'); line.className = 'updstatus sharerowline';
    if (link) {
      const url = document.createElement('input');
      url.className = 'sharelink'; url.readOnly = true; url.value = link.url; url.setAttribute('aria-label', `${t.name} link`);
      url.addEventListener('focus', () => url.select());
      const copy = document.createElement('button'); copy.textContent = 'Copy';
      copy.dataset.tip = 'Copy the link. Send its password separately';
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(link.url); deps.toast('Link copied. Send its password separately'); }
        catch { url.focus(); deps.toast('Select the link and copy it'); }
      });
      const off = document.createElement('button'); off.textContent = 'Turn off';
      off.dataset.tip = 'The link stops working. People using it keep the copy they have';
      off.addEventListener('click', () => run(() => deps.turnOff(link.id)));
      line.append(url, copy, off);
      if (link.expires) {
        const ends = document.createElement('p'); ends.className = 'dim small shareexpiry';
        ends.textContent = expiryText(link.expires);
        sec.append(line, ends);
        return sec;
      }
    } else {
      const label = document.createElement('label'), pw = document.createElement('input'), make = document.createElement('button');
      pw.type = 'password'; pw.autocomplete = 'new-password'; pw.spellcheck = false; pw.id = `sharePw-${role}`;
      label.htmlFor = pw.id; label.textContent = 'Password';
      // How long the link works for: empty for as long as it's on.
      const daysLabel = document.createElement('label'), days = document.createElement('input'), unit = document.createElement('span');
      days.type = 'number'; days.min = '1'; days.max = String(deps.maxDays); days.step = '1'; days.inputMode = 'numeric';
      days.id = `shareDays-${role}`; days.className = 'sharedays'; days.placeholder = 'never';
      daysLabel.htmlFor = days.id; daysLabel.textContent = 'Expires after';
      days.dataset.tip = 'Leave empty for a link that works until you turn it off';
      unit.textContent = 'days'; unit.className = 'dim';
      const draft = drafts[role] ||= { pw: '', days: '' };
      pw.value = draft.pw; days.value = draft.days;
      pw.addEventListener('input', () => { draft.pw = pw.value; });
      days.addEventListener('input', () => { draft.days = days.value; });
      make.textContent = 'Make link';
      const go = () => {
        if (!named()) { deps.toast('Add your name first, so others know who’s here'); $('shareName').focus(); return; }
        if (pw.value.length < 6) { deps.toast('Use a password of at least 6 characters'); pw.focus(); return; }
        const n = readDays(days.value, deps.maxDays);
        if (Number.isNaN(n)) { deps.toast(`Use a number of days from 1 to ${deps.maxDays}, or leave it empty`); days.focus(); return; }
        run(async () => { await deps.make(role, pw.value, n); delete drafts[role]; });
      };
      make.addEventListener('click', go);
      for (const el of [pw, days]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      line.append(label, pw, daysLabel, days, unit, make);
    }
    sec.append(line);
    return sec;
  }

  // The owner's recovery link: opens the project as its owner if this browser's storage is
  // lost, here or on another computer.
  function recoveryRow() {
    const url = deps.recovery();
    const sec = document.createElement('section');
    sec.className = 'sharerow';
    const head = document.createElement('h3'); head.textContent = 'Recovery link';
    const what = document.createElement('p'); what.className = 'dim small';
    what.textContent = url
      ? 'Opens this project as its owner, here or on another computer. Keep the link and its password somewhere safe, apart from each other. Anyone with both can change the links and read the project.'
      : 'Without one, nobody can change this project’s links if this browser’s data is lost. A recovery link and its password let you take the project back, here or on another computer.';
    const line = document.createElement('p'); line.className = 'updstatus sharerowline';
    if (url) {
      const field = document.createElement('input');
      field.className = 'sharelink'; field.readOnly = true; field.value = url; field.setAttribute('aria-label', 'Recovery link');
      field.addEventListener('focus', () => field.select());
      const copy = document.createElement('button'); copy.textContent = 'Copy';
      copy.dataset.tip = 'Copy the recovery link. Keep it apart from its password';
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(url); deps.toast('Recovery link copied. Keep it somewhere safe'); }
        catch { field.focus(); deps.toast('Select the link and copy it'); }
      });
      const off = document.createElement('button'); off.textContent = 'Turn off';
      off.dataset.tip = 'The recovery link stops working. Make a new one to replace it';
      off.addEventListener('click', () => run(() => deps.turnOffRecovery()));
      line.append(field, copy, off);
    } else {
      const label = document.createElement('label'), pw = document.createElement('input'), make = document.createElement('button');
      pw.type = 'password'; pw.autocomplete = 'new-password'; pw.spellcheck = false; pw.id = 'sharePw-recovery';
      label.htmlFor = pw.id; label.textContent = 'Password';
      const draft = drafts.recovery ||= { pw: '' };
      pw.value = draft.pw;
      pw.addEventListener('input', () => { draft.pw = pw.value; });
      make.textContent = 'Make recovery link';
      const go = () => {
        if (pw.value.length < deps.recoveryMin) { deps.toast(`Use a password of at least ${deps.recoveryMin} characters for the recovery link`); pw.focus(); return; }
        run(async () => { await deps.makeRecovery(pw.value); delete drafts.recovery; });
      };
      make.addEventListener('click', go);
      pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      line.append(label, pw, make);
    }
    sec.append(head, what, line);
    return sec;
  }

  async function run(fn) {
    if (busy) return;
    busy = true; render();
    try { await fn(); } catch (e) { deps.toast(e?.message === 'offline' ? 'Couldn’t reach the sharing service. Try again when you’re online' : 'That didn’t work. Try again'); }
    finally { busy = false; render(); }
  }

  function render() {
    const r = deps.record(), owner = !r || r.link === 'owner', mine = r && !owner ? deps.myExpiry?.() : null;
    $('shareIntro').textContent = !r
      ? 'Make a link for each kind of access. Each link has its own password: send it separately. The video isn’t shared: each person opens their own copy.'
      : owner
        ? 'People with a link and its password can open this project. Send each password separately.'
        : `You ${ROLE_TEXT[r.role]?.name.toLowerCase() || 'can open'} this project, shared with you by its owner.${mine ? ` Your link ${expiryText(mine).replace(/^Expires/, 'expires')}.` : ''}`;
    const named = !!deps.name();
    $('shareNameRow').hidden = named && !!r;
    if (!$('shareName').matches(':focus')) $('shareName').value = deps.name();
    const focused = list.contains(document.activeElement) ? document.activeElement.id : '';
    list.replaceChildren(...(owner ? Object.keys(ROLE_TEXT).map((role) => row(role, deps.links().find((l) => l.role === role))) : []), ...(owner && r ? [recoveryRow()] : []));
    if (focused) document.getElementById(focused)?.focus(); // still typing, after a redraw
    for (const b of list.querySelectorAll('button, input:not([readonly])')) b.disabled = busy;
    const status = r ? STATUS_TEXT[deps.status()] : null;
    $('shareStatus').textContent = busy ? 'Working…' : status ? status[1] : '';
    // The owner can let others read Google voices with a separate key of the project's.
    const key = owner && r ? deps.googleKey() : null;
    $('shareGoogle').hidden = key == null;
    if (key != null) {
      const on = !!key;
      if (on) keyOpen = false;
      $('shareGoogleOn').setAttribute('aria-pressed', String(on || keyOpen));
      $('shareGoogleRow').hidden = on || !keyOpen;
      if (on) $('shareGoogleOn').dataset.tip = 'Take the key out. Others need their own key for Google voices again';
      else delete $('shareGoogleOn').dataset.tip;
      $('shareGoogleInfo').textContent = on
        ? 'Others read this project’s Google voices with the separate key you shared. Anyone with a link can read it. Delete it in Google Cloud when you’re done.'
        : keyOpen
          ? 'Create a separate key for this project, limited to Text-to-Speech, and paste it here. Others’ readings use it and count against its allowance. Anyone with a link can read it.'
          : 'Others need their own Google key to hear Google voices, unless you share a separate one.';
      for (const id of ['shareGoogleOn', 'shareGoogleKey', 'shareGoogleSave']) $(id).disabled = busy;
    }
    $('shareStop').hidden = !r || !owner;
    $('shareLeave').hidden = !r || owner;
  }

  $('shareName').addEventListener('change', () => deps.setName($('shareName').value));
  $('shareGoogleOn').addEventListener('click', () => {
    if (deps.googleKey()) {
      run(async () => { await deps.shareGoogleKey(''); });
      return;
    }
    keyOpen = !keyOpen; render();
    if (keyOpen) $('shareGoogleKey').focus();
  });
  const shareKey = () => {
    const key = $('shareGoogleKey').value.trim();
    if (!key) { deps.toast('Paste the separate key first'); $('shareGoogleKey').focus(); return; }
    run(async () => {
      const problem = await deps.shareGoogleKey(key);
      if (problem) { deps.toast(problem); return; }
      $('shareGoogleKey').value = '';
    });
  };
  $('shareGoogleSave').addEventListener('click', shareKey);
  $('shareGoogleKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); shareKey(); } });
  $('shareClose').addEventListener('click', () => dlg.close());
  $('shareStop').addEventListener('click', () => {
    if (!confirm('Stop sharing this project? Every link stops working, and the copy on the sharing service is deleted. Your copy stays here.')) return;
    run(() => deps.stop());
  });
  // Leaving: without a copy unless asked for, so the project doesn't stay on a computer by
  // accident.
  const leaveDlg = $('leaveDlg'), keep = $('leaveKeep');
  const showKeep = () => {
    const on = keep.getAttribute('aria-pressed') === 'true';
    $('leaveWhat').textContent = on
      ? 'The project stays here as a project of your own.'
      : 'The project is removed from this browser, and a new one starts. A project file you saved stays where you saved it.';
    keep.dataset.tip = on ? 'Don’t keep the project here' : 'Keep the project here, as a project of your own';
  };
  $('shareLeave').addEventListener('click', () => {
    keep.setAttribute('aria-pressed', 'false');
    showKeep();
    leaveDlg.showModal();
    $('leaveCancel').focus();
  });
  keep.addEventListener('click', () => { keep.setAttribute('aria-pressed', String(keep.getAttribute('aria-pressed') !== 'true')); showKeep(); });
  $('leaveCancel').addEventListener('click', () => leaveDlg.close());
  $('leaveGo').addEventListener('click', () => {
    const copy = keep.getAttribute('aria-pressed') === 'true';
    leaveDlg.close();
    run(async () => { await deps.leave(copy); dlg.close(); });
  });

  return {
    open() { if (!dlg.open) for (const k in drafts) delete drafts[k]; render(); if (!dlg.open) dlg.showModal(); },
    // The header tag, and the dialog if it's open.
    update() {
      const r = deps.record(), tag = $('shareState'), s = r ? STATUS_TEXT[deps.status()] : null;
      tag.hidden = !s;
      if (s) { tag.textContent = s[0]; tag.dataset.tip = s[1]; tag.classList.toggle('offline', deps.status() !== 'online'); }
      if (dlg.open) render();
    },
  };
}

// The dialog for opening a link: asks for its password and the person's name.
// `deps`: $, name(), setName(v), join(password) → resolves, or rejects with a reason.
export function joinDialog(deps) {
  const { $ } = deps;
  const dlg = $('joinDlg');
  const reasons = {
    'wrong-password': 'That password doesn’t open this link. Check it with the person who sent it',
    'no-link': 'This link has been turned off. Ask for a new one',
    'link-expired': 'This link has expired. Ask for a new one',
    'bad-link': 'This link is incomplete. Copy all of it and try again',
    offline: 'Couldn’t reach the sharing service. Try again when you’re online',
    'old-app': 'Update Scribecue to open this link',
    'old-relay': 'The sharing service needs updating before this link opens',
  };
  let busy = false;
  async function open() {
    if (busy) return;
    const pw = $('joinPassword').value;
    if (!pw) { $('joinPassword').focus(); return; }
    // Others see the name, so it's needed.
    if (!$('joinName').value.trim()) { $('joinStatus').textContent = 'Add your name, so others know who’s here'; $('joinName').focus(); return; }
    deps.setName($('joinName').value);
    busy = true; $('joinOpen').disabled = true; $('joinStatus').textContent = 'Opening…';
    try {
      const ok = await deps.join(pw);
      if (ok !== false) dlg.close();
      $('joinStatus').textContent = '';
    } catch (e) {
      $('joinStatus').textContent = reasons[e?.message] || 'That didn’t work. Try again';
    } finally { busy = false; $('joinOpen').disabled = false; }
  }
  $('joinOpen').addEventListener('click', open);
  for (const id of ['joinPassword', 'joinName']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); open(); } });
  $('joinCancel').addEventListener('click', () => dlg.close());
  return {
    open() {
      $('joinPassword').value = ''; $('joinStatus').textContent = '';
      $('joinName').value = deps.name();
      dlg.showModal();
      $('joinPassword').focus();
    },
  };
}
