#!/bin/sh
# Runs inside the container: a screen, Chromium with Scribecue on it, and noVNC to show
# it in your own browser. Your folder is at /files.
set -eu
W=1440 H=900
# Your folder, under Home in Chromium's file window.
ln -sfn /files /root/files
Xvfb :1 -screen 0 ${W}x${H}x24 -nolisten tcp >/dev/null 2>&1 &
export DISPLAY=:1
sleep 1
openbox >/dev/null 2>&1 &
python3 -m http.server 8080 --bind 127.0.0.1 --directory /repo/app >/dev/null 2>&1 &
x11vnc -display :1 -forever -shared -nopw -localhost -quiet >/dev/null 2>&1 &
websockify --web /usr/share/novnc 6080 localhost:5900 >/dev/null 2>&1 &
# Chromium opens again if it's closed. The profile is kept, so the last run's lock goes.
while true; do
  rm -f /profile/Singleton*
  # --test-type hides the bar warning about --no-sandbox, which a container needs.
  chromium --no-sandbox --test-type --no-first-run --hide-crash-restore-bubble --user-data-dir=/profile --autoplay-policy=no-user-gesture-required \
    --window-position=0,0 --window-size=$W,$H http://localhost:8080/ >/dev/null 2>&1 || true
  sleep 1
done
