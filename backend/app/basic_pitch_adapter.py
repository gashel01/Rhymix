import math
from typing import Iterable, List, Optional, Tuple


def _hz_to_midi(freq: float) -> int:
    if not freq or freq <= 0:
        return 0
    return int(round(69 + 12 * math.log2(freq / 440.0)))


def _normalize_velocity(value) -> int:
    if value is None:
        return 90
    try:
        value = float(value)
    except Exception:
        return 90
    if value <= 1.0:
        return max(1, min(127, int(30 + value * 97)))
    return max(1, min(127, int(value)))


def _extract_field(ev, keys: Iterable[str]):
    if isinstance(ev, dict):
        for key in keys:
            if key in ev:
                return ev[key]
    for key in keys:
        if hasattr(ev, key):
            return getattr(ev, key)
    return None


def _coerce_note_events(note_events) -> List[dict]:
    notes = []
    if note_events is None:
        return notes
    for ev in note_events:
        start = _extract_field(ev, ("start_time", "start", "start_sec", "startSec"))
        end = _extract_field(ev, ("end_time", "end", "end_sec", "endSec"))
        pitch = _extract_field(ev, ("pitch", "note", "midi", "note_number"))
        velocity = _extract_field(ev, ("velocity", "amplitude", "amp"))
        if start is None or end is None or pitch is None:
            try:
                if len(ev) >= 3:
                    start, end, pitch = ev[:3]
                    velocity = ev[3] if len(ev) > 3 else velocity
            except Exception:
                continue
        try:
            start = float(start)
            end = float(end)
        except Exception:
            continue
        if end <= start:
            continue
        try:
            pitch_val = float(pitch)
        except Exception:
            continue
        if pitch_val > 200:
            note = _hz_to_midi(pitch_val)
        else:
            note = int(round(pitch_val))
        if note <= 0:
            continue
        notes.append(
            {
                "startSec": start,
                "endSec": end,
                "note": note,
                "velocity": _normalize_velocity(velocity),
                "channel": 0,
            }
        )
    return notes


def transcribe_basic_pitch(
    audio_path: str,
    *,
    min_freq: Optional[float] = None,
    max_freq: Optional[float] = None,
) -> Tuple[List[dict], Optional[object]]:
    try:
        from basic_pitch.inference import predict
    except Exception as exc:  # pragma: no cover - optional dependency
        raise RuntimeError("basic-pitch not available") from exc

    kwargs = {}
    if min_freq is not None:
        kwargs["minimum_frequency"] = float(min_freq)
    if max_freq is not None:
        kwargs["maximum_frequency"] = float(max_freq)
    model_output, midi_data, note_events = predict(audio_path, **kwargs)
    notes = _coerce_note_events(note_events)
    return notes, midi_data
