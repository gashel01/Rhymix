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

    @patch("backend.features.studio.jobs.get_ai_adapter")
    def test_understand_job_updates_project_fields(self, mock_get_ai_adapter):
        project_resp = self.client.post("/api/studio/projects", json={"assetId": "test-asset"})
        project_id = project_resp.get_json()["project"]["id"]

        adapter = mock_get_ai_adapter.return_value
        adapter.understand.return_value = {
            "bpm": 128.5,
            "key": "C minor",
            "timeSignature": "4/4",
            "caption": "synthetic test",
        }

        job = create_job("understand", project_id, {"sourceAssetId": "test-asset"})
        run_ai_job(job["id"], project_id, "understand", {"sourceAssetId": "test-asset"})

        project_body = self.client.get(f"/api/studio/projects/{project_id}").get_json()
        self.assertEqual(project_body["project"]["bpm"], 128.5)
        self.assertEqual(project_body["project"]["key"], "C minor")
        self.assertEqual(project_body["project"]["timeSignature"], "4/4")
        self.assertEqual(project_body["metadata"]["understand"]["caption"], "synthetic test")


if __name__ == "__main__":
    unittest.main()
