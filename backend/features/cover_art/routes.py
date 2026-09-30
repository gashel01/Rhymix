"""Cover art endpoints.

Generation is always backgrounded and never blocks a response: a cover takes a
couple of seconds of CPU, and the caller is either a UI that would rather show a
placeholder than freeze, or the song pipeline, which has better things to do.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime
from pathlib import Path

import zlib

from flask import Blueprint, jsonify, request, send_file

from backend.features.cover_art.service import COVER_FILENAME, build_prompt, generate_cover, is_available
from backend.features.song_generation.service import SONG_GENERATION_JOBS_DIR
from backend.paths.manager import paths

bp = Blueprint("cover_art", __name__)
logger = logging.getLogger(__name__)

# One backfill at a time, tracked so the UI can show where it is. Not persisted:
# a backfill interrupted by a restart is simply restarted, and it skips
# everything already done.
_backfill = {"status": "idle", "done": 0, "total": 0, "current": None, "error": None}
_backfill_lock = threading.Lock()


def stable_seed(key: str) -> int:
    """A seed that survives a restart.

    `hash()` on a string is salted per interpreter, so seeding a redraw with it
    gave a different picture every time the app came back up — which is the one
    thing a cover must not do. A checksum is stable for the same input forever.
    """
    return zlib.crc32(key.encode("utf-8")) & 0x7FFFFFFF


def cover_path(job_id: str) -> Path:
    return SONG_GENERATION_JOBS_DIR / job_id / COVER_FILENAME


def has_cover(job_id: str) -> bool:
    return cover_path(job_id).exists()


def cover_url(job_id: str) -> str | None:
    """The URL for a job's cover, or None when it has none yet."""
    return f"/api/song-generation/{job_id}/cover" if has_cover(job_id) else None


def _job_words(job_id: str) -> tuple[str, str, str]:
    """Title, style and lyrics, read back off a job's manifest."""
    from backend.features.song_generation.routes import _get_or_load_job

    job = _get_or_load_job(job_id) or {}
    params = job.get("params") if isinstance(job.get("params"), dict) else {}
    return (
        str(job.get("title") or ""),
        str(params.get("style") or ""),
        str(params.get("lyrics") or ""),
    )


def render_cover_async(job_id: str, seed: int | None = None) -> None:
    """Draw a cover for a job, in the background, swallowing failure.

    Called from the song pipeline, where a missing picture must never turn a
    finished song into a failed one.
    """

    def _run():
        try:
            title, style, lyrics = _job_words(job_id)
            generate_cover(cover_path(job_id), title, style, lyrics, seed=seed)
        except Exception:
            logger.exception("Cover art failed for %s", job_id)

    threading.Thread(target=_run, daemon=True).start()


@bp.route("/api/song-generation/<job_id>/cover", methods=["GET"])
def get_cover(job_id):
    path = cover_path(job_id)
    if not path.exists():
        return jsonify({"error": "No cover for this song"}), 404
    return send_file(path, mimetype="image/png")


@bp.route("/api/song-generation/<job_id>/cover", methods=["POST"])
def make_cover(job_id):
    """Draw or redraw one cover. Returns immediately; poll the GET to see it."""
    if not is_available():
        return jsonify({"error": "Cover art is not available — diffusers is not installed."}), 503
    if not (SONG_GENERATION_JOBS_DIR / job_id).exists():
        return jsonify({"error": "Song not found"}), 404

    data = request.get_json(silent=True) or {}
    seed = data.get("seed")
    render_cover_async(job_id, seed=int(seed) if isinstance(seed, (int, str)) and str(seed).lstrip("-").isdigit() else None)
    title, style, lyrics = _job_words(job_id)
    return jsonify({"status": "drawing", "prompt": build_prompt(title, style, lyrics)})


# ------------------------------------------------------------------ imports

# Imports keep their covers here rather than beside the audio: the input folder
# is the pipeline's working directory and gets swept, and a picture is not a
# thing you want swept.
UPLOAD_COVERS_DIR = paths.BASE_DIR / "data" / "covers" / "uploads"


def upload_cover_path(file_id: str) -> Path:
    return UPLOAD_COVERS_DIR / f"{file_id}.png"


def upload_cover_url(file_id: str) -> str | None:
    return f"/api/uploads/{file_id}/cover" if upload_cover_path(file_id).exists() else None


def render_upload_cover_async(file_id: str, name: str) -> None:
    """Draw a cover for an imported track, in the background.

    An import has no style prompt and no lyrics — only its filename — so the
    picture is whatever that title suggests. It is still worth drawing: a
    library where half the rows have art and half show a gradient reads as
    half-broken, and the whole point of importing is to work with the track
    alongside the ones this app generated.
    """

    def _run():
        try:
            UPLOAD_COVERS_DIR.mkdir(parents=True, exist_ok=True)
            generate_cover(
                upload_cover_path(file_id), name, "", "", seed=stable_seed(file_id)
            )
        except Exception:
            logger.exception("Cover art failed for upload %s", file_id)

    threading.Thread(target=_run, daemon=True).start()


@bp.route("/api/uploads/<file_id>/cover", methods=["GET"])
def get_upload_cover(file_id):
    path = upload_cover_path(file_id)
    if not path.exists():
        return jsonify({"error": "No cover for this import"}), 404
    return send_file(path, mimetype="image/png")


@bp.route("/api/uploads/<file_id>/cover", methods=["POST"])
def make_upload_cover(file_id):
    if not is_available():
        return jsonify({"error": "Cover art is not available — diffusers is not installed."}), 503

    from backend.storage.metadata import list_upload_metadata

    record = next((r for r in list_upload_metadata() if r.get("fileId") == file_id), None)
    if not record:
        return jsonify({"error": "Import not found"}), 404
    name = record.get("safeDisplayName") or record.get("originalName") or "Imported track"
    render_upload_cover_async(file_id, name)
    return jsonify({"status": "drawing", "prompt": build_prompt(name, "", "")})


# -------------------------------------------------------------- conversions

# A run only ever gets one of these when there was nothing left to inherit -
# see run_cover_url below - so it lives beside the run's own files rather
# than a shared directory the way uploads' do.
RUN_COVER_FILENAME = "cover.png"


def run_cover_path(run_id: str) -> Path:
    return paths.INFERENCE_RUNS_DIR / run_id / RUN_COVER_FILENAME


def has_run_cover(run_id: str) -> bool:
    return run_cover_path(run_id).exists()


def own_run_cover_url(run_id: str) -> str | None:
    return f"/api/inference/{run_id}/cover" if has_run_cover(run_id) else None


def render_run_cover_async(run_id: str, name: str, seed: int | None = None) -> None:
    """Draw a cover for a conversion itself, in the background.

    Only reachable when run_cover_url found nothing to inherit - the source
    it re-sang is gone, or never had one and can't get one either (a deleted
    upload, say). The conversion still has real audio; there is no reason it
    should be stuck with a blank gradient forever for that.
    """

    def _run():
        try:
            generate_cover(run_cover_path(run_id), name, "", "", seed=seed)
        except Exception:
            logger.exception("Cover art failed for run %s", run_id)

    threading.Thread(target=_run, daemon=True).start()


@bp.route("/api/inference/<run_id>/cover", methods=["GET"])
def get_run_cover(run_id):
    path = run_cover_path(run_id)
    if not path.exists():
        return jsonify({"error": "No cover for this run"}), 404
    return send_file(path, mimetype="image/png")


@bp.route("/api/inference/<run_id>/cover", methods=["POST"])
def make_run_cover(run_id):
    if not is_available():
        return jsonify({"error": "Cover art is not available — diffusers is not installed."}), 503

    from backend.storage.inference_runs import load_inference_run_metadata

    run = load_inference_run_metadata(run_id)
    if not run:
        return jsonify({"error": "Run not found"}), 404
    if run_cover_url(run, skip_own=True):
        # The thing it re-sang got a cover of its own in the meantime -
        # inheriting that is still the better answer than drawing a second,
        # unrelated picture for the same song.
        return jsonify({"error": "This conversion has something to inherit a cover from instead."}), 409

    data = request.get_json(silent=True) or {}
    seed = data.get("seed")
    name = str(run.get("inputDisplayName") or run.get("modelName") or "Converted track")
    render_run_cover_async(
        run_id, name, seed=int(seed) if isinstance(seed, (int, str)) and str(seed).lstrip("-").isdigit() else None
    )
    return jsonify({"status": "drawing", "prompt": build_prompt(name, "", "")})


def run_cover_url(run: dict, skip_own: bool = False) -> str | None:
    """The cover a conversion should wear: the one belonging to what it re-sang.

    A conversion is the same song in a different voice, so drawing it a picture
    of its own would say it is a different record. It inherits instead, walking
    back through however many voices were layered on top of each other until it
    reaches the track someone actually made — and only once that search comes up
    empty does its own drawn cover (if it has one) get to stand in, rather than
    leaving it blank forever because whatever it re-sang can never have one
    (a deleted upload, say). `skip_own` is for the one caller checking whether
    that fallback is still needed at all.
    """
    song_job_id = run.get("songJobId")
    file_id = run.get("inputFileId")
    source_run_id = run.get("sourceRunId")
    for _ in range(8):
        if song_job_id and has_cover(song_job_id):
            return cover_url(song_job_id)
        if file_id:
            found = upload_cover_url(file_id)
            if found:
                return found
        if not source_run_id:
            break
        from backend.storage.inference_runs import load_inference_run_metadata

        parent = load_inference_run_metadata(source_run_id) or {}
        song_job_id = parent.get("songJobId")
        file_id = parent.get("inputFileId")
        source_run_id = parent.get("sourceRunId")

    # The chain (or the 8-hop safety limit) came up empty either way - both
    # mean there was nothing to inherit, and the fallback applies the same.
    if skip_own:
        return None
    run_id = run.get("runId") or run.get("id")
    return own_run_cover_url(run_id) if run_id else None


@bp.route("/api/cover-art/backfill", methods=["GET"])
def backfill_status():
    with _backfill_lock:
        return jsonify(dict(_backfill))


@bp.route("/api/cover-art/backfill", methods=["POST"])
def start_backfill():
    """Draw a cover for every song that has none."""
    if not is_available():
        return jsonify({"error": "Cover art is not available — diffusers is not installed."}), 503

    with _backfill_lock:
        if _backfill["status"] == "running":
            return jsonify(dict(_backfill))

        pending = [
            directory.name
            for directory in sorted(SONG_GENERATION_JOBS_DIR.iterdir())
            if directory.is_dir() and not (directory / COVER_FILENAME).exists()
        ]
        _backfill.update(
            {
                "status": "running" if pending else "idle",
                "done": 0,
                "total": len(pending),
                "current": None,
                "error": None,
                "started_at": datetime.now().isoformat(),
            }
        )
        if not pending:
            return jsonify(dict(_backfill))

    def _run(job_ids):
        for job_id in job_ids:
            with _backfill_lock:
                _backfill["current"] = job_id
            try:
                title, style, lyrics = _job_words(job_id)
                # Seeded from the job id so a redraw of the same song is the
                # same picture — a cover that changes every restart is not a
                # cover, it is a screensaver.
                generate_cover(cover_path(job_id), title, style, lyrics, seed=stable_seed(job_id))
            except Exception as exc:
                logger.exception("Backfill failed for %s", job_id)
                with _backfill_lock:
                    _backfill["error"] = str(exc)
            with _backfill_lock:
                _backfill["done"] += 1
        with _backfill_lock:
            _backfill["status"] = "done"
            _backfill["current"] = None

    threading.Thread(target=_run, args=(pending,), daemon=True).start()
    return jsonify(dict(_backfill))
