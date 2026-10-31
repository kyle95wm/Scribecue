# Scribecue

**A keyboard-first editor for audio description scripts.**

- **Transcribe** existing audio description at its original timing: hold a key while the
  narrator speaks and a block appears. Whisper, running on your computer, can type the
  line for you.
- **Write** new audio description, with text to speech to hear each line and check it fits
  before the next piece of dialogue.
- Runs on your own computer in Docker. Your files are never uploaded.
- Uses the same keyboard layout as Frazier, so Frazier users don't need to relearn keys.
- Scripts open and save as SRT or WebVTT files, and Frazier's `.adc` scripts open too.

![Scribecue with a video, its audio description track and five text blocks on the timeline](docs/screenshots/main.png)

## Quick start

### The easy way: use it in your browser

1. Open **<https://scribecue.kyleadvoice.ca/>** in Google Chrome or Microsoft Edge.
2. Optional: click **Install app** in the bottom right, or the install icon in the address
   bar. Scribecue then gets its own window and icon, like any other app, and works
   offline.

That's all. A one-minute guided tour shows you around first, then a short setup asks what
you're working on and turns on the tools for it, and a card shows the loop to work in.
You can skip any of them.

Your video, audio and scripts are opened straight from your computer and never uploaded:
only the app itself is downloaded, the first time and when it updates. It updates itself,
usually without you noticing: a new version is used as you open Scribecue, and one that
arrives while you're working waits until you click **update ready** on the version number,
or open Scribecue again. [Piper voices](VOICES.md#piper-voices) and
[speech to text](TRANSCRIBING.md#speech-to-text-with-whisper) work in the web version too: each is a one-time download
into your browser.

The web version used to be at `kyle95wm.github.io/Scribecue`, which now forwards here.
Work that was only kept in the browser there, such as unsaved blocks, settings and Piper
voices, doesn't come across, but project files you saved open here as usual.

Scribecue is built for Chrome and Edge. Browsers on the same engine, such as Brave, Opera,
Vivaldi or Arc, usually work just as well. Others, such as Safari and Firefox, can open it,
but some features may not be available or work well. Scribecue checks what your browser
can do, and tells you if anything is missing. In Firefox, for example, a file's description track can stutter, and speech to text
can interrupt the video's sound. Phones and tablets get a notice instead: Scribecue needs a
keyboard and a bigger screen. So do browsers from before 2022, which are too old to run it.

**Working offline:** once you've opened the web version, it works without a connection,
and so do Piper voices and Whisper once they're downloaded. **Settings**, under **Offline
and storage**, has a checklist of what this browser has for working offline, with buttons
for anything missing, and asks the browser to keep it all safe. The same section has
**Remove all data**, which clears everything Scribecue keeps in this browser (unsaved
blocks, settings, AI and Google keys, voices, Whisper and its offline copy) after a warning. Your
project files, and anything in Docker, stay as they are. The Docker version runs from your
computer anyway, so there the section is called **Storage**, and it's just about what's kept
in the browser. While you're offline, **offline** shows in the bottom right, and online AI
providers and online voices say they're unavailable rather than failing. The guides, such as this one, open inside Scribecue, so they work offline too.

### Or run it yourself

To keep everything, the app included, on your own computer, or to run Piper voices,
Whisper or Ollama in containers next to it, run Scribecue with Docker. [INSTALL.md](INSTALL.md) walks
you through it, and covers updating and troubleshooting. The web version mentions this once, after setup, and
**Run it on your computer** in Settings, under General, opens the guide any time.

## Guides

The guides also open inside Scribecue: press `?` and click **Guides**.

- [Getting started](GETTING-STARTED.md): the two modes, the loop you work in, saving and exporting.
- [Writing with text to speech](WRITING.md): hearing your lines, speeds and timing.
- [Voices](VOICES.md): the voices on your computer, Piper, Kokoro and Google.
- [Transcribing](TRANSCRIBING.md): marking existing audio description, and speech to text.
- [AI help](AI.md): drafting descriptions with an AI model.
- [Keyboard shortcuts](SHORTCUTS.md): every key, and how to change them.
- [Google voices](GOOGLE-VOICES.md): setting up Google Cloud voices without being billed.
- [Running Scribecue yourself](INSTALL.md): Docker, Piper, Kokoro, Whisper and Ollama.

## Privacy

- Video, audio and script files are opened straight from your disk and never uploaded.
- The [web version](#the-easy-way-use-it-in-your-browser) downloads the app itself from
  GitHub Pages, the first time and when it updates, so GitHub sees those requests. After
  that it works offline. Run it yourself with Docker to keep even that on your computer.
- The server only hands out the app's own files, and only to your own computer
  (`127.0.0.1`).
- A strict security policy stops the page from contacting any other site. The exceptions
  are the [update check](#updating), which only runs if you agree to it, the AI
  providers below, which are only contacted once you connect one, TMDB, for looking up
  a programme's cast, and Google Cloud's text to speech, once you add a key.
- [Text to speech](WRITING.md) uses the voices on your computer. Online voices, which
  send the text to their provider, are only offered if you turn them on.
  [Google Cloud voices](VOICES.md#google-cloud-voices) are only offered once you add your own key;
  then each reading sends the block's text to Google. Readings are kept in your browser
  afterwards, so the same line isn't sent again.
- [AI help](AI.md) is off until you connect a provider. Then, only when you send a
  message or ask for a draft, frames and nearby blocks go to the provider you chose, or
  stay on your computer with Ollama. The security policy allows those providers' addresses
  and nothing else. **Look up the cast**, in AI help's notes, sends only the IMDb link or
  title you type to TMDB, with your own key, when you click it.
- [Speech to text](TRANSCRIBING.md#speech-to-text-with-whisper) runs Whisper in your browser, downloaded from
  Scribecue's own site, or in its own container with no internet access, which the page
  reaches through Scribecue's server. The audio never leaves your computer.
- [Piper](VOICES.md#piper-voices), if you add it, runs in its own container with no internet access
  and no port of its own. The page reaches it through Scribecue's server. In the web
  version, Piper voices you download come from Scribecue's own site and run in your
  browser. [Kokoro](VOICES.md#kokoro-voices) runs the same way as Piper's container.

## Updating

**The web version** updates itself as you open it. An update that arrives while you're
working waits until you click **update ready** on the version number, or open Scribecue
again.

**Running it yourself with Docker:** see [Updating](INSTALL.md#updating) in INSTALL.md.

## To do

- [ ] **Recording narration.** Hand the narrator a locked recording file, so they can
  record each line against the video, in the slots you've timed, and send the mixer one
  timestamped WAV. Takes are raw, with their levels checked. The plan is in
  [RECORDING.md](RECORDING.md).

## Development

The app is plain HTML, CSS and JavaScript with no build step. How to run it, the checks
to run before committing, and how releases work are in [INSTALL.md](INSTALL.md#development).

## Credits

The keyboard layout is modelled on [Frazier](https://www.videotovoice.com/) by
videotovoice, an audio description tool, so writers who already know Frazier can switch
between the two without relearning keys. Thanks to the Frazier team for publishing their
shortcut cheat sheet.

The optional [Piper voices](VOICES.md#piper-voices) use [Piper](https://github.com/OHF-Voice/piper1-gpl)
by the Open Home Foundation, which is licensed under the GPL and downloaded when you build
its container. The web version runs Piper's voices with
[ONNX Runtime Web](https://github.com/microsoft/onnxruntime) by Microsoft (MIT) and
[piper-wasm](https://github.com/diffusion-studio/piper-wasm), the
[espeak-ng](https://github.com/espeak-ng/espeak-ng) build used by Piper (GPL), downloaded
only when you choose a voice. Each voice has its own licence, listed on its
[voice page](https://huggingface.co/rhasspy/piper-voices).

The optional [Kokoro voices](VOICES.md#kokoro-voices) use the
[Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) model by hexgrad (Apache 2.0),
run with [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) by thewh1teagle (MIT)
and espeak-ng (GPL), downloaded when you build its container.

Scribecue is an independent project. It is not affiliated with, endorsed by or connected
to Frazier or videotovoice. Frazier is their product name, used here only to describe
familiar behaviour, such as the keyboard layout and how blocks are laid out and timed, and
to say which scripts Scribecue can open.

## License

[MIT](LICENSE)
