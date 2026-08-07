"""Edits to a project record, with nothing else attached.

A project record is the plain dict the studio persists: ``project``, ``lanes``,
``clips``, ``assets``. Jobs spend most of their code mutating it — adding a
lane, appending a clip, splitting one around a re-sung range — between calls to
adapters and ffmpeg. Written inside ``jobs.py``, those edits could only be
exercised by running a job, which means a subprocess and usually a GPU.

Every function here works on a dict in memory. Nothing reads a file, spawns a
process, or touches storage.

One rule matters more than the rest and is stated once here: a clip's length on
the timeline is ``srcEndSec - srcStartSec``, not ``srcEndSec``. The two agree
only while a clip is untrimmed. Use :func:`clip_timeline_end` rather than doing
the arithmetic again.
"""

import uuid
from datetime import datetime


def _now_iso() -> str:
    return datetime.now().isoformat()


def format_key_signature(key_note: str | None, scale: str | None) -> str:
    note = str(key_note or "").strip() or "C"
    mode = str(scale or "").strip().lower() or "major"
    if mode not in {"major", "minor"}:
        mode = "major"
    return f"{note} {mode}"


def ticks_to_sec(ticks: float, bpm: float | None, ppq: float | None) -> float:
    safe_bpm = float(bpm or 120.0)
    safe_ppq = float(ppq or 480.0)
    ticks_per_sec = (safe_bpm * safe_ppq) / 60.0
    if ticks_per_sec <= 0:
        return 0.0
    return float(ticks or 0.0) / ticks_per_sec


def clip_length_sec(clip: dict) -> float:
    """How long the clip sounds for. Never zero: a clip with no length would
    vanish from the timeline while still occupying a row in the record."""
    src_start = float(clip.get("srcStartSec") or 0.0)
    src_end = float(clip.get("srcEndSec") or 0.0)
    return max(0.01, src_end - src_start)


def clip_timeline_end(clip: dict) -> float:
    """Where the clip stops on the timeline."""
    return float(clip.get("timelineStartSec") or 0.0) + clip_length_sec(clip)


def ensure_lane(project_record: dict, lane_type: str, name: str) -> dict:
    """The project's lane of this type, created if it has none."""
    lanes = project_record.get("lanes") or []
    existing = next((lane for lane in lanes if lane.get("type") == lane_type), None)
    if existing:
        return existing
    return create_lane(project_record, lane_type, name)


def create_lane(
    project_record: dict,
    lane_type: str,
    name: str,
    source_asset_id: str | None = None,
    *,
    muted: bool = False,
) -> dict:
    """A new lane, appended even if one of this type already exists."""
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


def get_lane_by_id(project_record: dict, lane_id: str | None) -> dict | None:
    if not lane_id:
        return None
    for lane in project_record.get("lanes") or []:
        if lane.get("id") == lane_id:
            return lane
    return None


def append_clip(
    project_record: dict,
    lane_id: str,
    asset_id: str,
    start_sec: float,
    duration_sec: float,
) -> dict:
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


def append_midi_clip(
    project_record: dict,
    lane_id: str,
    midi_clip: dict,
    start_sec: float,
) -> dict:
    """A MIDI clip has no audio asset, so its length comes from its last note."""
    resolved_bpm = float(
        midi_clip.get("bpm") or project_record.get("project", {}).get("bpm") or 120.0
    )
    resolved_ppq = float(midi_clip.get("ppq") or 480.0)
    notes = midi_clip.get("notes") if isinstance(midi_clip.get("notes"), list) else []
    max_tick = 0
    for note in notes:
        if not isinstance(note, dict):
            continue
        end_tick = int(note.get("startTick") or 0) + int(note.get("durationTick") or 0)
        max_tick = max(max_tick, end_tick)

    duration_sec = max(0.01, ticks_to_sec(max_tick, resolved_bpm, resolved_ppq))
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


def replace_clip_segment(
    project_record: dict,
    payload: dict,
    asset_id: str,
    duration_sec: float,
) -> bool:
    """Drop a new asset into a range of an existing clip, keeping what is
    outside it.

    The clip covering the range is split in three — the part before, the new
    asset, the part after — and the two surviving fragments keep pointing into
    the original source at the right offsets. Returns False, leaving the record
    untouched, when the payload names no usable range or no clip contains it;
    the caller then falls back to appending.

    NOTHING CALLS THIS. It was written for the re-sing job, which instead
    records its result through the generic path and so *layers* the new audio
    on a "Generated Layers" lane while the original keeps playing underneath.
    Whether that is the wanted behaviour is a product question, so it is left
    as it is rather than quietly rewired. Kept and tested because the answer
    decides which of the two is the mistake.
    """
    if not isinstance(payload, dict):
        return False
    # `or` would read a startSec of 0 as absent and fall through to
    # timelineStartSec, so replacing the opening of a clip — including
    # replacing the whole of one — could never work.
    start_sec = payload.get("startSec")
    if start_sec is None:
        start_sec = payload.get("timelineStartSec")
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
        # No clip named, so find one that contains the range. The epsilon
        # matters: the range usually came from the UI as a float derived from
        # the clip's own bounds, and comparing those exactly fails.
        source_asset_id = payload.get("sourceAssetId") or payload.get("assetId")
        for clip in clips:
            if source_asset_id and clip.get("sourceAssetId") != source_asset_id:
                continue
            clip_start = float(clip.get("timelineStartSec") or 0.0)
            clip_end = clip_start + clip_length_sec(clip)
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

    # A fragment shorter than a millisecond is the range meeting the clip edge,
    # not a piece of audio worth keeping.
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

    replacement = {
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
    next_clips.append(replacement)
    project_record["clips"] = next_clips
    return True


def update_project_duration(project_record: dict) -> float:
    """Set the project's length to where its last clip stops."""
    clips = project_record.get("clips") or []
    duration = max((clip_timeline_end(clip) for clip in clips), default=0.0)
    project = project_record.get("project") or {}
    project["durationSec"] = duration
    project["updatedAt"] = _now_iso()
    project_record["project"] = project
    return duration


def register_asset(project_record: dict, asset: dict) -> str:
    assets = project_record.get("assets") or {}
    assets[asset["id"]] = asset
    project_record["assets"] = assets
    return asset["id"]
