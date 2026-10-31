# A small HTTP server for Scribecue that keeps a narrator's takes on disk, in the
# scribecue-takes volume, so clearing the browser doesn't lose them. Each recording has
# a folder, with every take as a WAV file and an index of what each one is:
#
#   GET    /status                  -> {"takes": 12, "bytes": 103000000}
#   GET    /r/<rec>                 -> [{"id", "block", "start", "duration", "peak", "chosen", "made"}]
#   PUT    /r/<rec>/<id>            the take, a WAV, with X-Take: {"block", "start", "duration",
#                                   "peak", "made", "choose"} -> {"bytes": n}
#   GET    /r/<rec>/<id>            the take's WAV
#   POST   /r/<rec>/<id>/choose     makes it the one chosen for its block
#   DELETE /r/<rec>/<id>
#   DELETE /all                     every take of every recording
#
# <rec> is Scribecue's id for a recording, and <id> a take's own (a UUID).
import json
import os
import re
import shutil
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = "/takes"
CHUNK = 1 << 20
MAX_TAKE = 1 << 30  # a 24-bit mono take at 48 kHz: about two hours
REC = r"[a-z0-9]{1,16}-\d{1,6}"
ID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
FIELDS = ("block", "start", "duration", "peak", "made")

lock = threading.Lock()


def folder(rec):
    return os.path.join(ROOT, rec)


def load(rec):
    try:
        with open(os.path.join(folder(rec), "index.json")) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def store(rec, index):
    path = os.path.join(folder(rec), "index.json")
    with open(path + ".part", "w") as f:
        json.dump(index, f)
    os.replace(path + ".part", path)


def wav(rec, id):
    return os.path.join(folder(rec), id + ".wav")


def meta(raw):
    """A take's details from the X-Take header, or None if they don't make sense."""
    try:
        m = json.loads(raw or "")
    except ValueError:
        return None
    if not isinstance(m, dict):
        return None
    num = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool)
    if not (isinstance(m.get("block"), int) and m["block"] >= 0 and num(m.get("start")) and num(m.get("duration"))
            and num(m.get("made")) and (m.get("peak") is None or num(m.get("peak")))):
        return None
    return {k: m.get(k) for k in FIELDS}


def choose(index, id):
    block = index[id]["block"]
    for k, t in index.items():
        if t["block"] == block:
            t["chosen"] = k == id


def totals():
    count = size = 0
    for rec in os.listdir(ROOT) if os.path.isdir(ROOT) else []:
        if re.fullmatch(REC, rec):
            for name in os.listdir(folder(rec)):
                if name.endswith(".wav"):
                    count += 1
                    size += os.path.getsize(os.path.join(folder(rec), name))
    return {"takes": count, "bytes": size}


class Handler(BaseHTTPRequestHandler):
    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def route(self):
        """(rec, id, action) from the path, or None."""
        m = re.fullmatch(rf"/r/({REC})(?:/({ID})(/choose)?)?", self.path)
        return (m.group(1), m.group(2), m.group(3)) if m else None

    def do_GET(self):
        if self.path == "/status":
            with lock:
                return self.reply(200, totals())
        r = self.route()
        if not r or r[2]:
            return self.reply(404, {"error": "not found"})
        rec, id, _ = r
        if not id:
            with lock:
                index = load(rec)
            return self.reply(200, [{"id": k, **t} for k, t in index.items()])
        path = wav(rec, id)
        if not os.path.exists(path):
            return self.reply(404, {"error": "no such take"})
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(os.path.getsize(path)))
        self.end_headers()
        with open(path, "rb") as f:
            shutil.copyfileobj(f, self.wfile, CHUNK)

    def do_PUT(self):
        r = self.route()
        if not r or not r[1] or r[2]:
            return self.reply(404, {"error": "not found"})
        rec, id, _ = r
        m = meta(self.headers.get("X-Take"))
        if not m:
            return self.reply(400, {"error": "the take's details are missing"})
        size = int(self.headers.get("Content-Length") or 0)
        if size <= 44:
            return self.reply(411, {"error": "the take is empty"})
        if size > MAX_TAKE:
            return self.reply(413, {"error": "the take is too long"})
        os.makedirs(folder(rec), exist_ok=True)
        if shutil.disk_usage(ROOT).free < size + (256 << 20):
            return self.reply(507, {"error": "Docker has too little disk space for the take"})
        path, left = wav(rec, id), size
        with open(path + ".part", "wb") as f:
            while left:
                data = self.rfile.read(min(CHUNK, left))
                if not data:
                    os.remove(path + ".part")
                    return self.reply(400, {"error": "the upload stopped"})
                f.write(data)
                left -= len(data)
        os.replace(path + ".part", path)
        with lock:
            index = load(rec)
            index[id] = {**m, "chosen": False}
            if json.loads(self.headers.get("X-Take")).get("choose"):
                choose(index, id)
            store(rec, index)
        self.reply(200, {"bytes": size})

    def do_POST(self):
        r = self.route()
        if not r or not r[1] or not r[2]:
            return self.reply(404, {"error": "not found"})
        rec, id, _ = r
        with lock:
            index = load(rec)
            if id not in index:
                return self.reply(404, {"error": "no such take"})
            choose(index, id)
            store(rec, index)
        self.reply(200, {})

    def do_DELETE(self):
        if self.path == "/all":
            with lock:
                for rec in os.listdir(ROOT):
                    if re.fullmatch(REC, rec):
                        shutil.rmtree(folder(rec), ignore_errors=True)
            return self.reply(200, {})
        r = self.route()
        if not r or not r[1] or r[2]:
            return self.reply(404, {"error": "not found"})
        rec, id, _ = r
        with lock:
            index = load(rec)
            if index.pop(id, None) is not None:
                store(rec, index)
            try:
                os.remove(wav(rec, id))
            except OSError:
                pass
        self.reply(200, {})

    def log_message(self, *args):
        pass  # what's recorded stays private


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 5000), Handler).serve_forever()
