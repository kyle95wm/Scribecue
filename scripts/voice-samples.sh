#!/usr/bin/env bash
# Makes a short sample of each Piper voice, and a few Kokoro voices, for the voices guide,
# in docs/voices. Reads through a running Scribecue with Piper and Kokoro
# (COMPOSE_PROFILES=piper,kokoro in .env), the same way the app does, and encodes each
# reading as a small MP3 with ffmpeg, all at the same loudness so they're easy to compare.
#
#   scripts/voice-samples.sh [URL]    (default http://127.0.0.1:8484/)
set -euo pipefail

url="${1:-http://127.0.0.1:8484/}"
out="$(cd "$(dirname "$0")/.." && pwd)/docs/voices"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$out"

# Same voices as the Piper container (piper/Dockerfile).
PIPER="en_US-lessac-medium en_US-ryan-medium en_GB-alba-medium en_GB-alan-medium"
KOKORO="af_heart am_liam bf_alice bm_lewis"
TEXT="Rain streaks the window. Maya sets down her coffee, reads the letter twice, then folds it into her coat pocket."

sample() { # name path body
  curl -sSf -X POST -H 'Content-Type: application/json' -d "$3" -o "$work/$1.wav" "${url%/}/$2"
  ffmpeg -loglevel error -y -i "$work/$1.wav" -ac 1 -af loudnorm=I=-18:TP=-1.5 -ar 24000 -codec:a libmp3lame -b:a 64k -map_metadata -1 "$out/$1.mp3"
  echo "$out/$1.mp3"
}

for v in $PIPER; do
  name="${v#*-}"; name="${name%-medium}"
  # noise_w_scale 0, as in the app, so a sample sounds as it does in Scribecue.
  sample "$name" tts/synthesize "{\"text\": \"$TEXT\", \"voice\": \"$v\", \"length_scale\": 1, \"noise_w_scale\": 0}"
done
for v in $KOKORO; do
  sample "kokoro-${v#*_}" tts/kokoro/synthesize "{\"text\": \"$TEXT\", \"voice\": \"$v\", \"speed\": 1}"
done
