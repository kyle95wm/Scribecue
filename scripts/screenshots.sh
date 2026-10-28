#!/bin/sh
# Retakes the README screenshots in docs/screenshots from a generated test video.
# Needs ffmpeg, Node, Python 3 and Google Chrome. Chrome runs headless and muted.
# Usage: scripts/screenshots.sh
#        CHROME=/path/to/chrome scripts/screenshots.sh
set -eu
cd "$(dirname "$0")/.."
root=$(pwd)
chrome=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
work=$(mktemp -d)
site_port=8487
cdp_port=9333
cleanup() {
  for pid in ${chrome_pid:-} ${site_pid:-}; do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  rm -rf "$work"
}
trap cleanup EXIT

echo '== Making the test video'
# A minute of slow colour gradients with two audio tracks: "Original" (tones and a
# noise bed) and "Audio Description", which adds a voice-like noise during the lines
# the screenshots use. It's generated, so no real programme material is involved.
seg="between(t,3,6.2)+between(t,11.5,14)+between(t,20,23.8)+between(t,30.2,32.5)+between(t,38,41.6)+between(t,47,50.3)"
ffmpeg -loglevel error -y \
  -f lavfi -i "gradients=s=1280x720:r=25:d=60:c0=0x0b1d3a:c1=0x1f6f8b:c2=0x3a2c6b:c3=0x0e4d4a:n=4:speed=0.012,format=yuv420p" \
  -f lavfi -i "sine=f=110:r=48000:d=60" -f lavfi -i "sine=f=164.8:r=48000:d=60" \
  -f lavfi -i "anoisesrc=c=pink:a=0.5:r=48000:d=60" -f lavfi -i "anoisesrc=c=pink:a=0.6:r=48000:d=60:seed=7" \
  -filter_complex "[1]volume=0.05[a1];[2]volume=0.035[a2];[3]lowpass=f=900,volume='0.10+0.06*sin(2*PI*t/9)':eval=frame[bed];[a1][a2][bed]amix=inputs=3:normalize=0,asplit[orig][orig2];[4]bandpass=f=1200:width_type=h:w=1800,volume='0.9*(0.55+0.45*sin(2*PI*4.3*t)*sin(2*PI*1.7*t+1))*($seg)':eval=frame[nar];[orig2][nar]amix=inputs=2:normalize=0[ad]" \
  -map 0 -map "[orig]" -map "[ad]" -c:v libx264 -crf 28 -preset veryfast -c:a aac -b:a 96k \
  -metadata:s:a:0 title="Original" -metadata:s:a:0 language=eng \
  -metadata:s:a:1 title="Audio Description" -metadata:s:a:1 language=eng \
  -disposition:a:0 default -disposition:a:1 0 "$work/demo.mkv"

echo '== Serving a copy of the app'
mkdir "$work/site"
cp -R app/. "$work/site/"
mv "$work/demo.mkv" "$work/site/"
# Serves the copy, and passes /tts/ on to a running Scribecue with Piper, if there is one,
# so the text to speech panel can show Piper voices.
cat > "$work/serve.py" <<'PY'
import http.server, sys, urllib.request
site, port, upstream = sys.argv[1], int(sys.argv[2]), sys.argv[3]
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=site, **k)
    def log_message(self, *a): pass
    def proxy(self, body=None):
        try:
            req = urllib.request.Request(upstream + self.path, data=body, method=self.command,
                                         headers={'Content-Type': self.headers.get('Content-Type', '')})
            with urllib.request.urlopen(req, timeout=60) as r: data, code = r.read(), r.status
        except Exception: data, code = b'', 502
        self.send_response(code); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_GET(self):
        if self.path.startswith('/tts/'): return self.proxy()
        super().do_GET()
    def do_POST(self):
        if self.path.startswith('/tts/'): return self.proxy(self.rfile.read(int(self.headers.get('Content-Length', 0))))
        self.send_error(405)
http.server.ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
PY
python3 "$work/serve.py" "$work/site" "$site_port" "http://127.0.0.1:${SCRIBECUE_PORT:-8484}" &
site_pid=$!
if curl -fs -o /dev/null "http://127.0.0.1:${SCRIBECUE_PORT:-8484}/tts/voices"; then
  echo 'Using Piper voices from the running Scribecue'
else
  echo 'Piper is not running, so the text to speech panel shows browser voices only'
fi
"$chrome" --headless=new --mute-audio --remote-debugging-port="$cdp_port" \
  --user-data-dir="$work/profile" --autoplay-policy=no-user-gesture-required --no-first-run \
  about:blank >/dev/null 2>&1 &
chrome_pid=$!
for _ in $(seq 40); do
  curl -fs "http://127.0.0.1:$cdp_port/json/version" >/dev/null 2>&1 &&
    curl -fs -o /dev/null "http://127.0.0.1:$site_port/" 2>/dev/null && break
  sleep 0.25
done

echo '== Taking screenshots'
node scripts/screenshots.mjs "$cdp_port" "$root/docs/screenshots" "http://127.0.0.1:$site_port/"
echo "Saved to docs/screenshots. Look them over before committing."
