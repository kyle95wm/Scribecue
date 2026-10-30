# Recording narration: a planned feature

> **Not built yet.** This is the outline of an idea, kept here so it can be picked up
> later. Nothing below is in Scribecue today, and the details may change.

Once a script is written and timed, someone has to voice it. The idea is that you'd hand
the narrator a **recording file**: the script, locked, which they open in Scribecue and
record against, line by line, in the gaps you've timed. Their raw takes go into a single
WAV file for the mixer, who brings it into a DAW and takes it from there.

Scribecue wouldn't become an audio editor. The narrator can't change the script or the
timings, and nothing is mastered or processed: the job is to get clean, raw takes that
fit their slots, at the right level, to the mixer.

## Contents

- [The workflow](#the-workflow)
- [The recording file](#the-recording-file)
- [Recording a line](#recording-a-line)
  - [What the narrator hears](#what-the-narrator-hears)
  - [Takes](#takes)
- [Fitting the slot](#fitting-the-slot)
- [Levels](#levels)
- [Keeping takes in sync](#keeping-takes-in-sync)
- [Exporting for the mixer](#exporting-for-the-mixer)
- [Where takes are kept](#where-takes-are-kept)
- [Technical notes](#technical-notes)

## The workflow

1. **You** finish the script in Scribecue, then export a recording file from it, setting
   the programme's starting timecode and frame rate.
2. **You** send the narrator the recording file and a copy of the video.
3. **The narrator** opens both in Scribecue, which opens in Record mode, and records each
   line, retaking any that run long or sit at the wrong level.
4. **The narrator** exports one WAV file and sends it to the mixer.
5. **The mixer** imports it into their DAW. It's timestamped, so it lands at the right
   timecode, and each line is marked.

## The recording file

- It holds the blocks, with their text and timings, the video's name and length (to check
  the narrator has the right copy), and the programme's starting timecode (for example
  01:00:00:00) and frame rate.
- It doesn't hold the video. As with projects today, the narrator opens their own copy.
- Opening it puts Scribecue in **Record mode**. The text and timings are locked: the
  narrator can record, play back, choose takes and export, and nothing else.
- It works in both the web version and the Docker version.

## Recording a line

The narrator selects a block and starts recording. The video plays from a few seconds
before the block (the **lead-in**), recording starts, and the narrator reads the line as
the picture reaches it. A bar shows how much of the slot is left as they read.

- The lead-in is 3 to 5 seconds. The narrator chooses how long in Settings.
- A live level meter shows during the lead-in, so the narrator can set their gain before
  the line starts.

### What the narrator hears

- **The video's sound,** lowered by 30 dB: enough to follow the scene and the dialogue
  around the line without it getting in the way. The slider under the video can still
  change it.
- **A guide reading on request:** a key plays the text to speech reading of the line,
  before taking it.
- Not their own voice. Narrators monitor themselves through their audio interface, which
  has no delay; hearing themselves through the browser would.

There are no countdown beeps.

### Takes

Every take is kept. The narrator can play each one back, against the video in its real
position, and chooses which one goes into the export.

## Fitting the slot

Each line's **slot** runs from its block's start to its end, plus **1 second of grace**.
The grace never goes past the next block's start, so takes can't overlap.

- A take that runs past its slot isn't cut off. Recording carries on, and the take is
  marked in red.
- Takes that run over don't stop the export, but the export warns about them and lists
  them in its report.

## Levels

Takes are raw. Scribecue doesn't process them: the browser's echo cancellation, noise
suppression and automatic gain are all turned off, so what's recorded is what the
microphone sent. Each take is checked by its loudest peak:

| Peak | Means |
| --- | --- |
| −12 to −8 dBFS | Right on target (−10 dBFS, give or take 2 dB) |
| −16 to −12, or −8 to −6 dBFS | Fine, with a gentle note |
| Below −16 dBFS | **Too quiet:** flagged, and the export warns about it |
| Above −6 dBFS | **Too loud:** the export won't go ahead until it's retaken |

These are the same for every job. A take that's too loud stops the export, and Scribecue
says which blocks need retaking and why.

## Keeping takes in sync

A take is only useful if it lands where the narrator read it. Two delays push it late: the
time between Scribecue playing the video and the narrator hearing it, and the time
between the narrator speaking and Scribecue getting the sound.

- **By default,** Scribecue corrects both using the delays the browser reports. With wired
  headphones and an audio interface or USB microphone, that's close enough: well within a
  frame.
- **Bluetooth headphones** add a lot more delay, often 150 to 300 ms, which the browser
  doesn't always report correctly. When the output looks like Bluetooth, Scribecue warns
  and suggests wired headphones or the sync test.
- **A sync test in Settings:** a flash and a beep, and the narrator raises or lowers a
  value in milliseconds until they happen together, as with a TV's A/V sync setting. It's
  saved and used for every take. It covers the delay in what the narrator hears, the one
  Bluetooth adds to, and the browser's figure covers the microphone side.
- **Playing a take back in context** lets the narrator hear for themselves that it sits
  where it should.

The 1 second of grace and the mixer's DAW leave room for a frame or two either way. What
matters is catching a large, steady delay that nobody noticed.

## Exporting for the mixer

The export is a single file:

- **One Broadcast WAV (BWF), mono, 48 kHz, 24-bit,** the length of the programme. It's
  silent apart from the chosen takes, each at its block's time.
- **Timestamped** with the programme's starting timecode, so a DAW can put it in the right
  place by itself (in Pro Tools, *Spot to original time stamp*).
- **A marker for each block,** with its number and the start of its text, for DAWs that
  read them, such as Reaper and Nuendo.

Before exporting, Scribecue checks every block:

- **Stops the export:** any chosen take that peaks above −6 dBFS.
- **Warns, but exports:** blocks with no take, takes that run past their slot, and takes
  that are too quiet. These go in a short report the narrator can send with the WAV.

## Where takes are kept

At 48 kHz and 24 bits, mono, a minute of recording is about 8.6 MB.

- **Web version:** in the browser's own storage. Clearing the site's data would lose the
  takes, so Scribecue needs to say so plainly, and Storage in Settings should show how much
  they use.
- **Docker version:** on disk, next to Scribecue.

## Technical notes

- **Recording raw audio:** the browser's built-in recorder (MediaRecorder) only makes
  compressed files. To write an uncompressed 24-bit WAV, Scribecue would capture the raw
  samples itself, with an AudioWorklet, and write the file itself, including the BWF
  timestamp and markers.
- **Sample rate:** if the narrator's interface runs at 44.1 kHz, the browser converts to
  48 kHz. That works, but Scribecue should mention that setting the interface to 48 kHz
  avoids it.
- **Choosing the input:** the narrator picks their microphone or interface, and which of
  its inputs, since the recording is mono.
- **Safari** records differently from Chrome and Firefox, and needs testing.
