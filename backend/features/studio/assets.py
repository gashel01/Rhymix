import json
import subprocess
from pathlib import Path

from backend.paths.manager import paths
from backend.storage.inference_runs import load_inference_run_metadata
from backend.storage.metadata import get_upload_base_name, get_upload_metadata


def _safe_float(value, default=0.0):
    try:
        return float(value)
    except Exception:
        return default


def resolve_asset_path(assets: dict, asset_id) -> Path | None:
    """Resolve a project asset to a file on disk, or None.

    Generated assets carry an absolute "path", but assets that come from an
    upload, an inference run or Foundation only carry a "url". Code that looked
    at "path" alone silently skipped those — which is why jobs needing a real
    file failed, and why a render could quietly drop clips. The download layer
    already knows how to turn one of those URLs back into a path.
    """
    if not asset_id:
        return None
    asset = assets.get(asset_id) if isinstance(assets, dict) else None
    if not isinstance(asset, dict):
        return None

    direct = asset.get("path")
    if direct:
        candidate = Path(direct)
        if candidate.exists():
            return candidate

    # Imported lazily: backend.routes.download pulls in Flask blueprints, and
    # importing it at module load would tangle the studio package with them.
    from backend.routes.download import _resolve_download_source

    resolved = _resolve_download_source(asset.get("url"))
    return Path(resolved) if resolved else None


def probe_audio(path: Path) -> dict:
    if not path or not path.exists():
        return {"durationSec": 0.0, "sampleRate": None}
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-show_entries",
        "stream=sample_rate",
        "-of",
        "json",
        str(path),
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            return {"durationSec": 0.0, "sampleRate": None}
        payload = json.loads(result.stdout or "{}")
        duration = _safe_float(payload.get("format", {}).get("duration"), 0.0)
        streams = payload.get("streams") or []
        sample_rate = None
        if streams:
            sample_rate = streams[0].get("sample_rate")
            try:
                sample_rate = int(sample_rate) if sample_rate is not None else None
            except Exception:
                sample_rate = None
        return {"durationSec": duration, "sampleRate": sample_rate}
    except Exception:
        return {"durationSec": 0.0, "sampleRate": None}


def _asset_record(asset_id: str, path: Path, *, kind: str, label: str, file_type: str | None = None) -> dict:
    info = probe_audio(path)
    return {
        "id": asset_id,
        "kind": kind,
        "label": label,
        "fileType": file_type,
        "path": str(path),
        "url": f"/api/download/exports/{path.name}" if kind == "derived" else None,
        "durationSec": info.get("durationSec", 0.0),
        "sampleRate": info.get("sampleRate"),
    }


def resolve_inference_asset(run_id: str) -> dict | None:
    if not run_id:
        return None
    run_meta = load_inference_run_metadata(run_id)
    output_name = run_meta.get("outputFileName") if run_meta else None
    if output_name:
        candidate = paths.INFERENCE_RUNS_DIR / run_id / output_name
        if candidate.exists():
            return {
                "id": f"inference:{run_id}",
                "kind": "inference",
                "label": "Inference Result",
                "path": str(candidate),
                "url": f"/api/download/inference/{run_id}",
                **probe_audio(candidate),
            }
    legacy = paths.get_inference_file_path(run_id)
    if legacy.exists():
        return {
            "id": f"inference:{run_id}",
            "kind": "inference",
            "label": "Inference Result",
            "path": str(legacy),
            "url": f"/api/download/inference/{run_id}",
            **probe_audio(legacy),
        }
    return None


def resolve_upload_assets(file_id: str) -> dict:
    assets = {}
    if not file_id:
        return assets
    base_name = get_upload_base_name(file_id)
    if not base_name:
        return assets

    inst_path = paths.INSTRUMENTAL_DIR / f"{base_name}_instrumental.wav"
    if inst_path.exists():
        assets[f"instrumental:{file_id}"] = {
            "id": f"instrumental:{file_id}",
            "kind": "instrumental",
            "label": "Instrumental",
            "fileType": "instrumental",
            "path": str(inst_path),
            "url": f"/api/download/instrumental/{file_id}",
            **probe_audio(inst_path),
        }

    vocal_path = None
    vocal_type = None
    proc_path = paths.UVR_PROCESSED_DIR / f"{base_name}_vocals.wav"
    raw_path = paths.UVR_RAW_DIR / f"{base_name}_vocals.wav"
    if proc_path.exists():
        vocal_path = proc_path
        vocal_type = "processed_vocals"
    elif raw_path.exists():
        vocal_path = raw_path
        vocal_type = "raw_vocals"

    if vocal_path:
        assets[f"vocal:{file_id}"] = {
            "id": f"vocal:{file_id}",
            "kind": "vocal",
            "label": "Vocals",
            "fileType": vocal_type,
            "path": str(vocal_path),
            "url": f"/api/download/{vocal_type}/{file_id}",
            **probe_audio(vocal_path),
        }

    return assets


def detect_asset_source(asset_id: str) -> tuple[str, str] | None:
    if not asset_id:
        return None
    raw = asset_id
    if raw.startswith("run:"):
        return ("inference", raw.split("run:", 1)[1])
    if raw.startswith("upload:"):
        return ("upload", raw.split("upload:", 1)[1])
    if load_inference_run_metadata(raw):
        return ("inference", raw)
    if get_upload_metadata(raw):
        return ("upload", raw)
    return None

