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
  that round's starting point. Independent changes combine. Same-block edits and deletion
  versus editing need a choice. Block comments merge separately from script corrections,
  so a returned comment cannot revert an author’s independent text or timing change.
  Simultaneous changes to the same comment list still need an explicit choice.
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
- Cancelled or failed writes keep the live project and conflict decisions. Generation
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
  only working saves opt in. Save return package, combined packages and author audio
  attachments leave it out. Neither returned projects nor author JSON hold the key.

## Next: optional sharing service

Invitations and access would belong to the project. Reviewers work in QC, writers in
Write, narrators in Record. Do not introduce another parallel review mode or handoff UI.

Before adding that service:

- Give comments stable identities for safe merging of concurrent reviews.
- Define durable revision storage and ancestry. Bounded file baselines are not a server history.
- Use established authentication components for users, devices, invitations and membership.
- Check current membership and action permissions on every server operation.
- Separate script, comment and recording writes. With encrypted content, the service
  cannot inspect a payload to determine whether a reviewer changed a script. Bind scopes
  to signed operations and validate them on receiving clients too.
- Choose a reviewed encryption protocol and libraries. Specify device verification,
  recovery and key rotation before promising end-to-end encryption.
- Removing a member must block future writes and key access. It cannot erase old copies.
- Keep project content and titles out of service logs. State what metadata remains visible.
- Sync only an explicit project payload, without provider keys, device handles or local paths.
- Keep file exports and recovery usable without the service.

## Validation

- `scripts/check.sh`: syntax, pure-function tests, Python tests and Docker smoke checks.
- `scripts/qc-review-smoke.mjs <DevTools port> <site URL> [screenshot path]` exercises the
  QC entry point, conflicts, audio preservation, stale readings, permissions, failed and
  cancelled writes, undo, and dialog layout at 6× CPU slowdown in muted headless Chrome.
- `scripts/author-review-smoke.mjs <port> <site URL> [screenshot path]` checks author
  acceptance, ordinary saves and Save As, recovery, locating missing readings and unchanged
  reviewer restrictions at 6× slowdown.
- `scripts/collaboration-smoke.mjs <port> <site URL> [test-video.mp4]` checks identity
  persistence, split/merge/undo and worker comparison of 1,500 blocks covering two hours.
- `scripts/qcspeech-smoke.mjs <port> <site URL> [screenshot path]` checks personal-key
  priority, accepted/declined fallback, cached replay, recovery and key-free returns at 6×.
  It stubs Google responses; no live credentials or paid requests are used.
- `scripts/screenshots.sh` captures the QC comparison and runs the existing comments
  and QC playback/export smoke checks with Piper available.
