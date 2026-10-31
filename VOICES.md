# Voices

Which voices Scribecue can read with, and how to add the more natural ones.

## Voices on your computer

Scribecue uses the voices built into your computer, so the text stays on it. For much more
natural voices that also stay on your computer, [use Piper](#piper-voices). Mac and
Windows come with several built-in voices. On Linux, browsers read through speech-dispatcher, so you may
need to install it with a voice such as espeak-ng from your distribution's packages.

**Online voices** are a separate opt-in in the same settings. They often sound more natural,
but each block's text is sent to the company that runs the voice, such as Google or
Microsoft, to be spoken. Leave them off if your script mustn't leave your computer.
They come from the browser, so which ones you get depends on where you open Scribecue:
Microsoft Edge has dozens, Chrome has a few Google voices, and Safari and Firefox have
none. They only work while you're online.

To add more voices that stay on your computer, then reload Scribecue:

- **Mac:** System Settings → Accessibility → Spoken Content, click ⓘ next to **System
  voice**, and download an "Enhanced" or "Premium" voice.
- **Windows:** Settings → Time & language → Speech, then **Add voices**.
- **Linux:** install more speech-dispatcher voices from your distribution's packages.

Not every browser lists every installed voice.

The browser's own voices can only be heard, not recorded. To export the readings as an
audio file, use a [Piper](#piper-voices), [Kokoro](#kokoro-voices) or [Google Cloud](#google-cloud-voices) voice.

## Piper voices

[Piper](https://github.com/OHF-Voice/piper1-gpl) is an open-source speech engine with
natural-sounding voices, and it's the one we recommend for audio description work. The
voices run on your computer, so your script never leaves it, and they work offline. In the [web version](#in-the-web-version) Piper runs in your
browser; [with Docker](#with-docker) it runs in a second container, next to the editor.

With a Piper voice:

- **Lengths are exact straight away.** The editor's `TTS` time, the red durations, block
  ends set from the reading and **Update all timings** all use the real reading, with no
  silent read-through.
- **Each line always takes the same time,** so the timing you see is the timing you get,
  between sessions and in the export.
- **You can export a description track.** **Export description track** in the text to
  speech settings saves every block's reading as one WAV file, each starting at its block's
  start, as long as the video. It's ready to mix with the programme. Every reading peaks at
  −8 dBFS, so blocks are evenly matched and there's headroom for processing and mastering;
  readings that run into the next block overlap in the file, never taking it past −6 dBFS,
  and Settings tells you how many there are.

Four English voices are offered: Lessac and Ryan (US), and Alba and Alan (UK).

### In the web version

Setup offers one: in its text to speech step, tick **Download a natural-sounding Piper
voice** and pick a voice, and it downloads in the background when you finish. Or, any
time, open the text to speech settings (`Alt+Shift+V`, or **Settings**), turn text to speech on, and under **Natural voices** pick a voice and click
**Download**. Each voice is about 63 MB. The first one also brings the speech engine,
about 33 MB, which all the voices share.
Once it's downloaded, the voice is chosen for you and works offline. The files come from
Scribecue's own site and stay in your browser; to free the space, pick the voice and click
**Remove**.

Readings take a moment longer than with Docker, as they run in the browser, but they're
the same length to the hundredth of a second.

### With Docker

Running Scribecue yourself, Piper can run in a container next to it instead, with four
English voices built in and others you choose. See
[Natural-sounding voices](INSTALL.md#natural-sounding-voices-piper) in INSTALL.md.

## Kokoro voices

[Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) is a newer open-source voice model
whose voices sound closer to a person reading than Piper's. Running Scribecue
[with Docker](#with-docker), it can run in its own container next to Piper or instead of
it, with 41 voices in US and UK English, Spanish, French, Hindi, Italian and Brazilian
Portuguese. They run on your computer and work offline, and everything above about Piper
voices applies to them too: exact lengths, the same time for each line, and the
description track. Readings take a second or two each, a little longer than Piper's.
To add it, see [More lifelike voices](INSTALL.md#more-lifelike-voices-kokoro) in INSTALL.md.
Kokoro needs Docker: its voices are too big and slow to run well in a browser, so the web
version's text to speech settings point you here instead.

## Google Cloud voices

Scribecue can also use Google Cloud's **Standard** text to speech voices, with your own
Google Cloud key, in the web version and with Docker. Like Piper voices, they make real
recordings, so lengths are exact straight away and you can export a description track.
Unlike Piper, each reading sends the block's text to Google, and they need the internet.
[GOOGLE-VOICES.md](GOOGLE-VOICES.md) is the full guide, including how to make sure you're
never billed.

1. In the [Google Cloud console](https://console.cloud.google.com/apis/library/texttospeech.googleapis.com),
   turn on the **Cloud Text-to-Speech API** for a project.
2. Under **APIs & Services**, **Credentials**, create an API key. Restrict it, so it's no
   use to anyone else who gets hold of it:
   - **API restrictions:** only the **Cloud Text-to-Speech API**.
   - **Application restrictions:** **Websites**, with the addresses you open Scribecue
     at: `https://scribecue.kyleadvoice.ca/*` for the web version, and
     `http://localhost:8484/*` for Docker (or your own port). Scribecue sends Google only
     its address, never anything else about the page.
3. In Scribecue, open **Settings**, choose **Text to speech**, and paste the key under
   **Google Cloud voices**.

The Standard voices in your languages then appear in the voice list, under
**Google Cloud**, and the first is chosen if you weren't using a Piper voice. **Forget**
removes the key and its voices.

If a project's voice isn't available, such as a Google voice in a browser without your key,
or a Piper voice while Piper isn't running, Scribecue says so and which voice is reading
instead. The text to speech settings say what to do about it. The project keeps its own
voice, so it's used again once it's back.

Each reading is kept in your browser, so a line is only sent to Google once, unless you
change its text, speed or voice. Reopening a project, playing it again or exporting the
description track uses the kept readings, which costs nothing, and lines already read play
offline. While you type in a block, its length is estimated and nothing is sent: it's read
when you finish editing it, with `Enter` or `Esc` or by moving to another block. Up to
250 MB of readings are kept, dropping Piper and Kokoro readings first, then the Google
ones used longest ago. **Settings**,
under **Storage**, shows how many there are and can clear them.

Google bills your Google Cloud account for the readings. Standard voices have a free
allowance each month, which is plenty for most scripts, but jobs such as **Fit speeds to
timings** read each block more than once. See
[Google's prices](https://cloud.google.com/text-to-speech/pricing). To make sure you're
never billed, [GOOGLE-VOICES.md](GOOGLE-VOICES.md#never-being-billed) shows how to have
Google Cloud turn billing off as soon as you go past the free allowance. The key stays in
your browser and is only sent to Google.
