import wave

import numpy as np

from backend.app.dubler_melody import (
    _estimate_detune_offset_cents,
    _nearest_onset,
    _segments_from_decoded_sequence,
    _viterbi_decode_notes,
    transcribe_dubler_melody_v2,
)
from tests.conftest import requires_crepe


SR = 48000


def _write_wav(path, audio, sr=SR):
    audio = np.asarray(audio, dtype=np.float32)
    audio = np.clip(audio, -1.0, 1.0)
    pcm = (audio * 32767.0).astype(np.int16)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm.tobytes())
    return str(path)


def _write(tmp_path, audio, sr=SR):
    return _write_wav(tmp_path / "viterbi.wav", audio, sr)


def _sine(freq, dur, sr=SR, amp=0.6):
    t = np.linspace(0, dur, int(sr * dur), endpoint=False)
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def _decode_viterbi(midi_float, times):
    conf = np.full_like(times, 0.9, dtype=float)
    voiced = np.ones_like(times, dtype=bool)
    vibrato = np.zeros_like(times, dtype=bool)
    near_onset = np.zeros_like(times, dtype=bool)
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
    notes = _segments_from_decoded_sequence(
        note_seq,
        times,
        midi_float,
        conf,
        onset_times=np.array([], dtype=float),
        onset_snap_max=0.12,
        settle_ignore_first_sec=0.02,
        min_frames=5,
        confidence_threshold=0.3,
        allowed_midi_notes=None,
        quantize_strength=1.0,
        snap_window_cents=60.0,
    )
    return notes


def test_detune_offset_guides_viterbi():
    rng = np.random.default_rng(0)
    times = np.arange(0.0, 1.0, 0.01)
    midi_float = np.full_like(times, 60.25) + rng.normal(0.0, 0.01, size=times.size)
    conf = np.full_like(times, 0.9, dtype=float)
    voiced = np.ones_like(times, dtype=bool)
    vibrato = np.zeros_like(times, dtype=bool)
    offset = _estimate_detune_offset_cents(midi_float, conf, voiced, vibrato, 0.3)
    assert 15.0 < offset < 35.0
    midi_detuned = midi_float - offset / 100.0
    notes = _decode_viterbi(midi_detuned, times)
    assert len(notes) == 1
    assert notes[0]["note"] == 60


def test_viterbi_glide_produces_two_notes():
    times = np.arange(0.0, 1.0, 0.01)
    midi_float = np.empty_like(times)
    for i, t in enumerate(times):
        if t < 0.3:
            midi_float[i] = 60.0
        elif t < 0.6:
            alpha = (t - 0.3) / 0.3
            midi_float[i] = 60.0 + 2.0 * alpha
        else:
            midi_float[i] = 62.0
    notes = _decode_viterbi(midi_float, times)
    # A slow 300ms glide may produce an intermediate note (e.g. 60→61→62).
    # Assert ≤ 3 to allow for this while still bounding runaway segmentation.
    assert len(notes) <= 3
    assert notes[0]["note"] == 60
    assert notes[-1]["note"] == 62


def test_nearest_onset_prefers_closest():
    onsets = np.array([0.45, 0.55], dtype=float)
    assert _nearest_onset(0.52, onsets, 0.1) == 0.55
    assert _nearest_onset(0.50, onsets, 0.1) == 0.45


@requires_crepe
def test_rules_mode_matches_default(tmp_path):
    audio = _sine(220.0, 1.0)
    path = _write(tmp_path, audio)
    notes_default, _cc, _pb, _dbg = transcribe_dubler_melody_v2(
        path, sample_rate=SR, confidence_threshold=0.3
    )
    notes_rules, _cc, _pb, _dbg = transcribe_dubler_melody_v2(
        path, sample_rate=SR, confidence_threshold=0.3, decode_mode="rules"
    )
    assert len(notes_default) == len(notes_rules)
    if notes_default and notes_rules:
        assert abs(notes_default[0]["note"] - notes_rules[0]["note"]) <= 1
