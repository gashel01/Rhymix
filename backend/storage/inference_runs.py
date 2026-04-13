import json
import uuid
from datetime import datetime
from pathlib import Path

from backend.paths.manager import paths

ALLOWED_RUN_REACTIONS = {"none", "like", "dislike", "favorite"}


def make_run_id() -> str:
    return uuid.uuid4().hex


def save_inference_run_metadata(run_id: str, payload: dict) -> None:
    run_dir = paths.INFERENCE_RUNS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    run_file = run_dir / "run.json"
    with run_file.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)


def load_inference_run_metadata(run_id: str):
    run_file = paths.INFERENCE_RUNS_DIR / run_id / "run.json"
    if not run_file.exists():
        return None
    try:
        with run_file.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
            if isinstance(data, dict):
                data.pop("isFavorite", None)
                data.setdefault("reaction", "none")
                data.setdefault("modelCheckpoint", None)
            return data
    except Exception:
        return None


def list_inference_runs() -> list[dict]:
    results = []
    if not paths.INFERENCE_RUNS_DIR.exists():
        return results
    for run_dir in sorted(paths.INFERENCE_RUNS_DIR.glob("*")):
        if not run_dir.is_dir():
            continue
        run_id = run_dir.name
        run_meta = load_inference_run_metadata(run_id)
        if run_meta:
            results.append(run_meta)
    return results
