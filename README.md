# Scribecue — keyboard-first subtitle and audio description editor

Scribecue is a browser-based editor for subtitles and audio description scripts that runs
entirely on your machine. Video, audio and subtitle files are opened straight from disk
with `blob:` URLs and are never uploaded. The container only serves static files and is
bound to `127.0.0.1`. A strict CSP stops the page from talking to any other origin.

## Run

```bash
docker compose up -d --build
```

Then open <http://localhost:8484>. Stop it with `docker compose down`.
To use another port, run `SCRIBECUE_PORT=9000 docker compose up -d`.

## Workflow

1. Press `⌘/Ctrl+⇧O` to open a video or audio file, or drop it on the window. A waveform
   is built from the audio track.
2. Press `⌘/Ctrl+O` to open an existing `.srt` / `.vtt` file, or start from nothing.
3. Move with `←` `→` (one frame), `⇧←` `⇧→` (3 s) and `⌥⇧←` `⌥⇧→` (previous / next block).
4. Press `↵` to create a block at the playhead, or to edit the block under it. Type, then
   press `Esc` or `↵` to go back to the timeline.
5. Export with `⌘/Ctrl+S` (SRT) or `⌘/Ctrl+⇧S` (VTT).

The waveform is built in the background by streaming the audio track from disk, so files of
any size work and it fills in as it goes. This covers MP4 / MOV / M4A, MKV / WebM and WAV
with AAC, Opus, Vorbis, FLAC, MP3 or PCM audio. Other formats fall back to decoding the
whole file in memory, which only works for files under 2 GB. AC-3, E-AC-3, DTS and TrueHD
audio can't be decoded by browsers, so those files play without a waveform.

### Files with several audio tracks

If a file has more than one audio track (for example the original mix and an audio
description mix), an **Audio** picker appears under the video. Press `T` / `⇧T` to step
through the tracks. The waveform always shows the chosen track. A track marked as audio
description (Matroska's visually-impaired flag, an MP4 `kind` box, or a name containing
"description", "AD" or "narration") is picked automatically.

Chrome and Firefox can only play a video's default audio track, so the editor copies the
chosen track out, without re-encoding, into an audio-only file in memory. It plays that file
alongside the muted video and keeps the two in step. Each track is copied once per session,
so switching back and forth afterwards is instant. Safari switches tracks natively.

Tracks can be copied out from AAC, Opus, FLAC, MP3 and PCM audio. Vorbis tracks show a
waveform but can't be played on their own. AC-3, E-AC-3, DTS and TrueHD tracks can't be
decoded by browsers, so they get neither.

Work is autosaved to the browser's localStorage, so a reload restores your blocks. You
need to reopen the media file after a reload.

## Keys

The keyboard layout follows the
[Frazier Mac cheat sheet](https://www.videotovoice.com/docs/en/cheatsheet/mac.html)
(see [Credits](#credits); this project isn't affiliated with Frazier).
Press `?` or `⇧O` in the app for the full list.

### Timeline (Frazier)

| Key | Action |
| --- | --- |
| `Space` | Start / stop video |
| `←` `→` | One frame back / forward |
| `⇧←` `⇧→` | Three seconds back / forward |
| `⌥⇧←` `⌥⇧→` | Previous / next text block |
| `Fn←` `Fn→` (Home / End) | Beginning / end of video |
| `⌥⇧J` | Jump to a timecode (`hh:mm:ss.mmm`, `hh:mm:ss:ff`, `mm:ss` or seconds) |
| `⇧F` | Quick navigation: search blocks by text or number |
| `⇧O` | Options / shortcut overlay |
| `+` `-` | Increase / reduce speed |
| `↵` | Create or edit text block |
| `⌥⇧D` | Delete text block (after confirmation) |
| `Esc` | Leave the editor and return to the timeline |

### Block editor (Frazier)

| Key | Action |
| --- | --- |
| `⇥` `⇧⇥` | Next / previous field (text → IN → OUT) |
| `Esc` or `↵` | Close the editor and focus the timeline |
| `↑` `↓` | Previous / next block (from the first / last line of text) |
| `⌥⇧←` `⌥⇧→` | Move the block one frame back / forward |
| `⌥⇧D` | Delete text block (after confirmation) |
| `⇧↵` | New line |
| `⌘B` `⌘I` `⌘U` | Bold / italic / underline (`<b>` `<i>` `<u>` tags) |
| `⌘Z` `⌘⇧Z` | Undo / redo |

### Subtitle extras (on keys Frazier leaves free)

| Key | Action |
| --- | --- |
| `↑` `↓` / `K` `J` | Previous / next block |
| `⇧Space` | Play the selected block only |
| `N` | New block at the playhead |
| `A` / `S` | Set start / end to the playhead |
| `Q` `W` / `E` `R` | Nudge start / end by ∓100 ms (`⇧` 10 ms) |
| `,` `.` | Move the whole block by ∓100 ms (`⇧` 10 ms) |
| `X` / `M` / `Del` | Split at the playhead / merge with next / delete without asking |
| `C` | Select the block under the playhead |
| `T` / `⇧T` | Next / previous audio track |
| `/` | Search the block list: `↑` `↓` step through matches, `↵` returns to the timeline, `Esc` clears |
| Hold `H` | Hold-to-mark: hold while the narrator speaks to create a block (see below) |
| `⇧H` | Change the hold-to-mark reaction offset (0–300 ms) |
| `L` | Loop the block under the playhead (or the selected one) and play it. Press `↵` to type while it repeats; `Esc` when you're done ends the loop. `L` again stops it |
| `O` / `F` / `B` | Toggle loop (stays on until you turn it off) / follow playhead / all snapping (dragging and hold-to-mark; remembered) |
| `I` | Show / hide reading speed (CPS) |
| `⌥=` `⌥-` `⌥0` | Zoom the timeline in / out / to fit |
| `\` | Reset speed to 1× |

Frazier features with no subtitle equivalent are not included: glossaries, snippets,
markers, comments, pronunciation, extended audio description and instruction or pause
marks. Their keys show a short notice instead of doing something else.

On the timeline, drag a block to move it and drag either edge to resize it. Drag across
empty space to draw a new block. Hold `⌥` while dragging to turn snapping off. Scroll to
pan, and use `⌘/Ctrl`+scroll or pinch to zoom.

### Hold-to-mark

For transcribing existing audio description at its original timing:

1. Play the file with the description track selected.
2. Hold `H` while the narrator speaks a line. A dashed block grows on the timeline.
3. Let go when they stop. Playback pauses and the new block opens for typing.
4. Type the line and press `↵` or `Esc`. Playback carries on from where it paused.

Both edges move back by a reaction offset (200 ms to begin with), because key presses lag
what you hear. `⇧H` or clicking `H −200ms` under the video changes it, and the choice is
remembered. The edges then snap to the nearest point within 300 ms where the waveform
rises (start) or falls (end) sharply, so they land on the narrator rather than on your
key press. `B`, or clicking `SNAP` under the video, turns all snapping off and on: this and the
snapping when you drag blocks. The choice is remembered. Holding `⌥` as you let go skips
it for just that block. If you pause
first and then hold `H`, the block starts where you paused, with no offset; turn snapping
off to keep it exactly there. A mark never overlaps an existing block; it's trimmed to fit the gap.

The search box above the list filters blocks by text, or by number with `#12`. Matches are
highlighted, and blocks that don't match are dimmed on the timeline.

The CPS column turns amber above 17 characters per second and red above 21. Press `I`, or
click `CPS` under the video, to hide the reading speed from the list and editor; the choice
is remembered.

## Development without Docker

The app is plain static files with no build step:

```bash
python3 -m http.server -d app 8484
```

## Credits

The keyboard layout is modelled on [Frazier](https://www.videotovoice.com/) by
videotovoice, an audio description tool, so writers who already know Frazier can switch
between the two without relearning keys. Thanks to the Frazier team for publishing their
shortcut cheat sheet.

This project is independent. It is not affiliated with, endorsed by or connected to
Frazier or videotovoice. Frazier is their product name, used here only to describe the
keyboard layout.

## License

[MIT](LICENSE)
