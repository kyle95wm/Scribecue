# The ffmpeg container's server (ffmpeg/server.py): the commands it gives ffmpeg, checked
# without ffmpeg, which only the container has. Run by scripts/check.sh.
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "ffmpeg"))
import server  # noqa: E402

ENG = [{"codec_type": "audio", "tags": {"language": "fre"}}, {"codec_type": "audio"}]


def command(codec, video=None, replace=False, audio=ENG, copy=None):
    job = {"dir": "/work/j", "codec": codec, "video": video, "replace": replace, "copy": copy}
    with mock.patch.object(server, "probe", return_value=(audio, 60.0)):
        return server.command(job)


def after(args, flag):
    return [args[i + 1] for i, a in enumerate(args) if a == flag]


class Commands(unittest.TestCase):
    def test_just_the_audio(self):
        for codec, codec_name, ext in [("aac", "aac", "m4a"), ("ac3", "ac3", "ac3"), ("eac3", "eac3", "eac3")]:
            args, secs = command(codec)
            self.assertEqual(args[:2], ["-i", "/work/j/mix.wav"])
            self.assertIn("-vn", args)
            self.assertEqual(after(args, "-c:a"), [codec_name])
            self.assertEqual(args[-1], f"/work/j/out.{ext}")
            self.assertEqual(secs, 60.0)

    def test_an_extra_track_goes_after_the_others_and_is_marked(self):
        args, _ = command("ac3", "mkv")
        self.assertEqual(after(args, "-i"), ["/work/j/video.mkv", "/work/j/mix.wav"])
        self.assertEqual(after(args, "-map"), ["0:v?", "0:a?", "1:a", "0:s?", "0:t?"])
        self.assertEqual(after(args, "-c"), ["copy"])  # the picture and the other tracks
        self.assertEqual(after(args, "-c:a:2"), ["ac3"])  # only the mix is encoded
        self.assertIn("language=fre", after(args, "-metadata:s:a:2"))
        self.assertIn("title=Audio description", after(args, "-metadata:s:a:2"))
        self.assertEqual(after(args, "-disposition:a:2"), ["visual_impaired+descriptions"])
        self.assertEqual(args[-1], "/work/j/out.mkv")

    def test_in_place_of_the_sound(self):
        args, _ = command("eac3", "mp4", replace=True)
        self.assertEqual(after(args, "-map"), ["0:v?", "1:a", "0:s?"])
        self.assertEqual(after(args, "-c:a:0"), ["eac3"])
        self.assertEqual(after(args, "-disposition:a:0"), ["default"])

    def test_webm_gets_opus_and_a_video_without_sound_a_first_track(self):
        args, _ = command("ac3", "webm", audio=[])
        self.assertEqual(after(args, "-c:a:0"), ["libopus"])
        self.assertIn("language=und", after(args, "-metadata:s:a:0"))

    def test_a_webm_copy_makes_the_picture_vp9_and_every_track_opus(self):
        args, secs = command(None, "mp4", copy="webm")
        self.assertEqual(after(args, "-i"), ["/work/j/video.mp4"])
        self.assertEqual(after(args, "-map"), ["0:v:0", "0:a?"])  # no subtitles: WebM can't hold most
        self.assertEqual(after(args, "-c:v"), ["libvpx-vp9"])
        self.assertEqual(after(args, "-deadline"), ["realtime"])
        self.assertEqual(after(args, "-vf"), [server.SCALE])
        self.assertEqual(after(args, "-c:a"), ["libopus"])
        self.assertEqual(after(args, "-ac"), ["2"])
        self.assertEqual(args[-1], "/work/j/out.webm")
        self.assertEqual(secs, 60.0)

    def test_an_mp4_copy_keeps_the_picture(self):
        args, _ = command(None, "mkv", copy="mp4")
        self.assertEqual(after(args, "-c:v"), ["copy"])
        self.assertNotIn("-vf", args)
        self.assertEqual(after(args, "-c:a"), ["libopus"])
        self.assertEqual(args[-1], "/work/j/out.mp4")

    def test_the_picture_is_at_most_720_lines_and_even(self):
        self.assertEqual(server.SCALE, "scale=-2:min(720\\,trunc(ih/2)*2)")

    def test_every_format_the_page_offers_is_known(self):
        self.assertEqual(server.COPIES, {"webm", "mp4"})
        self.assertEqual(set(server.CODECS), {"aac", "ac3", "eac3"})
        self.assertEqual(server.VIDEOS, {"mp4", "m4v", "mov", "mkv", "webm"})


if __name__ == "__main__":
    unittest.main()


class Forgetting(unittest.TestCase):
    def test_an_extended_video_holds_the_picture_and_uses_the_mix(self):
        with tempfile.TemporaryDirectory() as d:
            job = {"dir": d, "codec": "aac", "video": "mp4", "replace": False, "copy": None, "pauses": [[5, 2.5], [9.25, 1]]}
            with mock.patch.object(server, "probe", return_value=(ENG, 60.0)):
                args, secs = server.command(job)
            self.assertEqual(secs, 63.5)  # progress counts the pauses
            self.assertEqual(after(args, "-i"), [f"{d}/video.mp4", f"{d}/mix.wav"])
            self.assertEqual(after(args, "-map"), ["[v]", "1:a"])
            self.assertEqual(after(args, "-c:v"), ["libx264"])
            self.assertIn("-shortest", args)
            with open(after(args, "-filter_complex_script")[0]) as f:
                text = f.read()
            self.assertIn("(gte(T\\,5.000000)*2.500000+gte(T\\,9.250000)*1.000000)", text)
            self.assertIn("fps=fps=source_fps:start_time=0", text)

    def test_an_extended_webm_is_vp9_and_opus(self):
        with tempfile.TemporaryDirectory() as d:
            job = {"dir": d, "codec": "aac", "video": "webm", "replace": False, "copy": None, "pauses": [[5, 2.5]]}
            with mock.patch.object(server, "probe", return_value=(ENG, 60.0)):
                args, _ = server.command(job)
            self.assertEqual(after(args, "-c:v"), ["libvpx-vp9"])
            self.assertEqual(after(args, "-c:a"), ["libopus"])

    def test_a_long_list_of_pauses_stays_shallow(self):
        text = server.hold_filter([[k, 1] for k in range(4096)])
        depth = most = 0
        for ch in text[text.index("+(", 20):]:
            depth += ch == "("
            depth -= ch == ")"
            most = max(most, depth)
        self.assertLess(most, 20)

    def test_pauses_are_checked(self):
        self.assertTrue(server.good_pauses([[0, 1], [2.5, 3]]))
        for bad in ([], "1", [[1]], [[1, "2);drop"]], [[-1, 2]], [[1, float("nan")]], [[True, 1]], [[0, 1]] * (server.MAX_PAUSES + 1)):
            self.assertFalse(server.good_pauses(bad), bad)

    def test_a_job_the_page_stopped_asking_after_is_deleted(self):
        with tempfile.TemporaryDirectory() as work:
            for id in ("old", "new"):
                os.makedirs(os.path.join(work, id))
                server.jobs[id] = {"dir": os.path.join(work, id), "seen": 0 if id == "old" else 200}
            try:
                server.forget(now=server.STALE + 100)
                self.assertEqual(set(server.jobs), {"new"})
                self.assertEqual(os.listdir(work), ["new"])
            finally:
                server.jobs.clear()


class Burning(unittest.TestCase):
    def burn(self, burn, rate="25/1", track=0):
        job = {"dir": "/work/j", "codec": None, "video": "mkv", "replace": False, "copy": None, "burn": burn, "track": track}
        with mock.patch.object(server, "probe", return_value=(ENG, 60.0)), mock.patch.object(server, "frame_rate", return_value=rate):
            return server.command(job)

    def test_an_mp4_with_the_picture_encoded_and_the_chosen_track(self):
        args, secs = self.burn({"subs": True, "timecode": True, "size": "m", "height": 720}, track=1)
        self.assertEqual(after(args, "-i"), ["/work/j/video.mkv"])
        self.assertEqual(after(args, "-map"), ["0:v:0", "0:a:1?"])
        self.assertEqual(after(args, "-c:v"), ["libx264"])
        self.assertEqual(after(args, "-c:a"), ["aac"])
        self.assertEqual(args[-1], "/work/j/out.mp4")
        self.assertEqual(secs, 60.0)

    def test_smaller_first_then_the_timecode_then_the_script(self):
        vf = after(self.burn({"subs": True, "timecode": True, "height": 720})[0], "-vf")[0]
        order = [vf.index(k) for k in ("scale=", "drawtext=", "subtitles=", "format=yuv420p")]
        self.assertEqual(order, sorted(order))
        self.assertIn("filename=/work/j/subs.srt", vf)
        self.assertIn("FontSize=20", vf)
        self.assertIn("fontsize=h/24", vf)  # grows with the picture, as the script does

    def test_each_resolution_is_a_most(self):
        for h in (480, 720, 1080):
            vf = after(self.burn({"subs": True, "height": h})[0], "-vf")[0]
            self.assertTrue(vf.startswith(f"scale=-2:min({h}\\,trunc(ih/2)*2),"), vf)
        self.assertNotIn("scale=", after(self.burn({"subs": True, "height": 0})[0], "-vf")[0])

    def test_only_what_was_asked_for(self):
        vf = after(self.burn({"timecode": True})[0], "-vf")[0]
        self.assertNotIn("scale=", vf)
        self.assertNotIn("subtitles=", vf)
        vf = after(self.burn({"subs": True, "size": "l"})[0], "-vf")[0]
        self.assertNotIn("drawtext=", vf)
        self.assertIn("FontSize=25", vf)

    def test_the_script_looks_as_it_does_over_the_video(self):
        vf = after(self.burn({"subs": True, "bg": "none"})[0], "-vf")[0]
        self.assertIn("BorderStyle=1", vf)  # an outline and a shadow
        self.assertIn("Shadow=3", vf)
        self.assertIn("Alignment=2", vf)
        vf = after(self.burn({"subs": True, "bg": "light", "pos": "top"})[0], "-vf")[0]
        self.assertIn("BorderStyle=3", vf)  # a box behind each line
        self.assertIn("OutlineColour=&H8C000000&", vf)
        self.assertIn("Alignment=8", vf)
        vf = after(self.burn({"subs": True})[0], "-vf")[0]  # by default, as the burn-in script did
        for style in ("BorderStyle=1", "Outline=2", "Shadow=3", "BackColour=&H80000000&", "FontSize=20", "MarginV=50"):
            self.assertIn(style, vf)

    def test_drop_frame_timecode_at_29_97_and_59_94_only(self):
        for rate, sep in [("30000/1001", ";"), ("60000/1001", ";"), ("24000/1001", ":"), ("25/1", ":"), ("30/1", ":")]:
            vf = after(self.burn({"timecode": True}, rate)[0], "-vf")[0]
            self.assertIn(f"timecode='00\\:00\\:00\\{sep}00':rate={rate}", vf, rate)

    def test_burns_are_checked(self):
        self.assertTrue(server.good_burn({"subs": True}))
        self.assertTrue(server.good_burn({"timecode": True, "size": "xl", "bg": "solid", "pos": "top", "height": 0}))
        for h in (480, 720, 1080):
            self.assertTrue(server.good_burn({"subs": True, "height": h}))
        for bad in ({}, {"subs": False, "timecode": False}, {"subs": 1}, {"subs": True, "size": "huge"},
                    {"subs": True, "bg": "red"}, {"subs": True, "pos": "middle"},
                    {"subs": True, "font": "x"}, {"subs": True, "height": 600},
                    {"subs": True, "height": "720"}, {"subs": True, "small": True}, "subs", None):
            self.assertFalse(server.good_burn(bad), bad)
