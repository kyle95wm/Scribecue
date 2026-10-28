# Piper text to speech for Scribecue: natural-sounding voices that run on this computer.
# The voices are downloaded once, when the image is built. At run time the container
# has no internet access (see docker-compose.yml) and is only reachable through
# Scribecue's own server.
FROM python:3.12-slim

# Voices to include, by Piper name: https://huggingface.co/rhasspy/piper-voices
# The first one is the default. Each medium-quality voice is about 60 MB.
ARG PIPER_VOICES="en_US-lessac-medium en_US-ryan-medium en_GB-alba-medium en_GB-alan-medium"
ENV PIPER_VOICES=${PIPER_VOICES}

RUN pip install --no-cache-dir "piper-tts[http]==1.8.0" \
 && mkdir /voices \
 && python -m piper.download_voices --download-dir /voices ${PIPER_VOICES} \
 && useradd --system --uid 10001 --no-create-home piper

USER 10001
WORKDIR /voices
EXPOSE 5000
CMD ["sh", "-c", "set -- $PIPER_VOICES; exec python -m piper.http_server --host 0.0.0.0 --port 5000 --data-dir /voices -m \"$1\""]
