import os
import shutil
import time
from pathlib import Path

from flask import Blueprint, jsonify, request

from clean_vocals import clean_directories
from backend.jobs.registry import active_jobs
from backend.paths.manager import paths

bp = Blueprint("maintenance", __name__)


def clean_directory(d, force=False, show_empty=True):
    if not d.exists():
        d.mkdir(parents=True, exist_ok=True)
        return show_empty and print(f"  ✅ {d.name} already empty")
    try:
        items = list(d.glob("*"))
        if not items:
            return show_empty and print(f"  ✅ {d.name} already empty")
        n = 0
        for p in items:
            try:
                (time.sleep(0.1), p.unlink(missing_ok=True)) if p.is_file() else shutil.rmtree(p, ignore_errors=True)
                n += 1
            except Exception:
                if force and os.name == "nt":
                    try:
                        os.system(f'del /F /Q "{p}"') if p.is_file() else shutil.rmtree(p, ignore_errors=True)
                        n += 1
                    except Exception:
                        pass
        print(f"  ✅ {d.name} cleaned ({n} items removed)")
    except Exception as e:
        print(f"  ❌ Error cleaning {d}: {e}")


def clean_diarization_directories(include_input=False, force=False):
    for d in [paths.TALKING_RESULTS_DIR, paths.TALKING_TEMP_DIR] + (
        [paths.TALKING_UPLOADS_DIR] if include_input else []
    ):
        print(f"Cleaning diarization directory: {d}")
        clean_directory(d, force=force)


@bp.route("/api/clean", methods=["POST"])
def clean_all():
    d = request.json or {}
    include_input, force = d.get("include_input", True), d.get("force", True)

    print("\n" + "=" * 48 + "\n           CLEANING ALL DIRECTORIES\n" + "=" * 48)
    print("\n--- Cleaning Singing/Vocal Directories ---")
    clean_directories(include_input=include_input, force=force)

    print("\n--- Cleaning Job Directories ---")
    if paths.SINGING_JOBS_DIR.exists():
        print(f"Cleaning job directory: {paths.SINGING_JOBS_DIR}")
        clean_directory(paths.SINGING_JOBS_DIR, force=force)

    print("\n--- Cleaning Diarization/Talking Directories ---")
    clean_diarization_directories(include_input=include_input, force=force)

    if include_input:
        print("\n--- Cleaning Original Audio Directory ---")
        clean_directory(paths.ORIGINAL_AUDIO_DIR, force=force)

    print("\n--- Cleaning Additional Temp Directories ---")
    for p, label in [
        (Path("diarization/pyannote-diarization/temp_segments"), "diarization temp segments"),
        (Path("temp"), "general temp directory"),
    ]:
        if p.exists():
            print(f"Cleaning {label}: {p}")
            clean_directory(p, force=force)

    print("\n" + "=" * 48 + "\n     ALL DIRECTORIES CLEANED SUCCESSFULLY\n" + "=" * 48 + "\n")
    return jsonify(
        {
            "message": "All directories cleaned successfully",
            "included_input": include_input,
            "cleaned": {
                "singing_vocals": True,
                "job_directories": True,
                "diarization": True,
                "original_audio": include_input,
                "temp_files": True,
            },
        }
    )


@bp.route("/api/prepare-processing", methods=["POST"])
def prepare_processing():
    try:
        time.sleep(2.0)
        clean_directories(include_input=False, force=True)
        return jsonify({"status": "ready"})
    except Exception as e:
        print(f"Error preparing for processing: {e}")
        return jsonify({"error": str(e)}), 500


@bp.route("/api/job/<job_id>")
def get_job_status(job_id):
    return (jsonify(active_jobs[job_id]), 200) if job_id in active_jobs else (
        jsonify({"error": "Job not found"}),
        404,
    )
