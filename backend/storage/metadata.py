import copy
import json
import re
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

from backend.paths.manager import paths

# ===============================
# FILENAME + METADATA HELPERS
# ===============================

UPLOAD_METADATA_PATH = paths.METADATA_DIR / "uploads.json"

processing_metadata_lock = threading.Lock()

_metadata_cache_lock = threading.Lock()
_metadata_cache = {"data": None, "mtime": None, "expires": 0.0}
_METADATA_CACHE_TTL = 0.5


def sanitize_filename_for_display(filename: str) -> str:
    """Sanitize filename for UI display without breaking unicode."""
    if not filename:
        return "unnamed_file"
    base = Path(filename).name
    cleaned = re.sub(r"[\x00-\x1f\x7f]", "", base).strip()
    return cleaned or "unnamed_file"


def make_storage_name(original_name: str, file_id: str = None) -> tuple[str, str]:
    """Create a safe storage name using a UUID plus the original extension."""
    file_id = file_id or uuid.uuid4().hex
    ext = Path(original_name).suffix.lower()
    if not re.match(r"^\.[a-z0-9]{1,10}$", ext):
        ext = ""
    return f"{file_id}{ext}", file_id


def _load_metadata_file(path: Path) -> dict:
    if not path.exists():
        return {"files": {}}

    now = time.time()
    try:
        mtime = path.stat().st_mtime
    except FileNotFoundError:
        return {"files": {}}

    with _metadata_cache_lock:
        if (
            _metadata_cache["data"] is not None
            and now < _metadata_cache["expires"]
            and _metadata_cache["mtime"] == mtime
        ):
            return copy.deepcopy(_metadata_cache["data"])

    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict) and "files" in data:
            with _metadata_cache_lock:
                _metadata_cache["data"] = data
                _metadata_cache["mtime"] = mtime
                _metadata_cache["expires"] = now + _METADATA_CACHE_TTL
            return copy.deepcopy(data)
    except Exception:
        pass
    return {"files": {}}


def _save_metadata_file(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(".tmp")
    with tmp_path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, sort_keys=True)
    tmp_path.replace(path)

    try:
        mtime = path.stat().st_mtime
    except FileNotFoundError:
        mtime = None

    with _metadata_cache_lock:
        _metadata_cache["data"] = data
        _metadata_cache["mtime"] = mtime
        _metadata_cache["expires"] = time.time() + _METADATA_CACHE_TTL


def register_upload_metadata(original_name: str, stored_name: str, file_id: str, internal: bool = False) -> dict:
    display_name = sanitize_filename_for_display(original_name)
    created_at = datetime.now().isoformat()
    record = {
        "fileId": file_id,
        "originalName": Path(original_name).name,
        "storedName": stored_name,
        "safeDisplayName": display_name,
        "createdAt": created_at,
        # The song pipeline registers its own generated audio as an upload so
        # the separation pipeline (built to work on uploads) can find it —
        # not a real import, so /api/uploads hides it.
        "internal": internal,
    }
    with processing_metadata_lock:
        data = _load_metadata_file(UPLOAD_METADATA_PATH)
        data.setdefault("files", {})[file_id] = record
        _save_metadata_file(UPLOAD_METADATA_PATH, data)
    return record


def unregister_upload_metadata(file_id: str) -> bool:
    """Forget an upload record. True when one was actually removed.

    The song pipeline registers its own output as an upload so the separation
    code can find it, then deletes the file — without this the record outlived
    the audio forever. One library had 107 of them and no real imports.
    """
    with processing_metadata_lock:
        data = _load_metadata_file(UPLOAD_METADATA_PATH)
        files = data.get("files", {})
        if file_id not in files:
            return False
        files.pop(file_id)
        _save_metadata_file(UPLOAD_METADATA_PATH, data)
        return True


def get_upload_metadata(file_id: str):
    data = _load_metadata_file(UPLOAD_METADATA_PATH)
    return data.get("files", {}).get(file_id)


def list_upload_metadata() -> list[dict]:
    data = _load_metadata_file(UPLOAD_METADATA_PATH)
    return list(data.get("files", {}).values())


def _processing_state_rank(state: str | None) -> int:
    ranks = {
        "queued": 0,
        "uploading": 1,
        "processing": 2,
        "ready": 3,
        "error": 3,
    }
    return ranks.get(str(state or "").lower(), 2)


def _parse_iso_timestamp(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).timestamp()
    except Exception:
        return None


def _should_apply_processing_update(current: dict | None, incoming: dict) -> bool:
    if not current:
        return True
    curr_state = (current.get("state") or "ready").lower()
    next_state = (incoming.get("state") or curr_state).lower()

    # Do not allow regression from terminal states
    if curr_state in {"ready", "error"} and next_state != curr_state:
        return False

    curr_rank = _processing_state_rank(curr_state)
    next_rank = _processing_state_rank(next_state)
    if next_rank < curr_rank:
        return False

    if next_rank == curr_rank:
        curr_ts = _parse_iso_timestamp(current.get("updatedAt"))
        next_ts = _parse_iso_timestamp(incoming.get("updatedAt"))
        if curr_ts is not None and next_ts is not None and next_ts <= curr_ts:
            return False

    return True


def _normalize_progress_value(progress):
    if isinstance(progress, float):
        if 0 <= progress <= 1:
            return int(progress * 100)
        return int(progress)
    if isinstance(progress, int):
        return progress
    if isinstance(progress, str) and progress.isdigit():
        return int(progress)
    return None


def update_track_processing(
    file_id: str,
    *,
    state: str | None = None,
    step: str | None = None,
    message: str | None = None,
    progress=None,
    extra: dict | None = None,
) -> dict | None:
    now_iso = datetime.now().isoformat()
    with processing_metadata_lock:
        data = _load_metadata_file(UPLOAD_METADATA_PATH)
        record = data.get("files", {}).get(file_id)
        if not record:
            return None
        current = record.get("processing") if isinstance(record.get("processing"), dict) else {}
        next_processing = dict(current)

        if state:
            next_processing["state"] = state
        if step is not None:
            next_processing["step"] = step
        if message is not None:
            next_processing["message"] = message
        if progress is not None:
            normalized = _normalize_progress_value(progress)
            if normalized is not None:
                next_processing["progress"] = normalized
        if extra:
            next_processing.update(extra)

        if "state" in next_processing and not next_processing.get("step"):
            next_processing["step"] = next_processing["state"]
        if "state" in next_processing and next_processing.get("message") is None:
            next_processing["message"] = next_processing.get("step") or next_processing["state"]

        next_processing["updatedAt"] = now_iso

        if next_processing == current:
            return current
        if not _should_apply_processing_update(current, next_processing):
            return current

        record["processing"] = next_processing
        data.setdefault("files", {})[file_id] = record
        _save_metadata_file(UPLOAD_METADATA_PATH, data)
        return next_processing


def get_upload_base_name(file_id: str):
    record = get_upload_metadata(file_id)
    if not record:
        return None
    return Path(record["storedName"]).stem


__all__ = [
    "UPLOAD_METADATA_PATH",
    "processing_metadata_lock",
    "sanitize_filename_for_display",
    "make_storage_name",
    "register_upload_metadata",
    "get_upload_metadata",
    "list_upload_metadata",
    "update_track_processing",
    "get_upload_base_name",
    "_load_metadata_file",
    "_save_metadata_file",
    "_normalize_progress_value",
]
