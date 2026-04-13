import json
import threading
import uuid
from datetime import datetime
from pathlib import Path

from backend.paths.manager import paths

STUDIO_DIR = paths.BASE_DIR / "data" / "studio"
PROJECTS_PATH = STUDIO_DIR / "projects.json"
JOBS_PATH = STUDIO_DIR / "jobs.json"

_storage_lock = threading.Lock()


def _load_json(path: Path, default: dict) -> dict:
    if not path.exists():
        return default
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
            if isinstance(data, dict):
                return data
    except Exception:
        return default
    return default


def _save_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(".tmp")
    with tmp_path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, sort_keys=True)
    tmp_path.replace(path)


def _now_iso() -> str:
    return datetime.now().isoformat()


def load_projects_store() -> dict:
    return _load_json(PROJECTS_PATH, {"projects": {}, "byAsset": {}})


def save_projects_store(data: dict) -> None:
    _save_json(PROJECTS_PATH, data)


def load_jobs_store() -> dict:
    return _load_json(JOBS_PATH, {"jobs": {}})


def save_jobs_store(data: dict) -> None:
    _save_json(JOBS_PATH, data)


def create_project_record(asset_id: str, project: dict, lanes: list, clips: list, assets: dict, metadata: dict | None):
    project_id = uuid.uuid4().hex
    now = _now_iso()
    project_record = {
        "project": {
            "id": project_id,
            "assetId": asset_id,
            "durationSec": project.get("durationSec", 0),
            "sampleRate": project.get("sampleRate"),
            "bpm": project.get("bpm"),
            "key": project.get("key"),
            "timeSignature": project.get("timeSignature"),
            "createdAt": now,
            "updatedAt": now,
        },
        "lanes": lanes or [],
        "clips": clips or [],
        "assets": assets or {},
        "metadata": metadata or {},
    }
    return project_record


def get_project_by_asset(asset_id: str):
    with _storage_lock:
        store = load_projects_store()
        project_id = store.get("byAsset", {}).get(asset_id)
        if not project_id:
            return None
        return store.get("projects", {}).get(project_id)


def list_projects_by_asset(asset_id: str) -> list:
    """Return all projects that reference the given assetId, sorted newest first."""
    with _storage_lock:
        store = load_projects_store()
        all_projects = store.get("projects", {})
        results = [
            p for p in all_projects.values()
            if isinstance(p, dict) and p.get("project", {}).get("assetId") == asset_id
        ]
        results.sort(
            key=lambda p: p.get("project", {}).get("updatedAt") or p.get("project", {}).get("createdAt") or "",
            reverse=True,
        )
        return results


def list_projects() -> list:
    with _storage_lock:
        store = load_projects_store()
        results = [
            p for p in (store.get("projects", {}) or {}).values()
            if isinstance(p, dict) and isinstance(p.get("project"), dict)
        ]
        results.sort(
            key=lambda p: p.get("project", {}).get("updatedAt") or p.get("project", {}).get("createdAt") or "",
            reverse=True,
        )
        return results


def delete_project(project_id: str) -> bool:
    """Delete a project record and remove it from the byAsset index."""
    with _storage_lock:
        store = load_projects_store()
        projects = store.get("projects", {})
        if project_id not in projects:
            return False
        record = projects.pop(project_id)
        asset_id = record.get("project", {}).get("assetId")
        # Remove from byAsset index if it points to this project
        by_asset = store.get("byAsset", {})
        if asset_id and by_asset.get(asset_id) == project_id:
            # Point to another project for the same asset, if one exists
            alternates = [
                p_id for p_id, p in projects.items()
                if p.get("project", {}).get("assetId") == asset_id
            ]
            if alternates:
                by_asset[asset_id] = alternates[0]
            else:
                by_asset.pop(asset_id, None)
        store["projects"] = projects
        store["byAsset"] = by_asset
        save_projects_store(store)
        return True


def get_project(project_id: str):
    with _storage_lock:
        store = load_projects_store()
        return store.get("projects", {}).get(project_id)


def save_project(project_record: dict, *, asset_id: str | None = None):
    with _storage_lock:
        store = load_projects_store()
        project_id = project_record.get("project", {}).get("id")
        if not project_id:
            return None
        store.setdefault("projects", {})[project_id] = project_record
        if asset_id:
            store.setdefault("byAsset", {})[asset_id] = project_id
        save_projects_store(store)
    return project_record


def update_project(
    project_id: str,
    *,
    project: dict | None = None,
    lanes: list | None = None,
    clips: list | None = None,
    assets: dict | None = None,
    metadata: dict | None = None,
):
    with _storage_lock:
        store = load_projects_store()
        existing = store.get("projects", {}).get(project_id)
        if not existing:
            return None
        if project is not None:
            current_project = existing.get("project", {})
            current_project.update(project)
            current_project["updatedAt"] = _now_iso()
            existing["project"] = current_project
        if lanes is not None:
            existing["lanes"] = lanes
        if clips is not None:
            existing["clips"] = clips
        if assets is not None:
            existing["assets"] = assets
        if metadata is not None:
            existing["metadata"] = metadata
        store["projects"][project_id] = existing
        save_projects_store(store)
        return existing


def save_job(job: dict):
    with _storage_lock:
        store = load_jobs_store()
        job_id = job.get("id")
        if not job_id:
            return None
        store.setdefault("jobs", {})[job_id] = job
        save_jobs_store(store)
        return job


def get_job(job_id: str):
    with _storage_lock:
        store = load_jobs_store()
        return store.get("jobs", {}).get(job_id)


def update_job(job_id: str, **fields):
    with _storage_lock:
        store = load_jobs_store()
        job = store.get("jobs", {}).get(job_id)
        if not job:
            return None
        job.update(fields)
        job["updatedAt"] = _now_iso()
        store["jobs"][job_id] = job
        save_jobs_store(store)
        return job


def append_job_event(job_id: str, event: dict):
    with _storage_lock:
        store = load_jobs_store()
        job = store.get("jobs", {}).get(job_id)
        if not job:
            return None
        events = job.get("events") if isinstance(job.get("events"), list) else []
        event_payload = {"ts": _now_iso(), **event}
        events.append(event_payload)
        job["events"] = events
        job["updatedAt"] = _now_iso()
        store["jobs"][job_id] = job
        save_jobs_store(store)
        return job


def public_project_payload(project_record: dict):
    if not project_record:
        return None
    assets = project_record.get("assets") or {}
    public_assets = {}
    for asset_id, asset in assets.items():
        if not isinstance(asset, dict):
            continue
        public_asset = {k: v for k, v in asset.items() if k != "path"}
        public_assets[asset_id] = public_asset
    return {
        "project": project_record.get("project") or {},
        "lanes": project_record.get("lanes") or [],
        "clips": project_record.get("clips") or [],
        "assets": public_assets,
        "metadata": project_record.get("metadata") or {},
    }
