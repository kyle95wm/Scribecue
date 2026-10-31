# Writing with text to speech

Hear your lines read aloud, to check where each one sits and whether it fits before the
next piece of dialogue. It's part of Write mode, and off until you turn it on: press
`Alt+Shift+V`, or open **Settings** and choose **Text to speech**, then tick **Turn on text
to speech**. `TTS` under the video shows while it's on.
**Test**, next to the voice, reads what's in **Test text** under it, a short sample
description until you type your own line, so you can hear each voice. Picking a voice only tries it out: Test
reads with it, but nothing else changes until you click **Apply**, so you can go through
voices without being asked about the timings each time. Close Settings without Apply and
the voice stays as it was.
**Favourites:** click ☆ beside the voice to pin it. Your favourites then sit at the top of
the voice list, and each gets a button under it, so you can pick between them in one
click. Click ★ to unpin the chosen voice. A favourite that isn't available, such as a
Piper voice while Piper isn't running, stays in the row, greyed out, until it's back;
click it to take it out.

![The text to speech settings, with voice, speed and Update all timings](docs/screenshots/text-to-speech.png)

| Key | Action |
| --- | --- |
| `V` | Read the block from its start, with the video playing. Playback stops at the block's end, or where the reading ends if it runs over |
| `Shift+V` | Read the block, then set its end to where the reading finishes, and keep it there as you edit |
| `[` `]` | Make the selected block's reading slower / faster |
| `Alt+Shift+V` | Choose the voice and speed |
| `Alt+Shift+P` | Sounds like: how words in this block are said |

- **Base speed:** a slider from 50% to 150%, as in Frazier, for the whole project. Every
  reading is made this much faster or slower, on top of its block's own speed, so a whole
  project can be nudged without changing any block's speed. 100% is normal, and
  double-clicking the slider puts it back. It's saved with each project, and a Frazier
  `.adc` script's base speed comes with it. The voice also follows the playback speed.
- **Speed per block:** very slow (−30%), slow (−15%), normal, fast (+15%), very fast
  (+30%), and experimental +50% and +100%. Set a block's speed with `[` `]` or the **TTS**
  menu in the block editor. Blocks with a speed other than normal show it in the list and
  on the timeline, such as `+15%`. Block speeds are saved with your work and in exported VTT
  files, as notes that other programs ignore. SRT files can't store them.
- **Voice per block:** a block can have a voice of its own, such as a second voice for
  translated dialogue. Pick it from the **Voice** menu in the block editor; **Same as Settings**
  reads it with the voice chosen in the text to speech settings, and follows it when that
  changes. Blocks with their own voice show its name in the list. They're saved with your
  work and in exported VTT files, and Frazier's `.adc` scripts bring theirs. The text to
  speech settings say how many blocks have their own voice, and **Replace all voices** reads
  them all with the chosen voice again, which `Ctrl/Cmd+Z` undoes. A description track can
  mix voices.
- **When the voice or base speed changes:** every reading takes a different time, so
  Scribecue asks whether to change the blocks' ends to match the new readings, never running
  into the next block, or leave the timings as they are. Or go back to the voice or base
  speed you had, and nothing changes. Tick **Always do this** to stop it asking, and
  change your choice later under **When the voice or base speed changes**. Changing the
  ends can be undone.
- **Read blocks aloud while playing:** each block is read as the playhead reaches it,
  with the original audio turned down. You can turn either part off. Play from partway
  through a block, or jump into one, and its reading picks up from there. Voices in the
  browser start at the word they'd have reached.
- **Mix:** the **Video / TTS** slider under the video sets how loud the readings are
  against the video's sound. In the middle both are at full volume; slide towards TTS to
  turn the video down, or towards Video to turn the readings down. Double-click it to put
  it back in the middle. It shows in Write mode while text to speech is on.
- **Opening a script:** when you open an SRT, VTT or `.adc` script in Write mode with text to
  speech on, Scribecue asks what to do with its timings: keep them and fit the reading
  speeds, change the ends to match the readings, or leave everything as it is. Tick
  **Always do this** to stop it asking, and change your choice later under **When you open
  a script** in the text to speech settings. Either change can be undone. Opening a Scribecue
  project doesn't ask. The change runs in the background, with its progress and **Stop** in
  the bottom bar, so you can start on the script straight away. So do **Update all timings**
  and **Fit speeds to timings**, one at a time, carrying on if you close Settings.

  ![The question when a script is opened: fit the reading speeds, change the ends, or leave it](docs/screenshots/import-timings.png)
- **Fit speeds to timings:** the opposite of Update all timings, for a script whose
  timing is already right, such as one opened from a file. Every block keeps its timing,
  and its reading speeds up or slows down to fill it, within −15% to +100%. Blocks with a
  speed you picked keep it. It asks first, and `Ctrl/Cmd+Z` undoes it. With a Piper or Google
  voice the fit is exact. Edited later, a block's end follows its reading at its new speed.
- **Each block ends where its reading ends:** as in Frazier, a block's length comes from
  its reading, not from dragging. As you write, its end follows the reading; to make it
  longer or shorter, change its speed, from its menu or with `[` `]`. Its edges can't be
  dragged, and its end time shows where the reading ends; moving a block, or changing its
  start, moves the whole block. Blocks opened from a file keep their timing until you edit them. A
  reading only runs over its block, shown in red, when the next block is in the way.
- **Sounds like:** when a voice says a name or word wrong, tell it how to say it, without
  changing the text. Select the word in the text box and click the **Sounds Like** button
  that pops up under it, or press `Alt+Shift+P`. The word is filled in for you, so spell
  it how it sounds, such as *shiv-AWN* for Siobhan, and click **Hear the block** to check.
  Each block keeps its own list; tick **Use them in every block with these words** to add
  them to every other block that has them too, in one step. Words are matched whole and in any case, so the reading,
  its length and the exported description track all use the new sound, while the list, SRT
  exports and the timeline show the words as written. Projects and VTT exports keep the
  list, as notes other programs ignore. `Ctrl/Cmd+Z` undoes a change.

  ![The Sounds like dialog, with diagonally to be said as dye-AG-nuh-lee](docs/screenshots/sounds-like.png)
- **Notes in [square brackets]:** if your team writes notes in the script inside square
  brackets, such as `[Wide shot, hold for the door]`, tick **Don't read notes in [square
  brackets]** in the text to speech settings. They're then left out of every reading, reading
  time and auto end, and out of the exported description track, but stay in the script and
  in SRT and VTT exports.
- **Ends set from the reading:** while text to speech is on, a new block made with `Enter` or
  `N` takes its end from how long the reading takes, and keeps following it as you type
  or change the speed. An `auto` tag next to its end time shows this. It never runs into the next
  block. Once you set the end yourself, by dragging, `S`, `E` / `R` or typing its end time,
  the block keeps it. Blocks marked with `H`, drawn on the timeline or opened from a file
  are never changed. You can turn this off in the text to speech settings.
- **Make all readings:** with a Piper, Kokoro or Google voice, a button in the text to
  speech settings reads every block now, at its own speed, without changing any timings.
  Each block then plays straight away and its length is exact, and the readings are kept in
  your browser for next time. While playing, Scribecue also reads the next two blocks ahead.
- **Update all timings:** a button in the text to speech settings sets the end of every block
  with text from its reading, using each block's own speed. It asks first, because it also
  changes blocks marked with `H` or opened from a file, and `Ctrl/Cmd+Z` undoes it. Ends never run
  into the next block, and from then on each end follows its reading as you edit the text. With a [Piper](VOICES.md#piper-voices), [Kokoro](VOICES.md#kokoro-voices) or [Google](VOICES.md#google-cloud-voices) voice the lengths are always exact.
  With a browser voice, tick **Read each block silently first** for exact lengths. That
  takes about as long as reading them all, shows its progress, and can be stopped.
- **Timing check:** the editor shows how long the reading takes, such as `TTS 2.9 s`, in red
  if it's longer than the block, and the list shows that block's duration in red. `~`
  means it's an estimate. It becomes exact once the block has been read, and the estimates
  get more accurate for a voice as you use it.
- **Readings made:** a dot (●) after a block's duration in the list means its reading has
  been made with the chosen voice, at its speed and the base speed, so its length is exact.
  With a Piper, Kokoro or Google voice, it also means the reading is kept in your browser:
  it plays straight away, even after you reload or reopen Scribecue, and a Google reading
  isn't sent to Google again. Up to 250 MB of readings are kept; when that fills up, Piper
  and Kokoro readings go first, since they're free to make again, then the ones used
  longest ago. **Settings**, under **Storage**, shows how many there are and can clear them.
