# Features

What Scribecue does, and where each part works: the web version at
**<https://scribecue.kyleadvoice.ca/>**, or your own copy [run with Docker](Guides/INSTALL.md).

- ✓ works with nothing extra.
- A container name means it works once that container is added to Docker. See
  [Running it yourself](Guides/INSTALL.md).
- Most features work the same in both. The ones that differ are in **bold**.

## Writing and editing

| Feature | Web version | Docker |
|---|---|---|
| Write, Transcribe, QC and Record modes | ✓ | ✓ |
| Blocks on the timeline, timing keys and loops | ✓ | ✓ |
| Familiar Frazier keys, and changing keys | ✓ | ✓ |
| Spelling and grammar check | ✓ | ✓ |
| Dialogue lane from the video's subtitles | ✓ | ✓ |
| Dialogue lane from OpenSubtitles, with your own key | ✓ | ✓ |
| Dialogue lane from speech to text, for a video with no subtitles | ✓ Whisper in the browser, or OpenAI | ✓ `whisper` container, or OpenAI |
| Fix the dialogue lane: take lines out, trim their ends | ✓ | ✓ |
| Floating the video | ✓ | ✓ |
| Comments and bookmarks | ✓ | ✓ |
| Extended blocks, which pause the video | ✓ | ✓ |

## Voices

| Voice | Web version | Docker |
|---|---|---|
| Your computer's voices | ✓ | ✓ |
| Online voices from the browser | ✓ | ✓ |
| **Piper** | ✓ Downloaded into the browser, about 100 MB for the first voice | `piper` container, a little faster |
| **Kokoro** | No, but a [QC package](Guides/QC.md) plays the writer's Kokoro readings | `kokoro` container |
| Google Cloud | ✓ With your own key | ✓ With your own key |
| Amazon Polly | ✓ With your own key | ✓ With your own key |

See [Voices](Guides/VOICES.md).

## Speech to text

| | Web version | Docker |
|---|---|---|
| **Whisper** | ✓ `base.en`, a 166 MB download into the browser | `whisper` container, `small.en`, more accurate |
| **Other Whisper models** | No | ✓ With `WHISPER_MODEL` |

See [The web version and Docker compared](Guides/TRANSCRIBING.md#the-web-version-and-docker-compared).

## Opening files

| Feature | Web version | Docker |
|---|---|---|
| SRT, WebVTT and Frazier `.adc` scripts | ✓ | ✓ |
| Recents: projects and packages opened lately, in Chrome and Edge | ✓ | ✓ |
| Projects in Google Drive, with autosave in any browser | ✓ | ✓ at `localhost:8484` |
| Videos the browser plays: MP4, MOV, MKV, WebM | ✓ | ✓ |
| AC-3 and E-AC-3 sound | ✓ | ✓ |
| **Make a copy that plays**, for videos or sound the browser can't play | No | `ffmpeg` container |

## Exporting

| Export | Web version | Docker |
|---|---|---|
| Scripts: SRT and WebVTT | ✓ | ✓ |
| Description track, WAV or MP3 | ✓ | ✓ |
| Full mix, WAV or MP3, with stems and loudness | ✓ | ✓ |
| **Full mix as AAC, AC-3 or E-AC-3** | No | `ffmpeg` container |
| **Full mix in the video** | ✓ Without subtitle tracks | ✓ With the `ffmpeg` container, subtitle tracks too |
| **Extended video** | The audio and an ffmpeg command | `ffmpeg` container, or the command |
| **Video with subtitles** | The script and an ffmpeg command | `ffmpeg` container, or the command |
| DAW markers and pause list | ✓ | ✓ |
| Narration WAV and session package (Record mode) | ✓ | ✓ |

See [Exporting](Guides/GETTING-STARTED.md#exporting) and [Mixing](Guides/MIXING.md).

## AI help

| Feature | Web version | Docker |
|---|---|---|
| AI providers, with your own key | ✓ | ✓ |
| **Ollama app on your computer** | ✓ Once `OLLAMA_ORIGINS` allows the web version | ✓ Nothing extra |
| **Ollama in a container** | No | `ollama` container |
| Draft the whole script | ✓ | ✓ |
| Look up the cast with TMDB | ✓ | ✓ |

See [AI help](Guides/AI.md).

## Sharing

| Feature | Web version | Docker |
|---|---|---|
| Sharing a project live, encrypted | ✓ | ✓ |
| Recovery links | ✓ | ✓ Opens in the web version unless you change the address |
| Shared projects in every browser, through Google Drive | ✓ | ✓ at `localhost:8484` |
| **Your own relay** | No, it uses Scribecue's | ✓ |

See [Sharing a project](Guides/SHARING.md).

## Running, updating and privacy

| | Web version | Docker |
|---|---|---|
| **Install** | Nothing to install | Docker Desktop and Git |
| Install as an app, with its own window | ✓ | ✓ Docker must be running |
| **Working offline** | ✓ Once opened, with voices and Whisper downloaded first | ✓ Always |
| **Where the app comes from** | GitHub Pages | Your computer |
| **Updates** | Automatic | By hand, with an optional daily check |
| **On another computer or server** | No | ✓ Behind HTTPS. See [On another computer](Guides/INSTALL.md#on-another-computer). |
| Video, audio and scripts stay on your computer | ✓ | ✓ |

Each copy keeps its own work in the browser. To move between them, see
[Moving your work](Guides/INSTALL.md#moving-your-work).
