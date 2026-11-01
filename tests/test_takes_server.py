# The takes container's server (takes/server.py), run against a temporary folder.
# Run by scripts/check.sh.
import importlib.util
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

spec = importlib.util.spec_from_file_location("takes_server", os.path.join(os.path.dirname(__file__), "..", "takes", "server.py"))
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

REC = "abc123-3"
A, B, C = ("00000000-0000-4000-8000-00000000000" + c for c in "abc")
WAV = b"RIFF" + bytes(40) + bytes(range(256)) * 4


class Takes(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        server.ROOT = self.dir.name
        self.http = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=self.http.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.http.server_port}"

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.dir.cleanup()

    def call(self, method, path, body=None, headers=None):
        req = urllib.request.Request(self.base + path, data=body, method=method, headers=headers or {})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def put(self, id, block, choose=True, peak=-10.0):
        take = {"block": block, "start": 2.5, "duration": 1.5, "peak": peak, "made": 1, "choose": choose}
        return self.call("PUT", f"/r/{REC}/{id}", WAV, {"X-Take": json.dumps(take)})

    def listing(self):
        code, body = self.call("GET", f"/r/{REC}")
        self.assertEqual(code, 200)
        return {t["id"]: t for t in json.loads(body)}

    def test_a_take_is_kept_and_comes_back(self):
        self.assertEqual(self.put(A, 0)[0], 200)
        self.assertEqual(self.call("GET", f"/r/{REC}/{A}"), (200, WAV))
        t = self.listing()[A]
        self.assertEqual((t["block"], t["start"], t["duration"], t["peak"], t["chosen"]), (0, 2.5, 1.5, -10.0, True))
        self.assertEqual(json.loads(self.call("GET", "/status")[1]), {"takes": 1, "bytes": len(WAV)})

    def test_one_take_is_chosen_per_block(self):
        self.put(A, 0)
        self.put(B, 0)
        self.put(C, 1)
        self.assertEqual({k: t["chosen"] for k, t in self.listing().items()}, {A: False, B: True, C: True})
        self.assertEqual(self.call("POST", f"/r/{REC}/{A}/choose")[0], 200)
        self.assertEqual({k: t["chosen"] for k, t in self.listing().items()}, {A: True, B: False, C: True})
        self.put(B, 0, choose=False)  # kept, but not chosen
        self.assertTrue(self.listing()[A]["chosen"])

    def test_deleting_a_take_removes_its_file(self):
        self.put(A, 0)
        self.assertEqual(self.call("DELETE", f"/r/{REC}/{A}")[0], 200)
        self.assertEqual(self.listing(), {})
        self.assertEqual(self.call("GET", f"/r/{REC}/{A}")[0], 404)
        self.assertEqual(os.listdir(os.path.join(self.dir.name, REC)), ["index.json"])

    def test_clearing_removes_every_recording(self):
        self.put(A, 0)
        other = REC.replace("abc", "xyz")
        take = {"block": 0, "start": 0, "duration": 1, "peak": -9, "made": 1}
        self.call("PUT", f"/r/{other}/{B}", WAV, {"X-Take": json.dumps(take)})
        os.makedirs(os.path.join(self.dir.name, "lost+found"))  # not Scribecue's: left alone
        self.assertEqual(self.call("DELETE", "/all")[0], 200)
        self.assertEqual(json.loads(self.call("GET", "/status")[1]), {"takes": 0, "bytes": 0})
        self.assertEqual(os.listdir(self.dir.name), ["lost+found"])

    def test_a_punch_in_keeps_where_it_joins(self):
        take = {"block": 0, "start": 2.5, "duration": 3, "peak": -10, "made": 2, "punch": 4.25, "choose": True}
        self.assertEqual(self.call("PUT", f"/r/{REC}/{A}", WAV, {"X-Take": json.dumps(take)})[0], 200)
        self.put(B, 1)
        self.assertEqual(self.listing()[A]["punch"], 4.25)
        self.assertIsNone(self.listing()[B]["punch"])
        take["punch"] = "x"
        self.assertEqual(self.call("PUT", f"/r/{REC}/{C}", WAV, {"X-Take": json.dumps(take)})[0], 400)

    def test_a_take_keeps_its_moves_and_trims(self):
        self.put(A, 0)
        edit = {"splits": [1.2], "parts": [{"shift": -0.25, "head": 0.1, "tail": 0}, {"shift": -0.6, "head": 0.2, "tail": 0.5}]}
        self.assertEqual(self.call("POST", f"/r/{REC}/{A}/edit", json.dumps(edit).encode())[0], 200)
        self.assertEqual(self.listing()[A]["edit"], edit)
        self.assertEqual(self.call("GET", f"/r/{REC}/{A}"), (200, WAV))  # the sound itself is untouched
        part = {"shift": 0, "head": 0, "tail": 0}
        for bad in (b"", b"[]", json.dumps({"splits": [], "parts": []}).encode(), json.dumps({"splits": [1], "parts": [part]}).encode(),
                    json.dumps({"splits": [], "parts": [{**part, "head": -1}]}).encode(), json.dumps({"splits": ["x"], "parts": [part, part]}).encode()):
            self.assertEqual(self.call("POST", f"/r/{REC}/{A}/edit", bad)[0], 400, bad)
        self.assertEqual(self.call("POST", f"/r/{REC}/{B}/edit", json.dumps(edit).encode())[0], 404)
        self.assertEqual(self.listing()[A]["edit"], edit, "a bad edit leaves the last good one")
        cut = {"splits": [1.2], "parts": [{"shift": 0, "head": 0, "tail": 0}, {"shift": 0, "head": 0, "tail": 0, "cut": True}]}
        self.assertEqual(self.call("POST", f"/r/{REC}/{A}/edit", json.dumps(cut).encode())[0], 200)
        self.assertEqual(self.listing()[A]["edit"], cut)
        every = {"splits": [1.2], "parts": [{"shift": 0, "head": 0, "tail": 0, "cut": True}] * 2}
        self.assertEqual(self.call("POST", f"/r/{REC}/{A}/edit", json.dumps(every).encode())[0], 400)

    def test_silence_has_no_peak(self):
        self.put(A, 0, peak=None)
        self.assertIsNone(self.listing()[A]["peak"])

    def test_bad_requests_are_turned_away(self):
        self.assertEqual(self.call("PUT", f"/r/{REC}/{A}", WAV)[0], 400)  # no details
        self.assertEqual(self.call("PUT", f"/r/{REC}/{A}", WAV, {"X-Take": '{"block": "x"}'})[0], 400)
        self.assertEqual(self.call("PUT", f"/r/{REC}/{A}", b"RIFF", {"X-Take": json.dumps({"block": 0, "start": 0, "duration": 0, "made": 0})})[0], 411)
        self.assertEqual(self.call("GET", "/r/../etc")[0], 404)
        self.assertEqual(self.call("GET", f"/r/{REC}/not-a-uuid")[0], 404)
        self.assertEqual(self.call("POST", f"/r/{REC}/{A}/choose")[0], 404)  # no such take
        self.assertFalse(os.path.exists(os.path.join(self.dir.name, "etc")))

    def test_a_take_keeps_its_line_and_version(self):
        line = {"start": 2, "end": 5, "text": "Siobhan waves. “Hello”"}
        take = {"block": 0, "start": 2.1, "duration": 1.5, "peak": -10, "made": 1, "line": line, "ver": 2, "choose": True}
        # Sent as ASCII, as headers must be, with the rest escaped.
        header = json.dumps(take, ensure_ascii=True)
        self.assertEqual(self.call("PUT", f"/r/{REC}/{A}", WAV, {"X-Take": header})[0], 200)
        t = self.listing()[A]
        self.assertEqual((t["line"], t["ver"]), (line, 2))
        for bad in ({"line": {"start": 2}}, {"line": {"start": 2, "end": 5, "text": "x" * 6000}}, {"ver": -1}, {"ver": "2"}):
            self.assertEqual(self.call("PUT", f"/r/{REC}/{B}", WAV, {"X-Take": json.dumps({**take, **bad})})[0], 400, bad)

    def test_takes_are_matched_to_a_new_script(self):
        self.put(A, 0)
        self.put(B, 1)
        line = {"start": 9, "end": 13, "text": "B."}
        changes = [{"id": A, "block": 1, "start": 3.5, "line": line, "chosen": True},
                   {"id": B, "block": -1, "start": 2.5, "line": line, "chosen": True},
                   {"id": C, "block": 0, "start": 1, "line": line, "chosen": True}]  # not here: left alone
        self.assertEqual(self.call("POST", f"/r/{REC}/relink", json.dumps(changes).encode())[0], 200)
        got = self.listing()
        self.assertEqual((got[A]["block"], got[A]["start"], got[A]["line"], got[A]["chosen"]), (1, 3.5, line, True))
        self.assertEqual((got[B]["block"], got[B]["chosen"]), (-1, False), "a take with no block isn't chosen")
        self.assertNotIn(C, got)
        for bad in (b"{}", json.dumps([{"id": "x", "block": 0, "start": 0, "line": line, "chosen": True}]).encode(),
                    json.dumps([{"id": A, "block": -2, "start": 0, "line": line, "chosen": True}]).encode(),
                    json.dumps([{"id": A, "block": 0, "start": 0, "line": None, "chosen": True}]).encode()):
            self.assertEqual(self.call("POST", f"/r/{REC}/relink", bad)[0], 400, bad)

    def test_a_recordings_takes_move_to_its_project(self):
        self.put(A, 0)
        self.put(B, 1)
        to = "abcdefgh12345678-0"
        self.assertEqual(self.call("POST", f"/r/{REC}/move", json.dumps({"to": to}).encode()), (200, b'{"moved": 2}'))
        self.assertEqual(self.listing(), {})
        code, body = self.call("GET", f"/r/{to}")
        self.assertEqual(sorted(t["id"] for t in json.loads(body)), [A, B])
        self.assertEqual(self.call("GET", f"/r/{to}/{A}"), (200, WAV))
        self.assertEqual(json.loads(self.call("GET", "/status")[1])["takes"], 2)
        for bad in (b"", json.dumps({"to": "../x"}).encode(), json.dumps({"to": to}).encode()):
            self.assertEqual(self.call("POST", f"/r/{to}/move", bad if bad else b"{}")[0], 400, bad)


if __name__ == "__main__":
    unittest.main()
