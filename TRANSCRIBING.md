# Transcribing audio description: the complete guide

Transcribing turns audio description that's already recorded into a timed script: a
block for each line the narrator speaks, with its text and its exact start and end.
You'd do it to make a script for a programme whose description was never written down,
to check a recording against its script, or to re-voice or translate it.

Scribecue's Transcribe mode is built for it. You mark each line by holding a key while
the narrator speaks, and Whisper, running on your own computer, can type the line for you.
This guide covers the whole job, from opening the file to handing over the script.

## Contents

- [Before you start](#before-you-start)
  - [Transcribe mode](#transcribe-mode)
  - [Opening the programme](#opening-the-programme)
  - [Choosing the description track](#choosing-the-description-track)
- [The transcribing loop](#the-transcribing-loop)
- [Marking lines with H](#marking-lines-with-h)
  - [The reaction offset](#the-reaction-offset)
  - [Starting from pause](#starting-from-pause)
  - [Gaps and overlaps](#gaps-and-overlaps)
- [Speech to text with Whisper](#speech-to-text-with-whisper)
  - [Setting it up](#setting-it-up)
  - [Using it](#using-it)
  - [Transcribing again, and empty blocks](#transcribing-again-and-empty-blocks)
  - [What Whisper gets wrong](#what-whisper-gets-wrong)
  - [The web version and Docker compared](#the-web-version-and-docker-compared)
- [Checking and fixing](#checking-and-fixing)
  - [Hearing a block again](#hearing-a-block-again)
  - [Fixing the timing](#fixing-the-timing)
  - [Splitting, merging and deleting](#splitting-merging-and-deleting)
  - [A last pass](#a-last-pass)
- [Saving and handing it over](#saving-and-handing-it-over)
- [Keys for transcribing](#keys-for-transcribing)
- [Privacy](#privacy)
- [If something goes wrong](#if-something-goes-wrong)

## Before you start

### Transcribe mode

Pick **Transcribe** with the switch next to the Scribecue name, at the top left. It shows
the tools for transcribing (hold-to-mark and speech to text) and hides the ones for
writing, such as text to speech. Scribecue remembers your choice, and the setup that opens
the first time asks for it too.

Scribecue is built for **Chrome and Edge**. Other browsers can open it, but in Firefox a
description track can stutter, and speech to text can interrupt the video's sound.

### Opening the programme

Open the video or audio file with `Ctrl/Cmd+Shift+O`, or **Open** at the top, or drop it on
the video. It plays straight from your computer and is never uploaded.

MP4, MOV, M4A, MKV, WebM and WAV all work, of any size. Other formats, such as MP3 on its
own, work too if they're under 2 GB. As the file opens, Scribecue builds a waveform of the
audio along the timeline. Narration is usually easy to spot in it, which helps you find
the next line.

If you're carrying on from an earlier session, open your project with `Ctrl/Cmd+O`, then
the video (see [Saving and handing it over](#saving-and-handing-it-over)).

### Choosing the description track

Programmes with audio description usually carry it in one of two ways:

- **A mix:** the whole programme, dialogue and music included, with the narration mixed on
  top. This is the most common kind.
- **Narration only:** just the narrator, with nothing else. These are less common, and
  mostly turn up in production files.

A file with more than one audio track gets an **Audio** picker under the video. Scribecue
picks a track marked as audio description by itself, and says so. If you can't hear the
narration, press `T` (or `Shift+T`) to switch tracks. The waveform always shows the track
you're hearing.

A narration-only track is the best to work from if your file has one: the waveform shows
exactly where each line is, and speech to text hears only the narrator.

## The transcribing loop

Most of the work is one loop, repeated through the programme:

1. **Play to the next line.** `Space` plays and pauses.
2. **Mark it.** Hold `H` while the narrator speaks, and let go when they stop. Playback
   pauses, and the new block opens for typing.
3. **Type it**, or with speech to text on, check the text Whisper fills in.
4. **Carry on.** `Enter` or `Esc` closes the block, and playback carries on.

Press `?` at any time to see every key, and **Show the loop** in that overlay to see this
loop again.

## Marking lines with H

![Hold-to-mark: a dashed block grows on the timeline while H is held](docs/screenshots/hold-to-mark.png)

While you hold `H`, a dashed block grows on the timeline. When you let go, it becomes a
block from the moment you pressed to the moment you let go, give or take the adjustments
below. If the video was paused, holding `H` starts it playing.

### The reaction offset

You press a key a moment after you hear the narrator start, and let go a moment after they
stop. So both edges of a block move back by a **reaction offset**, 200 ms to begin with.

`H −200ms` under the video shows it. Click it, or press `Shift+H`, to step through 0, 100,
150, 200, 250 and 300 ms. Setup asks for it too. Your choice is remembered.

To find yours, mark a few lines and look at the waveform: if blocks start late, after the
sound begins, raise the offset; if they start early, lower it.

### Starting from pause

If you pause just before a line and then hold `H`, the block starts exactly where you
paused, with no offset. Use it for the first word of a line that matters, or when the
narration starts right after dialogue: step to the spot with `←` `→` (one frame at a
time), then hold `H`.

### Gaps and overlaps

Blocks never overlap. A new block is trimmed to fit inside the gap it starts in, so if you
let go late, it ends where the next block starts. A hold shorter than a quarter of a second
is ignored, in case you pressed `H` by accident.

## Speech to text with Whisper

[Whisper](https://github.com/openai/whisper) is an open-source speech recognition model.
Scribecue runs it on your own computer to type each line you mark. You still time every
block yourself; Whisper only fills in the text.

### Setting it up

Click **STT** under the video, or press `Alt+Shift+H`, to open the speech to text panel.

- **In the web version** ([scribecue.kyleadvoice.ca](https://scribecue.kyleadvoice.ca/)),
  click **Download Whisper**. It's 166 MB, downloaded once from Scribecue's own site into
  your browser, and then it works offline. **Remove** takes it out again.
- **With Docker**, add the Whisper container next to Scribecue (see
  [INSTALL.md](INSTALL.md#speech-to-text-whisper)): add `whisper` to `COMPOSE_PROFILES` in
  `.env`, then run `docker compose up -d --build`. The panel says when it's running.

Then tick **Fill in blocks as I mark them**. **STT** under the video lights up while it's on.

### Using it

Mark a line with `H` as usual. When you let go, the block opens with "Transcribing…" in
it, and a moment later Whisper's text appears, ready to check. Correct anything that's
wrong, then `Enter` or `Esc` to carry on.

- **If you start typing first,** Whisper leaves the block to you.
- **If you've already closed the block** by the time the text arrives, it's filled in
  anyway, as long as you haven't given it text yourself.
- **Silence** comes back empty, rather than as invented words.
- `Ctrl/Cmd+Z` takes the text out again.

Whisper listens to the block's own time span, plus a fifth of a second either side, so a
word cut off by your timing isn't lost. It never listens into the blocks next to it.

### Transcribing again, and empty blocks

- **`Alt+Shift+T`** transcribes the selected block again and replaces its text. Use it after
  you change a block's timing, or if the text came out badly. `Ctrl/Cmd+Z` brings the old
  text back.
- **Transcribe empty blocks**, in the panel, fills in every block that has no text yet, one
  after the other, with a progress bar and **Stop**. Use it for blocks you marked with
  speech to text off, drew on the timeline, or opened from a script with empty lines.
  Blocks with text are never touched. One `Ctrl/Cmd+Z` undoes the whole run.

A way to work fast: turn speech to text off, mark the whole programme with `H` without
stopping to type, then **Transcribe empty blocks** and check them all in one pass.

### What Whisper gets wrong

Whisper is good with clear narration, but check every line. Most often:

- **Names.** Whisper spells unfamiliar names the way they sound, such as "Dr. Akafer" for
  Okafor. Search for each name with `/` once you're done.
- **Other voices.** It writes down every word it hears in a block. On a mix track, a
  character speaking under the narration, or right after it, can end up in the text, and
  so can song lyrics or a TV in the scene. Delete the extra words, or tighten the block and
  press `Alt+Shift+T`. A narration-only track avoids this.
- **Spelling.** It uses US spelling, such as "gray" and "harbor".
- **Short words that run together**, especially in the web version, such as "slide to" for
  "slides a".
- **Languages.** It only understands English, unless you choose a different model for the
  Docker container (see [INSTALL.md](INSTALL.md#speech-to-text-whisper)).

### The web version and Docker compared

| | Web version | Docker |
| --- | --- | --- |
| Model | Whisper `base.en` | Whisper `small.en`, about three times bigger, and more accurate |
| Setup | A 166 MB download into the browser, once | The Whisper container, about 1.6 GB, built once |
| Time per line | About a second on a computer with a graphics chip the browser can use; several seconds without one | About a second, on the processor |
| Other models | No | Yes, with `WHISPER_MODEL` in `.env` |

They're separate: Whisper downloaded in the web version stays in that browser, and the
Docker version only uses its container.

## Checking and fixing

### Hearing a block again

- **`L`** loops the block under the playhead, or the selected one. Press `Enter` to type
  while it repeats, and `Esc` when you're done, and the loop stops. Press `L` again to stop
  it without editing.
- **`Shift+Space`** plays just the selected block, once.
- **`O`** turns on a loop that stays on until you turn it off.

### Fixing the timing

| To | Press |
| --- | --- |
| Set the block's start or end to the playhead | `A` / `S` |
| Move the start by 100 ms | `Q` (earlier) / `W` (later), with `Shift` for 10 ms |
| Move the end by 100 ms | `E` (earlier) / `R` (later), with `Shift` for 10 ms |
| Move the whole block by 100 ms | `,` / `.`, with `Shift` for 10 ms |
| Move the whole block by one frame, while typing | `Alt+Shift+←` / `Alt+Shift+→` |
| Type exact times | `Tab` from the text to the IN and OUT fields |
| Drag a block, or its edges | Mouse, on the timeline |

`G` and `Shift+G` move the playhead to the block's start or end, so you can check an edge
against the waveform. `←` `→` step one frame at a time, to find the exact spot.

### Splitting, merging and deleting

- **`X`** splits the block at the playhead, for two lines you marked as one.
- **`M`** merges the selected block with the next, for one line you marked as two.
- **`Delete`**, or the **×** at the end of its row in the list, deletes a block, and
  `Ctrl/Cmd+Z` brings it back. `Alt+Shift+D` asks first.

### A last pass

Once the whole programme is marked:

1. Go back to the beginning with `Home` (`Fn+←` on Mac laptops).
2. Turn on **Follow** with `F`, so each block is selected as it plays.
3. Play through, reading along. Pause and fix anything that's off.
4. Search the list with `/` for names, and look down it for blocks still marked `(empty)`.

## Saving and handing it over

- **`Ctrl/Cmd+S`** saves a project (`.scribecue`): the blocks, the mode and its settings,
  where you were, and which video it belongs to. The first save asks where; after that it
  saves straight back to the same file. Your work is also kept in the browser as you go,
  so reloading the page loses nothing.
- **Next time,** open the project with `Ctrl/Cmd+O`, then its video. Browsers can't
  remember where a video is, but Scribecue tells you which one the project belongs to, and
  warns you if you pick a different file.
- **To hand it over,** use the **Export** menu: **Script as SRT** (`Ctrl/Cmd+E`) or **Script
  as WebVTT** (`Ctrl/Cmd+Shift+E`). Both open in most subtitle and description tools, and
  in Scribecue again.

## Keys for transcribing

| Key | What it does |
| --- | --- |
| `Space` | Play / pause |
| Hold `H` | Mark a block while the narrator speaks |
| `Shift+H` | Change the reaction offset |
| `T` / `Shift+T` | Next / previous audio track |
| `Enter` / `Esc` | Close the block and carry on playing |
| `L` | Loop this block while you type |
| `Shift+Space` | Play the selected block |
| `Alt+Shift+T` | Transcribe the selected block again with Whisper |
| `Alt+Shift+H` | Speech to text settings |
| `A` / `S` | Set start / end to the playhead |
| `Q` `W` / `E` `R` | Move the start / end by 100 ms (`Shift`: 10 ms) |
| `X` / `M` | Split at the playhead / merge with the next block |
| `←` `→` | One frame back / forward |
| `Alt+Shift+←` `Alt+Shift+→` | Start of this block, then the previous / the next block |
| `/` | Search the blocks |

You can change any of these: press `?`, then **Change shortcuts**. The overlay always shows
the keys as you've set them.

## Privacy

Your video, audio and script never leave your computer. Speech to text runs Whisper in
your browser, or in a container with no internet access that only Scribecue's own server
can reach. The audio of each block is passed straight to it, on your computer, and nowhere
else.

## If something goes wrong

- **I can't hear the narration:** press `T` to switch audio tracks, and check the **Audio**
  picker under the video.
- **Blocks start or end a little late or early:** change the [reaction
  offset](#the-reaction-offset) with `Shift+H`.
- **"Can't play track 2 on its own":** the browser can't play that track's format by
  itself, such as Vorbis. Its waveform still shows. Choose another track, or convert the
  file.
- **No waveform:** the audio is AC-3, E-AC-3, DTS or TrueHD, which browsers can't decode.
  It plays, but speech to text can't read it either.
- **STT is greyed out, or the panel says Whisper isn't ready:** in the web version,
  download it from the panel; with Docker, check that `COMPOSE_PROFILES` in `.env`
  includes `whisper`, then run `docker compose up -d --build`. The container takes a few
  seconds to start.
- **"Whisper didn't hear any words":** the block is silent or very quiet on the chosen
  track. Check you're on the description track, and that the block covers the narration.
- **Transcribing is slow in the web version:** the browser can't use a graphics chip, so
  Whisper runs on the processor. Try Chrome or Edge, or use the Docker version.
- **The sound stutters or stops while transcribing, in Firefox:** use Chrome or Edge.
  Reopening the tab brings the sound back.

Found a problem that isn't here? Report it on
[GitHub](https://github.com/kyle95wm/Scribecue/issues).
