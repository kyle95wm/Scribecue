# Recording narration

A narrator can record your script in Scribecue, block by block, against the video. The
mixer gets one WAV file that lands at the right timecode by itself.

The narrator can't change the script or the timings. Nothing is processed: the takes are
raw, for the mixer to work with.

## Contents

- [How it works](#how-it-works)
- [Making the recording file](#making-the-recording-file)
- [Recording](#recording)
  - [Before you start](#before-you-start)
  - [Recording a block](#recording-a-block)
  - [Levels](#levels)
  - [Takes](#takes)
  - [Keeping takes in sync](#keeping-takes-in-sync)
  - [Exporting the narration](#exporting-the-narration)
- [For the mixer](#for-the-mixer)
- [Checking the narration](#checking-the-narration)
- [Where takes are kept](#where-takes-are-kept)

## How it works

1. **You** export a recording file from your finished script.
2. **You** send the narrator the recording file and a copy of the video.
3. **The narrator** opens both in Scribecue and records each block.
4. **The narrator** exports the narration WAV and sends it to the mixer.
5. **The mixer** imports it into their DAW.
6. **You** can open the WAV in Scribecue to [check it](#checking-the-narration).

## Making the recording file

1. Open the script and its video in Write mode.
2. Choose **Export → Recording file**.
3. Type the timecode of the video's first frame, such as `01:00:00:00`.
4. Click **Save the file**.

Open the video first, so Scribecue can check the narrator has the same copy.

## Recording

### Before you start

- **Open the recording file and the video.** Scribecue opens in Record mode. Reloading
  the page keeps you there.
- **Use wired headphones.** You hear the video's sound 30 dB down, to follow the scene.
  You don't hear yourself through Scribecue: use your audio interface for that.
- **Choose your microphone** under **Microphone, lead-in and sync**. Pick the lead-in
  there too: 3 to 5 seconds of video before each block.
- **Set your interface to 48 kHz** if you can. Scribecue tells you if it's converting.
- **Use Chrome, Edge or Safari.**

### Recording a block

1. Select the block.
2. Press Enter or R. Allow the microphone the first time.
3. The video plays from the lead-in. Set your gain on the meter while it does.
4. Read the line when the picture reaches it. The bar shows how much of the slot is left.
5. Press Enter, R or Esc to stop. The take is saved straight away.

| Key | Does |
|---|---|
| Enter or R | Record the selected block, or stop |
| Esc | Stop recording |
| V | Hear the block read by text to speech, as a guide |
| Space | Play or pause |
| Alt+Shift+Left / Right | Previous or next block |

A block's **slot** is its time plus 1 second, but never into the next block. A take that
runs past it isn't cut off. It's marked in red, and the export mentions it.

### Levels

Each take is checked by its loudest moment:

| Peak | Means |
|---|---|
| −12 to −8 dBFS | On target |
| −16 to −12, or −8 to −6 dBFS | Fine |
| Below −16 dBFS | Too quiet: the export warns |
| Above −6 dBFS | Too loud: retake it, or the export won't go ahead |

### Takes

- Every take is kept, under the video in Record mode.
- **Play** plays a take against the video, where it was read.
- **Use** picks the take for the export. A new take is picked automatically.
- **Delete** removes a take for good.

### Keeping takes in sync

With wired headphones, Scribecue keeps takes in sync by itself.

Bluetooth headphones delay what you hear, often by 150 to 300 ms. Scribecue warns when
your headphones look like Bluetooth. If you have to use them:

1. Open **Microphone, lead-in and sync** and click **Sync test**.
2. Raise or lower **Sync** until the flash and the beep happen together.

Play a take back to check it sits where you read it.

### Exporting the narration

Choose **Export → Narration WAV**.

- Any take above −6 dBFS stops the export. Scribecue lists the blocks to retake.
- Blocks with no take, takes that run long, and quiet takes don't stop it. Scribecue lists
  them: send that list with the WAV.

## For the mixer

The narration is one Broadcast WAV file:

- Mono, 48 kHz, 24-bit, as long as the programme.
- Silent apart from the takes, each where it was read.
- Timestamped with the programme's start. In Pro Tools, use **Spot to original time
  stamp**.
- Marked at each block, with its number and first words, for DAWs that read markers,
  such as Reaper and Nuendo.

## Checking the narration

The recording file is plain text, so a narrator could change it in a text editor. You
can't stop that, but Scribecue shows it.

1. Open your script.
2. Open the narration WAV, as you'd open a video.

Scribecue lists any block whose text or timing differs from yours. It also says if the
recording file was changed by hand. Blocks you've changed since sending the file show up
too.

## Where takes are kept

A minute of takes uses about 8.6 MB.

- **The web version** keeps them in your browser. Clearing the browser's data for
  Scribecue deletes them, so export the narration when you're done.
- **In Docker,** add the [takes container](INSTALL.md#keeping-takes-on-disk) to keep them
  on disk instead.

Takes stay until you delete them. To delete them all, from every recording, click
**Delete all** next to **Recorded takes** in **Settings → Offline and storage**. You don't
need the recording file for that. Export any narration you still need first.
