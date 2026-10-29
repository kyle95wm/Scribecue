# Running Scribecue yourself

Most people don't need this page: the web version at **<https://scribecue.kyleadvoice.ca/>**
works in Chrome or Edge with nothing to install. See the [README](README.md) for how to
use Scribecue.

Run it yourself with Docker if you want everything, the app included, on your own
computer, or to run Piper voices, Whisper speech to text or Ollama in containers next to
it.

## Contents

- [What you need](#what-you-need)
- [Install](#install)
- [Starting and stopping](#starting-and-stopping)
- [Natural-sounding voices (Piper)](#natural-sounding-voices-piper)
- [Speech to text (Whisper)](#speech-to-text-whisper)
- [Ollama in Docker](#ollama-in-docker)
- [Updating](#updating)
- [If something goes wrong](#if-something-goes-wrong)
- [Development](#development)

## What you need

Three free things. Install any you don't have yet:

- **[Docker Desktop](https://www.docker.com/products/docker-desktop/)**, which runs
  Scribecue. On Linux, Docker Engine with the Compose plugin works too. Start it once
  after installing, and leave it running.
- **[Git](https://git-scm.com/downloads)**, to download Scribecue and its updates. It's
  already on most Macs and Linux computers.
- **A recent Chrome or Edge**, to use Scribecue in.

## Install

Open a terminal: **Terminal** on a Mac or Linux, or **PowerShell** on Windows. Run these
one at a time.

1. Download Scribecue:

   ```bash
   git clone https://github.com/kyle95wm/Scribecue.git
   ```

2. Go into its folder:

   ```bash
   cd Scribecue
   ```

3. Optional: for natural-sounding voices, add [Piper](#natural-sounding-voices-piper) now
   by creating a file called `.env` in the folder. On a Mac or Linux:

   ```bash
   echo "COMPOSE_PROFILES=piper" > .env
   ```

   On Windows, in PowerShell:

   ```powershell
   Set-Content .env "COMPOSE_PROFILES=piper"
   ```

   Piper adds about 1 GB to the download. You can also add it later.

4. Build and start it. The first time takes a minute or two:

   ```bash
   docker compose up -d --build
   ```

5. Open <http://localhost:8484> in Chrome or Edge.

A one-minute guided tour shows you around, then a short setup asks what you're working on
and turns on the tools for it. You can run the setup again any time with **Setup** at the
top, and the tour from the shortcuts overlay.

## Starting and stopping

Scribecue keeps running in the background, and starts again whenever Docker does, until
you stop it. In the `Scribecue` folder:

- To stop it: `docker compose down`
- To start it again: `docker compose up -d`

## Natural-sounding voices (Piper)

[Piper](https://github.com/OHF-Voice/piper1-gpl) can run in a second container next to the
editor. Its voices run on your computer, so your script never leaves it, and they work
offline. (The web version can download Piper voices into the browser instead; see the
README's [Piper voices](README.md#piper-voices).)

Until you add it, the text to speech panel ends with a short note about it:

![The Did you know? box about Piper at the bottom of the text to speech panel](docs/screenshots/piper-tip.png)

To add it, create a file called `.env` in the Scribecue folder containing:

```
COMPOSE_PROFILES=piper
```

Then build and start both containers:

```bash
docker compose up -d --build
```

The first build downloads Piper and its voices, about 1 GB in all. After that, Piper has no
internet access, and only Scribecue's own server can reach it. Reload Scribecue, switch to
Write mode, and pick a voice from the **Piper** group at the top of the voice menu.

Four English voices are included: Lessac and Ryan (US), and Alba and Alan (UK). To choose
others, add a line like this to `.env`, with names from the
[Piper voice list](https://huggingface.co/rhasspy/piper-voices), then build again:

```
PIPER_VOICES=en_US-lessac-medium en_GB-jenny_dioco-medium
```

To stop using Piper, remove the `COMPOSE_PROFILES` line from `.env` and run
`docker compose down`, then `docker compose up -d`.

## Speech to text (Whisper)

[Speech to text](TRANSCRIBING.md#speech-to-text-with-whisper) types each line you mark
with `H`, using [Whisper](https://github.com/SYSTRAN/faster-whisper) in a container next to
the editor. Like Piper, it has no internet access once it's built, and only Scribecue's
own server can reach it. Add `whisper` to the profiles in `.env`, for example:

```
COMPOSE_PROFILES=piper,whisper
```

Then build and start it:

```bash
docker compose up -d --build
```

The first build downloads Whisper and its model, about 1.6 GB in all. Reload Scribecue,
switch to Transcribe mode, click **STT** under the video, and tick **Fill in blocks as I
mark them**. A line takes about a second on a recent computer.

It uses the `small.en` model, which is accurate for English and quick on a processor. To
use another, add a line like this to `.env`, then build again:

```
WHISPER_MODEL=medium.en
```

`tiny.en` and `base.en` are faster and less accurate; `medium.en` is more accurate and
several times slower. Models without `.en`, such as `small` or `large-v3`, understand other
languages too.

## Ollama in Docker

[AI help](AI.md) can use Ollama, which runs AI models on your own computer.
Usually you'd install the [Ollama app](https://ollama.com), but it can also run in a
container next to Scribecue, with nothing installed outside Docker. Add `ollama` to the
profiles in `.env`, for example:

```
COMPOSE_PROFILES=piper,ollama
```

Then start it and download a model that can see images. This one is about 3 GB;
[AI.md](AI.md#ollama-models-by-computer) suggests bigger ones for more powerful computers:

```bash
docker compose up -d
```

```bash
docker compose exec ollama ollama pull gemma3:4b
```

In AI help's **Settings**, choose **Ollama** and click **Load models**. The models are kept
in a Docker volume, so they survive rebuilds. The container uses port 11434 on your own
computer, the same as the Ollama app, so quit the app if you have it: only one can run.

How fast it is depends on your computer:

- **Mac:** Docker can't use the Mac's graphics chip, so replies take much longer than with
  the Ollama app (about 25 seconds for a draft on an M-series Mac, against a few seconds).
  On a Mac, the app is the better choice.
- **Windows or Linux with an NVIDIA graphics card:** fast. Let the container use the card
  by adding `COMPOSE_FILE=docker-compose.yml:ollama-gpu.yml` to `.env` (on Windows, use
  `;` instead of `:`). On Linux this needs the
  [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html);
  Docker Desktop on Windows has it built in.
- **Other computers:** it works on the processor alone, but slowly. Use a small model.

To remove the models later, run `docker compose down`, then
`docker volume rm sub-editor_ollama-models` (the name starts with your Scribecue folder's
name; `docker volume ls` lists it).

## Updating

The first time you open Scribecue, its setup asks whether it may check GitHub for updates.

- **Check once a day:** GitHub sees the request and your IP address, like any website
  visit. Nothing about your files or text blocks is sent.
- **Don't check:** Scribecue never contacts anything outside your computer.

When a new version is out, an alert drops down at the top of the window with the update
steps and a link to what's new. **Later** hides it until you next open Scribecue, and
**Skip this version** hides it until a newer one comes out. The version number in the
bottom right also turns into **Update available**. Click it at any time to see the steps,
check now, or change your choice.

To update, run these in the `Scribecue` folder, then reload the page:

```bash
git pull
```

```bash
docker compose up -d --build
```

If you downloaded a zip instead, download the
[latest release](https://github.com/kyle95wm/Scribecue/releases/latest), replace the old
folder with it, and run `docker compose up -d --build` inside it.

Your text blocks and settings are kept, as long as you open Scribecue at the same address
and port as before.

## If something goes wrong

- **"Cannot connect to the Docker daemon"** or a similar error: Docker Desktop isn't
  running. Start it, wait until it says it's running, and try again.
- **"port is already allocated":** something else is using port 8484. Add a line such as
  `SCRIBECUE_PORT=9000` to the `.env` file (create it if it isn't there), run
  `docker compose up -d --build` again, and open <http://localhost:9000> instead.
- **The page doesn't load straight away:** wait a few seconds after starting it, then
  reload.
- **"Piper isn't answering":** the Piper container isn't running. Check that `.env` has
  `COMPOSE_PROFILES=piper`, then run `docker compose up -d --build`.
- **"The Whisper container isn't running":** check that `COMPOSE_PROFILES` in `.env`
  includes `whisper`, then run `docker compose up -d --build`.

## Development

The app is plain HTML, CSS and JavaScript with no build step. To run it without Docker:

```bash
python3 -m http.server -d app 8484
```

Served like this, the guides don't open inside Scribecue (links to them go to GitHub), since
they're copied next to the app only when the web version and the Docker image are built.

Run the checks before committing, pushing or opening a pull request:

```bash
scripts/check.sh
```

This checks the JavaScript syntax, runs the unit tests in `tests/`, then builds the Docker
image and checks that it serves the app with its security headers. Use
`scripts/check.sh --no-docker` to skip the Docker part. The same checks run on GitHub for
every push and pull request.

To release a new version:

1. Write the release's notes at the top of [app/changelog.json](app/changelog.json). The
   app shows them in its **What's new** window after an update, so write them for the
   people using it. The tests check the current version has some.
2. Change `VERSION` in [app/js/update.js](app/js/update.js) and in
   [app/sw.js](app/sw.js) to the new number, for example `0.2.0`. The tests check they
   match.
3. Run `scripts/check.sh`, then commit as "Release 0.2.0" and push. That commit message is
   what publishes the web version.
4. Publish a GitHub release with the same notes:

   ```bash
   gh release create v0.2.0 --target main --title "Scribecue 0.2.0" --notes-file <(node scripts/release-notes.mjs 0.2.0)
   ```

To retake the README screenshots after a visible change, run `scripts/screenshots.sh`. It
needs ffmpeg, Node, Python 3 and Google Chrome (set `CHROME` to its path if it isn't in
the usual Mac location), and uses a generated test video, not real programme material.
