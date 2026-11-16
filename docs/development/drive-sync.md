# Google Drive sync

Optional. Keeps settings the same in every browser that connects the same Google account.
Projects aren't synced yet.

## Parts

| File | Job |
|---|---|
| `app/js/drivesync.js` | What's synced, and merging. No browser or network: tested in `tests/drivesync.test.mjs`. |
| `app/js/googledrive.js` | Connecting, the Drive calls, when to sync, and Settings → Google Drive. |
| `app/js/syncstart.js` | First import of `app.js`: uses held changes before anything reads its settings. |
| `app/google.html`, `app/js/googlecallback.js` | Where Google sends the sign-in window back. |
| `relay/src/google.js` | Swaps the code and renews passes. Tested in `tests/relay-google.test.mjs`. |
| `scripts/drive-sync-smoke.mjs` | The whole flow in Chrome, with Google faked. |

## Signing in

- Authorization code flow with PKCE, in a pop-up. Scope: `openid email drive.appdata`.
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

## Limits

- Drive has no conditional write here. Two browsers syncing in the same second can lose
  one's change. Rare for settings; projects will need a check against the file's version.
- Google only allows the redirect URIs set on the client: the web version, and
  `localhost:8484`, `9484` and `8492`.
- While the Google project is in Testing, Google drops connections after 7 days.
