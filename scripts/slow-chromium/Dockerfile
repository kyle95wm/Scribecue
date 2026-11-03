# Linux Chromium for scripts/slow-chromium.sh: no graphics chip, so video is decoded in
# software, as on many Linux computers. The desktop mode shows it in your own browser
# through noVNC.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium ffmpeg python3 fonts-dejavu-core \
    xvfb x11vnc novnc websockify openbox \
  && rm -rf /var/lib/apt/lists/*
