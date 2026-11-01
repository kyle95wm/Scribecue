#!/usr/bin/env bash
# Makes a short sample of each Piper voice for the voices guide, in docs/voices. Reads
# through a running Scribecue with Piper (COMPOSE_PROFILES=piper in .env), the same way
# the app does, and encodes each reading as a small MP3 with ffmpeg.
#
#   scripts/voice-samples.sh [URL]    (default http://127.0.0.1:8484/)
set -euo pipefail

url="${1:-http://127.0.0.1:8484/}"
out="$(cd "$(dirname "$0")/.." && pwd)/docs/voices"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$out"

# Same voices as the Piper container (piper/Dockerfile).
VOICES="en_US-lessac-medium en_US-ryan-medium en_GB-alba-medium en_GB-alan-medium"
TEXT="Rain streaks the window. Maya sets down her coffee, reads the letter twice, then folds it into her coat pocket."

for v in $VOICES; do
  name="${v#*-}"; name="${name%-medium}"
  # noise_w_scale 0, as in the app, so a sample sounds as it does in Scribecue.
  curl -sSf -X POST -H 'Content-Type: application/json' \
    -d "{\"text\": \"$TEXT\", \"voice\": \"$v\", \"length_scale\": 1, \"noise_w_scale\": 0}" \
    -o "$work/$name.wav" "${url%/}/tts/synthesize"
  ffmpeg -loglevel error -y -i "$work/$name.wav" -ac 1 -codec:a libmp3lame -b:a 64k -map_metadata -1 "$out/$name.mp3"
  echo "$out/$name.mp3"
done
