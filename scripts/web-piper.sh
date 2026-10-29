#!/usr/bin/env bash
# Fetches Piper for the web version of Scribecue into DIR/piper: the engine (ONNX
# Runtime and espeak-ng's piper_phonemize, both as WebAssembly) and the voices. The
# Pages workflow runs it, so the files are served from Scribecue's own site and nobody's
# browser has to reach another one. Every file is checked against the checksum below.
#
#   scripts/web-piper.sh DIR
#
# To change versions or voices, update the lists and checksums together.
set -euo pipefail

out="${1:?usage: scripts/web-piper.sh DIR}/piper"
mkdir -p "$out"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

ORT=onnxruntime-web@1.30.0
PHONEMIZE=@diffusionstudio/piper-wasm@1.0.0
VOICES_REV=5041a7a49ae5b3a0f30e6837769eb03fdbb231bd # huggingface.co/rhasspy/piper-voices
# Same voices as the Piper container (piper/Dockerfile); the first is the default.
VOICES="en_US/lessac en_US/ryan en_GB/alba en_GB/alan"

check() { # file sha256
  echo "$2  $1" | shasum -a 256 -c --quiet - || { echo "Checksum mismatch: $1" >&2; exit 1; }
}

(cd "$work" && npm pack --silent "$ORT" "$PHONEMIZE" >/dev/null)
mkdir "$work/ort" "$work/pw"
tar -xzf "$work"/onnxruntime-web-*.tgz -C "$work/ort"
tar -xzf "$work"/diffusionstudio-piper-wasm-*.tgz -C "$work/pw"

cp "$work/ort/package/dist/ort.wasm.min.mjs" "$work/ort/package/dist/ort-wasm-simd-threaded.mjs" \
  "$work/ort/package/dist/ort-wasm-simd-threaded.wasm" "$out/"
cp "$work/pw/package/build/piper_phonemize.wasm" "$work/pw/package/build/piper_phonemize.data" "$out/"
check "$out/ort.wasm.min.mjs" 219e6a1fc8a9938268d18efca3c91d310bd2f4a59bbd13744df5b2b7fc6cee3b
check "$out/ort-wasm-simd-threaded.mjs" e13f7f94fc51b4ca72b12faeb1ee95f4ace6dfbc8939bc718aabdc0a27c4299b
check "$out/ort-wasm-simd-threaded.wasm" 3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2
check "$out/piper_phonemize.wasm" b777cd107a91d2bcc6a1ea46f2c26a662a7407394fe84589198aeaa83dd7a9d6
check "$out/piper_phonemize.data" 29f1025eb23a5b5c192cd14a6efbce4509402ff265405072ee6f7d1a09b78f8c
# piper_phonemize.js is an old-style script; make it a module the worker can import.
check "$work/pw/package/build/piper_phonemize.js" fef0c2fc442d24fdef5c7c7cc37d5da2314407640fe11ab1bfe347c723dff19b
{ cat "$work/pw/package/build/piper_phonemize.js"; printf '\nexport default createPiperPhonemize;\n'; } > "$out/piper_phonemize.mjs"

sums="
en_US-lessac-medium.onnx 5efe09e69902187827af646e1a6e9d269dee769f9877d17b16b1b46eeaaf019f
en_US-lessac-medium.onnx.json efe19c417bed055f2d69908248c6ba650fa135bc868b0e6abb3da181dab690a0
en_US-ryan-medium.onnx abf4c274862564ed647ba0d2c47f8ee7c9b717d27bdad9219100eb310db4047a
en_US-ryan-medium.onnx.json 44034c056cb15681b2ad494307c7f3f2e4499d1253c700c711fa0a4607ffe78d
en_GB-alba-medium.onnx 401369c4a81d09fdd86c32c5c864440811dbdcc66466cde2d64f7133a66ad03b
en_GB-alba-medium.onnx.json aa965a2f02ecced632c2694e1fc72bbff6d65f265fab567ca945918c73dd89f4
en_GB-alan-medium.onnx 0a309668932205e762801f1efc2736cd4b0120329622adf62be09e56339d3330
en_GB-alan-medium.onnx.json c0f0d124e5895c00e7c03b35dcc8287f319a6998a365b182deb5c8e752ee8c1e
"
list=()
for v in $VOICES; do
  id="${v%%/*}-${v##*/}-medium"
  for ext in onnx onnx.json; do
    f="$out/$id.$ext"
    [ -f "$f" ] || curl -sSfL --retry 3 -o "$f" \
      "https://huggingface.co/rhasspy/piper-voices/resolve/$VOICES_REV/${v%%_*}/$v/medium/$id.$ext"
    check "$f" "$(echo "$sums" | awk -v n="$id.$ext" '$1 == n { print $2 }')"
  done
  list+=("\"$id\": $(stat -c %s "$out/$id.onnx" 2>/dev/null || stat -f %z "$out/$id.onnx")")
done
# What the web version offers, with download sizes in bytes.
engine=0
for f in ort-wasm-simd-threaded.wasm piper_phonemize.data piper_phonemize.wasm ort.wasm.min.mjs ort-wasm-simd-threaded.mjs piper_phonemize.mjs; do
  engine=$((engine + $(stat -c %s "$out/$f" 2>/dev/null || stat -f %z "$out/$f")))
done
(IFS=,; printf '{"engine": %s, "voices": {%s}}\n' "$engine" "${list[*]}") > "$out/voices.json"
echo "Piper for the web: $(du -sh "$out" | cut -f1) in $out"
