"""Job plumbing shared by every song-generation engine.

This is the half of the old `providers/ace_step.py` that was never about
ACE-Step: where a job's assets live, how its status and progress move forward,
and what happens to a finished song afterwards (stem separation, then RVC).

It was extracted when ACE-Step was removed, because the YuE2 provider and the
cover pipeline both needed it and neither should import a dead engine.
"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
import time
import uuid
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

from backend.features.inference.service import run_inference_job
from backend.features.processing.service import process_audio_files_thread
from backend.jobs.registry import active_jobs
from backend.paths.manager import paths
from backend.storage.inference_runs import make_run_id
from backend.storage.metadata import (
    make_storage_name,
    register_upload_metadata,
    sanitize_filename_for_display,
)

SONG_GENERATION_DIR = paths.BASE_DIR / "data" / "generated_songs"
SONG_GENERATION_DIR.mkdir(parents=True, exist_ok=True)

SONG_GENERATION_JOBS_DIR = SONG_GENERATION_DIR / "jobs"
SONG_GENERATION_JOBS_DIR.mkdir(parents=True, exist_ok=True)

ASSET_KEYS = [
    "preview_mix",
    "full_mix",
    "instrumental",
    "vocals_raw",
    "vocals_rvc",
    "final_mix_rvc",
]

STATUS_ORDER = [
    "queued",
    "preview_generating",
    "preview_ready",
    "full_generating",
    "full_ready",
    "separating",
    "separated",
    "rvc_running",
    "rvc_ready",
    "completed",
    "failed",
]


def _coerce_bool(value, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}
    return bool(value)


def _job_dir(job_id: str) -> Path:
    d = SONG_GENERATION_JOBS_DIR / job_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _asset_path(job_id: str, key: str) -> Path:
    return _job_dir(job_id) / f"{key}.wav"


def _init_assets() -> dict:
    return {k: {"ready": False} for k in ASSET_KEYS}


def _set_asset_ready(job: dict, job_id: str, key: str, path: Path) -> None:
    if "assets" not in job or not isinstance(job.get("assets"), dict):
        job["assets"] = _init_assets()
    asset = dict(job["assets"].get(key) or {})
    asset["ready"] = True
    asset["url"] = f"/api/song-generation/{job_id}/audio/{key}"
    asset["path"] = str(path)
    job["assets"][key] = asset


def _set_progress(job: dict, value: int) -> None:
    try:
        current = int(job.get("progress") or 0)
    except Exception:
        current = 0
    job["progress"] = max(current, int(value))


def _set_status(job: dict, status: str, message: str | None = None) -> None:
    current = job.get("status") or "queued"
    if current in {"completed", "failed"}:
        return
    try:
        if STATUS_ORDER.index(status) < STATUS_ORDER.index(current):
            return
    except ValueError:
        pass
    job["status"] = status
    if message is not None:
        job["status_message"] = message


# tqdm writes "17/32" and "53%"; both patterns used to be written as r"(\\d+)"
# in the ACE-Step version, which in a raw string matches a literal backslash
# followed by "d" and therefore never matched anything. Fixed on extraction.
_STEP_RE = re.compile(r"(\d+)/(\d+)")
_PCT_RE = re.compile(r"(\d+)%")


def _apply_progress_from_line(job: dict, line: str) -> bool:
    """Translate a worker's stdout line into job progress. True if consumed."""
    if line.startswith("PROGRESS:") or line.startswith("TQDM_PROGRESS:"):
        parts = line.split(":", 2)
        if len(parts) >= 2:
            try:
                _set_progress(job, int(parts[1]))
                if len(parts) >= 3:
                    job["status_message"] = parts[2]
            except ValueError:
                pass
        return True
    if "%|" in line or ("it/s" in line and "/" in line):
        step_match = _STEP_RE.search(line)
        pct_match = _PCT_RE.search(line)
        if step_match:
            current = int(step_match.group(1))
            total = int(step_match.group(2))
            if total:
                pct = 25 + int((current / total) * 65)
                _set_progress(job, min(pct, 90))
                job["status_message"] = f"Generating audio... Step {current}/{total}"
                return True
        if pct_match:
            pct = int(pct_match.group(1))
            mapped_pct = 25 + int((pct / 100) * 65)
            _set_progress(job, min(mapped_pct, 90))
            return True
    return False


def _mix_audio(inst_path: Path, vocal_path: Path, output_path: Path) -> bool:
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(inst_path),
        "-i",
        str(vocal_path),
        "-filter_complex",
        "[0:a]volume=0.8[a0];[1:a]volume=0.8[a1];[a0][a1]amix=inputs=2:normalize=0:dropout_transition=0",
        "-ac",
        "2",
        str(output_path),
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return result.returncode == 0 and output_path.exists()


def _run_separation(
    job: dict, job_id: str, source_path: Path, discard_vocals: bool = False
) -> tuple[Path | None, Path | None, str | None]:
    """Split a finished song into vocals and instrumental via the UVR pipeline.

    `discard_vocals` is for Instrumental Only: the lyrics prompt already asked
    YuE2 for a wordless track, but nothing enforces that at generation time,
    so whatever it hums under its breath is separated out here and never
    exposed. The instrumental stem becomes the track's own full mix instead
    of the raw generation, which is what makes "no vocals" a guarantee rather
    than a request.
    """
    _set_status(job, "separating", "Separating stems...")
    _set_progress(job, 60)

    title_safe = sanitize_filename_for_display(job.get("params", {}).get("title", "untitled"))
    original_name = f"{title_safe}.wav"
    stored_name, file_id = make_storage_name(original_name)
    input_path = paths.INPUT_DIR / stored_name

    print(f"[songgen] Copying generated song to input: {input_path}", flush=True)
    shutil.copy(str(source_path), str(input_path))
    register_upload_metadata(title_safe, stored_name, file_id, internal=True)

    process_job_id = str(uuid.uuid4())
    active_jobs[process_job_id] = {
        "id": process_job_id,
        "status": "starting",
        "progress": 0,
        "config": {"segment": False, "process": True, "export": False, "clean": False},
        "started_at": time.time(),
        "fileIds": [file_id],
    }

    print(f"[songgen] Starting vocal separation job: {process_job_id}", flush=True)
    process_audio_files_thread(process_job_id, segment=False, process=True, export=False, clean=False)

    process_result = active_jobs.get(process_job_id, {})
    if process_result.get("status") == "failed":
        print(f"[songgen] Vocal separation failed: {process_result.get('error')}", flush=True)
        return None, None, file_id

    base_name = Path(stored_name).stem
    vocals_file = paths.UVR_RAW_DIR / f"{base_name}_vocals.wav"
    instrumental_file = paths.INSTRUMENTAL_DIR / f"{base_name}_instrumental.wav"

    try:
        if input_path.exists():
            input_path.unlink()
            print(f"[songgen] Deleted input copy: {input_path}", flush=True)
    except Exception as del_err:
        print(f"[songgen] Warning: Could not delete input copy: {del_err}", flush=True)

    # The metadata record — unlike the file above — has to outlive this
    # function: _run_rvc still needs it to look up file_id by name once
    # separation hands back control, and it always ran second. Unregistering
    # it here, before that ever happened, is why a voice conversion
    # immediately following a song's own generation failed with "Unknown
    # fileId" every single time — never a race, always this. It is the
    # caller's job to unregister it once it is actually done with it.

    if vocals_file.exists() and not discard_vocals:
        shutil.copy2(vocals_file, _asset_path(job_id, "vocals_raw"))
        _set_asset_ready(job, job_id, "vocals_raw", _asset_path(job_id, "vocals_raw"))
        job["vocals_url"] = f"/api/song-generation/{job_id}/audio/vocals_raw"
    if instrumental_file.exists():
        shutil.copy2(instrumental_file, _asset_path(job_id, "instrumental"))
        _set_asset_ready(job, job_id, "instrumental", _asset_path(job_id, "instrumental"))
        job["instrumental_url"] = f"/api/song-generation/{job_id}/audio/instrumental"
        if discard_vocals:
            full_mix_path = _asset_path(job_id, "full_mix")
            shutil.copy2(instrumental_file, full_mix_path)
            _set_asset_ready(job, job_id, "full_mix", full_mix_path)

    job["processed"] = bool((vocals_file.exists() and not discard_vocals) or instrumental_file.exists())

    if job["processed"]:
        _set_status(job, "separated", "Stems ready")
    else:
        # The pipeline reported success but wrote nothing. Saying "Stems ready"
        # here — which is what this used to do unconditionally — leaves a song
        # with only a full mix, no explanation, and a voice conversion that is
        # then skipped for want of a vocal track. Say so instead.
        print(f"[songgen] Separation produced no stems for {job_id}", flush=True)
        job["notices"] = list(job.get("notices") or []) + [
            "Stem separation produced no output, so this track was not split and no voice conversion ran."
        ]
        _set_status(job, "separated", "Stem separation produced no output")
    _set_progress(job, 75)
    return (
        vocals_file if vocals_file.exists() else None,
        instrumental_file if instrumental_file.exists() else None,
        file_id,
    )


RVC_INFERENCE_DEFAULTS = {
    "pitch": 0,
    "indexRate": 0.88,
    "protectVoiced": 0.6,
    "f0Method": "rmvpe",
    "splitAudio": False,
    "autotune": False,
    "autotuneStrength": 1,
    "proposedPitch": False,
    "proposedPitchThreshold": 155,
    "cleanAudio": False,
    "cleanStrength": 0.5,
    "exportFormat": "WAV",
    "volumeEnvelopeEnabled": True,
    "formantShifting": False,
    "formantPreset": "none",
    "formantQfrency": 1,
    "formantTimbre": 1,
    "postProcess": False,
    "reverb": False,
    "reverbRoomSize": 0.5,
    "reverbDamping": 0.5,
    "reverbWetGain": 0.33,
    "reverbDryGain": 0.4,
    "reverbWidth": 1,
    "reverbFreezeMode": 0,
    "pitchShift": False,
    "pitchShiftSemitones": 0,
    "limiter": False,
    "limiterThreshold": -6,
    "limiterReleaseTime": 0.05,
    "gain": False,
    "gainDb": 0,
    "distortion": False,
    "distortionGain": 25,
    "chorus": False,
    "chorusRate": 1,
    "chorusDepth": 0.25,
    "chorusCenterDelay": 7,
    "chorusFeedback": 0,
    "chorusMix": 0.5,
    "bitcrush": False,
    "bitcrushBitDepth": 8,
    "clipping": False,
    "clippingThreshold": -6,
    "compressor": False,
    "compressorThreshold": 0,
    "compressorRatio": 1,
    "compressorAttack": 1,
    "compressorRelease": 100,
    "delay": False,
    "delaySeconds": 0.5,
    "delayFeedback": 0,
    "delayMix": 0.5,
    "sid": 0,
    "volumeEnvelope": 1,
}


def _run_rvc(job: dict, job_id: str, file_id: str, vocals_file: Path, instrumental_file: Path | None) -> None:
    """Re-sing the separated vocals with a trained RVC model, then remix.

    The song itself already succeeded by the time this runs, so a failure
    here must never flip the job to "failed" — it only ever leaves the
    voice take missing, which the library already shows as "<voice> not
    applied". What it did not do, before `job["voice_error"]` existed, was
    say why: every exit below was a silent `return`, so the one clue to a
    failed RVC step lived for exactly as long as the reference to
    `inference_result` did — gone the moment this function returned, let
    alone across a restart.
    """
    model_name = job.get("params", {}).get("model_name")
    model_obj = job.get("params", {}).get("model")
    if not (model_name and model_obj and vocals_file and vocals_file.exists()):
        if model_name:
            reason = "No usable vocal to convert." if not (vocals_file and vocals_file.exists()) else "Voice model data was missing from the request."
            job["voice_error"] = reason
            logger.warning("[%s] RVC skipped for '%s': %s", job_id, model_name, reason)
        return

    _set_status(job, "rvc_running", f"Applying voice model: {model_name}...")
    _set_progress(job, 80)

    inference_params = dict(RVC_INFERENCE_DEFAULTS)

    # songJobId, not fileId, is what run_inference_job checks first — it reads
    # this job's own already-copied vocals_raw.wav directly, the same file
    # _run_separation just placed here, instead of going through the upload
    # metadata table by fileId at all. That is not just simpler: it is what
    # makes save_inference_run_metadata later record this run's source as the
    # song itself. Without it, the run it wrote down pointed at file_id — the
    # temporary upload separation used and already unregistered by the time
    # anyone read it back — which resolve_source could never match to this
    # job, so the run showed up as a second, permanent, unrelated-looking
    # "conversion" row for the exact voice this song already carried.
    track_obj = {
        "name": sanitize_filename_for_display(job.get("params", {}).get("title", "untitled")),
        "songJobId": job_id,
        "fileId": file_id,
        "vocalFileType": "raw_vocals",
        "processed": False,
    }

    inference_job_id = str(uuid.uuid4())
    inference_run_id = make_run_id()
    active_jobs[inference_job_id] = {
        "id": inference_job_id,
        "type": "inference",
        # This step already has a visible placeholder — the song job itself,
        # running right now under this same job_id. /api/inference-jobs
        # exists so a standalone "Convert with one of my voices" survives a
        # refresh, and it has no way to tell this apart from one of those
        # without this flag: same registry, same "type": "inference" shape,
        # and it was showing a second, redundant "Converting" card for a
        # voice this song was already applying to itself.
        "internal": True,
        "model_name": model_name,
        "track": track_obj,
        "params": inference_params,
        "run_id": inference_run_id,
        "status": "starting",
        "progress": 0,
        "logs": ["Starting inference..."],
        "started_at": datetime.now().isoformat(),
    }

    run_inference_job(inference_job_id, inference_run_id, model_obj, track_obj, inference_params)
    inference_result = active_jobs.get(inference_job_id, {})
    if inference_result.get("status") != "completed":
        reason = inference_result.get("error") or f"Voice conversion ended as '{inference_result.get('status')}'."
        job["voice_error"] = reason
        logger.warning("[%s] RVC failed for '%s': %s", job_id, model_name, reason)
        return

    run_id = inference_result.get("runId") or inference_result.get("run_id") or inference_run_id
    inferred = paths.INFERENCE_RUNS_DIR / run_id / "inferred.wav"
    if not inferred.exists():
        reason = f"Voice conversion finished but left no output at {inferred}."
        job["voice_error"] = reason
        logger.warning("[%s] RVC for '%s': %s", job_id, model_name, reason)
        return

    target = _asset_path(job_id, "vocals_rvc")
    shutil.copy2(inferred, target)
    _set_asset_ready(job, job_id, "vocals_rvc", target)
    job["vocals_url"] = f"/api/song-generation/{job_id}/audio/vocals_rvc"
    _set_status(job, "rvc_ready", "Enhanced vocals ready")
    _set_progress(job, 90)

    if instrumental_file and instrumental_file.exists():
        final_mix = _asset_path(job_id, "final_mix_rvc")
        if _mix_audio(instrumental_file, target, final_mix):
            _set_asset_ready(job, job_id, "final_mix_rvc", final_mix)
