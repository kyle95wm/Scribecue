#!/bin/sh
# Rebuilds and starts the local Docker copy, marked with the git branch it was built from
# (unless main), so the footer shows "v0.124.0 · dev". Extra arguments go to docker compose.
set -e
cd "$(dirname "$0")/.."
branch=$(git branch --show-current 2>/dev/null || true)
[ "$branch" = main ] && branch=
case "$branch" in *[!A-Za-z0-9._/-]*) branch=;; esac
SCRIBECUE_BRANCH=$branch exec docker compose up -d --build "$@"
