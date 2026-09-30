"""YuE2 song-generation provider, driven through WanGP.

YuE2 is not vendored.  WanGP ships a supported in-process API (`shared/api.py`)
that keeps the model resident between requests, so Rhymix talks to a persistent
worker running in WanGP's virtualenv instead of carrying a copy of the model
code, mmgp, nanovllm and SheetSage2 forever.

What this buys over ACE-Step, and the reason the provider exists at all:

* `save_score` returns the composition as ABC + MIDI, so a generated song can be
  reopened and edited rather than re-rolled.
* Feeding that score back through `custom_guide` keeps the music while the
  lyrics change - the loop ACE-Step cannot do.
* A hummed melody can become a full song (`yue2_hum`).

Licensing, which the UI must repeat: YuE2 weights are CC BY-NC 4.0
(non-commercial), and WanGP's terms require disclosing that Rhymix uses it.

All parameter rules live in `backend.app.yue2_params` and are tested without a
GPU.  This module only performs.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
from datetime import datetime
from pathlib import Path

from backend.app import yue2_params
from backend.jobs.registry import song_generation_jobs
from backend.paths.manager import paths
from backend.storage.metadata import unregister_upload_metadata

from backend.features.song_generation.jobs_common import (
    SONG_GENERATION_JOBS_DIR,
    _apply_progress_from_line,
    _asset_path,
    _coerce_bool,
    _init_assets,
    _run_rvc,
    _run_separation,
    _set_asset_ready,
    _set_progress,
    _set_status,
)

WANGP_DIR = Path(os.environ.get("WANGP_DIR") or (paths.BASE_DIR.parent / "WanGP"))
WANGP_VENV_PATH = WANGP_DIR / ".venv"
WANGP_FALLBACK_VENV_PATH = WANGP_DIR / "venv"

WORKER_SCRIPT = Path(__file__).with_name("yue2_worker.py")

# Defaults measured on an RTX 3070 Ti Laptop (8 GB):
#   - lm_decoder_engine=vllm enables Triton decoder kernels + FlashAttention 2
#     on both autoregressive stages, roughly halving generation time.
#   - audio profile 3 keeps more weights resident instead of offloading.
WANGP_AUDIO_PROFILE = os.environ.get("WANGP_AUDIO_PROFILE", "3")
WANGP_ATTENTION = os.environ.get("WANGP_ATTENTION", "sdpa")

USE_PERSISTENT_WORKER = str(os.environ.get("YUE2_PERSISTENT", "1")).strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}

# Loading the checkpoints is slow; a job that waits longer than this is stuck.
WORKER_READY_TIMEOUT_SEC = 900

_PERSISTENT_WORKER = None
_PERSISTENT_WORKER_LOCK = threading.Lock()


def get_wangp_python() -> str:
    """Resolve WanGP's interpreter, tolerating either venv layout."""
    if sys.platform == "win32":
        candidates = [
            WANGP_VENV_PATH / "Scripts" / "python.exe",
            WANGP_FALLBACK_VENV_PATH / "Scripts" / "python.exe",
        ]
    else:
        candidates = [
            WANGP_VENV_PATH / "bin" / "python",
            WANGP_FALLBACK_VENV_PATH / "bin" / "python",
        ]
    override = os.environ.get("WANGP_PYTHON")
    if override:
        candidates.insert(0, Path(override))
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    raise RuntimeError(
        f"WanGP virtualenv not found under {WANGP_DIR}. "
        "Set WANGP_DIR / WANGP_PYTHON in .env, or run setup.bat."
    )


class Yue2PersistentWorker:
    """Keeps one WanGP session alive so checkpoints load once, not per job."""

    def __init__(self):
        self.process = None
        self.lock = threading.Lock()

    def _build_env(self) -> dict:
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env["WANGP_DIR"] = str(WANGP_DIR)
        env["WANGP_AUDIO_PROFILE"] = str(WANGP_AUDIO_PROFILE)
        env["WANGP_ATTENTION"] = str(WANGP_ATTENTION)
        return env

    def _start_process(self):
        if self.process and self.process.poll() is None:
            return
        if not WORKER_SCRIPT.exists():
            raise RuntimeError(f"YuE2 worker script missing at {WORKER_SCRIPT}")

        self.process = subprocess.Popen(
            [get_wangp_python(), "-u", str(WORKER_SCRIPT)],
            cwd=str(WANGP_DIR),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env=self._build_env(),
            text=True,
            # Without this, `text=True` decodes/encodes the pipe with
            # Windows' default ANSI codepage (cp1252), which cannot hold
            # most lyrics that aren't plain ASCII — a pasted smart quote or
            # stray bidi mark is enough to crash the stdin.write() below.
            encoding="utf-8",
            bufsize=1,
        )

        while True:
            line = self.process.stdout.readline()
            if not line:
                if self.process.poll() is not None:
                    raise RuntimeError("YuE2 worker exited before becoming ready")
                continue
            line = line.rstrip("\n\r")
            print(f"[YuE2] {line}", flush=True)
            if line.startswith("WORKER_READY"):
                return
            if line.startswith("WARMUP_ERROR"):
                raise RuntimeError(line.split(":", 1)[-1] or "YuE2 worker failed to start")

    def _ensure_process(self):
        if self.process and self.process.poll() is None:
            return
        self._start_process()

    def run_job(self, job: dict, job_id: str, settings: dict, output_path: Path, score_dir: Path | None) -> dict:
        with self.lock:
            self._ensure_process()
            if not self.process or self.process.poll() is not None:
                raise RuntimeError("YuE2 worker not available")

            payload = {
                "job_id": job_id,
                "settings": settings,
                "output_path": str(output_path),
                "score_dir": str(score_dir) if score_dir else None,
            }
            self.process.stdin.write(json.dumps(payload) + "\n")
            self.process.stdin.flush()

            job["subprocess_pid"] = self.process.pid
            artefacts: dict = {}
            errors: list[str] = []
            success = False

            while True:
                line = self.process.stdout.readline()
                if not line:
                    if self.process.poll() is not None:
                        break
                    continue
                line = line.rstrip("\n\r")
                print(f"[YuE2] {line}", flush=True)

                if line.startswith("JOB_END:"):
                    parts = line.split(":", 3)
                    if len(parts) >= 3 and parts[1] == job_id:
                        if parts[2] == "SUCCESS":
                            success = True
                        elif len(parts) >= 4 and parts[3]:
                            errors.append(parts[3])
                        break
                    continue

                if line.startswith("RESULT:"):
                    try:
                        artefacts = json.loads(line[len("RESULT:"):])
                    except json.JSONDecodeError:
                        pass
                    continue

                if _apply_progress_from_line(job, line):
                    continue

                if line.startswith("ERROR:"):
                    errors.append(line[len("ERROR:"):])

            if not success:
                if self.process and self.process.poll() is not None:
                    raise RuntimeError("YuE2 worker exited unexpectedly")
                raise RuntimeError("\n".join(errors) if errors else "YuE2 generation failed")

            # Warnings collected on the way through are worth keeping even on
            # success - truncation is reported this way.
            if errors:
                job["warnings"] = list(dict.fromkeys(errors))
            return artefacts


    def warmup(self) -> None:
        """Start the worker and load the checkpoints without generating."""
        with self.lock:
            self._ensure_process()
            if not self.process or self.process.poll() is not None:
                raise RuntimeError("YuE2 worker not available")
            self.process.stdin.write(json.dumps({"warmup": True}) + "\n")
            self.process.stdin.flush()
            while True:
                line = self.process.stdout.readline()
                if not line:
                    if self.process.poll() is not None:
                        raise RuntimeError("YuE2 worker exited during warmup")
                    continue
                line = line.rstrip("\n\r")
                print(f"[YuE2] {line}", flush=True)
                if line.startswith("WARMUP_OK"):
                    return
                if line.startswith("WARMUP_ERROR"):
                    raise RuntimeError(line.split(":", 1)[-1] or "YuE2 warmup failed")


def _get_persistent_worker() -> Yue2PersistentWorker:
    global _PERSISTENT_WORKER
    with _PERSISTENT_WORKER_LOCK:
        if _PERSISTENT_WORKER is None:
            _PERSISTENT_WORKER = Yue2PersistentWorker()
        return _PERSISTENT_WORKER


def warmup_yue2(params: dict | None = None) -> dict:
    """Load YuE2 ahead of the first request. Called by /api/maintenance/warmup."""
    try:
        _get_persistent_worker().warmup()
        return {"status": "ok", "engine": "yue2", "wangp_dir": str(WANGP_DIR)}
    except Exception as exc:
        return {"status": "error", "error": str(exc)}


def _score_dir(job_id: str) -> Path:
    return SONG_GENERATION_JOBS_DIR / job_id


def run_yue2_into(job: dict, job_id: str, params: dict, output_path: Path, score_dir: Path | None = None) -> dict:
    """Render one YuE2 generation into `output_path`.

    The single-shot entry point for callers that own their own job lifecycle -
    the cover pipeline, mainly. Raises on failure; returns the artefact paths.
    """
    errors = yue2_params.validate(params)
    if errors:
        raise ValueError(" ".join(errors))
    settings = yue2_params.build_settings(params)
    return _get_persistent_worker().run_job(job, job_id, settings, output_path, score_dir)


def run_yue2_generation_thread(job_id, params):
    """Generate a song with YuE2, then optionally separate and re-sing it."""
    job = song_generation_jobs[job_id]

    try:
        errors = yue2_params.validate(params)
        if errors:
            raise ValueError(" ".join(errors))

        settings = yue2_params.build_settings(params)
        summary = yue2_params.describe(params)
        notes = yue2_params.warnings(params)

        job.setdefault("id", job_id)
        job["params"] = dict(params or {})
        job["provider"] = "yue2"
        job["yue2"] = summary
        if notes:
            job["notices"] = notes
        job.setdefault("assets", _init_assets())
        job.setdefault("timings", {})
        job.setdefault("created_at", datetime.now().isoformat())
        job["audio_url"] = f"/api/song-generation/audio/{job_id}"
        # Surfaced in the UI next to any YuE2 output.
        job["license"] = "YuE2 weights are CC BY-NC 4.0 (non-commercial). Generated via WanGP."

        _set_status(job, "queued", "Job queued...")
        _set_progress(job, 0)

        _set_status(job, "full_generating", "Generating full song...")
        _set_progress(job, 10)

        full_path = _asset_path(job_id, "full_mix")
        score_dir = _score_dir(job_id) if summary.get("saves_score") else None

        if USE_PERSISTENT_WORKER:
            artefacts = _get_persistent_worker().run_job(job, job_id, settings, full_path, score_dir)
        else:
            raise RuntimeError("YuE2 requires the persistent worker (set YUE2_PERSISTENT=1)")

        _set_asset_ready(job, job_id, "full_mix", full_path)
        _set_status(job, "full_ready", "Full song ready")
        _set_progress(job, 45)

        # The score is what makes a generated song editable later; expose it.
        score = {k: v for k, v in artefacts.items() if k in {"score_abc", "score_midi"}}
        if score:
            score["url_abc"] = f"/api/song-generation/{job_id}/score/abc"
            score["url_midi"] = f"/api/song-generation/{job_id}/score/midi"
            job["score"] = score

        if _coerce_bool((params or {}).get("separate_stems"), True):
            instrumental_only = _coerce_bool((params or {}).get("instrumental_only"), False)
            vocals_file, inst_file, file_id = _run_separation(
                job, job_id, full_path, discard_vocals=instrumental_only
            )
            if not instrumental_only and (params or {}).get("enhance_vocals", True) and file_id and vocals_file:
                _run_rvc(job, job_id, file_id, vocals_file, inst_file)
            # The temporary upload record _run_separation registered to push
            # the song through the same pipeline an import uses is only safe
            # to drop once _run_rvc is done reading it by that same file_id.
            if file_id:
                unregister_upload_metadata(file_id)

        # The cover runs on the CPU and never touches the GPU, so it costs the
        # song nothing and is fired without waiting for it. A failed drawing
        # must not turn a finished song into a failed one.
        try:
            from backend.features.cover_art.routes import render_cover_async

            render_cover_async(job_id)
        except Exception:
            print(f"[songgen] Could not start cover art for {job_id}", flush=True)

        _set_status(job, "completed", "Song generation complete")
        _set_progress(job, 100)
        job["completed_at"] = datetime.now().isoformat()

    except Exception as exc:
        import traceback

        job["status"] = "failed"
        job["error"] = str(exc)
        job["status_message"] = f"Generation failed: {exc}"
        print(f"YuE2 generation error for job {job_id}: {exc}")
        print(traceback.format_exc())


class Yue2Provider:
    name = "yue2"

    def run(self, job_id, params):
        return run_yue2_generation_thread(job_id, params)
