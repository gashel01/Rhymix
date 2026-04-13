import math
from typing import List, Optional

import librosa
import numpy as np
import torch
import torchcrepe
import logging

logger = logging.getLogger("voice_midi")


def hz_to_midi(freq: float) -> int:
    if freq <= 0:
        return 0
    return int(round(69 + 12 * math.log2(freq / 440.0)))


def _median_filter(values: np.ndarray, width: int = 5) -> np.ndarray:
    if width <= 1 or values.size == 0:
        return values
    pad = width // 2
    padded = np.pad(values, (pad, pad), mode="edge")
    out = np.zeros_like(values)
    for i in range(values.size):
        out[i] = np.median(padded[i : i + width])
    return out


def transcribe_crepe_frames(
    audio_path: str,
    *,
    sample_rate: int,
    step_size_ms: int = 10,
    fmin: float = 50.0,
    fmax: float = 800.0,
) -> dict:
    """
    Return frame-wise f0 and confidence for CREPE analysis.
    """
    logger.info("CREPE: loading audio %s", audio_path)
    audio, sr = librosa.load(audio_path, sr=sample_rate, mono=True)
    logger.info("CREPE: audio length=%d sr=%d", audio.shape[0], sr)
    if audio.size:
        peak = float(np.max(np.abs(audio)))
        rms = float(np.sqrt(np.mean(audio**2)))
        logger.info("CREPE: audio peak=%.4f rms=%.6f", peak, rms)
    if audio.size == 0:
        logger.warning("CREPE: empty audio")
        return {"times": np.array([]), "f0_hz": np.array([]), "confidence": np.array([])}
    audio_tensor = torch.tensor(audio, dtype=torch.float32).unsqueeze(0)
    actual_step_sec = step_size_ms / 1000.0
    with torch.no_grad():
        logger.info("CREPE: running predict (step=%dms fmin=%.1f fmax=%.1f)", step_size_ms, fmin, fmax)
        try:
            pitch, periodicity = torchcrepe.predict(
                audio_tensor,
                sample_rate,
                step_size=step_size_ms,
                fmin=fmin,
                fmax=fmax,
                batch_size=2048,
                device="cpu",
                return_periodicity=True,
            )
        except TypeError:
            hop_length = max(1, int(sample_rate * (step_size_ms / 1000.0)))
            actual_step_sec = hop_length / float(sample_rate)
            pitch, periodicity = torchcrepe.predict(
                audio_tensor,
                sample_rate,
                hop_length=hop_length,
                fmin=fmin,
                fmax=fmax,
                batch_size=2048,
                device="cpu",
                return_periodicity=True,
            )
    pitch = pitch.squeeze()
    periodicity = periodicity.squeeze()
    if pitch.dim() == 0:
        pitch = pitch.view(1, 1)
    elif pitch.dim() == 1:
        pitch = pitch.unsqueeze(0)
    if periodicity.dim() == 0:
        periodicity = periodicity.view(1, 1)
    elif periodicity.dim() == 1:
        periodicity = periodicity.unsqueeze(0)
    logger.info("CREPE: raw frames=%d", pitch.shape[1] if pitch.dim() > 1 else pitch.shape[0])
    pitch = torchcrepe.filter.median(pitch, 5)
    pitch = torchcrepe.filter.mean(pitch, 3)
    periodicity = torchcrepe.filter.median(periodicity, 5)
    pitch = pitch.squeeze(0).cpu().numpy()
    periodicity = periodicity.squeeze(0).cpu().numpy()
    pitch = _median_filter(pitch, width=5)
    times = np.arange(pitch.shape[0]) * actual_step_sec
    return {"times": times, "f0_hz": pitch, "confidence": periodicity}


def transcribe_crepe(
    audio_path: str,
    *,
    sample_rate: int,
    step_size_ms: int = 10,
    fmin: float = 50.0,
    fmax: float = 800.0,
    confidence_threshold: float = 0.3,
    min_note_duration: float = 0.07,
    stable_frames_required: int = 3,
    hangover_frames: int = 3,
) -> List[dict]:
    frame_data = transcribe_crepe_frames(
        audio_path,
        sample_rate=sample_rate,
        step_size_ms=step_size_ms,
        fmin=fmin,
        fmax=fmax,
    )
    pitch = frame_data["f0_hz"]
    periodicity = frame_data["confidence"]
    times = frame_data["times"]

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

    for idx, freq in enumerate(pitch):
        conf = periodicity[idx] if idx < periodicity.size else 0
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
    logger.info("CREPE: notes=%d", len(notes))
    return notes
