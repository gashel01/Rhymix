import io
import json
import os
import sys
import uuid
from contextlib import redirect_stdout
from pathlib import Path

import scipy.signal

# Compatibility shim for older librosa on newer SciPy, where `scipy.signal.hann`
# moved under `scipy.signal.windows`.
if not hasattr(scipy.signal, "hann") and hasattr(scipy.signal, "windows"):
    scipy.signal.hann = scipy.signal.windows.hann

import librosa
import numpy as np

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
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MAJOR_PROFILE = np.asarray([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], dtype=np.float32)
MINOR_PROFILE = np.asarray([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17], dtype=np.float32)
TIME_SIGNATURE_CANDIDATES = (3, 4, 5, 6)


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


def _normalize_tempo(value) -> float | None:
    if isinstance(value, np.ndarray):
        if value.size == 0:
            return None
        value = value.reshape(-1)[0]
    try:
        tempo = float(value)
    except Exception:
        return None
    if not np.isfinite(tempo) or tempo <= 0:
        return None
    while tempo < 70.0:
        tempo *= 2.0
    while tempo > 200.0:
        tempo /= 2.0
    return round(tempo, 2)


def _estimate_bpm_from_beats(beat_times: np.ndarray) -> float | None:
    if beat_times.size < 2:
        return None
    intervals = np.diff(beat_times)
    intervals = intervals[np.isfinite(intervals) & (intervals > 0.0)]
    if intervals.size == 0:
        return None
    bpm = 60.0 / float(np.median(intervals))
    return _normalize_tempo(bpm)


def _safe_analysis_window(payload: dict) -> tuple[float, float | None]:
    start_sec = _safe_float(payload.get("startSec"))
    end_sec = _safe_float(payload.get("endSec"))
    start_value = max(0.0, start_sec or 0.0)
    if end_sec is None or end_sec <= start_value:
        return start_value, None
    return start_value, end_sec


def _load_analysis_audio(source_path: str, payload: dict) -> tuple[np.ndarray, int, dict]:
    start_sec, end_sec = _safe_analysis_window(payload)
    duration = None if end_sec is None else max(0.1, end_sec - start_sec)
    audio, sample_rate = librosa.load(source_path, sr=22050, mono=True, offset=start_sec, duration=duration)
    if audio is None or np.size(audio) == 0:
        raise RuntimeError("No audio samples available for analysis.")
    analysis_end = start_sec + (float(np.size(audio)) / float(sample_rate))
    return audio, sample_rate, {
        "startSec": round(start_sec, 3),
        "endSec": round(analysis_end, 3),
    }


def _estimate_key(audio: np.ndarray, sample_rate: int) -> str | None:
    try:
        harmonic = librosa.effects.harmonic(audio)
        chroma = librosa.feature.chroma_cqt(y=harmonic, sr=sample_rate)
    except Exception:
        return None
    if chroma is None or not np.size(chroma):
        return None
    chroma_mean = np.asarray(np.mean(chroma, axis=1), dtype=np.float32)
    if chroma_mean.size != 12:
        return None
    energy = np.maximum(chroma_mean, 0.0)
    total = float(np.sum(energy))
    if total <= 1e-6:
        return None
    energy /= total

    best_label = None
    best_score = -np.inf
    for mode, profile in (("major", MAJOR_PROFILE), ("minor", MINOR_PROFILE)):
        normalized_profile = profile / np.sum(profile)
        for root_idx, note_name in enumerate(NOTE_NAMES):
            rotated = np.roll(normalized_profile, root_idx)
            score = float(np.dot(energy, rotated))
            if score > best_score:
                best_score = score
                best_label = f"{note_name} {mode}"
    return best_label


def _estimate_time_signature(beat_frames: np.ndarray, onset_envelope: np.ndarray) -> str | None:
    if beat_frames is None or onset_envelope is None:
        return None
    if np.size(beat_frames) < 6 or np.size(onset_envelope) == 0:
        return None
    indices = np.asarray(beat_frames, dtype=int)
    indices = indices[(indices >= 0) & (indices < np.size(onset_envelope))]
    if indices.size < 6:
        return None
    strengths = np.asarray(onset_envelope[indices], dtype=np.float32)
    strengths = strengths[np.isfinite(strengths)]
    if strengths.size < 6:
        return None

    best_signature = "4/4"
    best_score = -np.inf
    for beats_per_bar in TIME_SIGNATURE_CANDIDATES:
        if strengths.size < beats_per_bar * 2:
            continue
        folded = np.zeros(beats_per_bar, dtype=np.float32)
        counts = np.zeros(beats_per_bar, dtype=np.float32)
        for idx, value in enumerate(strengths):
            bucket = idx % beats_per_bar
            folded[bucket] += value
            counts[bucket] += 1.0
        counts[counts == 0.0] = 1.0
        profile = folded / counts
        mean_value = float(np.mean(profile))
        peak_value = float(np.max(profile))
        score = (peak_value - mean_value) + max(0.0, float(profile[0]) - mean_value) * 0.5
        if score > best_score or (abs(score - best_score) < 1e-6 and beats_per_bar == 4):
            best_score = score
            best_signature = f"{beats_per_bar}/4"
    return best_signature


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
    if not source_path:
        raise RuntimeError("sourceAssetPath is required for analysis.")
    source_info = probe_audio(Path(source_path))
    audio, sample_rate, analysis_range = _load_analysis_audio(source_path, payload)
    onset_source = librosa.effects.percussive(audio)
    onset_envelope = librosa.onset.onset_strength(y=onset_source, sr=sample_rate)
    tempo, beat_frames = librosa.beat.beat_track(onset_envelope=onset_envelope, sr=sample_rate)
    beat_times = librosa.frames_to_time(beat_frames, sr=sample_rate) if np.size(beat_frames) else np.asarray([])
    bpm = _normalize_tempo(tempo) or _estimate_bpm_from_beats(np.asarray(beat_times, dtype=np.float32))
    key = _estimate_key(audio, sample_rate)
    time_signature = _estimate_time_signature(np.asarray(beat_frames), np.asarray(onset_envelope))
    analysis_duration = round(max(0.0, analysis_range["endSec"] - analysis_range["startSec"]), 3)
    return {
        "bpm": bpm,
        "key": key,
        "timeSignature": time_signature,
        "caption": payload.get("prompt") or payload.get("caption") or "",
        "durationSec": source_info.get("durationSec", 0.0),
        "analysisDurationSec": analysis_duration,
        "analysisRange": analysis_range,
        "sampleRate": source_info.get("sampleRate"),
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
