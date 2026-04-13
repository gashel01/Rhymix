import subprocess
import uuid
from pathlib import Path

from backend.paths.manager import paths
from backend.features.studio.assets import probe_audio


def _db_to_gain(db_value: float | None) -> float:
    try:
        return 10 ** (float(db_value or 0.0) / 20.0)
    except Exception:
        return 1.0


def render_mixdown(project_payload: dict) -> dict:
    project = project_payload.get("project") or {}
    lanes = project_payload.get("lanes") or []
    clips = project_payload.get("clips") or []
    assets = project_payload.get("assets") or {}

    solo_lanes = {lane["id"] for lane in lanes if lane.get("solo")}
    include_lanes = []
    for lane in lanes:
        if solo_lanes:
            if lane.get("id") in solo_lanes:
                include_lanes.append(lane)
        else:
            if not lane.get("mute"):
                include_lanes.append(lane)

    include_lane_ids = {lane.get("id") for lane in include_lanes}
    lane_gain = {lane.get("id"): float(lane.get("gainDb") or 0.0) for lane in include_lanes}

    usable_clips = [clip for clip in clips if clip.get("laneId") in include_lane_ids]
    if not usable_clips:
        raise RuntimeError("No clips available to render")

    inputs = []
    filters = []
    labels = []

    for idx, clip in enumerate(usable_clips):
        asset_id = clip.get("sourceAssetId")
        asset = assets.get(asset_id) if isinstance(assets, dict) else None
        asset_path = asset.get("path") if isinstance(asset, dict) else None
        if not asset_path:
            continue
        path = Path(asset_path)
        if not path.exists():
            continue
        inputs.append(str(path))

        src_start = max(0.0, float(clip.get("srcStartSec") or 0.0))
        src_end = float(clip.get("srcEndSec") or 0.0)
        if src_end <= src_start:
            src_end = src_start + 0.01
        clip_len = max(0.01, src_end - src_start)
        timeline_start = max(0.0, float(clip.get("timelineStartSec") or 0.0))
        fade_in = max(0.0, float(clip.get("fadeInSec") or 0.0))
        fade_out = max(0.0, float(clip.get("fadeOutSec") or 0.0))
        lane_db = lane_gain.get(clip.get("laneId"), 0.0)
        clip_db = float(clip.get("gainDb") or 0.0)
        gain = _db_to_gain(lane_db + clip_db)

        label = f"a{idx}"
        labels.append(label)
        delay_ms = int(timeline_start * 1000)

        filter_parts = [
            f"[{idx}:a]atrim=start={src_start}:end={src_end}",
            "asetpts=PTS-STARTPTS",
        ]
        if fade_in > 0:
            filter_parts.append(f"afade=t=in:st=0:d={fade_in}")
        if fade_out > 0 and clip_len > fade_out:
            filter_parts.append(f"afade=t=out:st={clip_len - fade_out}:d={fade_out}")
        if gain != 1.0:
            filter_parts.append(f"volume={gain}")
        if delay_ms > 0:
            filter_parts.append(f"adelay={delay_ms}|{delay_ms}")
        filter_parts.append(f"[{label}]")
        filters.append(";".join(filter_parts))

    if not inputs:
        raise RuntimeError("No audio sources found for render")

    mix_label = "mixout"
    if len(labels) == 1:
        filters.append(f"[{labels[0]}]anull[{mix_label}]")
    else:
        labels_joined = "".join(f"[{label}]" for label in labels)
        filters.append(f"{labels_joined}amix=inputs={len(labels)}:normalize=0:dropout_transition=0[{mix_label}]")

    output_name = f"studio_mix_{uuid.uuid4().hex}.wav"
    output_path = paths.EXPORT_DIR / output_name

    cmd = ["ffmpeg", "-y"]
    for inp in inputs:
        cmd += ["-i", inp]
    cmd += ["-filter_complex", ";".join(filters), "-map", f"[{mix_label}]", str(output_path)]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "Render failed")

    info = probe_audio(output_path)
    return {
        "path": str(output_path),
        "url": f"/api/download/exports/{output_name}",
        "durationSec": info.get("durationSec", 0.0),
        "sampleRate": info.get("sampleRate"),
        "fileName": output_name,
    }
