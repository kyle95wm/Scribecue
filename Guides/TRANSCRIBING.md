# Transcribing audio description

Turn audio description that's already recorded into a timed script: one block for each
line the narrator speaks. You mark each line by holding `H` while the narrator speaks, and
speech to text can type it for you.

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

Pick **Transcribe** with the switch next to the Scribecue name, at the top left. Use
Chrome or Edge: in Firefox, a description track can stutter.

### Opening the programme

Open the video or audio file with `Ctrl/Cmd+Shift+O`, or drop it on the video. The
waveform along the timeline shows where the narration is, which helps you find the next
line.

### Choosing the description track

If the file has more than one audio track, an **Audio** picker appears under the video, and
a track marked as audio description is picked for you. If you can't hear the narration,
press `T` to switch tracks.

The best track to work from is **narration only**, if your file has one: the waveform
shows exactly where each line is, and speech to text hears only the narrator. Most files
only have a **mix**, with the narration on top of the programme's sound, which works too.

## The transcribing loop

Repeat through the programme:

1. **Play to the next line** with `Space`.
2. **Mark it.** Hold `H` while the narrator speaks, and let go when they stop. A block
   opens for typing.
3. **Type it**, or with speech to text on, check the text that's filled in.
4. **Carry on.** `Enter` or `Esc` closes the block, and playback carries on.

## Marking lines with H

![Hold-to-mark: a dashed block grows on the timeline while H is held](../docs/screenshots/hold-to-mark.png)

While you hold `H`, a dashed block grows on the timeline. When you let go, it becomes a
block. If the video was paused, holding `H` starts it.

### The reaction offset

You press a moment after the narrator starts, and let go a moment after they stop. So
both edges of a block move back by a **reaction offset**, 200 ms to begin with.

- `Shift+H` changes it, and `H −200ms` under the video shows it.
- **Blocks start late,** after the sound begins? Raise it. **Early?** Lower it.

### Starting from pause

Pause just before a line, then hold `H`, and the block starts exactly where you paused,
with no offset. Use `←` `→` to find the spot one frame at a time.

### Gaps and overlaps

Blocks never overlap: a new block is trimmed to fit its gap. A hold shorter than a quarter
of a second is ignored.

## Speech to text with Whisper

Speech to text uses [Whisper](https://github.com/openai/whisper), an open-source model
that runs on your computer, to type each line you mark. You still time every block
yourself.

### Setting it up

Open **Settings → Transcribing**, or press `Alt+Shift+H`.

- **In the web version,** click **Download Whisper**. It's 166 MB, downloaded once, and
  then works offline.
- **With Docker,** add the Whisper container. See
  [Speech to text](INSTALL.md#speech-to-text-whisper).

Then tick **Fill in blocks as I mark them**. `STT` shows under the video while it's on.
You can also choose American or British and Canadian **Spelling**.

### Using it

Mark a line with `H` as usual. When you let go, the block shows "Transcribing…", and a
moment later the text appears. Fix anything wrong, then press `Enter` or `Esc`.

- If you start typing first, your text is kept.
- Silence comes back empty, not as made-up words.
- `Ctrl/Cmd+Z` takes the text out again.

### Transcribing again, and empty blocks

- **`Alt+Shift+T`** transcribes the selected block again, for example after you change its
  timing.
- **Transcribe empty blocks**, in the Transcribing settings, fills in every block with no
  text yet. Blocks with text are never touched.

**A fast way to work:** turn speech to text off, mark the whole programme with `H` without
stopping, then click **Transcribe empty blocks** and check them all in one pass.

### What Whisper gets wrong

It's good with clear narration, but check every line. Watch for:

- **Names,** spelled the way they sound. Search for each one with `/` when you're done.
- **Other voices.** On a mix track, a character speaking under the narration can end up
  in the text. Delete the extra words, or tighten the block and press `Alt+Shift+T`.
- **Spelling.** Choose British and Canadian **Spelling** for colour, grey, centre and the
  like.
- **Short words run together,** such as "slide to" for "slides a".
- **Other languages.** Only English is understood, unless you use a different model with
  Docker.

### The web version and Docker compared

| | Web version | Docker |
| --- | --- | --- |
| Model | Whisper `base.en` | Whisper `small.en`, about three times bigger, and more accurate |
| Setup | A 166 MB download into the browser, once | The Whisper container, about 1.6 GB, built once |
| Time per line | About a second on a computer with a graphics chip the browser can use; several seconds without one | About a second, on the processor |
| Other models | No | Yes, with `WHISPER_MODEL` in `.env` |

## Checking and fixing

### Hearing a block again

- **`L`** loops the block under the playhead, or the selected one. Press `Enter` to type
  while it repeats, and `Esc` when you're done, and the loop stops. Press `L` again to stop
  it without editing.
- **`Shift+Space`** plays just the selected block, once.
- **`O`** turns on a loop that stays on until you turn it off.
- **Replay** (`Shift+L`) goes back to a block's start when you close it, so you hear
  every line again as you go. It's on unless you turn it off.

### Fixing the timing

| To | Press |
| --- | --- |
| Set the block's start or end to the playhead | `A` / `S` |
| Move the start by 100 ms | `Q` (earlier) / `W` (later), with `Shift` for 10 ms |
| Move the end by 100 ms | `E` (earlier) / `R` (later), with `Shift` for 10 ms |
| Move the whole block by 100 ms | `,` / `.`, with `Shift` for 10 ms |
| Move the whole block by one frame, while typing | `Alt+Shift+←` / `Alt+Shift+→` |
| Type exact times | `Tab` from the text to the start and end |
| Drag a block, or its edges | Mouse, on the timeline |

`G` and `Shift+G` go to the block's start or end, to check an edge against the waveform.

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

- **Save** a project with `Ctrl/Cmd+S`, and open it next time with `Ctrl/Cmd+O`.
  [Saving](GETTING-STARTED.md#saving) has the details.
- **Hand it over** with the **Export** menu: **Script as SRT** (`Ctrl/Cmd+E`) or **Script
  as WebVTT** (`Ctrl/Cmd+Shift+E`).

## Keys for transcribing

| Key | What it does |
| --- | --- |
| `Space` | Play / pause |
| Hold `H` | Mark a block while the narrator speaks |
| `Shift+H` | Change the reaction offset |
| `T` / `Shift+T` | Next / previous audio track |
| `Enter` / `Esc` | Close the block and carry on playing |
| `L` | Loop this block while you type |
| `Shift+L` | Replay: back to a block's start after editing it, on / off |
| `Shift+Space` | Play the selected block |
| `Alt+Shift+T` | Transcribe the selected block again with Whisper |
| `Alt+Shift+H` | Speech to text settings |
| `A` / `S` | Set start / end to the playhead |
| `Q` `W` / `E` `R` | Move the start / end by 100 ms (`Shift`: 10 ms) |
| `X` / `M` | Split at the playhead / merge with the next block |
| `←` `→` | One frame back / forward |
| `Alt+Shift+←` `Alt+Shift+→` | Start of this block, then the previous / the next block |
| `/` | Search the blocks |

To change them, see [Changing shortcuts](SHORTCUTS.md#changing-shortcuts).

## Privacy

Your video, audio and script never leave your computer. Whisper runs in your browser, or
in a container with no internet access.

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
- **STT doesn't show, or Settings says Whisper isn't ready:** in the web version,
  download it in Settings, under Transcribing; with Docker, check that `COMPOSE_PROFILES` in `.env`
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
