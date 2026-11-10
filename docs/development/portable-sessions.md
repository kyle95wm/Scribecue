# Portable recording sessions

The goal: a narrator can copy their work to another computer and open it there, with
every take and alt. Nothing they need stays in the browser.

Built: session folders and browser sessions (`session.js`, `takestore.js`), moving older
takes in, Zip64, session packages, moving a browser session into a folder, and removing
the takes container. `scripts/session-smoke.mjs` checks it in Chrome.

## Where things are now

| Data | Kept in | Travels with a file? |
|---|---|---|
| Script, timings, notes, pickups, comments | `.scribecue` (JSON) | Yes |
| The narrator's script | `.scribecuerec` (JSON) | Yes |
| Takes and alts, their edits and which is chosen | IndexedDB | No |
| TTS readings | Made when needed, held in memory | No, made again |
| QC readings: Google and Kokoro | `.scribecueqc` | Yes |
| QC readings: Piper | Made by the reviewer's computer | No, made again |
| Waveforms, keys, AI and TTS settings | The browser | No, and shouldn't |

Takes are the gap. They're also the largest data: 8.6 MB a minute, 24-bit at 48 kHz.
Thirty minutes of narration with three takes a block is about 775 MB.

## Why not one file that's saved as you go

- **Saving rewrites the whole file.** Chrome writes a full temporary copy on every
  `createWritable()`, even with `keepExistingData`. Autosave runs 2 seconds after a change.
  With takes inside, each save copies hundreds of MB. Slow computers would stall.
- **Firefox and Safari can't save over a file.** They download a new copy each save.
- **A take has to be safe the moment it's recorded.** It can't wait for the next full save.

So the working copy is a folder, and one file is made from it when it's needed.

## The design

### A session folder

The narrator picks or makes a folder when they open a recording file. Scribecue writes:

```
Film title narration/
  session.json        the recording file, and every take's details
  takes/
    3f2a….wav         one per take, named by its id
```

- `session.json` holds the current recording file (as `.scribecuerec` has it) and a list
  of takes: `{ id, block, start, duration, peak, chosen, made, punch?, edit?, line?, ver?, alt? }`.
  These are the fields `takestore.js` has now, so `record.js` doesn't change.
- **Each take's WAV also carries its own details** in a `scbc` chunk, as narration WAVs
  already do (`bwf.js`). If `session.json` is lost or behind, it's rebuilt from the WAVs.
- The folder handle is kept in IndexedDB, as the project file's is. After a reload the
  browser asks again before Scribecue may write. Until then, Record mode shows "session
  paused", like autosave.

### Saving

1. A new take is written as a new WAV. A new file needs no copy, so it's quick.
2. Then `session.json` is written. It's small: a few hundred bytes a take.
3. Choosing, moving, trimming and alts change only `session.json`.
4. Deleting a take only marks it in `session.json`, until the recording closes.

If Scribecue stops between steps 1 and 2, the next open finds a WAV the index doesn't
list. It reads its `scbc` chunk and adds it. Nothing is lost.

Before writing `session.json`, check its last-modified time against what was read. If
another copy changed it (a synced folder open on two computers), read it again first.

### One file to send: the session package

**Package session** writes the folder as one `.scribesession` file. **Open** reads one
back into a folder the narrator picks.

- It's a zip, stored without compression, like the narration zip. People can unzip it
  by hand if they need the WAVs.
- `zip.js` needs **Zip64**. A long film's takes can pass 4 GB.
- Written and read one take at a time, in a worker, with progress. Nothing is held whole.
- A package over 4 GB can't go on a FAT32 USB stick. Say so in the error if the write fails.

### Firefox and Safari

They can't open a folder on disk. They use the same layout in the browser's own folder
(the origin private file system, OPFS), so there's one code path.

- Their takes are browser-only until packaged, as now. Record mode says so, and reminds
  the narrator to package the session before clearing site data or moving computers.
- To check: Safari's `createWritable()` on OPFS files. If it's missing, write from a worker
  with `createSyncAccessHandle()`.

### New versions of the script

`.scribecuerec` stays a small file the writer sends. The narrator opens it **into** their
session:

- If a session for that project is open, or the narrator picks one, its script is replaced,
  and takes are matched with `relink`, as now.
- If the project id doesn't match, refuse, as for a different project's QC return.
- With no session, start a new one.

This replaces taking takes over by project id in shared browser storage, and the
**Bring in takes from an older recording file** button.

### The writer's project

`.scribecue` doesn't change. TTS readings stay out of it:

- They're made again from the text, voice and speed, so a stored copy goes stale with
  each edit.
- When the exact sound matters, the QC package already carries it.

## Moving existing takes

On opening a recording whose takes are in IndexedDB, offer
**Move N takes into a session folder**. Copy each, check its size, then delete the
original only once the session is saved.

## Retiring older stores

- **The takes container:** removed. Session folders shipped in 0.77.0, and the container
  was only read, to move takes out, until 0.100.1. `Guides/INSTALL.md` tells people who
  still have takes there to open them in 0.100.1 first.
- **IndexedDB takes:** next, the same way. OPFS replaces them in Firefox and Safari.

## Slower computers

Check with the CPU slowed 4–6×:

- How long saving a take takes, before and after. It should be no slower than now.
- Packaging and opening a two-hour session: progress moves, the page stays responsive,
  and memory stays flat.
- Rebuilding `session.json` from a few hundred WAVs: read only each WAV's chunks, not
  its sound.

## Decided

- **Deleting** marks a take in `session.json`. Ctrl/Cmd+Z or a click on the message brings
  it back. Its WAV is deleted when the recording closes, or when the session next opens.
- **No script history.** Each take's `line` and `ver` are enough to match takes and find
  a pickup's original.
- **Packaging asks** for every take, or chosen takes only. Chosen only keeps the take each
  pickup replaced, for Compare.

## Guides to update when it's built

- `Guides/RECORDING.md`: where takes are kept, sessions, packaging.
- `Guides/TROUBLESHOOTING.md`, **Settings → Offline and storage**, the tour and toasts that mention
  where takes are kept.
- `local-guides/` for narrators.
