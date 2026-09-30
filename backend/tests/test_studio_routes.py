import unittest
from unittest.mock import patch

from backend.factory import create_app
from backend.features.studio.jobs import create_job, run_ai_job


class StudioRoutesTestCase(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.app.config.update(TESTING=True)
        self.client = self.app.test_client()

    def test_create_project(self):
        resp = self.client.post("/api/studio/projects", json={"assetId": "test-asset"})
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertIn("project", body)
        self.assertIn("id", body["project"])

    def test_create_project_default_template_is_standard_lanes(self):
        resp = self.client.post("/api/studio/projects", json={})
        body = resp.get_json()
        lane_names = [lane["name"] for lane in body["lanes"]]
        self.assertEqual(lane_names, ["Mix", "Vocals", "Instrumental", "Stems", "Generated Layers"])

    def test_create_project_with_template_id_builds_that_lane_set(self):
        resp = self.client.post("/api/studio/projects", json={"templateId": "beat_vocals"})
        body = resp.get_json()
        lane_names = [lane["name"] for lane in body["lanes"]]
        self.assertEqual(lane_names, ["Beat", "Melody MIDI", "Lead Vocals", "Ad-libs", "Generated Layers"])

    def test_create_project_with_unknown_template_id_falls_back_to_standard(self):
        resp = self.client.post("/api/studio/projects", json={"templateId": "not-a-real-template"})
        body = resp.get_json()
        lane_names = [lane["name"] for lane in body["lanes"]]
        self.assertEqual(lane_names, ["Mix", "Vocals", "Instrumental", "Stems", "Generated Layers"])

    def test_new_project_has_empty_scenes_and_clip_slots(self):
        resp = self.client.post("/api/studio/projects", json={})
        body = resp.get_json()
        self.assertEqual(body["scenes"], [])
        self.assertEqual(body["clipSlots"], [])

    def test_patch_project_persists_scenes_and_clip_slots(self):
        create_resp = self.client.post("/api/studio/projects", json={})
        project_id = create_resp.get_json()["project"]["id"]

        scenes = [{"id": "scene-1", "name": "Intro"}]
        clip_slots = [
            {
                "id": "slot-1",
                "sceneId": "scene-1",
                "laneId": "lane-1",
                "assetId": "asset-1",
                "srcStartSec": 0,
                "srcEndSec": 4,
                "clipType": "audio",
            }
        ]
        patch_resp = self.client.patch(
            f"/api/studio/projects/{project_id}",
            json={"scenes": scenes, "clipSlots": clip_slots},
        )
        self.assertEqual(patch_resp.status_code, 200)
        self.assertEqual(patch_resp.get_json()["scenes"], scenes)
        self.assertEqual(patch_resp.get_json()["clipSlots"], clip_slots)

        # Round-trips on a fresh GET too, not just echoed back from the PATCH response.
        get_resp = self.client.get(f"/api/studio/projects/{project_id}")
        self.assertEqual(get_resp.get_json()["scenes"], scenes)
        self.assertEqual(get_resp.get_json()["clipSlots"], clip_slots)

    def test_list_project_templates(self):
        resp = self.client.get("/api/studio/project-templates")
        self.assertEqual(resp.status_code, 200)
        templates = resp.get_json()
        ids = {t["id"] for t in templates}
        self.assertEqual(ids, {"standard", "beat_vocals", "multitrack_stems"})
        for template in templates:
            self.assertIn("label", template)
            self.assertIn("description", template)

    @patch("backend.features.studio.routes.start_job_thread", lambda *args, **kwargs: None)
    def test_start_job_and_sse(self):
        project_resp = self.client.post("/api/studio/projects", json={"assetId": "test-asset"})
        project_id = project_resp.get_json()["project"]["id"]

        job_resp = self.client.post(
            f"/api/studio/projects/{project_id}/jobs/understand",
            json={"sourceAssetId": "test-asset"},
        )
        self.assertEqual(job_resp.status_code, 200)
        job_id = job_resp.get_json()["jobId"]

        status_resp = self.client.get(f"/api/jobs/{job_id}")
        self.assertEqual(status_resp.status_code, 200)
        status_body = status_resp.get_json()
        self.assertEqual(status_body.get("status"), "queued")

        stream_resp = self.client.get(f"/api/jobs/{job_id}/events", buffered=False)
        self.assertEqual(stream_resp.status_code, 200)
        self.assertEqual(stream_resp.mimetype, "text/event-stream")

    @patch("backend.features.studio.jobs.extract_uvr_multi_stems")
    def test_stem_extract_lands_on_the_timeline(self, mock_extract):
        project_resp = self.client.post("/api/studio/projects", json={"assetId": "test-asset"})
        project_id = project_resp.get_json()["project"]["id"]

        mock_extract.return_value = [
            {
                "assetId": "uvr_stem:vocals",
                "assetPath": "/tmp/vocals.wav",
                "assetUrl": "/api/download/exports/vocals.wav",
                "durationSec": 12.0,
                "sampleRate": 44100,
                "trackName": "vocals",
                "label": "Vocals",
            }
        ]

        job = create_job("stem_extract_uvr", project_id, {"sourceAssetId": "test-asset"})
        run_ai_job(job["id"], project_id, "stem_extract_uvr", {"sourceAssetId": "test-asset"})

        project_body = self.client.get(f"/api/studio/projects/{project_id}").get_json()
        self.assertIn("uvr_stem:vocals", project_body["assets"])
        self.assertTrue(any(lane["name"] == "Vocals" for lane in project_body["lanes"]))

    def test_dead_job_types_are_refused(self):
        """The ACE-Step-backed job types were removed, not silently no-opped."""
        project_resp = self.client.post("/api/studio/projects", json={"assetId": "test-asset"})
        project_id = project_resp.get_json()["project"]["id"]

        job = create_job("understand", project_id, {})
        run_ai_job(job["id"], project_id, "understand", {})

        status = self.client.get(f"/api/jobs/{job['id']}").get_json()
        self.assertEqual(status["status"], "failed")
        self.assertIn("Unknown job type", status["error"])


if __name__ == "__main__":
    unittest.main()
