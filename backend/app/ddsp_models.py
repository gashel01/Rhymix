import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional, Tuple

import numpy as np

logger = logging.getLogger("voice_midi")


@dataclass
class DdspModelInfo:
    kind: str
    path: Path
    gin_path: Optional[Path] = None
    ckpt_path: Optional[Path] = None


_MODEL_CACHE: Dict[str, Tuple[DdspModelInfo, object]] = {}


def _normalize_instrument(label: Optional[str]) -> str:
    key = (label or "default").strip().lower()
    key = key.replace(" ", "_")
    aliases = {
        "piano": "piano",
        "acoustic_piano": "piano",
        "electric_piano": "piano",
        "guitar": "guitar",
        "bass": "bass",
        "strings": "strings",
        "string": "strings",
        "synth": "synth",
        "pad": "synth",
        "drums": "drums",
        "drum": "drums",
        "beat": "drums",
    }
    return aliases.get(key, key)


def resolve_ddsp_model(instrument_label: Optional[str]) -> Optional[DdspModelInfo]:
    base_dir = os.getenv("DDSP_MODEL_DIR", "models/ddsp")
    model_map = os.getenv("DDSP_MODEL_MAP")
    instrument_key = _normalize_instrument(instrument_label)

    if model_map:
        try:
            mapping = json.loads(model_map)
            mapped = mapping.get(instrument_key) or mapping.get("default")
            if mapped:
                model_dir = Path(mapped)
                if not model_dir.is_absolute():
                    model_dir = Path(base_dir) / mapped
                return _find_model_files(model_dir)
        except Exception:
            logger.warning("Invalid DDSP_MODEL_MAP; ignoring.")

    model_dir = Path(base_dir) / instrument_key
    if model_dir.exists():
        return _find_model_files(model_dir)
    fallback = Path(base_dir) / "default"
    if fallback.exists():
        return _find_model_files(fallback)
    return None


def _find_model_files(model_dir: Path) -> Optional[DdspModelInfo]:
    if not model_dir.exists():
        return None
    if (model_dir / "saved_model.pb").exists():
        return DdspModelInfo(kind="savedmodel", path=model_dir)
    saved = model_dir / "saved_model"
    if saved.exists() and (saved / "saved_model.pb").exists():
        return DdspModelInfo(kind="savedmodel", path=saved)

    gin_files = list(model_dir.glob("*.gin"))
    if gin_files:
        ckpt = _find_checkpoint(model_dir)
        if ckpt:
            return DdspModelInfo(kind="gin", path=model_dir, gin_path=gin_files[0], ckpt_path=ckpt)
    return None


def _find_checkpoint(model_dir: Path) -> Optional[Path]:
    ckpt_env = os.getenv("DDSP_CKPT_PATH")
    if ckpt_env:
        ckpt_path = Path(ckpt_env)
        if ckpt_path.exists():
            return ckpt_path
    index_files = sorted(model_dir.glob("*.index"))
    if not index_files:
        return None
    latest = index_files[-1]
    return latest.with_suffix("")


def load_ddsp_model(model_info: Optional[DdspModelInfo]):
    if not model_info:
        return None
    cache_key = f"{model_info.kind}:{model_info.path}"
    cached = _MODEL_CACHE.get(cache_key)
    if cached:
        return cached[1]
    if model_info.kind == "savedmodel":
        import tensorflow as tf

        model = tf.saved_model.load(str(model_info.path))
        _MODEL_CACHE[cache_key] = (model_info, model)
        logger.info("Loaded DDSP savedmodel: %s", model_info.path)
        return model
    if model_info.kind == "gin":
        import gin
        import tensorflow as tf
        import ddsp.training

        gin.clear_config()
        gin.parse_config_file(str(model_info.gin_path))
        model = ddsp.training.models.Autoencoder()
        ckpt = tf.train.Checkpoint(model=model)
        ckpt.restore(str(model_info.ckpt_path)).expect_partial()
        _MODEL_CACHE[cache_key] = (model_info, model)
        logger.info("Loaded DDSP gin checkpoint: %s", model_info.ckpt_path)
        return model
    return None


def build_ddsp_features(audio: np.ndarray, sr: int, *, frame_rate: int, f0_hz: np.ndarray):
    import librosa
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

    n_frames = min(len(f0_hz), len(loudness))
    f0_hz = f0_hz[:n_frames]
    loudness = loudness[:n_frames]
    f0_conf = np.ones_like(f0_hz, dtype=np.float32)
    return {
        "f0_hz": f0_hz.astype(np.float32),
        "f0_confidence": f0_conf.astype(np.float32),
        "loudness_db": loudness.astype(np.float32),
    }


def synthesize_with_model(model, features: Dict[str, np.ndarray], sr: int) -> np.ndarray:
    import tensorflow as tf

    f0 = features["f0_hz"][None, :, None]
    f0_conf = features["f0_confidence"][None, :, None]
    loudness = features["loudness_db"][None, :, None]

    f0_t = tf.convert_to_tensor(f0, dtype=tf.float32)
    f0c_t = tf.convert_to_tensor(f0_conf, dtype=tf.float32)
    loud_t = tf.convert_to_tensor(loudness, dtype=tf.float32)

    if hasattr(model, "signatures"):
        fn = model.signatures.get("serving_default") or next(iter(model.signatures.values()))
        outputs = fn(f0_hz=f0_t, f0_confidence=f0c_t, loudness_db=loud_t)
        if isinstance(outputs, dict):
            for key in ("audio", "output", "y"):
                if key in outputs:
                    return outputs[key].numpy().squeeze()
            return next(iter(outputs.values())).numpy().squeeze()
        return outputs.numpy().squeeze()

    if hasattr(model, "__call__"):
        try:
            outputs = model({"f0_hz": f0_t, "f0_confidence": f0c_t, "loudness_db": loud_t}, training=False)
        except Exception:
            outputs = model({"f0_hz": f0_t, "loudness_db": loud_t}, training=False)
        if isinstance(outputs, dict):
            for key in ("audio", "output", "y"):
                if key in outputs:
                    return outputs[key].numpy().squeeze()
            return next(iter(outputs.values())).numpy().squeeze()
        return outputs.numpy().squeeze()
    raise RuntimeError("Unsupported DDSP model type")
