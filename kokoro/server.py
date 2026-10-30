# A small HTTP server for Scribecue's Kokoro voices, in front of kokoro-onnx.
#
#   GET  /voices      -> {"voices": [{"id": "af_heart", "lang": "en-US", "gender": "female"}, ...]}
#   POST /synthesize  {"text": "...", "voice": "af_heart", "speed": 1.0}  -> a WAV file,
#                     24 kHz mono 16-bit
import io
import json
import os
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import onnxruntime as rt
from kokoro_onnx import Kokoro

# A voice's first letter is its language. Only those espeak-ng can sound out are offered:
# Kokoro's Japanese and Chinese voices need other tools.
LANGS = {"a": "en-us", "b": "en-gb", "e": "es", "f": "fr-fr", "h": "hi", "i": "it", "p": "pt-br"}
GENDERS = {"f": "female", "m": "male"}

# Half the cores, so the browser playing the video always has some to itself.
options = rt.SessionOptions()
options.intra_op_num_threads = max(1, (os.cpu_count() or 2) // 2)
session = rt.InferenceSession(f"/models/{os.environ.get('KOKORO_MODEL', 'kokoro-v1.0.onnx')}", options, providers=["CPUExecutionProvider"])
kokoro = Kokoro.from_session(session, "/models/voices-v1.0.bin")
VOICES = [v for v in kokoro.get_voices() if v[:1] in LANGS and v[1:2] in GENDERS]
busy = threading.Lock()  # one reading at a time; each already uses several cores
MAX_TEXT = 2000  # characters: far more than a block of description


def lang_tag(voice):
    code = LANGS[voice[0]]
    return code.split("-")[0] + ("-" + code.split("-")[1].upper() if "-" in code else "")


class Handler(BaseHTTPRequestHandler):
    def reply(self, code, body, kind="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path != "/voices":
            return self.reply(404, {"error": "not found"})
        self.reply(200, {"voices": [{"id": v, "lang": lang_tag(v), "gender": GENDERS[v[1]]} for v in VOICES]})

    def do_POST(self):
        if self.path != "/synthesize":
            return self.reply(404, {"error": "not found"})
        try:
            body = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length") or 0), 64 << 10)))
            text, voice = str(body.get("text", "")).strip(), body.get("voice")
            speed = float(body.get("speed", 1))
        except (ValueError, TypeError, AttributeError):
            return self.reply(400, {"error": "expected JSON with text, voice and speed"})
        if voice not in VOICES:
            return self.reply(400, {"error": f"no voice called {voice}"})
        if not text or len(text) > MAX_TEXT:
            return self.reply(400, {"error": "the text is empty or too long"})
        # Kokoro reads between half and twice its normal speed.
        speed = min(2.0, max(0.5, speed))
        with busy:
            audio, rate = kokoro.create(text, voice=voice, speed=speed, lang=LANGS[voice[0]])
        pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()
        out = io.BytesIO()
        with wave.open(out, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes(pcm)
        self.reply(200, out.getvalue(), "audio/wav")

    def log_message(self, *args):
        pass  # don't log what's read


ThreadingHTTPServer(("0.0.0.0", 5000), Handler).serve_forever()
