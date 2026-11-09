# Sharing a project

Share a project to work on it with others at the same time. Writers, reviewers and
commenters each get their own link, and everyone sees changes within a second.

Sharing is still being tested. Keep your own saved copy of anything important.

## Contents

- [Turning sharing on](#turning-sharing-on)
- [Sharing a project](#sharing-a-project)
- [Kinds of link](#kinds-of-link)
- [Opening a shared project](#opening-a-shared-project)
- [Working together](#working-together)
- [What's shared](#whats-shared)
- [Voices](#voices)
- [Recovery link](#recovery-link)
- [Stopping and leaving](#stopping-and-leaving)
- [Privacy](#privacy)
- [How it works](#how-it-works)
- [Running your own relay](#running-your-own-relay)
- [Limits](#limits)
- [Problems](#problems)

## Turning sharing on

While sharing is being tested, it's off until you turn it on.

- **To open a link someone sent you:** just open it. Sharing turns on by itself.
- **To share your own projects:** turn it on once in each browser:
  1. Open Scribecue.
  2. Open the browser's console: Ctrl+Shift+J, or Cmd+Alt+J on a Mac.
  3. Paste `localStorage.setItem('scribecue.sharedCopy', '1')` and press Enter. If Chrome
     won't let you paste, type `allow pasting` first.
  4. Reload Scribecue. **Share** appears in the header.

## Sharing a project

1. Open the project, in any mode but Record.
2. Click **Share** in the header.
3. Add your name, if you haven't yet. Others see it.
4. Choose a kind of link, and type a password of at least 6 characters.
5. To have the link stop working by itself, type a number of days in **Expires after**.
   Leave it empty for a link that works until you turn it off.
6. Click **Make link**.
7. Click **Copy** and send the link.
8. Send the password separately, such as by text message.

Make one link for each kind of access you need. The header then says **Shared**.

Links made in Docker, at `localhost`, open the web version,
<https://scribecue.kyleadvoice.ca/>, so anyone can use them. You stay the owner in Docker.

## Kinds of link

| Link | What they can do | Mode |
|---|---|---|
| Can edit | Change blocks and comments | Write |
| Can review | Suggest block changes, and comment | QC |
| Can comment | Add and answer comments only | QC |

A reviewer's changes wait in **Pending review**, for you or an editor to accept. Their
comments reach everyone at once.

## Opening a shared project

1. Open the link.
2. Type the password you were sent, and your name.
3. Click **Open**.
4. Open your own copy of the video. The video isn't shared.

Scribecue remembers the project. Open the same link again, and it opens without the
password.

**Sent a different kind of link?** Open it and type its password. It replaces your old
link, and what you can do changes to match. You don't need to leave first.

There's no **Save** or **Export**. Your changes reach the project as you make them. Only
the owner saves and exports it.

## Working together

- **Who's here:** initials beside the **Shared** tag show who has the project open. They
  also show on the block each person has selected.
- **Who's editing:** an open block says "Sam is editing" or "Sam has it open".
- **Typing:** others see a block once you've finished it: Enter, Esc, ↑ ↓ to another
  block, or a click elsewhere. They don't see each letter.
- **Two people in one block:** both changes are kept.
- **Who changed it:** an open block shows who changed it last.
- **Undo:** takes back only your own changes.
- **Offline:** keep working. Your changes are kept and sent when you're back online.

## What's shared

| Shared | Stays on each computer |
|---|---|
| Blocks: text, times, speeds, levels and notes | The video |
| Comments | Readings, which each computer makes |
| Suggested changes, in Pending review | Pickups and narration recordings |
| The project's voice | Your other settings |

## Voices

The project reads with the owner's voices.

- **The owner** changes the voice in Settings, and blocks' own voices, as usual.
- **Everyone else** reads with them. Their Settings show the voice, but can't change it.
- **In QC,** blocks are read with these voices too, as in Write.
- **A voice someone doesn't have** falls back to another one, and Settings says what's
  needed.

**Google voices:** others need a Google key to hear them. You can share a separate one,
so they don't need their own:

1. In Google Cloud, make a separate key for this project, limited to Text-to-Speech. See
   [Google voices](GOOGLE-VOICES.md).
2. In **Share**, under **Google voices**, click **Let others use a separate Google key**.
3. Paste the key and click **Share key**.

Their readings count against that key's allowance. Anyone with a link can read it, so
delete it in Google Cloud when you're done. Click the button again to take it out.

**Amazon Polly voices:** each person needs their own AWS key. See
[Amazon Polly voices](POLLY-VOICES.md).

## Recovery link

Only the browser you shared from can change the links. If its data is lost, nobody can. A
recovery link lets you take the project back, here or on another computer.

To make one:

1. Click **Share**.
2. Under **Recovery link**, type a password of at least 10 characters.
3. Click **Make recovery link**, then **Copy**.
4. Keep the link and the password somewhere safe, apart from each other, such as a password
   manager.

To use it, open the link. Scribecue asks you to **Take back this project**. Type its
password and click **Take back project**. The project opens with you as its owner, with all
its links.

A recovery link made in Docker opens the web version. To open it in Docker instead, change
the start of the link, before the `#`, to your Docker address, such as `http://localhost:8484/`.

- **Anyone with the link and its password** can change the links and read the project.
  Never send it to others.
- **The browser you shared from keeps working.** Links made or turned off in either one
  show in both, even when one was offline at the time.
- **To replace it,** click **Turn off**, then make a new one. Changing it doesn't stop
  someone who has already used the old one.

## Stopping and leaving

| To | Click | What happens |
|---|---|---|
| Stop one link | **Turn off**, in Share | It stops working. The project closes for people using it, and nothing of it stays on their computer |
| Let a link expire | Set **Expires after** when making it | It stops working then, as if turned off. Its row in Share says when |
| Replace a link | **Turn off**, then **Make link** | Only people with the new link and password can open it |
| Stop sharing | **Stop sharing**, in Share | Every link stops working, and the sharing service's copy is deleted. The project closes for everyone else. Your copy stays |
| Leave someone's project | **Leave**, in Share | The project is removed from this browser. To keep it as your own, click **Keep a copy here** first |
| Work on something else | **New**, or open another project | The shared project stays in this browser. Open its link to come back to it. Changes not sent yet go then |

**Your saved project file** is a copy of the shared project as it was when you saved. If
you open it in a browser that has the shared project, Scribecue asks first. It can open the
shared project as it is now, or open the file on its own, not shared. A QC package of it
always opens on its own. A file never replaces others' changes.

## Privacy

- **The sharing service can't read your project.** It's encrypted on your computer before
  it's sent, and only links and their passwords can open it.
- **The password never leaves your computer.** Neither does the part of the link after
  `#`.
- **Anyone with a link and its password can open the project.** Send passwords
  separately, and turn off links you no longer need.
- **The sharing service sees** when people connect, how big the changes are, and what
  kind of link each person has. It never sees text, names or titles.
- **A project nobody opens for 180 days** is deleted from the sharing service. Your
  copies stay.

## How it works

- **The relay** is a small service that passes changes between everyone in a project, and
  keeps them for whoever opens it next. Scribecue's runs on Cloudflare at
  `wss://share.kyleadvoice.ca`.
- **Each change is signed** by the link that made it. The relay and every browser check
  that a link only changes what it's allowed to.
- **Changes merge.** Two people can change the project at once, even offline, and every
  copy ends up the same.
- **Turning a link off** also changes the project's key, so that link can't read anything
  new.

## Running your own relay

Most people don't need their own relay. Run one to keep projects on your own Cloudflare
account. Everyone working on a project must use the same relay.

You need:

- A Cloudflare account, with a domain on it. The free plan is enough.
- Node.js.
- Your own copy of Scribecue, [run yourself](INSTALL.md). The web version only connects to
  Scribecue's relay.

To set it up:

1. Get the code: `git clone https://github.com/kyle95wm/Scribecue.git`.
2. In `relay/wrangler.toml`:
   - set `pattern` in `routes` to the relay's address, such as `share.example.com`.
   - set `ORIGINS` to the addresses your Scribecue is served from, separated by commas.
     `localhost` is always allowed.
3. In `relay/`, run `npm install`, then `npx wrangler login`, then `npm run deploy`.
4. Open `https://share.example.com/`. It should say "Scribecue relay".
5. Add `wss://share.example.com` to `connect-src` in two places: the
   `Content-Security-Policy` line in `app/index.html`, and the one in `nginx.conf`.
6. Rebuild Scribecue: `docker compose up -d --build`.
7. In each browser that uses it, open the console as in
   [Turning sharing on](#turning-sharing-on), and run
   `localStorage.setItem('scribecue.relay', 'wss://share.example.com')`. Then reload.

**To try it on one computer,** run `npm run dev` in `relay/` instead of deploying, and use
`ws://127.0.0.1:8787` as the address. It's already allowed.

**Updating:** after `git pull`, run `npm run deploy` again in `relay/`. If Scribecue and the
relay don't match, the header says **Update needed**, and nothing is lost.

## Limits

| What | Limit |
|---|---|
| One project | 64 MB |
| New shared projects | 10 an hour, from one internet address |
| A link's expiry | 1 to 365 days |
| Kept without being opened | 180 days |

## Problems

| You see | What to do |
|---|---|
| **Connecting** or **Offline** in the header | Check you're online. Your changes are kept, and sent once it connects |
| **Update needed** | Update Scribecue and open the project again. Your changes are kept |
| "That password doesn't open this link" | Check the password with the person who sent it |
| "That isn't this recovery link's password" | Use the password you chose when making the recovery link |
| "This link has been turned off" | Ask for a new link |
| "This link has expired" | Ask for a new link |
| "This link is incomplete" | Copy all of the link and try again |
| "…full on the sharing service" or "…too big for the sharing service" | Your changes stay on this computer but don't reach the others. Start a new shared project from a saved copy |

See also [Troubleshooting](TROUBLESHOOTING.md).
