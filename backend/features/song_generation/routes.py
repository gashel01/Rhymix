import hashlib
import threading
import uuid
from datetime import datetime
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file

from backend.features.song_generation.service import SONG_GENERATION_DIR, run_song_generation_thread
from backend.jobs.registry import song_generation_jobs

bp = Blueprint("song_generation", __name__)


@bp.route("/api/song-generation/start", methods=["POST"])
def start_song_generation():
    """Start a new song generation job"""
    try:
        data = request.get_json() or {}

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
            "output_file": None,
            "audio_url": None,
            "error": None,
        }

        song_generation_jobs[job_id] = job

        # Start generation in background thread
        threading.Thread(target=run_song_generation_thread, args=(job_id, data), daemon=True).start()

        return jsonify({"job_id": job_id, "status": "queued", "message": "Song generation started"})

    except Exception as e:
        print(f"Error starting song generation: {e}")
        return jsonify({"error": str(e)}), 500


@bp.route("/api/song-generation/status/<job_id>", methods=["GET"])
def get_song_generation_status(job_id):
    """Get status of a song generation job"""
    if job_id not in song_generation_jobs:
        return jsonify({"error": "Job not found"}), 404

    job = song_generation_jobs[job_id]
    return jsonify(
        {
            "id": job["id"],
            "status": job["status"],
            "progress": job["progress"],
            "status_message": job.get("status_message", ""),
            "title": job.get("title", ""),
            "audio_url": job.get("audio_url"),
            "vocals_url": job.get("vocals_url"),
            "instrumental_url": job.get("instrumental_url"),
            "processed": job.get("processed", False),
            "inference_completed": job.get("inference_completed", False),
            "model_name": job.get("params", {}).get("model_name"),
            "output_filename": job.get("output_filename"),
            "created_at": job.get("created_at"),
            "completed_at": job.get("completed_at"),
            "error": job.get("error"),
        }
    )


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


@bp.route("/api/song-generation/audio/<job_id>", methods=["GET"])
def get_song_generation_audio(job_id):
    """Stream audio for a song generation job"""
    if job_id not in song_generation_jobs:
        return jsonify({"error": "Job not found"}), 404

    job = song_generation_jobs[job_id]
    if job["status"] != "completed" or not job.get("output_file"):
        return jsonify({"error": "Audio not ready"}), 404

    output_path = Path(job["output_file"])
    if not output_path.exists():
        return jsonify({"error": "Audio file not found"}), 404

    return send_file(output_path, mimetype="audio/wav")


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
            if job.get("output_file"):
                output_path = Path(job["output_file"])
                if output_path.exists():
                    output_path.unlink()
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
