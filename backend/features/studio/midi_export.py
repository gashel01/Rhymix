"""Export the project's MIDI clips as a standard .mid file.

The Studio already generates MIDI (Voice→MIDI, the beatbox wizard, the piano
roll), but until now it could only be played back inside the app. A .mid is
what makes that work usable in a DAW, and mido is already a dependency.
"""

import uuid

import mido

from backend.paths.manager import paths

DEFAULT_PPQ = 480
DEFAULT_BPM = 120.0


def _ticks_at(seconds: float, bpm: float, ppq: int) -> int:
    """Convert a timeline position in seconds to ticks at the project tempo."""
    return max(0, int(round(seconds * (bpm * ppq) / 60.0)))


def _rescale(ticks, source_ppq: int, target_ppq: int) -> int:
    if source_ppq == target_ppq or not source_ppq:
        return int(ticks or 0)
    return int(round((ticks or 0) * target_ppq / source_ppq))


def export_midi(project_payload: dict) -> dict:
    project = project_payload.get("project") or {}
    lanes = project_payload.get("lanes") or []
    clips = project_payload.get("clips") or []

    bpm = float(project.get("bpm") or DEFAULT_BPM)
    ppq = DEFAULT_PPQ

    midi_clips = [clip for clip in clips if clip.get("clipType") == "midi" and clip.get("midi")]
    if not midi_clips:
        raise RuntimeError("This project has no MIDI clips to export")

    lanes_by_id = {lane.get("id"): lane for lane in lanes}
    midi_file = mido.MidiFile(ticks_per_beat=ppq)

    tempo_track = mido.MidiTrack()
    tempo_track.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(bpm), time=0))
    midi_file.tracks.append(tempo_track)

    exported_notes = 0

    # One MIDI track per lane keeps the arrangement readable in a DAW.
    by_lane = {}
    for clip in midi_clips:
        by_lane.setdefault(clip.get("laneId"), []).append(clip)

    for lane_id, lane_clips in by_lane.items():
        lane = lanes_by_id.get(lane_id) or {}
        track = mido.MidiTrack()
        track.append(mido.MetaMessage("track_name", name=str(lane.get("name") or "MIDI"), time=0))

        # Absolute-tick events first; mido wants deltas, which needs a sort.
        events = []
        for clip in lane_clips:
            payload = clip.get("midi") or {}
            source_ppq = int(payload.get("ppq") or DEFAULT_PPQ)
            clip_offset = _ticks_at(float(clip.get("timelineStartSec") or 0.0), bpm, ppq)

            for note in payload.get("notes") or []:
                pitch = note.get("midi")
                if pitch is None:
                    continue
                start = clip_offset + _rescale(note.get("startTick"), source_ppq, ppq)
                duration = max(1, _rescale(note.get("durationTick"), source_ppq, ppq))
                velocity = int(note.get("velocity") or 100)
                velocity = max(1, min(127, velocity))

                events.append((start, "note_on", int(pitch), velocity))
                events.append((start + duration, "note_off", int(pitch), 0))
                exported_notes += 1

        if not events:
            continue

        events.sort(key=lambda item: (item[0], item[1] == "note_on"))

        previous = 0
        for absolute, kind, pitch, velocity in events:
            track.append(
                mido.Message(kind, note=pitch, velocity=velocity, time=max(0, absolute - previous))
            )
            previous = absolute

        midi_file.tracks.append(track)

    if exported_notes == 0:
        raise RuntimeError("The MIDI clips in this project contain no notes")

    output_name = f"studio_midi_{uuid.uuid4().hex}.mid"
    output_path = paths.EXPORT_DIR / output_name
    output_path.parent.mkdir(parents=True, exist_ok=True)
    midi_file.save(str(output_path))

    return {
        "path": str(output_path),
        "url": f"/api/download/exports/{output_name}",
        "fileName": output_name,
        "trackCount": len(midi_file.tracks) - 1,
        "noteCount": exported_notes,
        "bpm": bpm,
    }
