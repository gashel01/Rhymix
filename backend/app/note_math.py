"""Turning pitch detection into MIDI: tempo, ticks, keys, note merging.

These were defined in session.py, next to the code that runs CREPE and DDSP.
That file cannot be imported without aubio and torch, so none of this could be
tested — not in CI, not locally without the model stack installed. It needs
nothing but numpy.

The functions here run between "here are some detected notes" and "here is a
MIDI clip", which is where a transcription stops being about audio and starts
being about musical choices: what counts as one note, where the grid is, and
which pitches the chosen key allows.
"""

from typing import Dict, List, Optional

import numpy as np


def estimate_bpm_from_onsets(onset_times: List[float]) -> Optional[float]:
    """Tempo from the median gap between onsets.

    Median, not mean: a single long pause between phrases would drag a mean
    tempo down by more than the rest of the take can pull it back.

    Clamped to 60-200: outside that the estimate is almost always the wrong
    metrical level — hearing every other beat, or every subdivision — and a
    plausible wrong tempo is worse than a safe one, because the grid it
    produces looks deliberate.
    """
    if len(onset_times) < 2:
        return None
    intervals = [b - a for a, b in zip(onset_times[:-1], onset_times[1:]) if b > a]
    if not intervals:
        return None
    median = float(np.median(intervals))
    if median <= 0:
        return None
    bpm = 60.0 / median
    return max(60.0, min(200.0, bpm))


def ticks_per_second(bpm: float, ppq: int) -> float:
    return (bpm * ppq) / 60.0


def quantize_tick(value: int, grid: int) -> int:
    """Nearest grid line. A grid of 1 or less is no grid at all."""
    if grid <= 1:
        return value
    return int(round(value / grid) * grid)


def apply_swing(start_tick: int, grid: int, swing: float) -> int:
    """Push every other grid position late, which is what swing is.

    Only the odd steps move: displacing all of them would shift the whole part
    rather than change its feel.
    """
    if swing <= 0 or grid <= 0:
        return start_tick
    step = start_tick // grid
    if step % 2 == 1:
        return int(start_tick + grid * swing * 0.5)
    return start_tick


def merge_adjacent_notes(notes: List[Dict], gap_sec: float = 0.04) -> List[Dict]:
    """Join notes of the same pitch separated by less than `gap_sec`.

    Pitch detection breaks a held note wherever the singer's tone wavers past
    the confidence threshold, which produces a stutter of repeated notes where
    a person sang one. Only same-pitch neighbours merge, so a real repetition
    of the same note survives if it has a real gap.

    The input is not modified: the notes are copied before the ends are moved.
    """
    if not notes:
        return []
    notes_sorted = sorted(notes, key=lambda n: (n["startSec"], n["endSec"]))
    merged = [notes_sorted[0].copy()]
    for note in notes_sorted[1:]:
        prev = merged[-1]
        if note["note"] == prev["note"] and note["startSec"] - prev["endSec"] <= gap_sec:
            prev["endSec"] = max(prev["endSec"], note["endSec"])
            prev["velocity"] = max(prev["velocity"], note.get("velocity", prev["velocity"]))
        else:
            merged.append(note.copy())
    return merged


def parse_key_string(key: str):
    """A key as (root, "maj" | "min"), or None when it says nothing usable.

    Major is the default for a key that names only a root, because that is
    what "C" means to most people writing it.
    """
    if not key:
        return None
    key = key.strip().lower()
    parts = key.replace("major", "maj").replace("minor", "min").split()
    if not parts:
        return None
    root = parts[0]
    mode = "maj"
    if len(parts) > 1:
        if "min" in parts[1]:
            mode = "min"
        elif "maj" in parts[1]:
            mode = "maj"
    return root, mode


NOTE_PITCH_CLASSES = {
    "c": 0,
    "c#": 1,
    "db": 1,
    "d": 2,
    "d#": 3,
    "eb": 3,
    "e": 4,
    "f": 5,
    "f#": 6,
    "gb": 6,
    "g": 7,
    "g#": 8,
    "ab": 8,
    "a": 9,
    "a#": 10,
    "bb": 10,
    "b": 11,
}

MAJOR_STEPS = {0, 2, 4, 5, 7, 9, 11}
NATURAL_MINOR_STEPS = {0, 2, 3, 5, 7, 8, 10}


def note_name_to_pc(name: str) -> Optional[int]:
    """A note name as a pitch class, or None for a name it does not know."""
    return NOTE_PITCH_CLASSES.get(name)


def snap_notes_to_scale(notes: List[Dict], key: str) -> List[Dict]:
    """Move every note to the nearest pitch in `key`.

    Returned unchanged when the key cannot be read, rather than snapped to a
    guess: silently transposing a take to the wrong scale is worse than not
    snapping it.

    Ties go to the lower note — the search runs from -6 upward and keeps the
    first of an equal distance — which matters for the tritone, where both
    neighbours are equally close.
    """
    parsed = parse_key_string(key)
    if not parsed:
        return notes
    root, mode = parsed
    root_pc = note_name_to_pc(root)
    if root_pc is None:
        return notes
    scale = NATURAL_MINOR_STEPS if mode == "min" else MAJOR_STEPS
    scale_pcs = {(root_pc + step) % 12 for step in scale}
    snapped = []
    for note in notes:
        midi = int(note["note"])
        best = midi
        best_dist = 12
        for delta in range(-6, 7):
            candidate = midi + delta
            if candidate < 0 or candidate > 127:
                continue
            if candidate % 12 in scale_pcs:
                dist = abs(delta)
                if dist < best_dist:
                    best_dist = dist
                    best = candidate
                    if dist == 0:
                        break
        snapped_note = note.copy()
        snapped_note["note"] = best
        snapped.append(snapped_note)
    return snapped
