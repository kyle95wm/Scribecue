# Mixing

Scribecue makes the files a mix needs. It won't get a mixing mode of its own: a DAW
already does that well, and audio plugins don't work reliably in a browser.

- **For a quick mix,** use text to speech and **Export → Full mix**.
- **For a finished mix,** export the parts and mix them in your DAW.

## Contents

- [Which file to use](#which-file-to-use)
- [A text to speech mix](#a-text-to-speech-mix)
- [Text to speech in a DAW](#text-to-speech-in-a-daw)
- [Recorded narration in a DAW](#recorded-narration-in-a-daw)
  - [The narration WAV](#the-narration-wav)
  - [Pickups and alts](#pickups-and-alts)
- [Extended blocks](#extended-blocks)
- [Before you send the mix back](#before-you-send-the-mix-back)

## Which file to use

| You have | You want | Export |
| --- | --- | --- |
| Text to speech | One file, mixed for you | **Full mix**, in Write mode |
| Text to speech | The readings, to mix yourself | **Description track**, or **Full mix** with **Stems** on |
| A script, no audio yet | Block places in your DAW, to record or place lines there | **DAW markers** |
| A narrator's recording | The narration, to mix | **Narration WAV**, or **Narration zip** with alts, in Record mode |
| Pickups | Only the new takes | **Pickups WAV**, in Record mode |
| Extended blocks | A picture that stops for them | **Extended video**, and the **Pause list** |

The narrator exports the narration. Everyone else gets it from them.

## A text to speech mix

In Write mode, what you hear while playing is what the full mix sounds like. Set it up
there first.

| Setting | Where | What it does |
| --- | --- | --- |
| **Video / TTS** | Slider under the video | How loud the readings are against the programme |
| **Lower the original audio** | Text to speech settings | How far the programme goes down under each reading, and how quickly |
| **Dip** | The open block | That block's dip: more, less or none |
| **Vol** | The open block | That block's reading: quieter or louder |

Then choose **Export → Full mix**. Under **Export full mix**, in the text to speech
settings, pick:

- **Save as:** WAV, or a much smaller MP3.
- **Loudness:** as it comes, or a target, such as −23 LUFS for broadcast in Europe or
  −24 LUFS in North America.
- **Stems:** also save the lowered programme and the readings on their own.

To put the mix into the video, see [Putting it in the video](WRITING.md#putting-it-in-the-video).

The full mix needs a Piper, Kokoro, Google or Amazon Polly voice. Browser voices can't be
saved.

## Text to speech in a DAW

Use one of these, at full length so they line up from the start of the programme:

- **Description track:** every reading in one file, at the same level. Choose WAV under
  **Save as** for the final mix.
- **Stems** from the full mix: the readings, and the programme already lowered under them.
  Use them to adjust a mix you mostly like.

For the programme's own sound, use the original video's audio. See
[Voices](VOICES.md#good-to-know) for how readings are levelled.

## Recorded narration in a DAW

A narrator records in [Record mode](RECORDING.md) and sends you the narration. Takes are
raw: nothing is processed, so EQ, compression and noise reduction are yours to do.

### The narration WAV

It's one Broadcast WAV file:

- Mono, 48 kHz, 24-bit, as long as the programme.
- Silent apart from the takes, each where it was read.
- Timestamped with the programme's start.
- Marked at each block, with its number and first words.

To bring it in:

1. Import the WAV onto its own track.
2. Place it at its timestamp. In Pro Tools, use **Spot to original time stamp**.
3. Check the markers came in. Reaper and Nuendo read them.

The narrator also sends a list of blocks with no take, takes that run long and quiet
takes. A zip has it inside. Read it before you start.

### Pickups and alts

A **Pickups WAV** is the same, with only the new takes in it.

1. Put it on its own track, over the first narration.
2. Mute the old takes under each pickup.

Its markers say `PICKUP`, with the writer's note.

A **Narration zip** comes when the narrator recorded alts:

| File | Holds |
| --- | --- |
| `…-narration.wav` | The narration |
| `…-alts.wav` | Only the alts, as long as the programme |
| `…-notes.txt` | Each alt's wording, and the notes for you |

Put the alts on their own track. To use one, mute the narration under it. Its markers say
`ALT`, with the wording.

## Extended blocks

With extended blocks, the programme stops while a block is read. The narration runs longer
than the video, so mix against a picture that stops too.

1. Open the script and the programme's video.
2. Open the full narration WAV or zip. The check opens.
3. Turn off **Include the narration**, so you get the programme's sound alone.
4. Click **Export extended video**.
5. Click **Export pause list** for a CSV of where the video stops and for how long.

Make it from the narration, not from Write mode. The narrator's reads rarely take as long
as text to speech did. See [An extended video for the narration](RECORDING.md#an-extended-video-for-the-narration).

A pickup of an extended block can move the pauses after it. Ask for the whole narration
again, not only a pickups WAV.

## Before you send the mix back

- **Check the narration matches the script:** open the script, then the narration WAV.
  Scribecue lists any block that differs. See [Checking the narration](RECORDING.md#checking-the-narration).
- **For QC:** the reviewer needs a review mix: a video with the narration and the
  programme together. See [QC review](QC.md).
