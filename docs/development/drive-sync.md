# Google Drive sync

Optional. Keeps settings the same in every browser that connects the same Google account,
and keeps projects in Drive to open on any computer.

## Parts

| File | Job |
|---|---|
| `app/js/drivesync.js` | What's synced, and merging. No browser or network: tested in `tests/drivesync.test.mjs`. |
| `app/js/googledrive.js` | Connecting, the Drive calls, when to sync, and Settings → Google Drive. |
| `app/js/syncstart.js` | First import of `app.js`: uses held changes before anything reads its settings. |
| `app/google.html`, `app/js/googlecallback.js` | Where Google sends the sign-in window back. |
| `relay/src/google.js` | Swaps the code and renews passes. Tested in `tests/relay-google.test.mjs`. |
| `app/js/driveprojects.js` | Projects: copy names, the list, kept references. Tested in `tests/driveprojects.test.mjs`. |
| `scripts/drive-sync-smoke.mjs`, `scripts/drive-projects-smoke.mjs` | Settings and projects in Chrome, with Google faked. |

## Signing in

- Authorization code flow with PKCE, in a pop-up. Scopes: `openid email drive.appdata
  drive.file`. Connections from before projects only have `drive.appdata`
  (`auth.projects` false), and are asked to connect again before using projects.
- `google.html` sends the code back on a `BroadcastChannel`, not `window.opener`: Google's
  pages set COOP, which can cut the opener on the way.
- The relay swaps the code using the client secret. It returns the access token, and the
  refresh token sealed with AES-GCM under `GOOGLE_SEAL_KEY`, with the client id as extra
  data. The browser keeps the sealed token in `scribecue.google`. The access token stays in
  memory.
- The relay keeps nothing, and only answers Scribecue's own origins.
- A stolen sealed token gets Scribecue's hidden Drive folder for that account, through the
  relay, until the person disconnects or Google drops it.

## Merging

- Drive holds `settings.json` in `appDataFolder`: `{ scribecue: 'sync', version, saved,
  settings: { name: { v, at } } }`. `v` is the text kept in storage, or null once removed.
- Each browser keeps `seen` (what it last synced), `changed` (when it first noticed a local
  change) and `pending` in `scribecue.googleSync`.
- Changed on one side only: that side wins. Changed on both: the later `at` wins.
- First sync in a browser, or a setting this browser hasn't synced before: Drive wins.
- `mode` and `listWidth` aren't synced. Secrets are synced only while `syncKeys` is `'1'`,
  which is synced itself.
- Settings are read as the app starts, so changes from Drive while it's open wait in
  `pending`, and `syncstart.js` uses them next time. The sync as the app opens, before
  any click or key, writes them and reloads straight away.

## Projects

- **Kept in** a `Scribecue` folder in My Drive, which people can see. Each file is marked with
  the app property `scribecue=project`, which is how Open from Google Drive finds them.
- **`drive.file`** only reaches files Scribecue made. A project dropped into Drive by hand
  doesn't show. Google's picker would fix that, but needs its script and an API key.
- **`driveHandle`** stands in for a `FileSystemFileHandle`, so saving, autosave and Recents
  work unchanged, in every browser. The handle store keeps `driveRef(h)`, plain data.
- **Conflicts:** each write first reads the file's `headRevisionId`. If it isn't the one this
  browser last read or wrote, or the file is gone, the project goes into a new file, "Name
  (2)", and the handle moves to it. Nothing is overwritten. Kyle's pick (2026-11-16).
- QC packages, recording files and session packages stay as files: they can carry audio.

## Limits

- Drive has no conditional write here. Two browsers syncing in the same second can lose
  one's change. For projects, the gap is between reading the revision and writing: under a
  second.
- Google only allows the redirect URIs set on the client: the web version, and
  `localhost:8484`, `9484` and `8492`.
- While the Google project is in Testing, Google drops connections after 7 days.
