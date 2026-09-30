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


# Tempo estimation (librosa.beat.beat_track) is slow enough — loading and analyzing real audio,
# not just reading a header like ffprobe's duration/sample-rate probe above — that running it on
# every asset-list request would be a real regression. Cached in-process keyed by (path, mtime) so
# each file only gets analyzed once per backend process lifetime; a changed file (new mtime) is
# re-analyzed. Not persisted to disk — an acceptable tradeoff given this backend already re-probes
# duration/sample-rate on every call the same way, and a cold-cache first request just costs one
# analysis pass.
_BPM_CACHE: dict[tuple[str, float], float | None] = {}


def _estimate_bpm(path: Path) -> float | None:
    try:
        cache_key = (str(path), path.stat().st_mtime)
    except Exception:
        cache_key = None
    if cache_key is not None and cache_key in _BPM_CACHE:
        return _BPM_CACHE[cache_key]

    bpm = None
    try:
        import librosa

        # First 60s, downsampled to 22.05kHz mono — beat tracking doesn't need full quality/length,
        # and most loops/stems make their tempo obvious well within that window.
        y, sr = librosa.load(str(path), sr=22050, mono=True, duration=60)
        if y.size > sr * 2:
            tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
            tempo = float(tempo) if tempo else 0.0
            # Outside this range beat_track is usually locking onto a harmonic/sub-harmonic of the
            # real tempo rather than a plausible beatmaking BPM — not worth surfacing as a match
            # candidate at drop time.
            if 40.0 <= tempo <= 220.0:
                bpm = round(tempo, 1)
    except Exception:
        bpm = None

    if cache_key is not None:
        _BPM_CACHE[cache_key] = bpm
    return bpm


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
        return {"durationSec": 0.0, "sampleRate": None, "bpm": None}
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
            return {"durationSec": 0.0, "sampleRate": None, "bpm": None}
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
        return {"durationSec": duration, "sampleRate": sample_rate, "bpm": _estimate_bpm(path)}
    except Exception:
        return {"durationSec": 0.0, "sampleRate": None, "bpm": None}


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
        "bpm": info.get("bpm"),
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

    # A track that was never split — a plain import, or a raw hum recording,
    # which mostly never are — used to open a project with zero assets and no
    # way in: only its derived stems were ever registered, never the file
    # itself. Falling back to the original audio, but only when no stem was
    # found, keeps an already-separated upload's assets exactly as they were.
    if not assets:
        record = get_upload_metadata(file_id)
        stored_name = record.get("storedName") if record else None
        if stored_name:
            raw_path = paths.INPUT_DIR / stored_name
            if raw_path.exists():
                label = record.get("safeDisplayName") or record.get("originalName") or base_name
                assets[f"mix:{file_id}"] = {
                    "id": f"mix:{file_id}",
                    "kind": "mix",
                    "label": label,
                    "fileType": "mix",
                    "path": str(raw_path),
                    "url": f"/api/uploads/{file_id}/audio",
                    **probe_audio(raw_path),
                }

    return assets


def resolve_songgen_asset(job_id: str) -> dict:
    """A generated song's ready assets, in the same shape resolve_upload_assets
    produces — so _build_project's existing kind-to-lane routing (instrumental
    / vocal / else-is-mix) needs no changes to understand either source.

    Song generation was the entire reason Studio exists, and it was the one
    asset kind detect_asset_source could never recognise: opening Studio on a
    generated song built a project with zero assets, same failure as an
    unsplit upload, different cause — the id (bare, not upload: or run:
    prefixed) never matched anything this module knew how to resolve.
    """
    assets = {}
    if not job_id:
        return assets

    # Lazy: song_generation.routes pulls in its own Flask blueprint, and
    # importing it at module load would tangle this module with that one the
    # same way resolve_asset_path avoids doing with backend.routes.download.
    from backend.features.song_generation.routes import _get_or_load_job

    job = _get_or_load_job(job_id)
    if not job:
        return assets

    job_assets = job.get("assets") if isinstance(job.get("assets"), dict) else {}
    title = job.get("title") or "Generated song"

    def _ready_path(key: str) -> Path | None:
        entry = job_assets.get(key)
        if not isinstance(entry, dict) or not entry.get("ready"):
            return None
        raw_path = entry.get("path")
        if not raw_path:
            return None
        candidate = Path(raw_path)
        return candidate if candidate.exists() else None

    def _register(key: str, kind: str, label: str) -> None:
        path = _ready_path(key)
        if not path:
            return
        asset_id = f"songgen:{job_id}:{key}"
        assets[asset_id] = {
            "id": asset_id,
            "kind": kind,
            "label": label,
            "fileType": key,
            "path": str(path),
            "url": f"/api/song-generation/{job_id}/audio/{key}",
            **probe_audio(path),
        }

    # The converted take outranks the raw one when both exist — same rule
    # normaliseSong already applies in the library, for the same reason:
    # being re-sung is what someone is listening for once it has happened.
    mix_key = "final_mix_rvc" if _ready_path("final_mix_rvc") else "full_mix"
    _register(mix_key, "mix", title)
    vocals_key = "vocals_rvc" if _ready_path("vocals_rvc") else "vocals_raw"
    _register(vocals_key, "vocal", f"{title} — Vocals")
    _register("instrumental", "instrumental", f"{title} — Instrumental")

    return assets


def detect_asset_source(asset_id: str) -> tuple[str, str] | None:
    if not asset_id:
        return None
    raw = asset_id
    if raw.startswith("run:"):
        return ("inference", raw.split("run:", 1)[1])
    if raw.startswith("upload:"):
        return ("upload", raw.split("upload:", 1)[1])
    if raw.startswith("songgen:"):
        return ("songgen", raw.split("songgen:", 1)[1])
    if load_inference_run_metadata(raw):
        return ("inference", raw)
    if get_upload_metadata(raw):
        return ("upload", raw)
    return None

