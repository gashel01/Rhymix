import numpy as np

from backend.app.dubler_melody import _relabel_notes_by_median_pitch


def _slide_midi(times, start, end, slide_dur):
    midi = np.empty_like(times)
    for i, t in enumerate(times):
        if t <= slide_dur:
            alpha = t / max(slide_dur, 1e-9)
            midi[i] = start + (end - start) * alpha
        else:
            midi[i] = end
    return midi


def test_relabel_slide_prefers_settled_pitch():
    times = np.arange(0.0, 1.0, 0.01)
    midi_float = _slide_midi(times, 60.3, 62.0, 0.12)
    conf = np.ones_like(times)
    voiced = np.ones_like(times, dtype=bool)
    notes = [
        {"startSec": 0.0, "endSec": 1.0, "note": 60, "midiRaw": 60, "velocity": 90, "channel": 0}
    ]
    out = _relabel_notes_by_median_pitch(
        notes,
        times,
        midi_float,
        conf,
        voiced,
        ignore_first_sec=0.06,
        min_frames=5,
        confidence_threshold=0.3,
        allowed_midi_notes=None,
        quantize_strength=1.0,
        snap_window_cents=60.0,
    )
    assert out[0]["note"] == 62


def test_relabel_keeps_note_when_insufficient_frames():
    times = np.arange(0.0, 0.05, 0.01)
    midi_float = np.full_like(times, 62.0)
    conf = np.ones_like(times)
    voiced = np.ones_like(times, dtype=bool)
    notes = [
        {"startSec": 0.0, "endSec": 0.05, "note": 60, "midiRaw": 60, "velocity": 90, "channel": 0}
    ]
    out = _relabel_notes_by_median_pitch(
        notes,
        times,
        midi_float,
        conf,
        voiced,
        ignore_first_sec=0.06,
        min_frames=5,
        confidence_threshold=0.3,
        allowed_midi_notes=None,
        quantize_strength=1.0,
        snap_window_cents=60.0,
    )
    assert out[0]["note"] == 60


def test_relabel_respects_allowed_notes():
    times = np.arange(0.0, 1.0, 0.01)
    midi_float = np.full_like(times, 61.7)
    conf = np.ones_like(times)
    voiced = np.ones_like(times, dtype=bool)
    notes = [
        {"startSec": 0.0, "endSec": 1.0, "note": 60, "midiRaw": 60, "velocity": 90, "channel": 0}
    ]
    allowed = {60, 62}
    out = _relabel_notes_by_median_pitch(
        notes,
        times,
        midi_float,
        conf,
        voiced,
        ignore_first_sec=0.0,
        min_frames=5,
        confidence_threshold=0.3,
        allowed_midi_notes=allowed,
        quantize_strength=1.0,
        snap_window_cents=60.0,
    )
    assert out[0]["note"] == 62
