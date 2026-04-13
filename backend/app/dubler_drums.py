
import argparse
import json
import logging
import math
import random
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import librosa
import numpy as np
from joblib import dump, load
from sklearn.calibration import CalibratedClassifierCV
from sklearn.model_selection import StratifiedKFold, cross_val_predict, cross_val_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC

try:
    import sounddevice as sd  # optional
except Exception:
    sd = None

logger = logging.getLogger("voice_midi")

LABELS = ["kick", "snare", "hat", "clap"]
MIDI_MAP = {"kick": 36, "snare": 38, "clap": 39, "hat": 42}
CALIBRATION_FILENAME = "drum_calibration.json"
MODEL_FILENAME = "drum_model.joblib"
SEED = 1337

random.seed(SEED)
np.random.seed(SEED)


def normalize_label(label: str) -> Optional[str]:
    """Normalize label string to canonical class."""
    if not label:
        return None
    key = label.strip().lower()
    aliases = {
        "bd": "kick",
        "bass": "kick",
        "sd": "snare",
        "hh": "hat",
        "hihat": "hat",
        "hi-hat": "hat",
    }
    key = aliases.get(key, key)
    return key if key in LABELS else None


def _calibration_path(base_dir: Path) -> Path:
    return base_dir / CALIBRATION_FILENAME


def _model_path(base_dir: Path) -> Path:
    return base_dir / MODEL_FILENAME


def list_audio_devices() -> List[dict]:
    """Return available input devices if sounddevice is installed."""
    if sd is None:
        return []
    devices = []
    try:
        for idx, dev in enumerate(sd.query_devices()):
            if dev.get("max_input_channels", 0) > 0:
                devices.append(
                    {
                        "index": idx,
                        "name": dev.get("name", ""),
                        "max_input_channels": int(dev.get("max_input_channels", 0)),
                        "default_samplerate": float(dev.get("default_samplerate", 0.0)),
                    }
                )
    except Exception:
        return []
    return devices


def _require_sounddevice() -> None:
    if sd is None:
        raise RuntimeError("sounddevice is not installed. Install sounddevice to use mic features.")


def load_calibration(base_dir: Path) -> dict:
    """Load calibration JSON with defaults."""
    path = _calibration_path(base_dir)
    if not path.exists():
        return {"version": 1, "sample_rate": 16000, "labels": LABELS, "samples": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"version": 1, "sample_rate": 16000, "labels": LABELS, "samples": []}
    if "version" not in data:
        data["version"] = 1
    if "sample_rate" not in data:
        data["sample_rate"] = 16000
    if "labels" not in data:
        data["labels"] = LABELS
    if "samples" not in data:
        data["samples"] = []
    return data


def save_calibration(base_dir: Path, data: dict) -> None:
    """Save calibration JSON."""
    path = _calibration_path(base_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def reset_calibration(base_dir: Path) -> None:
    """Delete calibration JSON."""
    path = _calibration_path(base_dir)
    if path.exists():
        path.unlink()


def _to_mono(audio: np.ndarray) -> np.ndarray:
    if audio.ndim == 1:
        return audio
    return np.mean(audio, axis=1 if audio.shape[0] < audio.shape[-1] else 0)


def _fade(audio: np.ndarray, sr: int, fade_ms: float = 5.0) -> np.ndarray:
    n = int(sr * fade_ms / 1000.0)
    if n <= 1 or audio.size < 2 * n:
        return audio
    ramp = np.linspace(0.0, 1.0, n, dtype=np.float32)
    audio[:n] *= ramp
    audio[-n:] *= ramp[::-1]
    return audio


def _pre_emphasis(audio: np.ndarray, coeff: float = 0.97) -> np.ndarray:
    if audio.size == 0:
        return audio
    return np.append(audio[0], audio[1:] - coeff * audio[:-1])


def _normalize_peak(audio: np.ndarray) -> np.ndarray:
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 0:
        return audio * (1.0 / peak)
    return audio


def _silence_reject(audio: np.ndarray, rms_thresh: float = 0.02) -> bool:
    if audio.size == 0:
        return True
    rms = float(np.sqrt(np.mean(audio**2)))
    return rms < rms_thresh


def _clip_ratio(audio: np.ndarray, clip_thresh: float = 0.99) -> float:
    if audio.size == 0:
        return 0.0
    return float(np.mean(np.abs(audio) >= clip_thresh))


def _estimate_snr_db(audio: np.ndarray, sr: int) -> float:
    if audio.size == 0:
        return 0.0
    n = max(1, int(0.02 * sr))
    noise = audio[:n]
    signal = audio
    rms_noise = float(np.sqrt(np.mean(noise**2))) if noise.size else 1e-9
    rms_signal = float(np.sqrt(np.mean(signal**2))) if signal.size else 1e-9
    return 20.0 * math.log10((rms_signal + 1e-9) / (rms_noise + 1e-9))


def _ensure_min_length(y: np.ndarray, size: int) -> np.ndarray:
    if y.size >= size:
        return y
    return np.pad(y, (0, size - y.size))


def _feature_vector(audio: np.ndarray, sr: int) -> np.ndarray:
    y = audio.astype(np.float32)
    y = _pre_emphasis(y, 0.97)
    y = _normalize_peak(y)
    y = _fade(y, sr, 5.0)
    y = _ensure_min_length(y, 1024)

    mel = librosa.feature.melspectrogram(y=y, sr=sr, n_mels=40, n_fft=1024, hop_length=256)
    mel_db = librosa.power_to_db(mel + 1e-9)
    mel_mean = np.mean(mel_db, axis=1)
    mel_std = np.std(mel_db, axis=1)

    mfcc = librosa.feature.mfcc(S=mel_db, n_mfcc=13)
    d1 = librosa.feature.delta(mfcc)
    d2 = librosa.feature.delta(mfcc, order=2)
    mfcc_mean = np.mean(mfcc, axis=1)
    mfcc_std = np.std(mfcc, axis=1)
    d1_mean = np.mean(d1, axis=1)
    d1_std = np.std(d1, axis=1)
    d2_mean = np.mean(d2, axis=1)
    d2_std = np.std(d2, axis=1)

    centroid = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
    rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr, roll_percent=0.85)[0]
    bandwidth = librosa.feature.spectral_bandwidth(y=y, sr=sr)[0]
    flatness = librosa.feature.spectral_flatness(y=y)[0]
    contrast = librosa.feature.spectral_contrast(y=y, sr=sr)

    spec_mean = np.array(
        [np.mean(centroid), np.mean(rolloff), np.mean(bandwidth), np.mean(flatness)], dtype=np.float32
    )
    spec_std = np.array(
        [np.std(centroid), np.std(rolloff), np.std(bandwidth), np.std(flatness)], dtype=np.float32
    )
    contrast_mean = np.mean(contrast, axis=1)
    contrast_std = np.std(contrast, axis=1)

    rms = librosa.feature.rms(y=y)[0]
    zcr = librosa.feature.zero_crossing_rate(y=y)[0]
    rms_mean = np.mean(rms)
    rms_std = np.std(rms)
    zcr_mean = np.mean(zcr)
    zcr_std = np.std(zcr)

    peak = float(np.max(np.abs(y))) if y.size else 0.0
    rms_val = float(np.sqrt(np.mean(y**2))) if y.size else 0.0
    crest = peak / (rms_val + 1e-9)
    peak_to_rms = peak / (rms_mean + 1e-9)

    temporal = np.array([rms_mean, rms_std, zcr_mean, zcr_std, crest, peak_to_rms], dtype=np.float32)

    feats = np.concatenate(
        [
            mel_mean,
            mel_std,
            mfcc_mean,
            mfcc_std,
            d1_mean,
            d1_std,
            d2_mean,
            d2_std,
            spec_mean,
            spec_std,
            contrast_mean,
            contrast_std,
            temporal,
        ]
    ).astype(np.float32)
    return feats


def _feature_len(sample: dict) -> Optional[int]:
    feats = sample.get("features")
    if isinstance(feats, (list, tuple, np.ndarray)):
        try:
            return int(len(feats))
        except Exception:
            return None
    return None


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom <= 1e-9:
        return 0.0
    return float(np.dot(a, b) / denom)


def _is_outlier(vec: np.ndarray, feats: List[np.ndarray], z_thresh: float = 3.5) -> bool:
    if len(feats) < 12:
        return False
    X = np.stack(feats, axis=0)
    mean = np.mean(X, axis=0)
    std = np.std(X, axis=0) + 1e-6
    z = np.abs((vec - mean) / std)
    score = float(np.linalg.norm(z) / math.sqrt(z.size))
    return score > z_thresh


def _quality_score(rms: float, snr_db: float, clip_ratio: float) -> float:
    snr_score = min(1.0, max(0.0, snr_db / 30.0))
    rms_score = min(1.0, max(0.0, rms / 0.2))
    clip_penalty = max(0.0, 1.0 - clip_ratio * 5.0)
    return float(snr_score * rms_score * clip_penalty)

def add_calibration_sample(
    audio_path: str,
    *,
    label: str,
    sample_rate: int,
    base_dir: Path,
    window_sec: float = 0.25,
) -> dict:
    """Add a single calibration sample from file."""
    norm_label = normalize_label(label)
    if not norm_label:
        return {"error": f"invalid label: {label}"}

    audio, sr = librosa.load(audio_path, sr=sample_rate, mono=True)
    audio = _to_mono(audio)
    if audio.size == 0:
        return {"error": "empty audio"}

    max_len = int(window_sec * sr)
    if audio.size > max_len:
        audio = audio[:max_len]

    if _silence_reject(audio):
        return {"error": "sample too silent"}

    feats = _feature_vector(audio, sr).tolist()
    data = load_calibration(base_dir)
    expected_len = data.get("feature_len")
    if expected_len is not None and expected_len != len(feats):
        return {
            "error": "feature length mismatch; reset calibration before adding new samples",
            "expected": expected_len,
            "got": len(feats),
        }
    data["version"] = 1
    data["sample_rate"] = int(sample_rate)
    data["labels"] = LABELS
    data["feature_len"] = len(feats)
    data.setdefault("samples", []).append(
        {"label": norm_label, "features": feats, "meta": {"source": audio_path, "sec": window_sec}}
    )
    save_calibration(base_dir, data)
    logger.info("Drum calibration: stored label=%s total=%d", norm_label, len(data["samples"]))
    return {"label": norm_label, "total": len(data["samples"])}


def _count_labels(samples: List[Dict]) -> Dict[str, int]:
    out = {k: 0 for k in LABELS}
    for s in samples:
        label = normalize_label(s.get("label", ""))
        if label in out:
            out[label] += 1
    return out


def _build_model(X: np.ndarray, y: np.ndarray):
    if len(np.unique(y)) < 2:
        return None
    clf = SVC(kernel="rbf", probability=False, class_weight="balanced", random_state=SEED)
    pipe = make_pipeline(StandardScaler(), clf)

    unique, counts = np.unique(y, return_counts=True)
    min_class = int(np.min(counts)) if counts.size else 0
    if len(y) >= 8 and min_class >= 2:
        cv_splits = min(3, min_class)
        skf = StratifiedKFold(n_splits=cv_splits, shuffle=True, random_state=SEED)
        calibrated = CalibratedClassifierCV(pipe, method="sigmoid", cv=skf)
        calibrated.fit(X, y)
        return calibrated

    clf = SVC(kernel="rbf", probability=True, class_weight="balanced", random_state=SEED)
    pipe = make_pipeline(StandardScaler(), clf)
    pipe.fit(X, y)
    return pipe


def train_and_save_model(*, base_dir: Path) -> dict:
    """Train classifier and save model."""
    data = load_calibration(base_dir)
    samples = data.get("samples", [])
    usable: List[Dict] = []
    expected_len: Optional[int] = None
    skipped = 0
    for s in samples:
        feat_len = _feature_len(s)
        if feat_len is None or feat_len <= 0:
            skipped += 1
            continue
        if expected_len is None:
            expected_len = feat_len
        if feat_len != expected_len:
            skipped += 1
            continue
        usable.append(s)
    if len(usable) < 8:
        return {
            "status": "insufficient_samples",
            "total": len(samples),
            "usable": len(usable),
            "skipped": skipped,
            "labels": _count_labels(usable),
        }

    X = np.array([s["features"] for s in usable], dtype=np.float32)
    y = np.array([normalize_label(s["label"]) for s in usable], dtype=object)
    mask = np.array([lbl in LABELS for lbl in y], dtype=bool)
    X = X[mask]
    y = y[mask]

    if X.size == 0 or len(np.unique(y)) < 2:
        return {
            "status": "insufficient_labels",
            "total": len(samples),
            "usable": len(usable),
            "skipped": skipped,
            "labels": _count_labels(usable),
        }

    report = {
        "status": "trained",
        "total": len(samples),
        "usable": len(usable),
        "skipped": skipped,
        "labels": _count_labels(usable),
    }

    if len(X) >= 12 and len(np.unique(y)) >= 2:
        cv = StratifiedKFold(n_splits=3, shuffle=True, random_state=SEED)
        scores = cross_val_score(
            make_pipeline(StandardScaler(), SVC(kernel="rbf", class_weight="balanced", random_state=SEED)),
            X,
            y,
            cv=cv,
        )
        report["cv_accuracy_mean"] = float(np.mean(scores))
        report["cv_accuracy_std"] = float(np.std(scores))
        try:
            preds = cross_val_predict(
                make_pipeline(StandardScaler(), SVC(kernel="rbf", class_weight="balanced", random_state=SEED)),
                X,
                y,
                cv=cv,
            )
            conf = {lbl: {k: 0 for k in LABELS} for lbl in LABELS}
            for true_lbl, pred_lbl in zip(y, preds):
                if true_lbl in LABELS and pred_lbl in LABELS:
                    conf[true_lbl][pred_lbl] += 1
            report["cv_confusion"] = conf
        except Exception:
            pass

    model = _build_model(X, y)
    if model is None:
        report["status"] = "training_failed"
        return report

    path = _model_path(base_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    dump(model, path)
    report["model_path"] = str(path)
    return report


def load_model(*, base_dir: Path):
    """Load trained model if present."""
    path = _model_path(base_dir)
    if not path.exists():
        return None
    try:
        return load(path)
    except Exception:
        return None


def _heuristic_label(audio: np.ndarray, sr: int) -> Tuple[str, float]:
    spectrum = np.abs(np.fft.rfft(audio))
    freqs = np.fft.rfftfreq(audio.size, 1.0 / sr)
    low = float(np.sum(spectrum[(freqs >= 20) & (freqs <= 150)]))
    high = float(np.sum(spectrum[(freqs >= 2000) & (freqs <= 8000)]))
    if low > high * 1.5:
        return "kick", 0.4
    if high > low * 1.5:
        return "hat", 0.4
    return "snare", 0.35


def _velocity_from_rms(rms: float) -> int:
    if rms <= 0:
        return 1
    compressed = min(1.0, rms / 0.4)
    vel = 30 + compressed * 97
    return int(max(1, min(127, vel)))


def _detect_onsets(audio: np.ndarray, sr: int, hop_length: int = 256) -> np.ndarray:
    onset_frames = librosa.onset.onset_detect(
        y=audio, sr=sr, hop_length=hop_length, backtrack=True, delta=0.2
    )
    return librosa.frames_to_time(onset_frames, sr=sr, hop_length=hop_length)


def _play_audio(audio: np.ndarray, sr: int) -> None:
    _require_sounddevice()
    try:
        sd.play(audio, sr)
        sd.wait()
    except Exception:
        pass


def _beep(sr: int, dur: float = 0.08, freq: float = 880.0) -> None:
    if sd is None:
        return
    t = np.linspace(0.0, dur, int(sr * dur), endpoint=False, dtype=np.float32)
    tone = 0.2 * np.sin(2.0 * math.pi * freq * t).astype(np.float32)
    _play_audio(tone, sr)


def mic_level_check(*, device: Optional[int], sr: int, seconds: float = 2.0) -> dict:
    """Record a short snippet to check mic level."""
    _require_sounddevice()
    try:
        duration = max(0.5, float(seconds))
        audio = sd.rec(int(sr * duration), samplerate=sr, channels=1, dtype="float32", device=device)
        sd.wait()
        audio = np.squeeze(audio)
    except Exception as exc:
        return {"status": "error", "error": str(exc)}

    rms = float(np.sqrt(np.mean(audio**2))) if audio.size else 0.0
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    clip = _clip_ratio(audio)
    status = "ok"
    hints = []
    if rms < 0.015:
        status = "too_quiet"
        hints.append("Speak louder or move closer to the mic.")
    if peak > 0.98 or clip > 0.01:
        status = "too_loud"
        hints.append("Lower input gain or move farther from the mic.")
    return {"status": status, "rms": rms, "peak": peak, "clip_ratio": clip, "hints": hints}


def _review_hits(items: List[dict], sr: int) -> List[dict]:
    if sd is None or not items:
        return items
    keep = []
    for item in items:
        audio = item["audio"]
        _play_audio(audio, sr)
        ans = input("Keep this hit? [Y/n]: ").strip().lower()
        if ans in {"n", "no"}:
            continue
        keep.append(item)
    return keep

def collect_take_from_mic(
    *,
    label: str,
    base_dir: Path,
    sr: int,
    take_sec: float,
    window_sec: float,
    device: Optional[int],
    review: bool = False,
) -> dict:
    """Record one take for a label, slice onsets, filter, and save samples."""
    _require_sounddevice()
    norm_label = normalize_label(label)
    if not norm_label:
        return {"status": "error", "error": f"invalid label: {label}"}

    take_sec = float(max(1.0, take_sec))
    window_sec = float(max(0.12, window_sec))

    try:
        audio = sd.rec(int(sr * take_sec), samplerate=sr, channels=1, dtype="float32", device=device)
        sd.wait()
        audio = np.squeeze(audio)
    except Exception as exc:
        return {"status": "error", "error": str(exc)}

    if audio.size == 0:
        return {"status": "error", "error": "empty recording"}

    audio = _to_mono(audio)
    onset_times = _detect_onsets(audio, sr, hop_length=256)

    data = load_calibration(base_dir)
    expected_len = data.get("feature_len")
    existing_feats = [
        np.array(s.get("features"), dtype=np.float32)
        for s in data.get("samples", [])
        if normalize_label(s.get("label", "")) == norm_label
    ]

    reasons = {"silence": 0, "clipping": 0, "short": 0, "low_snr": 0, "duplicate": 0, "outlier": 0}
    kept: List[dict] = []
    kept_feats: List[np.ndarray] = []

    take_id = f"{norm_label}-{int(time.time())}"
    window_len = int(window_sec * sr)
    min_len = int(0.05 * sr)

    for onset in onset_times:
        start = int(onset * sr)
        end = min(len(audio), start + window_len)
        segment = audio[start:end]
        if segment.size < min_len:
            reasons["short"] += 1
            continue

        rms = float(np.sqrt(np.mean(segment**2))) if segment.size else 0.0
        if rms <= 0.0 or _silence_reject(segment):
            reasons["silence"] += 1
            continue

        clip = _clip_ratio(segment)
        if clip > 0.01:
            reasons["clipping"] += 1
            continue

        snr_db = _estimate_snr_db(segment, sr)
        if snr_db < 6.0:
            reasons["low_snr"] += 1
            continue

        seg = _fade(segment.copy(), sr, 5.0)
        seg = _pre_emphasis(seg, 0.97)
        seg = _normalize_peak(seg)

        feats = _feature_vector(seg, sr)
        if expected_len is not None and len(feats) != expected_len:
            return {
                "status": "error",
                "error": "feature length mismatch; reset calibration before adding new samples",
            }

        if kept_feats:
            if _cosine_similarity(feats, kept_feats[-1]) > 0.98:
                reasons["duplicate"] += 1
                continue

        if _is_outlier(feats, existing_feats):
            reasons["outlier"] += 1
            continue

        q = _quality_score(rms, snr_db, clip)
        sample_id = f"{take_id}-{len(kept)}"
        kept.append(
            {
                "label": norm_label,
                "features": feats.tolist(),
                "meta": {
                    "source": "mic",
                    "take_id": take_id,
                    "sample_id": sample_id,
                    "timestamp": int(time.time()),
                    "rms": rms,
                    "snr_db": snr_db,
                    "clip_ratio": clip,
                    "quality_score": q,
                },
                "audio": seg,
            }
        )
        kept_feats.append(feats)

    if review and kept:
        worst = sorted(kept, key=lambda k: k["meta"]["quality_score"])[: min(8, len(kept))]
        ans = input(f"Review {len(worst)} lowest-quality hits? [y/N]: ").strip().lower()
        if ans in {"y", "yes"}:
            keep_set = _review_hits(worst, sr)
            kept = [k for k in kept if k not in worst or k in keep_set]

    for item in kept:
        item.pop("audio", None)

    if kept:
        data["version"] = 1
        data["sample_rate"] = int(sr)
        data["labels"] = LABELS
        data["feature_len"] = len(kept[0]["features"])
        data.setdefault("samples", []).extend(kept)
        save_calibration(base_dir, data)

    return {
        "status": "ok",
        "label": norm_label,
        "take_id": take_id,
        "kept": len(kept),
        "skipped": int(sum(reasons.values())),
        "reasons": reasons,
    }


def delete_last_samples(*, base_dir: Path, n: int, label: Optional[str] = None) -> dict:
    """Delete last N samples overall or for a label."""
    data = load_calibration(base_dir)
    samples = data.get("samples", [])
    if not samples:
        return {"status": "ok", "deleted": 0}

    if label:
        norm_label = normalize_label(label)
        if not norm_label:
            return {"status": "error", "error": f"invalid label: {label}"}
        kept = []
        deleted = 0
        for s in reversed(samples):
            if deleted >= n:
                kept.append(s)
                continue
            if normalize_label(s.get("label", "")) == norm_label:
                deleted += 1
            else:
                kept.append(s)
        kept = list(reversed(kept))
        data["samples"] = kept
        save_calibration(base_dir, data)
        return {"status": "ok", "deleted": deleted, "label": norm_label}

    deleted = min(n, len(samples))
    data["samples"] = samples[: len(samples) - deleted]
    save_calibration(base_dir, data)
    return {"status": "ok", "deleted": deleted}


def _sanity_check_model(model, feats: List[np.ndarray], label: str) -> dict:
    if model is None or not feats:
        return {"consistency": None, "count": 0}
    X = np.stack(feats, axis=0)
    try:
        probs = model.predict_proba(X)
        classes = model.classes_
        preds = [str(classes[int(np.argmax(p))]) for p in probs]
        good = sum(1 for p in preds if p == label)
        consistency = float(good / max(1, len(preds)))
        return {"consistency": consistency, "count": len(preds)}
    except Exception:
        return {"consistency": None, "count": 0}


def guided_session(
    *,
    base_dir: Path,
    sr: int = 16000,
    rounds: int = 2,
    take_sec: float = 8.0,
    window_sec: float = 0.25,
    target_hits_per_label: int = 25,
    device: Optional[int] = None,
    review: bool = False,
) -> dict:
    """Run guided calibration session."""
    _require_sounddevice()
    device_info = None
    devices = list_audio_devices()
    if device is not None and devices:
        device_info = next((d for d in devices if d["index"] == device), None)

    lvl = mic_level_check(device=device, sr=sr, seconds=2.0)
    if lvl.get("status") != "ok":
        logger.warning("Mic level check: %s", lvl)

    reasons_tot = {"silence": 0, "clipping": 0, "short": 0, "low_snr": 0, "duplicate": 0, "outlier": 0}
    added = {k: 0 for k in LABELS}
    skipped = {k: 0 for k in LABELS}

    for _ in range(int(rounds)):
        for label in LABELS:
            print(f"\nLabel: {label}. Get ready...")
            for i in range(3, 0, -1):
                print(f"{i}...")
                _beep(sr, 0.06, 880.0)
                time.sleep(0.5)
            print("Record!")
            result = collect_take_from_mic(
                label=label,
                base_dir=base_dir,
                sr=sr,
                take_sec=take_sec,
                window_sec=window_sec,
                device=device,
                review=review,
            )
            if result.get("status") != "ok":
                print(f"Error: {result.get('error')}")
                continue
            added[label] += int(result.get("kept", 0))
            skipped[label] += int(result.get("skipped", 0))
            for k, v in result.get("reasons", {}).items():
                reasons_tot[k] = reasons_tot.get(k, 0) + int(v)

            model = load_model(base_dir=base_dir)
            if model is not None:
                data = load_calibration(base_dir)
                feats = [
                    np.array(s["features"], dtype=np.float32)
                    for s in data.get("samples", [])
                    if s.get("meta", {}).get("take_id") == result.get("take_id")
                ]
                sanity = _sanity_check_model(model, feats, label)
                if sanity["consistency"] is not None and sanity["consistency"] < 0.6:
                    print(f"Low consistency for {label} ({sanity['consistency']:.2f}). Try again.")

        report = train_and_save_model(base_dir=base_dir)
        print(json.dumps(report, indent=2))

    extra_rounds = 0
    while extra_rounds < 4:
        data = load_calibration(base_dir)
        counts = _count_labels(data.get("samples", []))
        need = [lbl for lbl in LABELS if counts.get(lbl, 0) < target_hits_per_label]
        if not need:
            break
        extra_rounds += 1
        for label in need:
            print(f"\nExtra take for {label} (needs {target_hits_per_label - counts.get(label, 0)} more)...")
            for i in range(3, 0, -1):
                print(f"{i}...")
                _beep(sr, 0.06, 880.0)
                time.sleep(0.5)
            print("Record!")
            result = collect_take_from_mic(
                label=label,
                base_dir=base_dir,
                sr=sr,
                take_sec=take_sec,
                window_sec=window_sec,
                device=device,
                review=review,
            )
            if result.get("status") != "ok":
                print(f"Error: {result.get('error')}")
                continue
            added[label] += int(result.get("kept", 0))
            skipped[label] += int(result.get("skipped", 0))
            for k, v in result.get("reasons", {}).items():
                reasons_tot[k] = reasons_tot.get(k, 0) + int(v)

    train_report = train_and_save_model(base_dir=base_dir)
    return {
        "status": "ok",
        "device": device_info,
        "rounds_done": int(rounds),
        "targets": {k: int(target_hits_per_label) for k in LABELS},
        "added": added,
        "skipped": skipped,
        "reasons_top": reasons_tot,
        "train_report": train_report,
    }

def transcribe_drum_hits(
    audio_path: str,
    *,
    sample_rate: int,
    base_dir: Path,
    window_sec: float = 0.22,
) -> List[dict]:
    """Transcribe drum hits from an audio file."""
    audio, sr = librosa.load(audio_path, sr=sample_rate, mono=True)
    audio = _to_mono(audio)
    if audio.size == 0:
        return []

    onset_times = _detect_onsets(audio, sr, hop_length=256)
    model = load_model(base_dir=base_dir)
    notes: List[dict] = []

    window_len = int(window_sec * sr)
    if window_len < int(0.05 * sr):
        window_len = int(0.05 * sr)

    for onset in onset_times:
        start = int(onset * sr)
        end = min(len(audio), start + window_len)
        segment = audio[start:end]
        if segment.size < int(0.04 * sr):
            continue
        if _silence_reject(segment):
            continue

        seg = _fade(segment.copy(), sr, 5.0)
        seg = _pre_emphasis(seg, 0.97)
        seg = _normalize_peak(seg)

        label = None
        conf = 0.0
        if model is not None:
            feats = _feature_vector(seg, sr).reshape(1, -1)
            try:
                probs = model.predict_proba(feats)[0]
                classes = model.classes_
                top_idx = int(np.argmax(probs))
                label = str(classes[top_idx])
                conf = float(probs[top_idx])
            except Exception:
                label = None

        if label not in LABELS or conf < 0.45:
            label, conf = _heuristic_label(seg, sr)

        rms = float(np.sqrt(np.mean(segment**2))) if segment.size else 0.0
        velocity = _velocity_from_rms(rms)

        notes.append(
            {
                "startSec": float(onset),
                "endSec": float(onset + 0.1),
                "note": int(MIDI_MAP.get(label, 36)),
                "velocity": int(velocity),
                "channel": 9,
                "label": label,
                "confidence": float(conf),
            }
        )

    logger.info("Dubler Drums: notes=%d (calibrated=%s)", len(notes), bool(model))
    return notes


def transcribe_dubler_drums(
    audio_path: str,
    *,
    sample_rate: int,
    base_dir: Path,
    window_sec: float = 0.22,
) -> List[dict]:
    """Backward-compatible wrapper for existing callers."""
    return transcribe_drum_hits(
        audio_path,
        sample_rate=sample_rate,
        base_dir=base_dir,
        window_sec=window_sec,
    )


def _parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Beatbox drum-hit classifier")
    sub = parser.add_subparsers(dest="command", required=True)

    add_cmd = sub.add_parser("add", help="Add calibration sample")
    add_cmd.add_argument("--file", required=True)
    add_cmd.add_argument("--label", required=True)
    add_cmd.add_argument("--base", default="data")
    add_cmd.add_argument("--sr", type=int, default=16000)
    add_cmd.add_argument("--window-sec", type=float, default=0.25)

    train_cmd = sub.add_parser("train", help="Train and save model")
    train_cmd.add_argument("--base", default="data")

    trans_cmd = sub.add_parser("transcribe", help="Transcribe drum hits")
    trans_cmd.add_argument("--file", required=True)
    trans_cmd.add_argument("--base", default="data")
    trans_cmd.add_argument("--sr", type=int, default=16000)
    trans_cmd.add_argument("--window-sec", type=float, default=0.22)

    sub.add_parser("devices", help="List audio input devices")

    level_cmd = sub.add_parser("level", help="Mic level check")
    level_cmd.add_argument("--sr", type=int, default=16000)
    level_cmd.add_argument("--device", type=int)

    rollback_cmd = sub.add_parser("rollback", help="Delete last samples")
    rollback_cmd.add_argument("--base", default="data")
    rollback_cmd.add_argument("--n", type=int, required=True)
    rollback_cmd.add_argument("--label")

    session_cmd = sub.add_parser("session", help="Guided calibration session")
    session_cmd.add_argument("--base", default="data")
    session_cmd.add_argument("--sr", type=int, default=16000)
    session_cmd.add_argument("--rounds", type=int, default=2)
    session_cmd.add_argument("--take-sec", type=float, default=8.0)
    session_cmd.add_argument("--window-sec", type=float, default=0.25)
    session_cmd.add_argument("--hits", type=int, default=25)
    session_cmd.add_argument("--device", type=int)
    session_cmd.add_argument("--review", action="store_true")

    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    """CLI entrypoint."""
    args = _parse_args(argv)
    base_dir = Path(getattr(args, "base", "data"))

    if args.command == "devices":
        if sd is None:
            print(json.dumps({"status": "error", "error": "sounddevice not installed"}, indent=2))
            return 1
        print(json.dumps(list_audio_devices(), indent=2))
        return 0

    if args.command == "level":
        try:
            result = mic_level_check(device=args.device, sr=args.sr, seconds=2.0)
        except RuntimeError as exc:
            print(json.dumps({"status": "error", "error": str(exc)}, indent=2))
            return 1
        print(json.dumps(result, indent=2))
        return 0

    if args.command == "rollback":
        result = delete_last_samples(base_dir=base_dir, n=args.n, label=args.label)
        print(json.dumps(result, indent=2))
        return 0

    if args.command == "session":
        try:
            result = guided_session(
                base_dir=base_dir,
                sr=args.sr,
                rounds=args.rounds,
                take_sec=args.take_sec,
                window_sec=args.window_sec,
                target_hits_per_label=args.hits,
                device=args.device,
                review=args.review,
            )
        except RuntimeError as exc:
            print(json.dumps({"status": "error", "error": str(exc)}, indent=2))
            return 1
        print(json.dumps(result, indent=2))
        return 0

    if args.command == "add":
        result = add_calibration_sample(
            args.file,
            label=args.label,
            sample_rate=args.sr,
            base_dir=base_dir,
            window_sec=args.window_sec,
        )
        print(json.dumps(result, indent=2))
        return 0

    if args.command == "train":
        result = train_and_save_model(base_dir=base_dir)
        print(json.dumps(result, indent=2))
        return 0

    if args.command == "transcribe":
        notes = transcribe_drum_hits(args.file, sample_rate=args.sr, base_dir=base_dir, window_sec=args.window_sec)
        print(json.dumps(notes, indent=2))
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
