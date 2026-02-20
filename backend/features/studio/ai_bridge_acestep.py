import io
import json
import os
import sys
import uuid
from contextlib import redirect_stdout
from pathlib import Path

from backend.features.song_generation.providers.ace_step import _run_acestep15_generation
from backend.features.studio.assets import probe_audio
from backend.paths.manager import paths
from backend.routes.download import _resolve_download_source

ALLOWED_STEM_TRACKS = {
    "woodwinds",
    "brass",
    "fx",
    "synth",
    "strings",
    "percussion",
    "keyboard",
    "guitar",
    "bass",
    "drums",
    "backing_vocals",
    "vocals",
}

DEFAULT_STEM_TRACKS = ["drums", "bass", "guitar", "keyboard", "strings", "synth"]


def _safe_float(value):
    try:
        return float(value)
    except Exception:
        return None


def _duration_from_payload(payload: dict) -> float | None:
    duration = payload.get("durationSec") or payload.get("duration")
    duration_value = _safe_float(duration)
    if duration_value and duration_value > 0:
        return duration_value
    start = _safe_float(payload.get("startSec"))
    end = _safe_float(payload.get("endSec"))
    if start is not None and end is not None and end > start:
        return end - start
    return None


def _resolve_source_path(payload: dict, key: str) -> str | None:
    direct = payload.get(key)
    if direct:
        return direct
    asset_id = payload.get(key.replace("Path", "Id"))
    if asset_id:
        resolved = _resolve_download_source(asset_id)
        if resolved:
            return str(resolved)
    return None


def _normalize_track_name(value: str) -> str:
    return str(value or "").strip().lower().replace(" ", "_")


def _run_generation(method: str, payload: dict) -> dict:
    output_name = f"studio_ai_{uuid.uuid4().hex}.wav"
    output_path = paths.EXPORT_DIR / output_name

    duration = _duration_from_payload(payload)
    prompt = str(payload.get("prompt") or payload.get("style") or "").strip()
    lyrics = str(payload.get("lyrics") or "").strip()
    task_type = "text2music"

    source_path = _resolve_source_path(payload, "sourceAssetPath")
    reference_path = _resolve_source_path(payload, "referenceAssetPath") or source_path

    if method in {"repaint", "replace_section"}:
        task_type = "repaint"
    elif method == "extend":
        task_type = "complete"
    elif method == "cover":
        task_type = "cover"
    elif method == "vocal2bgm":
        task_type = "repaint"
        if not prompt:
            prompt = "instrumental only, remove vocals"
        if not lyrics:
            lyrics = "[Instrumental]"

    if task_type in {"repaint", "complete"} and not source_path:
        raise RuntimeError("sourceAssetPath is required for repaint/extend jobs.")
    if task_type == "cover" and not reference_path:
        raise RuntimeError("referenceAssetPath is required for cover jobs.")

    infer_params = {
        "prompt": prompt,
        "lyrics": lyrics,
        "task_type": task_type,
        "audio_duration": duration,
        "src_audio": source_path,
        "reference_audio": reference_path if task_type == "cover" else None,
        "audio_cover_strength": payload.get("audio_cover_strength", 1.0),
        "prompt_engine": "llm",
        "thinking": True,
    }

    extra = payload.get("acestepParams") if isinstance(payload.get("acestepParams"), dict) else {}
    infer_params.update(extra)

    job_stub = {"progress": 0, "status": "running"}
    with redirect_stdout(sys.stderr):
        _run_acestep15_generation(job_stub, f"studio-{uuid.uuid4().hex}", infer_params, output_path)

    info = probe_audio(output_path)
    return {
        "assetId": f"studio_ai:{uuid.uuid4().hex}",
        "assetPath": str(output_path),
        "assetUrl": f"/api/download/exports/{output_name}",
        "durationSec": info.get("durationSec", 0.0),
        "sampleRate": info.get("sampleRate"),
    }


def _stem_extract(payload: dict) -> dict:
    source_path = _resolve_source_path(payload, "sourceAssetPath")
    if not source_path:
        raise RuntimeError("sourceAssetPath is required for stem extraction.")

    track_names = payload.get("trackNames") or payload.get("tracks") or payload.get("stemTracks")
    if isinstance(track_names, str):
        track_names = [t.strip() for t in track_names.split(",") if t.strip()]
    if not track_names:
        track_names = DEFAULT_STEM_TRACKS

    normalized = []
    for name in track_names:
        track = _normalize_track_name(name)
        if track and track in ALLOWED_STEM_TRACKS and track not in normalized:
            normalized.append(track)

    if not normalized:
        raise RuntimeError("No valid stem track names provided.")

    source_info = probe_audio(Path(source_path)) if source_path else {}
    duration = _duration_from_payload(payload) or source_info.get("durationSec")
    prompt = str(payload.get("prompt") or payload.get("caption") or "").strip()
    extra = payload.get("acestepParams") if isinstance(payload.get("acestepParams"), dict) else {}

    extract_model = os.environ.get("STUDIO_AI_EXTRACT_MODEL") or "acestep-v15-base"
    stems = []
    for track_name in normalized:
        output_name = f"studio_stem_{track_name}_{uuid.uuid4().hex}.wav"
        output_path = paths.EXPORT_DIR / output_name
        instruction = f"Extract the {track_name} track from the audio:"
        track_prompt = prompt or track_name.replace("_", " ")
        infer_params = {
            "prompt": track_prompt,
            "lyrics": "",
            "task_type": "extract",
            "instruction": instruction,
            "src_audio": source_path,
            "audio_duration": duration,
            "prompt_engine": "llm",
            "thinking": True,
            "main_model_path": extract_model,
            "inference_steps": 64,
            "guidance_scale": 7.0,
            "shift": 3.0,
        }
        infer_params.update(extra)

        job_stub = {"progress": 0, "status": "running"}
        with redirect_stdout(sys.stderr):
            _run_acestep15_generation(job_stub, f"studio-stem-{uuid.uuid4().hex}", infer_params, output_path)

        info = probe_audio(output_path)
        stems.append(
            {
                "assetId": f"studio_stem:{uuid.uuid4().hex}",
                "assetPath": str(output_path),
                "assetUrl": f"/api/download/exports/{output_name}",
                "durationSec": info.get("durationSec", 0.0),
                "sampleRate": info.get("sampleRate"),
                "trackName": track_name,
                "label": track_name.replace("_", " ").title(),
            }
        )

    return {"stems": stems}


def _understand(payload: dict) -> dict:
    source_path = _resolve_source_path(payload, "sourceAssetPath")
    info = probe_audio(Path(source_path)) if source_path else {"durationSec": 0.0}
    return {
        "bpm": None,
        "key": None,
        "timeSignature": None,
        "caption": payload.get("prompt") or payload.get("caption") or "",
        "durationSec": info.get("durationSec", 0.0),
    }


def _lrc(payload: dict) -> dict:
    lyrics = payload.get("lyrics") or payload.get("lyricsOrTranscript") or ""
    lines = [line.strip() for line in str(lyrics).splitlines() if line.strip()]
    source_path = _resolve_source_path(payload, "sourceAssetPath")
    info = probe_audio(Path(source_path)) if source_path else {"durationSec": 0.0}
    duration = info.get("durationSec", 0.0) or _duration_from_payload(payload) or 10.0
    if not lines:
        return {"segments": []}
    step = duration / len(lines)
    segments = []
    for idx, line in enumerate(lines):
        segments.append(
            {
                "start": idx * step,
                "end": (idx + 1) * step,
                "text": line,
            }
        )
    return {"segments": segments}


def _quality(payload: dict) -> dict:
    return {"score": 0.5, "notes": "Quality scoring not configured yet."}


def _handle_request(raw: str) -> dict:
    if not raw:
        return {"error": "No input provided"}
    try:
        request = json.loads(raw)
    except json.JSONDecodeError:
        return {"error": "Invalid JSON payload"}

    method = request.get("method")
    payload = request.get("payload") or {}

    original_stdout = sys.stdout
    try:
        # Force any stray prints to stderr so stdout stays clean JSON.
        sys.stdout = sys.stderr
        if method in {"repaint", "replace_section", "extend", "add_layer", "cover", "vocal2bgm"}:
            response = _run_generation(method, payload)
        elif method == "stem_extract":
            response = _stem_extract(payload)
        elif method == "understand":
            response = _understand(payload)
        elif method == "lrc":
            response = _lrc(payload)
        elif method == "quality_score":
            response = _quality(payload)
        else:
            response = {"error": f"Unsupported method: {method}"}
    except Exception as exc:
        response = {"error": str(exc)}
    finally:
        sys.stdout = original_stdout

    return response


def main():
    saw_request = False
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        saw_request = True
        response = _handle_request(raw)
        print(json.dumps(response), file=sys.stdout, flush=True)

    if not saw_request:
        print(json.dumps({"error": "No input provided"}), file=sys.stdout, flush=True)


if __name__ == "__main__":
    main()
