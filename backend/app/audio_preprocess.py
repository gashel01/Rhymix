import math
import os
from pathlib import Path
from typing import Optional

import librosa
import numpy as np
import soundfile as sf
from scipy.signal import butter, lfilter

from .audio_processing import process_voice_audio

def _to_mono(audio: np.ndarray) -> np.ndarray:
    if audio.ndim == 1:
        return audio
    return np.mean(audio, axis=1)


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


def _apply_gate(audio: np.ndarray, sr: int, gate_db: float, mode: str = "soft") -> np.ndarray:
    if gate_db is None:
        return audio
    frame_length = 2048
    hop_length = 512
    rms = librosa.feature.rms(y=audio, frame_length=frame_length, hop_length=hop_length)[0]
    rms_db = librosa.amplitude_to_db(rms, ref=np.max)
    if mode == "off":
        return audio
    if mode == "hard":
        mask = rms_db >= gate_db
        if not np.any(mask):
            return audio * 0
        gains = mask.astype(np.float32)
    else:
        # Soft gate: attenuate below threshold instead of muting
        # Map [gate_db - 20, gate_db] -> [0.15, 1.0]
        gains = (rms_db - (gate_db - 20)) / 20.0
        gains = np.clip(gains, 0.15, 1.0)
    mask_samples = np.repeat(gains, hop_length)
    if mask_samples.size < audio.size:
        pad = np.ones(audio.size - mask_samples.size, dtype=mask_samples.dtype)
        mask_samples = np.concatenate([mask_samples, pad])
    else:
        mask_samples = mask_samples[: audio.size]
    return audio * mask_samples.astype(audio.dtype)


def preprocess_audio(
    input_path: str,
    output_path: str,
    *,
    target_sr: Optional[int] = None,
    gate_db: Optional[float] = -45.0,
    gate_mode: str = "soft",
    low_pass_hz: Optional[float] = 6000.0,
    high_pass_hz: Optional[float] = 80.0,
    trim_db: Optional[float] = 35.0,
    normalize: bool = True,
    enable_processing: Optional[bool] = None,
    eq_low_db: Optional[float] = None,
    eq_mid_db: Optional[float] = None,
    eq_high_db: Optional[float] = None,
    eq_low_freq: Optional[float] = None,
    eq_high_freq: Optional[float] = None,
    compressor_threshold_db: Optional[float] = None,
    compressor_ratio: Optional[float] = None,
    compressor_attack_ms: Optional[float] = None,
    compressor_release_ms: Optional[float] = None,
    compressor_makeup_db: Optional[float] = None,
    noise_reduction_strength: Optional[float] = None,
    pitch_shift_semitones: Optional[float] = None,
):
    audio, sr = sf.read(input_path, dtype="float32", always_2d=False)
    audio = _to_mono(audio)
    if target_sr and target_sr != sr:
        audio = librosa.resample(audio, orig_sr=sr, target_sr=target_sr)
        sr = target_sr
    if trim_db:
        audio, _ = librosa.effects.trim(audio, top_db=float(trim_db))
    if high_pass_hz:
        audio = _highpass(audio, sr, float(high_pass_hz))
    if low_pass_hz:
        audio = _lowpass(audio, sr, float(low_pass_hz))
    if gate_db is not None:
        audio = _apply_gate(audio, sr, float(gate_db), mode=gate_mode or "soft")
    if enable_processing is None:
        enable_processing = os.getenv("VOICE_MIDI_PROCESSING", "1").lower() not in {"0", "false", "no"}
    if enable_processing:
        if eq_low_db is None:
            eq_low_db = float(os.getenv("VOICE_MIDI_EQ_LOW_DB", "1.5"))
        if eq_mid_db is None:
            eq_mid_db = float(os.getenv("VOICE_MIDI_EQ_MID_DB", "0.0"))
        if eq_high_db is None:
            eq_high_db = float(os.getenv("VOICE_MIDI_EQ_HIGH_DB", "1.5"))
        if eq_low_freq is None:
            eq_low_freq = float(os.getenv("VOICE_MIDI_EQ_LOW_FREQ", "120"))
        if eq_high_freq is None:
            eq_high_freq = float(os.getenv("VOICE_MIDI_EQ_HIGH_FREQ", "6000"))
        if compressor_threshold_db is None:
            compressor_threshold_db = float(os.getenv("VOICE_MIDI_COMPRESSOR_THRESHOLD", "-18"))
        if compressor_ratio is None:
            compressor_ratio = float(os.getenv("VOICE_MIDI_COMPRESSOR_RATIO", "2.5"))
        if compressor_attack_ms is None:
            compressor_attack_ms = float(os.getenv("VOICE_MIDI_COMPRESSOR_ATTACK_MS", "8"))
        if compressor_release_ms is None:
            compressor_release_ms = float(os.getenv("VOICE_MIDI_COMPRESSOR_RELEASE_MS", "80"))
        if compressor_makeup_db is None:
            compressor_makeup_db = float(os.getenv("VOICE_MIDI_COMPRESSOR_MAKEUP_DB", "0"))
        if noise_reduction_strength is None:
            noise_reduction_strength = float(os.getenv("VOICE_MIDI_NOISE_REDUCTION_STRENGTH", "0.25"))
        if pitch_shift_semitones is None:
            pitch_shift_semitones = float(os.getenv("VOICE_MIDI_PITCH_SHIFT", "0"))
        audio = process_voice_audio(
            audio,
            sr,
            eq_low_db=float(eq_low_db),
            eq_mid_db=float(eq_mid_db),
            eq_high_db=float(eq_high_db),
            eq_low_freq=float(eq_low_freq),
            eq_high_freq=float(eq_high_freq),
            compressor_threshold_db=float(compressor_threshold_db),
            compressor_ratio=float(compressor_ratio),
            compressor_attack_ms=float(compressor_attack_ms),
            compressor_release_ms=float(compressor_release_ms),
            compressor_makeup_db=float(compressor_makeup_db),
            noise_reduction_strength=float(noise_reduction_strength),
            pitch_shift_semitones=float(pitch_shift_semitones),
        )
    if normalize:
        peak = float(np.max(np.abs(audio))) if audio.size else 0.0
        if peak > 0:
            audio = audio * (0.95 / peak)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(output_path, audio, sr)
    return str(output_path)
