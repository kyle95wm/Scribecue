# Handoff

Notes for whoever picks up Scribecue next. Written 2026-10-31.

Read `CLAUDE.local.md` first. It has the rules for checks, slower computers, docs, design,
screenshots and releases. This file only adds what isn't there.

## Where things stand

- **Release version:** 0.65.0. QC mode, portable packages and optional edits are unreleased.
- **QC mode:** editing starts off. Allow edits enables manual block corrections, voices,
  speeds, timing changes and undo. No automatic timing fitting runs in QC. Permission resets
  when changing modes, opening a project or reloading. Comments, block Comment
  buttons and timeline comment markers appear only in QC. Write and Transcribe keep editing.
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
- Full checks passed (263 Node tests, 17 Python tests and Docker). The local Docker app
  was rebuilt and verified; all six services remain running. Screenshots include QC playback, editing with comments, and package dialogs.
- Browser checks at 6× CPU slowdown: 5,000 comments rendered 50 at a time, 60 fps, no dropped
  video frames or long tasks over five seconds; comment typing 7.4 ms. QC text editing with 720 blocks took 8.8 ms. A synthetic two-hour package
  (720 two-second readings, 46.2 MB) streamed in 500 ms, timer max gap 17 ms. JS heap after
  import/comment resave was about 4 MB. Actual Piper packaging and original playback passed
  without synthesis requests during playback. These are short samples, not full-film playback.
- `scripts/qc-smoke.mjs` covers mode visibility, opt-in editing, fixed automatic timings, missing voices, real Piper
  export, worker import, original playback, comment resave, recovery, stale/previous readings and undo.
  `scripts/comments-smoke.mjs` covers comment CRUD, attachments, undo and playback stress.
- `Guides/QC.md` now covers the dedicated workflow, voice differences and package handoffs.
  Getting started, Writing, Voices, Shortcuts and README were updated. QC guide grew to
  explain packaging restrictions, original versus approximate playback and stale audio.
  The editing section grew to explain permission, unchanged timing behavior,
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
