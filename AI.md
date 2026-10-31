# AI help

An AI model can draft a block from stills of the video, or answer questions about a
scene.

**AI can't write audio description on its own yet.** It misreads scenes, misses what
matters, and sometimes describes things that aren't there. Treat every draft as a
starting point. You're still the describer.

## Contents

- [What it does](#what-it-does)
- [Choosing where it runs](#choosing-where-it-runs)
- [Connecting a provider](#connecting-a-provider)
  - [Claude, OpenAI or Gemini](#claude-openai-or-gemini)
  - [OpenRouter](#openrouter)
  - [Ollama, on your own computer](#ollama-on-your-own-computer)
- [Choosing a model](#choosing-a-model)
  - [Online models](#online-models)
  - [Ollama models, by computer](#ollama-models-by-computer)
- [Getting the best descriptions](#getting-the-best-descriptions)
- [Privacy](#privacy)
- [Costs](#costs)
- [If something goes wrong](#if-something-goes-wrong)

## What it does

Click **AI** at the top, or press `Alt+Shift+A`, and a drawer slides out beside the video.

![The AI help drawer beside the video, with a draft for a block](docs/screenshots/ai-help.png)

- **Draft this block:** select a block and click it. Scribecue sends stills from the block,
  the script around it, and how many words fit. **Use for block #n** puts the draft in the
  block, and **Try again** asks for another.
- **Chat:** ask about the scene, such as "what's on the sign behind her?". Tick **Send the
  frame at the playhead** so it sees the frame you're on.
- **Notes:** tell the AI what the frames can't show, such as who's who. Every draft and
  message includes them, and they're saved with the project.
- **New chat** starts again.

## Choosing where it runs

| | Online (Claude, OpenAI, Gemini, OpenRouter) | Ollama, on your computer |
| --- | --- | --- |
| **Quality** | The best available. The top models describe scenes far more accurately than anything a laptop can run. | Good with a big model on a powerful computer; rougher with the small ones. |
| **Privacy** | Frames and nearby blocks go to the provider, under its terms. | Nothing leaves your computer. |
| **Cost** | A cent or two per draft with the best models; less with smaller ones. | Free, once you have the computer. |
| **Speed** | A few seconds. | From a couple of seconds to a minute, depending on the computer and model. |
| **Set-up** | Paste a key, or sign in. | Install Ollama and download a model. |

**For programmes under a confidentiality agreement, or not yet broadcast, use Ollama** unless
you're sure your contract allows sending frames to an AI provider.

## Connecting a provider

1. Open **AI**, then **Settings**, and pick the provider.
2. Connect it, as below.
3. Click **Load models**, and pick a model. Only models that can look at frames are listed.
4. Click **Save and connect**.

Keys stay in your browser, and are only sent to their own provider. Tick **Remember the
key on this computer** to keep it after you close the tab.

### Claude, OpenAI or Gemini

Paste an API key from the provider's site:

- **Claude** (Anthropic): [console.anthropic.com](https://console.anthropic.com/settings/keys)
- **OpenAI**: [platform.openai.com](https://platform.openai.com/api-keys)
- **Gemini** (Google): [aistudio.google.com](https://aistudio.google.com/app/apikey)

API usage is billed by the provider per request, separately from any ChatGPT, Claude or
Gemini subscription. Providers usually ask you to add some credit first.

### OpenRouter

[OpenRouter](https://openrouter.ai) gives one account for models from Anthropic, OpenAI,
Google and others, paid with OpenRouter credit. Click **Sign in with OpenRouter** and approve, or
paste an OpenRouter key.

### Ollama, on your own computer

[Ollama](https://ollama.com) runs AI models on your own computer.

1. **Install it** from [ollama.com/download](https://ollama.com/download) (Mac, Windows and
   Linux). It runs in the background and waits at `localhost:11434`.
2. **Download a model that can see images** (see
   [Ollama models, by computer](#ollama-models-by-computer)). In a terminal:

   ```bash
   ollama pull gemma4:12b
   ```

3. **If you use the web version,** let it reach Ollama, then restart Ollama. Running
   Scribecue yourself with Docker, at `localhost`, needs nothing extra.
   - **Mac:** run this, then quit Ollama from the menu bar and open it again.

     ```bash
     launchctl setenv OLLAMA_ORIGINS "https://scribecue.kyleadvoice.ca"
     ```

   - **Windows:** run this in Command Prompt, then quit Ollama from the system tray and start
     it again.

     ```bash
     setx OLLAMA_ORIGINS "https://scribecue.kyleadvoice.ca"
     ```

   - **Linux:** run `sudo systemctl edit ollama.service`, add these lines, then
     `sudo systemctl restart ollama`.

     ```
     [Service]
     Environment="OLLAMA_ORIGINS=https://scribecue.kyleadvoice.ca"
     ```

   If Chrome asks whether the site may access devices on your local network, allow it: that's
   Ollama on your own computer.
4. **Connect:** in AI **Settings**, choose **Ollama (on this computer)**, keep the address,
   click **Load models**, and pick yours. Models you've downloaded that can't see images
   aren't listed.

Running Scribecue with Docker, Ollama can also run in a container next to it; see
[Ollama in Docker](INSTALL.md#ollama-in-docker). On a Mac the Ollama app is much faster,
because Docker can't use the Mac's graphics chip.

## Choosing a model

The model matters more than anything else.

### Online models

- **Claude Opus 5.5** (`claude-opus-5-5`, the default with a Claude key): Anthropic's
  most capable everyday model: careful, concise, and good at keeping to the time available.
- **Claude Sonnet 5.5** (`claude-sonnet-5-5`): nearly as good, at about half the price. A
  sensible everyday choice.
- **Claude Haiku 5.5** (`claude-haiku-5-5`): very cheap and fast, for rough first drafts.
- **OpenAI:**
  - **GPT-6.1 Sol** (`gpt-6.1-sol`): the one to start with. Good and inexpensive, for
    everyday drafting.
  - **GPT-6 Astra** (`gpt-6-astra`): OpenAI's most capable, at about five times the price,
    for busy or tricky scenes.
  - **GPT-6 Luna** (`gpt-6-luna`): very cheap and fast, for rough first drafts and quick
    questions.
- **Gemini:** pick its newest model from the list **Load models** shows. Gemini's Flash
  models are fast and inexpensive.
- **Through OpenRouter**, the same models have names like `anthropic/claude-sonnet-5.5` and
  `google/gemini-3.8-flash`. With a direct Claude key, Scribecue also sets the model's effort
  and turns on Anthropic's automatic fallback to another Claude model if a request is
  declined; through OpenRouter those extras aren't available.

### Ollama models, by computer

What you can run depends on your computer's memory: on a Mac with Apple silicon, its
memory; on a PC, mostly its graphics card's memory. Leave about half as much again as the
download size free. Try two models on the same few blocks, and keep the one you like.

| Memory | Suggested models | Download |
| --- | --- | --- |
| **8 GB** | `gemma3:4b`, `qwen3-vl:4b` | about 3.5 GB |
| **16 GB** | `gemma4:12b`, `qwen3-vl:8b` | 6–8 GB |
| **32 GB** | `gemma4:26b`, `gemma4:31b`, `qwen3-vl:30b` | 16–20 GB |
| **48–64 GB** | `gemma4:31b`, `qwen3-vl:32b`, `qwen3.8:27b` | 18–21 GB, with room to spare for more frames |
| **A workstation with 192 GB or more** | `qwen3-vl:235b` | about 143 GB |

Notes on them:

- **Gemma 4** (Google) is the newest Gemma, and its larger sizes are the first we'd try on
  a powerful Mac or PC. On a Mac, tags ending in `-mlx`, such as `gemma4:26b-mlx`, use
  Apple's own framework and may run faster.
- **Qwen3-VL** (Alibaba) is a family built for vision, from tiny to huge, and good at
  reading text on screen, such as signs and captions.
- **Qwen 3.8** thinks before it answers: slower, but sometimes more careful with a busy
  scene.
- **Small models** (4b and under) are fine for trying AI help out, and for questions like
  "is anyone else in the room?", but expect to rewrite most of their drafts.
- Ollama's own [list of vision models](https://ollama.com/search?c=vision) shows what's
  new. Models marked **cloud** run on Ollama's servers, not your computer.

**Make it faster:**

- Keep the model in memory between drafts: start Ollama with `OLLAMA_KEEP_ALIVE=30m` (set it
  the same way as `OLLAMA_ORIGINS` above). The first draft after a pause loads the model,
  which can take a while for a big one.
- Use a graphics card or Apple silicon: a model on the processor alone is many times
  slower.
- Fewer frames per draft are quicker; three is a good balance.

Scribecue asks Ollama to keep room for 8,192 tokens, enough for several frames and the
script around a block. A model that needs more can take a higher `OLLAMA_CONTEXT_LENGTH`.

## Getting the best descriptions

1. **Write project notes.** This helps more than anything after the model. Tell the AI what
   it can't see in a still:
   - who's who, and how to tell them apart: "Mara: woman in her 40s, short grey hair, red
     coat. Her son Theo, about 10, curly hair.";
   - where and when: "A hospital in Leeds, winter, present day.";
   - your team's style: "Present tense. Name characters once they've been introduced.
     British spelling. No 'we see'."

   **Look up the cast**, under the notes, fills in the character names for you: paste the
   programme's IMDb link (an episode's own link adds its guest cast too), or type its title,
   and click **Look up**. The characters and their actors come from
   [TMDB](https://www.themoviedb.org/), a free film and TV database, and are added below
   your notes, ready to add how to tell people apart. It needs your own free TMDB key: the
   first time, Scribecue asks for it, with a link to
   [get one](https://www.themoviedb.org/settings/api). Only the link or title goes to TMDB.
2. **Send enough frames.** With 3 frames, something that happens briefly in the block can be
   missed; try 5 for busy scenes. Frames are taken from inside the block, so time the block
   to the gap you're describing first.
3. **Correct it, then try again.** The drawer keeps the conversation, so tell it what it got
   wrong ("that's a man, and he's holding a phone, not a gun") and click **Try again**.
4. **Ask instead of drafting.** For a tricky shot, chat first: "what's changed since the
   last shot?", "what does the sign say?". Then draft.
5. **Keep the script tidy around the block.** The AI reads the blocks before and after, so
   good descriptions there help it match your style and not repeat itself.
6. **Mind the word count.** Each draft is told how many words fit, from the block's length
   and the voice's speed. With text to speech on, check the reading time afterwards: red
   means it runs over.

And always check a draft against the picture: AI is confident even when it's wrong.

## Privacy

- Nothing is sent anywhere until you connect a provider and send a message or ask for a
  draft.
- With an online provider, each message or draft sends the frames it uses, the selected
  block and those around it, and your project notes, to that provider only, under its terms.
  Scribecue's own server never sees them.
- With Ollama, everything stays on your computer.
- Keys stay in your browser, and only go to their own provider. Your TMDB key, if you look
  up a cast, only goes to TMDB, with the IMDb link or title you looked up.

## Costs

Online providers charge by the amount sent and received. A draft with 3 frames sends about
2,000 tokens and gets a short reply back: roughly 1–2 cents with Claude Opus 5.5, about a
cent with Sonnet 5.5, and a fraction of a cent with Haiku 5.5. With OpenAI, it's about
2–3 cents with GPT-6 Astra, half a cent with GPT-6.1 Sol, and a tiny fraction of a cent
with GPT-6 Luna. These are estimates; your
provider's dashboard shows the real figures. Long chats cost more, though only the latest
messages resend their frames. Ollama costs nothing to use.

## If something goes wrong

- **"didn't accept the key":** the key is wrong, expired, or has no credit. Make a new one on
  the provider's site and paste it in Settings.
- **"doesn't know that model":** pick another with **Load models**.
- **"Couldn't reach Ollama":** check Ollama is running (its icon in the menu bar or system
  tray). In the web version, check `OLLAMA_ORIGINS` (above) and that you restarted Ollama
  after setting it.
- **"The model declined to answer":** some scenes, such as violence, trip a provider's safety
  checks. Reword the request, or try another model.
- **Drafts are slow:** see [Make it faster](#ollama-models-by-computer). Online, a busy
  provider can be slow; try again in a minute.
- **Drafts are poor:** try a bigger model, write project notes, send more frames, and
  correct it in the chat; see [Getting the best descriptions](#getting-the-best-descriptions).
- **Ollama runs out of memory:** pick a smaller model, or close other apps.
