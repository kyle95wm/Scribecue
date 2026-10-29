// Prints a release's notes from app/changelog.json, for its GitHub release, so the
// release page and the app's What's new say the same thing:
//   gh release create vX.Y.Z --target main --title "Scribecue X.Y.Z" --notes-file <(node scripts/release-notes.mjs X.Y.Z)
import { readFileSync } from 'node:fs';

const version = (process.argv[2] || '').replace(/^v/, '');
const log = JSON.parse(readFileSync(new URL('../app/changelog.json', import.meta.url), 'utf8'));
const entry = log.find((e) => e.version === version);
if (!entry) {
  console.error(`No notes for ${version || '(no version given)'} in app/changelog.json. Write them there first.`);
  process.exit(1);
}
console.log(`${entry.notes}\n\nRunning Scribecue yourself with Docker? Update as usual: \`git pull\`, then \`docker compose up -d --build\`.`);
