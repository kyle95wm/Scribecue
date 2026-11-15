# A small HTTP server for Scribecue's speech to text, in front of faster-whisper.
#
#   GET  /status      -> {"model": "small.en"}
#   POST /transcribe  a WAV file, 16 kHz mono 16-bit  -> {"text": "..."}
#   POST /transcribe?timings=1  the same, plus when each sentence and word was said:
#        {"text", "segments": [{"start", "end", "text"}], "words": [{"start", "end", "text"}]}
import io
import json
import os
import threading
import wave
from urllib.parse import parse_qs, urlsplit
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from faster_whisper import WhisperModel

NAME = os.environ.get("WHISPER_MODEL", "small.en")
# Half the cores, so the browser playing the video always has some to itself: with
# all of them, its sound can stutter while a block is transcribed.
THREADS = max(1, (os.cpu_count() or 2) // 2)
model = WhisperModel(f"/models/{NAME}", device="cpu", compute_type="int8", cpu_threads=THREADS)
busy = threading.Lock()  # one transcription at a time
MAX_BYTES = 32 << 20  # about 17 minutes of audio


class Handler(BaseHTTPRequestHandler):
    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/status":
            self.reply(200, {"model": NAME})
        else:
            self.reply(404, {"error": "not found"})

    def do_POST(self):
        url = urlsplit(self.path)
        timings = parse_qs(url.query).get("timings") == ["1"]
        if url.path != "/transcribe":
            return self.reply(404, {"error": "not found"})
        size = int(self.headers.get("Content-Length") or 0)
        if not 0 < size <= MAX_BYTES:
            return self.reply(413, {"error": "the audio is empty or too long"})
        try:
            with wave.open(io.BytesIO(self.rfile.read(size))) as w:
                if (w.getframerate(), w.getnchannels(), w.getsampwidth()) != (16000, 1, 2):
                    return self.reply(400, {"error": "expected 16 kHz mono 16-bit WAV"})
                pcm = w.readframes(w.getnframes())
        except (wave.Error, EOFError) as e:
            return self.reply(400, {"error": f"not a WAV file: {e}"})
        audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768
        with busy:
            segments, _ = model.transcribe(
                audio,
                language="en" if NAME.endswith(".en") else None,
                beam_size=5,
                condition_on_previous_text=False,
                vad_filter=True,  # skip silence, where Whisper imagines words such as "you"
                word_timestamps=timings,
            )
            segments = list(segments)
        body = {"text": " ".join(s.text.strip() for s in segments)}
        if timings:
            r = lambda t: round(t, 2)
            body["segments"] = [{"start": r(s.start), "end": r(s.end), "text": s.text.strip()} for s in segments]
            body["words"] = [{"start": r(w.start), "end": r(w.end), "text": w.word.strip()} for s in segments for w in (s.words or [])]
        self.reply(200, body)

    def log_message(self, *args):
        pass  # don't log what's said


ThreadingHTTPServer(("0.0.0.0", 5000), Handler).serve_forever()
