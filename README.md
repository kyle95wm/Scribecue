# Scribecue

**A keyboard-first editor for subtitles and audio description scripts.**

- Runs on your own computer in Docker. Your files are never uploaded.
- Uses the same keyboard layout as Frazier, so Frazier users don't need to relearn keys.
- Built for transcribing existing audio description at its original timing: hold a key
  while the narrator speaks and a block appears.

![Scribecue with a video, its audio description track and five text blocks on the timeline](docs/screenshots/main.png)

## Contents

- [Getting started](#getting-started)
- [Your first script](#your-first-script)
- [Transcribing audio description](#transcribing-audio-description)
  - [Hold-to-mark](#hold-to-mark)
  - [Looping a block](#looping-a-block)
  - [Text to speech](#text-to-speech)
- [Files with several audio tracks](#files-with-several-audio-tracks)
- [Other handy features](#other-handy-features)
- [Keyboard shortcuts](#keyboard-shortcuts)
  - [Windows and Linux](#windows-and-linux)
- [Supported files](#supported-files)
- [Privacy](#privacy)
- [Updating](#updating)
- [Development](#development)
- [Credits](#credits)
- [License](#license)

## Getting started

You need [Docker](https://www.docker.com/products/docker-desktop/) and a recent
Chrome or Edge.

1. Download Scribecue:

   ```bash
   git clone https://github.com/kyle95wm/Scribecue.git
   ```

2. Start it from the `Scribecue` folder:

   ```bash
   docker compose up -d --build
   ```

3. Open <http://localhost:8484>.

To stop it, run `docker compose down`. To use a different port, start it with
`SCRIBECUE_PORT=9000 docker compose up -d`.

## Your first script

1. **Open a video or audio file** with `⌘/Ctrl+⇧O`, or drop it on the window. A waveform
   of the audio appears on the timeline.
2. **Open existing subtitles** with `⌘/Ctrl+O` (`.srt` or `.vtt`), or start from nothing.
3. **Move around** with `←` `→` (one frame), `⇧←` `⇧→` (3 seconds) and `⌥⇧←` `⌥⇧→`
   (previous / next block).
4. **Write** by pressing `↵`. This creates a block at the playhead, or edits the block
   already there. Press `Esc` or `↵` when you're done.
5. **Export** with `⌘/Ctrl+S` (SRT) or `⌘/Ctrl+⇧S` (VTT).

Your work is saved in the browser as you go, so reloading the page keeps your blocks.
You'll need to reopen the media file after a reload.

Press `?` at any time to see every shortcut.

## Transcribing audio description

### Hold-to-mark

![Hold-to-mark: a dashed block grows on the timeline while H is held](docs/screenshots/hold-to-mark.png)

1. Play the file with the description track selected.
2. **Hold `H`** while the narrator speaks a line. A dashed block grows on the timeline.
3. **Let go** when they stop. Playback pauses and the new block opens for typing.
4. Type the line and press `↵` or `Esc`. Playback carries on.

Scribecue tidies up the timing for you:

| | What happens | Change it with |
| --- | --- | --- |
| **Reaction offset** | Both edges move back 200 ms, because your key press comes a moment after you hear the voice. | `⇧H`, or click `H −200ms` under the video (0–300 ms) |
| **Snapping** | Each edge moves to where the waveform rises or falls sharply within 300 ms, so it lands on the narrator, not your key press. | `B`, or click `SNAP` (turns off all snapping, including when dragging). Hold `⌥` as you let go to skip it once |
| **Starting from pause** | If you pause first and then hold `H`, the block starts exactly where you paused, with no offset. | Turn snapping off to keep it exactly there |
| **No overlaps** | A new block is trimmed to fit the gap it starts in. | |

Your offset and snapping choices are remembered.

### Looping a block

Press `L`, or click the loop button under the video, to loop the block under the playhead
(or the selected block). Press `↵` to type
while it repeats, then `Esc` when you're done, and the loop stops. Press `L` again to stop
it without editing.

For a loop that stays on until you turn it off, use `O` instead.

### Text to speech

Hear your lines read aloud, to check where each one sits and whether it fits before the
next piece of dialogue. It's off until you turn it on: press `⌥⇧V`, or click `TTS` under
the video, then tick **Turn on text to speech**.

![The text to speech panel, with voice, speed and Update all timings](docs/screenshots/text-to-speech.png)

| Key | Action |
| --- | --- |
| `V` | Read the block from its start, with the video playing. Playback stops at the block's end, or where the reading ends if it runs over |
| `⇧V` | Read the block, then set its end to where the reading finishes |
| `[` `]` | Make the selected block's reading slower / faster |
| `⌥⇧V` | Choose the voice and speed |

- **Speed:** very slow (−30%), slow (−15%), normal, fast (+15%), very fast (+30%), and
  experimental +50% and +100%. The voice also follows the playback speed.
- **Speed per block:** set a block's own speed with `[` `]` or the **TTS** menu in the
  block editor. Blocks with their own speed show it in the list and on the timeline, such
  as `+15%`. The rest follow the overall speed. Setting a block back to the overall speed
  makes it follow that again. Block speeds are saved with your work and in exported VTT
  files, as notes that other programs ignore. SRT files can't store them.
- **Read blocks aloud while playing:** each block is read as the playhead reaches it,
  with the original audio turned down. You can turn either part off.
- **Ends set from the reading:** while text to speech is on, a new block made with `↵` or
  `N` takes its end from how long the reading takes, and keeps following it as you type
  or change the speed. An `auto` tag next to OUT shows this. It never runs into the next
  block. Once you set the end yourself, by dragging, `S`, `E` / `R` or typing in OUT,
  the block keeps it. Blocks marked with `H`, drawn on the timeline or opened from a file
  are never changed. You can turn this off in the text to speech panel.
- **Update all timings:** a button in the text to speech panel sets the end of every block
  with text from its reading, using each block's own speed. It asks first, because it also
  changes blocks marked with `H` or opened from a file, and `⌘Z` undoes it. Ends never run
  into the next block. Tick **Read each block silently first** for exact lengths. That
  takes about as long as reading them all, shows its progress, and can be stopped.
- **Timing check:** the editor shows how long the reading takes, such as `TTS 2.9 s`, in red
  if it's longer than the block, and the list shows that block's duration in red. `~`
  means it's an estimate. It becomes exact once the
  block has been read, and the estimates get more accurate for a voice as you use it.

Scribecue uses the voices built into your computer, so the text stays on it. macOS and
Windows come with several voices. Linux may need speech voices installed.

**Online voices** are a separate opt-in in the same panel. They often sound more natural,
but each block's text is sent to the company that runs the voice, such as Google or
Microsoft, to be spoken. Leave them off if your script mustn't leave your computer.
They come from the browser, so which ones you get depends on where you open Scribecue:
Microsoft Edge has dozens, Chrome has a few Google voices, and Safari and Firefox have
none. They only work while you're online.

For better voices that stay on a Mac, open System Settings → Accessibility → Spoken
Content, click ⓘ next to **System voice**, and download an "Enhanced" or "Premium" voice.
Then reload Scribecue. Not every browser lists these newer voices.

Text to speech is for checking timing. It doesn't create an audio file.

## Files with several audio tracks

When a file has more than one audio track, such as the original mix and an audio
description mix, an **Audio** picker appears under the video. Press `T` / `⇧T` to switch
tracks. The waveform always shows the track you're hearing.

A track marked as audio description is picked automatically. Scribecue looks for
Matroska's visually-impaired flag, an MP4 `kind` box, or a name containing "description",
"AD" or "narration".

<details>
<summary>How track switching works</summary>

Chrome and Firefox can only play a video's default audio track. So Scribecue copies the
chosen track out, without re-encoding, into an audio-only file in memory, and plays it in
step with the muted video. Each track is copied once per session, so switching back
afterwards is instant. Safari switches tracks itself.

</details>

## Other handy features

- **Search:** the box above the list filters blocks by text, or by number with `#12`.
  Press `/` to jump to it. `⇧F` opens quick navigation, and `⌥⇧J` jumps to a timecode.
- **Reading speed:** the CPS column turns amber above 17 characters per second and red
  above 21. Press `I`, or click `CPS`, to hide it.
- **Player controls:** the buttons under the video step to the previous or next block,
  jump 3 seconds or one frame, play or pause, play just the selected block, and loop the
  block under the playhead. Hover over one to see its key.
- **Copy a timecode:** click the clock under the video. To set a block's start or end to
  the playhead, press `A` or `S`.
- **Mouse:** drag a block to move it, drag an edge to resize it, or drag across empty
  space to draw a new block. Scroll to pan, and `⌘/Ctrl`+scroll or pinch to zoom.

## Keyboard shortcuts

![The keyboard shortcuts overlay](docs/screenshots/shortcuts.png)

The layout follows the
[Frazier Mac cheat sheet](https://www.videotovoice.com/docs/en/cheatsheet/mac.html).
The tables use Mac symbols; on Windows and Linux, see [below](#windows-and-linux).

<details open>
<summary><strong>Timeline</strong></summary>

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` `→` | One frame back / forward |
| `⇧←` `⇧→` | Three seconds back / forward |
| `⌥⇧←` `⌥⇧→` | Previous / next block |
| `Fn←` `Fn→` (Home / End) | Beginning / end of the video |
| `⌥⇧J` | Jump to a timecode (`hh:mm:ss.mmm`, `hh:mm:ss:ff`, `mm:ss` or seconds) |
| `⇧F` | Quick navigation: find a block by text or number |
| `+` `-` | Faster / slower playback |
| `↵` | Create or edit a block |
| `⌥⇧D` | Delete a block (asks first) |
| `⇧O` or `?` | Show all shortcuts |

</details>

<details open>
<summary><strong>Block editor</strong></summary>

| Key | Action |
| --- | --- |
| `⇥` `⇧⇥` | Next / previous field (text → IN → OUT) |
| `Esc` or `↵` | Close the editor |
| `⇧↵` | New line |
| `↑` `↓` | Previous / next block (from the first / last line) |
| `⌥⇧←` `⌥⇧→` | Move the block one frame back / forward |
| `⌥Space` | Play / pause while typing |
| `⌘B` `⌘I` `⌘U` | Bold / italic / underline |
| `⌘Z` `⌘⇧Z` | Undo / redo |

</details>

<details open>
<summary><strong>Extras</strong> (on keys Frazier leaves free)</summary>

| Key | Action |
| --- | --- |
| Hold `H` | [Hold-to-mark](#hold-to-mark) a block while the narrator speaks |
| `⇧H` | Change the hold-to-mark reaction offset |
| `L` | [Loop this block](#looping-a-block) until you finish editing it |
| `N` | New block at the playhead |
| `A` / `S` | Set start / end to the playhead |
| `Q` `W` | Start −/+ 100 ms (with `⇧`: 10 ms) |
| `E` `R` | End −/+ 100 ms (with `⇧`: 10 ms) |
| `,` `.` | Move the block −/+ 100 ms (with `⇧`: 10 ms) |
| `X` / `M` | Split at the playhead / merge with the next block |
| `Del` | Delete the block straight away (undo with `⌘Z`) |
| `↑` `↓` or `K` `J` | Previous / next block |
| `PgUp` `PgDn` | Jump 10 blocks |
| `G` / `⇧G` | Playhead to the block's start / end |
| `C` | Select the block under the playhead |
| `⇧Space` | Play just the selected block |
| `T` / `⇧T` | Next / previous audio track |
| `/` | Search the block list |
| `O` | Loop on / off |
| `F` | Follow the playhead on / off |
| `B` | Snapping on / off |
| `I` | Reading speed (CPS) on / off |
| `V` / `⇧V` | [Read the block aloud](#text-to-speech) / fit the block to the reading |
| `[` `]` | Make the block's reading slower / faster |
| `⌥⇧V` | Text to speech settings |
| `⌥=` `⌥-` `⌥0` | Zoom the timeline in / out / to fit |
| `\` | Reset speed to 1× |

</details>

### Windows and Linux

The keys are in the same places. Scribecue shows them with Windows and Linux names in the
app, so the shortcuts overlay and tooltips say `Ctrl`, `Alt` and `Shift`.

| On a Mac | On Windows and Linux |
| --- | --- |
| `⌘` | `Ctrl` |
| `⌥` (Option) | `Alt` |
| `⇧` | `Shift` |
| `Fn←` `Fn→` | `Home` `End` |

A few keys are different, to avoid clashes with the system:

- **Play / pause while typing** is `Ctrl+Space`, because Windows keeps `Alt+Space` for the
  window menu.
- **Turning snapping off for one drag or mark:** hold `Alt` or `Ctrl`. Some Linux desktops
  move the whole window when you drag with `Alt` held.

If `Alt+Shift` switches your keyboard layout on Windows, the block shortcuts still have
other keys: `↑` `↓` or `K` `J` for previous / next block, and `Del` to delete. You can also
drop a media file on the window instead of pressing `Ctrl+Shift+O`.

Frazier features with no subtitle equivalent aren't included: glossaries, snippets,
markers, comments, pronunciation, extended audio description, and instruction or pause
marks. Their keys show a short notice instead.

## Supported files

| | Supported |
| --- | --- |
| **Subtitles** | SRT and WebVTT, to open and to export |
| **Video and audio** | MP4, MOV, M4A, MKV, WebM and WAV, with AAC, Opus, Vorbis, FLAC, MP3 or PCM audio |
| **Very large files** | Fine: the waveform is built by streaming the file from disk, and fills in as it goes |
| **Other formats** | The whole file is decoded in memory, so they need to be under 2 GB |
| **AC-3, E-AC-3, DTS, TrueHD** | Play, but with no waveform, because browsers can't decode them |

When switching audio tracks, Vorbis tracks show a waveform but can't be played on their own.

## Privacy

- Video, audio and subtitle files are opened straight from your disk and never uploaded.
- The server only hands out the app's own files, and only to your own computer
  (`127.0.0.1`).
- A strict security policy stops the page from contacting any other site. The one exception
  is the [update check](#updating), which only runs if you agree to it.
- [Text to speech](#text-to-speech) uses the voices on your computer. Online voices, which
  send the text to their provider, are only offered if you turn them on.

## Updating

The first time you open Scribecue, it asks whether it may check GitHub for updates.

- **Check once a day:** GitHub sees the request and your IP address, like any website
  visit. Nothing about your files or text blocks is sent.
- **Don't check:** Scribecue never contacts anything outside your computer.

When a new version is out, the version number in the bottom right turns into **Update
available**. Click the version number at any time to change your choice or check now.

To update, run these in the `Scribecue` folder, then reload the page:

```bash
git pull
```

```bash
docker compose up -d --build
```

If you downloaded a zip instead, download the
[latest release](https://github.com/kyle95wm/Scribecue/releases/latest), replace the old
folder with it, and run `docker compose up -d --build` inside it.

Your text blocks and settings are kept, as long as you open Scribecue at the same address
and port as before.

## Development

The app is plain HTML, CSS and JavaScript with no build step. To run it without Docker:

```bash
python3 -m http.server -d app 8484
```

Run the checks before committing, pushing or opening a pull request:

```bash
scripts/check.sh
```

This checks the JavaScript syntax, runs the unit tests in `tests/` (subtitle parsing, the
version check and the waveform reader), then builds the Docker image and checks that it
serves the app with its security headers. Use `scripts/check.sh --no-docker` to skip the
Docker part. The same checks run on GitHub for every push and pull request.

To release a new version:

1. Change `VERSION` in [app/js/update.js](app/js/update.js), for example to `0.2.0`.
2. Run `scripts/check.sh`, then commit and push.
3. Publish a GitHub release with the same number. Its notes are what **What's new** links to.

   ```bash
   gh release create v0.2.0 --generate-notes
   ```

The screenshots use a generated test video, not real programme material.

## Credits

The keyboard layout is modelled on [Frazier](https://www.videotovoice.com/) by
videotovoice, an audio description tool, so writers who already know Frazier can switch
between the two without relearning keys. Thanks to the Frazier team for publishing their
shortcut cheat sheet.

Scribecue is an independent project. It is not affiliated with, endorsed by or connected
to Frazier or videotovoice. Frazier is their product name, used here only to describe the
keyboard layout.

## License

[MIT](LICENSE)
