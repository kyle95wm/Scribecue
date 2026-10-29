## What this changes

<!-- In a sentence or two, for someone using Scribecue: what's different after this? -->

Fixes #

## How

<!-- The approach, and anything a reviewer should look at closely. -->

## How it was tested

<!-- What you tried, in which browser and version, and how it behaved. -->

## Checklist

- [ ] `scripts/check.sh` ends with "All checks passed" (or `--no-docker`, said here if so)
- [ ] Tests in `tests/` are added or updated, where the code can be tested without a browser
- [ ] Tried in Chrome or Edge, in the modes it affects (Transcribe, Write, or both)
- [ ] The README or a guide (TRANSCRIBING.md, AI.md, INSTALL.md) is updated if behaviour or keys changed
- [ ] Screenshots are retaken with `scripts/screenshots.sh` if something they show changed
- [ ] Keys are written as Ctrl/Cmd, Alt and Shift in docs, not Mac symbols
- [ ] It works for screen readers and from the keyboard: new buttons have names, and messages go through `toast()`
- [ ] Nothing new is sent off the computer, or it's opt-in and the README's Privacy section says so
- [ ] No programme material, API keys or personal data are in the commits
