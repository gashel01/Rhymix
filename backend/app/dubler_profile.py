import json
import logging
from pathlib import Path
from typing import Dict, Optional

import numpy as np

from .crepe_adapter import transcribe_crepe_frames
from .dubler_melody import _compute_rms_series, _align_series

logger = logging.getLogger("voice_midi")


def calibrate_voice_profile(
    audio_path: str,
    *,
    sample_rate: int,
    step_size_ms: int = 10,
    fmin: float = 50.0,
    fmax: float = 1200.0,
    base_conf: float = 0.3,
) -> Dict:
    """
    Analyze a calibration recording and return suggested Dubler tuning values.
    """
    frame_data = transcribe_crepe_frames(
        audio_path, sample_rate=sample_rate, step_size_ms=step_size_ms, fmin=fmin, fmax=fmax
    )
    times = frame_data["times"]
    f0_hz = frame_data["f0_hz"]
    conf = frame_data["confidence"]
    if times.size == 0:
        return {
            "noise_floor_rms": 0.0,
            "confidence_threshold": base_conf,
            "fmin": fmin,
            "fmax": fmax,
            "gate_ratio": 2.5,
            "onset_sensitivity": 0.25,
        }

    hop_length = max(1, int(sample_rate * (times[1] - times[0]))) if times.size > 1 else 512
    import librosa

    audio, _ = librosa.load(audio_path, sr=sample_rate, mono=True)
    rms_series, rms_times = _compute_rms_series(audio, sample_rate, hop_length)
    rms = _align_series(rms_series, rms_times, times)

    quiet = rms[conf < (base_conf * 0.6)]
    if quiet.size < 5:
        quiet = rms
    noise_floor = float(np.percentile(quiet, 20))

    voiced = conf >= max(base_conf, 0.2)
    voiced_f0 = f0_hz[voiced]
    if voiced_f0.size:
        fmin_suggest = float(np.percentile(voiced_f0, 10))
        fmax_suggest = float(np.percentile(voiced_f0, 90))
    else:
        fmin_suggest = fmin
        fmax_suggest = fmax

    conf_suggest = float(np.clip(np.percentile(conf, 40), 0.2, 0.6))
    rms_voiced = rms[voiced] if voiced.any() else rms
    if rms_voiced.size:
        gate_ratio = float(np.clip(np.median(rms_voiced) / max(noise_floor, 1e-6), 2.0, 5.0))
    else:
        gate_ratio = 2.5

    profile = {
        "noise_floor_rms": noise_floor,
        "confidence_threshold": conf_suggest,
        "fmin": fmin_suggest,
        "fmax": fmax_suggest,
        "gate_ratio": gate_ratio,
        "onset_sensitivity": 0.25,
    }
    logger.info("Dubler Profile: %s", profile)
    return profile


def save_profile(path: str, profile: Dict) -> None:
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(profile, indent=2), encoding="utf-8")


def load_profile(path: str) -> Optional[Dict]:
    p = Path(path)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None
