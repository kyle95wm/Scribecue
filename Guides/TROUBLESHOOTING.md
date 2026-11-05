# Troubleshooting

Common problems, and a few odd ones, with what to do. Each guide also has its own list
for its part of Scribecue: see [More help](#more-help).

## Contents

- [Browser and computer](#browser-and-computer)
- [Video and sound](#video-and-sound)
- [Saving and your work](#saving-and-your-work)
- [Voices](#voices)
- [Recording](#recording)
- [Working offline](#working-offline)
- [QC](#qc)
- [More help](#more-help)
- [Reporting a problem](#reporting-a-problem)

## Browser and computer

| Problem | What to do |
| --- | --- |
| A notice says the browser is missing features | Use Chrome or Edge. The notice lists what won't work in this browser. |
| It won't open on a phone or tablet | Use a laptop or desktop. Scribecue needs a keyboard. |
| Everything is slow, or the video stutters | See [On a slower computer](GETTING-STARTED.md#on-a-slower-computer). |
| "Couldn't copy: the browser blocked clipboard access" | Allow the clipboard for Scribecue in the browser's site settings, or copy the text by hand. |

## Video and sound

| Problem | What to do |
| --- | --- |
| The video won't play, mostly on Linux | Some Chromium builds can't play MP4. See [If a video won't play](GETTING-STARTED.md#if-a-video-wont-play). |
| The picture sticks or flashes green while the sound carries on | The graphics chip may be failing to play it. See [If the picture freezes](GETTING-STARTED.md#if-the-picture-freezes). |
| The video plays, but there's no sound or waveform | Wait for **Getting the sound ready** to finish, if it shows. DTS and TrueHD don't play in most browsers. See [If a video has no sound](GETTING-STARTED.md#if-a-video-has-no-sound). |
| "No waveform: the audio track is silent" | Choose another track in the **Audio** picker under the video. |
| "Can't play track 2 on its own" | The browser can't play that track's format by itself, such as Vorbis. Choose another track, or convert the file. |
| A large file won't open | Use MP4, MOV, M4A, MKV, WebM or WAV. Other formats must be under 2 GB. |
| The video is gone after an update | Updating reloads the page. Click **Reopen**, or open the video with `Ctrl/Cmd+Shift+O`. |

## Saving and your work

| Problem | What to do |
| --- | --- |
| Saving downloads a new copy each time | That's Safari and Firefox. Use Chrome or Edge to save straight back to the file. |
| It says **autosave paused** | Click it. After a reload, the browser asks again before Scribecue may save to the file. |
| The video doesn't reopen with the project | Click **Reopen**. If the video has moved or changed, open it with `Ctrl/Cmd+Shift+O`. |
| Blocks and settings are gone, in Docker | Open Scribecue at the same address and port as before. Each address keeps its own work. |
| Worried the browser may clear your work | In **Settings → Offline and storage**, click **Keep it safe**. Saving a project keeps it safe either way. |
| Wrong blocks after **New** | Press `Ctrl/Cmd+Z` to bring them back. |

## Voices

| Problem | What to do |
| --- | --- |
| "This block has no text to read yet" | Type the line. Notes in [square brackets] aren't read. |
| A project's voice isn't available | Scribecue reads with another voice and says which. The project keeps its own voice for later. |
| "Piper isn't answering" or "Kokoro isn't answering" | The container isn't running. See [Running it yourself](INSTALL.md#if-something-goes-wrong). |
| "The Piper voice couldn't read that block" | Reload the page. |
| "Made 8 of 10 readings" | Some readings failed. Try again in a moment. |
| An online or Google voice won't read while offline | Choose a voice on your computer, or a Piper voice, in Settings. |
| Timings change on another computer | Another voice can take a different time to read. Send a [QC package](QC.md#make-a-portable-qc-package) instead, and use the same Piper voice on both. |

Google keys and billing have their own list: see [Google voices](GOOGLE-VOICES.md#if-something-goes-wrong).

## Recording

| Problem | What to do |
| --- | --- |
| "Scribecue needs permission to use the microphone" | Allow the microphone for Scribecue in the browser's site settings, then try again. |
| Takes sit late against the picture | Bluetooth headphones delay the sound. Use wired ones, or run the [sync test](RECORDING.md#keeping-takes-in-sync). |
| "That take is too loud" | Lower your interface's gain and record the block again. The export won't go ahead with it. |
| "Couldn't keep the take" | The disk or the browser's storage may be full. Export the narration, then delete takes you don't need. |
| Takes are gone after clearing browser data | Takes kept in the browser go with its data. Keep them in a folder instead: see [Where takes are kept](RECORDING.md#where-takes-are-kept). |
| "Resume in" shows under the video | The browser asks again after a reload. Click it, then **Allow**. |

## Working offline

| Problem | What to do |
| --- | --- |
| "Scribecue isn't ready to work offline yet" | Click it to see why. Usually, reload once while online. |
| A Piper voice or speech to text doesn't work offline | Download it first, while online. **Settings → Offline and storage** shows what's ready. |
| AI help doesn't work offline | Online providers need a connection. Ollama, on your computer, works offline. |

## QC

| Problem | What to do |
| --- | --- |
| "This review allows comments only" | The writer chose that when making the package. Ask for an editable one if you need to change blocks. |
| "Making a QC package needs browser disk storage" | Use a current Chrome or Edge. |
| "No matching original reading for this block" | The block changed since the package was made. Ask the writer for a new package. |
| The original readings are missing after a reload | Open the QC package again. |
| **Needs** and a voice's name under a block | Click **QC** under the video, then **Get the voices this review needs**. |

More in [QC review](QC.md#common-problems).

## More help

Each guide has a list for its own part:

- [Transcribing and speech to text](TRANSCRIBING.md#if-something-goes-wrong)
- [AI help](AI.md#if-something-goes-wrong)
- [Google voices](GOOGLE-VOICES.md#if-something-goes-wrong)
- [Running it yourself with Docker](INSTALL.md#if-something-goes-wrong)

## Reporting a problem

Found a problem that isn't here? Report it with the diagnostics:

1. Open **Settings**, then **General**, and click **Diagnostics…**.
2. Click **Copy**.
3. Open the [bug report form](https://github.com/kyle95wm/Scribecue/issues/new?template=bug_report.yml)
   and paste it into **Diagnostics**.

They show your browser, the video's format, how playback is going and recent errors.
Nothing is sent by Scribecue. File names are left out unless you click **Include file names**.
Issues are public, so read the diagnostics before you post them.

For a problem that happens while you work, such as a slow jump, open the diagnostics
straight after it happens, before reloading the page.

Using Claude Code or Codex in a copy of Scribecue? Paste the diagnostics and ask it to help
you report the problem. It checks for known causes and drafts the report for you to approve.
