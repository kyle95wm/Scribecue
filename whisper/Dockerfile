# Whisper speech to text for Scribecue: fills in the text of blocks you mark, from their
# audio, on this computer. The model is downloaded once, when the image is built. At run
# time the container has no internet access (see docker-compose.yml) and is only
# reachable through Scribecue's own server.
FROM python:3.12-slim

# The Whisper model, by faster-whisper name: tiny.en, base.en, small.en, medium.en, or
# large-v3 and the others without ".en" for other languages. Bigger is more accurate and
# slower. small.en is about 250 MB.
ARG WHISPER_MODEL=small.en
ENV WHISPER_MODEL=${WHISPER_MODEL} HF_HUB_OFFLINE=1

RUN pip install --no-cache-dir "faster-whisper==1.2.1" \
 && HF_HUB_OFFLINE=0 python -c "import os; from faster_whisper import download_model; download_model(os.environ['WHISPER_MODEL'], output_dir='/models/' + os.environ['WHISPER_MODEL'])" \
 && useradd --system --uid 10001 --no-create-home whisper

COPY server.py /app/server.py
USER 10001
EXPOSE 5000
CMD ["python", "/app/server.py"]
