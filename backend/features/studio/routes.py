import json
import time
import uuid

from flask import Blueprint, Response, jsonify, request, stream_with_context

from backend.features.studio.assets import detect_asset_source, resolve_inference_asset, resolve_upload_assets
from backend.features.studio.jobs import create_job, run_ai_job, run_render_job, start_job_thread
from backend.features.studio.storage import (
    get_job,
    get_project,
    get_project_by_asset,
    public_project_payload,
    save_project,
    update_project,
)
from backend.storage.inference_runs import load_inference_run_metadata

bp = Blueprint("studio", __name__)


def _default_lanes(project_id: str):
    return [
        {
            "id": uuid.uuid4().hex,
            "projectId": project_id,
            "type": "mix",
            "name": "Mix",
            "sourceAssetId": None,
            "mute": False,
            "solo": False,
            "gainDb": 0.0,
            "order": 1,
        },
        {
            "id": uuid.uuid4().hex,
            "projectId": project_id,
            "type": "vocal",
            "name": "Vocals",
            "sourceAssetId": None,
            "mute": False,
            "solo": False,
            "gainDb": 0.0,
            "order": 2,
        },
        {
            "id": uuid.uuid4().hex,
            "projectId": project_id,
            "type": "instrumental",
            "name": "Instrumental",
            "sourceAssetId": None,
            "mute": False,
            "solo": False,
            "gainDb": 0.0,
            "order": 3,
        },
        {
            "id": uuid.uuid4().hex,
            "projectId": project_id,
            "type": "stem",
            "name": "Stems",
            "sourceAssetId": None,
            "mute": False,
            "solo": False,
            "gainDb": 0.0,
            "order": 4,
        },
        {
            "id": uuid.uuid4().hex,
            "projectId": project_id,
            "type": "generated",
            "name": "Generated Layers",
            "sourceAssetId": None,
            "mute": False,
            "solo": False,
            "gainDb": 0.0,
            "order": 5,
        },
    ]


def _lane_by_type(lanes, lane_type):
    return next((lane for lane in lanes if lane.get("type") == lane_type), None)


def _add_clip(clips, lane_id, asset_id, duration):
    clips.append(
        {
            "id": uuid.uuid4().hex,
            "laneId": lane_id,
            "sourceAssetId": asset_id,
            "srcStartSec": 0.0,
            "srcEndSec": max(0.01, float(duration or 0.0)),
            "timelineStartSec": 0.0,
            "fadeInSec": 0.0,
            "fadeOutSec": 0.0,
            "gainDb": 0.0,
        }
    )


def _build_project(asset_id: str):
    project_id = uuid.uuid4().hex
    lanes = _default_lanes(project_id)
    clips = []
    assets = {}
    sample_rate = None

    source = detect_asset_source(asset_id)
    if source and source[0] == "inference":
        run_id = source[1]
        inference_asset = resolve_inference_asset(run_id)
        if inference_asset:
            assets[inference_asset["id"]] = inference_asset
            sample_rate = inference_asset.get("sampleRate") or sample_rate
        run_meta = load_inference_run_metadata(run_id) or {}
        file_id = run_meta.get("inputFileId") or run_meta.get("fileId")
        if file_id:
            upload_assets = resolve_upload_assets(file_id)
            assets.update(upload_assets)
    elif source and source[0] == "upload":
        file_id = source[1]
        upload_assets = resolve_upload_assets(file_id)
        assets.update(upload_assets)
    else:
        upload_assets = resolve_upload_assets(asset_id)
        assets.update(upload_assets)
        if not upload_assets:
            inference_asset = resolve_inference_asset(asset_id)
            if inference_asset:
                assets[inference_asset["id"]] = inference_asset

    if assets:
        for asset in assets.values():
            kind = asset.get("kind")
            if kind == "instrumental":
                lane = _lane_by_type(lanes, "instrumental")
            elif kind == "vocal":
                lane = _lane_by_type(lanes, "vocal")
            elif kind == "inference":
                lane = _lane_by_type(lanes, "mix")
            else:
                lane = _lane_by_type(lanes, "mix")
            _add_clip(clips, lane["id"], asset["id"], asset.get("durationSec", 0.0))
            sample_rate = asset.get("sampleRate") or sample_rate

    duration = 0.0
    for clip in clips:
        duration = max(duration, float(clip.get("srcEndSec") or 0.0))

    from datetime import datetime
    now_iso = datetime.now().isoformat()
    project = {
        "id": project_id,
        "assetId": asset_id,
        "durationSec": duration,
        "sampleRate": sample_rate,
        "bpm": None,
        "key": None,
        "timeSignature": None,
        "createdAt": now_iso,
        "updatedAt": now_iso,
    }

    return {
        "project": project,
        "lanes": lanes,
        "clips": clips,
        "assets": assets,
        "metadata": {},
    }


@bp.route("/api/studio/projects", methods=["POST"])
def create_project():
    data = request.get_json() or {}
    asset_id = str(data.get("assetId") or "").strip()
    if not asset_id:
        return jsonify({"error": "assetId is required"}), 400
    existing = get_project_by_asset(asset_id)
    if existing:
        return jsonify(public_project_payload(existing))
    record = _build_project(asset_id)
    save_project(record, asset_id=asset_id)
    return jsonify(public_project_payload(record))


@bp.route("/api/studio/projects/by-asset/<path:asset_id>", methods=["GET"])
def get_project_by_asset_id(asset_id):
    asset_id = asset_id or ""
    existing = get_project_by_asset(asset_id)
    if existing:
        return jsonify(public_project_payload(existing))
    record = _build_project(asset_id)
    save_project(record, asset_id=asset_id)
    return jsonify(public_project_payload(record))


@bp.route("/api/studio/projects/<project_id>", methods=["GET"])
def get_project_by_id(project_id):
    project = get_project(project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404
    return jsonify(public_project_payload(project))


@bp.route("/api/studio/projects/<project_id>", methods=["PATCH"])
def patch_project(project_id):
    data = request.get_json() or {}
    project = data.get("project")
    lanes = data.get("lanes")
    clips = data.get("clips")
    metadata = data.get("metadata")
    updated = update_project(project_id, project=project, lanes=lanes, clips=clips, metadata=metadata)
    if not updated:
        return jsonify({"error": "Project not found"}), 404
    return jsonify(public_project_payload(updated))


@bp.route("/api/studio/projects/<project_id>/render", methods=["POST"])
def render_project(project_id):
    job = create_job("render", project_id, {})
    start_job_thread(run_render_job, (job["id"], project_id))
    return jsonify({"jobId": job["id"]})


@bp.route("/api/studio/projects/<project_id>/jobs/<job_type>", methods=["POST"])
def start_ai_job(project_id, job_type):
    payload = request.get_json() or {}
    job = create_job(job_type, project_id, payload)
    start_job_thread(run_ai_job, (job["id"], project_id, job_type, payload))
    return jsonify({"jobId": job["id"]})


@bp.route("/api/jobs/<job_id>", methods=["GET"])
def get_job_status(job_id):
    job = get_job(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(job)


@bp.route("/api/jobs/<job_id>/events", methods=["GET"])
def stream_job_events(job_id):
    job = get_job(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404

    def event_stream():
        last_index = 0
        while True:
            current = get_job(job_id)
            if not current:
                break
            events = current.get("events") if isinstance(current.get("events"), list) else []
            while last_index < len(events):
                payload = json.dumps(events[last_index])
                yield f"data: {payload}\n\n"
                last_index += 1
            if current.get("status") in {"completed", "failed"} and last_index >= len(events):
                break
            time.sleep(0.5)

    return Response(stream_with_context(event_stream()), mimetype="text/event-stream")
