# Scribecue relay

The relay passes changes between people working on a shared project, and keeps them for
whoever opens it next. It's a Cloudflare Worker with one Durable Object per project.

It can't read projects. Changes arrive encrypted, and signed by the share link that made
them. It checks signatures so a link can only write what its role allows.

It runs at `wss://share.kyleadvoice.ca`. See `docs/development/collaboration.md`.

## Run it locally

```sh
cd relay
npm install
npm run dev
```

It listens on `ws://127.0.0.1:8787`. Then, from the repository:

```sh
node scripts/relay-smoke.mjs
```

The app uses the live relay unless `scribecue.relay` in the browser's storage says otherwise.

The rules are in `src/room.js`, tested by `tests/relay.test.mjs` without Cloudflare.

## Deploy

1. `npx wrangler login`, with the Cloudflare account that has `kyleadvoice.ca`.
2. `npm run deploy`. The address is in `routes` in `wrangler.toml`.

Durable Objects with SQLite storage are on Cloudflare's free plan.

## Limits

| What | Limit |
|---|---|
| One message | 2 MB, or 24 MB sent in parts |
| One project | 64 MB |
| Links on at once | 30 |
| Links turned off, kept for checking | 200 |
| Browsers kept for each link turned off | 50 |
| The signed list of links | 500,000 characters |
| Connections from one address | about 120 a minute |
| New projects from one address | 10 an hour |
| Deleted after nobody opens it for | 180 days |
