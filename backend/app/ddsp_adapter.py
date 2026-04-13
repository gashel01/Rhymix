import logging
import math
from typing import List, Optional, Tuple

import librosa
import numpy as np
import soundfile as sf

from .ddsp_models import (
    build_ddsp_features,
    load_ddsp_model,
    resolve_ddsp_model,
    synthesize_with_model,
)


def hz_to_midi(freq: float) -> int:
    if freq <= 0:
        return 0
    return int(round(69 + 12 * math.log2(freq / 440.0)))


def _to_numpy(value):
    if value is None:
        return None
    if hasattr(value, "numpy"):
        return value.numpy()
    return np.asarray(value)


def _extract_f0_with_ddsp(audio: np.ndarray, sr: int, frame_rate: int):
    import ddsp

    if hasattr(ddsp, "spectral_ops") and hasattr(ddsp.spectral_ops, "compute_f0"):
        out = ddsp.spectral_ops.compute_f0(audio, sr, frame_rate=frame_rate)
        if isinstance(out, tuple) and len(out) >= 2:
            return _to_numpy(out[0]).squeeze(), _to_numpy(out[1]).squeeze()
        if isinstance(out, dict):
            f0 = _to_numpy(out.get("f0_hz") or out.get("f0"))
            conf = _to_numpy(out.get("f0_confidence") or out.get("confidence"))
            if f0 is not None:
                return f0.squeeze(), conf.squeeze() if conf is not None else None

    raise RuntimeError("DDSP f0 extraction not available in this install")


def transcribe_ddsp(
    audio_path: str,
    *,
    sample_rate: int,
    frame_rate: int = 250,
    fmin: float = 50.0,
    fmax: float = 1200.0,
    confidence_threshold: float = 0.3,
    min_note_duration: float = 0.07,
    stable_frames_required: int = 3,
    hangover_frames: int = 3,
) -> List[dict]:
    audio, sr = librosa.load(audio_path, sr=sample_rate, mono=True)
    if audio.size == 0:
        return []
    f0_hz, f0_conf = _extract_f0_with_ddsp(audio, sr, frame_rate=frame_rate)
    f0_hz = np.asarray(f0_hz, dtype=np.float32)
    if f0_conf is None:
        f0_conf = np.ones_like(f0_hz)
    else:
        f0_conf = np.asarray(f0_conf, dtype=np.float32)

    f0_hz = np.clip(f0_hz, fmin, fmax)
    times = np.arange(f0_hz.shape[0]) / float(frame_rate)

    notes = []
    current_note = None
    current_start = None
    current_velocity = 80
    candidate_note = None
    candidate_count = 0
    invalid_count = 0

    def close_note(end_time):
        nonlocal current_note, current_start, current_velocity
        if current_note is None or current_start is None:
            return
        if end_time - current_start >= min_note_duration:
            notes.append(
                {
                    "startSec": current_start,
                    "endSec": end_time,
                    "note": int(current_note),
                    "velocity": int(current_velocity),
                    "channel": 0,
                }
            )
        current_note = None
        current_start = None

    for idx, freq in enumerate(f0_hz):
        conf = float(f0_conf[idx]) if idx < f0_conf.size else 0.0
        if conf < confidence_threshold or freq <= 0:
            invalid_count += 1
            if invalid_count >= hangover_frames:
                close_note(times[idx])
                candidate_note = None
                candidate_count = 0
            continue
        invalid_count = 0
        note = hz_to_midi(freq)
        if note <= 0:
            close_note(times[idx])
            continue
        if current_note is None:
            current_note = note
            current_start = times[idx]
            current_velocity = int(30 + min(1.0, conf) * 97)
            continue
        if note != current_note:
            if candidate_note == note:
                candidate_count += 1
            else:
                candidate_note = note
                candidate_count = 1
            if candidate_count >= stable_frames_required:
                close_note(times[idx])
                current_note = note
                current_start = times[idx]
                current_velocity = int(30 + min(1.0, conf) * 97)
                candidate_note = None
                candidate_count = 0
        else:
            candidate_note = None
            candidate_count = 0
            current_velocity = max(current_velocity, int(30 + min(1.0, conf) * 97))

    close_note(times[-1] if times.size else 0)
    return notes


def _instrument_profile(instrument_label: Optional[str]):
    key = (instrument_label or "").lower()
    # (brightness, odd_bias, noise_mix)
    if "piano" in key:
        return 0.7, 0.0, 0.02
    if "guitar" in key:
        return 0.6, 0.2, 0.03
    if "bass" in key:
        return 0.35, 0.1, 0.01
    if "string" in key:
        return 0.5, 0.0, 0.02
    if "synth" in key:
        return 0.8, 0.0, 0.04
    if "drum" in key or "beat" in key:
        return 0.9, 0.0, 0.12
    return 0.6, 0.0, 0.02


def _build_harmonic_distribution(n_frames: int, n_harmonics: int, brightness: float, odd_bias: float):
    base = np.linspace(1.0, max(0.02, 1.0 - brightness), n_harmonics, dtype=np.float32)
    if odd_bias > 0:
        for i in range(n_harmonics):
            if i % 2 == 0:
                base[i] *= 1.0 + odd_bias
            else:
                base[i] *= 1.0 - odd_bias
    base = base / np.sum(base)
    return np.tile(base, (n_frames, 1))


def _fallback_additive(audio: np.ndarray, f0_hz: np.ndarray, sr: int, frame_rate: int, brightness: float, odd_bias: float):
    import tensorflow as tf
    import ddsp

    loudness = None
    if hasattr(ddsp, "spectral_ops") and hasattr(ddsp.spectral_ops, "compute_loudness"):
        loudness = ddsp.spectral_ops.compute_loudness(audio, sample_rate=sr, frame_rate=frame_rate)
    if loudness is None:
        frame_length = int(sr / frame_rate)
        hop = frame_length
        rms = librosa.feature.rms(y=audio, frame_length=frame_length, hop_length=hop)[0]
        loudness = librosa.amplitude_to_db(rms, ref=np.max)

    loudness = np.asarray(loudness, dtype=np.float32)
    amp = np.clip(10 ** (loudness / 20.0), 1e-4, 1.0)

    n_frames = min(len(f0_hz), len(amp))
    f0_hz = f0_hz[:n_frames]
    amp = amp[:n_frames]

    n_harmonics = 60
    harmonic_distribution = _build_harmonic_distribution(n_frames, n_harmonics, brightness, odd_bias)

    f0_t = tf.convert_to_tensor(f0_hz[None, :, None], dtype=tf.float32)
    amp_t = tf.convert_to_tensor(amp[None, :, None], dtype=tf.float32)
    harm_t = tf.convert_to_tensor(harmonic_distribution[None, :, :], dtype=tf.float32)
    n_samples = int(len(audio))
    if hasattr(ddsp, "core") and hasattr(ddsp.core, "harmonic_synthesis"):
        synth_audio = ddsp.core.harmonic_synthesis(f0_t, amp_t, harm_t, n_samples, sr)
    else:
        synth = ddsp.synths.Additive(n_samples=n_samples, sample_rate=sr)
        synth_audio = synth(amp_t, harm_t, f0_t)
    return synth_audio.numpy().squeeze()


def synthesize_ddsp_audio(
    audio_path: str,
    output_path: str,
    *,
    sample_rate: int,
    instrument_label: Optional[str] = None,
    frame_rate: int = 250,
    fmin: float = 50.0,
    fmax: float = 1200.0,
    require_model: bool = False,
) -> dict:
    audio, sr = librosa.load(audio_path, sr=sample_rate, mono=True)
    if audio.size == 0:
        raise RuntimeError("Empty audio for DDSP synthesis")
    f0_hz, f0_conf = _extract_f0_with_ddsp(audio, sr, frame_rate=frame_rate)
    f0_hz = np.asarray(f0_hz, dtype=np.float32)
    f0_hz = np.clip(f0_hz, fmin, fmax)

    brightness, odd_bias, noise_mix = _instrument_profile(instrument_label)
    try:
        model_info = resolve_ddsp_model(instrument_label)
        model_bundle = load_ddsp_model(model_info) if model_info else None
        features = build_ddsp_features(
            audio,
            sr,
            frame_rate=frame_rate,
            f0_hz=f0_hz,
        )
        if model_bundle:
            audio_out = synthesize_with_model(model_bundle, features, sr)
        else:
            if require_model:
                raise RuntimeError("DDSP model not configured for this instrument.")
            audio_out = _fallback_additive(
                audio,
                f0_hz,
                sr,
                frame_rate,
                brightness,
                odd_bias,
            )
        if noise_mix > 0:
            noise = np.random.randn(audio_out.shape[0]).astype(np.float32)
            audio_out = (1 - noise_mix) * audio_out + noise_mix * noise
    except Exception:
        if require_model:
            raise
        # Fallback: simple sine resynthesis
        n_samples = int(len(audio))
        f0_up = np.interp(
            np.linspace(0, len(f0_hz) - 1, n_samples),
            np.arange(len(f0_hz)),
            f0_hz,
        )
        phase = 2 * np.pi * np.cumsum(f0_up) / float(sr)
        audio_out = np.sin(phase).astype(np.float32)
        if noise_mix > 0:
            noise = np.random.randn(audio_out.shape[0]).astype(np.float32)
            audio_out = (1 - noise_mix) * audio_out + noise_mix * noise

    peak = float(np.max(np.abs(audio_out))) if audio_out.size else 0.0
    if peak > 0:
        audio_out = audio_out * (0.95 / peak)
    sf.write(output_path, audio_out, sr)
    logging.getLogger("voice_midi").info("DDSP synth output: %s", output_path)
    duration = audio_out.shape[0] / float(sr) if audio_out.size else 0.0
    return {"path": output_path, "durationSec": duration, "sampleRate": sr}
