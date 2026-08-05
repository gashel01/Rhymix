import os
import subprocess
import threading
import uuid
from pathlib import Path

from backend.features.studio.ai_adapters import get_ai_adapter
from backend.features.studio.assets import probe_audio, resolve_asset_path
from backend.features.studio.foundation_one import run_foundation_studio_job
from backend.features.studio.render import render_mixdown
from backend.features.studio.stage_drums import run_stage_drums_job
from backend.features.studio.uvr_stems import extract_uvr_multi_stems
from backend.features.studio.storage import (
    append_job_event,
    get_project,
    save_job,
    save_project,
    update_job,
)
from backend.paths.manager import paths

ORCHESTRATOR_FX_PRESETS = {
    "clean": {},
    "wide_pop": {
        "chorus": {"enabled": True, "rate": 0.7, "depth": 0.01, "mix": 0.22},
        "reverb": {"enabled": True, "decay": 2.2, "mix": 0.18},
    },
    "dream_wash": {
        "reverb": {"enabled": True, "decay": 5.5, "mix": 0.35},
        "chorus": {"enabled": True, "rate": 0.4, "depth": 0.018, "mix": 0.28},
        "lowpass": {"enabled": True, "cutoff": 9800},
    },
    "echo_trail": {
        "echo": {"enabled": True, "time": 0.32, "feedback": 0.38, "mix": 0.22},
        "reverb": {"enabled": True, "decay": 2.8, "mix": 0.16},
    },
    "grit_drive": {
        "distortion": {"enabled": True, "drive": 24},
        "lowpass": {"enabled": True, "cutoff": 9000},
    },
    "dark_filter": {
        "lowpass": {"enabled": True, "cutoff": 3600},
        "reverb": {"enabled": True, "decay": 2.0, "mix": 0.12},
    },
    "chorus_shimmer": {
        "chorus": {"enabled": True, "rate": 1.1, "depth": 0.014, "mix": 0.32},
        "reverb": {"enabled": True, "decay": 3.2, "mix": 0.2},
    },
}


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


def _create_lane(
    project_record: dict,
    lane_type: str,
    name: str,
    source_asset_id: str | None = None,
    *,
    muted: bool = False,
):
    lanes = project_record.get("lanes") or []
    lane = {
        "id": uuid.uuid4().hex,
        "projectId": project_record.get("project", {}).get("id"),
        "type": lane_type,
        "name": name,
        "sourceAssetId": source_asset_id,
        "mute": bool(muted),
        "solo": False,
        "gainDb": 0.0,
        "order": len(lanes) + 1,
    }
    lanes.append(lane)
    project_record["lanes"] = lanes
    return lane


def _get_lane_by_id(project_record: dict, lane_id: str | None):
    if not lane_id:
        return None
    for lane in project_record.get("lanes") or []:
        if lane.get("id") == lane_id:
            return lane
    return None


def _should_skip_missing_target_lane(payload: dict | None) -> bool:
    return bool(isinstance(payload, dict) and payload.get("skipIfTargetLaneMissing"))


def _reload_project_for_async_write(project_id: str, fallback_record: dict) -> dict:
    latest = get_project(project_id)
    if not isinstance(latest, dict):
        return fallback_record
    return latest


def _apply_orchestrator_project_settings(project_record: dict, global_plan: dict):
    project = project_record.get("project") or {}
    project["bpm"] = global_plan["bpm"]
    project["key"] = _format_key_signature(global_plan["keyNote"], global_plan["scale"])
    project_record["project"] = project


def _apply_lane_fx_preset(project_record: dict, lane_id: str, preset_name: str | None):
    lane = _get_lane_by_id(project_record, lane_id)
    if not lane:
        return
    preset_key = str(preset_name or "clean").strip() or "clean"
    preset = ORCHESTRATOR_FX_PRESETS.get(preset_key, ORCHESTRATOR_FX_PRESETS["clean"])
    lane["fx"] = dict(preset)


def _format_key_signature(key_note: str | None, scale: str | None):
    note = str(key_note or "").strip() or "C"
    mode = str(scale or "").strip().lower() or "major"
    if mode not in {"major", "minor"}:
        mode = "major"
    return f"{note} {mode}"


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


def _ticks_to_sec(ticks: float, bpm: float | None, ppq: float | None):
    safe_bpm = float(bpm or 120.0)
    safe_ppq = float(ppq or 480.0)
    ticks_per_sec = (safe_bpm * safe_ppq) / 60.0
    if ticks_per_sec <= 0:
        return 0.0
    return float(ticks or 0.0) / ticks_per_sec


def _append_midi_clip(project_record: dict, lane_id: str, midi_clip: dict, start_sec: float):
    resolved_bpm = float(midi_clip.get("bpm") or project_record.get("project", {}).get("bpm") or 120.0)
    resolved_ppq = float(midi_clip.get("ppq") or 480.0)
    notes = midi_clip.get("notes") if isinstance(midi_clip.get("notes"), list) else []
    max_tick = 0
    for note in notes:
        if not isinstance(note, dict):
            continue
        end_tick = int(note.get("startTick") or 0) + int(note.get("durationTick") or 0)
        max_tick = max(max_tick, end_tick)

    duration_sec = max(0.01, _ticks_to_sec(max_tick, resolved_bpm, resolved_ppq))
    clip = {
        "id": uuid.uuid4().hex,
        "laneId": lane_id,
        "sourceAssetId": None,
        "srcStartSec": 0.0,
        "srcEndSec": duration_sec,
        "timelineStartSec": max(0.0, float(start_sec or 0.0)),
        "fadeInSec": 0.0,
        "fadeOutSec": 0.0,
        "gainDb": 0.0,
        "clipType": "midi",
        "midi": midi_clip,
        "label": midi_clip.get("instrument") or "MIDI Clip",
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


def _resolve_audio_clip_candidates(project_record: dict, payload: dict):
    clips = project_record.get("clips") or []
    selected_ids = {
        str(item)
        for item in (payload.get("clipIds") or [])
        if str(item).strip()
    }
    if selected_ids:
        resolved = [
            clip for clip in clips
            if clip.get("id") in selected_ids and clip.get("clipType") != "midi" and clip.get("sourceAssetId")
        ]
        if resolved:
            return resolved

    lane_ids = {
        str(item)
        for item in (payload.get("laneIds") or [])
        if str(item).strip()
    }
    try:
        range_start = float(payload.get("startSec")) if payload.get("startSec") is not None else None
        range_end = float(payload.get("endSec")) if payload.get("endSec") is not None else None
    except Exception:
        range_start = None
        range_end = None
    if range_start is not None and range_end is not None:
        range_start, range_end = min(range_start, range_end), max(range_start, range_end)
        resolved = []
        for clip in clips:
            if clip.get("clipType") == "midi" or not clip.get("sourceAssetId"):
                continue
            if lane_ids and clip.get("laneId") not in lane_ids:
                continue
            clip_start = float(clip.get("timelineStartSec") or 0.0)
            clip_len = max(
                0.01,
                float(clip.get("srcEndSec") or 0.0) - float(clip.get("srcStartSec") or 0.0),
            )
            clip_end = clip_start + clip_len
            if range_end > clip_start and range_start < clip_end:
                resolved.append(clip)
        if resolved:
            return resolved

    source_asset_id = payload.get("sourceAssetId")
    if source_asset_id:
        return [
            clip for clip in clips
            if clip.get("clipType") != "midi" and clip.get("sourceAssetId") == source_asset_id
        ]
    return []


def _render_stage_conditioning_mix(project_record: dict, payload: dict) -> tuple[Path, float, float]:
    candidate_clips = _resolve_audio_clip_candidates(project_record, payload)
    if not candidate_clips:
        raise RuntimeError("Select one or more audio clips or a timeline range before generating drums")

    try:
        range_start = float(payload.get("startSec")) if payload.get("startSec") is not None else None
        range_end = float(payload.get("endSec")) if payload.get("endSec") is not None else None
    except Exception:
        range_start = None
        range_end = None

    if range_start is None or range_end is None or range_end <= range_start:
        starts = []
        ends = []
        for clip in candidate_clips:
            clip_start = float(clip.get("timelineStartSec") or 0.0)
            clip_len = max(0.01, float(clip.get("srcEndSec") or 0.0) - float(clip.get("srcStartSec") or 0.0))
            starts.append(clip_start)
            ends.append(clip_start + clip_len)
        if not starts or not ends:
            raise RuntimeError("Selected clips do not have a valid audio duration")
        range_start = min(starts)
        range_end = max(ends)
    else:
        range_start, range_end = min(range_start, range_end), max(range_start, range_end)

    lanes = project_record.get("lanes") or []
    lane_gain = {lane.get("id"): float(lane.get("gainDb") or 0.0) for lane in lanes}
    assets = project_record.get("assets") if isinstance(project_record.get("assets"), dict) else {}

    inputs = []
    filters = []
    labels = []

    for _idx, clip in enumerate(candidate_clips):
        asset = assets.get(clip.get("sourceAssetId")) if isinstance(assets, dict) else None
        asset_path = asset.get("path") if isinstance(asset, dict) else None
        if not asset_path:
            continue
        path = Path(asset_path)
        if not path.exists():
            continue

        clip_start = float(clip.get("timelineStartSec") or 0.0)
        clip_src_start = float(clip.get("srcStartSec") or 0.0)
        clip_src_end = float(clip.get("srcEndSec") or 0.0)
        clip_len = max(0.01, clip_src_end - clip_src_start)
        clip_end = clip_start + clip_len
        overlap_start = max(range_start, clip_start)
        overlap_end = min(range_end, clip_end)
        if overlap_end <= overlap_start:
            continue

        trim_start = clip_src_start + (overlap_start - clip_start)
        trim_end = clip_src_start + (overlap_end - clip_start)
        delay_ms = int(max(0.0, overlap_start - range_start) * 1000)
        gain = 10 ** ((lane_gain.get(clip.get("laneId"), 0.0) + float(clip.get("gainDb") or 0.0)) / 20.0)
        input_index = len(inputs)
        label = f"sc{input_index}"

        inputs.append(str(path))
        labels.append(label)

        filter_parts = [f"[{input_index}:a]atrim=start={trim_start:.6f}:end={trim_end:.6f}", "asetpts=PTS-STARTPTS"]
        if gain != 1.0:
            filter_parts.append(f"volume={gain:.8f}")
        if delay_ms > 0:
            filter_parts.append(f"adelay={delay_ms}")
        filters.append(f"{','.join(part for part in filter_parts if part)}[{label}]")

    if not inputs or not labels:
        raise RuntimeError("No valid audio sources found for STAGE conditioning")

    mix_label = "stage_mix"
    if len(labels) == 1:
        filters.append(f"[{labels[0]}]anull[{mix_label}]")
    else:
        joined = "".join(f"[{label}]" for label in labels)
        filters.append(f"{joined}amix=inputs={len(labels)}:normalize=0:dropout_transition=0[{mix_label}]")

    output_path = paths.TEMP_WAV_DIR / f"stage_context_{uuid.uuid4().hex}.wav"
    paths.TEMP_WAV_DIR.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-y"]
    for inp in inputs:
        cmd += ["-i", inp]
    cmd += [
        "-filter_complex",
        ";".join(part for part in filters if part),
        "-map",
        f"[{mix_label}]",
        "-ac",
        "1",
        "-ar",
        "32000",
        str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", check=False)
    if result.returncode != 0 or not output_path.exists():
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "Failed to render STAGE conditioning mix")
    return output_path, range_start, range_end


def _resolve_foundation_audio_lane(project_record: dict, payload: dict, label: str, variant_index: int, variant_total: int):
    target_lane_id = payload.get("targetAudioLaneId") if isinstance(payload, dict) else None
    target_lane = _get_lane_by_id(project_record, target_lane_id)
    if target_lane:
        return target_lane
    if target_lane_id and _should_skip_missing_target_lane(payload):
        return None
    lane_name = f"{label} Audio"
    if variant_total > 1:
        lane_name = f"{lane_name} {variant_index + 1}"
    return _create_lane(project_record, "generated", lane_name)


def _resolve_foundation_midi_lane(project_record: dict, payload: dict, label: str, variant_index: int, variant_total: int):
    target_lane_id = payload.get("targetMidiLaneId") if isinstance(payload, dict) else None
    target_lane = _get_lane_by_id(project_record, target_lane_id)
    if target_lane:
        return target_lane
    if target_lane_id and _should_skip_missing_target_lane(payload):
        return None
    name = f"{label} MIDI"
    if variant_total > 1:
        name = f"{label} MIDI {variant_index + 1}"
    return _create_lane(project_record, "midi", name, muted=True)


def _record_foundation_result(project_record: dict, payload: dict, result: dict):
    commit_mode = str(payload.get("commitMode") or "both").strip().lower()
    commit_audio = commit_mode in {"both", "audio"}
    commit_midi = commit_mode in {"both", "midi"}
    start_sec = float(payload.get("timelineStartSec") or payload.get("insertSec") or 0.0)
    pair_group_id = uuid.uuid4().hex
    variants = result.get("variants") if isinstance(result.get("variants"), list) else []
    variant_total = max(1, len(variants))
    project = project_record.get("project") or {}
    metadata = project_record.get("metadata") or {}
    foundation_runs = metadata.get("foundationOne") if isinstance(metadata.get("foundationOne"), list) else []
    if payload.get("applyProjectTempo") and not project.get("bpm") and result.get("bpm"):
        project["bpm"] = result.get("bpm")
    if payload.get("applyProjectTempo") and not project.get("key") and result.get("key"):
        project["key"] = result.get("key")

    inserted_count = 0
    for index, variant in enumerate(variants):
        if not isinstance(variant, dict):
            continue
        label = str(variant.get("label") or "Foundation").strip() or "Foundation"
        pair_id = uuid.uuid4().hex
        asset_id = None

        if commit_audio and variant.get("audioPath"):
            lane = _resolve_foundation_audio_lane(project_record, payload, label, index, variant_total)
            if lane is not None:
                asset_id = variant.get("assetId") or f"foundation:{uuid.uuid4().hex}"
                asset = {
                    "id": asset_id,
                    "kind": "generated",
                    "label": label,
                    "url": variant.get("audioUrl"),
                    "path": variant.get("audioPath"),
                    "durationSec": variant.get("durationSec", 0.0),
                    "sampleRate": variant.get("sampleRate"),
                    "source": "foundation_one",
                    "pairId": pair_id,
                }
                _register_asset(project_record, asset)
                clip = _append_clip(project_record, lane["id"], asset_id, start_sec, asset.get("durationSec", 0.0))
                clip["foundationPairId"] = pair_id
                clip["foundationGroupId"] = pair_group_id
                clip["foundationMode"] = result.get("mode")
                inserted_count += 1

        midi_data = variant.get("midiData") if isinstance(variant.get("midiData"), dict) else None
        if commit_midi and midi_data:
            if not project.get("bpm") and midi_data.get("bpm"):
                project["bpm"] = midi_data.get("bpm")
            lane = _resolve_foundation_midi_lane(project_record, payload, label, index, variant_total)
            if lane is not None:
                midi_clip = {
                    **midi_data,
                    "instrument": midi_data.get("instrument") or variant.get("instrumentFamily") or "Foundation MIDI",
                    "source": "foundation_one",
                    "pairId": pair_id,
                }
                clip = _append_midi_clip(project_record, lane["id"], midi_clip, start_sec)
                clip["foundationPairId"] = pair_id
                clip["foundationGroupId"] = pair_group_id
                clip["foundationMode"] = result.get("mode")
                inserted_count += 1

        foundation_runs.append(
            {
                "pairId": pair_id,
                "groupId": pair_group_id,
                "mode": result.get("mode"),
                "label": label,
                "prompt": result.get("prompt") or payload.get("prompt"),
                "bars": result.get("bars") or payload.get("bars"),
                "bpm": variant.get("bpm") or result.get("bpm") or payload.get("bpm"),
                "key": variant.get("key") or result.get("key") or payload.get("key"),
                "instrumentFamily": variant.get("instrumentFamily") or payload.get("instrumentFamily"),
                "styleTags": variant.get("styleTags") or payload.get("styleTags") or [],
                "fxTags": variant.get("fxTags") or payload.get("fxTags") or [],
                "audioAssetId": asset_id,
                "hasMidi": bool(midi_data),
                "sourceAssetId": payload.get("sourceAssetId"),
            }
        )

    metadata["foundationOne"] = foundation_runs[-24:]
    project_record["metadata"] = metadata
    project_record["project"] = project
    return inserted_count


def _record_stage_result(project_record: dict, payload: dict, result: dict):
    start_sec = float(payload.get("timelineStartSec") or payload.get("insertSec") or 0.0)
    variants = result.get("variants") if isinstance(result.get("variants"), list) else []
    if not variants:
        return

    project = project_record.get("project") or {}
    metadata = project_record.get("metadata") or {}
    stage_runs = metadata.get("stageDrums") if isinstance(metadata.get("stageDrums"), list) else []

    inserted_count = 0
    for index, variant in enumerate(variants):
        if not isinstance(variant, dict) or not variant.get("audioPath"):
            continue
        label = str(variant.get("label") or "STAGE Drums").strip() or "STAGE Drums"
        if len(variants) > 1:
            label = f"{label} {index + 1}"
        target_lane_id = payload.get("targetLaneId") if isinstance(payload, dict) else None
        lane = _get_lane_by_id(project_record, target_lane_id)
        if not lane:
            if target_lane_id and _should_skip_missing_target_lane(payload):
                continue
            lane = _create_lane(project_record, "generated", label)
        asset_id = variant.get("assetId") or f"stage:{uuid.uuid4().hex}"
        asset = {
            "id": asset_id,
            "kind": "generated",
            "label": label,
            "url": variant.get("audioUrl"),
            "path": variant.get("audioPath"),
            "durationSec": variant.get("durationSec", 0.0),
            "sampleRate": variant.get("sampleRate"),
            "source": "stage",
        }
        _register_asset(project_record, asset)
        clip = _append_clip(project_record, lane["id"], asset_id, start_sec, asset.get("durationSec", 0.0))
        clip["stageMode"] = result.get("mode") or "drums"
        inserted_count += 1
        stage_runs.append(
            {
                "assetId": asset_id,
                "label": label,
                "prompt": result.get("prompt") or payload.get("prompt"),
                "bpm": result.get("bpm") or payload.get("bpm"),
                "startSec": start_sec,
                "durationSec": variant.get("durationSec", 0.0),
                "sourceClipIds": payload.get("clipIds") or [],
            }
        )

    metadata["stageDrums"] = stage_runs[-24:]
    project_record["metadata"] = metadata
    project_record["project"] = project
    return inserted_count


def _append_job_progress(job_id: str, *, progress: int, status_message: str, stage: str, current_step_label: str | None = None, completed_steps: list | None = None, total_steps: int | None = None):
    update_job(job_id, status="running", progress=progress, statusMessage=status_message)
    append_job_event(
        job_id,
        {
            "type": "status",
            "status": "running",
            "progress": progress,
            "statusMessage": status_message,
            "stage": stage,
            "currentStepLabel": current_step_label,
            "completedSteps": completed_steps or [],
            "totalSteps": total_steps or 0,
        },
    )


def _append_project_updated(job_id: str, *, progress: int, stage: str, current_step_label: str | None = None, completed_steps: list | None = None, total_steps: int | None = None):
    append_job_event(
        job_id,
        {
            "type": "project_updated",
            "progress": progress,
            "stage": stage,
            "currentStepLabel": current_step_label,
            "completedSteps": completed_steps or [],
            "totalSteps": total_steps or 0,
        },
    )


def _normalize_orchestrator_plan(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise RuntimeError("orchestrate_song payload must be an object")
    plan = payload.get("plan")
    if not isinstance(plan, dict):
        raise RuntimeError("orchestrate_song requires a `plan` object")
    global_plan = plan.get("global")
    roles = plan.get("roles")
    sections = plan.get("sections")
    if not isinstance(global_plan, dict) or not isinstance(roles, list) or not isinstance(sections, list):
        raise RuntimeError("orchestrate_song plan must include `global`, `roles`, and `sections`")

    normalized_roles = []
    role_ids = set()
    for index, role in enumerate(roles):
        if not isinstance(role, dict):
            raise RuntimeError("Invalid role in orchestrator plan")
        role_id = str(role.get("id") or f"role_{index + 1}").strip()
        if not role_id:
            raise RuntimeError("Each orchestrator role needs an id")
        if role_id in role_ids:
            raise RuntimeError(f"Duplicate orchestrator role id `{role_id}`")
        role_ids.add(role_id)
        instrument_family = str(role.get("instrumentFamily") or "").strip()
        if not instrument_family:
            raise RuntimeError(f"Role `{role_id}` is missing an instrumentFamily")
        fx_preset = str(role.get("fxPreset") or "clean").strip() or "clean"
        if fx_preset not in ORCHESTRATOR_FX_PRESETS:
            raise RuntimeError(f"Unsupported FX preset `{fx_preset}` in orchestrator plan")
        base_prompt = str(role.get("basePrompt") or "").strip()
        if not base_prompt:
            raise RuntimeError(f"Role `{role_id}` is missing a basePrompt")
        normalized_roles.append(
            {
                "id": role_id,
                "laneName": str(role.get("laneName") or instrument_family).strip() or instrument_family,
                "instrumentFamily": instrument_family,
                "basePrompt": base_prompt,
                "styleTags": str(role.get("styleTags") or "").strip(),
                "fxTags": str(role.get("fxTags") or "").strip(),
                "fxPreset": fx_preset,
            }
        )

    normalized_sections = []
    enabled_total_bars = 0
    for index, section in enumerate(sections):
        if not isinstance(section, dict):
            raise RuntimeError("Invalid section in orchestrator plan")
        bars = int(section.get("bars") or 0)
        if bars not in {4, 8}:
            raise RuntimeError("Each orchestrator section must be 4 or 8 bars")
        section_id = str(section.get("id") or f"section_{index + 1}").strip() or f"section_{index + 1}"
        steps = section.get("steps")
        if not isinstance(steps, list) or not steps:
            raise RuntimeError(f"Section `{section_id}` must include at least one step")
        normalized_steps = []
        for step_index, step in enumerate(steps):
            if not isinstance(step, dict):
                raise RuntimeError(f"Invalid step in section `{section_id}`")
            role_id = str(step.get("roleId") or "").strip()
            if role_id not in role_ids:
                raise RuntimeError(f"Section `{section_id}` references unknown role `{role_id}`")
            normalized_steps.append(
                {
                    "id": str(step.get("id") or f"{section_id}_step_{step_index + 1}").strip() or f"{section_id}_step_{step_index + 1}",
                    "roleId": role_id,
                    "enabled": False if step.get("enabled") is False else True,
                    "prompt": str(step.get("prompt") or "").strip(),
                    "styleTags": str(step.get("styleTags") or "").strip(),
                    "fxTags": str(step.get("fxTags") or "").strip(),
                }
            )
        enabled = False if section.get("enabled") is False else True
        if enabled:
            enabled_total_bars += bars
        normalized_sections.append(
            {
                "id": section_id,
                "label": str(section.get("label") or f"Section {index + 1}").strip() or f"Section {index + 1}",
                "bars": bars,
                "enabled": enabled,
                "steps": normalized_steps,
            }
        )
        if enabled and not any(step["enabled"] for step in normalized_steps):
            raise RuntimeError(f"Enabled section `{section_id}` must include at least one enabled step")

    total_bars = max(4, int(global_plan.get("totalBars") or enabled_total_bars or 16))
    if enabled_total_bars != total_bars:
        raise RuntimeError("Enabled orchestrator sections must sum exactly to the requested total bars")

    return {
        "global": {
            "bpm": max(40, min(240, int(global_plan.get("bpm") or 120))),
            "keyNote": str(global_plan.get("keyNote") or "C").strip() or "C",
            "scale": "minor" if str(global_plan.get("scale") or "major").strip().lower() == "minor" else "major",
            "totalBars": total_bars,
            "drumPrompt": str(global_plan.get("drumPrompt") or "").strip() or "Punchy modern pop drums, clean kick, crisp snare, energetic hats",
        },
        "roles": normalized_roles,
        "sections": normalized_sections,
    }


def _bars_to_seconds(bars: int, bpm: float) -> float:
    safe_bpm = max(40.0, float(bpm or 120.0))
    return float(bars or 0) * 4.0 * 60.0 / safe_bpm


def run_orchestrate_song_job(job_id: str, project_id: str, payload: dict):
    _append_job_progress(job_id, progress=0, status_message="Planning orchestration...", stage="plan")

    project_record = get_project(project_id)
    if not project_record:
        update_job(job_id, status="failed", error="Project not found", progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100, "error": "Project not found"})
        return

    stage_conditioning_path = None
    try:
        plan = _normalize_orchestrator_plan(payload)
        insert_sec = max(0.0, float(payload.get("insertSec") or 0.0))
        global_plan = plan["global"]
        _apply_orchestrator_project_settings(project_record, global_plan)

        role_lane_map = {}
        generated_audio_lane_ids = []
        generated_midi_lane_ids = []
        for role in plan["roles"]:
            audio_lane = _create_lane(project_record, "generated", f"AI · {role['laneName']}")
            midi_lane = _create_lane(project_record, "midi", f"AI · {role['laneName']} MIDI", muted=True)
            _apply_lane_fx_preset(project_record, audio_lane["id"], role.get("fxPreset"))
            role_lane_map[role["id"]] = {
                "audioLaneId": audio_lane["id"],
                "midiLaneId": midi_lane["id"],
                "audioLaneName": audio_lane["name"],
            }
            generated_audio_lane_ids.append(audio_lane["id"])
            generated_midi_lane_ids.append(midi_lane["id"])

        section_cursor = insert_sec
        completed_steps = []
        enabled_sections = [section for section in plan["sections"] if section.get("enabled")]
        execution_steps = [
            f"{section['label']} · {next((role['laneName'] for role in plan['roles'] if role['id'] == step['roleId']), step['roleId'])}"
            for section in enabled_sections
            for step in section.get("steps", [])
            if step.get("enabled", True)
        ]
        execution_steps.extend(f"{section['label']} · Drums" for section in enabled_sections)
        total_steps = max(1, len(execution_steps))

        _append_job_progress(
            job_id,
            progress=5,
            status_message="Creating role lanes...",
            stage="prepare",
            completed_steps=completed_steps,
            total_steps=total_steps,
        )
        _update_project_duration(project_record)
        save_project(project_record)
        _append_project_updated(
            job_id,
            progress=5,
            stage="prepare",
            completed_steps=completed_steps,
            total_steps=total_steps,
        )

        for section in enabled_sections:
            section_start_sec = section_cursor
            section_duration_sec = _bars_to_seconds(section["bars"], global_plan["bpm"])
            for step in section.get("steps", []):
                if step.get("enabled") is False:
                    continue
                role = next((item for item in plan["roles"] if item["id"] == step["roleId"]), None)
                if not role:
                    continue
                step_label = f"{section['label']} · {role['laneName']}"
                current_progress = min(94, 5 + int((len(completed_steps) / total_steps) * 85))
                _append_job_progress(
                    job_id,
                    progress=current_progress,
                    status_message=f"Generating {step_label}...",
                    stage="foundation",
                    current_step_label=step_label,
                    completed_steps=completed_steps,
                    total_steps=total_steps,
                )
                foundation_payload = {
                    "prompt": step.get("prompt") or role.get("basePrompt"),
                    "bars": section["bars"],
                    "bpm": global_plan["bpm"],
                    "key": _format_key_signature(global_plan["keyNote"], global_plan["scale"]),
                    "instrumentFamily": role.get("instrumentFamily"),
                    "styleTags": step.get("styleTags") or role.get("styleTags"),
                    "fxTags": step.get("fxTags") or role.get("fxTags"),
                    "variantCount": 1,
                    "commitMode": "both",
                    "timelineStartSec": section_start_sec,
                    "insertSec": section_start_sec,
                    "targetAudioLaneId": role_lane_map[role["id"]]["audioLaneId"],
                    "targetMidiLaneId": role_lane_map[role["id"]]["midiLaneId"],
                    "skipIfTargetLaneMissing": True,
                }
                result = run_foundation_studio_job("generate", foundation_payload)
                project_record = _reload_project_for_async_write(project_id, project_record)
                _apply_orchestrator_project_settings(project_record, global_plan)
                _record_foundation_result(project_record, foundation_payload, result)
                completed_steps.append(step_label)
                save_project(project_record)
                _append_project_updated(
                    job_id,
                    progress=min(94, 5 + int((len(completed_steps) / total_steps) * 85)),
                    stage="foundation",
                    current_step_label=step_label,
                    completed_steps=completed_steps,
                    total_steps=total_steps,
                )
            section_cursor += section_duration_sec

        drums_lane = _create_lane(project_record, "generated", "AI · Drums")
        section_cursor = insert_sec
        for section in enabled_sections:
            section_start_sec = section_cursor
            section_duration_sec = _bars_to_seconds(section["bars"], global_plan["bpm"])
            section_end_sec = section_start_sec + section_duration_sec
            drum_step_label = f"{section['label']} · Drums"
            project_record = _reload_project_for_async_write(project_id, project_record)
            _apply_orchestrator_project_settings(project_record, global_plan)
            current_progress = min(97, 5 + int((len(completed_steps) / total_steps) * 85))
            _append_job_progress(
                job_id,
                progress=current_progress,
                status_message=f"Preparing drums for {section['label']}...",
                stage="drums_prepare",
                current_step_label=drum_step_label,
                completed_steps=completed_steps,
                total_steps=total_steps,
            )
            stage_conditioning_path, _mix_start, _mix_end = _render_stage_conditioning_mix(
                project_record,
                {
                    "laneIds": generated_audio_lane_ids,
                    "startSec": section_start_sec,
                    "endSec": section_end_sec,
                },
            )
            stage_payload = {
                "conditioningAudioPath": str(stage_conditioning_path),
                "timelineStartSec": section_start_sec,
                "insertSec": section_start_sec,
                "durationSec": max(0.5, section_end_sec - section_start_sec),
                "prompt": global_plan["drumPrompt"],
                "bpm": global_plan["bpm"],
                "label": "AI Drums",
                "targetLaneId": drums_lane["id"],
                "skipIfTargetLaneMissing": True,
            }
            _append_job_progress(
                job_id,
                progress=min(98, current_progress + 1),
                status_message=f"Generating drums for {section['label']}...",
                stage="drums",
                current_step_label=drum_step_label,
                completed_steps=completed_steps,
                total_steps=total_steps,
            )
            stage_result = run_stage_drums_job(stage_payload)
            project_record = _reload_project_for_async_write(project_id, project_record)
            _apply_orchestrator_project_settings(project_record, global_plan)
            _record_stage_result(project_record, stage_payload, stage_result)
            completed_steps.append(drum_step_label)
            _update_project_duration(project_record)
            save_project(project_record)
            _append_project_updated(
                job_id,
                progress=min(99, 5 + int((len(completed_steps) / total_steps) * 90)),
                stage="drums",
                current_step_label=drum_step_label,
                completed_steps=completed_steps,
                total_steps=total_steps,
            )
            try:
                Path(stage_conditioning_path).unlink(missing_ok=True)
            except Exception:
                pass
            stage_conditioning_path = None
            section_cursor += section_duration_sec

        _update_project_duration(project_record)
        save_project(project_record)
        _append_project_updated(
            job_id,
            progress=99,
            stage="drums",
            current_step_label=completed_steps[-1] if completed_steps else None,
            completed_steps=completed_steps,
            total_steps=total_steps,
        )
        result = {
            "insertSec": insert_sec,
            "totalBars": global_plan["totalBars"],
            "audioLaneIds": generated_audio_lane_ids + [drums_lane["id"]],
            "midiLaneIds": generated_midi_lane_ids,
            "completedSteps": completed_steps,
        }
        update_job(job_id, status="completed", progress=100, result=result, statusMessage="Song orchestration completed.")
        append_job_event(
            job_id,
            {
                "type": "status",
                "status": "completed",
                "progress": 100,
                "statusMessage": "Song orchestration completed.",
                "stage": "completed",
                "completedSteps": completed_steps,
                "totalSteps": total_steps,
                "result": result,
            },
        )
    except Exception as exc:
        update_job(job_id, status="failed", progress=100, error=str(exc))
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100, "error": str(exc)})
    finally:
        if stage_conditioning_path:
            try:
                Path(stage_conditioning_path).unlink(missing_ok=True)
            except Exception:
                pass


def _asset_source_path(assets: dict, asset_id):
    """String form of resolve_asset_path, for payloads sent to the AI bridge."""
    resolved = resolve_asset_path(assets, asset_id)
    return str(resolved) if resolved else None


def _record_result(project_record: dict, job_type: str, payload: dict, result: dict):
    if job_type in {"understand", "lrc", "quality_score"}:
        metadata = project_record.get("metadata") or {}
        metadata[job_type] = result
        project_record["metadata"] = metadata
        if job_type == "understand":
            project = project_record.get("project") or {}
            if result.get("bpm") is not None:
                project["bpm"] = result.get("bpm")
            if result.get("key"):
                project["key"] = result.get("key")
            if result.get("timeSignature"):
                project["timeSignature"] = result.get("timeSignature")
            project_record["project"] = project
        return
    if job_type in {"stem_extract", "stem_extract_uvr"}:
        _record_stem_result(project_record, payload, result)
        return
    if job_type in {"foundation_generate", "foundation_restyle", "foundation_extend"}:
        _record_foundation_result(project_record, payload, result)
        return
    if job_type == "stage_drums_generate":
        _record_stage_result(project_record, payload, result)
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
        project_record = _reload_project_for_async_write(project_id, project_record)
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

        project_record = _reload_project_for_async_write(project_id, project_record)
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

    stage_conditioning_path = None
    try:
        assets = project_record.get("assets") if isinstance(project_record.get("assets"), dict) else {}
        if isinstance(payload, dict):
            source_id = payload.get("sourceAssetId")
            source_path = _asset_source_path(assets, source_id)
            if source_path:
                payload["sourceAssetPath"] = source_path
            ref_id = payload.get("referenceAssetId")
            ref_path = _asset_source_path(assets, ref_id)
            if ref_path:
                payload["referenceAssetPath"] = ref_path
            if job_type == "cover" and not payload.get("referenceAssetPath") and source_path:
                payload["referenceAssetPath"] = source_path

        adapter = None
        if job_type in {
            "repaint",
            "add_layer",
            "replace_section",
            "extend",
            "cover",
            "vocal2bgm",
            "stem_extract",
            "understand",
            "lrc",
            "quality_score",
        }:
            adapter = get_ai_adapter()

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
        elif job_type == "foundation_generate":
            update_job(job_id, statusMessage="Running Foundation-1 generate...")
            result = run_foundation_studio_job("generate", payload)
        elif job_type == "foundation_restyle":
            update_job(job_id, statusMessage="Running Foundation-1 restyle...")
            result = run_foundation_studio_job("restyle", payload)
        elif job_type == "foundation_extend":
            update_job(job_id, statusMessage="Running Foundation-1 extend...")
            result = run_foundation_studio_job("extend", payload)
        elif job_type == "stage_drums_generate":
            update_job(job_id, statusMessage="Preparing STAGE conditioning mix...")
            stage_conditioning_path, mix_start, mix_end = _render_stage_conditioning_mix(project_record, payload)
            payload["conditioningAudioPath"] = str(stage_conditioning_path)
            payload["timelineStartSec"] = float(payload.get("timelineStartSec") or payload.get("insertSec") or mix_start)
            payload["insertSec"] = float(payload.get("insertSec") or mix_start)
            payload["durationSec"] = max(0.5, float(payload.get("durationSec") or (mix_end - mix_start)))
            update_job(job_id, statusMessage="Running STAGE drums...")
            result = run_stage_drums_job(payload)
        else:
            raise RuntimeError(f"Unknown job type: {job_type}")

        if isinstance(result, dict):
            project_record = _reload_project_for_async_write(project_id, project_record)
            _record_result(project_record, job_type, payload, result)
            _update_project_duration(project_record)
            save_project(project_record)

        update_job(job_id, status="completed", progress=100, result=result)
        append_job_event(job_id, {"type": "status", "status": "completed", "progress": 100})
    except Exception as exc:
        update_job(job_id, status="failed", progress=100, error=str(exc))
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100, "error": str(exc)})
    finally:
        if stage_conditioning_path:
            try:
                Path(stage_conditioning_path).unlink(missing_ok=True)
            except Exception:
                pass


def start_job_thread(target, args):
    thread = threading.Thread(target=target, args=args, daemon=True)
    thread.start()
    return thread
