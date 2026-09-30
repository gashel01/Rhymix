import os
import shutil
import time
from pathlib import Path

from flask import Blueprint, jsonify, request

from backend.jobs.registry import active_jobs
from backend.paths.manager import paths
import logging

bp = Blueprint("maintenance", __name__)


def clean_directories(*args, **kwargs):
    """Imported where it is used, like ace_step and applio.core below.

    clean_vocals pulls in the separation stack, so importing it at module
    level made every blueprint — and therefore create_app() — depend on it.
    That is why the Flask route tests could not run anywhere the models are
    not installed, CI included.
    """
    from clean_vocals import clean_directories as _clean_directories

    return _clean_directories(*args, **kwargs)


def _coerce_bool(value, default: bool = True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}
    return bool(value)


def _resolve_rvc_model_path(payload: dict):
    model_path = payload.get("modelPath") or payload.get("model_path")
    model_name = payload.get("modelName") or payload.get("model_name")

    def _find_pth(root: Path) -> Path | None:
        if not root.exists():
            return None
        candidates = [p for p in root.rglob("*.pth") if p.is_file()]
        if not candidates:
            return None
        return max(candidates, key=lambda p: p.stat().st_mtime)

    if model_path:
        p = Path(model_path)
        if not p.is_absolute():
            p = paths.APPLIO_MODELS_DIR / model_path
        if p.is_dir():
            return _find_pth(p)
        if p.is_file():
            return p

    if model_name:
        p = paths.APPLIO_MODELS_DIR / model_name
        if p.exists():
            return _find_pth(p)

    return _find_pth(paths.APPLIO_MODELS_DIR)


def warmup_models(payload: dict | None = None) -> dict:
    data = payload or {}
    results = {"started_at": time.time(), "details": {}}

    # Accepts "yue2", and still "acestep" so older clients and scripts keep
    # working after ACE-Step was removed - the key now warms YuE2 instead.
    songgen_requested = data.get("yue2", data.get("acestep", True))
    if _coerce_bool(songgen_requested, True):
        params = songgen_requested if isinstance(songgen_requested, dict) else {}
        try:
            from backend.features.song_generation.providers.yue2 import warmup_yue2

            results["details"]["yue2"] = warmup_yue2(params)
        except Exception as exc:
            results["details"]["yue2"] = {"status": "error", "error": str(exc)}
    else:
        results["details"]["yue2"] = {"status": "skipped"}

    if _coerce_bool(data.get("rvc", True), True):
        params = data.get("rvc") if isinstance(data.get("rvc"), dict) else {}
        try:
            from applio.core import import_voice_converter

            model_path = _resolve_rvc_model_path(params)
            if not model_path:
                results["details"]["rvc"] = {"status": "skipped", "reason": "no_model_found"}
            else:
                vc = import_voice_converter()
                vc.get_vc(str(model_path), sid=0)
                embedder = params.get("embedderModel") or params.get("embedder_model") or "contentvec"
                embedder_custom = params.get("embedderModelCustom") or params.get("embedder_model_custom")
                vc.load_hubert(embedder, embedder_custom)
                results["details"]["rvc"] = {"status": "ok", "model_path": str(model_path)}
        except Exception as exc:
            results["details"]["rvc"] = {"status": "error", "error": str(exc)}
    else:
        results["details"]["rvc"] = {"status": "skipped"}

    results["completed_at"] = time.time()
    results["duration_sec"] = round(results["completed_at"] - results["started_at"], 2)
    return results


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
        logging.info(f"  ✅ {d.name} cleaned ({n} items removed)")
    except Exception as e:
        logging.info(f"  ❌ Error cleaning {d}: {e}")


def clean_diarization_directories(include_input=False, force=False):
    for d in [paths.TALKING_RESULTS_DIR, paths.TALKING_TEMP_DIR] + (
        [paths.TALKING_UPLOADS_DIR] if include_input else []
    ):
        logging.info(f"Cleaning diarization directory: {d}")
        clean_directory(d, force=force)


@bp.route("/api/clean", methods=["POST"])
def clean_all():
    d = request.json or {}
    include_input, force = d.get("include_input", True), d.get("force", True)

    logging.info("\n" + "=" * 48 + "\n           CLEANING ALL DIRECTORIES\n" + "=" * 48)
    logging.info("\n--- Cleaning Singing/Vocal Directories ---")
    clean_directories(include_input=include_input, force=force)

    logging.info("\n--- Cleaning Job Directories ---")
    if paths.SINGING_JOBS_DIR.exists():
        logging.info(f"Cleaning job directory: {paths.SINGING_JOBS_DIR}")
        clean_directory(paths.SINGING_JOBS_DIR, force=force)

    logging.info("\n--- Cleaning Diarization/Talking Directories ---")
    clean_diarization_directories(include_input=include_input, force=force)

    if include_input:
        logging.info("\n--- Cleaning Original Audio Directory ---")
        clean_directory(paths.ORIGINAL_AUDIO_DIR, force=force)

    logging.info("\n--- Cleaning Additional Temp Directories ---")
    for p, label in [
        (Path("diarization/pyannote-diarization/temp_segments"), "diarization temp segments"),
        (Path("temp"), "general temp directory"),
    ]:
        if p.exists():
            logging.info(f"Cleaning {label}: {p}")
            clean_directory(p, force=force)

    logging.info("\n" + "=" * 48 + "\n     ALL DIRECTORIES CLEANED SUCCESSFULLY\n" + "=" * 48 + "\n")
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
        logging.error(f"Error preparing for processing: {e}")
        return jsonify({"error": str(e)}), 500


@bp.route("/api/job/<job_id>")
def get_job_status(job_id):
    return (jsonify(active_jobs[job_id]), 200) if job_id in active_jobs else (
        jsonify({"error": "Job not found"}),
        404,
    )


@bp.route("/api/warmup", methods=["POST", "GET"])
def warmup():
    data = request.get_json(silent=True) or {}
    return jsonify(warmup_models(data))
