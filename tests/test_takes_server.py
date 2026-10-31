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


if __name__ == "__main__":
    unittest.main()
