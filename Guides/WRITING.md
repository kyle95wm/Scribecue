# Writing with text to speech

Hear your lines read aloud, to check each one fits before the next piece of dialogue.

## Turning it on

Text to speech is part of Write mode. Press `Alt+Shift+V`, or open **Settings → Text to
speech** and tick **Turn on text to speech**. `TTS` shows under the video while it's on.

- **Pick a voice,** and click **Test** to hear it read the **Test text**. Nothing changes
  until you click **Apply**, so you can try as many as you like.
- **Favourites:** click ☆ beside a voice to pin it to the top of the list, with a button
  for one-click switching. Click ★ to unpin it.

[Voices](VOICES.md) explains the kinds of voice you can choose.

![The text to speech settings, with voice, speed and Update all timings](../docs/screenshots/text-to-speech.png)

## Keys

| Key | Action |
| --- | --- |
| `V` | Read the block with the video playing |
| `Shift+V` | Read the block, and set its end to where the reading finishes |
| `[` `]` | Make the block's reading slower / faster |
| `Alt+Shift+V` | Text to speech settings |
| `Alt+Shift+P` | Sounds like: how a word in the block is said |

## How timing works

**A block ends where its reading ends.** As you type, its end moves to match. An `auto`
tag next to the end time shows this. To make a block longer or shorter, change its speed
with `[` `]`, not its end. Moving the block, or changing its start, moves the whole block.

**It never runs into the next block.** If the reading doesn't fit, its time shows in red,
such as `TTS 2.9 s`, and so does the block's length in the list.

- `~` before a time means it's an estimate. It becomes exact once the block has been read.
- A dot (●) after a block's length means its reading is made, so the length is exact.

Blocks opened from a file, or marked with `H`, keep their timing until you edit them.

## Speed

- **Speed per block:** very slow (−30%), slow (−15%), normal, fast (+15%), very fast
  (+30%), and experimental +50% and +100%. Use `[` `]` or the speed menu in the open block.
  A block that isn't at normal speed shows it in the list and on the timeline, such as
  `+15%`.
- **Base speed:** a slider in the text to speech settings, from 50% to 150%, for the whole
  project. It's added on top of each block's own speed. Double-click it to go back to
  100%.

## Voice per block

A block can have its own voice, such as a second voice for translated dialogue. Pick it
from the voice menu in the open block. **Same as Settings** goes back to the main voice.
**Replace all voices**, in the text to speech settings, sets every block back to the main
voice.

## Hearing it while you play

While playing, each block is read as the playhead reaches it, and the video's sound goes
down. Start partway through a block and the reading picks up from there.

The **Video / TTS** slider under the video sets how loud the readings are against the
video. Double-click it to make them even.

In the text to speech settings, choose how far the video's sound goes down, and how
quickly. The [full mix](#exporting-the-full-mix) sounds the same.

### Changing one block

The open block has two controls for its sound:

| Control | What it does |
|---------|--------------|
| **Dip** | Lowers the video more or less than the setting, or not at all (**No dip**). **Custom** takes a number such as `+3` or `-3`. |
| **Vol** | Makes the reading quieter or louder, from 25% to 200%. Type a number in the box for an exact one. Double-click the slider for 100%. |

Both build on the settings and the slider: change those, and every block moves with them.

Projects keep both, along with the settings they build on, so a project sounds the same
on any computer. WebVTT exports keep them too.

## Exporting the full mix

**Export → Full mix** saves the video's sound and the readings together in one file. It
sounds just as it does when you play. It needs a Piper, Kokoro or Google voice.

Choose how under **Export full mix**, in the text to speech settings:

| Setting | Choices |
|---------|---------|
| **Save as** | WAV: about 1.4 GB for a two-hour film. MP3: about 170 MB, and a few minutes slower to make. |
| **Loudness** | As it comes, or a target: −23 LUFS for broadcast in Europe, −24 LUFS in North America, −16 LUFS for podcasts, −14 LUFS for streaming. A target takes twice as long. |
| **Stems** | Also save the video's sound and the readings as separate files, to mix again in an editor. Your browser may ask to allow several downloads. |

For a video with several audio tracks, it uses the one that's playing.

### Putting it in the video

- **With ffmpeg on your computer:** after the export, Scribecue shows a command. Copy it,
  and run it in a folder with the video and the mix.
- **Running Scribecue in Docker:** add [ffmpeg](INSTALL.md#the-full-mix-in-the-video-ffmpeg),
  then choose **In the video**. You get the video back with the mix as an extra audio
  description track, or in place of its sound.

Both work with MP4, MOV, MKV and WebM videos. In Docker, ffmpeg can also save the mix as
AAC, AC-3 or E-AC-3.

To mix it yourself instead, export the [description track](VOICES.md#piper-voices).

## Sounds like

When a voice says a word wrong, tell it how to say it, without changing your text.

1. Select the word, then click **Sounds like** under it, or press `Alt+Shift+P`.
2. Spell it how it sounds, such as *shiv-AWN* for Siobhan.
3. Click **Hear the block** to check.

Tick **Use them in every block with these words** to fix the word everywhere at once.
Readings and the description track use the new sound. The script and SRT exports keep
the word as written.

![The Sounds like dialog, with diagonally to be said as dye-AG-nuh-lee](../docs/screenshots/sounds-like.png)

## Notes in [square brackets]

If you write notes such as `[Wide shot, hold for the door]` in the script, tick **Don't
read notes in [square brackets]** in the text to speech settings. They stay in the script
but aren't read or timed.

## Changing many blocks at once

These are in the text to speech settings. Each asks first, runs in the background with a
**Stop** button, and `Ctrl/Cmd+Z` undoes it.

- **Update all timings:** sets every block's end from its reading. With a browser voice,
  tick **Read each block silently first** for exact lengths.
- **Fit speeds to timings:** the opposite. Every block keeps its timing, and its reading
  speeds up or slows down to fill it. Use it for a script whose timing is already right.
- **Make all readings:** with a Piper, Kokoro or Google voice, makes every reading now, so
  each one plays straight away. Timings don't change.

**When you change the voice or base speed,** every reading's length changes. Scribecue
asks whether to update the blocks' ends to match, or leave them.

**When you open a script** (SRT, WebVTT or `.adc`), Scribecue asks whether to keep its
timings and fit the speeds, change the ends to match the readings, or leave it as it is.

Tick **Always do this** on either question to stop it asking. You can change your answer
later in the text to speech settings.

![The question when a script is opened: fit the reading speeds, change the ends, or leave it](../docs/screenshots/import-timings.png)

## Good to know

- **Saving:** block speeds, voices and sounds-like words are saved in projects and WebVTT
  exports. SRT files can't hold them. Frazier `.adc` scripts bring their speeds, voices
  and base speed with them.
- **Stored readings:** Piper, Kokoro and Google readings are kept in your browser, up to
  250 MB, so they play straight away next time and Google isn't asked again. The **Storage** section
  of Settings shows them and can clear them.
- **Playback speed:** the voice follows the video's playback speed.
