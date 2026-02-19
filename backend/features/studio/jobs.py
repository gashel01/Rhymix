import os
import subprocess
import threading
import uuid
from pathlib import Path

from backend.features.studio.ai_adapters import get_ai_adapter
from backend.features.studio.assets import probe_audio
from backend.features.studio.render import render_mixdown
from backend.features.studio.uvr_stems import extract_uvr_multi_stems
from backend.features.studio.storage import (
    append_job_event,
    get_project,
    save_job,
    save_project,
    update_job,
)
from backend.paths.manager import paths


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


def _replace_clip_segment(project_record: dict, payload: dict, asset_id: str, duration_sec: float) -> bool:
    if not isinstance(payload, dict):
        return False
    start_sec = payload.get("startSec") or payload.get("timelineStartSec")
    end_sec = payload.get("endSec")
    if start_sec is None or end_sec is None:
        return False
    try:
        start_sec = float(start_sec)
        end_sec = float(end_sec)
    except Exception:
        return False
    if end_sec <= start_sec:
        return False

    clips = project_record.get("clips") or []
    target_clip = None
    clip_id = payload.get("clipId")
    if clip_id:
        target_clip = next((clip for clip in clips if clip.get("id") == clip_id), None)
    if not target_clip:
        source_asset_id = payload.get("sourceAssetId") or payload.get("assetId")
        for clip in clips:
            if source_asset_id and clip.get("sourceAssetId") != source_asset_id:
                continue
            clip_start = float(clip.get("timelineStartSec") or 0.0)
            clip_len = max(
                0.01,
                float(clip.get("srcEndSec") or 0.0) - float(clip.get("srcStartSec") or 0.0),
            )
            clip_end = clip_start + clip_len
            if start_sec >= clip_start - 1e-6 and end_sec <= clip_end + 1e-6:
                target_clip = clip
                break
    if not target_clip:
        return False

    clip_start = float(target_clip.get("timelineStartSec") or 0.0)
    clip_src_start = float(target_clip.get("srcStartSec") or 0.0)
    clip_src_end = float(target_clip.get("srcEndSec") or 0.0)
    clip_len = max(0.01, clip_src_end - clip_src_start)

    local_start = max(0.0, min(clip_len, start_sec - clip_start))
    local_end = max(local_start + 0.01, min(clip_len, end_sec - clip_start))
    if local_end <= local_start:
        return False

    def _clone_clip(clip: dict, **overrides):
        base = dict(clip)
        base["id"] = uuid.uuid4().hex
        base.update(overrides)
        return base

    next_clips = [clip for clip in clips if clip is not target_clip]

    if local_start > 1e-3:
        next_clips.append(
            _clone_clip(
                target_clip,
                srcStartSec=clip_src_start,
                srcEndSec=clip_src_start + local_start,
                timelineStartSec=clip_start,
            )
        )

    if clip_len - local_end > 1e-3:
        next_clips.append(
            _clone_clip(
                target_clip,
                srcStartSec=clip_src_start + local_end,
                srcEndSec=clip_src_end,
                timelineStartSec=clip_start + local_end,
            )
        )

    resing_clip = {
        "id": uuid.uuid4().hex,
        "laneId": target_clip.get("laneId"),
        "sourceAssetId": asset_id,
        "srcStartSec": 0.0,
        "srcEndSec": max(0.01, float(duration_sec or 0.0)),
        "timelineStartSec": clip_start + local_start,
        "fadeInSec": target_clip.get("fadeInSec", 0.0),
        "fadeOutSec": target_clip.get("fadeOutSec", 0.0),
        "gainDb": target_clip.get("gainDb", 0.0),
    }
    next_clips.append(resing_clip)
    project_record["clips"] = next_clips
    return True


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


def _resolve_asset_path(project_record: dict, asset_id: str) -> Path | None:
    if not asset_id:
        return None
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


def _extract_audio_segment(source_path: Path, start_sec: float, end_sec: float, prefix: str) -> Path:
    paths.TEMP_WAV_DIR.mkdir(parents=True, exist_ok=True)
    safe_start = max(0.0, float(start_sec or 0.0))
    safe_end = max(0.0, float(end_sec or 0.0))
    duration = max(0.01, safe_end - safe_start)
    out_path = paths.TEMP_WAV_DIR / f"{prefix}_{uuid.uuid4().hex}.wav"
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
        "44100",
        str(out_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0 or not out_path.exists():
        raise RuntimeError(result.stderr.strip() or "Failed to extract audio segment")
    return out_path


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


def run_soulx_resing_job(job_id: str, project_id: str, payload: dict):
    update_job(job_id, status="running", progress=0, statusMessage="Resynthesizing vocals...")
    append_job_event(job_id, {"type": "status", "status": "running", "progress": 0})

    project_record = get_project(project_id)
    if not project_record:
        update_job(job_id, status="failed", error="Project not found", progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return

    source_asset_id = payload.get("sourceAssetId") or payload.get("assetId")
    lyrics = str(payload.get("lyrics") or "").strip()
    original_lyrics = str(payload.get("originalLyrics") or "").strip()
    if not source_asset_id:
        update_job(job_id, status="failed", error="sourceAssetId is required", progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return
    if not lyrics:
        update_job(job_id, status="failed", error="lyrics are required", progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return

    source_path = _resolve_asset_path(project_record, source_asset_id)
    if not source_path:
        update_job(job_id, status="failed", error="Source audio not found", progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return

    try:
        start_sec = float(payload.get("sourceStartSec") or payload.get("startSec") or 0.0)
        end_sec = float(payload.get("sourceEndSec") or payload.get("endSec") or 0.0)
    except Exception:
        update_job(job_id, status="failed", error="Invalid startSec or endSec", progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return
    if end_sec <= start_sec:
        update_job(job_id, status="failed", error="endSec must be greater than startSec", progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return

    segment_path = None
    try:
        segment_path = _extract_audio_segment(source_path, start_sec, end_sec, "soulx_segment")
        output_name = f"soulx_resing_{uuid.uuid4().hex}.wav"
        paths.EXPORT_DIR.mkdir(parents=True, exist_ok=True)
        output_path = paths.EXPORT_DIR / output_name

        soulx_dir = Path(os.environ.get("SOULX_SINGER_DIR") or (paths.BASE_DIR / "SoulX-Singer"))
        python_exe = Path(
            os.environ.get("SOULX_SINGER_PYTHON") or (soulx_dir / ".venv" / "Scripts" / "python.exe")
        )
        if not soulx_dir.exists():
            raise RuntimeError(f"SoulX-Singer directory not found at {soulx_dir}")
        if not python_exe.exists():
            raise RuntimeError(f"SoulX-Singer venv python not found at {python_exe}")

        language = payload.get("language") or "English"

        cmd = [
            str(python_exe),
            "-m",
            "cli.studio_resing",
            "--input_wav",
            str(segment_path),
            "--lyrics",
            lyrics,
            "--output_wav",
            str(output_path),
            "--language",
            str(language),
        ]
        if original_lyrics:
            cmd.extend(["--prompt_lyrics", original_lyrics])
        result = subprocess.run(
            cmd,
            cwd=str(soulx_dir),
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "SoulX-Singer failed")

        info = probe_audio(output_path)
        result_payload = {
            "assetId": f"soulx_resing:{uuid.uuid4().hex}",
            "assetPath": str(output_path),
            "assetUrl": f"/api/download/exports/{output_name}",
            "durationSec": info.get("durationSec", 0.0),
            "sampleRate": info.get("sampleRate"),
        }

        _record_result(project_record, "resynthesize", payload, result_payload)
        _update_project_duration(project_record)
        save_project(project_record)

        update_job(job_id, status="completed", progress=100, result={"assetId": result_payload["assetId"]})
        append_job_event(job_id, {"type": "status", "status": "completed", "progress": 100})
    except Exception as exc:
        update_job(job_id, status="failed", progress=100, error=str(exc))
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100, "error": str(exc)})
    finally:
        if segment_path:
            try:
                segment_path.unlink(missing_ok=True)
            except Exception:
                pass


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
