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

![The text to speech settings, with voice, speed and Update all timings](docs/screenshots/text-to-speech.png)

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

While playing, each block is read as the playhead reaches it, and the video's sound is
turned down. Start partway through a block and the reading picks up from there.

The **Video / TTS** slider under the video sets how loud the readings are against the
video. Double-click it to put it back in the middle.

In the text to speech settings, choose how far the video's sound goes down (6 to 20 dB)
and how quickly it fades down and back up. The [full mix](#exporting-the-full-mix) uses
the same settings, so it sounds like what you hear.

## Exporting the full mix

**Export → Full mix** saves the programme's sound and the readings together in one stereo
file, ready to listen to or share. It needs a Piper, Kokoro or Google voice.

- **It sounds as it does when you play:** the programme goes down under each reading, as
  far and as quickly as set in the text to speech settings, and the levels follow the
  **Video / TTS** slider.
- **It uses the audio track that's playing,** for a video with several.
- **Peaks are kept under −1 dBFS,** so the mix never clips.
- **WAV or MP3:** choose under **Save as** in the text to speech settings. A WAV of a
  two-hour film is about 1.4 GB; an MP3 at 192 kbps is about 170 MB. An MP3 takes a few
  minutes longer to make.
- **Stop** cancels it.

For your own mix, export the [description track](VOICES.md#piper-voices) instead and mix it
in your editor.

## Sounds like

When a voice says a word wrong, tell it how to say it, without changing your text.

1. Select the word, then click **Sounds like** under it, or press `Alt+Shift+P`.
2. Spell it how it sounds, such as *shiv-AWN* for Siobhan.
3. Click **Hear the block** to check.

Tick **Use them in every block with these words** to fix the word everywhere at once.
Readings and the description track use the new sound. The script and SRT exports keep
the word as written.

![The Sounds like dialog, with diagonally to be said as dye-AG-nuh-lee](docs/screenshots/sounds-like.png)

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

![The question when a script is opened: fit the reading speeds, change the ends, or leave it](docs/screenshots/import-timings.png)

## Good to know

- **Saving:** block speeds, voices and sounds-like words are saved in projects and WebVTT
  exports. SRT files can't hold them. Frazier `.adc` scripts bring their speeds, voices
  and base speed with them.
- **Stored readings:** Piper, Kokoro and Google readings are kept in your browser, up to
  250 MB, so they play straight away next time and Google isn't asked again. The **Storage** section
  of Settings shows them and can clear them.
- **Playback speed:** the voice follows the video's playback speed.
