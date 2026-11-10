#!/bin/sh
# Runs every check that must pass before committing, pushing or opening a PR:
# syntax, unit tests, Chrome's check of the file pickers, and a Docker build that serves
# the app with its security headers.
# Usage: scripts/check.sh            (all checks)
#        scripts/check.sh --no-docker (skip the Docker build, e.g. without Docker)
set -eu
cd "$(dirname "$0")/.."

echo '== JavaScript syntax'
# A .js file with import or export is checked as a module: plain --check misses some of
# its errors, such as a name declared twice, which then stop the page from loading.
for f in app/js/*.js app/sw.js relay/src/*.js tests/*.mjs scripts/*.mjs; do
  if grep -qE '^(import|export) ' "$f" && [ "${f%.js}" != "$f" ]; then
    node --input-type=module --check < "$f" || { echo "in $f"; exit 1; }
  else
    node --check "$f"
  fi
done

echo '== Unit tests'
node --test 'tests/*.test.mjs'
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_*.py'

echo '== File pickers in Chrome'
node scripts/picker-check.mjs

[ "${1:-}" = "--no-docker" ] && { echo 'Skipped Docker checks'; exit 0; }

echo '== Docker Compose file'
COMPOSE_PROFILES=piper,whisper,kokoro,ollama,ffmpeg docker compose config --quiet
COMPOSE_PROFILES=ollama docker compose -f docker-compose.yml -f ollama-gpu.yml config --quiet

echo '== Docker build and smoke test'
image=scribecue-check
name=scribecue-check-$$
docker build -q -t "$image" . >/dev/null
# Same restrictions as docker-compose.yml, on a random free port.
docker run -d --rm --name "$name" -p 127.0.0.1::8080 --read-only --tmpfs /tmp \
  --cap-drop ALL --security-opt no-new-privileges:true "$image" >/dev/null
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
port=$(docker port "$name" 8080/tcp | head -n1 | sed 's/.*://')
base="http://127.0.0.1:$port"

ok=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS -o /dev/null "$base/"; then ok=1; break; fi
  sleep 0.5
done
[ "$ok" = 1 ] || { echo "The container didn't respond"; docker logs "$name"; exit 1; }

fail() { echo "FAIL: $*"; exit 1; }
headers=$(curl -fsSI "$base/")
echo "$headers" | grep -qi "^content-security-policy: default-src 'self'" || fail 'missing Content-Security-Policy'
echo "$headers" | grep -qi '^x-content-type-options: nosniff' || fail 'missing X-Content-Type-Options'
echo "$headers" | grep -qi '^referrer-policy: no-referrer' || fail 'missing Referrer-Policy'
curl -fsS "$base/" | grep -q '<title>Scribecue</title>' || fail 'index.html not served'
for f in js/app.js js/browser.js js/config.js js/formats.js js/project.js js/tts.js js/update.js js/welcome.js js/wave-worker.js css/style.css sw.js manifest.webmanifest icons/icon-192.png icons/icon-512.png; do
  curl -fsS -o /dev/null "$base/$f" || fail "$f not served"
done
curl -fsSI "$base/js/app.js" | grep -qi '^content-type: .*javascript' || fail 'app.js has the wrong content type'
curl -fsSI "$base/guides/docs/voices/lessac.mp3" | grep -qi '^content-type: audio/mpeg' || fail 'voice samples have the wrong content type'

echo 'All checks passed'
