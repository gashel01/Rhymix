import math
from typing import Optional, Tuple

import librosa
import numpy as np
from scipy.signal import butter, lfilter


def _db_to_gain(db: float) -> float:
    return float(10 ** (db / 20.0))


def _lowpass(audio: np.ndarray, sr: int, cutoff_hz: float) -> np.ndarray:
    if cutoff_hz <= 0:
        return audio
    nyq = 0.5 * sr
    cutoff = min(cutoff_hz, nyq - 10)
    if cutoff <= 0:
        return audio
    b, a = butter(4, cutoff / nyq, btype="low")
    return lfilter(b, a, audio)


def _highpass(audio: np.ndarray, sr: int, cutoff_hz: float) -> np.ndarray:
    if cutoff_hz <= 0:
        return audio
    nyq = 0.5 * sr
    cutoff = min(cutoff_hz, nyq - 10)
    if cutoff <= 0:
        return audio
    b, a = butter(2, cutoff / nyq, btype="high")
    return lfilter(b, a, audio)


def apply_eq(
    audio: np.ndarray,
    sr: int,
    *,
    low_db: float = 0.0,
    mid_db: float = 0.0,
    high_db: float = 0.0,
    low_freq: float = 120.0,
    high_freq: float = 6000.0,
) -> np.ndarray:
    if not np.isfinite(audio).any():
        return audio
    if abs(low_db) < 0.01 and abs(mid_db) < 0.01 and abs(high_db) < 0.01:
        return audio
    low = _lowpass(audio, sr, float(low_freq))
    high = _highpass(audio, sr, float(high_freq))
    mid = audio - low - high
    return (
        low * _db_to_gain(low_db)
        + mid * _db_to_gain(mid_db)
        + high * _db_to_gain(high_db)
    )


def apply_compressor(
    audio: np.ndarray,
    sr: int,
    *,
    threshold_db: float = -18.0,
    ratio: float = 2.5,
    attack_ms: float = 8.0,
    release_ms: float = 80.0,
    makeup_db: float = 0.0,
) -> np.ndarray:
    if audio.size == 0 or ratio <= 1.0:
        return audio
    attack = math.exp(-1.0 / max(1.0, sr * attack_ms / 1000.0))
    release = math.exp(-1.0 / max(1.0, sr * release_ms / 1000.0))
    env = np.zeros_like(audio, dtype=np.float32)
    abs_audio = np.abs(audio).astype(np.float32)
    for i, x in enumerate(abs_audio):
        if i == 0:
            env[i] = x
        else:
            coeff = attack if x > env[i - 1] else release
            env[i] = coeff * env[i - 1] + (1.0 - coeff) * x
    env_db = 20.0 * np.log10(env + 1e-8)
    over = env_db - float(threshold_db)
    gain_db = np.where(over > 0, over * (1.0 / ratio - 1.0), 0.0)
    gain = np.power(10.0, (gain_db + float(makeup_db)) / 20.0).astype(np.float32)
    return audio * gain


def apply_noise_reduction(
    audio: np.ndarray,
    sr: int,
    *,
    strength: float = 0.25,
    n_fft: int = 1024,
    hop_length: int = 256,
) -> np.ndarray:
    if audio.size == 0 or strength <= 0:
        return audio
    stft = librosa.stft(audio.astype(np.float32), n_fft=n_fft, hop_length=hop_length)
    mag = np.abs(stft)
    phase = np.angle(stft)
    noise = np.percentile(mag, 20, axis=1, keepdims=True)
    reduced = np.maximum(mag - noise * float(strength), 0.0)
    out = librosa.istft(reduced * np.exp(1j * phase), hop_length=hop_length, length=audio.shape[0])
    return out.astype(audio.dtype)


def apply_pitch_shift(
    audio: np.ndarray,
    sr: int,
    *,
    semitones: float = 0.0,
) -> np.ndarray:
    if audio.size == 0 or abs(float(semitones)) < 0.01:
        return audio
    return librosa.effects.pitch_shift(audio, sr=sr, n_steps=float(semitones))


def process_voice_audio(
    audio: np.ndarray,
    sr: int,
    *,
    eq_low_db: float = 1.5,
    eq_mid_db: float = 0.0,
    eq_high_db: float = 1.5,
    eq_low_freq: float = 120.0,
    eq_high_freq: float = 6000.0,
    compressor_threshold_db: float = -18.0,
    compressor_ratio: float = 2.5,
    compressor_attack_ms: float = 8.0,
    compressor_release_ms: float = 80.0,
    compressor_makeup_db: float = 0.0,
    noise_reduction_strength: float = 0.25,
    pitch_shift_semitones: float = 0.0,
) -> np.ndarray:
    out = audio.astype(np.float32)
    out = apply_noise_reduction(out, sr, strength=noise_reduction_strength)
    out = apply_eq(
        out,
        sr,
        low_db=eq_low_db,
        mid_db=eq_mid_db,
        high_db=eq_high_db,
        low_freq=eq_low_freq,
        high_freq=eq_high_freq,
    )
    out = apply_compressor(
        out,
        sr,
        threshold_db=compressor_threshold_db,
        ratio=compressor_ratio,
        attack_ms=compressor_attack_ms,
        release_ms=compressor_release_ms,
        makeup_db=compressor_makeup_db,
    )
    out = apply_pitch_shift(out, sr, semitones=pitch_shift_semitones)
    return out
