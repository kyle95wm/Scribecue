# Scribecue relay

The relay passes changes between people working on a shared project, and keeps them for
whoever opens it next. It's a Cloudflare Worker with one Durable Object per project.

It can't read projects. Changes arrive encrypted, and signed by the share link that made
them. It checks signatures so a link can only write what its role allows.

Scribecue doesn't use it yet. See `docs/development/collaboration.md`.

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

The rules are in `src/room.js`, tested by `tests/relay.test.mjs` without Cloudflare.

## Deploy

1. `npx wrangler login`, with the Cloudflare account that has the domain.
2. In `wrangler.toml`, uncomment `routes` and set the name to serve it at.
3. `npm run deploy`.

Durable Objects with SQLite storage are on Cloudflare's free plan.

## Limits

| What | Limit |
|---|---|
| One message | 2 MB |
| One project | 64 MB |
| Links per project | 30 |
| Deleted after nobody opens it for | 180 days |
