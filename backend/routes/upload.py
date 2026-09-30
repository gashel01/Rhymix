import logging
import time
import shutil
from datetime import datetime
from pathlib import Path

from flask import Blueprint, jsonify, request

from backend.paths.manager import paths
from backend.storage.metadata import (
    make_storage_name,
    register_upload_metadata,
    list_upload_metadata,
    get_upload_base_name,
    processing_metadata_lock,
    _load_metadata_file,
    _save_metadata_file,
)

bp = Blueprint("upload", __name__)


@bp.route("/api/upload", methods=["POST"])
def upload_files():
    try:
        files = request.files.getlist("file") + request.files.getlist("files")
        files = [f for f in files if f and f.filename]
        if not files:
            return jsonify({"error": "No files provided"}), 400

        records = []
        for f in files:
            stored_name, file_id = make_storage_name(f.filename)
            path = paths.INPUT_DIR / stored_name
            f.save(path)
            record = register_upload_metadata(f.filename, stored_name, file_id)
            records.append(record)
            logging.info(f"Saved file: {path}")
            # An import deserves a picture like anything else in the library.
            # Imported lazily and swallowed on failure: cover art is optional,
            # and an import must not fail because diffusers is missing.
            try:
                from backend.features.cover_art.routes import render_upload_cover_async

                render_upload_cover_async(
                    file_id, record.get("safeDisplayName") or f.filename
                )
            except Exception:
                logging.exception("Could not start cover art for %s", file_id)

        return jsonify(
            {
                "message": f"Successfully uploaded {len(records)} files",
                "files": records,
            }
        )

    except Exception as e:
        logging.info(f"Upload error: {e}")
        return jsonify({"error": str(e)}), 500


@bp.route("/api/available-files")
def get_available_files():
    try:
        if not paths.UVR_PROCESSED_DIR.exists():
            paths.UVR_PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

        paths.INSTRUMENTAL_DIR.mkdir(parents=True, exist_ok=True)
        pairs = []
        for record in list_upload_metadata():
            base_name = Path(record["storedName"]).stem
            processed_vocals = paths.UVR_PROCESSED_DIR / f"{base_name}_vocals.wav"
            raw_vocals = paths.UVR_RAW_DIR / f"{base_name}_vocals.wav"
            instrumental = paths.INSTRUMENTAL_DIR / f"{base_name}_instrumental.wav"

            processing = record.get("processing") if isinstance(record.get("processing"), dict) else None
            has_outputs = processed_vocals.exists() or raw_vocals.exists() or instrumental.exists()
            processing_state = (processing or {}).get("state")
            is_processing = processing_state not in (None, "ready", "error")
            if not has_outputs and not is_processing:
                continue
            processed_timestamp = None
            if has_outputs:
                processed_timestamp = datetime.fromtimestamp(
                    max(
                        (processed_vocals.stat().st_mtime if processed_vocals.exists() else 0),
                        (raw_vocals.stat().st_mtime if raw_vocals.exists() else 0),
                        (instrumental.stat().st_mtime if instrumental.exists() else 0),
                    )
                ).strftime("%Y-%m-%d %H:%M:%S")

            pairs.append(
                {
                    "fileId": record["fileId"],
                    "originalName": record["originalName"],
                    "safeDisplayName": record["safeDisplayName"],
                    "storedName": record["storedName"],
                    "createdAt": record["createdAt"],
                    "vocalUrlProcessed": f"/api/download/processed_vocals/{record['fileId']}"
                    if processed_vocals.exists()
                    else None,
                    "vocalUrlRaw": f"/api/download/raw_vocals/{record['fileId']}"
                    if raw_vocals.exists()
                    else None,
                    "instrumentalUrl": f"/api/download/instrumental/{record['fileId']}"
                    if instrumental.exists()
                    else None,
                    "vocalPathProcessed": processed_vocals.name if processed_vocals.exists() else None,
                    "vocalPathRaw": raw_vocals.name if raw_vocals.exists() else None,
                    "instrumentalPath": instrumental.name if instrumental.exists() else None,
                    "dateProcessed": processed_timestamp,
                    "processing": processing,
                }
            )

        return jsonify({"files": pairs, "message": f"Found {len(pairs)} processed files"})
    except Exception as e:
        logging.error(f"Error getting available files: {e}")
        import traceback

        traceback.print_exc()
        return jsonify({"files": [], "error": str(e)})


@bp.route("/api/tracks/status", methods=["GET"])
def get_track_statuses():
    try:
        raw_ids = request.args.get("ids", "")
        ids = [v.strip() for v in raw_ids.split(",") if v.strip()]
        data = _load_metadata_file(paths.METADATA_DIR / "uploads.json")
        files = data.get("files", {})
        results = []
        for track_id in ids:
            record = files.get(track_id)
            processing = record.get("processing") if isinstance(record, dict) else None
            results.append({"trackId": track_id, "processing": processing})
        return jsonify(results)
    except Exception as e:
        logging.error(f"Error getting track statuses: {e}")
        import traceback

        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@bp.route("/api/delete-files", methods=["POST"])
def delete_files():
    try:
        d = request.json or {}
        fns = d.get("filenames")
        if fns is None:
            return jsonify({"error": "No filenames provided"}), 400
        if not isinstance(fns, list):
            return jsonify({"error": "Filenames must be a list"}), 400

        results = []
        logging.info(f"Deleting files for {len(fns)} tracks...")
        to_remove = []

        for fn in fns:
            base = get_upload_base_name(fn)
            if not base:
                results.append(
                    {"track": None, "deleted": [], "failed": [{"filename": fn, "error": "Unknown fileId"}]}
                )
                continue

            logging.info(f"Processing track: {base}")
            deleted, failed = [], []
            for p, t in [
                (paths.UVR_RAW_DIR / f"{base}_vocals.wav", "raw vocals"),
                (paths.UVR_PROCESSED_DIR / f"{base}_vocals.wav", "processed vocals"),
                (paths.INSTRUMENTAL_DIR / f"{base}_instrumental.wav", "instrumental"),
            ]:
                try:
                    if p.exists():
                        time.sleep(0.1)
                        p.unlink(missing_ok=True)
                        deleted.append(f"{t}: {p.name}")
                        logging.info(f"  [DELETED] {t}: {p.name}")
                    else:
                        logging.info(f"  [WARNING] File not found: {p}")
                except Exception as e:
                    msg = f"Failed to delete {t}: {e}"
                    failed.append(msg)
                    logging.info(f"  [ERROR] {msg}")

            if deleted or failed:
                results.append({"track": base, "deleted": deleted, "failed": failed})
                to_remove.append(fn)

        if to_remove:
            with processing_metadata_lock:
                data = _load_metadata_file(paths.METADATA_DIR / "uploads.json")
                for fn in to_remove:
                    data.get("files", {}).pop(fn, None)
                _save_metadata_file(paths.METADATA_DIR / "uploads.json", data)

        return jsonify(
            {
                "message": f"Processed {len(fns)} tracks",
                "results": results,
                "total_deleted": sum(len(r.get("deleted", [])) for r in results),
                "total_failed": sum(len(r.get("failed", [])) for r in results),
            }
        )

    except Exception as e:
        logging.error(f"Error in delete_files: {e}")
        import traceback

        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# The library's view of an upload.
#
# /api/available-files deliberately hides anything without separated stems — it
# was written for the processing screen, where an unprocessed file is not yet
# work. The library has the opposite need: a track you just imported has to
# appear immediately, stems or not, or importing looks like it failed.
# ---------------------------------------------------------------------------


def _upload_audio_path(file_id: str) -> Path | None:
    """The original file as uploaded, by its id."""
    for record in list_upload_metadata():
        if record.get("fileId") != file_id:
            continue
        stored = record.get("storedName")
        if not stored:
            return None
        candidate = paths.INPUT_DIR / stored
        return candidate if candidate.exists() else None
    return None


def _upload_cover_url(file_id: str) -> str | None:
    """Where an import's cover lives, or None. Imported here to keep the
    cover feature optional — the library still lists without it."""
    try:
        from backend.features.cover_art.routes import upload_cover_url

        return upload_cover_url(file_id)
    except Exception:
        return None


@bp.route("/api/uploads")
def list_uploads():
    """Every imported track, processed or not, newest first."""
    items = []
    for record in list_upload_metadata():
        if record.get("internal"):
            continue
        file_id = record.get("fileId")
        stored = record.get("storedName")
        if not file_id or not stored:
            continue
        base = Path(stored).stem
        original = paths.INPUT_DIR / stored
        vocals = paths.UVR_PROCESSED_DIR / f"{base}_vocals.wav"
        if not vocals.exists():
            vocals = paths.UVR_RAW_DIR / f"{base}_vocals.wav"
        instrumental = paths.INSTRUMENTAL_DIR / f"{base}_instrumental.wav"

        items.append(
            {
                "fileId": file_id,
                "name": record.get("safeDisplayName") or record.get("originalName") or stored,
                "originalName": record.get("originalName"),
                "createdAt": record.get("createdAt"),
                "hasAudio": original.exists(),
                "coverUrl": _upload_cover_url(file_id),
                "audioUrl": f"/api/uploads/{file_id}/audio" if original.exists() else None,
                "vocalsUrl": f"/api/uploads/{file_id}/audio/vocals" if vocals.exists() else None,
                "instrumentalUrl": (
                    f"/api/uploads/{file_id}/audio/instrumental" if instrumental.exists() else None
                ),
                "processing": record.get("processing"),
            }
        )

    items.sort(key=lambda item: str(item.get("createdAt") or ""), reverse=True)
    return jsonify({"uploads": items})


_UPLOAD_STEMS = {
    "vocals": (lambda base: paths.UVR_PROCESSED_DIR / f"{base}_vocals.wav",
               lambda base: paths.UVR_RAW_DIR / f"{base}_vocals.wav"),
    "instrumental": (lambda base: paths.INSTRUMENTAL_DIR / f"{base}_instrumental.wav",),
}


def _upload_stem_path(file_id: str, kind: str) -> Path | None:
    record = next((r for r in list_upload_metadata() if r.get("fileId") == file_id), None)
    if not record or not record.get("storedName"):
        return None
    base = Path(record["storedName"]).stem
    for build in _UPLOAD_STEMS.get(kind, ()):
        candidate = build(base)
        if candidate.exists():
            return candidate
    return None


@bp.route("/api/uploads/<file_id>", methods=["DELETE"])
def delete_upload(file_id):
    """Remove an import and everything made from it.

    /api/delete-files only ever removed stems, and only updated the metadata
    when stems existed — so deleting a freshly imported track that had never
    been separated did nothing at all, and the row came back on the next
    refresh. This removes the audio, whatever was separated out of it, its
    cover, and the record, which is what "delete" means in the library.
    """
    record = next((r for r in list_upload_metadata() if r.get("fileId") == file_id), None)
    if not record or not record.get("storedName"):
        return jsonify({"error": "Import not found"}), 404

    stored = record["storedName"]
    base = Path(stored).stem
    removed = []
    targets = [
        paths.INPUT_DIR / stored,
        paths.UVR_RAW_DIR / f"{base}_vocals.wav",
        paths.UVR_PROCESSED_DIR / f"{base}_vocals.wav",
        paths.INSTRUMENTAL_DIR / f"{base}_instrumental.wav",
    ]
    try:
        from backend.features.cover_art.routes import upload_cover_path

        targets.append(upload_cover_path(file_id))
    except Exception:
        pass

    for path in targets:
        try:
            if path.exists():
                path.unlink()
                removed.append(path.name)
        except Exception:
            logging.exception("Could not delete %s", path)

    from backend.storage.metadata import unregister_upload_metadata

    unregister_upload_metadata(file_id)
    return jsonify({"deleted": removed})


@bp.route("/api/uploads/<file_id>/audio")
def get_upload_audio(file_id):
    from flask import send_file

    path = _upload_audio_path(file_id)
    if not path:
        return jsonify({"error": "Upload not found"}), 404
    return send_file(path, mimetype="audio/wav")


@bp.route("/api/uploads/<file_id>/audio/<kind>")
def get_upload_stem(file_id, kind):
    from flask import send_file

    if kind not in _UPLOAD_STEMS:
        return jsonify({"error": f"Unknown stem: {kind}"}), 404
    path = _upload_stem_path(file_id, kind)
    if not path:
        return jsonify({"error": "Stem not available"}), 404
    return send_file(path, mimetype="audio/wav")


@bp.route("/api/uploads/<file_id>/waveform")
@bp.route("/api/uploads/<file_id>/waveform/<kind>")
def get_upload_waveform(file_id, kind=None):
    """Peaks for an import, so it draws like anything else in the library."""
    from backend.routes.waveform import _peaks_payload

    path = _upload_stem_path(file_id, kind) if kind else _upload_audio_path(file_id)
    if not path:
        return jsonify({"error": "Audio not found"}), 404
    try:
        return jsonify(_peaks_payload(path))
    except Exception:
        logging.exception("Could not compute peaks for upload %s", file_id)
        return jsonify({"error": "Could not compute waveform"}), 500
