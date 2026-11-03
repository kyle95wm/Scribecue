# Linux Chromium for scripts/slow-chromium.sh: no graphics chip, so video is decoded in
# software, as on many Linux computers.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium ffmpeg python3 fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*
