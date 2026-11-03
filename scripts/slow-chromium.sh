#!/bin/sh
# Tries Scribecue in Linux Chromium on a slower computer: Chromium runs in a container
# limited to a share of one CPU core, decodes video in software, and is headless and muted.
# It measures playback and jumps in a long film, or shows Chromium in your own browser to
# try things by hand. Needs Docker.
# Usage: scripts/slow-chromium.sh [cpus] [film]
#        scripts/slow-chromium.sh desktop [cpus] [folder]
#        scripts/slow-chromium.sh reset [all]
#        scripts/slow-chromium.sh --help
#   cpus:   CPU cores the container may use, such as 1 or 0.5 (default 1)
#   film:   a video to measure with (default: a generated 2-hour 1080p film, made once)
#   folder: a folder of yours to open and save files in, at /files (default: the test film's)
#   reset:  stops Chromium and clears what it keeps, such as settings and waveforms. Your
#           folder isn't touched. "all" also removes the image and the test film.
set -eu
cd "$(dirname "$0")/.."
cache=${TMPDIR:-/tmp}/scribecue-slow-chromium
name=scribecue-slow-desktop

# Stops before any slow work if something it was given can't be right.
stop() {
  echo "$1" >&2
  echo 'Run scripts/slow-chromium.sh --help to see the options.' >&2
  exit 2
}
check_cpus() {
  case "$1" in
    *[!0-9.]* | *.*.* | '' ) stop "CPUs should be a number such as 1 or 0.5, not: $1" ;;
    *[1-9]*) ;;
    *) stop 'CPUs should be more than 0.' ;;
  esac
}

case "${1:-}" in
  -h | --help | help)
    awk '/^set -eu/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$0"
    exit 0
    ;;
  desktop)
    check_cpus "${2:-1}"
    [ -z "${3:-}" ] || [ -d "$3" ] || stop "No such folder: $3"
    ;;
  reset)
    [ -z "${2:-}" ] || [ "$2" = all ] || stop "Reset only takes all, not: $2"
    ;;
  *)
    check_cpus "${1:-1}"
    [ -z "${2:-}" ] || [ -f "$2" ] || stop "No such video: $2"
    ;;
esac

if [ "${1:-}" = reset ]; then
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm -f scribecue-slow-profile >/dev/null
  echo 'Chromium is stopped and cleared.'
  if [ "${2:-}" = all ]; then
    docker rmi scribecue-slow-chromium >/dev/null 2>&1 || true
    rm -rf "$cache"
    echo 'The image and the test film are removed too.'
  fi
  exit 0
fi

mkdir -p "$cache"

echo '== Building the Chromium image'
docker build -q -t scribecue-slow-chromium scripts/slow-chromium >/dev/null

if [ "${1:-}" = desktop ]; then
  cpus=${2:-1}
  folder=$(cd "${3:-$cache}" && pwd)
  docker rm -f "$name" >/dev/null 2>&1 || true
  # Only this computer can reach it. Settings and waveforms are kept between runs.
  docker run -d --rm --name "$name" --cpus="$cpus" --shm-size=1g -p 127.0.0.1:6080:6080 \
    -v "$(pwd):/repo:ro" -v "$folder:/files" -v scribecue-slow-profile:/profile \
    scribecue-slow-chromium /repo/scripts/slow-chromium/desktop.sh >/dev/null
  echo "Chromium with $cpus CPU is running Scribecue from this folder's app/."
  echo "Open: http://localhost:6080/vnc.html?autoconnect=1&resize=scale"
  echo "Your files: $folder, at /files in Chromium's file window."
  echo "There's no sound. Stop it with: docker stop $name"
  exit 0
fi
cpus=${1:-1}

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
