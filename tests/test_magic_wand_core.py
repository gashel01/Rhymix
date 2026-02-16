import numpy as np

from backend.app.dubler_melody import (
    _nearest_onset,
    _segments_from_decoded_sequence,
    _suppress_short_runs,
    _viterbi_decode_notes,
)


def test_nearest_onset_closest_and_respects_window():
    onsets = np.array([0.2, 0.4, 0.8], dtype=float)
    assert _nearest_onset(0.36, onsets, 0.1) == 0.4
    assert _nearest_onset(0.36, onsets, 0.01) == 0.36


def test_viterbi_stays_stable_with_nans_and_low_conf():
    times = np.arange(0.0, 1.0, 0.01)
    midi_float = np.full_like(times, 60.0, dtype=float)
    midi_float[[20, 50, 70]] = np.nan
    conf = np.full_like(times, 0.9, dtype=float)
    conf[[20, 50, 70]] = 0.2
    voiced = np.ones_like(times, dtype=bool)
    near_onset = np.zeros_like(times, dtype=bool)
    vibrato = np.zeros_like(times, dtype=bool)
    note_seq = _viterbi_decode_notes(
        times,
        midi_float,
        conf,
        voiced,
        near_onset,
        vibrato,
        candidate_allowed_notes=None,
        scale_prior_notes=None,
        key_restrict=False,
        confidence_threshold=0.3,
        radius_semitones=3.0,
        max_candidates=9,
        base_sigma_cents=35.0,
        scale_prior_penalty_cents=35.0,
        scale_prior_strength=0.0,
        change_cost=1.2,
        jump_cost_per_semitone=0.35,
        off_onset_penalty=1.4,
        onset_change_reward=-0.3,
        rest_toggle_penalty=0.6,
        rest_cost_unvoiced=0.05,
        rest_cost_lowconf=0.6,
        rest_cost_voiced=2.0,
        pitch_unvoiced_cost=9.0,
        stay_reward=-0.05,
        slide_rate_threshold=6.0,
        slide_penalty=0.8,
        vibrato_transition_boost=1.2,
    )
    assert np.all(note_seq == 60)


def test_viterbi_switches_near_onset():
    times = np.arange(0.0, 1.0, 0.01)
    midi_float = np.where(times < 0.5, 60.0, 62.0).astype(float)
    conf = np.full_like(times, 0.9, dtype=float)
    voiced = np.ones_like(times, dtype=bool)
    near_onset = np.zeros_like(times, dtype=bool)
    near_onset[(times >= 0.48) & (times <= 0.52)] = True
    vibrato = np.zeros_like(times, dtype=bool)
    note_seq = _viterbi_decode_notes(
        times,
        midi_float,
        conf,
        voiced,
        near_onset,
        vibrato,
        candidate_allowed_notes=None,
        scale_prior_notes=None,
        key_restrict=False,
        confidence_threshold=0.3,
        radius_semitones=3.0,
        max_candidates=9,
        base_sigma_cents=35.0,
        scale_prior_penalty_cents=35.0,
        scale_prior_strength=0.0,
        change_cost=1.2,
        jump_cost_per_semitone=0.35,
        off_onset_penalty=1.4,
        onset_change_reward=-0.3,
        rest_toggle_penalty=0.6,
        rest_cost_unvoiced=0.05,
        rest_cost_lowconf=0.6,
        rest_cost_voiced=2.0,
        pitch_unvoiced_cost=9.0,
        stay_reward=-0.05,
        slide_rate_threshold=6.0,
        slide_penalty=0.8,
        vibrato_transition_boost=1.2,
    )
    assert note_seq[0] == 60
    assert note_seq[-1] == 62
    changes = np.where(note_seq[:-1] != note_seq[1:])[0]
    assert changes.size <= 3


def test_suppress_short_runs_removes_blips():
    seq = np.array([60, 60, 60, 61, 60, 60, 60], dtype=int)
    out = _suppress_short_runs(seq, min_frames=2)
    assert np.all(out == 60)


def test_segments_sorted_and_non_overlapping():
    times = np.arange(0.0, 0.08, 0.01)
    note_seq = np.array([60, 60, 60, -1, -1, 62, 62, 62], dtype=int)
    midi_float = np.where(note_seq >= 0, note_seq.astype(float), np.nan)
    conf = np.full_like(times, 0.9, dtype=float)
    notes = _segments_from_decoded_sequence(
        note_seq,
        times,
        midi_float,
        conf,
        onset_times=np.array([], dtype=float),
        onset_snap_max=0.12,
        settle_ignore_first_sec=0.0,
        min_frames=1,
        confidence_threshold=0.3,
        allowed_midi_notes=None,
        quantize_strength=1.0,
        snap_window_cents=60.0,
    )
    assert notes == sorted(notes, key=lambda n: (n["startSec"], n["endSec"]))
    for prev, nxt in zip(notes, notes[1:]):
        assert prev["endSec"] <= nxt["startSec"] + 1e-6
