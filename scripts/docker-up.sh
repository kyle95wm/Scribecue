#!/bin/sh
# Rebuilds and starts a local Docker copy of Scribecue.
#
#   scripts/docker-up.sh        On main, the release copy at http://localhost:8484/.
#                               On any other branch, a test copy of it at
#                               http://localhost:9484/, beside the release copy, with the
#                               branch after the version in the footer.
#   scripts/docker-up.sh main   The release copy, from main, whatever is checked out.
#   scripts/docker-up.sh stop   Stops the test copy.
#   scripts/docker-up.sh clean  Stops the test copy and removes what it left: its image and
#                               network. The release copy isn't touched.
#
# The test copy uses the release copy's voices, speech to text and ffmpeg. Change its port
# with SCRIBECUE_DEV_PORT in .env. Extra arguments go to docker compose up.
set -e
cd "$(dirname "$0")/.."

here=$(git branch --show-current 2>/dev/null || true)
case "${1:-}" in
  stop) exec docker compose -f docker-compose.dev.yml down ;;
  clean)
    docker compose -f docker-compose.dev.yml down --rmi all
    if docker network inspect scribecue-dev-voices >/dev/null 2>&1; then
      docker network rm scribecue-dev-voices >/dev/null
    fi
    echo "Removed the test copy. To free more space, clear Docker's unused build cache:"
    echo "  docker builder prune -f"
    echo "That clears it for everything built with Docker, not only Scribecue."
    exit ;;
  main) shift; want=main ;;
  *) want=$here ;;
esac

if [ "$want" = main ]; then
  # Checked out on main: build what's here, as before.
  [ "$here" = main ] && exec docker compose up -d --build "$@"
  # Otherwise build main's files from git, in place of the running release copy.
  project=$(docker compose config 2>/dev/null | sed -n 's/^name: //p' | head -n1)
  git fetch -q origin main 2>/dev/null || true
  ref=main
  git rev-parse -q --verify origin/main >/dev/null && ref=origin/main
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  git archive "$ref" | tar -x -C "$tmp"
  [ -f .env ] && cp .env "$tmp/.env"
  echo "Building the release copy from $ref ($(git rev-parse --short "$ref"))"
  docker compose -p "$project" --project-directory "$tmp" -f "$tmp/docker-compose.yml" up -d --build "$@"
  exit
fi

# A test copy, named after the branch (or the commit, if none is checked out).
branch=${want:-$(git rev-parse --short HEAD)}
case "$branch" in *[!A-Za-z0-9._/-]*) branch=test;; esac

# Join the release copy's internal network, for its voices and ffmpeg.
net=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}' scribecue 2>/dev/null | grep '_voices$' | head -n1 || true)
if [ -z "$net" ]; then
  net=scribecue-dev-voices
  docker network inspect "$net" >/dev/null 2>&1 || docker network create --internal "$net" >/dev/null
  echo "The release copy isn't running, so the test copy has no Piper, Kokoro, Whisper or ffmpeg."
fi

SCRIBECUE_BRANCH=$branch SCRIBECUE_VOICES_NETWORK=$net docker compose -f docker-compose.dev.yml up -d --build "$@"
port=$(docker port scribecue-dev 8080/tcp | head -n1 | sed 's/.*://')
echo "Test copy of $branch: http://localhost:$port/"
