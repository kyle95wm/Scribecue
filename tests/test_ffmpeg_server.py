# The ffmpeg container's server (ffmpeg/server.py): the commands it gives ffmpeg, checked
# without ffmpeg, which only the container has. Run by scripts/check.sh.
import os
import sys
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
