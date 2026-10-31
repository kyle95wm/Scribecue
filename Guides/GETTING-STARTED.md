# Getting started

How Scribecue is laid out, the loop you work in, and how to save and export.

## Modes: Transcribe and Write

The switch next to the Scribecue name picks what you're doing, and shows only the features
for it.

| | Transcribe | Write |
| --- | --- | --- |
| For | Existing audio description, at its original timing | New audio description |
| [Hold-to-mark](TRANSCRIBING.md#marking-lines-with-h) (`H`) | ✓ | Times your own read of a block |
| [Speech to text](TRANSCRIBING.md#speech-to-text-with-whisper) | ✓ | |
| [Text to speech](WRITING.md) (`V`) | | ✓ |
| Everything else | ✓ | ✓ |

Switching only hides features, so nothing is lost. If you press a key from the other mode,
Scribecue tells you which mode it's in.

## Settings

**Settings**, at the top (`Alt+Shift+S`), has everything you set up rather than use while
you work: **General**, **Transcribing**, **Text to speech**, **AI help**, **Keyboard
shortcuts** and **Storage**.

Settings that are on show under the video, such as `TTS` or `STT`. Click one to open its
section.

**Run setup again**, under **General**, asks the first-time questions again. Nothing
changes until you press **Finish**.

![Settings, with its sections down the left and General showing](../docs/screenshots/settings.png)

## The loop

Most of the work is one short loop, repeated for every line. Press `?` at any time to see
every shortcut.

### The writing loop

In **Write** mode, with text to speech on (`Alt+Shift+V`). Open the video with
`Ctrl/Cmd+Shift+O`, then repeat:

1. **Find a gap.** Press `Space` to play, and again to stop where there's room. `←` `→`
   move one frame.
2. **Write.** Press `Enter` to make a block at the playhead, and type the line. Its end
   follows how long the reading takes. The reading time turns red if it doesn't fit before
   the next block.
3. **Close it.** Press `Esc` or `Enter`.
4. **Listen.** Press `V` to hear it with the video. `[` `]` make this block's reading
   slower or faster.

**To read it yourself instead,** select the block and hold `H` while you say the line.
When you let go, the block ends there.

- **Need a breath?** Let go, then hold `H` again to carry on.
- **Fluffed a word?** Step back with `←` to just before it, and hold `H` to redo the rest.
- **Start over:** press `G` to go to the block's start, then hold `H`.

### The transcribing loop

In **Transcribe** mode. Open the video with `Ctrl/Cmd+Shift+O`. If you don't hear the
description, press `T` to switch audio tracks. Then repeat:

1. **Play** to the next line with `Space`.
2. **Mark it.** Hold `H` while the narrator speaks, and let go when they stop. A block
   opens for typing.
3. **Type it,** then press `Enter` or `Esc`. Playback carries on.

Press `L` to hear the block again while you type.

With [speech to text](TRANSCRIBING.md#speech-to-text-with-whisper) on, the line is typed
for you, so step 3 is just checking it. [Transcribing](TRANSCRIBING.md) has the details.

## Editing a block

Click a block in the list to open it. `Esc` or `Enter` closes it, and it stays selected.

The open block shows its start and end, its text and, with text to speech on, its speed,
voice and reading time. The buttons after the times move it:

- back one frame;
- to start at the playhead;
- forward one frame.

The × deletes it.

| To | Press |
| --- | --- |
| Set the start or end to the playhead | `A` / `S` |
| Move the start or end by 100 ms | `Q` `W` / `E` `R` (add `Shift` for 10 ms) |
| Move the whole block by 100 ms | `,` `.` (add `Shift` for 10 ms) |
| Set the end to where the reading finishes (Write) | `Shift+V` |

On the timeline, drag a block to move it, drag an edge to change its start or end, or drag
across empty space to draw a new block.

## Getting around

| To | Press |
| --- | --- |
| Play or pause | `Space` |
| Move one frame | `←` `→` |
| Move 3 seconds | `Shift+←` `Shift+→` |
| Go to the previous or next block | `Alt+Shift+←` `Alt+Shift+→` |
| Step through the list | `↑` `↓` |
| Go to the start or end of the selected block | `G` / `Shift+G` |
| Go to the beginning or end of the video | `Home` / `End` (`Fn+←` / `Fn+→` on Mac laptops) |
| Go to a time | `Alt+Shift+J` |
| Search the blocks | `/` |

You can also click the timeline, or the bar under the video, to jump anywhere. Scroll the
timeline to pan, and `Ctrl/Cmd`+scroll or pinch to zoom.

## Saving

Press `Ctrl/Cmd+S` to save a **project** (`.scribecue`). It keeps everything: the blocks,
their speeds, your settings, where you were and which video goes with it. Keep one per
programme. `Ctrl/Cmd+O` opens it again.

- **Autosave:** once a project has a file, your changes are saved to it a couple of
  seconds after you stop. If it says **autosave paused**, click it to let Scribecue save
  again.
- **A dot after the project name** means there are changes you haven't saved.
- **Save a copy** with `Ctrl/Cmd+Shift+S`, for example before a big change.
- **The video reopens with the project.** If you're asked, click **Reopen**. If the video
  has moved, open it again with `Ctrl/Cmd+Shift+O`.
- **New**, at the top left, either clears the blocks and keeps the video, or starts a
  whole new project. `Ctrl/Cmd+Z` brings the blocks back.

Saving to the file, autosave and reopening the video need Chrome or Edge. Other browsers
download a copy each time you save, and you open the video yourself.

## Exporting

When the script is finished, or to share it with someone who doesn't use Scribecue,
use the **Export** menu at the top:

- **Script as SRT** (`Ctrl/Cmd+E`).
- **Script as WebVTT** (`Ctrl/Cmd+Shift+E`). This also keeps each block's speed, voice and
  sounds-like words.
- **Description track:** all the readings as one WAV or MP3 file, in Write mode with a
  [Piper](VOICES.md#piper-voices), [Kokoro](VOICES.md#kokoro-voices) or
  [Google](VOICES.md#google-cloud-voices) voice.
- **Full mix:** the programme's sound with the readings, the programme lowered under each
  one, as one WAV or MP3 file. See [Exporting the full mix](WRITING.md#exporting-the-full-mix).

`Ctrl/Cmd+O` opens SRT and WebVTT scripts too, and Frazier's `.adc` scripts.

## Files with several audio tracks

If a file has more than one audio track, such as the original mix and a description mix,
an **Audio** picker appears under the video. `T` / `Shift+T` switch tracks. A track marked
as audio description is picked for you.

## Other handy features

- **Timecode:** times show as `hh:mm:ss:ff`, in frames at the video's own frame rate.
  29.97 and 59.94 fps videos use drop-frame timecode (`hh:mm:ss;ff`). Exported scripts
  use the usual milliseconds.
- **Waveforms are kept** in your browser, so reopening a video, even after a reload, shows
  its waveform straight away. The 20 used most recently are kept.
- **Copy a timecode:** click the clock under the video.
- **Time remaining:** click the total length, next to the clock.
- **Find and replace:** `Alt+Shift+F`, or **Replace…** next to the search box, changes text
  in every block at once, such as a character's name.
- **Quick navigation:** `Shift+F`.
- **Swap sides:** the ⇄ button at the top puts the video on the other side.
- **Player controls:** the buttons under the video. Hover over one to see its key.
- **The tour and the loop:** **Take the tour** and **Show the loop**, in the shortcuts
  overlay (`?`), show them again.
- **What's new:** after an update, a window lists what changed. In the web version, click
  the version number in the bottom right to see it again.
- **Screen readers:** messages are read out as they appear, and the block list can be read
  block by block. With NVDA or JAWS, single-letter keys such as `H` may need focus mode.
  This is still being worked on.

## What your computer needs

| | Enough | Better |
|---|---|---|
| **Computer** | A laptop or desktop from about 2016 on, with a keyboard | Anything from the last few years |
| **Memory** | 4 GB | 8 GB, for Piper voices or speech to text in the browser |
| **Browser** | Chrome or Edge, kept up to date | |

Phones and tablets aren't supported. Running Scribecue yourself with Docker needs a little
more: see [what you need](INSTALL.md#what-you-need).

## On a slower computer

If the video is slow to start, or stutters:

- **Use a smaller copy of the video to write with,** such as 720p instead of 1080p or 4K.
  The timings are the same, so the script works with the full-size video too.
- **Use Chrome or Edge.** Chromium, especially on Linux, often can't use the computer's
  graphics chip to play video, and some builds [can't play MP4](#if-a-video-wont-play).
- **Prefer a file with only the description mix,** if you have one. With several audio
  tracks, Scribecue plays the chosen track alongside the video, which is more work.
- **Press play once.** **Loading…** next to the clock means it's getting ready.

## Supported files

| | Supported |
| --- | --- |
| **Projects** | `.scribecue`, to open and save |
| **Scripts** | SRT and WebVTT, to open and export; Frazier's `.adc`, to open |
| **Video and audio** | MP4, MOV, M4A, MKV, WebM and WAV |
| **Very large files** | Fine for MP4, MOV, M4A, MKV, WebM and WAV. Other formats need to be under 2 GB |
| **AC-3, E-AC-3, DTS, TrueHD audio** | Play, but with no waveform |

### If a video won't play

Some builds of Chromium, mostly on Linux, can't play H.264 video or AAC sound, which most
MP4 files use. Scribecue tells you when it starts, and again when you open a file it
can't play.

- **Use Chrome or Edge,** which play them.
- **Or open a WebM copy,** which every browser plays. If you run Scribecue with
  [ffmpeg in Docker](INSTALL.md#the-full-mix-in-the-video-ffmpeg), choose
  **Make a copy that plays** and Scribecue makes one, opens it and downloads it for you.
- **Keep the copy with the project.** Your timings work with the original video too.
