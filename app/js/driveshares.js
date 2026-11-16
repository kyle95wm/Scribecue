// Shared projects in Google Drive: when a project's keys changed both here and in another
// browser between syncs, which to keep. No browser or network here, so it can be tested.
// The syncing itself is in drivesync.js and googledrive.js.
import { mergeApart } from './sharing.js';
import { keysOf } from './sharekeys.js';
import { shareText } from './drivesync.js';

const read = (text) => { try { const r = JSON.parse(text); return r && typeof r === 'object' && typeof r.room === 'string' ? r : null; } catch { return null; } };
const owns = (r) => r.link === 'owner';

// `here` and `there` are the texts drivesync keeps (shareText). Returns one of them, or a new
// text holding both.
// - The project's owner: what each browser did to the links is kept, as when two of the
//   owner's browsers meet on the relay (mergeApart). Links are only made, turned off and
//   sealed, so nothing is rolled back.
// - Joined: the one with more project keys, which is the newer.
// - Shared again since, so in another room: the owner's, or else the newer list.
export function combineShares(_name, here, there) {
  const a = read(here), b = read(there);
  if (!a) return there;
  if (!b) return here;
  if (a.room !== b.room) {
    if (owns(a) !== owns(b)) return owns(a) ? here : there;
    return (a.n || 0) > (b.n || 0) ? here : there;
  }
  if (owns(a) !== owns(b)) return owns(a) ? here : there;
  if (!owns(a)) return keysOf(a).length > keysOf(b).length ? here : there;
  // The newer list is "theirs", and what the other did goes on top.
  const [mine, theirs, theirsText] = (a.n || 0) > (b.n || 0) ? [b, a, here] : [a, b, there];
  const { record, changed } = mergeApart(mine, theirs);
  if (!changed) return theirsText;
  const out = { ...record, created: !!(a.created || b.created) };
  if (typeof a.title === 'string' && a.title) out.title = a.title;
  return shareText(JSON.stringify(out));
}
