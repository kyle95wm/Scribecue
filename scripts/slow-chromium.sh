#!/bin/sh
# Tries Scribecue in Linux Chromium on a slower computer: Chromium runs in a container
# limited to a share of one CPU core, decodes video in software, and is headless and muted.
# It measures playback and jumps in a long film. Needs Docker.
# Usage: scripts/slow-chromium.sh [cpus] [film]
#   cpus: CPU cores the container may use, such as 1 or 0.5 (default 1)
#   film: a video to test with (default: a generated 2-hour 1080p film, made once)
set -eu
cd "$(dirname "$0")/.."
cpus=${1:-1}
cache=${TMPDIR:-/tmp}/scribecue-slow-chromium
mkdir -p "$cache"

echo '== Building the Chromium image'
docker build -q -t scribecue-slow-chromium scripts/slow-chromium >/dev/null

if [ -n "${2:-}" ]; then
  dir=$(cd "$(dirname "$2")" && pwd)
  film="/film/$(basename "$2")"
else
  dir=$cache
  film=/film/film.mp4
  if [ ! -f "$cache/film.mp4" ]; then
    echo '== Making the test film (once, about 2.7 GB)'
    # Two minutes of noisy test pattern, 1080p H.264 with a keyframe every 10 seconds, as
    # in many films, repeated to two hours without encoding it again.
    docker run --rm -v "$cache:/film" scribecue-slow-chromium sh -c '
      cd /film &&
      ffmpeg -v error -y -f lavfi -i "testsrc2=size=1920x1080:rate=24,noise=alls=30:allf=t,format=yuv420p" \
        -f lavfi -i "sine=frequency=330:sample_rate=48000" -t 120 -c:v libx264 -preset veryfast -b:v 3M \
        -g 240 -keyint_min 240 -sc_threshold 0 -c:a aac -b:a 96k clip.mp4 &&
      for i in $(seq 60); do echo "file clip.mp4"; done > list.txt &&
      ffmpeg -v error -y -f concat -i list.txt -c copy -movflags +faststart film.mp4 &&
      rm clip.mp4 list.txt'
  fi
fi

echo "== Measuring with $cpus CPU"
docker run --rm --cpus="$cpus" --shm-size=1g -v "$(pwd):/repo:ro" -v "$dir:/film:ro" -w /repo \
  scribecue-slow-chromium node scripts/slow-chromium.mjs "$film"
