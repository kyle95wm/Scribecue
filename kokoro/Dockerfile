# Kokoro text to speech for Scribecue: very natural voices that run on this computer.
# The model and its voices are downloaded once, when the image is built. At run time the
# container has no internet access (see docker-compose.yml) and is only reachable through
# Scribecue's own server.
FROM python:3.12-slim

# The model, from https://github.com/thewh1teagle/kokoro-onnx/releases: kokoro-v1.0.onnx
# (325 MB) sounds best; kokoro-v1.0.int8.onnx (92 MB) is smaller and quicker, a little rougher.
ARG KOKORO_MODEL=kokoro-v1.0.onnx
ENV KOKORO_MODEL=${KOKORO_MODEL}

RUN pip install --no-cache-dir "kokoro-onnx==0.6.1" \
 && mkdir /models \
 && python -c "import os, urllib.request as u; base = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/'; [u.urlretrieve(base + f, '/models/' + f) for f in (os.environ['KOKORO_MODEL'], 'voices-v1.0.bin')]" \
 && useradd --system --uid 10001 --no-create-home kokoro

COPY server.py /app/server.py
USER 10001
EXPOSE 5000
CMD ["python", "/app/server.py"]
