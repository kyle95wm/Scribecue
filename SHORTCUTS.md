# Keyboard shortcuts

![The keyboard shortcuts overlay](docs/screenshots/shortcuts.png)

The layout follows the
[Frazier cheat sheet](https://www.videotovoice.com/docs/en/cheatsheet/mac.html).
See [Keys on Mac, Windows and Linux](#keys-on-mac-windows-and-linux) for how the modifier
keys are named on each system. The tables below are the usual keys.

## Changing shortcuts

Press `?` and click **Change shortcuts**, or open **Settings** and choose **Keyboard
shortcuts**, to give any action the keys you like:

- Click **Add** next to an action, then press the keys. If they already belong to another
  action, Scribecue says which and asks before moving them. Click a key to take it off,
  and **Reset** puts an action back to its usual keys. **Find** narrows the list.
- **Export** saves your shortcuts as `scribecue-shortcuts.json`, and **Import** loads one,
  so a team can share a layout. **Reset all** goes back to the usual keys.
- The shortcuts overlay and the player buttons' tooltips show your keys.

Most actions can be changed. Keys with `Ctrl/Cmd` (undo, open, save, export), keys used
while typing in a box, and `?` `/` `[` `]` `+` `−` `Esc` stay as they are, because they go
by the character on the key and so suit every keyboard layout. Your shortcuts are kept in
this browser.

<details open>
<summary><strong>Timeline</strong></summary>

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` `→` | One frame back / forward |
| `Shift+←` `Shift+→` | Three seconds back / forward |
| `Alt+Shift+←` `Alt+Shift+→` | Start of the block you're in, then the previous block / the next block, from the playhead |
| `Home` `End` | Beginning / end of the video (`Fn+←` `Fn+→` on Mac laptops) |
| `Alt+Shift+J` | Jump to a timecode (`hh:mm:ss:ff`, `hh:mm:ss.mmm`, `mm:ss` or seconds) |
| `Shift+F` | Quick navigation: find a block by text or number |
| `+` `-` | Faster / slower playback |
| `Enter` | Create or edit a block |
| `Alt+Shift+D` | Delete a block (asks first) |
| `Shift+O` or `?` | Show all shortcuts |

</details>

<details open>
<summary><strong>Block editor</strong></summary>

| Key | Action |
| --- | --- |
| `Tab` `Shift+Tab` | Next / previous field (text → start → end) |
| `Esc` or `Enter` | Close the editor |
| `Shift+Enter` | New line |
| `↑` `↓` | Previous / next block (from the first / last line) |
| `Alt+Shift+←` `Alt+Shift+→` | Move the block one frame back / forward |
| `Alt+Space` | Play / pause while typing |
| `Ctrl/Cmd+B` `Ctrl/Cmd+I` `Ctrl/Cmd+U` | Bold / italic / underline |
| `Ctrl/Cmd+Z` `Ctrl/Cmd+Shift+Z` | Undo / redo |
| `Ctrl/Cmd+S` / `Ctrl/Cmd+Shift+S` | Save the project / save it as a new file |
| `Ctrl/Cmd+E` / `Ctrl/Cmd+Shift+E` | Export SRT / WebVTT |
| `Ctrl/Cmd+O` / `Ctrl/Cmd+Shift+O` | Open a project or script / open a video or audio file |

</details>

<details open>
<summary><strong>Extras</strong> (on keys Frazier leaves free)</summary>

| Key | Action |
| --- | --- |
| Hold `H` | [Hold-to-mark](TRANSCRIBING.md#marking-lines-with-h) a block while the narrator speaks; in Write mode, time [your own read](GETTING-STARTED.md#the-writing-loop) of the selected block |
| `Shift+H` | Change the hold-to-mark reaction offset |
| `L` | [Loop this block](TRANSCRIBING.md#hearing-a-block-again) until you finish editing it |
| `Shift+L` | [Replay](TRANSCRIBING.md#marking-lines-with-h): back to a block's start after editing it, on / off |
| `N` | New block at the playhead |
| `A` / `S` | Set start / end to the playhead |
| `Q` `W` | Start −/+ 100 ms (with `Shift`: 10 ms) |
| `E` `R` | End −/+ 100 ms (with `Shift`: 10 ms) |
| `,` `.` | Move the block −/+ 100 ms (with `Shift`: 10 ms) |
| `X` / `M` | Split at the playhead / merge with the next block |
| `Del` | Delete the block straight away (undo with `Ctrl/Cmd+Z`). The × at the end of each row in the list does the same for that block |
| `↑` `↓` or `K` `J` | Previous / next block |
| `PgUp` `PgDn` | Jump 10 blocks |
| `G` / `Shift+G` | Playhead to the block's start / end |
| `C` | Select the block under the playhead |
| `Shift+Space` | Play just the selected block |
| `T` / `Shift+T` | Next / previous audio track |
| `Alt+Shift+T` | [Transcribe](TRANSCRIBING.md#speech-to-text-with-whisper) the selected block, replacing its text |
| `Alt+Shift+H` | Speech to text settings |
| `/` | Search the block list |
| `Alt+Shift+F` | [Find and replace](GETTING-STARTED.md#other-handy-features) in every block |
| `O` | Loop on / off |
| `F` | Follow the playhead on / off |
| `V` / `Shift+V` | [Read the block aloud](WRITING.md) / fit the block to the reading |
| `[` `]` | Make the block's reading slower / faster |
| `Alt+Shift+V` | Text to speech settings |
| `Alt+Shift+P` | [Sounds like](WRITING.md) for the selected block |
| `Alt+Shift+A` | Open or close [AI help](AI.md) |
| `Alt+Shift+S` | Settings |
| `Alt+=` `Alt+-` `Alt+0` | Zoom the timeline in / out / to fit |
| `\` | Reset speed to 1× |

</details>

## Keys on Mac, Windows and Linux

The keys are in the same places on every system. `Ctrl/Cmd` means `Ctrl` on Windows and
Linux and `Cmd` (⌘) on a Mac. `Alt` is `Option` (⌥) on a Mac. Scribecue shows the right
names for your system in the app.

One key differs, to avoid a clash with the system: **play / pause while typing** is
`Alt+Space` on a Mac and `Ctrl+Space` on Windows and Linux, because Windows keeps
`Alt+Space` for the window menu.

If `Alt+Shift` switches your keyboard layout on Windows, the block shortcuts also have
other keys: `↑` `↓` or `K` `J` for previous / next block, and `Del` to delete. You can also
drop a media file on the window instead of pressing `Ctrl+Shift+O`.

Frazier features that Scribecue doesn't have aren't included: glossaries, snippets,
markers, comments, pronunciation, extended audio description, and instruction or pause
marks. Their keys show a short notice instead.
