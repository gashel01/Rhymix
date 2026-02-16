import threading
import uuid

from backend.features.studio.ai_adapters import get_ai_adapter
from backend.features.studio.render import render_mixdown
from backend.features.studio.uvr_stems import extract_uvr_multi_stems
from backend.features.studio.storage import (
    append_job_event,
    get_project,
    save_job,
    save_project,
    update_job,
)


def _now_iso():
    from datetime import datetime

    return datetime.now().isoformat()


def create_job(job_type: str, project_id: str, payload: dict | None = None):
    job_id = uuid.uuid4().hex
    job = {
        "id": job_id,
        "type": job_type,
        "projectId": project_id,
        "status": "queued",
        "progress": 0,
        "payload": payload or {},
        "createdAt": _now_iso(),
        "updatedAt": _now_iso(),
        "events": [],
        "error": None,
        "result": None,
    }
    save_job(job)
    append_job_event(job_id, {"type": "status", "status": "queued", "progress": 0})
    return job


def _ensure_lane(project_record: dict, lane_type: str, name: str):
    lanes = project_record.get("lanes") or []
    existing = next((lane for lane in lanes if lane.get("type") == lane_type), None)
    if existing:
        return existing
    lane = {
        "id": uuid.uuid4().hex,
        "projectId": project_record.get("project", {}).get("id"),
        "type": lane_type,
        "name": name,
        "sourceAssetId": None,
        "mute": False,
        "solo": False,
        "gainDb": 0.0,
        "order": len(lanes) + 1,
    }
    lanes.append(lane)
    project_record["lanes"] = lanes
    return lane


def _create_lane(project_record: dict, lane_type: str, name: str, source_asset_id: str | None = None):
    lanes = project_record.get("lanes") or []
    lane = {
        "id": uuid.uuid4().hex,
        "projectId": project_record.get("project", {}).get("id"),
        "type": lane_type,
        "name": name,
        "sourceAssetId": source_asset_id,
        "mute": False,
        "solo": False,
        "gainDb": 0.0,
        "order": len(lanes) + 1,
    }
    lanes.append(lane)
    project_record["lanes"] = lanes
    return lane


def _append_clip(project_record: dict, lane_id: str, asset_id: str, start_sec: float, duration_sec: float):
    clip = {
        "id": uuid.uuid4().hex,
        "laneId": lane_id,
        "sourceAssetId": asset_id,
        "srcStartSec": 0.0,
        "srcEndSec": max(0.01, float(duration_sec or 0.0)),
        "timelineStartSec": max(0.0, float(start_sec or 0.0)),
        "fadeInSec": 0.0,
        "fadeOutSec": 0.0,
        "gainDb": 0.0,
    }
    clips = project_record.get("clips") or []
    clips.append(clip)
    project_record["clips"] = clips
    return clip


def _update_project_duration(project_record: dict):
    clips = project_record.get("clips") or []
    duration = 0.0
    for clip in clips:
        end = float(clip.get("timelineStartSec") or 0.0) + float(clip.get("srcEndSec") or 0.0)
        duration = max(duration, end)
    project = project_record.get("project") or {}
    project["durationSec"] = duration
    project["updatedAt"] = _now_iso()
    project_record["project"] = project


def _register_asset(project_record: dict, asset: dict):
    assets = project_record.get("assets") or {}
    assets[asset["id"]] = asset
    project_record["assets"] = assets
    return asset["id"]


def _record_stem_result(project_record: dict, payload: dict, result: dict):
    stems = result.get("stems") if isinstance(result, dict) else None
    if not stems:
        return
    source_asset_id = payload.get("sourceAssetId") if isinstance(payload, dict) else None
    for stem in stems:
        if not isinstance(stem, dict):
            continue
        asset_id = stem.get("assetId") or uuid.uuid4().hex
        label = stem.get("label") or stem.get("trackName") or "Stem"
        asset = {
            "id": asset_id,
            "kind": "stem",
            "label": label,
            "url": stem.get("assetUrl"),
            "path": stem.get("assetPath"),
            "durationSec": stem.get("durationSec", 0.0),
            "sampleRate": stem.get("sampleRate"),
        }
        _register_asset(project_record, asset)
        lane_name = str(label)
        lane = _create_lane(project_record, "stem", lane_name, source_asset_id=source_asset_id)
        _append_clip(project_record, lane["id"], asset_id, 0.0, asset.get("durationSec", 0.0))


def _record_result(project_record: dict, job_type: str, payload: dict, result: dict):
    if job_type in {"understand", "lrc", "quality_score"}:
        metadata = project_record.get("metadata") or {}
        metadata[job_type] = result
        project_record["metadata"] = metadata
        return
    if job_type in {"stem_extract", "stem_extract_uvr"}:
        _record_stem_result(project_record, payload, result)
        return

    asset_id = result.get("assetId") or uuid.uuid4().hex
    asset = {
        "id": asset_id,
        "kind": "generated",
        "label": job_type.replace("_", " ").title(),
        "url": result.get("assetUrl"),
        "path": result.get("assetPath"),
        "durationSec": result.get("durationSec", 0.0),
        "sampleRate": result.get("sampleRate"),
    }
    _register_asset(project_record, asset)

    lane = _ensure_lane(project_record, "generated", "Generated Layers")
    start_sec = payload.get("startSec") or payload.get("timelineStartSec") or 0.0
    _append_clip(project_record, lane["id"], asset_id, start_sec, asset.get("durationSec", 0.0))


def run_render_job(job_id: str, project_id: str):
    update_job(job_id, status="running", progress=0, statusMessage="Rendering mixdown...")
    append_job_event(job_id, {"type": "status", "status": "running", "progress": 0})

    project_record = get_project(project_id)
    if not project_record:
        update_job(job_id, status="failed", error="Project not found", progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return

    try:
        output = render_mixdown(project_record)
        asset_id = f"render:{job_id}"
        asset = {
            "id": asset_id,
            "kind": "derived",
            "label": "Render Mixdown",
            "path": output.get("path"),
            "url": output.get("url"),
            "durationSec": output.get("durationSec", 0.0),
            "sampleRate": output.get("sampleRate"),
        }
        _register_asset(project_record, asset)
        lane = _ensure_lane(project_record, "generated", "Generated Layers")
        _append_clip(project_record, lane["id"], asset_id, 0.0, asset.get("durationSec", 0.0))
        _update_project_duration(project_record)
        save_project(project_record)

        update_job(job_id, status="completed", progress=100, result={"assetId": asset_id})
        append_job_event(job_id, {"type": "status", "status": "completed", "progress": 100})
    except Exception as exc:
        update_job(job_id, status="failed", progress=100, error=str(exc))
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100, "error": str(exc)})


def run_ai_job(job_id: str, project_id: str, job_type: str, payload: dict):
    update_job(job_id, status="running", progress=0, statusMessage="Running AI job...")
    append_job_event(job_id, {"type": "status", "status": "running", "progress": 0})

    project_record = get_project(project_id)
    if not project_record:
        update_job(job_id, status="failed", error="Project not found", progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return

    adapter = get_ai_adapter()
    try:
        assets = project_record.get("assets") if isinstance(project_record.get("assets"), dict) else {}
        if isinstance(payload, dict):
            source_id = payload.get("sourceAssetId")
            if source_id and assets.get(source_id) and assets[source_id].get("path"):
                payload["sourceAssetPath"] = assets[source_id]["path"]
            ref_id = payload.get("referenceAssetId")
            if ref_id and assets.get(ref_id) and assets[ref_id].get("path"):
                payload["referenceAssetPath"] = assets[ref_id]["path"]
            if job_type == "cover" and not payload.get("referenceAssetPath"):
                if source_id and assets.get(source_id) and assets[source_id].get("path"):
                    payload["referenceAssetPath"] = assets[source_id]["path"]

        if job_type == "repaint":
            result = adapter.repaint(payload)
        elif job_type == "add_layer":
            result = adapter.add_layer(payload)
        elif job_type == "replace_section":
            result = adapter.repaint(payload)
        elif job_type == "extend":
            result = adapter.repaint(payload)
        elif job_type == "cover":
            result = adapter.cover(payload)
        elif job_type == "vocal2bgm":
            result = adapter.vocal2bgm(payload)
        elif job_type == "stem_extract":
            result = adapter.stem_extract(payload)
        elif job_type == "stem_extract_uvr":
            source_path = payload.get("sourceAssetPath") if isinstance(payload, dict) else None
            stem_names = payload.get("stemNames") if isinstance(payload, dict) else None
            result = {"stems": extract_uvr_multi_stems(source_path, stem_names)}
        elif job_type == "understand":
            result = adapter.understand(payload)
        elif job_type == "lrc":
            result = adapter.lrc(payload)
        elif job_type == "quality_score":
            result = adapter.quality_score(payload)
        else:
            raise RuntimeError(f"Unknown job type: {job_type}")

        if isinstance(result, dict):
            _record_result(project_record, job_type, payload, result)
            _update_project_duration(project_record)
            save_project(project_record)

        update_job(job_id, status="completed", progress=100, result=result)
        append_job_event(job_id, {"type": "status", "status": "completed", "progress": 100})
    except Exception as exc:
        update_job(job_id, status="failed", progress=100, error=str(exc))
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100, "error": str(exc)})


def start_job_thread(target, args):
    thread = threading.Thread(target=target, args=args, daemon=True)
    thread.start()
    return thread
