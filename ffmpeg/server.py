# A small HTTP server for Scribecue in front of ffmpeg. It makes one file at a time: the
# full mix, from a mix (a WAV) and, to put the mix into the video, the video; or a copy
# of a video that a browser without H.264 or AAC can play:
#
#   GET    /status              -> {"ffmpeg": "6.1.1", "burn": true}
#   POST   /jobs                {"codec": "aac" | "ac3" | "eac3", "video": "mp4" | null,
#                                "replace": false, "name": "Film - full mix"} -> {"id": "..."}
#                                or {"copy": "webm" | "mp4", "video": "mp4", "name": "Film"}
#                                or {"codec": "aac", "video": "mp4", "name": "Film",
#                                    "pauses": [[120.5, 4.2], ...]}, seconds, for an
#                                    extended video: the picture held at each pause
#                                or {"burn": {"subs": true, "timecode": true, "size": "m",
#                                    "bg": "none", "pos": "bottom", "small": true}, "video": "mp4",
#                                    "track": 0, "name": "Film"},
#                                    for a copy of the video with the script and the timecode
#                                    burnt in, as an MP4
#   PUT    /jobs/<id>/mix       the mix, a WAV, for the full mix
#   PUT    /jobs/<id>/subs      the script, an SRT, for a burn with subs
#   PUT    /jobs/<id>/video     the video, with video set
#   POST   /jobs/<id>/start
#   GET    /jobs/<id>           -> {"state": "waiting" | "running" | "done" | "failed",
#                                   "done": 0..1, "error": "..."}
#   GET    /jobs/<id>/result    the file, which is then deleted
#   DELETE /jobs/<id>
#
# Starting a job deletes any other, and so does the server starting, so files never pile
# up in /work. So does a job going five minutes without the page asking after it, as when
# the page was closed while ffmpeg worked.
import json
import os
import re
import secrets
import shutil
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote

WORK = "/work"
# Bitrates for a stereo track: AAC and E-AC-3 are transparent here, and 384 kbps is
# what AC-3 stereo usually gets for broadcast.
CODECS = {
    "aac": (["-c:a", "aac", "-b:a", "256k"], "m4a"),
    "ac3": (["-c:a", "ac3", "-b:a", "384k"], "ac3"),
    "eac3": (["-c:a", "eac3", "-b:a", "256k"], "eac3"),
}
VIDEOS = {"mp4", "m4v", "mov", "mkv", "webm"}
# A playable copy: "webm" makes the picture VP9, at most 720 lines high, fast rather than
# small, since it's for working on; "mp4" keeps the picture as it is, for a browser that
# plays it but not its sound. Either way the sound becomes Opus, in stereo.
COPIES = {"webm", "mp4"}
SCALE = "scale=-2:min(720\\,trunc(ih/2)*2)"
CHUNK = 1 << 20
MAX_JOB = 1 << 20  # a long film can have thousands of pauses to describe
MAX_PAUSES = 20000
# Burnt in, the script looks as it does over the video in Scribecue (see .overlay in
# style.css): its size, as libass measures it (a screen 288 units high, so it looks the
# same at any size), and its background, as how opaque the box behind each line is, from
# 00 to FF. Without one, an outline and a shadow.
SIZES = {"s": 16, "m": 20, "l": 25, "xl": 30}
BOXES = {"none": None, "light": "8C", "dark": "40", "solid": "00"}
MONO = "/usr/share/fonts/dejavu/DejaVuSansMono.ttf"
MAX_SUBS = 8 << 20
STALE = 300  # seconds without a word from the page before a job is deleted

jobs = {}
lock = threading.Lock()


def ffmpeg_version():
    out = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True).stdout
    m = re.match(r"ffmpeg version (\S+)", out)
    return m.group(1) if m else "unknown"




def clear(keep=None):
    for name in os.listdir(WORK):
        if name != keep:
            shutil.rmtree(os.path.join(WORK, name), ignore_errors=True)
    for id in [i for i in jobs if i != keep]:
        proc = jobs.pop(id).get("proc")
        if proc and proc.poll() is None:
            proc.kill()


def drop(id):
    job = jobs.pop(id, None)
    if job:
        proc = job.get("proc")
        if proc and proc.poll() is None:
            proc.kill()
        shutil.rmtree(job["dir"], ignore_errors=True)


def forget(now=None):
    """Deletes jobs the page has stopped asking after."""
    now = time.monotonic() if now is None else now
    for id in [i for i, j in jobs.items() if now - j["seen"] > STALE]:
        drop(id)


def forgetting():
    while True:
        time.sleep(60)
        with lock:
            forget()


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type:stream_tags=language:format=duration", "-of", "json", path],
        capture_output=True, text=True,
    )
    info = json.loads(out.stdout or "{}")
    audio = [s for s in info.get("streams", []) if s.get("codec_type") == "audio"]
    return audio, float(info.get("format", {}).get("duration") or 0)


def frame_rate(path):
    """The video's frame rate, as ffprobe gives it, such as 30000/1001."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", path],
        capture_output=True, text=True,
    ).stdout.strip()
    return out if re.fullmatch(r"[1-9]\d{0,6}/[1-9]\d{0,6}", out) else "25/1"


def good_burn(burn):
    return (isinstance(burn, dict) and set(burn) <= {"subs", "timecode", "size", "bg", "pos", "small"}
            and all(type(burn.get(k, False)) is bool for k in ("subs", "timecode", "small"))
            and bool(burn.get("subs") or burn.get("timecode")) and burn.get("size", "m") in SIZES
            and burn.get("bg", "none") in BOXES and burn.get("pos", "bottom") in ("bottom", "top"))


def script_style(burn):
    box = BOXES[burn.get("bg", "none")]
    look = (["BorderStyle=1", "OutlineColour=&H00000000&", "BackColour=&H80000000&", "Outline=2", "Shadow=3"] if box is None
            else ["BorderStyle=3", f"OutlineColour=&H{box}000000&", "BackColour=&HFF000000&", "Outline=2", "Shadow=0"])
    return ["PrimaryColour=&H00FFFFFF&", *look, f"Alignment={8 if burn.get('pos') == 'top' else 2}",
            "MarginV=50", "MarginL=12", "MarginR=12"]


def burn_filter(burn, rate, subs):
    """The picture's filters: smaller, then the timecode, then the script, so each is drawn
    at the size the video ends up. 29.97 and 59.94 count drop-frame timecode, as Scribecue
    shows it."""
    parts = []
    if burn.get("small"):
        parts.append(SCALE)
    if burn.get("timecode"):
        num, den = map(int, rate.split("/"))
        drop = den == 1001 and num in (30000, 60000)
        parts.append(
            f"drawtext=fontfile={MONO}:timecode='00\\:00\\:00\\{';' if drop else ':'}00':rate={rate}"
            ":fontsize=h/24:fontcolor=white:x=h/72:y=h/72:box=1:boxcolor=black@0.67:boxborderw=6")
    if burn.get("subs"):
        style = "\\,".join(["FontName=DejaVu Sans", f"FontSize={SIZES[burn.get('size', 'm')]}", *script_style(burn)])
        parts.append(f"subtitles=filename={subs}:force_style='{style}'")
    parts.append("format=yuv420p")
    return ",".join(parts)


def sums(terms):
    """Adds terms in halves: ffmpeg's expressions can't go too deep, as one long chain would."""
    if len(terms) < 2:
        return terms[0] if terms else "0"
    mid = len(terms) // 2
    return f"({sums(terms[:mid])}+{sums(terms[mid:])})"


def hold_filter(pauses):
    """The picture for an extended video. Each pause moves everything after it later, and
    the frame before the gap fills it. The last frame then goes on as long as the sound."""
    moved = sums([f"gte(T\\,{at:.6f})*{secs:.6f}" for at, secs in pauses])
    return (f"[0:v:0]setpts=PTS-STARTPTS+{moved}/TB,fps=fps=source_fps:start_time=0,"
            "tpad=stop=-1:stop_mode=clone,format=yuv420p[v]\n")


def good_pauses(pauses):
    return (isinstance(pauses, list) and 0 < len(pauses) <= MAX_PAUSES and all(
        isinstance(p, list) and len(p) == 2 and all(type(v) in (int, float) and 0 <= v < 1e6 for v in p)
        for p in pauses))


def command(job):
    """The ffmpeg arguments for a job, and the duration to measure progress against."""
    folder, codec = job["dir"], job["codec"]
    if job.get("copy"):
        video = os.path.join(folder, "video." + job["video"])
        picture = (["-c:v", "copy"] if job["copy"] == "mp4" else
                   ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1",
                    "-b:v", "0", "-crf", "36", "-vf", SCALE])
        return [
            "-i", video, "-map", "0:v:0", "-map", "0:a?", *picture,
            "-c:a", "libopus", "-b:a", "128k", "-ac", "2", "-map_metadata", "0",
            os.path.join(folder, "out." + job["copy"]),
        ], probe(video)[1]
    if job.get("burn"):
        video = os.path.join(folder, "video." + job["video"])
        return [
            "-i", video, "-vf", burn_filter(job["burn"], frame_rate(video), os.path.join(folder, "subs.srt")),
            "-map", "0:v:0", "-map", f"0:a:{job.get('track') or 0}?",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart", "-map_metadata", "0", os.path.join(folder, "out.mp4"),
        ], probe(video)[1]
    mix = os.path.join(folder, "mix.wav")
    if job.get("pauses"):
        video = os.path.join(folder, "video." + job["video"])
        script = os.path.join(folder, "pauses.txt")
        with open(script, "w") as f:
            f.write(hold_filter(job["pauses"]))
        webm = job["video"] == "webm"
        coded = (["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "6", "-row-mt", "1", "-b:v", "0", "-crf", "30",
                  "-c:a", "libopus", "-b:a", "192k"] if webm else
                 ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "256k"])
        return [
            "-i", video, "-i", mix, "-filter_complex_script", script, "-map", "[v]", "-map", "1:a",
            *coded, "-shortest", "-map_metadata", "0",
            os.path.join(folder, "out." + job["video"]),
        ], probe(video)[1] + sum(p[1] for p in job["pauses"])
    args, ext = CODECS[codec]
    if not job["video"]:
        return ["-i", mix, "-vn", *args, os.path.join(folder, f"out.{ext}")], probe(mix)[1]
    video = os.path.join(folder, "video." + job["video"])
    audio, secs = probe(video)
    n = 0 if job["replace"] else len(audio)  # where the mix's track goes
    if job["video"] == "webm":
        args = ["-c:a", "libopus", "-b:a", "192k"]  # all WebM can hold
    track = [a.replace(":a", f":a:{n}") if a.startswith("-") and ":a" in a else a for a in args]
    lang = (audio[0].get("tags", {}).get("language") if audio else None) or "und"
    keep = [] if job["replace"] else ["-map", "0:a?"]
    attach = ["-map", "0:t?"] if job["video"] == "mkv" else []
    return [
        "-i", video, "-i", mix,
        "-map", "0:v?", *keep, "-map", "1:a", "-map", "0:s?", *attach,
        "-c", "copy", *track,
        # MP4 and MOV players read the track's name from handler_name.
        f"-metadata:s:a:{n}", "title=Audio description", f"-metadata:s:a:{n}", "handler_name=Audio description",
        f"-metadata:s:a:{n}", f"language={lang}",
        # Players offer an added track as audio description, not in place of the sound.
        f"-disposition:a:{n}", "default" if job["replace"] else "visual_impaired+descriptions",
        os.path.join(folder, "out." + job["video"]),
    ], secs


def run(job):
    try:
        args, secs = command(job)
        proc = subprocess.Popen(
            ["ffmpeg", "-y", "-nostdin", "-v", "error", "-progress", "pipe:1", *args],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        job["proc"] = proc
        for line in proc.stdout:
            if line.startswith("out_time_us=") and secs > 0:
                try:
                    job["done"] = min(1, int(line.split("=")[1]) / 1e6 / secs)
                except ValueError:
                    pass
        err = proc.stderr.read().strip()
        if proc.wait() != 0:
            raise RuntimeError(err.splitlines()[-1] if err else "ffmpeg stopped")
        job["out"] = args[-1]
        job["state"], job["done"] = "done", 1
    except Exception as e:  # noqa: BLE001 - the page shows what went wrong
        job["state"], job["error"] = "failed", str(e)


class Handler(BaseHTTPRequestHandler):
    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def job(self):
        m = re.fullmatch(r"/jobs/([0-9a-f]{16})(/\w+)?", self.path)
        job = m and jobs.get(m.group(1))
        if job:
            job["seen"] = time.monotonic()
        return (job, m.group(2) or "") if job else (None, None)

    def do_GET(self):
        if self.path == "/status":
            return self.reply(200, {"ffmpeg": self.server.version, "burn": os.path.exists(MONO)})
        job, part = self.job()
        if not job:
            return self.reply(404, {"error": "no such job"})
        if part == "":
            return self.reply(200, {k: job[k] for k in ("state", "done", "error")})
        if part != "/result" or job["state"] != "done":
            return self.reply(404, {"error": "not ready"})
        path = job["out"]
        name = job["name"] + os.path.splitext(path)[1]
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(os.path.getsize(path)))
        self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + quote(name))
        self.end_headers()
        with open(path, "rb") as f:
            shutil.copyfileobj(f, self.wfile, CHUNK)
        with lock:
            clear()

    def do_POST(self):
        if self.path == "/jobs":
            try:
                body = json.loads(self.rfile.read(min(int(self.headers.get("Content-Length") or 0), MAX_JOB)) or "{}")
            except ValueError:
                return self.reply(400, {"error": "not JSON"})
            codec, video, copy, pauses = body.get("codec"), body.get("video"), body.get("copy"), body.get("pauses")
            burn, track = body.get("burn"), body.get("track", 0)
            if burn is not None and (not good_burn(burn) or video not in VIDEOS or copy or pauses is not None
                                     or type(track) is not int or not 0 <= track < 64):
                return self.reply(400, {"error": "unknown burn"})
            if burn is None and ((copy not in COPIES or video not in VIDEOS) if copy else (codec not in CODECS or (video and video not in VIDEOS))):
                return self.reply(400, {"error": "unknown format"})
            if pauses is not None and (not video or copy or not good_pauses(pauses)):
                return self.reply(400, {"error": "unknown pauses"})
            name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", str(body.get("name") or "full mix"))[:200]
            id = secrets.token_hex(8)
            with lock:
                clear()
                os.makedirs(os.path.join(WORK, id))
                jobs[id] = {"dir": os.path.join(WORK, id), "codec": codec, "video": video or None, "copy": copy or None, "pauses": pauses,
                            "replace": bool(body.get("replace")), "name": name,
                            "burn": burn, "track": track if burn else 0, "state": "waiting", "done": 0, "error": None,
                            "seen": time.monotonic()}
            return self.reply(200, {"id": id})
        job, part = self.job()
        if not job or part != "/start":
            return self.reply(404, {"error": "no such job"})
        need = (["subs.srt"] if (job["burn"] or {}).get("subs") else [] if job["burn"] or job["copy"] else ["mix.wav"]) + (
            ["video." + job["video"]] if job["video"] else [])
        if job["state"] != "waiting" or not all(os.path.exists(os.path.join(job["dir"], f)) for f in need):
            return self.reply(409, {"error": "the files haven't all arrived"})
        job["state"] = "running"
        threading.Thread(target=run, args=(job,), daemon=True).start()
        self.reply(200, {"state": "running"})

    def do_PUT(self):
        job, part = self.job()
        if (not job or part not in ("/mix", "/video", "/subs") or (part == "/video" and not job["video"])
                or (part == "/mix" and (job["copy"] or job["burn"])) or (part == "/subs" and not (job["burn"] or {}).get("subs"))):
            return self.reply(404, {"error": "no such job"})
        size = int(self.headers.get("Content-Length") or 0)
        if size <= 0:
            return self.reply(411, {"error": "the file is empty"})
        if part == "/subs" and size > MAX_SUBS:
            return self.reply(413, {"error": "the script is too big"})
        # Room for this file and what ffmpeg makes from it, with some to spare.
        if shutil.disk_usage(WORK).free < size * 2 + (512 << 20):
            return self.reply(507, {"error": f"Docker has too little disk space for a {size / 1e9:.1f} GB file"})
        name = {"/mix": "mix.wav", "/subs": "subs.srt"}.get(part) or "video." + job["video"]
        path, left = os.path.join(job["dir"], name), size
        with open(path + ".part", "wb") as f:
            while left:
                data = self.rfile.read(min(CHUNK, left))
                if not data:
                    return self.reply(400, {"error": "the upload stopped"})
                f.write(data)
                left -= len(data)
                job["seen"] = time.monotonic()
        os.replace(path + ".part", path)
        self.reply(200, {"bytes": size})

    def do_DELETE(self):
        job, _ = self.job()
        if job:
            with lock:
                clear()
        self.reply(200, {})

    def log_message(self, *args):
        pass  # file names stay private


if __name__ == "__main__":
    clear()
    threading.Thread(target=forgetting, daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", 5000), Handler)
    server.version = ffmpeg_version()
    server.serve_forever()
