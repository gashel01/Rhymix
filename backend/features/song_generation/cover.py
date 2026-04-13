
import json
import logging
import os
import shutil
import subprocess
import threading
import uuid
from datetime import datetime
from pathlib import Path

from backend.features.inference.models import extract_epoch_rate_from_filename
from backend.features.inference.service import run_inference_job
from backend.jobs.registry import active_jobs, song_generation_jobs
from backend.paths.manager import paths
from backend.storage.inference_runs import load_inference_run_metadata, make_run_id
from backend.storage.metadata import get_upload_base_name, get_upload_metadata
from backend.features.song_generation.providers.ace_step import (
    _asset_path,
    _coerce_bool,
    _init_assets,
    _job_dir,
    _mix_audio,
    _normalize_acestep15_params,
    _run_acestep15_generation,
    _run_separation,
    _set_asset_ready,
    _set_progress,
    _set_status,
)

logger = logging.getLogger(__name__)
_WHISPERX_LOCK = threading.Lock()
_WHISPER_LOCK = threading.Lock()
_WHISPER_MODEL = None


def _get_whisperx_python() -> str:
    python_override = os.environ.get("WHISPERX_PYTHON")
    if python_override:
        return python_override

    venv_root = os.environ.get("WHISPERX_VENV")
    if venv_root:
        venv_root = str(venv_root)
        if os.name == "nt":
            candidate = Path(venv_root) / "Scripts" / "python.exe"
        else:
            candidate = Path(venv_root) / "bin" / "python"
        if candidate.exists():
            return str(candidate)

    raise RuntimeError(
        "WhisperX must run in a separate venv. Set WHISPERX_PYTHON or WHISPERX_VENV."
    )


def _run_whisperx_transcribe(audio_path: Path) -> str:
    python_exe = _get_whisperx_python()
    paths.TEMP_WAV_DIR.mkdir(parents=True, exist_ok=True)
    script_path = paths.TEMP_WAV_DIR / f"whisperx_transcribe_{uuid.uuid4().hex}.py"

    script_path.write_text(
        (
            "import json\n"
            "import os\n"
            "import sys\n"
            "os.environ.setdefault('TORCH_LOAD_WEIGHTS_ONLY', '0')\n"
            "try:\n"
            "    import torch.serialization as ts\n"
            "    from omegaconf import DictConfig, ListConfig\n"
            "    from omegaconf.base import ContainerMetadata\n"
            "    try:\n"
            "        ts.add_safe_globals([DictConfig, ListConfig, ContainerMetadata])\n"
            "    except Exception:\n"
            "        pass\n"
            "except Exception:\n"
            "    pass\n"
            "import whisperx\n"
            "audio_path = sys.argv[1]\n"
            "model_name = os.environ.get('WHISPERX_MODEL', 'base')\n"
            "device = os.environ.get('WHISPERX_DEVICE', 'cpu')\n"
            "compute_type = os.environ.get('WHISPERX_COMPUTE_TYPE', 'int8')\n"
            "model = whisperx.load_model(model_name, device=device, compute_type=compute_type)\n"
            "result = model.transcribe(audio_path)\n"
            "segments = result.get('segments') or []\n"
            "text = ' '.join([(s.get('text') or '').strip() for s in segments]).strip()\n"
            "payload = {'text': text or (result.get('text') or '')}\n"
            "print(json.dumps(payload))\n"
        ),
        encoding="utf-8",
    )

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    proc = subprocess.run(
        [python_exe, str(script_path), str(audio_path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )
    try:
        script_path.unlink(missing_ok=True)
    except Exception:
        pass

    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or f"WhisperX exited with code {proc.returncode}")

    raw_stdout = proc.stdout.strip()
    if not raw_stdout:
        raise RuntimeError("WhisperX returned empty output")

    # WhisperX prints progress logs to stdout; extract the last JSON object.
    json_line = None
    for line in reversed(raw_stdout.splitlines()):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            json_line = line
            break

    if not json_line:
        raise RuntimeError("WhisperX returned invalid output")

    try:
        payload = json.loads(json_line)
        return str(payload.get("text") or "").strip()
    except Exception:
        raise RuntimeError("WhisperX returned invalid output")


def _get_whisper_model():
    global _WHISPER_MODEL
    with _WHISPER_LOCK:
        if _WHISPER_MODEL is None:
            try:
                import whisper  # type: ignore
            except Exception as exc:
                raise RuntimeError(
                    "Whisper is not installed. Install with `pip install openai-whisper`."
                ) from exc
            model_name = os.environ.get("WHISPER_MODEL", "base")
            device = os.environ.get("WHISPER_DEVICE", "cpu")
            _WHISPER_MODEL = whisper.load_model(model_name, device=device)
        return _WHISPER_MODEL


def _run_whisper_transcribe(audio_path: Path) -> str:
    model = _get_whisper_model()
    result = model.transcribe(str(audio_path), fp16=False)
    return str(result.get("text") or "").strip()


def transcribe_audio_path(audio_path: Path, engine: str = "whisperx") -> str:
    if not audio_path or not audio_path.exists():
        raise ValueError("Audio path is missing or does not exist")

    engine = str(engine or "whisperx").strip().lower()
    if engine == "whisper":
        return _run_whisper_transcribe(audio_path)
    return _run_whisperx_transcribe(audio_path)


def _pick_transcribe_source(source: dict) -> Path | None:
    p = source.get("vocals_path")
    if p and isinstance(p, Path) and p.exists():
        return p
    return None


def transcribe_cover_source(source_song_id: str, engine: str = "whisperx") -> str:
    source = resolve_cover_source(source_song_id)
    if not source or not source.get("has_audio"):
        raise ValueError("Source song is not available or has no audio")

    audio_path = _pick_transcribe_source(source)
    if not audio_path:
        raise ValueError("No local vocals audio available for transcription")

    engine = str(engine or "whisperx").strip().lower()
    if engine == "whisper":
        return _run_whisper_transcribe(audio_path)
    return _run_whisperx_transcribe(audio_path)


def _parse_source_song_id(source_song_id: str) -> tuple[str, str]:
    raw = str(source_song_id or "").strip()
    if ":" in raw:
        kind, ident = raw.split(":", 1)
        return kind.strip().lower(), ident.strip()
    return "upload", raw


def _resolve_upload_source(file_id: str):
    base_name = get_upload_base_name(file_id)
    if not base_name:
        return None
    meta = get_upload_metadata(file_id) or {}
    inst = paths.INSTRUMENTAL_DIR / f"{base_name}_instrumental.wav"
    raw = paths.UVR_RAW_DIR / f"{base_name}_vocals.wav"
    proc = paths.UVR_PROCESSED_DIR / f"{base_name}_vocals.wav"
    vocal = proc if proc.exists() else raw if raw.exists() else None
    vocal_type = "processed_vocals" if vocal and vocal == proc else "raw_vocals"
    instrumental_url = f"/api/download/instrumental/{file_id}" if inst.exists() else None
    vocals_url = f"/api/download/{vocal_type}/{file_id}" if vocal else None
    audio_path = vocal if vocal else (inst if inst.exists() else None)

    return {
        "source_song_id": f"upload:{file_id}",
        "source_type": "upload",
        "file_id": file_id,
        "title": meta.get("safeDisplayName") or meta.get("originalName") or file_id,
        "artist": None,
        "duration": None,
        "instrumental_path": inst if inst.exists() else None,
        "vocals_path": vocal,
        "audio_path": audio_path if isinstance(audio_path, Path) and audio_path.exists() else None,
        "audio_url": vocals_url or instrumental_url,
        "instrumental_url": instrumental_url,
        "vocals_url": vocals_url,
    }


def _resolve_inference_source(run_id: str):
    run_meta = load_inference_run_metadata(run_id)
    if not run_meta:
        return None

    file_id = run_meta.get("inputFileId")
    inferred_name = run_meta.get("outputFileName") or "inferred.wav"
    inferred = paths.INFERENCE_RUNS_DIR / run_id / inferred_name
    inferred_exists = inferred.exists()
    inferred_url = run_meta.get("outputUrl") or f"/api/download/inference/{run_id}"

    upload_source = _resolve_upload_source(file_id) if file_id else None
    inst = upload_source.get("instrumental_path") if upload_source else None
    original_vocal = upload_source.get("vocals_path") if upload_source else None
    vocals_path = inferred if inferred_exists else original_vocal

    return {
        "source_song_id": f"run:{run_id}",
        "source_type": "inference",
        "file_id": file_id,
        "run_id": run_id,
        "title": run_meta.get("inputDisplayName")
        or run_meta.get("inputOriginalName")
        or run_meta.get("id")
        or run_id,
        "artist": run_meta.get("modelName"),
        "duration": None,
        "instrumental_path": inst,
        "vocals_path": vocals_path if vocals_path and vocals_path.exists() else None,
        "audio_path": inferred if inferred_exists else vocals_path if vocals_path and vocals_path.exists() else inst,
        "audio_url": inferred_url if inferred_exists else upload_source.get("audio_url") if upload_source else None,
        "instrumental_url": upload_source.get("instrumental_url") if upload_source else None,
        "vocals_url": inferred_url if inferred_exists else upload_source.get("vocals_url") if upload_source else None,
    }


def _resolve_song_generation_source(job_id: str):
    job = song_generation_jobs.get(job_id)
    if not job:
        return None

    source_audio = None
    source_key = None
    for key in ["final_mix_rvc", "full_mix", "preview_mix"]:
        p = _asset_path(job_id, key)
        if p.exists():
            source_audio = p
            source_key = key
            break
    instrumental = _asset_path(job_id, "instrumental")
    vocals_rvc = _asset_path(job_id, "vocals_rvc")
    vocals_raw = _asset_path(job_id, "vocals_raw")
    vocals = vocals_rvc if vocals_rvc.exists() else vocals_raw if vocals_raw.exists() else None

    return {
        "source_song_id": f"songgen:{job_id}",
        "source_type": "song_generation",
        "file_id": None,
        "title": job.get("title") or "Generated song",
        "artist": None,
        "duration": None,
        "instrumental_path": instrumental if instrumental.exists() else None,
        "vocals_path": vocals,
        "audio_path": source_audio
        or (instrumental if instrumental.exists() else None)
        or (vocals if vocals and vocals.exists() else None),
        "audio_url": f"/api/song-generation/{job_id}/audio/{source_key}" if source_key else job.get("audio_url"),
        "instrumental_url": f"/api/song-generation/{job_id}/audio/instrumental"
        if instrumental.exists()
        else None,
        "vocals_url": f"/api/song-generation/{job_id}/audio/vocals_rvc"
        if vocals_rvc.exists()
        else f"/api/song-generation/{job_id}/audio/vocals_raw"
        if vocals_raw.exists()
        else None,
    }


def resolve_cover_source(source_song_id: str):
    kind, ident = _parse_source_song_id(source_song_id)
    source = None
    if kind in {"upload", "file"}:
        source = _resolve_upload_source(ident)
    elif kind in {"run", "inference"}:
        source = _resolve_inference_source(ident)
    elif kind in {"songgen", "song", "song_generation"}:
        source = _resolve_song_generation_source(ident)
    else:
        source = _resolve_upload_source(ident) or _resolve_inference_source(ident) or _resolve_song_generation_source(ident)

    if not source:
        return None
    source["has_audio"] = bool(
        (source.get("audio_path") and source["audio_path"].exists())
        or (source.get("instrumental_path") and source["instrumental_path"].exists())
        or (source.get("vocals_path") and source["vocals_path"].exists())
        or source.get("audio_url")
        or source.get("instrumental_url")
        or source.get("vocals_url")
    )
    return source


def _public_source_payload(source: dict):
    return {
        "source_song_id": source.get("source_song_id"),
        "source_type": source.get("source_type"),
        "title": source.get("title"),
        "artist": source.get("artist"),
        "duration": source.get("duration"),
        "audioUrl": source.get("audio_url"),
        "instrumentalUrl": source.get("instrumental_url"),
        "vocalsUrl": source.get("vocals_url"),
        "hasAudio": bool(source.get("has_audio")),
    }


def get_cover_source_payload(source_song_id: str):
    source = resolve_cover_source(source_song_id)
    if not source:
        return None
    return _public_source_payload(source)


def _pitch_shift_audio(input_path: Path, output_path: Path, semitones: int, preserve_tempo: bool) -> bool:
    if not semitones:
        shutil.copy2(input_path, output_path)
        return True

    ratio = 2 ** (float(semitones) / 12.0)
    if preserve_tempo:
        filter_graph = f"asetrate=48000*{ratio},aresample=48000,atempo={1/ratio}"
    else:
        filter_graph = f"asetrate=48000*{ratio},aresample=48000"

    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        "-af",
        filter_graph,
        str(output_path),
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return result.returncode == 0 and output_path.exists()


def _list_available_models():
    root = Path(paths.APPLIO_MODELS_DIR)
    if not root.exists():
        return []
    out = []
    for model_dir in (d for d in root.iterdir() if d.is_dir()):
        checkpoints = []
        for checkpoint in sorted(model_dir.glob("*.pth"), key=lambda x: x.stat().st_mtime, reverse=True):
            epoch, rate = extract_epoch_rate_from_filename(checkpoint.name)
            checkpoints.append(
                {
                    "filename": checkpoint.name,
                    "epochs": epoch if epoch is not None else 0,
                    "rate": rate,
                    "isBest": "best" in checkpoint.name.lower(),
                    "path": str(checkpoint.relative_to(root)),
                }
            )
        if not checkpoints:
            continue
        index_path = next(model_dir.glob("*.index"), None)
        out.append(
            {
                "name": model_dir.name,
                "checkpoints": checkpoints,
                "indexPath": str(index_path.relative_to(root)) if index_path else None,
            }
        )
    return out


def _resolve_model_by_name(target_voice: str):
    wanted = str(target_voice or "").strip().lower()
    if not wanted:
        return None
    for model in _list_available_models():
        if str(model.get("name") or "").strip().lower() == wanted:
            return model
    return None


def _run_voice_conversion(file_id: str, model: dict, title: str, pitch_shift: int = 0):
    if not file_id or not model:
        return None

    inference_params = {
        "pitch": int(pitch_shift or 0),
        "indexRate": 0.88,
        "protectVoiced": 0.6,
        "f0Method": "rmvpe",
        "splitAudio": False,
        "autotune": False,
        "autotuneStrength": 1,
        "cleanAudio": False,
        "cleanStrength": 0.5,
        "exportFormat": "WAV",
        "sid": 0,
    }
    track_obj = {
        "name": title,
        "fileId": file_id,
        "vocalFileType": "raw_vocals",
        "processed": False,
    }
    inference_job_id = str(uuid.uuid4())
    inference_run_id = make_run_id()
    active_jobs[inference_job_id] = {
        "id": inference_job_id,
        "type": "inference",
        "model_name": model.get("name"),
        "track": track_obj,
        "params": inference_params,
        "run_id": inference_run_id,
        "status": "starting",
        "progress": 0,
        "logs": ["Starting inference..."],
        "started_at": datetime.now().isoformat(),
    }
    run_inference_job(inference_job_id, inference_run_id, model, track_obj, inference_params)
    inference_result = active_jobs.get(inference_job_id, {})
    if inference_result.get("status") != "completed":
        return None
    run_id = inference_result.get("runId") or inference_result.get("run_id") or inference_run_id
    inferred = paths.INFERENCE_RUNS_DIR / run_id / "inferred.wav"
    return inferred if inferred.exists() else None


def _path_for_log(path_value) -> str | None:
    if not path_value:
        return None
    try:
        return str(path_value)
    except Exception:
        return None


def run_cover_generation_thread(job_id: str, params: dict):
    job = song_generation_jobs[job_id]
    try:
        source_song_id = str(params.get("source_song_id") or "").strip()
        logger.info(
            "[cover:%s] start source_song_id=%s title=%s target_voice=%s pitch_shift=%s preserve_tempo=%s strong_audio=%s",
            job_id,
            source_song_id,
            str(params.get("title") or "").strip(),
            str(params.get("target_voice") or "").strip(),
            params.get("pitch_shift"),
            params.get("preserve_tempo"),
            _coerce_bool(params.get("strong_audio_conditioning"), False),
        )
        source = resolve_cover_source(source_song_id)
        if not source or not source.get("has_audio"):
            raise Exception("Source song is not available or has no audio")
        logger.info(
            "[cover:%s] resolved source type=%s source_id=%s has_audio=%s file_id=%s inst=%s vocal=%s audio=%s",
            job_id,
            source.get("source_type"),
            source.get("source_song_id"),
            bool(source.get("has_audio")),
            source.get("file_id"),
            _path_for_log(source.get("instrumental_path")),
            _path_for_log(source.get("vocals_path")),
            _path_for_log(source.get("audio_path")),
        )

        job.setdefault("id", job_id)
        job.setdefault("assets", _init_assets())
        job.setdefault("created_at", datetime.now().isoformat())
        job["params"] = dict(params or {})
        job["audio_url"] = f"/api/song-generation/audio/{job_id}"
        job["source_song_id"] = source.get("source_song_id")
        job["source_title"] = source.get("title")
        job["derivation_type"] = "cover"
        job["derivation_metadata"] = {
            "target_voice": params.get("target_voice"),
            "pitch_shift": params.get("pitch_shift"),
            "style_prompt": params.get("style_prompt"),
            "lyrics": params.get("lyrics"),
            "preserve_tempo": params.get("preserve_tempo"),
            "audio_cover_strength": params.get("audio_cover_strength"),
            "strong_audio_conditioning": params.get("strong_audio_conditioning"),
        }

        _set_status(job, "queued", "Cover job queued...")
        _set_progress(job, 0)

        pitch_shift = int(float(params.get("pitch_shift") or 0))
        preserve_tempo = _coerce_bool(params.get("preserve_tempo"), True)
        target_voice = str(params.get("target_voice") or "").strip()
        style_prompt = str(params.get("style_prompt") or "").strip()
        cover_lyrics = str(params.get("lyrics") or "").strip()
        audio_cover_strength = float(params.get("audio_cover_strength") or 1.0)
        strong_audio_conditioning = _coerce_bool(params.get("strong_audio_conditioning"), False)
        if strong_audio_conditioning:
            audio_cover_strength = 1.0

        source_inst = source.get("instrumental_path")
        source_vocal = source.get("vocals_path")
        source_audio = source.get("audio_path")

        # Preferred path: native ACE-Step cover generation (task_type=cover + src_audio).
        native_src_audio = None
        if source_inst and source_inst.exists() and source_vocal and source_vocal.exists():
            merged_source = _job_dir(job_id) / "native_cover_source_mix.wav"
            if _mix_audio(source_inst, source_vocal, merged_source):
                native_src_audio = merged_source
                logger.info(
                    "[cover:%s] native source prepared by stem merge instrumental=%s vocal=%s merged=%s",
                    job_id,
                    _path_for_log(source_inst),
                    _path_for_log(source_vocal),
                    _path_for_log(merged_source),
                )
            else:
                logger.warning("[cover:%s] failed to merge source stems for native cover input", job_id)
        if native_src_audio is None:
            native_src_audio = source_audio or source_vocal or source_inst
        native_cover_ok = False
        if native_src_audio and native_src_audio.exists():
            native_cover_output = _asset_path(job_id, "full_mix")
            _set_status(job, "full_generating", "Running ACE-Step native cover...")
            _set_progress(job, 25)
            cover_prompt = style_prompt or f"Cover arrangement inspired by {source.get('title') or 'the source song'}"
            instruction = None
            if strong_audio_conditioning:
                instruction = (
                    "Create a full song cover including instrumental and lyrical performance. "
                    "Preserve the source melody and match the provided lyrics."
                )

            base_params = {
                "title": job.get("title") or "cover",
                "task_type": "cover",
                "src_audio": str(native_src_audio),
                "audio_cover_strength": audio_cover_strength,
                "instruction": instruction,
                "prompt": cover_prompt,
                "lyrics": cover_lyrics,
                "audio_duration": None,
                "duration": None,
                "auto_duration": True,
                "prompt_engine": "fast",
                "thinking": False,
                "initialize_lm": False,
                "enhance_vocals": False,
                "force_subprocess": True,
            }
            if strong_audio_conditioning:
                # Prefer stability when forcing strong audio conditioning.
                base_params.update(
                    {
                        "use_flash_attention": False,
                        "compile_model": False,
                        "int8_quantization": False,
                        "offload_to_cpu": True,
                        "offload_dit_to_cpu": True,
                        "force_subprocess": True,
                    }
                )
            ace_cover_params = _normalize_acestep15_params(base_params)
            logger.info(
                "[cover:%s] native ACE-Step cover task_type=%s src_audio=%s audio_cover_strength=%s auto_duration=%s",
                job_id,
                ace_cover_params.get("task_type"),
                _path_for_log(native_src_audio),
                ace_cover_params.get("audio_cover_strength"),
                ace_cover_params.get("auto_duration"),
            )
            try:
                _run_acestep15_generation(job, job_id, ace_cover_params, native_cover_output)
                if native_cover_output.exists():
                    _set_asset_ready(job, job_id, "full_mix", native_cover_output)
                    job["audio_url"] = f"/api/song-generation/{job_id}/audio/full_mix"
                    native_cover_ok = True
                    logger.info("[cover:%s] native ACE-Step cover output=%s", job_id, _path_for_log(native_cover_output))
                else:
                    logger.warning("[cover:%s] native ACE-Step returned without output file", job_id)
            except Exception as native_cover_error:
                logger.exception("[cover:%s] native ACE-Step cover failed", job_id)
                # Retry once with conservative settings to avoid GPU/flash-attn/compile crashes.
                try:
                    safe_params = dict(ace_cover_params)
                    safe_params.update(
                        {
                            "use_flash_attention": False,
                            "compile_model": False,
                            "int8_quantization": False,
                            "offload_to_cpu": True,
                            "offload_dit_to_cpu": True,
                            "initialize_lm": False,
                            "force_subprocess": True,
                        }
                    )
                    job["status_message"] = "Native cover failed; retrying with safe settings..."
                    logger.info("[cover:%s] retrying native cover with safe settings", job_id)
                    _run_acestep15_generation(job, job_id, safe_params, native_cover_output)
                    if native_cover_output.exists():
                        _set_asset_ready(job, job_id, "full_mix", native_cover_output)
                        job["audio_url"] = f"/api/song-generation/{job_id}/audio/full_mix"
                        native_cover_ok = True
                        logger.info(
                            "[cover:%s] native ACE-Step cover output (safe mode)=%s",
                            job_id,
                            _path_for_log(native_cover_output),
                        )
                    else:
                        logger.warning("[cover:%s] native ACE-Step safe retry returned without output file", job_id)
                except Exception as safe_error:
                    job["status_message"] = (
                        "ACE-Step native cover failed, using fallback mix path: "
                        f"{native_cover_error} | safe retry failed: {safe_error}"
                    )
                    logger.exception("[cover:%s] native ACE-Step safe retry failed", job_id)
        else:
            logger.warning("[cover:%s] no local source audio path available for native cover; using fallback mix path", job_id)

        if native_cover_ok:
            if target_voice:
                logger.info("[cover:%s] target_voice=%s selected; running persona inference", job_id, target_voice)
                try:
                    vocals_file, instrumental_file, file_id = _run_separation(job, job_id, native_cover_output)
                    converted_vocal = None
                    model = _resolve_model_by_name(target_voice)
                    if model and file_id and vocals_file and vocals_file.exists():
                        _set_status(job, "rvc_running", f"Applying voice model: {target_voice}...")
                        _set_progress(job, 85)
                        inferred = _run_voice_conversion(file_id, model, job.get("title") or "cover", 0)
                        if inferred and inferred.exists():
                            converted_vocal = _asset_path(job_id, "vocals_rvc")
                            shutil.copy2(inferred, converted_vocal)
                            _set_asset_ready(job, job_id, "vocals_rvc", converted_vocal)
                            job["vocals_url"] = f"/api/song-generation/{job_id}/audio/vocals_rvc"
                            logger.info("[cover:%s] persona inference output=%s", job_id, _path_for_log(inferred))
                    if instrumental_file and converted_vocal and instrumental_file.exists() and converted_vocal.exists():
                        final_mix = _asset_path(job_id, "final_mix_rvc")
                        if _mix_audio(instrumental_file, converted_vocal, final_mix):
                            _set_asset_ready(job, job_id, "final_mix_rvc", final_mix)
                            job["audio_url"] = f"/api/song-generation/{job_id}/audio/final_mix_rvc"
                            logger.info("[cover:%s] persona mix complete=%s", job_id, _path_for_log(final_mix))
                except Exception as persona_err:
                    logger.exception("[cover:%s] persona inference failed", job_id)
                    job["status_message"] = f"Persona inference failed: {persona_err}"

            job["processed"] = bool(job.get("audio_url"))
            _set_status(job, "completed", "Cover generation complete")
            _set_progress(job, 100)
            job["completed_at"] = datetime.now().isoformat()
            logger.info("[cover:%s] completed strategy=native_cover audio_url=%s", job_id, job.get("audio_url"))
            return

        # Fallback path: legacy stem-based composition.
        _set_status(job, "full_generating", "Preparing source stems (fallback)...")
        _set_progress(job, 20)
        logger.info("[cover:%s] fallback preparing stems", job_id)

        inst_for_mix = None
        if source_inst and source_inst.exists():
            inst_for_mix = _asset_path(job_id, "instrumental")
            shutil.copy2(source_inst, inst_for_mix)
            _set_asset_ready(job, job_id, "instrumental", inst_for_mix)
            job["instrumental_url"] = f"/api/song-generation/{job_id}/audio/instrumental"
            logger.info("[cover:%s] fallback source instrumental=%s", job_id, _path_for_log(source_inst))
        else:
            logger.info("[cover:%s] fallback no source instrumental stem", job_id)

        _set_status(job, "full_generating", "Generating ACE-Step cover backing...")
        _set_progress(job, 35)
        acelab_path = _job_dir(job_id) / "acestep_cover_backing.wav"
        cover_prompt = style_prompt or f"Cover arrangement inspired by {source.get('title') or 'the source song'}"
        ace_params = _normalize_acestep15_params(
            {
                "title": f"{job.get('title') or 'cover'} backing",
                "prompt": f"{cover_prompt}\nReference: {source.get('title') or 'source song'}",
                "lyrics": "",
                "audio_duration": None,
                "duration": None,
                "auto_duration": True,
                "prompt_engine": "fast",
                "thinking": False,
                "initialize_lm": False,
                "enhance_vocals": False,
            }
        )
        logger.info(
            "[cover:%s] fallback backing auto_duration=%s audio_duration=%s",
            job_id,
            ace_params.get("auto_duration"),
            ace_params.get("audio_duration"),
        )
        logger.info("[cover:%s] fallback attempting ACE-Step backing generation", job_id)
        try:
            _run_acestep15_generation(job, job_id, ace_params, acelab_path)
            if acelab_path.exists():
                inst_for_mix = _asset_path(job_id, "instrumental")
                shutil.copy2(acelab_path, inst_for_mix)
                _set_asset_ready(job, job_id, "instrumental", inst_for_mix)
                job["instrumental_url"] = f"/api/song-generation/{job_id}/audio/instrumental"
                logger.info("[cover:%s] fallback ACE-Step backing=%s", job_id, _path_for_log(acelab_path))
            else:
                logger.warning("[cover:%s] fallback ACE-Step backing missing output file", job_id)
        except Exception as ace_error:
            # Fall back to source instrumental if ACE-Step backing fails.
            job["status_message"] = f"ACE-Step backing failed, using source stems: {ace_error}"
            logger.exception("[cover:%s] fallback ACE-Step backing failed", job_id)

        vocal_for_mix = None
        if source_vocal and source_vocal.exists():
            vocal_work = source_vocal
            if pitch_shift != 0:
                shifted = _job_dir(job_id) / "vocals_shifted.wav"
                if _pitch_shift_audio(source_vocal, shifted, pitch_shift, preserve_tempo):
                    vocal_work = shifted
                    logger.info(
                        "[cover:%s] fallback pitch_shift vocals semitones=%s preserve_tempo=%s",
                        job_id,
                        pitch_shift,
                        preserve_tempo,
                    )
                else:
                    logger.warning("[cover:%s] fallback pitch-shift on vocals failed", job_id)
            vocal_for_mix = _asset_path(job_id, "vocals_raw")
            shutil.copy2(vocal_work, vocal_for_mix)
            _set_asset_ready(job, job_id, "vocals_raw", vocal_for_mix)
            job["vocals_url"] = f"/api/song-generation/{job_id}/audio/vocals_raw"
            logger.info("[cover:%s] fallback vocal stem=%s", job_id, _path_for_log(vocal_work))
        else:
            logger.info("[cover:%s] fallback no vocal stem available", job_id)

        converted_vocal = None
        model = _resolve_model_by_name(target_voice)
        if model and source.get("file_id"):
            _set_status(job, "rvc_running", f"Applying voice model: {target_voice}...")
            _set_progress(job, 65)
            logger.info(
                "[cover:%s] fallback voice conversion model=%s file_id=%s",
                job_id,
                model.get("name"),
                source.get("file_id"),
            )
            inferred = _run_voice_conversion(source["file_id"], model, job.get("title") or "cover", 0)
            if inferred and inferred.exists():
                converted_vocal = _asset_path(job_id, "vocals_rvc")
                shutil.copy2(inferred, converted_vocal)
                _set_asset_ready(job, job_id, "vocals_rvc", converted_vocal)
                job["vocals_url"] = f"/api/song-generation/{job_id}/audio/vocals_rvc"
                _set_status(job, "rvc_ready", "Target voice applied")
                _set_progress(job, 80)
                logger.info("[cover:%s] fallback voice conversion output=%s", job_id, _path_for_log(inferred))
            else:
                logger.warning("[cover:%s] fallback voice conversion produced no output", job_id)
        elif target_voice and not model:
            logger.warning("[cover:%s] fallback target voice model not found: %s", job_id, target_voice)
        elif target_voice and not source.get("file_id"):
            logger.warning("[cover:%s] fallback skipping voice conversion: source has no file_id", job_id)
        else:
            logger.info("[cover:%s] fallback voice conversion skipped", job_id)

        vocal_for_mix = converted_vocal or vocal_for_mix

        _set_status(job, "full_generating", "Rendering cover mix...")
        _set_progress(job, 85)

        if inst_for_mix and vocal_for_mix and inst_for_mix.exists() and vocal_for_mix.exists():
            mix_key = "final_mix_rvc" if converted_vocal else "full_mix"
            mix_path = _asset_path(job_id, mix_key)
            if _mix_audio(inst_for_mix, vocal_for_mix, mix_path):
                _set_asset_ready(job, job_id, mix_key, mix_path)
                job["audio_url"] = f"/api/song-generation/{job_id}/audio/{mix_key}"
                logger.info(
                    "[cover:%s] fallback strategy=stems mix_key=%s instrumental=%s vocal=%s",
                    job_id,
                    mix_key,
                    _path_for_log(inst_for_mix),
                    _path_for_log(vocal_for_mix),
                )
            else:
                logger.warning("[cover:%s] fallback stem mix failed", job_id)
        elif source_audio and source_audio.exists():
            full_path = _asset_path(job_id, "full_mix")
            if pitch_shift != 0 and not vocal_for_mix:
                shifted_audio = _job_dir(job_id) / "source_shifted.wav"
                if _pitch_shift_audio(source_audio, shifted_audio, pitch_shift, preserve_tempo):
                    shutil.copy2(shifted_audio, full_path)
                    logger.info(
                        "[cover:%s] fallback strategy=full_source_audio_pitch_shifted source=%s",
                        job_id,
                        _path_for_log(source_audio),
                    )
                else:
                    shutil.copy2(source_audio, full_path)
                    logger.warning("[cover:%s] fallback source full-audio pitch shift failed", job_id)
            else:
                shutil.copy2(source_audio, full_path)
                logger.info("[cover:%s] fallback strategy=full_source_audio source=%s", job_id, _path_for_log(source_audio))
            _set_asset_ready(job, job_id, "full_mix", full_path)
            job["audio_url"] = f"/api/song-generation/{job_id}/audio/full_mix"
        elif vocal_for_mix and vocal_for_mix.exists():
            full_path = _asset_path(job_id, "full_mix")
            shutil.copy2(vocal_for_mix, full_path)
            _set_asset_ready(job, job_id, "full_mix", full_path)
            job["audio_url"] = f"/api/song-generation/{job_id}/audio/full_mix"
            logger.info("[cover:%s] fallback strategy=vocals_only vocal=%s", job_id, _path_for_log(vocal_for_mix))
        else:
            raise Exception("No usable source audio found for cover rendering")

        job["processed"] = bool(job.get("vocals_url") or job.get("instrumental_url"))
        _set_status(job, "completed", "Cover generation complete")
        _set_progress(job, 100)
        job["completed_at"] = datetime.now().isoformat()
        logger.info(
            "[cover:%s] completed strategy=fallback audio_url=%s instrumental_url=%s vocals_url=%s",
            job_id,
            job.get("audio_url"),
            job.get("instrumental_url"),
            job.get("vocals_url"),
        )

    except Exception as e:
        job["status"] = "failed"
        job["error"] = str(e)
        job["status_message"] = f"Cover generation failed: {str(e)}"
        logger.exception("[cover:%s] Cover generation failed", job_id)
