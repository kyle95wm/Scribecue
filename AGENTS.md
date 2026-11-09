# Working on Scribecue

Instructions for AI coding agents, such as Codex or Claude Code, working on Scribecue. People
contributing by hand are welcome to follow them too.

## Read local instructions first

Before anything else, look for these files in the repository root and read any that exist:

| File | What it is |
|---|---|
| `AGENTS.local.md` | Your own instructions, not checked in. |
| `CLAUDE.local.md` | The same, for Claude Code. |
| `HANDOFF.md` | Notes on where the work stands, if someone left you one. Not checked in. |

Where a local file disagrees with this one, follow the local file. It knows more about your
setup.

## The project

Scribecue is plain HTML, CSS and JavaScript, with no build step. The app is in `app/`,
the user guides in `Guides/`, and design notes in `docs/development/`.
[Development](Guides/INSTALL.md#development) says how to run it.

## Checks before committing

Before every commit, push or pull request, run:

```bash
scripts/check.sh
```

- It must end with "All checks passed". Fix any failure first. Don't commit around it.
- Without Docker, run `scripts/check.sh --no-docker`, and say the Docker checks were skipped.
- The same checks run on GitHub for every pull request. Check they pass there too.
- When adding a feature or fixing a bug, add or update tests in `tests/`, where the code can
  be tested without a browser.

## Slower computers

Scribecue has to work well on less powerful computers. Test every change for that, as well
as for whether it works:

- Run it in headless Chrome, muted, with the CPU slowed 4–6× (the DevTools Protocol's
  `Emulation.setCPUThrottlingRate`). `scripts/slow-chromium.sh` does this in Docker.
- Check that playback stays smooth and readings start on time.
- Check that typing and the timeline don't freeze.
- Long jobs, such as waveforms and exports, should keep the page responsive and show progress.
- A two-hour film shouldn't need to fit in memory at once.
- Put heavy work in a worker or in small steps, not in one long task on the page.
- In your pull request, say what you measured, such as frame rate or long tasks. If you
  couldn't test on a slower setup, say so.

Always start test browsers with `--mute-audio`. Test videos have sound.

## Documentation

Keep the README and guides easy to take in.

- Short sentences and plain words. Say what to do first, then why, only if it helps.
- One idea per bullet or paragraph.
- Put keys and settings in tables where there are several. Name keys as Ctrl/Cmd, Alt and
  Shift, not Mac symbols.
- Leave out how things work inside unless the reader needs it to decide something.
- When adding to a guide, look at the whole section. Replace or trim what's there, rather
  than only appending.
- The README stays short. Details belong in the guides.

## Keeping guides current

A change to what people see or do can leave a guide out of date. Check in the same change:

- Search `Guides/`, `README.md` and `docs/development/` for the feature's names, buttons,
  keys and behaviour.
- Search the app's own text too: the shortcuts overlay in `app/index.html`, tooltips, toasts,
  the tour and the setup.
- Fix what no longer matches, and remove what no longer exists. Small changes count too.
- In your pull request, say which guides you changed, or that none needed it.

## Design language

New features should look and read like the rest of Scribecue. Before writing new UI, find
the nearest existing part and reuse how it does it.

- **Colours:** use the tokens in `:root` in `app/css/style.css`, such as `--accent`, `--ok`,
  `--warn` and `--bad`. Don't add hex colours, in CSS or in canvas code. Read tokens with
  `getComputedStyle`.
- **Controls:** reuse the existing buttons, menus, fields, dialogs (`.updbox`) and the
  indicators under the video (`#ind`). An on/off choice is a button with `aria-pressed`, not
  a bare checkbox.
- **Text:** numbers, times and levels in `--mono`; sentences in `--sans`. Use a real minus
  sign (−) in numbers people read.
- **Words:** use the app's terms, such as "block" (not "line" or "cue"). Phrase new messages
  like the existing toasts and tooltips.
- **Each mode is complete:** hide what doesn't apply in a mode. Update the footer's key hints
  and the shortcuts to match.
- **Check it by eye:** screenshot the new UI next to an existing part of the app, and fix
  anything that looks out of place.
- If something truly needs a new style or token, add it to `style.css` with the others, and
  say so.

## Screenshots

If a change visibly alters what the README screenshots show, retake them with
`scripts/screenshots.sh`. Look at every image before committing: the change shows, nothing is
cut off, and no dialog is in the way.

## Other audio description tools

Scribecue takes ideas from Frazier and other tools: workflows, keyboard habits and familiar
layouts. It stays its own product.

- Don't copy another product's logo, icons, colours, fonts, screenshots, or the wording of
  its interface or help.
- Draw our own icons and write our own wording.
- Saying "as in Frazier" to explain a behaviour is fine.
- Don't suggest Scribecue is made by, endorsed by, or affiliated with another product.
- Don't reverse-engineer another product's code, private file formats or data. Open formats
  such as SRT, WebVTT and BWF are fine.

## Pull requests

- Work on a branch and open a pull request against `main`.
- Leave `VERSION`, `app/changelog.json` and releases to the maintainer.
- Describe what changed for users, what you tested, and what you couldn't test.
