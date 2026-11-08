# QC handoffs and future collaboration

The user workflow lives in [QC review](../../Guides/QC.md). There is one review workflow:
export a QC package, review in QC, compare the returned package, and accept changes into the authoring project. Package-to-package comparison still saves
a combined QC package. There is no separate project-copy interface or file type.

## Implemented

- Project ids and block uids survive project saves, QC packages and session recovery.
  Splitting makes a new identity for the second block. Undo restores identities and
  the current review history with the blocks.
- QC export keeps a content-addressed starting point covering the script, permission,
  reading metadata and each original clip's SHA-256 digest. Only the current review
  round goes into the outgoing package. Previous rounds remain in the writer's project.
- The writer keeps at most four starting points and 1,048,576 characters of snapshots.
  A returned file must match one of those starting points, or a fresh handoff is needed.
  Ordinary saves keep history without making a revision for each keystroke.
- Export remembers the baseline in the writer's current project only if the project id
  still matches. Save that project too. The original exported package can also serve
  as the source for comparison.
- **QC under the video → Compare returned review** compares blocks and comments against
  that round's starting point. Returned comments combine automatically. Every block the
  reviewer changed, added or removed, and every conflict, is listed in the Pending review
  tab (`qcpending.js`) for an explicit accept or reject. An accepted change can carry the
  user's edits to its wording and times (`edit` on the resolution). Block comments merge
  separately from script corrections, so a returned comment cannot revert an author’s
  independent text or timing change. Comments have ids (`cleanComments` in `comments.js`;
  older ones get an id derived from their content, so both copies agree) and merge one by
  one (`mergeComments`). Only different changes to the same comment, or a deletion against
  a change, make the whole list a conflict that needs an explicit choice.
- Choices are applied together on accept, by merging again against the current project.
  Blocks edited locally while the list was open come back as conflicts. Pending choices
  are kept in memory only.
- Returned reading metadata and permission must match the locally saved baseline.
  Every original clip is hashed again, one at a time, before using its audio. Changed
  readings, changed permissions and script changes in comments-only returns are refused.
- A comments-only source package cannot acquire editing permission through comparison.
  A writer's plain project can retain their own changes made after a comments-only handoff.
- The returned review contributes block corrections and comments. Writer notes, media,
  recording state and project settings stay with the local project. Listening preferences
  in the return do not change the writer's settings.
- Audio references are rebuilt from the trusted block-to-reading map, not incoming
  offsets. Moving a block reuses its saved clip. Changed text keeps the original for comparison.
- An author accepts into the existing `.scribecue` file (or chooses one if no writable
  handle is available). A `reviewAudio.baselineId` reference retains the original readings.
  Original package audio is kept under a separate IndexedDB key by project and baseline.
  Save/Save As write ordinary JSON, never a full film's narration in the project file.
- Original readings can be located from their QC package on another computer or after
  clearing cached data. The worker verifies the retained content hash, metadata, permission
  and clip bytes without importing the package's script or comments. It can verify an old
  round against its retained hash even after that round leaves bounded review history.
- Editing authority comes from the current file context, not the returned package or a
  serialized owner flag. Actual QC packages use `reviewId` and their saved permission.
  Plain authoring projects use no package lock. Their accepted-review reference makes QC
  editing available alongside the comments; Write remains available too.
- Package-to-package comparisons retain the original permission and save a QC package.
  QC manifests omit author audio references. Original audio uses Blob slices, not full
  film decoding. The author path never promotes the reviewer's package permission.
- Cancelled or failed writes keep the live project and Pending review choices. Generation
  checks before saving and after stopping jobs prevent overwriting newer work. Download-only
  browsers keep current work open and ask the user to reopen the downloaded package.
- File parsing, baseline verification, comparison and original-audio verification run
  in a worker. Progress distinguishes original readings from block comparison. Abort
  terminates the worker. No network transport is involved.
- Undo shares immutable history references instead of duplicating old scripts per edit.
  Session recovery and regular project saves keep the current history.

Older QC packages remain readable and keep their existing permissions. They need a new
export before automated comparison. Older app versions may drop baseline metadata when
resaving; both people should use a current Scribecue.

Hashes check a file against a locally retained baseline. They do not authenticate a
reviewer, provide account permissions or make the file format tamper-proof. Someone
with a plain exported script can still edit that script outside the review workflow.

- Each block keeps who last changed its script (`edited`: name, time and a random browser
  id, in `edits.js`). Changes are noticed in `changed()` by comparing each block with how it
  last looked; opening a file or undoing replaces the list and stamps nothing. Record mode
  never stamps. The name shows on an open block only once two or more people have changed
  blocks, so a project of your own looks the same. Merging ignores `edited` when comparing
  and keeps the one from the side whose block is kept. Pending review names the reviewer.
  `scripts/edits-smoke.mjs` checks it at 6× with 1,500 blocks.

## Optional Google review access

- Version 4 manifests add readings for blocks added in review: a proposal with `blockUid`
  and no `originalOffset`. Readers allow it only in handoff packages, for a uid with no
  original reading, in a Google Standard voice that the original readings already use.
  Version 3 is still written when every proposal has an original.
- Version 3 manifests may hold `reviewAccess.googleKey`, supplied separately at export.
  It is outside the project, baseline and global TTS settings. Comments-only exports
  cannot include a key. The export form rejects the writer's configured main key.
- `qcspeech.js` compares spoken words, effective speed and exact original Google voice.
  Placement, formatting, gain and dip changes reuse recordings. Playback and seeking
  never synthesize. A block's changed speech is read 500 ms after its edit ends
  (`autoRewrite` in `app.js`) when the reviewer or the package has a Google key, and its
  end follows that reading once. V retries a block left unread. The voice list is hidden
  for blocks with an original Google reading (`voiceFixed`), unless the voice already changed.
- The reviewer's configured key takes priority. On failure, that reading is retried with
  the bundled key, and a toast says so. Each new reading starts with the personal key again.
  Request errors redact keys. An in-flight map prevents duplicate synthesis requests.
- Proposed WAVs append after immutable original clips. A separate descriptor table binds
  each to an original offset, spoken wording and speed. Playback selects matching saved
  audio; changing the voice cannot use delegated access. Originals remain comparable.
- Comparison verifies original descriptors against the trusted baseline and hashes each
  clip. Proposed clips must have valid bindings and hashes too. Audio stays sliced;
  package parsing and comparison run in workers.
- Working saves and recovery keep the review key. `resaveReview` strips it by default;
  only working saves opt in. Reviewers send their working save back, so a returned package
  still holds the key; writers delete it after the review. Combined packages, author audio
  attachments and author JSON leave it out.

## Shared copy (Yjs) and two tabs, not yet switched on

Live sharing will send changes as Yjs updates. `shared.js` keeps a Yjs document of the
project's blocks and comments; the app's own blocks stay the source it edits.

- Each block is a `Y.Map` under `blocks`, keyed by uid, with its text as `Y.Text` so two
  people typing in one block merge letter by letter. Other shared fields (times, voice,
  speed, levels, notes, `edited`) take the latest change. Pickups, readings and `id` stay local.
- Comments are plain values under `comments`, keyed by id, with `block` set to the block's
  uid or `null` for timeline comments.
- `changed()` copies edits in (`noteShared` in `app.js`): one block when it knows which,
  otherwise the whole script. Another project starts a new document.
- `observe()` reports others' changes by block uid. `applyShared` in `app.js` puts them into
  the script in place: only those blocks and their comments, with no undo step, no
  "edited by" stamp, no new reading. The caret in a block being typed stays with the letters
  around it (`keepCaret`).
- Tabs of one browser with the same project open share changes over `BroadcastChannel`
  (`linkTabs`), as the sharing service will. A tab that opens asks for another tab's copy
  and waits up to 400 ms. If one comes, it takes that copy; otherwise it starts its own.
  Tabs only answer once their own copy is ready. Two tabs opening at the same moment can
  each start their own, which then conflict at block level: the service will avoid this
  by always handing out its copy.
- Undo takes back only this tab's changes. The app's undo steps still mark where each step
  starts: `pushUndo` also starts a step in Yjs's `UndoManager` (`shared.undoer()`, tracking
  only this tab's writes) and notes how deep it was. Undo reverses the Yjs steps above that
  depth, so others' words stay, then puts back the parts that aren't shared (pickups, review
  audio) from the snapshot. Typing a sentence and holding a nudge key stay one step each.
  Steps from before the copy started undo the old way. Undo while sharing measured 39–48 ms
  at 6× with 1,500 blocks, against 31–34 ms without.
- It only runs with `scribecue.sharedCopy` set to `1` in the browser's storage. Yjs then
  loads on demand; otherwise it never loads.
- Yjs is bundled by `scripts/vendor-yjs.sh` into `app/vendor/yjs.js`, at a fixed version.
- `scripts/two-tab-smoke.mjs` opens two tabs at 6× with 1,500 blocks: joining, typing in
  the same block at once, carets, deleting, commenting, names, and undo and redo. Two
  Scribecue tabs in one headless browser slow each other a lot (14 → 72 ms a character with
  sharing off), so compare its typing time with that, not with one tab. Sharing added about
  10–15 ms. A's undo reached the other tab in about 60 ms.
- `SHARED_COPY=1 scripts/slow-chromium.sh tour` runs the 1-CPU tour with it on: like `main`,
  with bulk changes (find and replace, undo) about 60 ms slower.
- `scripts/shared-smoke.mjs` checks it at 6× with 1,500 blocks. Measured: whole-script copy
  7–8 ms, one block 0–2 ms, about 3–5 ms more per typed character, no added long tasks.

## Relay

`relay/` is the sharing service: a Cloudflare Worker with one Durable Object per shared
project (a room). See `relay/README.md` to run or deploy it. The rules are in
`relay/src/room.js`, which has no Cloudflare in it and is tested in Node.

- There are no accounts. The owner is whoever starts sharing and holds the owner key.
  Each link has its own key pair and a role: `edit`, `review` or `comment`.
- The owner signs the list of links. Each entry has the link's public key and its box: the
  project key and link key, encrypted with the link's secret and password. The secret stays
  in the link's `#` part, so it never reaches the relay.
- Signing in: the relay sends a challenge. The client signs it with the owner key or its
  link key. Before that, a client may fetch its link's box to get that key.
- The project is three Yjs documents, each with its own writers. The relay refuses other
  writes, and clients check the signatures again.

  | Document | Who writes it |
  |---|---|
  | `script` | owner, edit |
  | `comments` | owner, edit, review, comment |
  | `review` (block edits for Pending review) | owner, edit, review |

- Changes are numbered in order and kept. A writer can send a snapshot of a document up to
  a change; the changes before it are then dropped.
- Turning a link off: the owner sends a new signed list, with that link marked off and its
  box removed. Its sockets close, and it can't sign in again. It stays on the list so the
  changes it made still check out for people who open the project later. It keeps
  whatever it already copied, and the project key doesn't change yet.
- The relay sees room ids, link ids and roles, sizes and times. It never sees text, names
  or titles.
- A room nobody opens for 180 days is deleted. The owner can delete it at once.

### The app on the relay, behind the developer setting

- The shared copy is two Yjs documents, `script` and `comments`, so the relay can tell
  them apart. Undo keeps a mark in each.
- `sharekeys.js` makes the keys, links and boxes with Web Crypto. Each change is encrypted
  with AES-GCM, bound to its room and document, then signed with Ed25519. Passwords are
  stretched with PBKDF2 (600,000 rounds).
- `relayclient.js` sends this person's changes and puts in others' once their signature
  and role check out. It reconnects by itself and keeps changes made offline until the
  relay has them. It tries again at once when the browser is back online, and gives up
  on an attempt that hangs for 20 seconds. After 200 changes to a document it sends the
  whole document.
- `sharing.js` keeps what this browser needs for each shared project in its storage, under
  `scribecue.share.<project id>`, so it opens again without the password.
- The shared copy is kept in IndexedDB (`shared:<project id>`) between visits, with its
  room. A copy kept for another room is ignored, and joining clears it. Without one, a
  person who joined takes the relay's copy rather than starting a rival one.
- The relay is at `wss://share.kyleadvoice.ca`. The developer setting `scribecue.relay`
  points elsewhere, such as `ws://127.0.0.1:8787` for `npm run dev` in `relay/`. The CSP
  allows both.

### Share dialog

- With the developer setting on, the header has **Share** (not in Record mode) and a tag
  that says Shared, Connecting or Offline. Code is in `sharedialog.js`.
- The owner makes one link per role, each with a password of at least 6 characters. A new
  link for a role replaces the old one. **Turn off** stops a link; its users keep their copy.
  **Stop sharing** deletes the relay's copy; the owner's stays as a plain project.
- Opening a link asks for its password and the person's name. Can edit opens in Write; Can
  review and Can comment open in QC. The link leaves the address bar once used.
- Someone who joined can **Leave**: their copy stays as a project of its own.
- Links changed while offline reach the relay on reconnecting.
- `scripts/relay-share-smoke.mjs` runs two browsers at 6× with 1,500 blocks through a
  local relay and the dialogs. Measured: sharing 0.8–1.1 s, joining 0.7–1 s, typing
  17–20 ms a character, a change reaching the other person in about 0.25 s, no long tasks
  beyond the app's own start.

### Reviewers and commenters

- The shared copy has a third document, `review`: suggested block changes, one per block,
  under `proposals`. Each has the reviewer's link, name, editor id and the block as they
  want it (or `null` to remove it).
- Can review: works in QC only. Block edits go into `review`, never the script; their own
  suggestions show in their copy on top of the script. Comments reach everyone at once.
- Can comment: QC only, comments only. Their block changes go nowhere.
- The owner and Can edit see suggestions in Pending review, in Write as well as QC, as they
  arrive. **Apply choices** puts accepted ones in the script, credited to the reviewer, and
  clears every chosen one for everyone. A suggestion that changes needs choosing again.
- A returned QC review comes first: suggestions wait while one is open.
- In a shared project, "Edited by" shows from the start.
- `scripts/relay-review-smoke.mjs` runs a reviewer and a commenter against an owner at 6×
  with 1,500 blocks. Measured: a suggestion reached the owner within 1 s of starting to
  type; no long tasks over 75 ms for the owner.

### Still to do

- User guides, once sharing is switched on for everyone.
- Before calling it end-to-end encrypted: get the key handling reviewed. Decide on a new
  project key when a link is turned off. A link turned off still has its signing key, so a
  dishonest relay could add changes signed by it. Rate-limit new rooms at Cloudflare.
- Keep file exports and recovery usable without the relay.

## Validation

- `scripts/check.sh`: syntax, pure-function tests, Python tests, Chrome's check of the file pickers and Docker smoke checks.
- `scripts/qc-review-smoke.mjs <DevTools port> <site URL> [screenshot path]` exercises the
  QC entry point, Pending review choices and edits, the timeline outline, audio
  preservation, stale readings, permissions, failed and cancelled writes, undo, and layout
  at 6× CPU slowdown in muted headless Chrome.
- `scripts/author-review-smoke.mjs <port> <site URL> [screenshot path]` checks author
  acceptance, ordinary saves and Save As, recovery, locating missing readings and unchanged
  reviewer restrictions at 6× slowdown.
- `scripts/collaboration-smoke.mjs <port> <site URL> [test-video.mp4]` checks identity
  persistence, split/merge/undo and worker comparison of 1,500 blocks covering two hours.
- `node --test tests/relay.test.mjs tests/relayclient.test.mjs tests/sharekeys.test.mjs`
  checks the relay's rules, the connection and the keys. `scripts/relay-smoke.mjs`
  runs them over real WebSockets against `npm run dev` in `relay/`.
- `scripts/qcspeech-smoke.mjs <port> <site URL> [screenshot path]` checks personal-key
  priority, accepted/declined fallback, cached replay, recovery and key-free returns at 6×.
  It stubs Google responses; no live credentials or paid requests are used.
- `scripts/screenshots.sh` captures the QC comparison and runs the existing comments
  and QC playback/export smoke checks with Piper available.
