# Handoff

Notes for whoever picks up Scribecue next. Written 2026-10-31.

Read `CLAUDE.local.md` first. It has the rules for checks, slower computers, docs, design,
screenshots and releases. This file only adds what isn't there.

## Where things stand

- **Last release:** 0.64.2 (commit `180a483`), live on GitHub and at
  <https://scribecue.kyleadvoice.ca/>. Checks and Publish web app both passed.
- **Ready for the next release:** QC comments on blocks and timeline times, with a
  dedicated Comments drawer. Each open block has a Comment button. Reviewer names are
  optional and remembered in the browser. Projects keep the comments for handoff.
- Comments can be edited, deleted, resolved and reopened. Block comments follow timing
  changes; merging keeps both blocks' comments. Splitting leaves comments on the first half.
- Checks passed: `scripts/check.sh`, including Docker, and `scripts/screenshots.sh`,
  including the browser regression checks. Screenshots were refreshed with Piper.
- At 6× CPU slowdown, a five-second playback sample with 5,000 comments measured 60 fps,
  no dropped video frames and no long tasks. Typing took about 0.1 ms; the reported JS heap
  was about 3.3 MB. Only 50 comments are rendered at once.
- Not measured: full two-hour playback, TTS onset timing, and long export jobs.
- Main files: `app/js/comments.js`, `app/js/commentsdrawer.js`, `tests/comments.test.mjs`
  and `scripts/comments-smoke.mjs`. The getting started guide covers the QC workflow.

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
