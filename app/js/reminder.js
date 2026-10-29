// A nudge to save. Work in progress is kept in the browser as you go, but only a project
// file is safe from the browser's data being cleared, a private window, or a switch to
// another browser. So after a while of unsaved work, a note asks to save, until it's done.

export const REMIND_AFTER = 20 * 60e3; // unsaved for this long
export const ACTIVE = 5 * 60e3; // and changed this recently, so an idle tab isn't nagged
export const SNOOZE = 30 * 60e3; // Later waits this long

// Whether to remind now. Times in ms. unsavedSince: when the first unsaved change was
// made, or null when everything's saved.
export function dueReminder({ blocks, unsavedSince, lastChange, snoozedUntil = 0, now }) {
  return blocks > 0 && unsavedSince != null && now - unsavedSince >= REMIND_AFTER &&
    now - lastChange <= ACTIVE && now >= snoozedUntil;
}

// What the note says: different when there's no project file yet, since then the work is
// only in this browser.
export function reminderText({ blocks, hasFile, name }) {
  const n = `${blocks} block${blocks === 1 ? '' : 's'}`;
  return hasFile
    ? { title: 'Save your changes', text: `You haven’t saved ${name} for a while. Your changes are kept in this browser meanwhile, but only the project file is safe if the browser’s data is cleared.` }
    : { title: 'Save your work as a project', text: `Your ${n} ${blocks === 1 ? 'is' : 'are'} only kept in this browser. Clearing its data, a private window or switching browsers would lose ${blocks === 1 ? 'it' : 'them'}. A project file keeps ${blocks === 1 ? 'it' : 'them'} safe, and opens anywhere.` };
}

const $ = (id) => document.getElementById(id);

// hooks: state() -> { blocks, dirty, hasFile, name, lastChange }, busy() -> bool, save().
export function initReminder(hooks) {
  let unsavedSince = null, snoozedUntil = 0;
  const box = $('saveAlert');
  const hide = () => { box.hidden = true; };
  $('saveAlertLater').addEventListener('click', () => { hide(); snoozedUntil = Date.now() + SNOOZE; });
  $('saveAlertSave').addEventListener('click', () => { hide(); hooks.save(); });
  setInterval(() => {
    const s = hooks.state(), now = Date.now();
    if (!s.dirty) { unsavedSince = null; hide(); return; }
    unsavedSince ??= now;
    if (!box.hidden || hooks.busy() || !dueReminder({ ...s, unsavedSince, snoozedUntil, now })) return;
    const { title, text } = reminderText(s);
    $('saveAlertTitle').textContent = title;
    $('saveAlertText').textContent = text;
    box.hidden = false;
  }, 30e3);
}
