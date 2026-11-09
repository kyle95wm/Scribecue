# Sharing: security design

How a shared project is kept private, and what it does and doesn't protect against. The
code is in `app/js/sharekeys.js` (keys), `app/js/relayclient.js` (the connection),
`app/js/sharing.js` (links) and `relay/src/room.js` (the relay's rules). How it fits into
the app is in [collaboration.md](collaboration.md).

Written 2026-11-08, from our own review. Nobody outside has reviewed it.

## Who's involved

| Who | Has | Can |
|---|---|---|
| Owner | the owner key, every project key | change the links, write everything, delete the project |
| Can edit link | its link key, the project keys | write the script, comments and suggestions |
| Can review link | the same | write comments and suggestions |
| Can comment link | the same | write comments |
| The relay | encrypted changes, the signed list of links, boxes | pass changes on, keep them, refuse writes |

A link's holder is anyone with its address and its password. The relay runs on Cloudflare
at `share.kyleadvoice.ca`.

## What it protects against

- **The relay, or anyone who takes it over, reads the project.** It can't. It never has a
  project key, a link's secret or a password.
- **The relay changes the project.** It can't make a change that checks out. Every change
  is signed by the link that made it.
- **Someone writes more than their role allows.** The relay refuses it, and every client
  checks again.
- **A link turned off keeps working.** It can't sign in, never gets the project keys made
  after, and changes it makes later don't count. See [Turning a link off](#turning-a-link-off).
- **Someone has a link's address but not its password.** They can't open the box without
  guessing the password. See [Known limits](#known-limits).

It doesn't protect against someone with a link who shares what they see, against a
browser that's been taken over, or against the relay refusing to work.

## Keys

| Key | Kind | Made by | Used for |
|---|---|---|---|
| Owner key | Ed25519 | the owner, on sharing | signing the list of links and the owner's changes |
| Link key | Ed25519 | the owner, per link | signing in, and signing that link's changes |
| Project keys | AES-256-GCM | the owner; one more each time a link goes off | encrypting changes and who's here |
| Wrapping key | AES-256-GCM | the owner, per link and one for the owner | sending a link the project keys made after it |
| Box key | AES-256-GCM, from PBKDF2-SHA-256, 600,000 rounds | the link's secret and password | opening the link's box |

All are made with the browser's Web Crypto, and kept in that browser's storage
(`scribecue.share.<project id>`).

## Links

A link looks like `https://…/#share=<room>.<link id>.<secret>`.

- Room: 16 random bytes. Link id: 9 random bytes. Secret: 16 random bytes.
- The secret is after `#`, so the browser never sends it.
- The relay keeps each link's **box**. It holds the project keys so far, the link key, the
  wrapping key, the owner's public key and the project's id. It's encrypted with the box
  key, and bound to the room, link id and role (`scribecue-box:<room>:<id>:<role>`).
- Anyone may ask the relay for a link's box. Opening it needs the secret and the password.

## The list of links

The owner signs a list: `{ room, n, links, wraps }`.

- `n` counts up with each change. Clients and the relay ignore a list older than one
  they've seen.
- Each link that's on: `{ id, role, pub, box, expires }`. `expires`, a time in ms, is
  there only for a link that expires.
- Each link turned off: `{ id, role, pub, off: true, upTo, sealed, expires }`. Its box is
  gone. `expires` stays on a link turned off because it expired.
- `wraps`: for the owner and each link that's on, the project keys it lacks, encrypted
  with its wrapping key and bound to the room and link (`scribecue-keys:<room>:<id>`).

## Changes

A project is three Yjs documents: `script`, `comments` and `review`. A change is a Yjs
update, or a whole document (a snapshot). The `script` document also holds the project's voice,
and can hold a separate Google key the owner chose to share. Like everything else, the relay can't read it, but
anyone with a link can.

1. It's encrypted with the newest project key: one byte for the key's number, a 12-byte
   IV, then the AES-GCM output. It's bound to the room, document and key number
   (`scribecue-change:<room>:<doc>:<key number>`).
2. It's signed with the sender's key. What's signed:

   | Message | Signed bytes |
   |---|---|
   | Signing in | `scribecue-relay:auth:<room>:<nonce>` |
   | Change | `scribecue-relay:change:<room>:<doc>:<dev>:<n>:` + the encrypted change |
   | Snapshot | `scribecue-relay:whole:<room>:<doc>:<up to>:<dev>:<n>:` + the encrypted document |
   | List of links | `scribecue-relay:links:` + the list's text |

   `dev` is random, made each time the project opens in a browser. `n` counts up from 1
   for each change and snapshot it sends. Changes from before numbering are signed as
   `scribecue-relay:update:…` and `scribecue-relay:snapshot:…`, without `dev` and `n`.

## Messages

All are JSON over one WebSocket per open project.

| From the browser | Fields |
|---|---|
| `box` | `v`, `link` |
| `create` | `v`, `owner`, `sig`, `links` |
| `auth` | `v`, `link` (or `owner`), `sig` |
| `sync` | `since` |
| `update` | `doc`, `id`, `dev`, `n`, `data`, `sig` |
| `snapshot` | `doc`, `upTo`, `id`, `dev`, `n`, `data`, `sig` |
| `links` | `id`, `links` (owner only) |
| `presence` | `data` |
| `delete-room` | (owner only) |

| From the relay | Fields |
|---|---|
| `challenge` | `room`, `nonce`, `protocol` |
| `box` | `link`, `role`, `box` |
| `welcome` | `role`, `links`, `seq` |
| `update` | `seq`, `doc`, `by`, `dev`, `n`, `data`, `sig` |
| `snapshot` | `doc`, `upTo`, `by`, `dev`, `n`, `data`, `sig` |
| `synced` | `seq` |
| `ack` | `id`, `seq` |
| `links` | `links` |
| `presence` | `sid`, `by`, `data` |
| `gone` | `sid` |
| `error` | `code`, sometimes `detail` |

## Versions

The relay and each browser speak a version of this protocol. It's now 2: changes numbered
by browser, and links turned off sealed.

- The relay's challenge says its version (`protocol`). Each browser says its own (`v`)
  when it asks for a box, makes a room or signs in. One that says none is version 1.
- The relay takes a range of versions (`PROTOCOL` in `room.js`). A browser below it gets
  `old-app`; one above it gets `old-relay`. A browser newer than the relay's version stops
  with `old-relay` itself.
- Either way, the browser stops trying. The header tag says **Update needed**, and the
  project and its changes stay in that browser.
- Raise the version for any change older browsers can't take part in safely. Raise the
  relay's lowest version when older browsers would weaken what newer ones check, as
  version 1 browsers would by taking changes from links turned off.

## What the relay checks

- A box, a new room or signing in: the browser speaks a version the relay takes.
- Signing in: the challenge is signed by the owner key, or by a link that's on.
- Each message after that: the link is still on and hasn't expired, with the same role and
  key.
- Expiry: a link past its `expires` gets `link-expired` for its box and for signing in. Its
  sockets close at their next message, or when something would reach them.
- A change or snapshot: the role may write that document, and the signature checks out.
- A list of links: it's from the owner, newer than the last, and within the limits.
- A snapshot: its point isn't before the last snapshot's. The changes before it go.
- Size: 2 MB a message, 64 MB a project, 30 links on and 200 off.
- Rate: about 120 connections a minute and 10 new projects an hour from one address.

The relay is trusted only to pass things on and to keep them. Everything it checks,
clients check again.

## What each browser checks

On each change or snapshot that arrives:

1. It's from the owner or a link on the newest list it has, whose role may write that document.
2. The signature checks out with that link's key.
3. If the link is turned off, the rules in [Turning a link off](#turning-a-link-off) allow it.
4. No change with the same link, `dev` and `n` came before with a different signature.
5. It opens with the project key its first byte names. If this browser doesn't have that
   key yet, it waits until the list brings it.

## Turning a link off

The owner turns a link off, or makes a new link for its role. Then:

1. **The owner sends a new list.** The link is marked off, its box goes, and its
   connections close. It can't sign in again.
2. **A new project key is added.** Changes from then on use it. The list brings it to
   every link that's on, but not to the one turned off.
3. **The list says where the link stopped.** `upTo` holds the last `n` the owner had from
   each of that link's browsers, at most 50. Its changes with higher numbers, from other
   browsers or without numbers don't count. This is filled in once the owner is up to date
   with the relay, as when coming back online.
4. **The owner seals it.** The owner sends each document whole, up to the latest change.
   That holds everything the link did, so the relay drops its earlier changes. The owner
   then marks it `sealed` in a new list. From then on, nothing from it counts. If the owner
   is offline, or still waiting for a project key, sealing happens on reconnecting.

A link turned off before numbering has no `upTo`. Its changes still count, as before,
until the owner seals it.

## Links that expire

The owner can make a link that expires after 1 to 365 days.

1. **The relay refuses it** from then on, by its own clock, as if it were off.
2. **The owner turns it off**, as by hand, once online and the time has passed: a new
   project key, `upTo`, then sealing. While the owner is online, this happens about a second
   after it expires.

Until the owner does, a link that expired still has the project keys. A relay that ignored
expiry could keep passing it changes. Clients don't check expiry themselves: they can't
trust the time a change says it was made.

## Who's here

- Each browser sends its person's name, mode, selected block and whether it's editing.
  It's encrypted with the project key, but not signed.
- The relay adds the connection's id (`sid`) and link (`by`), passes it on, and keeps
  nothing. It says `gone` when a connection closes.
- Clients show only people whose link is on.

## Known limits

- **Passwords can be guessed offline** by someone with a link's address, since anyone can
  fetch its box. PBKDF2 at 600,000 rounds slows this. A password needs 6 characters.
- **Until a link turned off is sealed**, someone who kept its key could sign a new change
  under a number it really used. With the relay's help, someone who never saw the original
  would take it. They could also send a change they signed before but held back. Sealing
  ends both, usually within seconds of turning the link off.
- **A change that reaches the relay just as its link is turned off** may count for those
  online then, but not for the owner or people who join later. Copies can then differ.
- **The relay can hold back or reorder changes.** It can serve an older list to someone
  opening the project for the first time, so they'd take changes from a link since turned
  off. It can drop changes. Clients can't tell; they rely on the relay to work.
- **Who's here isn't signed.** Anyone in the project can send any name, as names are
  chosen by each person anyway. The relay sees only that a connection sent something.
- **Permissions are per document.** A commenter can change or delete anyone's comments.
  An editor can rewrite or empty the script, including with a snapshot.
- **No forward secrecy.** Someone with a link can read everything up to when it's turned
  off, for as long as they keep the keys. A relay that kept old changes, and later got a
  link and its password, could read them too.
- **The owner key can't be replaced or recovered.** If the owner's browser storage is
  lost, nobody can change the links. Copies still work as plain projects.
- **Keys live in browser storage.** A script running in the page could read them. The
  CSP allows only Scribecue's own scripts.
- **The relay sees** room ids, link ids and roles, browser ids and change numbers, sizes,
  times and IP addresses. It never sees text, names or titles.
- **Links made before project keys could change** have no wrapping key. After a link is
  turned off, they can't read new changes. Make them again.
