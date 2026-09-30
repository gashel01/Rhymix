"""Route-level tests for the YuE2 provider and the lyric-rewrite loop.

These cover the things that are easy to get wrong once two engines share one
endpoint: sending a YuE2 request through the ACE-Step normaliser, accepting a
parameter combination the engine will silently ignore, or offering to rewrite
lyrics for a song that never saved a score.

Like the other route tests, this spins up the real Flask app and stubs the
background thread - no GPU, no WanGP, no checkpoint.
"""

import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.factory import create_app
from backend.jobs.registry import song_generation_jobs


class _DummyThread:
    def __init__(self, target=None, args=None, kwargs=None, daemon=None):
        self.target = target
        self.args = args or ()
        self.kwargs = kwargs or {}
        self.daemon = daemon

    def start(self):
        return None


LYRICS = "[Verse]\nI left the window open half the night"


class Yue2RoutesTestCase(unittest.TestCase):
    """Base case that keeps its jobs out of the real library.

    Starting a job writes a manifest to data/generated_songs/jobs, and the list
    endpoint rewrites one per in-memory job on every poll. Left alone, a test
    run buries the user's actual songs under dozens of stubs frozen at
    "queued" - which then show up in the UI as a job that never finishes.
    """

    def setUp(self):
        self.app = create_app()
        self.app.config.update(TESTING=True)
        self.client = self.app.test_client()
        song_generation_jobs.clear()

        self._jobs_dir = Path(tempfile.mkdtemp(prefix="rhymix-test-jobs-"))
        self._patches = [
            patch("backend.features.song_generation.routes.SONG_GENERATION_JOBS_DIR", self._jobs_dir),
        ]
        for p in self._patches:
            p.start()

    def tearDown(self):
        for p in self._patches:
            p.stop()
        shutil.rmtree(self._jobs_dir, ignore_errors=True)
        song_generation_jobs.clear()

    def _start(self, **overrides):
        payload = {
            "title": "Test Song",
            "provider": "yue2",
            "lyrics": LYRICS,
            "style": "indie pop, 92 BPM",
        }
        payload.update(overrides)
        with patch("backend.features.song_generation.routes.threading.Thread", _DummyThread):
            return self.client.post("/api/song-generation", json=payload)


class TestProviderListing(Yue2RoutesTestCase):
    def test_yue2_is_the_only_engine(self):
        # ACE-Step was removed outright rather than kept as a fallback.
        data = self.client.get("/api/song-generation/providers").get_json()
        self.assertEqual(data["providers"], ["yue2"])
        self.assertEqual(data["default"], "yue2")

    def test_the_licence_is_advertised(self):
        # Generating with YuE2 commits the output to a non-commercial licence,
        # so the API says so rather than leaving it to documentation.
        data = self.client.get("/api/song-generation/providers").get_json()
        self.assertIn("NC", data["licenses"]["yue2"])


class TestStartingAYue2Job(Yue2RoutesTestCase):
    def test_a_valid_request_is_accepted(self):
        resp = self._start()
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["provider"], "yue2")

    def test_the_job_records_its_provider(self):
        job_id = self._start().get_json()["job_id"]
        self.assertEqual(song_generation_jobs[job_id]["provider"], "yue2")

    def test_yue2_params_survive_untouched(self):
        # The ACE-Step normaliser would not keep these keys; routing a YuE2
        # request through it is the regression this guards.
        job_id = self._start(model_mode=1, save_score=True).get_json()["job_id"]
        params = song_generation_jobs[job_id]["params"]
        self.assertEqual(params["model_mode"], 1)
        self.assertTrue(params["save_score"])
        self.assertEqual(params["lyrics"], LYRICS)

    def test_title_is_still_required(self):
        self.assertEqual(self._start(title="  ").status_code, 400)

    def test_lyrics_are_required(self):
        self.assertEqual(self._start(lyrics="").status_code, 400)

    def test_direct_generation_with_save_score_is_rejected(self):
        resp = self._start(model_mode=2, save_score=True)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Save Score", resp.get_json()["error"])

    def test_warnings_come_back_to_the_caller(self):
        # A '#' line would be dropped inside WanGP without a word otherwise.
        resp = self._start(lyrics="#hook\n" + LYRICS)
        self.assertTrue(any("#hook" in n for n in resp.get_json()["notices"]))

    def test_a_missing_file_is_reported_before_queueing(self):
        resp = self._start(custom_guide="does-not-exist.abc")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("not found", resp.get_json()["error"].lower())


class TestLyricRewrite(Yue2RoutesTestCase):
    def test_unknown_job_is_a_404(self):
        resp = self.client.post("/api/song-generation/nope/rewrite-lyrics", json={"lyrics": "x"})
        self.assertEqual(resp.status_code, 404)

    def test_a_song_without_a_saved_score_cannot_be_rewritten(self):
        # Without the ABC there is nothing pinning the music, so rewriting
        # would just be a fresh roll of the dice wearing the wrong label.
        job_id = self._start().get_json()["job_id"]
        resp = self.client.post(f"/api/song-generation/{job_id}/rewrite-lyrics", json={"lyrics": "new"})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Save Score", resp.get_json()["error"])

    def test_score_endpoint_404s_when_nothing_was_saved(self):
        job_id = self._start().get_json()["job_id"]
        resp = self.client.get(f"/api/song-generation/{job_id}/score/abc")
        self.assertEqual(resp.status_code, 404)

    def test_unknown_score_kind_is_rejected(self):
        job_id = self._start().get_json()["job_id"]
        resp = self.client.get(f"/api/song-generation/{job_id}/score/xml")
        self.assertEqual(resp.status_code, 400)


if __name__ == "__main__":
    unittest.main()
