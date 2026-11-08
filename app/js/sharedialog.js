// The Share dialog: for the owner, a link for each kind of access, each with its own
// password; for someone who joined, what they can do and a way to leave. Also the small
// tag in the header that says whether the project is connected.

export const ROLE_TEXT = {
  edit: { name: 'Can edit', what: 'Changes blocks and comments, in Write.' },
  review: { name: 'Can review', what: 'Works in QC. Block changes wait in Pending review for you to accept.' },
  comment: { name: 'Can comment', what: 'Works in QC. Adds and answers comments only.' },
};
export const STATUS_TEXT = {
  online: ['Shared', 'Connected. Changes reach others as you make them.'],
  connecting: ['Connecting', 'Connecting to the sharing service…'],
  offline: ['Offline', 'Offline. Your changes are kept here and sent when you’re back online.'],
};

// `deps`: $, toast, record(), status(), base(), name(), setName(v), make(role, password),
// turnOff(id), stop(), leave().
export function shareDialog(deps) {
  const { $ } = deps;
  const dlg = $('shareDlg'), list = $('shareLinks');
  let busy = false;

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
    } else {
      const label = document.createElement('label'), pw = document.createElement('input'), make = document.createElement('button');
      pw.type = 'password'; pw.autocomplete = 'new-password'; pw.spellcheck = false; pw.id = `sharePw-${role}`;
      label.htmlFor = pw.id; label.textContent = 'Password';
      make.textContent = 'Make link';
      const go = () => {
        if (pw.value.length < 6) { deps.toast('Use a password of at least 6 characters'); pw.focus(); return; }
        run(() => deps.make(role, pw.value));
      };
      make.addEventListener('click', go);
      pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      line.append(label, pw, make);
    }
    sec.append(line);
    return sec;
  }

  async function run(fn) {
    if (busy) return;
    busy = true; render();
    try { await fn(); } catch (e) { deps.toast(e?.message === 'offline' ? 'Couldn’t reach the sharing service. Try again when you’re online' : 'That didn’t work. Try again'); }
    finally { busy = false; render(); }
  }

  function render() {
    const r = deps.record(), owner = !r || r.link === 'owner';
    $('shareIntro').textContent = !r
      ? 'Make a link for each kind of access. Each link has its own password: send it separately. The video isn’t shared: each person opens their own copy.'
      : owner
        ? 'People with a link and its password can open this project. Send each password separately.'
        : `You ${ROLE_TEXT[r.role]?.name.toLowerCase() || 'can open'} this project, shared with you by its owner.`;
    const named = !!deps.name();
    $('shareNameRow').hidden = named && !!r;
    if (!$('shareName').matches(':focus')) $('shareName').value = deps.name();
    list.replaceChildren(...(owner ? Object.keys(ROLE_TEXT).map((role) => row(role, deps.links().find((l) => l.role === role))) : []));
    for (const b of list.querySelectorAll('button, input:not([readonly])')) b.disabled = busy;
    const status = r ? STATUS_TEXT[deps.status()] : null;
    $('shareStatus').textContent = busy ? 'Working…' : status ? status[1] : '';
    $('shareStop').hidden = !r || !owner;
    $('shareLeave').hidden = !r || owner;
  }

  $('shareName').addEventListener('change', () => deps.setName($('shareName').value));
  $('shareClose').addEventListener('click', () => dlg.close());
  $('shareStop').addEventListener('click', () => {
    if (!confirm('Stop sharing this project? Every link stops working, and the copy on the sharing service is deleted. Your copy stays here.')) return;
    run(() => deps.stop());
  });
  $('shareLeave').addEventListener('click', () => {
    if (!confirm('Leave this shared project? You keep a copy here, but you won’t see others’ changes, and yours won’t reach them.')) return;
    run(async () => { await deps.leave(); dlg.close(); });
  });

  return {
    open() { render(); if (!dlg.open) dlg.showModal(); },
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
    'bad-link': 'This link is incomplete. Copy all of it and try again',
    offline: 'Couldn’t reach the sharing service. Try again when you’re online',
  };
  let busy = false;
  async function open() {
    if (busy) return;
    const pw = $('joinPassword').value;
    if (!pw) { $('joinPassword').focus(); return; }
    if ($('joinName').value.trim()) deps.setName($('joinName').value);
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
  $('joinPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); open(); } });
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
