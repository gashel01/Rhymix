import os
import uuid
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt

from backend.features.studio.assets import probe_audio
from backend.paths.manager import paths


def _ensure_stereo(audio: np.ndarray) -> np.ndarray:
    if audio.ndim == 1:
        return np.stack([audio, audio], axis=0)
    if audio.shape[0] == 1:
        return np.repeat(audio, 2, axis=0)
    if audio.shape[0] > 2:
        return audio[:2]
    return audio


def _sos_filter(audio: np.ndarray, sr: int, cutoff, btype: str) -> np.ndarray:
    nyq = 0.5 * sr
    if isinstance(cutoff, (list, tuple)):
        cutoff = [max(10.0, min(nyq - 10.0, c)) for c in cutoff]
        normalized = [c / nyq for c in cutoff]
    else:
        cutoff = max(10.0, min(nyq - 10.0, cutoff))
        normalized = cutoff / nyq
    sos = butter(4, normalized, btype=btype, output="sos")
    filtered = []
    for ch in audio:
        filtered.append(sosfilt(sos, ch))
    return np.stack(filtered, axis=0)


def _split_harmonic_percussive(audio: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    harmonic = np.zeros_like(audio)
    percussive = np.zeros_like(audio)
    for i in range(audio.shape[0]):
        h, p = librosa.effects.hpss(audio[i])
        harmonic[i] = h
        percussive[i] = p
    return harmonic, percussive


def _maybe_remove_vocals(audio: np.ndarray, sr: int) -> np.ndarray:
    try:
        from vocal import get_model, separate_vocal
        import torch
    except Exception:
        # Fallback to original audio if UVR isn't available.
        return audio

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = get_model(device)
    vocals = separate_vocal(model, audio, device, silent=True)

    vocals = _ensure_stereo(vocals)
    audio = _ensure_stereo(audio)
    if vocals.shape[1] > audio.shape[1]:
        vocals = vocals[:, : audio.shape[1]]
    elif vocals.shape[1] < audio.shape[1]:
        audio = audio[:, : vocals.shape[1]]
    return audio - vocals


def extract_uvr_multi_stems(source_path: str, stem_names: list[str] | None = None) -> list[dict]:
    if not source_path:
        raise RuntimeError("sourceAssetPath is required for UVR stem extraction.")

    raw = os.environ.get("STUDIO_UVR_STEMS") or ""
    if stem_names is None:
        stem_names = [s.strip() for s in raw.split(",") if s.strip()]
    if not stem_names:
        stem_names = ["drums", "bass", "mids", "highs"]

    audio, sr = librosa.load(source_path, sr=44100, mono=False)
    audio = _ensure_stereo(audio)

    instrumental = _maybe_remove_vocals(audio, sr)
    harmonic, percussive = _split_harmonic_percussive(instrumental)

    bass = _sos_filter(harmonic, sr, 200, "lowpass")
    highs = _sos_filter(harmonic, sr, 5000, "highpass")
    mids = harmonic - bass - highs

    stem_map = {
        "instrumental": instrumental,
        "drums": percussive,
        "percussion": percussive,
        "bass": bass,
        "mids": mids,
        "mid": mids,
        "highs": highs,
        "high": highs,
        "harmonic": harmonic,
    }

    stems = []
    for name in stem_names:
        key = name.strip().lower()
        if key not in stem_map:
            continue
        output_name = f"uvr_stem_{key}_{uuid.uuid4().hex}.wav"
        output_path = paths.EXPORT_DIR / output_name
        output_path.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(output_path), stem_map[key].T, sr)
        info = probe_audio(output_path)
        stems.append(
            {
                "assetId": f"uvr_stem:{uuid.uuid4().hex}",
                "assetPath": str(output_path),
                "assetUrl": f"/api/download/exports/{output_name}",
                "durationSec": info.get("durationSec", 0.0),
                "sampleRate": info.get("sampleRate"),
                "trackName": key,
                "label": key.replace("_", " ").title(),
            }
        )

    if not stems:
        raise RuntimeError("No stems were produced. Check STUDIO_UVR_STEMS configuration.")

    return stems
