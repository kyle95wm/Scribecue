# Handoff

Notes for whoever picks up Scribecue next. Written 2026-10-31.

Read `CLAUDE.local.md` first. It has the rules for checks, slower computers, docs, design,
screenshots and releases. This file only adds what isn't there.

## Where things stand

- **Release version:** 0.66.2. New is available in QC, with a save choice before starting fresh.
  The previous release was 0.66.1, which moved editing permission to package creation.
- **Leaving QC:** New is available in QC. It offers a fresh project, with Save and start
  or explicit Start without saving for unsaved changes. Cancelled/failed saves keep the review
  open. New closes the video, clears package state and undo history, and enters Write mode.
  The guide and screenshots cover leaving a review. Tests cover both package permissions,
  save cancellation, comment preservation, fresh mode switching and browser recovery.
  Full checks passed (270 Node tests, 17 Python tests and Docker). Browser checks at 6× CPU
  slowdown passed: 60 fps, no dropped frames or long tasks, 720-reading package export
  in 538 ms with a 17 ms maximum timer gap, about 5 MB JS heap after import/save.
  Local Docker includes the fix. Full-film playback was not tested.
- **QC editing permissions:** the package creator chooses whether reviewers may edit in
  Export → QC package. Default is comments only. QC has a status label, not an editing toggle.
  Permission stays in the package manifest when saving and after browser recovery. Older
  packages without permission default to comments only. New manifests use review version 2,
  so older apps request an update instead of ignoring permissions. Plain projects stay read-only in QC.
- Comments-only packages cannot switch to an editing mode or be re-exported with different
  permissions through the UI. Editable packages retain the existing manual editing controls.
  Comments and their timeline markers remain exclusive to QC. Automatic timing fitting stays off.
- First-run setup offers QC review directly, with its own steps and key hints.
- Missing main or block voices open a project in QC with saved timings preserved. QC playback
  offers programme sound, original packaged readings, or an explicitly chosen approximate preview.
- **QC packages:** Export → QC package creates `.scribecueqc` with the project and individual
  original WAV readings. Piper, Kokoro and Google Cloud support packaging; browser voices do not.
  Reviewers need no voices or keys. Send the matching video separately.
- Saving comments keeps original audio. Moving/resizing blocks reuses the audio
  and flags overruns. Text, pronunciation, speed, voice or note-reading changes invalidate it.
  Hear previous reading plays stale audio alone, with programme playback paused.
  QC never silently substitutes it.
- Packaging streams to temporary browser disk storage with progress and cancellation. Metadata
  opens in a worker. Playback slices only active readings, including overlapping tails. Browser
  recovery keeps the source package in IndexedDB; saving is blocked if its audio is unavailable.
- Full checks passed (267 Node tests, 17 Python tests and Docker). The local Docker app
  was rebuilt and verified; all six services remain running. Screenshots include QC playback, editing with comments, and package dialogs.
- Browser checks at 6× CPU slowdown: 5,000 comments rendered 50 at a time, 60 fps, no dropped
  video frames or long tasks over five seconds; comment typing 4.2 ms. QC text editing with 720 blocks took 9.9 ms. A synthetic two-hour package
  (720 two-second readings, 46.2 MB) streamed in 553 ms, timer max gap 17 ms. JS heap after
  import/comment resave was about 4 MB. Actual Piper packaging and original playback passed
  without synthesis requests during playback. These are short samples, not full-film playback.
- `scripts/qc-smoke.mjs` covers mode visibility, creator-selected editing permissions, fixed automatic timings, missing voices, real Piper
  export, worker import, original playback, comment resave, recovery, stale/previous readings and undo.
  `scripts/comments-smoke.mjs` covers comment CRUD, attachments, undo and playback stress.
- `Guides/QC.md` now covers the dedicated workflow, voice differences and package handoffs.
  Getting started, Writing, Voices, Shortcuts and README were updated. QC guide grew to
  explain packaging restrictions, original versus approximate playback and stale audio.
  The editing section grew to explain creation-time permission, unchanged timing behavior,
  old audio and regeneration after corrections.
- Package blocks keep `qcReading` (audio offset) for old-reading lookup after edits. New
  exports discard old offsets. Older timing-based package keys are normalized on load.
- Main modules: `qc.js` (package/voice/recovery helpers), `qc-worker.js`, `qcplayer.js`,
  `qcdrawer.js`, `comments.js` and `commentsdrawer.js`. Pure tests are in `tests/qc*.test.mjs`.

## Last change: Mac voices (0.64.2)

- On a Mac, Chrome lists a voice twice when it has a standard and an Enhanced version.
  Both copies have the same name and `voiceURI`. `pickVoices` in `app/js/tts.js` now keeps
  one.
- Chrome adds the language to some Mac voice names, as in "Eddy (English (United
  Kingdom))". `voiceTitle` strips it for menus and toasts, since the menu shows the
  language already. The saved `voiceURI` is unchanged, so old projects still find their
  voice.
- Browsers can't use the Mac's Enhanced or Premium voices. Chrome can't tell them apart,
  and Safari doesn't list them. `Guides/VOICES.md` now says so and points to Piper or
  Kokoro. Don't promise a fix in the app.
- Not checked: Safari's own voice list. Reading it needs "Allow JavaScript from Apple
  Events" in Safari's settings, which was left off.

## Testing tips

- **Muted browsers:** launch every Chrome you drive with `--mute-audio`. The demo video's
  noise once came out of Kyle's speakers.
- **Mac voices:** headless Chrome lists only Google's online voices. To see the system
  voices, run Chrome with a window (move it off screen with `--window-position`), or use
  an in-app browser.
- **Local copy:** `docker compose up -d` serves the app at <http://localhost:8484/>. For a
  quick look at unbuilt changes, serve `app/` with `python3 -m http.server`.

## Docs habits Kyle has asked for

- Name keys the same way on every platform, like `Ctrl/Cmd+S` and `Alt+Shift+V`, not ⌘ ⌥ ⇧.
- Give steps for each OS only where they really differ, such as installing voices. Cover
  Windows and Linux too, not only Mac.

## Ideas that were set aside

- **Record mode** (narrators recording takes) shipped in 0.63.0 and has had fixes since.
  Its design choices: raw audio with no processing, peaks aimed at −10 dBFS, and a mono
  48 kHz 24-bit Broadcast WAV with a marker per block. Keep to them unless Kyle changes
  them.
