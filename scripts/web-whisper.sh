#!/usr/bin/env bash
# Fetches Whisper speech to text for the web version of Scribecue into DIR/whisper:
# transformers.js, the ONNX Runtime build it runs on (as WebAssembly, with WebGPU), and
# an English Whisper model. The Pages workflow runs it, so the files are served from
# Scribecue's own site and nobody's browser has to reach another one. Every file is
# checked against the checksum below.
#
#   scripts/web-whisper.sh DIR
#
# To change versions or the model, update the names and checksums together. Each file
# must stay under GitHub Pages' 100 MB limit.
set -euo pipefail

out="${1:?usage: scripts/web-whisper.sh DIR}/whisper"
mkdir -p "$out"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

TRANSFORMERS=@huggingface/transformers@4.3.1
ORT=onnxruntime-web@1.31.0-dev.20260914-8d85527a0 # the version transformers.js was built with
MODEL=onnx-community/whisper-base.en
MODEL_REV=51eefc0af78b103839eda9e7e4f4186acc6517fe # huggingface.co/onnx-community/whisper-base.en

check() { # file sha256
  echo "$2  $1" | shasum -a 256 -c --quiet - || { echo "Checksum mismatch: $1" >&2; exit 1; }
}

(cd "$work" && npm pack --silent "$TRANSFORMERS" "$ORT" >/dev/null)
mkdir "$work/tf" "$work/ort"
tar -xzf "$work"/huggingface-transformers-*.tgz -C "$work/tf"
tar -xzf "$work"/onnxruntime-web-*.tgz -C "$work/ort"
cp "$work/tf/package/dist/transformers.min.js" "$out/"
cp "$work/ort/package/dist/ort-wasm-simd-threaded.asyncify.mjs" "$work/ort/package/dist/ort-wasm-simd-threaded.asyncify.wasm" "$out/"
check "$out/transformers.min.js" 8d6716d9086f57c30a4bf367dba61b887593573c770c454465e8019b2703e743
check "$out/ort-wasm-simd-threaded.asyncify.mjs" 0966b6105cd936744498aa60df7a22cbd47af3374dbc64a9ab561c08a71e3611
check "$out/ort-wasm-simd-threaded.asyncify.wasm" 49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082

# The encoder at full precision, which WebGPU runs fastest, and the decoder at 8 bits.
sums="
config.json c8a0de5ed8a083565a4319db29d0c210fda35b4d6076c2d711cae53ae00f3cb1
generation_config.json 3479b1f44a07e41db799e22599222fee5816738036def94a39841cb9cdbb4120
preprocessor_config.json a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d
tokenizer.json 5eb60cec1e77aeeb6869a2bb5a8e01a84c3fe5d072d75369343021fe6f5310d0
tokenizer_config.json 93879c3dccdd4b976f709acd85b44778873f30c275e67026f30ca1e4c975230c
onnx/encoder_model.onnx 1cc86302d480b061452d348638064383ab41b6f3333ddd0e423532d14edaf535
onnx/decoder_model_merged_quantized.onnx dd4761a3f7add26afda3512abff4706920404c2517e85a9f2ff090b0c0987909
"
mkdir -p "$out/models/$MODEL/onnx"
files=()
while read -r name sum; do
  [ -n "$name" ] || continue
  f="$out/models/$MODEL/$name"
  [ -f "$f" ] || curl -sSfL --retry 3 -o "$f" "https://huggingface.co/$MODEL/resolve/$MODEL_REV/$name"
  check "$f" "$sum"
  files+=("\"models/$MODEL/$name\"")
done <<< "$sums"
files+=('"transformers.min.js"' '"ort-wasm-simd-threaded.asyncify.mjs"' '"ort-wasm-simd-threaded.asyncify.wasm"')

# What the web version downloads, with the total size in bytes.
bytes=$(find "$out" -type f ! -name whisper.json -exec stat -c %s {} + 2>/dev/null || find "$out" -type f ! -name whisper.json -exec stat -f %z {} +)
total=$(echo "$bytes" | awk '{ s += $1 } END { print s }')
(IFS=,; printf '{"model": "%s", "bytes": %s, "files": [%s]}\n' "$MODEL" "$total" "${files[*]}") > "$out/whisper.json"
echo "Whisper for the web: $(du -sh "$out" | cut -f1) in $out"
