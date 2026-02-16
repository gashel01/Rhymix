import wave

import numpy as np

from backend.app.dubler_melody import transcribe_dubler_melody_v2


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
    return _write_wav(tmp_path / "sample.wav", audio, sr)


def _sine(freq, dur, sr=SR, amp=0.6):
    t = np.linspace(0, dur, int(sr * dur), endpoint=False)
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def _vibrato(freq, dur, sr=SR, amp=0.6, vib_hz=6.0, vib_cents=30.0):
    t = np.linspace(0, dur, int(sr * dur), endpoint=False)
    vib = (vib_cents / 1200.0) * np.sin(2 * np.pi * vib_hz * t)
    inst_freq = freq * (2 ** vib)
    phase = 2 * np.pi * np.cumsum(inst_freq) / sr
    return (amp * np.sin(phase)).astype(np.float32)


def _glide(freq_start, freq_end, dur, sr=SR, amp=0.6):
    t = np.linspace(0, dur, int(sr * dur), endpoint=False)
    log_start = np.log2(freq_start)
    log_end = np.log2(freq_end)
    log_freq = np.linspace(log_start, log_end, t.size)
    inst_freq = 2 ** log_freq
    phase = 2 * np.pi * np.cumsum(inst_freq) / sr
    return (amp * np.sin(phase)).astype(np.float32)


def test_silence_yields_no_notes(tmp_path):
    noise = np.random.normal(0.0, 1e-5, int(SR * 1.0)).astype(np.float32)
    audio = np.zeros(int(SR * 1.0), dtype=np.float32) + noise
    notes, _cc, _pb, _dbg = transcribe_dubler_melody_v2(
        _write(tmp_path, audio), sample_rate=SR, confidence_threshold=0.35, min_note_duration=0.1
    )
    assert len(notes) == 0


def test_single_tone_is_stable(tmp_path):
    audio = _sine(220.0, 1.0)
    notes, _cc, _pb, _dbg = transcribe_dubler_melody_v2(
        _write(tmp_path, audio), sample_rate=SR, confidence_threshold=0.3
    )
    assert len(notes) == 1
    assert abs(notes[0]["note"] - 57) <= 1
    assert notes[0]["endSec"] - notes[0]["startSec"] > 0.8


def test_two_notes_non_overlapping(tmp_path):
    audio = np.concatenate(
        [_sine(220.0, 0.8), np.zeros(int(SR * 0.1), dtype=np.float32), _sine(246.94, 0.8)]
    )
    notes, _cc, _pb, _dbg = transcribe_dubler_melody_v2(
        _write(tmp_path, audio), sample_rate=SR, confidence_threshold=0.3
    )
    assert len(notes) >= 2
    notes = sorted(notes, key=lambda n: n["startSec"])
    for prev, nxt in zip(notes, notes[1:]):
        assert prev["endSec"] <= nxt["startSec"] + 1e-3


def test_vibrato_produces_pitchbend(tmp_path):
    audio = _vibrato(220.0, 2.0)
    notes, _cc, pb, _dbg = transcribe_dubler_melody_v2(
        _write(tmp_path, audio),
        sample_rate=SR,
        confidence_threshold=0.3,
        emit_pitchbend=True,
        articulation_mode="legato",
    )
    assert len(notes) == 1
    assert len(pb) > 20


def test_legato_has_fewer_retriggers(tmp_path):
    audio = _glide(220.0, 246.94, 1.2)
    notes_legato, _cc, _pb, _dbg = transcribe_dubler_melody_v2(
        _write(tmp_path, audio), sample_rate=SR, confidence_threshold=0.3, articulation_mode="legato"
    )
    notes_staccato, _cc, _pb, _dbg = transcribe_dubler_melody_v2(
        _write(tmp_path, audio), sample_rate=SR, confidence_threshold=0.3, articulation_mode="staccato"
    )
    assert len(notes_legato) <= len(notes_staccato)
