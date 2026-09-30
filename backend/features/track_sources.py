"""What a derived track was made from.

A cover, a lyric rewrite and a voice conversion are all the same shape: this
audio exists because that audio existed first. The library needs to offer both
sides — the original that went in, and the result that came out — and to do
that it needs the original's URLs, not just its name.

Every reference is a single string, `kind:id`, because that is the form the
cover pipeline already persists in `source_song_id`. The three kinds are the
three kinds of track this app has: a generated song, an import, a conversion.

A resolver returns None rather than a broken link. Sources get deleted, and a
row offering an "original" that 404s is worse than a row that simply does not
offer one.
"""

from __future__ import annotations

import logging
from pathlib import Path

from backend.paths.manager import paths

logger = logging.getLogger(__name__)


def parse_ref(ref: str) -> tuple[str, str]:
    """Split "songgen:abc" into ("songgen", "abc").

    A bare id means a generated song: that is what callers wrote before the
    prefixes existed, and those manifests are still on disk.
    """
    raw = str(ref or "").strip()
    if not raw:
        return "", ""
    if ":" in raw:
        kind, _, ident = raw.partition(":")
        kind = kind.strip().lower()
        if kind in {"songgen", "song", "upload", "run"}:
            return ("songgen" if kind == "song" else kind), ident.strip()
    return "songgen", raw


def _song_source(job_id: str) -> dict | None:
    from backend.features.song_generation.jobs_common import _asset_path
    from backend.features.song_generation.routes import _get_or_load_job

    job = _get_or_load_job(job_id)
    if not job:
        return None

    def url(key: str) -> str | None:
        return (
            f"/api/song-generation/{job_id}/audio/{key}"
            if _asset_path(job_id, key).exists()
            else None
        )

    # A song that was re-sung has two vocals; the one that matters as "the
    # original" is always the take the model sang first.
    return {
        "kind": "song",
        "id": job_id,
        "title": job.get("title") or "Generated song",
        "mixUrl": url("full_mix"),
        "vocalsUrl": url("vocals_raw"),
        "instrumentalUrl": url("instrumental"),
        "mixAsset": "full_mix",
        "vocalsAsset": "vocals_raw",
        "instrumentalAsset": "instrumental",
    }


def _upload_source(file_id: str) -> dict | None:
    from backend.storage.metadata import list_upload_metadata

    record = next((r for r in list_upload_metadata() if r.get("fileId") == file_id), None)
    # The uploads table is not the only truth: the pipeline registers a
    # temporary upload to push a song through separation and unregisters it
    # afterwards, leaving files named after an id the table no longer knows.
    # Those files are still the audio a run was sung over.
    base = Path(record["storedName"]).stem if record and record.get("storedName") else file_id
    stored = record.get("storedName") if record else f"{file_id}.wav"
    original = paths.INPUT_DIR / (stored or f"{file_id}.wav")
    vocals = paths.UVR_PROCESSED_DIR / f"{base}_vocals.wav"
    if not vocals.exists():
        vocals = paths.UVR_RAW_DIR / f"{base}_vocals.wav"
    instrumental = paths.INSTRUMENTAL_DIR / f"{base}_instrumental.wav"

    if not (original.exists() or vocals.exists() or instrumental.exists()):
        return None

    return {
        "kind": "upload",
        "id": f"upload:{file_id}",
        "title": (
            (record.get("safeDisplayName") or record.get("originalName") or stored)
            if record
            else "an imported vocal"
        ),
        "mixUrl": f"/api/uploads/{file_id}/audio" if original.exists() else None,
        "vocalsUrl": f"/api/uploads/{file_id}/audio/vocals" if vocals.exists() else None,
        "instrumentalUrl": (
            f"/api/uploads/{file_id}/audio/instrumental" if instrumental.exists() else None
        ),
        "mixAsset": "full_mix",
        "vocalsAsset": "vocals_raw",
        "instrumentalAsset": "instrumental",
    }


def _run_source(run_id: str) -> dict | None:
    from backend.routes.download import resolve_run_asset
    from backend.storage.inference_runs import load_inference_run_metadata

    meta = load_inference_run_metadata(run_id)
    if not meta:
        return None

    def url(kind: str) -> str | None:
        return f"/api/inference/{run_id}/audio/{kind}" if resolve_run_asset(run_id, kind) else None

    name = meta.get("inputDisplayName") or meta.get("inputOriginalName") or "a track"
    return {
        "kind": "run",
        "id": f"run:{run_id}",
        "title": f"{name} — {meta.get('modelName')}",
        "mixUrl": url("mix"),
        "vocalsUrl": url("vocals"),
        "instrumentalUrl": url("instrumental"),
        "mixAsset": "full_mix",
        "vocalsAsset": "vocals_rvc",
        "instrumentalAsset": "instrumental",
    }


def resolve_source(ref: str) -> dict | None:
    """The track behind a reference, with the URLs its audio is actually at."""
    kind, ident = parse_ref(ref)
    if not ident:
        return None
    try:
        if kind == "songgen":
            return _song_source(ident)
        if kind == "upload":
            return _upload_source(ident)
        if kind == "run":
            return _run_source(ident)
    except Exception:
        logger.exception("Could not resolve track source %s", ref)
    return None
