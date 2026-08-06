import subprocess
import uuid
from pathlib import Path

from backend.paths.manager import paths
from backend.features.studio.assets import probe_audio, resolve_asset_path


def _db_to_gain(db_value: float | None) -> float:
    try:
        return 10 ** (float(db_value or 0.0) / 20.0)
    except Exception:
        return 1.0


def _safe_stem_name(value: str, fallback: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in str(value or ""))
    cleaned = cleaned.strip("_")
    return cleaned or fallback


def _included_lanes(lanes: list) -> list:
    """Lanes that count towards a mix: solo wins, otherwise everything unmuted."""
    solo_lanes = {lane["id"] for lane in lanes if lane.get("solo")}
    if solo_lanes:
        return [lane for lane in lanes if lane.get("id") in solo_lanes]
    return [lane for lane in lanes if not lane.get("mute")]


def _render_clips(clips: list, assets: dict, lane_gain: dict, output_name: str) -> dict:
    """Mix a set of clips down to one wav via a single ffmpeg pass."""
    inputs = []
    filters = []
    labels = []

    for clip in clips:
        path = resolve_asset_path(assets, clip.get("sourceAssetId"))
        if not path:
            continue

        idx = len(inputs)
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
        # Filters inside one chain are comma-separated; ";" separates chains.
        # Joining with ";" turned the output pad into a chain of its own and
        # ffmpeg rejected the graph with "No such filter: ''".
        filters.append(f"{','.join(filter_parts)}[{label}]")

    if not inputs:
        raise RuntimeError("No audio sources found for render")

    mix_label = "mixout"
    if len(labels) == 1:
        filters.append(f"[{labels[0]}]anull[{mix_label}]")
    else:
        labels_joined = "".join(f"[{label}]" for label in labels)
        filters.append(f"{labels_joined}amix=inputs={len(labels)}:normalize=0:dropout_transition=0[{mix_label}]")

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


def render_mixdown(project_payload: dict) -> dict:
    lanes = project_payload.get("lanes") or []
    clips = project_payload.get("clips") or []
    assets = project_payload.get("assets") or {}

    include_lanes = _included_lanes(lanes)
    include_lane_ids = {lane.get("id") for lane in include_lanes}
    lane_gain = {lane.get("id"): float(lane.get("gainDb") or 0.0) for lane in include_lanes}

    usable_clips = [clip for clip in clips if clip.get("laneId") in include_lane_ids]
    if not usable_clips:
        raise RuntimeError("No clips available to render")

    return _render_clips(usable_clips, assets, lane_gain, f"studio_mix_{uuid.uuid4().hex}.wav")


def render_stems(project_payload: dict) -> dict:
    """Render one file per lane instead of a single mix.

    This is what makes the arrangement usable outside the app: a mixdown is a
    finished artefact, stems are material you can take into a DAW. Lanes keep
    their own gain but are each rendered in isolation, so the files line up on
    a common timeline when re-imported.
    """
    lanes = project_payload.get("lanes") or []
    clips = project_payload.get("clips") or []
    assets = project_payload.get("assets") or {}

    # Solo is a monitoring state, not an export intent: honouring it here would
    # silently export a single lane. Muted lanes are an explicit "off", so those
    # are still skipped.
    include_lanes = [lane for lane in lanes if not lane.get("mute")]
    if not include_lanes:
        raise RuntimeError("No lanes available to render")

    batch = uuid.uuid4().hex[:8]
    stems = []
    skipped = []

    for position, lane in enumerate(include_lanes):
        lane_id = lane.get("id")
        lane_clips = [clip for clip in clips if clip.get("laneId") == lane_id]
        if not lane_clips:
            continue

        lane_gain = {lane_id: float(lane.get("gainDb") or 0.0)}
        stem_name = _safe_stem_name(lane.get("name"), f"lane{position + 1}")
        output_name = f"studio_stem_{batch}_{position + 1:02d}_{stem_name}.wav"

        try:
            rendered = _render_clips(lane_clips, assets, lane_gain, output_name)
        except RuntimeError as exc:
            # One unusable lane shouldn't lose the whole export.
            skipped.append({"lane": lane.get("name") or lane_id, "reason": str(exc)})
            continue

        rendered["laneId"] = lane_id
        rendered["laneName"] = lane.get("name")
        stems.append(rendered)

    if not stems:
        raise RuntimeError("No lane produced any audio to export")

    return {"stems": stems, "skipped": skipped, "count": len(stems)}
