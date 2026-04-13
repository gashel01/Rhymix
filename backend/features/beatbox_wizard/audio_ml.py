from __future__ import annotations

import io
import logging
import math
import tempfile
import time
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import librosa
import numpy as np
import soundfile as sf
from joblib import dump, load
from sklearn.calibration import CalibratedClassifierCV
from sklearn.model_selection import StratifiedKFold, cross_val_predict, cross_val_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC

from .schemas import LABELS, TrainResponse
from .storage import model_file_path, sample_file_path, save_session

logger = logging.getLogger(__name__)
SEED = 1337
np.random.seed(SEED)


def normalize_label(label: str) -> Optional[str]:
    key = (label or "").strip().lower()
    aliases = {"bd": "kick", "hh": "hat", "hihat": "hat", "hi-hat": "hat", "sd": "snare"}
    key = aliases.get(key, key)
    if key in LABELS:
        return key
    return None


def _to_mono(audio: np.ndarray) -> np.ndarray:
    if audio.ndim == 1:
        return audio
    return np.mean(audio, axis=1 if audio.shape[0] < audio.shape[-1] else 0)


def _fade(audio: np.ndarray, sr: int, ms: float = 5.0) -> np.ndarray:
    n = int(sr * ms / 1000.0)
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
        return audio / peak
    return audio


def _ensure_min_len(y: np.ndarray, n: int = 1024) -> np.ndarray:
    if y.size >= n:
        return y
    return np.pad(y, (0, n - y.size))


def _feature_vector(audio: np.ndarray, sr: int) -> np.ndarray:
    y = audio.astype(np.float32)
    y = _pre_emphasis(y)
    y = _normalize_peak(y)
    y = _fade(y, sr)
    y = _ensure_min_len(y, 1024)

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
    rms_mean = float(np.mean(rms))
    rms_std = float(np.std(rms))
    zcr_mean = float(np.mean(zcr))
    zcr_std = float(np.std(zcr))
    peak = float(np.max(np.abs(y))) if y.size else 0.0
    rms_signal = float(np.sqrt(np.mean(y**2))) if y.size else 0.0
    crest = peak / (rms_signal + 1e-9)
    peak_to_rms = peak / (rms_mean + 1e-9)
    temporal = np.array([rms_mean, rms_std, zcr_mean, zcr_std, crest, peak_to_rms], dtype=np.float32)

    return np.concatenate(
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


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom <= 1e-9:
        return 0.0
    return float(np.dot(a, b) / denom)


def _estimate_snr_db(audio: np.ndarray, noise: np.ndarray) -> float:
    sig_rms = float(np.sqrt(np.mean(audio**2))) if audio.size else 1e-9
    noise_rms = float(np.sqrt(np.mean(noise**2))) if noise.size else 1e-9
    return 20.0 * math.log10((sig_rms + 1e-9) / (noise_rms + 1e-9))


def _is_duplicate(vec: np.ndarray, kept: List[np.ndarray], *, thresh: float = 0.98, k: int = 6) -> bool:
    if not kept:
        return False
    for prev in kept[-k:]:
        if _cosine_similarity(vec, prev) > thresh:
            return True
    return False


def _quality_score(rms: float, snr_db: float, clip_ratio: float) -> float:
    snr_score = min(1.0, max(0.0, snr_db / 30.0))
    rms_score = min(1.0, max(0.0, rms / 0.2))
    clip_penalty = max(0.0, 1.0 - clip_ratio * 5.0)
    return float(snr_score * rms_score * clip_penalty)


def _outlier_score(vec: np.ndarray, mat: np.ndarray) -> float:
    mean = np.mean(mat, axis=0)
    std = np.std(mat, axis=0) + 1e-6
    z = np.abs((vec - mean) / std)
    return float(np.linalg.norm(z) / math.sqrt(z.size))


def decode_audio_upload(file_bytes: bytes, suffix: str, target_sr: int) -> Tuple[np.ndarray, int]:
    # `librosa.load` with tempfile handles wav/webm/ogg through audioread/ffmpeg fallback.
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix or ".wav") as tmp:
        tmp.write(file_bytes)
        temp_path = tmp.name
    try:
        audio, sr = librosa.load(temp_path, sr=target_sr, mono=True)
        audio = _to_mono(audio).astype(np.float32)
        if audio.size == 0:
            raise ValueError("empty audio")
        return audio, int(target_sr if target_sr else sr)
    finally:
        try:
            Path(temp_path).unlink(missing_ok=True)
        except Exception:
            pass


def process_take(
    state: Dict,
    *,
    label: str,
    audio: np.ndarray,
    sr: int,
    session_id: str,
) -> Dict:
    label = normalize_label(label) or label
    take_id = f"take-{uuid.uuid4().hex[:12]}"
    hop = 256
    onsets = librosa.onset.onset_detect(y=audio, sr=sr, hop_length=hop, backtrack=True, units="time")
    window_len = int(float(state["windowSec"]) * sr)
    min_len = int(0.05 * sr)
    detected_hits = int(onsets.size)

    reasons = {"silence": 0, "clipping": 0, "low_snr": 0, "duplicate": 0, "outlier": 0, "short": 0}
    added = 0
    kept_features: List[np.ndarray] = []
    new_vectors: List[np.ndarray] = []
    per_label_existing = [
        np.array(s["features"], dtype=np.float32) for s in state["samples"] if s.get("label") == label
    ]
    existing_mat = np.stack(per_label_existing, axis=0) if len(per_label_existing) >= 12 else None

    snr_vals: List[float] = []
    rms_vals: List[float] = []
    clip_vals: List[float] = []

    for onset in onsets:
        start = int(float(onset) * sr)
        end = min(audio.size, start + window_len)
        seg = audio[start:end]
        if seg.size < min_len:
            reasons["short"] += 1
            continue

        rms = float(np.sqrt(np.mean(seg**2))) if seg.size else 0.0
        if rms < 0.02:
            reasons["silence"] += 1
            continue

        clip_ratio = float(np.mean(np.abs(seg) >= 0.99)) if seg.size else 0.0
        if clip_ratio > 0.01:
            reasons["clipping"] += 1
            continue

        pre = max(0, start - int(0.03 * sr))
        noise = audio[pre:start] if start > pre else audio[: int(0.03 * sr)]
        snr_db = _estimate_snr_db(seg, noise)
        if snr_db < 6.0:
            reasons["low_snr"] += 1
            continue

        seg_proc = _normalize_peak(_pre_emphasis(_fade(seg.copy(), sr), 0.97))
        vec = _feature_vector(seg_proc, sr)

        if _is_duplicate(vec, kept_features, thresh=0.98, k=6):
            reasons["duplicate"] += 1
            continue

        if existing_mat is not None and _outlier_score(vec, existing_mat) > 3.5:
            reasons["outlier"] += 1
            continue

        sample_id = uuid.uuid4().hex
        sample_wav = sample_file_path(session_id, sample_id)
        sf.write(sample_wav, seg_proc, sr)
        quality_score = _quality_score(rms, snr_db, clip_ratio)
        state["samples"].append(
            {
                "sampleId": sample_id,
                "takeId": take_id,
                "label": label,
                "features": vec.tolist(),
                "audioPath": str(sample_wav),
                "meta": {
                    "source": "browser",
                    "timestamp": int(time.time()),
                    "rms": rms,
                    "snrDb": snr_db,
                    "clipRatio": clip_ratio,
                    "qualityScore": quality_score,
                },
                "confidence": None,
            }
        )
        kept_features.append(vec)
        new_vectors.append(vec)
        added += 1
        snr_vals.append(snr_db)
        rms_vals.append(rms)
        clip_vals.append(clip_ratio)

    state["counts"] = {k: 0 for k in LABELS}
    for sample in state["samples"]:
        sample_label = sample.get("label")
        if sample_label in state["counts"]:
            state["counts"][sample_label] += 1

    next_label = state["nextLabel"]
    label_index = LABELS.index(label) if label in LABELS else 0
    if state["counts"].get(label, 0) >= state["targetHitsPerLabel"] and label_index < len(LABELS) - 1:
        next_label = LABELS[label_index + 1]
    state["nextLabel"] = next_label

    total_skipped = int(sum(reasons.values()))
    snr_median = float(np.median(snr_vals)) if snr_vals else 0.0
    rms_median = float(np.median(rms_vals)) if rms_vals else 0.0
    clip_max = float(np.max(clip_vals)) if clip_vals else 0.0

    consistency = None
    predicted_top: Dict[str, int] = {}
    model = load_model_for_session(session_id)
    if model is not None and new_vectors and hasattr(model, "predict_proba"):
        try:
            x_new = np.stack(new_vectors, axis=0)
            probs = model.predict_proba(x_new)
            preds = model.classes_[np.argmax(probs, axis=1)]
            consistency = float(np.mean(preds == label))
            for pred in preds:
                pred_key = str(pred)
                predicted_top[pred_key] = predicted_top.get(pred_key, 0) + 1
        except Exception:
            consistency = None
            predicted_top = {}

    need_more = {
        k: int(max(0, int(state["targetHitsPerLabel"]) - int(state["counts"].get(k, 0)))) for k in LABELS
    }

    action = "next"
    msg = f"Good take for {label}. Continue."
    if added < 4:
        action = "retake"
        msg = f"Too few clean {label} hits. Please re-record this label."
    elif state["counts"].get(label, 0) < min(state["targetHitsPerLabel"], 12):
        action = "retake"
        need = state["targetHitsPerLabel"] - state["counts"].get(label, 0)
        msg = f"We need {max(0, need)} more {label} hits."
    elif consistency is not None and consistency < 0.60:
        action = "retake"
        pct = int(round(consistency * 100.0))
        msg = f"Only {pct}% of hits matched {label}. Re-record with cleaner articulation."

    response = {
        "label": label,
        "takeId": take_id,
        "durationSec": float(audio.size / max(1, sr)),
        "detectedHits": detected_hits,
        "added": added,
        "skipped": total_skipped,
        "skipReasonsTop": reasons,
        "quality": {
            "snrDbMedian": snr_median,
            "clipRatioMax": clip_max,
            "rmsMedian": rms_median,
        },
        "balance": state["counts"],
        "consistency": consistency,
        "predictedTop": predicted_top,
        "needMore": need_more,
        "recommendation": {"action": action, "message": msg},
    }
    state["lastTake"] = response
    save_session(state)
    return response


def _build_model(X: np.ndarray, y: np.ndarray):
    base = make_pipeline(
        StandardScaler(),
        SVC(kernel="rbf", class_weight="balanced", random_state=SEED, probability=False),
    )
    unique, counts = np.unique(y, return_counts=True)
    min_class = int(np.min(counts)) if counts.size else 0
    if unique.size >= 2 and min_class >= 2 and len(y) >= 8:
        cv = StratifiedKFold(n_splits=min(3, min_class), shuffle=True, random_state=SEED)
        model = CalibratedClassifierCV(base, cv=cv, method="sigmoid")
        model.fit(X, y)
        return model

    fallback = make_pipeline(
        StandardScaler(),
        SVC(kernel="rbf", class_weight="balanced", random_state=SEED, probability=True),
    )
    fallback.fit(X, y)
    return fallback


def train_from_state(state: Dict) -> TrainResponse:
    samples = state.get("samples", [])
    counts = {k: 0 for k in LABELS}
    for sample in samples:
        lbl = sample.get("label")
        if lbl in counts:
            counts[lbl] += 1

    valid = [s for s in samples if isinstance(s.get("features"), list) and s.get("label") in LABELS]
    if len(valid) < 8:
        return TrainResponse(status="insufficient_samples", counts=counts)

    X = np.array([s["features"] for s in valid], dtype=np.float32)
    y = np.array([s["label"] for s in valid], dtype=object)
    if len(np.unique(y)) < 2:
        return TrainResponse(status="insufficient_labels", counts=counts)

    cv_mean = None
    cv_std = None
    confusion_preview: List[Dict[str, object]] = []
    unique, class_counts = np.unique(y, return_counts=True)
    min_class = int(np.min(class_counts)) if class_counts.size else 0
    if min_class >= 2 and len(y) >= 12:
        n_splits = min(3, min_class)
        cv = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=SEED)
        clf = make_pipeline(StandardScaler(), SVC(kernel="rbf", class_weight="balanced", random_state=SEED))
        scores = cross_val_score(clf, X, y, cv=cv)
        cv_mean = float(np.mean(scores))
        cv_std = float(np.std(scores))
        preds = cross_val_predict(clf, X, y, cv=cv)
        conf_counts: Dict[Tuple[str, str], int] = {}
        for true_lbl, pred_lbl in zip(y, preds):
            key = (str(true_lbl), str(pred_lbl))
            conf_counts[key] = conf_counts.get(key, 0) + 1
        confusion_preview = [
            {"true": k[0], "pred": k[1], "n": n} for k, n in sorted(conf_counts.items(), key=lambda x: -x[1])
        ][:24]

    try:
        model = _build_model(X, y)
        model_path = model_file_path(state["sessionId"])
        dump(model, model_path)
        state["modelTrained"] = True
        state["modelPath"] = str(model_path)

        # Save sample confidence estimates for review prioritization.
        if hasattr(model, "predict_proba"):
            probs = model.predict_proba(X)
            classes = model.classes_
            for idx, sample in enumerate(valid):
                top_idx = int(np.argmax(probs[idx]))
                confidence = float(probs[idx][top_idx])
                sample["confidence"] = confidence
                sample["predicted"] = str(classes[top_idx])
        save_session(state)
    except Exception as exc:
        logger.exception("Beatbox model training failed")
        return TrainResponse(status="training_failed", counts=counts, cvAccuracyMean=cv_mean, cvAccuracyStd=cv_std)

    return TrainResponse(
        status="trained",
        counts=counts,
        cvAccuracyMean=cv_mean,
        cvAccuracyStd=cv_std,
        confusionPreview=confusion_preview,
    )


def load_model_for_session(session_id: str):
    model_path = model_file_path(session_id)
    if not model_path.exists():
        return None
    try:
        return load(model_path)
    except Exception:
        return None
