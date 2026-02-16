import numpy as np
import soundfile as sf

from backend.app.dubler_melody import transcribe_dubler_melody_v2


def _write_wav(tmp_path, audio, sr=16000):
    path = tmp_path / "test.wav"
    sf.write(path, audio, sr)
    return str(path)


def _sine(freq, dur, sr=16000, amp=0.6):
    t = np.linspace(0, dur, int(sr * dur), endpoint=False)
    return amp * np.sin(2 * np.pi * freq * t)


def _vibrato(freq, dur, sr=16000, amp=0.6, vib_hz=5.5, vib_cents=40.0):
    t = np.linspace(0, dur, int(sr * dur), endpoint=False)
    vib = (vib_cents / 1200.0) * np.sin(2 * np.pi * vib_hz * t)
    inst_freq = freq * (2 ** vib)
    phase = 2 * np.pi * np.cumsum(inst_freq) / sr
    return amp * np.sin(phase)


def test_silence_produces_no_notes(tmp_path):
    audio = np.zeros(16000, dtype=np.float32)
    path = _write_wav(tmp_path, audio)
    notes, _cc, _pb, _debug = transcribe_dubler_melody_v2(
        path, sample_rate=16000, confidence_threshold=0.35
    )
    assert len(notes) == 0


def test_single_sine_note(tmp_path):
    audio = _sine(220.0, 2.0)
    path = _write_wav(tmp_path, audio)
    notes, _cc, _pb, _debug = transcribe_dubler_melody_v2(
        path, sample_rate=16000, confidence_threshold=0.3, key_restrict=False
    )
    assert len(notes) == 1
    assert abs(notes[0]["note"] - 57) <= 1  # A3


def test_two_notes_with_gap(tmp_path):
    audio = np.concatenate(
        [_sine(220.0, 1.0), np.zeros(2000, dtype=np.float32), _sine(330.0, 1.0)]
    )
    path = _write_wav(tmp_path, audio)
    notes, _cc, _pb, _debug = transcribe_dubler_melody_v2(
        path, sample_rate=16000, confidence_threshold=0.3
    )
    assert len(notes) >= 2


def test_vibrato_stays_one_note(tmp_path):
    audio = _vibrato(220.0, 2.0)
    path = _write_wav(tmp_path, audio)
    notes, _cc, pb, _debug = transcribe_dubler_melody_v2(
        path,
        sample_rate=16000,
        confidence_threshold=0.3,
        emit_pitchbend=True,
        articulation_mode="legato",
    )
    assert len(notes) == 1
    assert len(pb) > 0


def test_legato_reduces_retriggers(tmp_path):
    t = np.linspace(0, 2.0, int(16000 * 2.0), endpoint=False)
    freq = 220.0 + (330.0 - 220.0) * (t / t[-1])
    audio = 0.6 * np.sin(2 * np.pi * np.cumsum(freq) / 16000)
    path = _write_wav(tmp_path, audio)
    notes_legato, *_ = transcribe_dubler_melody_v2(
        path, sample_rate=16000, articulation_mode="legato"
    )
    notes_staccato, *_ = transcribe_dubler_melody_v2(
        path, sample_rate=16000, articulation_mode="staccato"
    )
    assert len(notes_legato) <= len(notes_staccato)


def test_key_restriction_snaps_to_scale(tmp_path):
    audio = _sine(277.18, 1.5)  # C#4
    path = _write_wav(tmp_path, audio)
    notes, _cc, _pb, _debug = transcribe_dubler_melody_v2(
        path,
        sample_rate=16000,
        key_restrict=True,
        root="C",
        scale="major",
        quantize_strength=1.0,
    )
    assert len(notes) >= 1
    allowed = {0, 2, 4, 5, 7, 9, 11}
    assert (notes[0]["note"] % 12) in allowed
