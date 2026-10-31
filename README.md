# Scribecue

**A keyboard-first editor for audio description scripts.**

- **Write** new audio description, and hear each line read aloud to check it fits before
  the next piece of dialogue.
- **Transcribe** existing audio description: hold a key while the narrator speaks, and a
  block appears at that time. Speech to text can type the line for you.
- **Private:** your video, audio and scripts are never uploaded.
- **Familiar keys** if you've used Frazier.
- Opens and saves SRT and WebVTT scripts, and opens Frazier's `.adc` scripts.

![Scribecue with a video, its audio description track and five text blocks on the timeline](docs/screenshots/main.png)

## Get started

### Use it in your browser

1. Open **<https://scribecue.kyleadvoice.ca/>** in Chrome or Edge.
2. Follow the short tour and setup. You can skip either.

To give Scribecue its own window and icon, click **Install app** in the bottom right.

**Which browser:** Scribecue is built for Chrome and Edge. Brave, Opera, Vivaldi and Arc
usually work too. Safari and Firefox can open it, but some features may be missing, and
Scribecue tells you which. Phones and tablets aren't supported, because Scribecue needs a
keyboard.

**Working offline:** once you've opened Scribecue, it works without a connection. So do
Piper voices and speech to text, once downloaded. **Settings → Offline and storage** shows
what's ready for offline use, and has **Remove all data** to clear everything Scribecue
keeps in your browser. Your project files aren't touched.

### Or run it yourself

Run Scribecue on your own computer with Docker to keep everything there, the app
included, and to add Kokoro voices and more. [Running it yourself](INSTALL.md) walks you
through it. In the web version, **Settings → General → Run it on your computer** opens
that guide.

## Guides

The guides also open inside Scribecue: press `?` and click **Guides**.

- [Getting started](GETTING-STARTED.md): the two modes, the loop you work in, saving and exporting.
- [Writing with text to speech](WRITING.md): hearing your lines, speeds and timing.
- [Voices](VOICES.md): the voices on your computer, Piper, Kokoro and Google.
- [Transcribing](TRANSCRIBING.md): marking existing audio description, and speech to text.
- [AI help](AI.md): drafting descriptions with an AI model.
- [Keyboard shortcuts](SHORTCUTS.md): every key, and how to change them.
- [Google voices](GOOGLE-VOICES.md): setting up Google Cloud voices without being billed.
- [Running it yourself](INSTALL.md): Docker, Piper, Kokoro, Whisper and Ollama.

## Privacy

- **Your files stay on your computer.** Video, audio and scripts are opened from your disk
  and never uploaded.
- **Nothing else is contacted unless you turn it on.** A strict security policy blocks the
  page from reaching other sites, except for things you choose to use:
  - the [update check](#updating) in the Docker version, if you agree to it;
  - an [AI provider](AI.md), once you connect one, when you send a message or ask for a
    draft;
  - TMDB, when you click **Look up the cast** in AI help;
  - [online voices and Google Cloud voices](VOICES.md), which send each line's text to be
    read.
- **Piper, Kokoro and speech to text run on your computer,** in your browser or in
  containers with no internet access. Your audio never leaves your computer.
- **The web version** is downloaded from GitHub Pages the first time and when it updates.
  To keep even that on your computer, [run it yourself](INSTALL.md).

## Updating

The web version updates itself. If an update arrives while you're working, the version
number in the bottom right says **update ready**: click it, or open Scribecue again later.

If you run it yourself, see [Updating](INSTALL.md#updating).

## To do

- [ ] **Recording narration:** a narrator records each line against the video, in the
  slots you've timed, and the mixer gets one timestamped WAV. The plan is in
  [RECORDING.md](RECORDING.md).
- [ ] **Export a full AD mix:** the programme's sound with the readings, the programme
  dipping under each one, as a stereo WAV, or an MP3 for a much smaller file. The
  description track on its own could be saved as MP3 too. Settings for how far and how
  quickly it dips, and the levels, with playback sounding the same as the export. Later,
  a loudness target, per-block settings and separate stems. With Docker, an ffmpeg
  container could also handle 5.1, AC-3 and DTS, and put the mix back into the video.

## Development

Scribecue is plain HTML, CSS and JavaScript, with no build step.
[Development](INSTALL.md#development) covers running it, the checks to run before
committing, and releases.

## Credits

The keyboard layout is modelled on [Frazier](https://www.videotovoice.com/) by
videotovoice, so writers who know Frazier don't need to relearn keys. Thanks to the
Frazier team for publishing their shortcut cheat sheet.

Voices use these open-source projects, downloaded only when you choose a voice or build
its container:

- [Piper](https://github.com/OHF-Voice/piper1-gpl) by the Open Home Foundation (GPL). In
  the web version it runs with [ONNX Runtime Web](https://github.com/microsoft/onnxruntime)
  by Microsoft (MIT), [piper-wasm](https://github.com/diffusion-studio/piper-wasm) and
  [espeak-ng](https://github.com/espeak-ng/espeak-ng) (GPL). Each voice has its own
  licence, on its [voice page](https://huggingface.co/rhasspy/piper-voices).
- [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) by hexgrad (Apache 2.0), run with
  [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) by thewh1teagle (MIT) and
  espeak-ng (GPL).

Scribecue is an independent project. It is not affiliated with, endorsed by or connected
to Frazier or videotovoice. Frazier is their product name, used here only to describe
familiar behaviour, such as the keyboard layout and how blocks are laid out and timed, and
to say which scripts Scribecue can open.

## License

[MIT](LICENSE)
