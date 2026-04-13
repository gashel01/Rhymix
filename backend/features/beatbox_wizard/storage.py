from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Dict, Optional

from .schemas import LABELS

BASE_DIR = Path("data") / "studio" / "beatbox_wizard"


def _session_dir(session_id: str) -> Path:
    return BASE_DIR / session_id


def _state_path(session_id: str) -> Path:
    return _session_dir(session_id) / "session_state.json"


def _samples_dir(session_id: str) -> Path:
    return _session_dir(session_id) / "samples"


def _model_path(session_id: str) -> Path:
    return _session_dir(session_id) / "drum_model.joblib"


def create_session(*, sample_rate: int, window_sec: float, target_hits_per_label: int) -> Dict:
    session_id = uuid.uuid4().hex
    now = int(time.time())
    record = {
        "sessionId": session_id,
        "labels": LABELS,
        "sampleRate": int(sample_rate),
        "windowSec": float(window_sec),
        "targetHitsPerLabel": int(target_hits_per_label),
        "counts": {label: 0 for label in LABELS},
        "samples": [],
        "nextLabel": LABELS[0],
        "lastTake": None,
        "modelTrained": False,
        "createdAt": now,
        "updatedAt": now,
    }
    ensure_dirs(session_id)
    save_session(record)
    return record


def ensure_dirs(session_id: str) -> None:
    _session_dir(session_id).mkdir(parents=True, exist_ok=True)
    _samples_dir(session_id).mkdir(parents=True, exist_ok=True)


def save_session(state: Dict) -> None:
    state["updatedAt"] = int(time.time())
    path = _state_path(state["sessionId"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2), encoding="utf-8")


def load_session(session_id: str) -> Optional[Dict]:
    path = _state_path(session_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def sample_file_path(session_id: str, sample_id: str) -> Path:
    return _samples_dir(session_id) / f"{sample_id}.wav"


def model_file_path(session_id: str) -> Path:
    return _model_path(session_id)

