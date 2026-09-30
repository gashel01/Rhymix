import gc
import hashlib
import json
import logging
import shutil
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file

from backend.app import yue2_params
from backend.features.song_generation.service import (
    DEFAULT_PROVIDER,
    PROVIDER_LICENSES,
    SONG_GENERATION_DIR,
    SONG_GENERATION_JOBS_DIR,
    available_providers,
    run_song_generation_thread,
)
from backend.features.song_generation.jobs_common import ASSET_KEYS, _asset_path
from backend.features.song_generation.cover import (
    get_cover_source_payload,
    resolve_cover_source,
    run_cover_generation_thread,
)
from backend.jobs.registry import song_generation_jobs

bp = Blueprint("song_generation", __name__)
logger = logging.getLogger(__name__)

def _source_payload(job: dict) -> dict | None:
    """The track this one was derived from, with its audio, or None.

    A cover keeps a prefixed reference in `source_song_id`; a lyric rewrite
    keeps a bare job id in `derived_from`. Both mean the same thing, so both
    end up here.
    """
    if (job.get("derivation_type") or "original") == "original":
        return None
    from backend.features.track_sources import resolve_source

    ref = job.get("source_song_id") or job.get("derived_from")
    return resolve_source(ref) if ref else None


def _job_manifest_path(job_id: str) -> Path:
    return SONG_GENERATION_JOBS_DIR / job_id / "job.json"


def _serialize_job_for_manifest(job: dict) -> dict:
    return {
        "id": job.get("id"),
        "title": job.get("title"),
        "params": job.get("params"),
        "created_at": job.get("created_at"),
        "completed_at": job.get("completed_at"),
        "derivation_type": job.get("derivation_type"),
        "source_song_id": job.get("source_song_id"),
        "source_title": job.get("source_title"),
        # A lyric rewrite records its parent here and nowhere else; without it
        # in the manifest the link died at the first restart, and the rewrite
        # became a song that came from nothing.
        "derived_from": job.get("derived_from"),
        "derivation_metadata": job.get("derivation_metadata"),
        "status": job.get("status"),
        "status_message": job.get("status_message"),
        "error": job.get("error"),
        # Why the voice model asked for never showed up, when the song itself
        # still finished fine — a job that "failed" here is exactly the kind
        # a restart used to erase the only record of.
        "voice_error": job.get("voice_error"),
        "instrumental_only": bool(job.get("instrumental_only")),
    }


def _write_job_manifest(job_id: str, job: dict) -> None:
    try:
        path = _job_manifest_path(job_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as handle:
            json.dump(_serialize_job_for_manifest(job), handle, indent=2, sort_keys=True)
    except Exception:
        logger.exception("Failed to write song generation manifest for %s", job_id)


def _load_job_manifest(job_id: str) -> dict | None:
    path = _job_manifest_path(job_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        logger.exception("Failed to read song generation manifest for %s", job_id)
        return None


def _build_assets_from_disk(job_id: str) -> dict | None:
    assets = {}
    for key in ASSET_KEYS:
        path = _asset_path(job_id, key)
        if path.exists():
            assets[key] = {
                "ready": True,
                "url": f"/api/song-generation/{job_id}/audio/{key}",
                "path": str(path),
            }
    return assets or None


def _cover_url(job_id: str) -> str | None:
    """A job's cover, if one has been drawn.

    Imported inside the function because cover_art imports this module for the
    job manifest — at module scope the two would deadlock on each other.
    """
    from backend.features.cover_art.routes import cover_url

    return cover_url(job_id)


# What counts as finished. Anything else, read back from disk, is an orphan.
TERMINAL_JOB_STATUSES = {"completed", "failed", "cancelled"}


def _build_score_from_disk(job_id: str) -> dict | None:
    """Rebuild the score block from the files the run left behind.

    `job["score"]` was only ever set in memory by the provider, so restarting
    the backend made every saved score vanish from the UI — no Score tag, no
    downloads, and no way to rewrite the lyrics — while score.abc and score.mid
    sat untouched in the job's own directory.
    """
    job_dir = SONG_GENERATION_JOBS_DIR / job_id
    found = {kind: job_dir / filename for kind, (filename, _) in SCORE_FILES.items()}
    if not any(path.exists() for path in found.values()):
        return None
    score = {}
    if found["abc"].exists():
        score["score_abc"] = str(found["abc"])
        score["url_abc"] = f"/api/song-generation/{job_id}/score/abc"
    if found["midi"].exists():
        score["score_midi"] = str(found["midi"])
        score["url_midi"] = f"/api/song-generation/{job_id}/score/midi"
    return score


def _hydrate_job_from_disk(job_id: str) -> dict | None:
    job_dir = SONG_GENERATION_JOBS_DIR / job_id
    if not job_dir.exists():
        return None
    manifest = _load_job_manifest(job_id) or {}
    assets = _build_assets_from_disk(job_id)
    if not manifest and not assets:
        return None
    created_at = manifest.get("created_at")
    if not created_at:
        try:
            created_at = datetime.fromtimestamp(job_dir.stat().st_ctime).isoformat()
        except Exception:
            created_at = datetime.now().isoformat()
    completed_at = manifest.get("completed_at")
    if not completed_at and assets:
        try:
            latest = max(Path(a["path"]).stat().st_mtime for a in assets.values() if a.get("path"))
            completed_at = datetime.fromtimestamp(latest).isoformat()
        except Exception:
            completed_at = None
    status = manifest.get("status") or ("completed" if assets else "queued")
    progress = 100 if assets else 0
    error = manifest.get("error")

    # A job is only ever hydrated from disk when it is *not* in the in-memory
    # registry — and a job that is genuinely running is always in that registry,
    # because that is where its own thread writes. So a manifest still claiming
    # to be mid-flight belongs to a process that no longer exists: a crash, or a
    # restart. Left alone it spins in the UI forever.
    if status not in TERMINAL_JOB_STATUSES:
        status = "failed"
        error = error or "Interrupted — the backend stopped while this was generating."
        progress = 100
    return {
        "id": job_id,
        "status": status,
        "progress": progress,
        "status_message": manifest.get("status_message", ""),
        "title": manifest.get("title") or "Generated song",
        "params": manifest.get("params") or {},
        "created_at": created_at,
        "completed_at": completed_at,
        "audio_url": f"/api/song-generation/audio/{job_id}",
        "assets": assets,
        "score": _build_score_from_disk(job_id),
        "derivation_type": manifest.get("derivation_type") or "original",
        "source_song_id": manifest.get("source_song_id"),
        "source_title": manifest.get("source_title"),
        "derived_from": manifest.get("derived_from"),
        "derivation_metadata": manifest.get("derivation_metadata"),
        "error": error,
        "voice_error": manifest.get("voice_error"),
        "instrumental_only": bool(manifest.get("instrumental_only")),
    }


def _get_or_load_job(job_id: str) -> dict | None:
    job = song_generation_jobs.get(job_id)
    if job:
        return job
    job = _hydrate_job_from_disk(job_id)
    if job:
        song_generation_jobs[job_id] = job
    return job


def _resolve_yue2_audio_inputs(data: dict) -> tuple[dict, str | None, dict | None]:
    """Turn library references into local paths YuE2 can actually open.

    The frontend sends a source_song_id (an upload, an inference run, an earlier
    generation); WanGP needs a file on disk. Covers want the full mix, because
    SheetSage2 transcribes melody *and* chords from the whole arrangement rather
    than from isolated vocals.

    The third return value is the source's identity — id, title, and which of
    the two this was ("cover" or "hum") — so the caller can record what this
    job was built from. A hum used to be left out of this on the theory that
    it is a performance of its own, not a version of an existing track — true,
    but it left the raw recording and the song it became looking like two
    unrelated rows with the same accidental filename for a title, with no way
    back from one to the other.
    """
    resolved = dict(data)
    linked_source = None

    for key, target in (("cover_source_id", "audio_guide"), ("hum_source_id", "hum_audio")):
        source_id = str(resolved.pop(key, "") or "").strip()
        if not source_id or resolved.get(target):
            continue
        try:
            source = resolve_cover_source(source_id)
        except Exception as exc:
            return resolved, f"Could not resolve {key}: {exc}", None
        if not source:
            return resolved, f"Source not found: {source_id}", None
        path = source.get("audio_path") or source.get("vocals_path")
        if not path or not Path(path).exists():
            return resolved, f"No local audio available for {source_id}", None
        resolved[target] = str(path)
        linked_source = {
            "kind": "cover" if key == "cover_source_id" else "hum",
            "source_song_id": source.get("source_song_id") or source_id,
            "title": source.get("title"),
        }

    for target in ("audio_guide", "hum_audio", "custom_guide"):
        value = resolved.get(target)
        if value and not Path(str(value)).exists():
            return resolved, f"File not found: {value}", None

    return resolved, None, linked_source


@bp.route("/api/song-generation", methods=["POST"])
@bp.route("/api/song-generation/start", methods=["POST"])
def start_song_generation():
    """Start a new song generation job"""
    try:
        raw = request.get_json() or {}
        provider = str(raw.get("provider") or DEFAULT_PROVIDER).strip().lower()

        data = dict(raw)
        data["provider"] = provider
        resolved, resolve_error, linked_source = _resolve_yue2_audio_inputs(data)
        if resolve_error:
            return jsonify({"error": resolve_error}), 400
        data = resolved
        errors = yue2_params.validate(data)
        if errors:
            return jsonify({"error": " ".join(errors)}), 400
        notices = yue2_params.warnings(data)

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
            "provider": provider,
            "created_at": datetime.now().isoformat(),
            "audio_url": f"/api/song-generation/audio/{job_id}",
            # A cover or a hum is a real derivation — same shape as a lyric
            # rewrite, and the library's take switcher already knows how to
            # draw one once it sees this. Without it, a hum-built song and the
            # recording it came from looked like two unrelated tracks that
            # happened to share a filename, with no way back from one to the
            # other and no way to compare them.
            "derivation_type": linked_source["kind"] if linked_source else "original",
            "source_song_id": linked_source["source_song_id"] if linked_source else None,
            "source_title": linked_source["title"] if linked_source else None,
            "instrumental_only": bool(data.get("instrumental_only")),
            "error": None,
        }
        if notices:
            job["notices"] = notices

        song_generation_jobs[job_id] = job
        _write_job_manifest(job_id, job)

        # Start generation in background thread
        threading.Thread(target=run_song_generation_thread, args=(job_id, data), daemon=True).start()

        return jsonify({"job_id": job_id, "provider": provider, "notices": notices})

    except Exception as e:
        logging.error(f"Error starting song generation: {e}")
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
                "preserve_tempo": data.get("preserve_tempo", True),
                "audio_cover_strength": data.get("audio_cover_strength", 1.0),
                "strong_audio_conditioning": data.get("strong_audio_conditioning", False),
            },
            "error": None,
        }
        song_generation_jobs[job_id] = job
        _write_job_manifest(job_id, job)
        logger.info("[cover:%s] Job queued source_song_id=%s source_type=%s", job_id, source.get("source_song_id"), source.get("source_type"))
        threading.Thread(target=run_cover_generation_thread, args=(job_id, params), daemon=True).start()
        return jsonify({"job_id": job_id})
    except Exception as e:
        logger.exception("[cover] Failed to start cover generation")
        logging.error(f"Error starting cover generation: {e}")
        return jsonify({"error": str(e)}), 500


@bp.route("/api/covers/<job_id>", methods=["GET"])
def get_cover_generation(job_id):
    if not _get_or_load_job(job_id):
        return jsonify({"error": "Job not found"}), 404
    return get_song_generation(job_id)


@bp.route("/api/covers/source/<path:source_song_id>", methods=["GET"])
def get_cover_source(source_song_id):
    source = get_cover_source_payload(source_song_id)
    if not source:
        return jsonify({"error": "Source song not found"}), 404
    return jsonify({"source_song": source})


@bp.route("/api/song-generation/<job_id>", methods=["GET"])
def get_song_generation(job_id):
    """Get status of a song generation job (new contract)"""
    job = _get_or_load_job(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
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
    # What the song was made from, in the words its author used.
    #
    # The full params dict is written to the manifest and survives a restart,
    # but only the four engine paths above were ever handed back, so the lyrics
    # a track was written with could not be read or reused — including by the
    # rewrite-lyrics flow, whose whole purpose is to start from them. Engine
    # paths stay out of this: they are filesystem layout, not a recipe.
    recipe = {
        "lyrics": params.get("lyrics") or "",
        "style": params.get("style") or "",
        "duration_seconds": params.get("duration_seconds"),
        "model_mode": params.get("model_mode"),
        "save_score": params.get("save_score"),
        "seed": params.get("seed"),
        "temperature": params.get("temperature"),
        "top_k": params.get("top_k"),
        "top_p": params.get("top_p"),
        "guidance_scale": params.get("guidance_scale"),
        "num_inference_steps": params.get("num_inference_steps"),
        "hum": bool(params.get("hum")),
    }
    assets = job.get("assets")
    if isinstance(assets, dict):
        # Ensure ready assets include URL
        for key, asset in list(assets.items()):
            if not isinstance(asset, dict):
                continue
            if asset.get("ready") and not asset.get("url"):
                asset["url"] = f"/api/song-generation/{job_id}/audio/{key}"
                assets[key] = asset

    _write_job_manifest(job_id, job)

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
            "recipe": recipe,
            "created_at": job.get("created_at"),
            "completed_at": job.get("completed_at"),
            "error": job.get("error"),
            "voice_error": job.get("voice_error"),
            "instrumental_only": bool(job.get("instrumental_only")),
            "assets": assets,
            # Without this the UI has to probe /score/abc to find out whether a
            # score exists, and a 404 is not a good way to ask a question.
            "score": job.get("score"),
            "cover_url": _cover_url(job_id),
            "timings": job.get("timings"),
            "derivation_type": job.get("derivation_type"),
            "source_song_id": job.get("source_song_id"),
            "source_title": job.get("source_title"),
            "source": _source_payload(job),
            "derivation_metadata": job.get("derivation_metadata"),
        }
    )


@bp.route("/api/song-generation/status/<job_id>", methods=["GET"])
def get_song_generation_status(job_id):
    """Legacy status endpoint"""
    return get_song_generation(job_id)


@bp.route("/api/song-generation/<job_id>/full", methods=["POST"])
def trigger_full_generation(job_id):
    """Gone with ACE-Step's two-phase preview-then-full flow.

    YuE2 renders the whole song in one pass, so there is no preview to promote.
    The route is kept so older clients get an explanation instead of a 404.
    """
    if not _get_or_load_job(job_id):
        return jsonify({"error": "Job not found"}), 404
    return jsonify(
        {"error": "Two-phase generation was removed with ACE-Step; YuE2 renders the full song directly."}
    ), 410


@bp.route("/api/song-generation/jobs", methods=["GET"])
def list_song_generation_jobs():
    """List all song generation jobs"""
    jobs = []
    # list(...) snapshots the dict before iterating: song_generation_jobs is mutated from other
    # request threads (job creation/deletion, Studio's job flow) now that the server runs
    # threaded, and iterating the live dict directly raced with those writes -
    # "RuntimeError: dictionary changed size during iteration" - crashing this endpoint with a
    # 500 that left the Library view stuck on "Loading..." forever.
    for job_id, job in list(song_generation_jobs.items()):
        _write_job_manifest(job_id, job)
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
                "voice_error": job.get("voice_error"),
                "instrumental_only": bool(job.get("instrumental_only")),
                "assets": job.get("assets"),
                "score": job.get("score"),
                "cover_url": _cover_url(job_id),
                "created_at": job.get("created_at"),
                "completed_at": job.get("completed_at"),
                "derivation_type": job.get("derivation_type"),
                "source_song_id": job.get("source_song_id"),
                "source_title": job.get("source_title"),
                "source": _source_payload(job),
            }
        )

    # Scan for job directories created by the pipeline (persistent assets)
    try:
        for d in SONG_GENERATION_JOBS_DIR.iterdir():
            if not d.is_dir():
                continue
            job_id = d.name
            if job_id in song_generation_jobs:
                continue
            job = _hydrate_job_from_disk(job_id)
            if job:
                jobs.append(
                    {
                        "id": job.get("id"),
                        "status": job.get("status"),
                        "progress": job.get("progress", 0),
                        "title": job.get("title", ""),
                        "audio_url": job.get("audio_url"),
                        "vocals_url": job.get("vocals_url"),
                        "instrumental_url": job.get("instrumental_url"),
                        "processed": job.get("processed", False),
                        "inference_completed": job.get("inference_completed", False),
                        "model_name": (job.get("params") or {}).get("model_name"),
                        "voice_error": job.get("voice_error"),
                        "instrumental_only": bool(job.get("instrumental_only")),
                        "assets": job.get("assets"),
                        "score": job.get("score"),
                        "cover_url": _cover_url(job_id),
                        "created_at": job.get("created_at"),
                        "completed_at": job.get("completed_at"),
                        "derivation_type": job.get("derivation_type"),
                        "source_song_id": job.get("source_song_id"),
                        "source_title": job.get("source_title"),
                        "source": _source_payload(job),
                    }
                )
    except Exception as e:
        logging.error(f"Error scanning job directories: {e}")

    # Also scan for existing generated songs on disk
    try:
        for wav_file in SONG_GENERATION_DIR.glob("*.wav"):
            # Check if already in active jobs
            filename = wav_file.name
            existing = any(j.get("output_filename") == filename for j in list(song_generation_jobs.values()))
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
        logging.error(f"Error scanning generated songs: {e}")

    # Sort by created_at descending
    jobs.sort(key=lambda x: x.get("created_at", ""), reverse=True)

    return jsonify({"jobs": jobs})


@bp.route("/api/song-generation/<job_id>/audio/<asset_key>", methods=["GET"])
def get_song_generation_asset(job_id, asset_key):
    if not _get_or_load_job(job_id):
        return jsonify({"error": "Job not found"}), 404
    if asset_key not in ASSET_KEYS:
        return jsonify({"error": "Invalid asset key"}), 400
    p = _asset_path(job_id, asset_key)
    if not p.exists():
        return jsonify({"error": "Audio not ready"}), 404
    return send_file(p, mimetype="audio/wav", as_attachment=False)


SCORE_FILES = {"abc": ("score.abc", "text/plain"), "midi": ("score.mid", "audio/midi")}


def _score_path(job_id: str, kind: str) -> Path | None:
    entry = SCORE_FILES.get(kind)
    if not entry:
        return None
    candidate = SONG_GENERATION_JOBS_DIR / job_id / entry[0]
    return candidate if candidate.exists() else None


@bp.route("/api/song-generation/providers", methods=["GET"])
def list_song_generation_providers():
    """Engines the backend can route to, and what using them commits you to."""
    return jsonify(
        {
            "providers": available_providers(),
            "default": DEFAULT_PROVIDER,
            "licenses": PROVIDER_LICENSES,
        }
    )


@bp.route("/api/song-generation/<job_id>/score/<kind>", methods=["GET"])
def get_song_generation_score(job_id, kind):
    """Serve the ABC / MIDI composition YuE2 planned for this song.

    This is the conditioning score, not a transcription of the finished
    performance - it is what you feed back in to keep the music while the
    lyrics change.
    """
    if not _get_or_load_job(job_id):
        return jsonify({"error": "Job not found"}), 404
    if kind not in SCORE_FILES:
        return jsonify({"error": "Invalid score kind"}), 400
    path = _score_path(job_id, kind)
    if not path:
        return jsonify({"error": "No score for this job - generate with Save Score enabled"}), 404
    return send_file(path, mimetype=SCORE_FILES[kind][1], as_attachment=False)


@bp.route("/api/song-generation/<job_id>/rewrite-lyrics", methods=["POST"])
def rewrite_song_lyrics(job_id):
    """Regenerate a song with new lyrics over the same composition.

    The point of the whole YuE2 move: instead of re-rolling the dice, reuse the
    saved ABC score so melody, chords and structure survive and only the
    performance is sung again.
    """
    source_job = _get_or_load_job(job_id)
    if not source_job:
        return jsonify({"error": "Job not found"}), 404

    score = _score_path(job_id, "abc")
    if not score:
        return jsonify(
            {"error": "This song has no saved score. Regenerate it with Save Score enabled first."}
        ), 400

    data = request.get_json() or {}
    lyrics = str(data.get("lyrics") or "").strip()
    if not lyrics:
        return jsonify({"error": "Lyrics are required"}), 400

    previous = dict(source_job.get("params") or {})
    params = {
        **previous,
        "provider": "yue2",
        "lyrics": lyrics,
        "custom_guide": str(score),
        # A source song would override the score we are trying to preserve.
        "audio_guide": None,
        "hum_audio": None,
        "hum": False,
    }
    # Planning is skipped when a score is supplied, but mode 2 rejects scores.
    if yue2_params.normalize(params)["model_mode"] == yue2_params.MODE_DIRECT:
        params["model_mode"] = yue2_params.MODE_MELODY_AND_CHORDS
    params.setdefault("save_score", True)

    errors = yue2_params.validate(params)
    if errors:
        return jsonify({"error": " ".join(errors)}), 400

    title = str(data.get("title") or "").strip() or f"{source_job.get('title') or 'Song'} (rewrite)"
    new_job_id = str(uuid.uuid4())
    job = {
        "id": new_job_id,
        "status": "queued",
        "progress": 0,
        "status_message": "Job queued...",
        "title": title,
        "params": params,
        "provider": "yue2",
        "created_at": datetime.now().isoformat(),
        "audio_url": f"/api/song-generation/audio/{new_job_id}",
        "derivation_type": "lyric_rewrite",
        "derived_from": job_id,
        "error": None,
    }
    notices = yue2_params.warnings(params)
    if notices:
        job["notices"] = notices

    song_generation_jobs[new_job_id] = job
    _write_job_manifest(new_job_id, job)
    threading.Thread(target=run_song_generation_thread, args=(new_job_id, params), daemon=True).start()

    return jsonify({"job_id": new_job_id, "derived_from": job_id, "notices": notices})


@bp.route("/api/song-generation/audio/<job_id>", methods=["GET"])
def get_song_generation_audio(job_id):
    """Legacy best-available mix"""
    if not _get_or_load_job(job_id):
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


@bp.route("/api/song-generation/<job_id>/conversion", methods=["DELETE"])
def delete_song_conversion(job_id):
    """Throw away the voice a song was generated with, and keep the song.

    A generation run with one of your voices selected produces a second vocal
    and a second mix beside the ones the model sang. Those are the only things
    removed here: the original vocal, the instrumental and the full mix stay,
    and so does any conversion run made afterwards — which is what "delete this
    version" has to mean on a row that holds several.

    The voice is cleared from the job's parameters too. Left in place the row
    would go on naming a voice whose audio no longer exists, and report it as
    "not applied" — which would be a lie about what happened.
    """
    job_dir = SONG_GENERATION_JOBS_DIR / job_id
    if not job_dir.exists():
        return jsonify({"error": "Job not found"}), 404

    removed = []
    for key in ("vocals_rvc", "final_mix_rvc"):
        path = _asset_path(job_id, key)
        try:
            if path.exists():
                path.unlink()
                removed.append(key)
        except Exception:
            logger.exception("Could not delete %s for %s", key, job_id)

    job = _get_or_load_job(job_id)
    if job:
        assets = job.get("assets")
        if isinstance(assets, dict):
            for key in ("vocals_rvc", "final_mix_rvc"):
                assets[key] = {"ready": False}
        params = job.get("params")
        if isinstance(params, dict):
            params.pop("model_name", None)
            params.pop("model", None)
        job["model_name"] = None
        _write_job_manifest(job_id, job)

    return jsonify({"deleted": removed})


def _remove_job_dir(job_dir: Path) -> bool:
    """Best-effort delete, retrying through Windows file locks.

    A wav just streamed to the player (or still mid-Range-request) can hold
    an OS-level lock past the point its response finished, so the first
    rmtree routinely fails here on Windows. `ignore_errors=True` used to
    paper over that and report success anyway — the directory, unremoved,
    would then resurface on the very next list poll via the on-disk scan.
    """
    if not job_dir.exists():
        return True
    gc.collect()
    for attempt in range(5):
        shutil.rmtree(job_dir, ignore_errors=True)
        if not job_dir.exists():
            return True
        time.sleep(0.2 * (attempt + 1))
    return not job_dir.exists()


@bp.route("/api/song-generation/delete/<job_id>", methods=["DELETE"])
def delete_song_generation(job_id):
    """Delete a generated song"""
    try:
        # Check if it's an active job
        if job_id in song_generation_jobs:
            job_dir = SONG_GENERATION_JOBS_DIR / job_id
            if not _remove_job_dir(job_dir):
                return jsonify({
                    "error": "One of this song's files is still in use — close anything playing it and try again."
                }), 409
            del song_generation_jobs[job_id]
            return jsonify({"message": "Deleted successfully"})

        # Check if it's a job directory on disk
        job_dir = SONG_GENERATION_JOBS_DIR / job_id
        if job_dir.exists() and job_dir.is_dir():
            if not _remove_job_dir(job_dir):
                return jsonify({
                    "error": "One of this song's files is still in use — close anything playing it and try again."
                }), 409
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
