# A small HTTP server for Scribecue that keeps a narrator's takes on disk, in the
# scribecue-takes volume, so clearing the browser doesn't lose them. Each recording has
# a folder, with every take as a WAV file and an index of what each one is:
#
#   GET    /status                  -> {"takes": 12, "bytes": 103000000}
#   GET    /r/<rec>                 -> [{"id", "block", "start", "duration", "peak", "chosen", "made",
#                                   "line", "ver"}]
#   PUT    /r/<rec>/<id>            the take, a WAV, with X-Take: {"block", "start", "duration",
#                                   "peak", "made", "punch", "line", "ver", "choose"} -> {"bytes": n}.
#                                   line is the block it was read for: {"start", "end", "text"}
#   GET    /r/<rec>/<id>            the take's WAV
#   POST   /r/<rec>/<id>/choose     makes it the one chosen for its block
#   POST   /r/<rec>/<id>/edit       splits, moves and trims it: {"splits": [s], "parts": [{"shift",
#                                   "head", "tail", "cut"?}]}, in seconds, with a part more than
#                                   splits; "cut" deletes a part
#   POST   /r/<rec>/relink          matches takes to a new version of the script: [{"id", "block",
#                                   "start", "line", "chosen"}]; block -1 is none
#   POST   /r/<rec>/move            moves every take to another recording: {"to": <rec>}
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
FIELDS = ("block", "start", "duration", "peak", "made", "punch", "line", "ver")
MAX_TEXT = 5000

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


def num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def line(v):
    """The block a take was read for, or False if it doesn't make sense. None is none."""
    if v is None:
        return None
    if isinstance(v, dict) and num(v.get("start")) and num(v.get("end")) and isinstance(v.get("text"), str) and len(v["text"]) <= MAX_TEXT:
        return {"start": v["start"], "end": v["end"], "text": v["text"]}
    return False


def meta(raw):
    """A take's details from the X-Take header, or None if they don't make sense."""
    try:
        m = json.loads(raw or "")
    except ValueError:
        return None
    if not isinstance(m, dict):
        return None
    if not (isinstance(m.get("block"), int) and m["block"] >= 0 and num(m.get("start")) and num(m.get("duration"))
            and num(m.get("made")) and (m.get("peak") is None or num(m.get("peak")))
            and (m.get("punch") is None or num(m.get("punch")))
            and line(m.get("line")) is not False
            and (m.get("ver") is None or (isinstance(m["ver"], int) and not isinstance(m["ver"], bool) and m["ver"] >= 0))):
        return None
    return {**{k: m.get(k) for k in FIELDS}, "line": line(m.get("line"))}


def relinks(raw):
    """Takes matched to a new script, from a POST body, or None if they don't make sense."""
    try:
        r = json.loads(raw or b"")
    except ValueError:
        return None
    if not isinstance(r, list) or len(r) > 100000:
        return None
    out = []
    for x in r:
        if not (isinstance(x, dict) and isinstance(x.get("id"), str) and re.fullmatch(ID, x["id"])
                and isinstance(x.get("block"), int) and not isinstance(x["block"], bool) and x["block"] >= -1
                and num(x.get("start")) and line(x.get("line")) and isinstance(x.get("chosen"), bool)):
            return None
        out.append({"id": x["id"], "block": x["block"], "start": x["start"], "line": line(x["line"]), "chosen": x["chosen"] and x["block"] >= 0})
    return out


def edit(raw):
    """Splits, moves and trims from a POST body, or None if they don't make sense."""
    try:
        e = json.loads(raw or b"")
    except ValueError:
        return None
    ok = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and abs(v) < 1e6
    if not isinstance(e, dict) or not isinstance(e.get("splits"), list) or not isinstance(e.get("parts"), list):
        return None
    splits, parts = e["splits"], e["parts"]
    if len(splits) > 200 or len(parts) != len(splits) + 1 or not all(ok(s) and s > 0 for s in splits):
        return None
    for p in parts:
        if not isinstance(p, dict) or not all(ok(p.get(k)) for k in ("shift", "head", "tail")):
            return None
        if p.get("cut") not in (None, True):
            return None
    if all(p.get("cut") for p in parts):
        return None  # a take keeps one part at least
    return {"splits": splits, "parts": [{**{k: p[k] for k in ("shift", "head", "tail")}, **({"cut": True} if p.get("cut") else {})} for p in parts]}


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
        """(rec, id, action) from the path, or None. A whole recording's action has no id."""
        m = re.fullmatch(rf"/r/({REC})(?:/({ID})(/choose|/edit)?|(/relink|/move))?", self.path)
        return (m.group(1), m.group(2), m.group(3) or m.group(4)) if m else None

    def body(self, limit):
        size = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(size) if 0 < size <= limit else b""

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
        if not r or not r[2]:
            return self.reply(404, {"error": "not found"})
        rec, id, action = r
        if action == "/relink":
            return self.relink(rec)
        if action == "/move":
            return self.move(rec)
        e = None
        if action == "/edit":
            e = edit(self.body(4095))
            if not e:
                return self.reply(400, {"error": "the edit doesn't make sense"})
        with lock:
            index = load(rec)
            if id not in index:
                return self.reply(404, {"error": "no such take"})
            if e:
                index[id]["edit"] = e
            else:
                choose(index, id)
            store(rec, index)
        self.reply(200, {})

    def relink(self, rec):
        changes = relinks(self.body(32 << 20))
        if changes is None:
            return self.reply(400, {"error": "the takes don't make sense"})
        with lock:
            index = load(rec)
            for c in changes:
                if c["id"] in index:
                    index[c["id"]].update({k: c[k] for k in ("block", "start", "line", "chosen")})
            if index:
                store(rec, index)
        self.reply(200, {})

    def move(self, rec):
        try:
            to = json.loads(self.body(4095) or b"").get("to")
        except (ValueError, AttributeError):
            to = None
        if not isinstance(to, str) or not re.fullmatch(REC, to) or to == rec:
            return self.reply(400, {"error": "there's nowhere to move the takes"})
        with lock:
            index, there = load(rec), load(to)
            if index:
                os.makedirs(folder(to), exist_ok=True)
                for id in index:
                    if os.path.exists(wav(rec, id)):
                        os.replace(wav(rec, id), wav(to, id))
                there.update(index)
                store(to, there)
                shutil.rmtree(folder(rec), ignore_errors=True)
        self.reply(200, {"moved": len(index)})

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
