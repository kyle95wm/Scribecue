#!/bin/sh
# Bundles Yjs into one file the app can load without a build step: app/vendor/yjs.js,
# with its licence beside it. Run it again only to change the version. Needs Node and npm.
# Usage: scripts/vendor-yjs.sh
set -eu
cd "$(dirname "$0")/.."
YJS=13.6.33
LIB0=0.2.114
ESBUILD=0.28.2
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"
npm init -y >/dev/null
npm install --no-audit --no-fund --silent --save-exact "yjs@$YJS" "lib0@$LIB0" "esbuild@$ESBUILD"
printf "export * from 'yjs';\n" > entry.js
./node_modules/.bin/esbuild entry.js --bundle --format=esm --minify --legal-comments=eof \
  --banner:js="// Yjs $YJS and lib0 $LIB0, bundled and minified. MIT: see yjs-LICENSE.txt. Made by scripts/vendor-yjs.sh." \
  --outfile="$OLDPWD/app/vendor/yjs.js"
{ echo "Yjs $YJS"; echo; cat node_modules/yjs/LICENSE; echo; echo "lib0 $LIB0"; echo; cat node_modules/lib0/LICENSE; } > "$OLDPWD/app/vendor/yjs-LICENSE.txt"
echo "Wrote app/vendor/yjs.js ($(wc -c < "$OLDPWD/app/vendor/yjs.js") bytes)"
