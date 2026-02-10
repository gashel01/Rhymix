import hashlib
import logging
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
from backend.features.song_generation.cover import (
    get_cover_source_payload,
    resolve_cover_source,
    run_cover_generation_thread,
    transcribe_cover_source,
)
from backend.jobs.registry import song_generation_jobs

bp = Blueprint("song_generation", __name__)
logger = logging.getLogger(__name__)


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
            "derivation_type": "original",
            "error": None,
        }

        song_generation_jobs[job_id] = job

        # Start generation in background thread
        threading.Thread(target=run_song_generation_thread, args=(job_id, data), daemon=True).start()

        return jsonify({"job_id": job_id})

    except Exception as e:
        print(f"Error starting song generation: {e}")
        return jsonify({"error": str(e)}), 500


@bp.route("/api/covers", methods=["POST"])
def start_cover_generation():
    try:
        data = request.get_json() or {}
        source_song_id = str(data.get("source_song_id") or "").strip()
        title = str(data.get("title") or "").strip()
        target_voice = str(data.get("target_voice") or "").strip()
        logger.info(
            "[cover] POST /api/covers source_song_id=%s title=%s target_voice=%s pitch_shift=%s preserve_tempo=%s strong_audio=%s",
            source_song_id,
            title,
            target_voice,
            data.get("pitch_shift", 0),
            data.get("preserve_tempo", True),
            data.get("strong_audio_conditioning", False),
        )

        if not source_song_id:
            return jsonify({"error": "source_song_id is required"}), 400
        if not title:
            return jsonify({"error": "Title is required"}), 400

        source = resolve_cover_source(source_song_id)
        if not source:
            return jsonify({"error": "Source song not found"}), 404
        if not source.get("has_audio"):
            return jsonify({"error": "Source song has no audio"}), 400

        job_id = str(uuid.uuid4())
        params = {
            "source_song_id": source_song_id,
            "target_voice": target_voice or None,
            "pitch_shift": data.get("pitch_shift", 0),
            "style_prompt": data.get("style_prompt"),
            "lyrics": data.get("lyrics"),
            "cover_mode": data.get("cover_mode", "full"),
            "preserve_tempo": data.get("preserve_tempo", True),
            "audio_cover_strength": data.get("audio_cover_strength", 1.0),
            "strong_audio_conditioning": data.get("strong_audio_conditioning", False),
            "output_format": data.get("output_format", "wav"),
            "title": title,
        }
        job = {
            "id": job_id,
            "status": "queued",
            "progress": 0,
            "status_message": "Cover job queued...",
            "title": title,
            "params": params,
            "created_at": datetime.now().isoformat(),
            "audio_url": f"/api/song-generation/audio/{job_id}",
            "source_song_id": source.get("source_song_id"),
            "source_title": source.get("title"),
            "derivation_type": "cover",
            "derivation_metadata": {
                "target_voice": target_voice or None,
                "pitch_shift": data.get("pitch_shift", 0),
                "style_prompt": data.get("style_prompt"),
                "lyrics": data.get("lyrics"),
                "cover_mode": data.get("cover_mode", "full"),
                "preserve_tempo": data.get("preserve_tempo", True),
                "audio_cover_strength": data.get("audio_cover_strength", 1.0),
                "strong_audio_conditioning": data.get("strong_audio_conditioning", False),
            },
            "error": None,
        }
        song_generation_jobs[job_id] = job
        logger.info("[cover:%s] Job queued source_song_id=%s source_type=%s", job_id, source.get("source_song_id"), source.get("source_type"))
        threading.Thread(target=run_cover_generation_thread, args=(job_id, params), daemon=True).start()
        return jsonify({"job_id": job_id})
    except Exception as e:
        logger.exception("[cover] Failed to start cover generation")
        print(f"Error starting cover generation: {e}")
        return jsonify({"error": str(e)}), 500


@bp.route("/api/covers/<job_id>", methods=["GET"])
def get_cover_generation(job_id):
    if job_id not in song_generation_jobs:
        return jsonify({"error": "Job not found"}), 404
    return get_song_generation(job_id)


@bp.route("/api/covers/source/<path:source_song_id>", methods=["GET"])
def get_cover_source(source_song_id):
    source = get_cover_source_payload(source_song_id)
    if not source:
        return jsonify({"error": "Source song not found"}), 404
    return jsonify({"source_song": source})


@bp.route("/api/covers/transcribe", methods=["POST"])
def transcribe_cover_lyrics():
    try:
        data = request.get_json() or {}
        source_song_id = str(data.get("source_song_id") or "").strip()
        engine = str(data.get("engine") or "whisperx").strip().lower()
        if not source_song_id:
            return jsonify({"error": "source_song_id is required"}), 400
        lyrics = transcribe_cover_source(source_song_id, engine=engine)
        return jsonify({"lyrics": lyrics})
    except Exception as e:
        logger.exception("[cover] Failed to transcribe source song")
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
            "derivation_type": job.get("derivation_type"),
            "source_song_id": job.get("source_song_id"),
            "source_title": job.get("source_title"),
            "derivation_metadata": job.get("derivation_metadata"),
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
                "derivation_type": job.get("derivation_type"),
                "source_song_id": job.get("source_song_id"),
                "source_title": job.get("source_title"),
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
