import hashlib
import shutil
import threading
import uuid
from datetime import datetime
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file

from backend.features.song_generation.service import SONG_GENERATION_DIR, SONG_GENERATION_JOBS_DIR, run_song_generation_thread
from backend.features.song_generation.providers.ace_step import (
    ASSET_KEYS,
    continue_song_generation_full,
    _asset_path,
    _normalize_acestep15_params,
)
from backend.jobs.registry import song_generation_jobs

bp = Blueprint("song_generation", __name__)


@bp.route("/api/song-generation", methods=["POST"])
@bp.route("/api/song-generation/start", methods=["POST"])
def start_song_generation():
    """Start a new song generation job"""
    try:
        data = _normalize_acestep15_params(request.get_json() or {})

        # Validate required fields
        title = data.get("title", "").strip()
        if not title:
            return jsonify({"error": "Title is required"}), 400

        # Create job
        job_id = str(uuid.uuid4())
        job = {
            "id": job_id,
            "status": "queued",
            "progress": 0,
            "status_message": "Job queued...",
            "title": title,
            "params": data,
            "created_at": datetime.now().isoformat(),
            "audio_url": f"/api/song-generation/audio/{job_id}",
            "error": None,
        }

        song_generation_jobs[job_id] = job

        # Start generation in background thread
        threading.Thread(target=run_song_generation_thread, args=(job_id, data), daemon=True).start()

        return jsonify({"job_id": job_id})

    except Exception as e:
        print(f"Error starting song generation: {e}")
        return jsonify({"error": str(e)}), 500


@bp.route("/api/song-generation/<job_id>", methods=["GET"])
def get_song_generation(job_id):
    """Get status of a song generation job (new contract)"""
    if job_id not in song_generation_jobs:
        return jsonify({"error": "Job not found"}), 404

    job = song_generation_jobs[job_id]
    params = job.get("params") if isinstance(job.get("params"), dict) else {}
    params_out = (
        {
            "main_model_path": params.get("main_model_path"),
            "lm_model_path": params.get("lm_model_path"),
            "lm_backend": params.get("lm_backend"),
            "device": params.get("device"),
        }
        if isinstance(params, dict)
        else None
    )
    assets = job.get("assets")
    if isinstance(assets, dict):
        # Ensure ready assets include URL
        for key, asset in list(assets.items()):
            if not isinstance(asset, dict):
                continue
            if asset.get("ready") and not asset.get("url"):
                asset["url"] = f"/api/song-generation/{job_id}/audio/{key}"
                assets[key] = asset

    return jsonify(
        {
            "id": job.get("id"),
            "status": job.get("status"),
            "stage": job.get("stage"),
            "progress": job.get("progress", 0),
            "status_message": job.get("status_message", ""),
            "title": job.get("title", ""),
            "audio_url": job.get("audio_url"),
            "vocals_url": job.get("vocals_url"),
            "instrumental_url": job.get("instrumental_url"),
            "processed": job.get("processed", False),
            "inference_completed": job.get("inference_completed", False),
            "model_name": params.get("model_name"),
            "main_model_path": params.get("main_model_path"),
            "lm_model_path": params.get("lm_model_path"),
            "lm_backend": params.get("lm_backend"),
            "device": params.get("device"),
            "params": params_out,
            "created_at": job.get("created_at"),
            "completed_at": job.get("completed_at"),
            "error": job.get("error"),
            "assets": assets,
            "timings": job.get("timings"),
        }
    )


@bp.route("/api/song-generation/status/<job_id>", methods=["GET"])
def get_song_generation_status(job_id):
    """Legacy status endpoint"""
    return get_song_generation(job_id)


@bp.route("/api/song-generation/<job_id>/full", methods=["POST"])
def trigger_full_generation(job_id):
    if job_id not in song_generation_jobs:
        return jsonify({"error": "Job not found"}), 404

    job = song_generation_jobs[job_id]
    assets = job.get("assets") or {}
    preview = assets.get("preview_mix") if isinstance(assets, dict) else None
    if not (preview and preview.get("ready")):
        return jsonify({"error": "Preview not ready"}), 400

    threading.Thread(target=continue_song_generation_full, args=(job_id,), daemon=True).start()
    return jsonify({"ok": True})


@bp.route("/api/song-generation/jobs", methods=["GET"])
def list_song_generation_jobs():
    """List all song generation jobs"""
    jobs = []
    for job_id, job in song_generation_jobs.items():
        jobs.append(
            {
                "id": job["id"],
                "status": job["status"],
                "progress": job["progress"],
                "title": job.get("title", ""),
                "audio_url": job.get("audio_url"),
                "vocals_url": job.get("vocals_url"),
                "instrumental_url": job.get("instrumental_url"),
                "processed": job.get("processed", False),
                "inference_completed": job.get("inference_completed", False),
                "model_name": job.get("params", {}).get("model_name"),
                "assets": job.get("assets"),
                "created_at": job.get("created_at"),
                "completed_at": job.get("completed_at"),
            }
        )

    # Also scan for existing generated songs on disk
    try:
        for wav_file in SONG_GENERATION_DIR.glob("*.wav"):
            # Check if already in active jobs
            filename = wav_file.name
            existing = any(j.get("output_filename") == filename for j in song_generation_jobs.values())
            if not existing:
                stat = wav_file.stat()
                jobs.append(
                    {
                        "id": f"file_{hashlib.md5(filename.encode()).hexdigest()[:8]}",
                        "status": "completed",
                        "progress": 100,
                        "title": filename.rsplit("_", 1)[0].replace("_", " "),
                        "audio_url": f"/api/song-generation/file/{filename}",
                        "output_filename": filename,
                        "created_at": datetime.fromtimestamp(stat.st_ctime).isoformat(),
                        "completed_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    }
                )
    except Exception as e:
        print(f"Error scanning generated songs: {e}")

    # Sort by created_at descending
    jobs.sort(key=lambda x: x.get("created_at", ""), reverse=True)

    return jsonify({"jobs": jobs})


@bp.route("/api/song-generation/<job_id>/audio/<asset_key>", methods=["GET"])
def get_song_generation_asset(job_id, asset_key):
    if job_id not in song_generation_jobs:
        return jsonify({"error": "Job not found"}), 404
    if asset_key not in ASSET_KEYS:
        return jsonify({"error": "Invalid asset key"}), 400
    p = _asset_path(job_id, asset_key)
    if not p.exists():
        return jsonify({"error": "Audio not ready"}), 404
    return send_file(p, mimetype="audio/wav", as_attachment=False)


@bp.route("/api/song-generation/audio/<job_id>", methods=["GET"])
def get_song_generation_audio(job_id):
    """Legacy best-available mix"""
    if job_id not in song_generation_jobs:
        return jsonify({"error": "Job not found"}), 404
    for key in ["final_mix_rvc", "full_mix", "preview_mix"]:
        p = _asset_path(job_id, key)
        if p.exists():
            return send_file(p, mimetype="audio/wav", as_attachment=False)
    legacy_path = song_generation_jobs[job_id].get("output_file")
    if legacy_path:
        p = Path(legacy_path)
        if p.exists():
            return send_file(p, mimetype="audio/wav", as_attachment=False)
    return jsonify({"error": "Audio not ready"}), 404


@bp.route("/api/song-generation/file/<filename>", methods=["GET"])
def get_song_generation_file(filename):
    """Stream audio file by filename"""
    file_path = SONG_GENERATION_DIR / filename
    if not file_path.exists():
        return jsonify({"error": "File not found"}), 404

    return send_file(file_path, mimetype="audio/wav")


@bp.route("/api/song-generation/delete/<job_id>", methods=["DELETE"])
def delete_song_generation(job_id):
    """Delete a generated song"""
    try:
        # Check if it's an active job
        if job_id in song_generation_jobs:
            job = song_generation_jobs[job_id]
            job_dir = SONG_GENERATION_JOBS_DIR / job_id
            if job_dir.exists():
                shutil.rmtree(job_dir, ignore_errors=True)
            del song_generation_jobs[job_id]
            return jsonify({"message": "Deleted successfully"})

        # Check if it's a file-based job (starts with "file_")
        if job_id.startswith("file_"):
            # Find the file
            for wav_file in SONG_GENERATION_DIR.glob("*.wav"):
                file_id = f"file_{hashlib.md5(wav_file.name.encode()).hexdigest()[:8]}"
                if file_id == job_id:
                    wav_file.unlink()
                    return jsonify({"message": "Deleted successfully"})

        return jsonify({"error": "Job not found"}), 404

    except Exception as e:
        return jsonify({"error": str(e)}), 500
