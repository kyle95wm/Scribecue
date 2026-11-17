# Google Drive sync

Optional. Keeps settings and shared projects the same in every browser that connects the
same Google account, and keeps projects in Drive to open on any computer.

## Parts

| File | Job |
|---|---|
| `app/js/drivesync.js` | What's synced, and merging. No browser or network: tested in `tests/drivesync.test.mjs`. |
| `app/js/googledrive.js` | Connecting, the Drive calls, when to sync, and Settings → Google Drive. |
| `app/js/syncstart.js` | First import of `app.js`: uses held changes before anything reads its settings. |
| `app/google.html`, `app/js/googlecallback.js` | Where Google sends the sign-in window back. |
| `relay/src/google.js` | Swaps the code and renews passes. Tested in `tests/relay-google.test.mjs`. |
| `app/js/driveshares.js` | Shared projects changed in two browsers: which to keep. Tested in `tests/driveshares.test.mjs`. |
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

## Shared projects

- **Always synced** while Drive is connected, owned and joined (Kyle's picks, 2026-11-16).
  No passphrase: the Google account protects them, as it does API keys.
- Each `scribecue.share.<project>` record is a setting named `share.<project>` in
  `settings.json`. `opened` stays with each browser. Records are compared as sorted JSON
  (`shareText`), so field order doesn't count as a change.
- **Changed on both sides**, or met for the first time on both: `combineShares`. For the
  owner, `mergeApart` puts the older list's changes on top of the newer, as two owner
  browsers do on the relay. Nothing is rolled back. Joined: more project keys wins.
- **Removed** (stopped sharing, left, or no longer shared) syncs as null. A removal this
  browser never synced doesn't remove its own copy.
- **Used at once**, but for the project open now, which waits in `pending` like a setting.
  New ones toast and show File → Shared projects.
- The owner's combined list reaches the relay when the project next opens (`ownerOnline`).
- With Drive connected, Remove all data doesn't warn about owned or joined projects.

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
- Every save, autosave too, keeps the revision it wrote in IndexedDB with the handle, and saves
  run one at a time (`oneAtATime`). Otherwise a reload, or Save meeting an autosave, looks like
  a change elsewhere and makes a copy each time.
- A save takes the file's name from Drive, so a rename there shows in the header, Recents
  and the copy names. A rename doesn't change `headRevisionId` (true of the fake; not
  checked against real Drive).
- QC packages, recording files and session packages stay as files: they can carry audio.

## Limits

- **The Google account holds every shared project's keys,** owner keys included. Someone
  who gets into it can connect Scribecue and read them, then change links and read projects.

- Drive has no conditional write here. Two browsers syncing in the same second can lose
  one's change. For projects, the gap is between reading the revision and writing: under a
  second.
- Google only allows the redirect URIs set on the client: the web version, and
  `localhost:8484`, `9484` and `8492`.
- While the Google project is in Testing, Google drops connections after 7 days.

## Shared videos

A shared project's owner can send its video (`sharedvideo.js`, `sharedvideo-worker.js`).
Kyle's picks, 2026-11-16: encrypted in the owner's Drive, for every kind of link, not for
narrators' recording files.

- **Sealed in pieces** with AES-256-GCM, a new key per video. A sealed piece is exactly 4 MiB,
  so upload requests (4 pieces) are whole multiples of 256 KiB, as Drive asks, and download
  ranges fall on piece edges. Nonce: the piece's number. Extra data: whether it's the last.
- **The worker seals and uploads.** The page only runs Drive's resumable upload and hands
  the worker a pass for each request. Sending from the page copied each 16 MiB body on the
  main thread: 1.8 s long tasks at 6×. From the worker: none.
- **Anyone with the link can read** the Drive file (`type: anyone`). The id and key are in
  the shared project's `access` map, as `video`, encrypted like the rest. A Workspace
  account that forbids link sharing gets a message, and the upload is deleted.
- **Downloading** needs no Google account: `alt=media` with `GOOGLE_API_KEY` from
  `config.js`, a browser key limited to the Drive API and Scribecue's addresses. Empty, and
  Share has no Video section.
- **Kept in OPFS** under `shared-videos/<drive id>/<name>`, with a `.done` file once whole.
  The worker writes with a sync access handle, one piece at a time, and carries on from the
  last whole piece. `scribecue.sharedVideos` maps Drive ids to projects; copies for projects
  no longer here, or replaced by the owner, are removed unless open.
- **Not checked against real Drive:** downloading an "anyone" file with only an API key, the
  `Location` header being readable on the resumable upload, and download limits on big files.
  `scripts/shared-video-smoke.mjs` checks the rest with Drive stood in for.
