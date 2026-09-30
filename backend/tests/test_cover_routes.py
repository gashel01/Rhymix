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


class CoverRoutesTestCase(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.app.config.update(TESTING=True)
        self.client = self.app.test_client()
        song_generation_jobs.clear()

        # Starting a cover writes a manifest into the real song library, and the
        # list endpoint rewrites one per in-memory job on every poll. Without
        # this redirect a test run leaves dozens of stub jobs stuck at "queued"
        # sitting in the user's library.
        self._jobs_dir = Path(tempfile.mkdtemp(prefix="rhymix-test-jobs-"))
        self._jobs_patch = patch(
            "backend.features.song_generation.routes.SONG_GENERATION_JOBS_DIR", self._jobs_dir
        )
        self._jobs_patch.start()

    def tearDown(self):
        self._jobs_patch.stop()
        shutil.rmtree(self._jobs_dir, ignore_errors=True)
        song_generation_jobs.clear()

    def test_cover_requires_source_song_id(self):
        resp = self.client.post(
            "/api/covers",
            json={
                "title": "My Cover",
                "target_voice": "voice-a",
            },
        )
        self.assertEqual(resp.status_code, 400)
        body = resp.get_json()
        self.assertIn("source_song_id", body.get("error", ""))

    @patch("backend.features.song_generation.routes.threading.Thread", _DummyThread)
    @patch("backend.features.song_generation.routes.resolve_cover_source")
    def test_cover_creates_derived_song_record(self, mock_resolve_cover_source):
        mock_resolve_cover_source.return_value = {
            "source_song_id": "upload:file-123",
            "title": "Source Song",
            "has_audio": True,
        }

        resp = self.client.post(
            "/api/covers",
            json={
                "title": "Source Song Cover",
                "source_song_id": "upload:file-123",
                "target_voice": "voice-a",
                "pitch_shift": 2,
                "style_prompt": "Bright pop mix",
                "preserve_tempo": True,
            },
        )

        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertIn("job_id", body)
        job_id = body["job_id"]
        self.assertIn(job_id, song_generation_jobs)

        job = song_generation_jobs[job_id]
        self.assertEqual(job.get("derivation_type"), "cover")
        self.assertEqual(job.get("source_song_id"), "upload:file-123")
        self.assertEqual(job.get("source_title"), "Source Song")
        self.assertEqual(job.get("title"), "Source Song Cover")
        self.assertEqual(job.get("params", {}).get("target_voice"), "voice-a")

    @patch("backend.features.song_generation.routes.threading.Thread", _DummyThread)
    @patch("backend.features.song_generation.routes.resolve_cover_source")
    def test_cover_allows_missing_target_voice(self, mock_resolve_cover_source):
        mock_resolve_cover_source.return_value = {
            "source_song_id": "upload:file-123",
            "title": "Source Song",
            "has_audio": True,
        }

        resp = self.client.post(
            "/api/covers",
            json={
                "title": "Source Song Cover",
                "source_song_id": "upload:file-123",
                "pitch_shift": 0,
                "preserve_tempo": True,
            },
        )

        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        job_id = body["job_id"]
        job = song_generation_jobs[job_id]
        self.assertIsNone(job.get("params", {}).get("target_voice"))


if __name__ == "__main__":
    unittest.main()
