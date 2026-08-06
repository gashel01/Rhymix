import json
import subprocess
import time
import uuid
from datetime import datetime
from pathlib import Path

from flask import Blueprint, Response, jsonify, request, stream_with_context

from backend.features.studio.assets import (
    detect_asset_source,
    probe_audio,
    resolve_inference_asset,
    resolve_upload_assets,
)
from backend.features.song_generation.cover import transcribe_audio_path
from backend.features.studio.jobs import (
    create_job,
    run_ai_job,
    run_orchestrate_song_job,
    cancel_job,
    run_midi_export_job,
    run_render_job,
    run_stems_render_job,
    run_soulx_resing_job,
    start_job_thread,
)
from backend.features.studio.storage import (
    delete_project as delete_project_record,
    get_job,
    get_project,
    get_project_by_asset,
    list_projects,
    list_projects_by_asset,
    public_project_payload,
    save_project,
    update_project,
)
from backend.storage.inference_runs import load_inference_run_metadata
from backend.paths.manager import paths

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


def _resolve_project_asset_path(project_record: dict, asset_id: str) -> Path | None:
    assets = project_record.get("assets") if isinstance(project_record.get("assets"), dict) else {}
    asset = assets.get(asset_id) if isinstance(assets, dict) else None
    if not asset:
        return None
    raw_path = asset.get("path")
    if not raw_path:
        return None
    try:
        path = Path(raw_path)
    except Exception:
        return None
    return path if path.exists() else None


def _extract_audio_segment(source_path: Path, start_sec: float, end_sec: float) -> Path:
    paths.TEMP_WAV_DIR.mkdir(parents=True, exist_ok=True)
    safe_start = max(0.0, float(start_sec or 0.0))
    safe_end = max(0.0, float(end_sec or 0.0))
    duration = max(0.01, safe_end - safe_start)
    out_path = paths.TEMP_WAV_DIR / f"studio_transcribe_{uuid.uuid4().hex}.wav"
    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        str(safe_start),
        "-t",
        str(duration),
        "-i",
        str(source_path),
        "-ac",
        "1",
        "-ar",
        "48000",
        str(out_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0 or not out_path.exists():
        raise RuntimeError(result.stderr.strip() or "Failed to extract audio segment")
    return out_path


def _create_project_lane(project: dict, lane_type: str, name: str):
    lanes = project.get("lanes") or []
    lane = {
        "id": uuid.uuid4().hex,
        "projectId": project.get("project", {}).get("id"),
        "type": lane_type,
        "name": name,
        "sourceAssetId": None,
        "mute": False,
        "solo": False,
        "gainDb": 0.0,
        "order": len(lanes) + 1,
    }
    lanes.append(lane)
    project["lanes"] = lanes
    return lane


@bp.route("/api/studio/projects", methods=["POST"])
def create_project():
    data = request.get_json() or {}
    asset_id = str(data.get("assetId") or "").strip()
    # Always create a fresh project — do not reuse an existing one
    record = _build_project(asset_id)
    save_project(record, asset_id=asset_id or None)
    return jsonify(public_project_payload(record))


@bp.route("/api/studio/projects", methods=["GET"])
def list_all_projects():
    records = list_projects()
    return jsonify([public_project_payload(r) for r in records])


@bp.route("/api/studio/projects/by-asset/<path:asset_id>/list", methods=["GET"])
def list_projects_for_asset(asset_id):
    """Return all projects linked to the given asset, sorted newest first."""
    asset_id = asset_id or ""
    if not asset_id:
        return jsonify({"error": "assetId is required"}), 400
    records = list_projects_by_asset(asset_id)
    return jsonify([public_project_payload(r) for r in records])


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


@bp.route("/api/studio/projects/<project_id>", methods=["DELETE"])
def delete_project_route(project_id):
    """Delete a studio project by ID."""
    deleted = delete_project_record(project_id)
    if not deleted:
        return jsonify({"error": "Project not found"}), 404
    return jsonify({"deleted": True, "projectId": project_id})


@bp.route("/api/studio/projects/<project_id>", methods=["PATCH"])
def patch_project(project_id):
    data = request.get_json() or {}
    project = data.get("project")
    lanes = data.get("lanes")
    clips = data.get("clips")
    assets = data.get("assets")
    metadata = data.get("metadata")
    updated = update_project(project_id, project=project, lanes=lanes, clips=clips, assets=assets, metadata=metadata)
    if not updated:
        return jsonify({"error": "Project not found"}), 404
    return jsonify(public_project_payload(updated))


@bp.route("/api/studio/projects/<project_id>/render", methods=["POST"])
def render_project(project_id):
    job = create_job("render", project_id, {})
    start_job_thread(run_render_job, (job["id"], project_id))
    return jsonify({"jobId": job["id"]})


@bp.route("/api/studio/projects/<project_id>/render/stems", methods=["POST"])
def render_project_stems(project_id):
    job = create_job("render_stems", project_id, {})
    start_job_thread(run_stems_render_job, (job["id"], project_id))
    return jsonify({"jobId": job["id"]})


@bp.route("/api/studio/projects/<project_id>/export/midi", methods=["POST"])
def export_project_midi(project_id):
    job = create_job("export_midi", project_id, {})
    start_job_thread(run_midi_export_job, (job["id"], project_id))
    return jsonify({"jobId": job["id"]})


@bp.route("/api/studio/projects/<project_id>/reset", methods=["POST"])
def reset_project(project_id):
    existing = get_project(project_id)
    if not existing:
        return jsonify({"error": "Project not found"}), 404
    asset_id = existing.get("project", {}).get("assetId")
    if not asset_id:
        return jsonify({"error": "Project assetId is missing"}), 400
    record = _build_project(asset_id)
    record_project = record.get("project", {})
    record_project["id"] = project_id
    record_project["createdAt"] = existing.get("project", {}).get("createdAt", record_project.get("createdAt"))
    record_project["updatedAt"] = datetime.now().isoformat()
    record["project"] = record_project
    save_project(record, asset_id=asset_id)
    return jsonify(public_project_payload(record))


@bp.route("/api/studio/projects/<project_id>/jobs/<job_type>", methods=["POST"])
def start_ai_job(project_id, job_type):
    payload = request.get_json() or {}
    job = create_job(job_type, project_id, payload)
    if job_type == "resynthesize":
        start_job_thread(run_soulx_resing_job, (job["id"], project_id, payload))
    elif job_type == "orchestrate_song":
        start_job_thread(run_orchestrate_song_job, (job["id"], project_id, payload))
    else:
        start_job_thread(run_ai_job, (job["id"], project_id, job_type, payload))
    return jsonify({"jobId": job["id"]})


@bp.route("/api/studio/projects/<project_id>/foundation-voice-input", methods=["POST"])
def import_foundation_voice_input(project_id):
    project = get_project(project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404

    audio = request.files.get("audio")
    if not audio or not audio.filename:
        return jsonify({"error": "audio file is required"}), 400

    try:
        insert_sec = max(0.0, float(request.form.get("insertSec") or 0.0))
    except Exception:
        return jsonify({"error": "Invalid insertSec"}), 400

    label = str(request.form.get("label") or "Foundation Voice Input").strip() or "Foundation Voice Input"
    lane_name = str(request.form.get("laneName") or "Foundation Voice Input").strip() or "Foundation Voice Input"

    temp_dir = paths.TEMP_WAV_DIR
    temp_dir.mkdir(parents=True, exist_ok=True)
    exports_dir = paths.EXPORT_DIR
    exports_dir.mkdir(parents=True, exist_ok=True)

    raw_suffix = Path(audio.filename).suffix or ".webm"
    raw_path = temp_dir / f"foundation_voice_input_{uuid.uuid4().hex}{raw_suffix}"
    out_name = f"foundation_voice_input_{uuid.uuid4().hex}.wav"
    out_path = exports_dir / out_name

    try:
        audio.save(raw_path)
        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            str(raw_path),
            "-ac",
            "1",
            "-ar",
            "44100",
            str(out_path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if result.returncode != 0 or not out_path.exists():
            raise RuntimeError(result.stderr.strip() or "Failed to import recorded voice")

        audio_info = probe_audio(out_path)
        asset_id = f"foundation_voice:{uuid.uuid4().hex}"
        asset = {
            "id": asset_id,
            "kind": "recording",
            "label": label,
            "path": str(out_path),
            "url": f"/api/download/exports/{out_name}",
            **audio_info,
        }
        assets = project.get("assets") or {}
        assets[asset_id] = asset
        project["assets"] = assets

        lane = _create_project_lane(project, "custom", lane_name)
        clip = {
            "id": uuid.uuid4().hex,
            "laneId": lane["id"],
            "sourceAssetId": asset_id,
            "srcStartSec": 0.0,
            "srcEndSec": max(0.01, float(audio_info.get("durationSec") or 0.0)),
            "timelineStartSec": insert_sec,
            "fadeInSec": 0.0,
            "fadeOutSec": 0.0,
            "gainDb": 0.0,
        }
        clips = project.get("clips") or []
        clips.append(clip)
        project["clips"] = clips
        project_data = project.get("project") or {}
        project_data["updatedAt"] = datetime.now().isoformat()
        project["project"] = project_data

        save_project(project)
        return jsonify(
            {
                "asset": asset,
                "clip": clip,
                "lane": lane,
                "project": public_project_payload(project),
            }
        )
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    finally:
        try:
            raw_path.unlink(missing_ok=True)
        except Exception:
            pass


@bp.route("/api/studio/projects/<project_id>/transcribe", methods=["POST"])
def transcribe_studio_segment(project_id):
    data = request.get_json() or {}
    asset_id = str(data.get("assetId") or data.get("sourceAssetId") or "").strip()
    if not asset_id:
        return jsonify({"error": "assetId is required"}), 400

    project = get_project(project_id)
    if not project:
        return jsonify({"error": "Project not found"}), 404

    source_path = _resolve_project_asset_path(project, asset_id)
    if not source_path:
        return jsonify({"error": "Asset audio not found"}), 404

    start_sec = data.get("startSec")
    end_sec = data.get("endSec")
    engine = str(data.get("engine") or "whisperx").strip().lower()

    clip_path = None
    try:
        if start_sec is not None and end_sec is not None:
            try:
                start_val = float(start_sec)
                end_val = float(end_sec)
            except Exception:
                return jsonify({"error": "Invalid startSec or endSec"}), 400
            if end_val > start_val:
                clip_path = _extract_audio_segment(source_path, start_val, end_val)
        text = transcribe_audio_path(clip_path or source_path, engine=engine)
        return jsonify({"text": text})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    finally:
        if clip_path:
            try:
                clip_path.unlink(missing_ok=True)
            except Exception:
                pass


@bp.route("/api/jobs/<job_id>", methods=["GET"])
def get_job_status(job_id):
    job = get_job(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(job)


@bp.route("/api/jobs/<job_id>/cancel", methods=["POST"])
def cancel_job_route(job_id):
    job, problem = cancel_job(job_id)
    if problem == "not_found":
        return jsonify({"error": "Job not found"}), 404
    if problem == "already_finished":
        return jsonify({"error": f"Job already {job.get('status')}"}), 409
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
