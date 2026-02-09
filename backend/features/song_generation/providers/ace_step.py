import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import textwrap
import uuid
from datetime import datetime
from pathlib import Path

from backend.features.inference.service import run_inference_job
from backend.features.processing.service import process_audio_files_thread
from backend.jobs.registry import active_jobs, song_generation_jobs
from backend.paths.manager import paths
from backend.storage.inference_runs import make_run_id
from backend.storage.metadata import (
    make_storage_name,
    register_upload_metadata,
    sanitize_filename_for_display,
)

# -----------------------------
# ACE-Step v1.5 (only) support
# -----------------------------

ACESTEP15_DIR = paths.BASE_DIR / "ACE-Step-1.5"
ACESTEP15_CHECKPOINTS_ROOT = ACESTEP15_DIR / "checkpoints"
ACESTEP15_VENV_PATH = ACESTEP15_DIR / "venv"  # ACE-Step 1.5 dedicated virtual environment
ACESTEP15_FALLBACK_VENV_PATH = ACESTEP15_DIR / ".venv"

# ACE-Step 1.5 default parameters (can be overridden)
ACESTEP15_DEFAULTS = {
    "checkpoints_root": str(ACESTEP15_CHECKPOINTS_ROOT),
    "main_model_path": "acestep-v15-turbo",
    "lm_model_path": "acestep-5Hz-lm-0.6B",
    "device": "auto",
    "lm_backend": "vllm",
    "initialize_lm": True,
    "use_flash_attention": True,
    "offload_to_cpu": True,
    "offload_dit_to_cpu": True,
    "compile_model": True,
    "int8_quantization": True,
}

# ACE-Step inference defaults (kept for compatibility with existing UI params)
ACESTEP_DEFAULTS = {
    "infer_step": 20,
    "guidance_scale": 15.0,
    "scheduler_type": "euler",
    "cfg_type": "apg",
    "omega_scale": 10.0,
    "actual_seeds": [-1],  # -1 = random
    "guidance_interval": 0.5,
    "guidance_interval_decay": 0.0,
    "min_guidance_scale": 3.0,
    "use_erg_tag": True,
    "use_erg_lyric": True,
    "use_erg_diffusion": True,
    "oss_steps": [],
    "guidance_scale_text": 0.0,
    "guidance_scale_lyric": 0.0,
}

USE_PERSISTENT_WORKER = str(os.environ.get("ACESTEP15_PERSISTENT", "1")).strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}

_PERSISTENT_WORKER = None
_PERSISTENT_WORKER_LOCK = threading.Lock()

# Song generation output directory
SONG_GENERATION_DIR = paths.BASE_DIR / "data" / "generated_songs"
SONG_GENERATION_DIR.mkdir(parents=True, exist_ok=True)

# Per-job asset directories
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


def _normalize_acestep15_params(params: dict) -> dict:
    """Return a shallow-copied params dict with ACE-Step 1.5 defaults applied."""
    p = dict(params or {})

    for key, value in ACESTEP15_DEFAULTS.items():
        if key not in p or p.get(key) in (None, ""):
            p[key] = value

    p["device"] = str(p.get("device") or ACESTEP15_DEFAULTS["device"]).strip().lower()
    p["lm_backend"] = str(p.get("lm_backend") or ACESTEP15_DEFAULTS["lm_backend"]).strip().lower()
    p["main_model_path"] = str(p.get("main_model_path") or ACESTEP15_DEFAULTS["main_model_path"]).strip()
    p["lm_model_path"] = str(p.get("lm_model_path") or ACESTEP15_DEFAULTS["lm_model_path"]).strip()
    p["checkpoints_root"] = str(p.get("checkpoints_root") or ACESTEP15_DEFAULTS["checkpoints_root"]).strip()

    p["initialize_lm"] = _coerce_bool(p.get("initialize_lm"), ACESTEP15_DEFAULTS["initialize_lm"])
    p["use_flash_attention"] = _coerce_bool(p.get("use_flash_attention"), ACESTEP15_DEFAULTS["use_flash_attention"])
    p["offload_to_cpu"] = _coerce_bool(p.get("offload_to_cpu"), ACESTEP15_DEFAULTS["offload_to_cpu"])
    p["offload_dit_to_cpu"] = _coerce_bool(p.get("offload_dit_to_cpu"), ACESTEP15_DEFAULTS["offload_dit_to_cpu"])
    p["compile_model"] = _coerce_bool(p.get("compile_model"), ACESTEP15_DEFAULTS["compile_model"])
    p["int8_quantization"] = _coerce_bool(p.get("int8_quantization"), ACESTEP15_DEFAULTS["int8_quantization"])

    return p


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


def _apply_progress_from_line(job: dict, line: str) -> bool:
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
        step_match = re.search(r"(\\d+)/(\\d+)", line)
        pct_match = re.search(r"(\\d+)%", line)
        if step_match:
            current = int(step_match.group(1))
            total = int(step_match.group(2))
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


def get_acestep_python():
    """Get the Python executable for ACE-Step 1.5 (from its venv if exists)"""
    if sys.platform == "win32":
        venv_python = ACESTEP15_VENV_PATH / "Scripts" / "python.exe"
        fallback_venv_python = ACESTEP15_FALLBACK_VENV_PATH / "Scripts" / "python.exe"
    else:
        venv_python = ACESTEP15_VENV_PATH / "bin" / "python"
        fallback_venv_python = ACESTEP15_FALLBACK_VENV_PATH / "bin" / "python"

    if venv_python.exists():
        return str(venv_python)

    if fallback_venv_python.exists():
        print("[ACE-Step] Warning: venv not found; using .venv for ACE-Step 1.5", flush=True)
        return str(fallback_venv_python)

    # Fallback to system python
    print("[ACE-Step] Warning: ACE-Step 1.5 venv not found; using system Python", flush=True)
    return sys.executable


class AceStepPersistentWorker:
    def __init__(self):
        self.process = None
        self.temp_dir = None
        self.script_path = None
        self.lock = threading.Lock()

    def _build_worker_script(self) -> str:
        worker_code = textwrap.dedent(
            """
            import json
            import os
            import sys
            import tempfile
            import time
            import traceback
            from pathlib import Path

            sys.stdout.reconfigure(line_buffering=True) if hasattr(sys.stdout, "reconfigure") else None
            sys.stderr.reconfigure(line_buffering=True) if hasattr(sys.stderr, "reconfigure") else None

            ACESTEP15_DIR = __ACESTEP15_DIR__
            ACESTEP15_CHECKPOINTS_ROOT = __ACESTEP15_CHECKPOINTS_ROOT__
            ACESTEP15_DEFAULTS = __ACESTEP15_DEFAULTS__

            sys.path.insert(0, ACESTEP15_DIR)

            os.environ.setdefault("VLLM_HOST_IP", "127.0.0.1")
            os.environ.setdefault("MASTER_ADDR", "127.0.0.1")
            os.environ.setdefault("MASTER_PORT", "2333")

            def _print(msg):
                print(msg)
                sys.stdout.flush()

            def _coerce_bool(value, default):
                if value is None:
                    return default
                if isinstance(value, bool):
                    return value
                if isinstance(value, str):
                    return value.strip().lower() in ("1", "true", "yes", "y", "on")
                return bool(value)

            def _require(module_name, pip_name=None):
                try:
                    __import__(module_name)
                    return None
                except Exception:
                    return pip_name or module_name

            try:
                import transformers

                def _patch_from_pretrained(cls):
                    original = cls.from_pretrained

                    def wrapped(*args, **kwargs):
                        kwargs.setdefault("low_cpu_mem_usage", False)
                        kwargs.setdefault("device_map", None)
                        return original(*args, **kwargs)

                    cls.from_pretrained = wrapped

                if hasattr(transformers, "AutoModel"):
                    _patch_from_pretrained(transformers.AutoModel)
                if hasattr(transformers, "AutoModelForCausalLM"):
                    _patch_from_pretrained(transformers.AutoModelForCausalLM)
            except Exception as e:
                _print("WARNING: Failed to patch transformers from_pretrained: " + str(e))

            _dit_handler = None
            _dit_key = None
            _lm_handler = None
            _lm_key = None
            _lm_ready = False

            def _ensure_deps(use_flash_attention):
                missing = []
                missing.append(_require("einops", "einops"))
                missing.append(_require("vector_quantize_pytorch", "vector-quantize-pytorch"))
                if use_flash_attention:
                    missing.append(_require("flash_attn", "flash-attn"))
                return [m for m in missing if m]

            def _init_dit(params):
                global _dit_handler, _dit_key
                from acestep.handler import AceStepHandler

                device = str(params.get("device") or "auto").strip().lower()
                main_model_path = str(params.get("main_model_path") or "acestep-v15-turbo").strip()
                checkpoints_root = str(params.get("checkpoints_root") or ACESTEP15_CHECKPOINTS_ROOT).strip()

                use_flash_attention = _coerce_bool(params.get("use_flash_attention"), True)
                offload_to_cpu = _coerce_bool(params.get("offload_to_cpu"), True)
                offload_dit_to_cpu = _coerce_bool(params.get("offload_dit_to_cpu"), True)
                compile_model = _coerce_bool(params.get("compile_model"), True)
                int8_quantization = _coerce_bool(params.get("int8_quantization"), True)

                quantization = None
                if int8_quantization:
                    if not compile_model:
                        _print("WARNING: int8_quantization requires compile_model; disabling quantization")
                    else:
                        try:
                            import torchao  # noqa: F401
                            quantization = "int8_weight_only"
                        except Exception:
                            _print("WARNING: torchao not installed; disabling int8_quantization")
                            quantization = None

                desired_key = (
                    main_model_path,
                    device,
                    use_flash_attention,
                    offload_to_cpu,
                    offload_dit_to_cpu,
                    compile_model,
                    quantization,
                )
                if _dit_handler is not None and _dit_key == desired_key:
                    return _dit_handler

                def _init(handler, do_compile, quant):
                    return handler.initialize_service(
                        project_root=ACESTEP15_DIR,
                        config_path=main_model_path,
                        device=device,
                        use_flash_attention=use_flash_attention,
                        compile_model=do_compile,
                        offload_to_cpu=offload_to_cpu,
                        offload_dit_to_cpu=offload_dit_to_cpu,
                        quantization=quant,
                    )

                handler = AceStepHandler()
                try:
                    init_status, enable_generate = _init(handler, compile_model, quantization)
                    if not enable_generate:
                        raise RuntimeError(init_status)
                except Exception as e:
                    if compile_model:
                        _print("WARNING: torch.compile failed; falling back to eager: " + str(e))
                        compile_model = False
                        quantization = None
                        handler = AceStepHandler()
                        init_status, enable_generate = _init(handler, False, None)
                        if not enable_generate:
                            raise RuntimeError(init_status)
                    else:
                        raise

                _dit_handler = handler
                _dit_key = (
                    main_model_path,
                    device,
                    use_flash_attention,
                    offload_to_cpu,
                    offload_dit_to_cpu,
                    compile_model,
                    quantization,
                )
                return handler

            def _init_lm(params, dit_handler):
                global _lm_handler, _lm_key, _lm_ready
                from acestep.llm_inference import LLMHandler

                initialize_lm = _coerce_bool(params.get("initialize_lm"), True)
                if not initialize_lm:
                    if _lm_handler is None:
                        _lm_handler = LLMHandler()
                    _lm_ready = False
                    return _lm_handler

                device = str(params.get("device") or "auto").strip().lower()
                lm_model_path = str(params.get("lm_model_path") or "acestep-5Hz-lm-0.6B").strip()
                lm_backend = str(params.get("lm_backend") or "vllm").strip().lower()
                checkpoints_root = str(params.get("checkpoints_root") or ACESTEP15_CHECKPOINTS_ROOT).strip()
                offload_to_cpu = _coerce_bool(params.get("offload_to_cpu"), True)

                desired_key = (lm_model_path, lm_backend, device, offload_to_cpu, str(getattr(dit_handler, "dtype", "")))
                if _lm_handler is not None and _lm_key == desired_key and _lm_ready:
                    return _lm_handler

                lm_handler = LLMHandler()
                lm_status, lm_success = lm_handler.initialize(
                    checkpoint_dir=checkpoints_root,
                    lm_model_path=lm_model_path,
                    backend=lm_backend,
                    device=device,
                    offload_to_cpu=offload_to_cpu,
                    dtype=getattr(dit_handler, "dtype", None),
                )
                if not lm_success:
                    raise RuntimeError(lm_status)

                _lm_handler = lm_handler
                _lm_key = desired_key
                _lm_ready = True
                return lm_handler

            def _run_job(job_id, params, output_path):
                p = dict(params or {})
                for key, value in ACESTEP15_DEFAULTS.items():
                    if p.get(key) in (None, ""):
                        p[key] = value

                use_flash_attention = _coerce_bool(p.get("use_flash_attention"), True)
                missing = _ensure_deps(use_flash_attention)
                if missing:
                    msg = "Missing packages: " + ", ".join(sorted(set(missing)))
                    _print("ERROR:" + msg + ". Install with: pip install " + " ".join(sorted(set(missing))))
                    raise RuntimeError(msg)

                from acestep.inference import GenerationParams, GenerationConfig, generate_music, format_sample

                dit_handler = _init_dit(p)

                prompt_engine = str(p.get("prompt_engine") or "").strip().lower()
                if prompt_engine not in ("llm", "fast", "caption", "assist", "expand"):
                    prompt_engine = "llm"

                base_prompt = str(p.get("prompt") or "")
                lyrics = str(p.get("lyrics") or "")
                caption_override = str(p.get("caption_override") or "").strip()
                lm_negative_prompt = str(p.get("lm_negative_prompt") or "NO USER INPUT")

                use_lm_codes = prompt_engine == "llm"
                thinking = _coerce_bool(p.get("thinking"), use_lm_codes)
                p["initialize_lm"] = thinking or prompt_engine in ("assist", "expand")

                llm_handler = _init_lm(p, dit_handler)

                audio_duration_raw = p.get("audio_duration") if p.get("audio_duration") not in (None, "") else p.get("duration")
                if audio_duration_raw in (None, "", 0):
                    audio_duration = -1.0
                else:
                    audio_duration = float(audio_duration_raw)
                infer_step = int(p.get("dit_inference_steps") or p.get("infer_step") or p.get("inference_steps") or 8)
                guidance_scale = float(p.get("guidance_scale") or 7.0)
                bpm_raw = p.get("bpm")
                bpm_value = None
                if bpm_raw not in (None, ""):
                    try:
                        bpm_value = int(float(bpm_raw))
                    except Exception:
                        bpm_value = None
                keyscale_value = str(p.get("keyscale") or "").strip()
                timesig_value = str(p.get("timesignature") or "").strip()
                shift_raw = p.get("shift")
                try:
                    shift_value = float(shift_raw) if shift_raw not in (None, "") else 1.0
                except Exception:
                    shift_value = 1.0

                seed_value = p.get("seed")
                if seed_value is None:
                    seed_list = p.get("actual_seeds") or [-1]
                    seed_value = seed_list[0] if isinstance(seed_list, list) and seed_list else seed_list
                try:
                    seed_value = int(seed_value)
                except Exception:
                    seed_value = -1

                use_random_seed = seed_value is None or seed_value < 0

                caption_input = caption_override if (caption_override and prompt_engine in ("caption", "assist", "expand")) else base_prompt
                caption = caption_input

                if prompt_engine in ("assist", "expand"):
                    user_metadata_for_format = {}
                    if bpm_value is not None:
                        user_metadata_for_format["bpm"] = bpm_value
                    if audio_duration is not None and float(audio_duration) > 0:
                        user_metadata_for_format["duration"] = float(audio_duration)
                    if keyscale_value:
                        user_metadata_for_format["keyscale"] = keyscale_value
                    if timesig_value:
                        user_metadata_for_format["timesignature"] = timesig_value

                    format_result = format_sample(
                        llm_handler=llm_handler,
                        caption=caption_input,
                        lyrics=lyrics,
                        user_metadata=user_metadata_for_format if user_metadata_for_format else None,
                        use_constrained_decoding=True,
                    )
                    if not format_result.success:
                        raise RuntimeError(format_result.error or format_result.status_message or "format_sample failed")

                    formatted_caption = (format_result.caption or "").strip()
                    if prompt_engine == "assist":
                        caption = formatted_caption or caption_input
                    else:
                        if not formatted_caption:
                            caption = caption_input
                        elif caption_input and caption_input.lower() in formatted_caption.lower():
                            caption = formatted_caption
                        else:
                            caption = f"{caption_input} {formatted_caption}".strip()

                    if not lyrics.strip() and getattr(format_result, "lyrics", None):
                        lyrics = format_result.lyrics or lyrics

                gen_params = GenerationParams(
                    caption=caption,
                    lyrics=lyrics,
                    instrumental=(not lyrics.strip()),
                    duration=audio_duration,
                    inference_steps=infer_step,
                    guidance_scale=guidance_scale,
                    bpm=bpm_value,
                    keyscale=keyscale_value,
                    timesignature=timesig_value,
                    shift=shift_value,
                    seed=seed_value if seed_value is not None else -1,
                    thinking=thinking,
                    lm_negative_prompt=lm_negative_prompt,
                )
                gen_config = GenerationConfig(
                    batch_size=1,
                    use_random_seed=use_random_seed,
                    seeds=[seed_value] if seed_value is not None and seed_value >= 0 else None,
                    audio_format="wav",
                )

                def _progress(pct, desc=None):
                    try:
                        pct = float(pct)
                    except Exception:
                        return
                    pct = max(0.0, min(1.0, pct))
                    pct_int = 25 + int(pct * 65)
                    msg = desc or "Generating audio..."
                    _print("PROGRESS:{}:{}".format(pct_int, msg))

                _print("PROGRESS:25:Generating audio...")

                out_dir = Path(tempfile.mkdtemp(prefix="acestep15_job_")) / "out"
                out_dir.mkdir(parents=True, exist_ok=True)
                result = generate_music(dit_handler, llm_handler, gen_params, gen_config, save_dir=str(out_dir), progress=_progress)

                if not result.success:
                    raise RuntimeError(result.error or result.status_message or "Generation failed")

                audio_path = None
                if result.audios:
                    audio_path = result.audios[0].get("path")

                target_path = Path(output_path)
                target_path.parent.mkdir(parents=True, exist_ok=True)

                if audio_path and os.path.exists(audio_path):
                    import shutil
                    shutil.copyfile(audio_path, str(target_path))
                else:
                    audio_tensor = result.audios[0].get("tensor") if result.audios else None
                    if audio_tensor is None:
                        raise RuntimeError("No audio file produced")
                    try:
                        import numpy as np
                        import soundfile as sf
                        if hasattr(audio_tensor, "detach"):
                            audio_tensor = audio_tensor.detach().cpu().numpy()
                        audio_np = audio_tensor
                        if audio_np.ndim == 2 and audio_np.shape[0] in (1, 2):
                            audio_np = audio_np.T
                        elif audio_np.ndim == 1:
                            audio_np = audio_np.reshape(-1, 1)
                        sample_rate = int(result.audios[0].get("sample_rate") or 48000)
                        sf.write(str(target_path), audio_np, sample_rate)
                    except Exception as e:
                        raise RuntimeError("Failed to save audio tensor: " + str(e))

                _print("PROGRESS:95:Finalizing...")
                if not target_path.exists():
                    raise RuntimeError("Output file not created")

            _print("WORKER_READY")

            while True:
                line = sys.stdin.readline()
                if not line:
                    time.sleep(0.05)
                    continue
                line = line.strip()
                if not line:
                    continue
                if line == "SHUTDOWN":
                    break
                try:
                    payload = json.loads(line)
                except Exception as e:
                    _print("WORKER_ERROR:bad_request:" + str(e))
                    continue

                job_id = payload.get("job_id") or "unknown"
                params = payload.get("params") or {}
                output_path = payload.get("output_path")
                if not output_path:
                    _print("JOB_END:{}:ERROR:Missing output_path".format(job_id))
                    continue

                try:
                    _run_job(job_id, params, output_path)
                    _print("JOB_END:{}:SUCCESS".format(job_id))
                except Exception as e:
                    _print("JOB_END:{}:ERROR:{}".format(job_id, e))
                    traceback.print_exc()
            """
        )

        worker_code = worker_code.replace("__ACESTEP15_DIR__", json.dumps(str(ACESTEP15_DIR)))
        worker_code = worker_code.replace("__ACESTEP15_CHECKPOINTS_ROOT__", json.dumps(str(ACESTEP15_CHECKPOINTS_ROOT)))
        worker_code = worker_code.replace("__ACESTEP15_DEFAULTS__", repr(ACESTEP15_DEFAULTS))
        return worker_code

    def _build_env(self) -> dict:
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env["VLLM_HOST_IP"] = "127.0.0.1"
        env["MASTER_ADDR"] = "127.0.0.1"
        env["MASTER_PORT"] = "2333"
        if sys.platform == "win32":
            venv_torch_lib = ACESTEP15_VENV_PATH / "Lib" / "site-packages" / "torch" / "lib"
            fallback_torch_lib = ACESTEP15_FALLBACK_VENV_PATH / "Lib" / "site-packages" / "torch" / "lib"
            if venv_torch_lib.exists():
                env["PATH"] = str(venv_torch_lib) + os.pathsep + env.get("PATH", "")
            elif fallback_torch_lib.exists():
                env["PATH"] = str(fallback_torch_lib) + os.pathsep + env.get("PATH", "")
        return env

    def _start_process(self):
        if self.process and self.process.poll() is None:
            return

        if self.temp_dir and Path(self.temp_dir).exists():
            try:
                shutil.rmtree(self.temp_dir, ignore_errors=True)
            except Exception:
                pass

        self.temp_dir = tempfile.mkdtemp(prefix="acestep15_worker_")
        self.script_path = Path(self.temp_dir) / "worker.py"
        self.script_path.write_text(self._build_worker_script(), encoding="utf-8")

        python_exe = get_acestep_python()
        self.process = subprocess.Popen(
            [python_exe, "-u", str(self.script_path)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            cwd=str(ACESTEP15_DIR),
            env=self._build_env(),
        )

        start = time.time()
        while True:
            if self.process.poll() is not None:
                raise RuntimeError("ACE-Step worker exited during startup")
            line = self.process.stdout.readline()
            if not line:
                if time.time() - start > 60:
                    raise RuntimeError("ACE-Step worker startup timeout")
                continue
            line = line.rstrip("\n\r")
            print(f"[ACE-Step] {line}", flush=True)
            if line.startswith("WORKER_READY"):
                break
            if line.startswith("WORKER_ERROR"):
                raise RuntimeError(line)

    def _ensure_process(self):
        if self.process and self.process.poll() is None:
            return
        self._start_process()

    def run_job(self, job: dict, job_id: str, params: dict, output_path: Path) -> None:
        with self.lock:
            self._ensure_process()
            if not self.process or self.process.poll() is not None:
                raise RuntimeError("ACE-Step worker not available")

            payload = {"job_id": job_id, "params": params, "output_path": str(output_path)}
            self.process.stdin.write(json.dumps(payload) + "\n")
            self.process.stdin.flush()

            job["subprocess_pid"] = self.process.pid
            success = False
            error_output = []

            while True:
                line = self.process.stdout.readline()
                if not line:
                    if self.process.poll() is not None:
                        break
                    continue
                line = line.rstrip("\n\r")
                print(f"[ACE-Step] {line}", flush=True)

                if line.startswith("JOB_END:"):
                    parts = line.split(":", 3)
                    if len(parts) >= 3 and parts[1] == job_id:
                        if parts[2] == "SUCCESS":
                            success = True
                        elif parts[2] == "ERROR":
                            if len(parts) >= 4 and parts[3]:
                                error_output.append(parts[3])
                        break
                    continue

                if _apply_progress_from_line(job, line):
                    continue

                if line.startswith("ERROR:"):
                    error_output.append(line[6:])

            if not success:
                if self.process and self.process.poll() is not None:
                    raise RuntimeError("ACE-Step worker exited unexpectedly")
                error_msg = "\n".join(error_output) if error_output else "Persistent worker failed"
                raise RuntimeError(error_msg)


def _get_persistent_worker() -> AceStepPersistentWorker:
    global _PERSISTENT_WORKER
    with _PERSISTENT_WORKER_LOCK:
        if _PERSISTENT_WORKER is None:
            _PERSISTENT_WORKER = AceStepPersistentWorker()
        return _PERSISTENT_WORKER


def _run_acestep15_generation(job: dict, job_id: str, infer_params: dict, output_path: Path) -> None:
    params = _normalize_acestep15_params(infer_params or {})

    if USE_PERSISTENT_WORKER:
        try:
            worker = _get_persistent_worker()
            worker.run_job(job, job_id, params, output_path)
            return
        except Exception as e:
            print(f"[ACE-Step] Persistent worker failed, falling back to subprocess: {e}", flush=True)

    python_exe = get_acestep_python()
    temp_dir = Path(tempfile.mkdtemp(prefix=f"acestep15_{job_id}_"))

    params_file = temp_dir / f"{job_id}_params.json"
    with open(params_file, "w") as f:
        json.dump(
            {
                "audio_duration": infer_params.get("audio_duration"),
                "auto_duration": infer_params.get("auto_duration"),
                "prompt": infer_params.get("prompt", ""),
                "lyrics": infer_params.get("lyrics", ""),
                "caption_override": infer_params.get("caption_override"),
                "prompt_engine": infer_params.get("prompt_engine"),
                "thinking": infer_params.get("thinking"),
                "lm_negative_prompt": infer_params.get("lm_negative_prompt"),
                "infer_step": infer_params.get("infer_step", infer_params.get("inference_steps", 20)),
                "dit_inference_steps": infer_params.get("dit_inference_steps"),
                "guidance_scale": infer_params.get("guidance_scale", 15.0),
                "actual_seeds": infer_params.get("actual_seeds", [-1]),
                "seed": infer_params.get("seed"),
                "bpm": infer_params.get("bpm"),
                "keyscale": infer_params.get("keyscale"),
                "timesignature": infer_params.get("timesignature"),
                "shift": infer_params.get("shift"),
                "checkpoints_root": params.get("checkpoints_root"),
                "main_model_path": params.get("main_model_path"),
                "lm_model_path": params.get("lm_model_path"),
                "device": params.get("device"),
                "lm_backend": params.get("lm_backend"),
                "initialize_lm": params.get("initialize_lm"),
                "use_flash_attention": params.get("use_flash_attention"),
                "offload_to_cpu": params.get("offload_to_cpu"),
                "offload_dit_to_cpu": params.get("offload_dit_to_cpu"),
                "compile_model": params.get("compile_model"),
                "int8_quantization": params.get("int8_quantization"),
            },
            f,
        )

    wrapper_script = temp_dir / f"{job_id}_runner.py"
    with open(wrapper_script, "w") as f:
        f.write(
            f"""
import importlib
import json
import os
import shutil
import sys
import traceback
from pathlib import Path

sys.stdout.reconfigure(line_buffering=True) if hasattr(sys.stdout, "reconfigure") else None
sys.stderr.reconfigure(line_buffering=True) if hasattr(sys.stderr, "reconfigure") else None

sys.path.insert(0, r"{ACESTEP15_DIR}")

os.environ.setdefault("VLLM_HOST_IP", "127.0.0.1")
os.environ.setdefault("MASTER_ADDR", "127.0.0.1")
os.environ.setdefault("MASTER_PORT", "2333")

def _coerce_bool(value, default):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "y", "on")
    return bool(value)

with open(r"{params_file}", "r") as pf:
    params = json.load(pf)

defaults = {ACESTEP15_DEFAULTS!r}
for key, value in defaults.items():
    if params.get(key) in (None, ""):
        params[key] = value

def _require(module_name, pip_name=None):
    try:
        importlib.import_module(module_name)
        return None
    except Exception:
        return pip_name or module_name

missing = []
missing.append(_require("einops", "einops"))
missing.append(_require("vector_quantize_pytorch", "vector-quantize-pytorch"))
if _coerce_bool(params.get("use_flash_attention"), True):
    missing.append(_require("flash_attn", "flash-attn"))
missing = [m for m in missing if m]

if missing:
    pip_cmd = "pip install " + " ".join(sorted(set(missing)))
    print("ERROR:Missing packages: " + ", ".join(sorted(set(missing))) + ". Install with: " + pip_cmd)
    sys.exit(1)

try:
    import transformers
    def _patch_from_pretrained(cls):
        original = cls.from_pretrained
        def wrapped(*args, **kwargs):
            kwargs.setdefault("low_cpu_mem_usage", False)
            kwargs.setdefault("device_map", None)
            return original(*args, **kwargs)
        cls.from_pretrained = wrapped
    if hasattr(transformers, "AutoModel"):
        _patch_from_pretrained(transformers.AutoModel)
    if hasattr(transformers, "AutoModelForCausalLM"):
        _patch_from_pretrained(transformers.AutoModelForCausalLM)
except Exception as e:
    print("WARNING: Failed to patch transformers from_pretrained:", e)

print("PROGRESS:15:Initializing ACE-Step 1.5...")
sys.stdout.flush()

try:
    from acestep.handler import AceStepHandler
    from acestep.llm_inference import LLMHandler
    from acestep.inference import GenerationParams, GenerationConfig, generate_music, format_sample

    device = str(params.get("device") or "auto").strip().lower()
    main_model_path = str(params.get("main_model_path") or "acestep-v15-turbo").strip()
    lm_model_path = str(params.get("lm_model_path") or "acestep-5Hz-lm-0.6B").strip()
    lm_backend = str(params.get("lm_backend") or "vllm").strip().lower()
    checkpoints_root = str(params.get("checkpoints_root") or r"{ACESTEP15_CHECKPOINTS_ROOT}").strip()

    use_flash_attention = _coerce_bool(params.get("use_flash_attention"), True)
    offload_to_cpu = _coerce_bool(params.get("offload_to_cpu"), True)
    offload_dit_to_cpu = _coerce_bool(params.get("offload_dit_to_cpu"), True)
    compile_model = _coerce_bool(params.get("compile_model"), True)
    int8_quantization = _coerce_bool(params.get("int8_quantization"), True)

    prompt_engine = str(params.get("prompt_engine") or "").strip().lower()
    if prompt_engine not in ("llm", "fast", "caption", "assist", "expand"):
        prompt_engine = "llm"

    caption_override = str(params.get("caption_override") or "").strip()

    use_lm_codes = prompt_engine == "llm"
    thinking = _coerce_bool(params.get("thinking"), use_lm_codes)
    initialize_lm = thinking or prompt_engine in ("assist", "expand")

    quantization = None
    if int8_quantization:
        if not compile_model:
            print("WARNING: int8_quantization requires compile_model; disabling quantization")
        else:
            try:
                import torchao  # noqa: F401
                quantization = "int8_weight_only"
            except Exception:
                print("WARNING: torchao not installed; disabling int8_quantization")
                quantization = None

    def _init_dit(handler, do_compile, quant):
        return handler.initialize_service(
            project_root=r"{ACESTEP15_DIR}",
            config_path=main_model_path,
            device=device,
            use_flash_attention=use_flash_attention,
            compile_model=do_compile,
            offload_to_cpu=offload_to_cpu,
            offload_dit_to_cpu=offload_dit_to_cpu,
            quantization=quant,
        )

    dit_handler = AceStepHandler()
    try:
        init_status, enable_generate = _init_dit(dit_handler, compile_model, quantization)
        if not enable_generate:
            raise RuntimeError(init_status)
    except Exception as e:
        if compile_model:
            print("WARNING: torch.compile failed; falling back to eager:", e)
            compile_model = False
            quantization = None
            dit_handler = AceStepHandler()
            init_status, enable_generate = _init_dit(dit_handler, False, None)
            if not enable_generate:
                raise RuntimeError(init_status)
        else:
            raise

    llm_handler = LLMHandler()
    if initialize_lm:
        lm_status, lm_success = llm_handler.initialize(
            checkpoint_dir=checkpoints_root,
            lm_model_path=lm_model_path,
            backend=lm_backend,
            device=device,
            offload_to_cpu=offload_to_cpu,
            dtype=dit_handler.dtype,
        )
        if not lm_success:
            raise RuntimeError(lm_status)

    prompt = str(params.get("prompt") or "")
    lyrics = str(params.get("lyrics") or "")
    lm_negative_prompt = str(params.get("lm_negative_prompt") or "NO USER INPUT")
    audio_duration_raw = params.get("audio_duration") if params.get("audio_duration") not in (None, "") else params.get("duration")
    if audio_duration_raw in (None, "", 0):
        audio_duration = -1.0
    else:
        audio_duration = float(audio_duration_raw)
    infer_step = int(params.get("dit_inference_steps") or params.get("infer_step") or params.get("inference_steps") or 8)
    guidance_scale = float(params.get("guidance_scale") or 7.0)
    bpm_raw = params.get("bpm")
    bpm_value = None
    if bpm_raw not in (None, ""):
        try:
            bpm_value = int(float(bpm_raw))
        except Exception:
            bpm_value = None
    keyscale_value = str(params.get("keyscale") or "").strip()
    timesig_value = str(params.get("timesignature") or "").strip()
    shift_raw = params.get("shift")
    try:
        shift_value = float(shift_raw) if shift_raw not in (None, "") else 1.0
    except Exception:
        shift_value = 1.0

    seed_value = params.get("seed")
    if seed_value is None:
        seed_list = params.get("actual_seeds") or [-1]
        seed_value = seed_list[0] if isinstance(seed_list, list) and seed_list else seed_list
    try:
        seed_value = int(seed_value)
    except Exception:
        seed_value = -1

    use_random_seed = seed_value is None or seed_value < 0

    caption_input = caption_override if (caption_override and prompt_engine in ("caption", "assist", "expand")) else prompt
    caption = caption_input

    if prompt_engine in ("assist", "expand"):
        user_metadata_for_format = dict()
        if bpm_value is not None:
            user_metadata_for_format["bpm"] = bpm_value
        if audio_duration is not None and float(audio_duration) > 0:
            user_metadata_for_format["duration"] = float(audio_duration)
        if keyscale_value:
            user_metadata_for_format["keyscale"] = keyscale_value
        if timesig_value:
            user_metadata_for_format["timesignature"] = timesig_value

        format_result = format_sample(
            llm_handler=llm_handler,
            caption=caption_input,
            lyrics=lyrics,
            user_metadata=user_metadata_for_format if user_metadata_for_format else None,
            use_constrained_decoding=True,
        )
        if not format_result.success:
            raise RuntimeError(format_result.error or format_result.status_message or "format_sample failed")

        formatted_caption = (format_result.caption or "").strip()
        if prompt_engine == "assist":
            caption = formatted_caption or caption_input
        else:
            if not formatted_caption:
                caption = caption_input
            elif caption_input and caption_input.lower() in formatted_caption.lower():
                caption = formatted_caption
            else:
                caption = (caption_input + " " + formatted_caption).strip()

        if not lyrics.strip() and getattr(format_result, "lyrics", None):
            lyrics = format_result.lyrics or lyrics

    gen_params = GenerationParams(
        caption=caption,
        lyrics=lyrics,
        instrumental=(not lyrics.strip()),
        duration=audio_duration,
        inference_steps=infer_step,
        guidance_scale=guidance_scale,
        bpm=bpm_value,
        keyscale=keyscale_value,
        timesignature=timesig_value,
        shift=shift_value,
        seed=seed_value if seed_value is not None else -1,
        thinking=thinking,
        lm_negative_prompt=lm_negative_prompt,
    )
    gen_config = GenerationConfig(
        batch_size=1,
        use_random_seed=use_random_seed,
        seeds=[seed_value] if seed_value is not None and seed_value >= 0 else None,
        audio_format="wav",
    )

    def _progress(p, desc=None):
        try:
            p = float(p)
        except Exception:
            return
        p = max(0.0, min(1.0, p))
        pct = 25 + int(p * 65)
        msg = desc or "Generating audio..."
        print(f"PROGRESS:{{pct}}:{{msg}}")
        sys.stdout.flush()

    print("PROGRESS:25:Generating audio...")
    sys.stdout.flush()

    out_dir = Path(r"{temp_dir}") / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    result = generate_music(dit_handler, llm_handler, gen_params, gen_config, save_dir=str(out_dir), progress=_progress)

    if not result.success:
        raise RuntimeError(result.error or result.status_message or "Generation failed")

    audio_path = None
    if result.audios:
        audio_path = result.audios[0].get("path")

    target_path = Path(r"{output_path}")
    target_path.parent.mkdir(parents=True, exist_ok=True)

    if audio_path and os.path.exists(audio_path):
        shutil.copyfile(audio_path, str(target_path))
    else:
        audio_tensor = result.audios[0].get("tensor") if result.audios else None
        if audio_tensor is None:
            raise RuntimeError("No audio file produced")
        try:
            import numpy as np
            import soundfile as sf
            if hasattr(audio_tensor, "detach"):
                audio_tensor = audio_tensor.detach().cpu().numpy()
            audio_np = audio_tensor
            if audio_np.ndim == 2 and audio_np.shape[0] in (1, 2):
                audio_np = audio_np.T
            elif audio_np.ndim == 1:
                audio_np = audio_np.reshape(-1, 1)
            sample_rate = int(result.audios[0].get("sample_rate") or 48000)
            sf.write(str(target_path), audio_np, sample_rate)
        except Exception as e:
            raise RuntimeError(f"Failed to save audio tensor: {{e}}")

    print("PROGRESS:95:Finalizing...")
    sys.stdout.flush()
    if target_path.exists():
        print("SUCCESS")
    else:
        print("ERROR:Output file not created")
        sys.exit(1)
except SystemExit:
    raise
except Exception as e:
    print(f"ERROR:{{e}}")
    traceback.print_exc()
    sys.exit(1)
"""
        )

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    env["VLLM_HOST_IP"] = "127.0.0.1"
    env["MASTER_ADDR"] = "127.0.0.1"
    env["MASTER_PORT"] = "2333"

    if sys.platform == "win32":
        venv_torch_lib = ACESTEP15_VENV_PATH / "Lib" / "site-packages" / "torch" / "lib"
        fallback_torch_lib = ACESTEP15_FALLBACK_VENV_PATH / "Lib" / "site-packages" / "torch" / "lib"
        if venv_torch_lib.exists():
            env["PATH"] = str(venv_torch_lib) + os.pathsep + env.get("PATH", "")
        elif fallback_torch_lib.exists():
            env["PATH"] = str(fallback_torch_lib) + os.pathsep + env.get("PATH", "")

    process = subprocess.Popen(
        [python_exe, "-u", str(wrapper_script)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        cwd=str(ACESTEP15_DIR),
        bufsize=1,
        env=env,
    )

    job["subprocess_pid"] = process.pid
    success = False
    error_output = []

    for line in iter(process.stdout.readline, ""):
        if process.poll() is not None and not line:
            break

        line = line.rstrip("\n\r")
        print(f"[ACE-Step] {line}", flush=True)

        if _apply_progress_from_line(job, line):
            continue
        if line == "SUCCESS":
            success = True
        elif line.startswith("ERROR:"):
            error_output.append(line[6:])

    process.wait()

    remaining = process.stdout.read()
    if remaining:
        for line in remaining.split("\n"):
            line = line.strip()
            if line:
                print(f"[ACE-Step] {line}", flush=True)
                if line == "SUCCESS":
                    success = True
                elif line.startswith("ERROR:"):
                    error_output.append(line[6:])

    try:
        shutil.rmtree(temp_dir, ignore_errors=True)
    except Exception:
        pass

    if process.returncode != 0 or not success:
        error_msg = "\n".join(error_output) if error_output else f"Process exited with code {process.returncode}"
        raise Exception(error_msg)

    if not output_path.exists():
        raise Exception("Generated audio file not found")


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


def _run_separation(job: dict, job_id: str, source_path: Path) -> tuple[Path | None, Path | None, str | None]:
    _set_status(job, "separating", "Separating stems...")
    _set_progress(job, 60)

    title_safe = sanitize_filename_for_display(job.get("params", {}).get("title", "untitled"))
    original_name = f"{title_safe}.wav"
    stored_name, file_id = make_storage_name(original_name)
    input_path = paths.INPUT_DIR / stored_name

    print(f"[ACE-Step] Copying generated song to input: {input_path}", flush=True)
    shutil.copy(str(source_path), str(input_path))
    register_upload_metadata(title_safe, stored_name, file_id)

    process_job_id = str(uuid.uuid4())
    active_jobs[process_job_id] = {
        "id": process_job_id,
        "status": "starting",
        "progress": 0,
        "config": {"segment": False, "process": True, "export": False, "clean": False},
        "started_at": time.time(),
        "fileIds": [file_id],
    }

    print(f"[ACE-Step] Starting vocal separation job: {process_job_id}", flush=True)
    process_audio_files_thread(process_job_id, segment=False, process=True, export=False, clean=False)

    process_result = active_jobs.get(process_job_id, {})
    if process_result.get("status") == "failed":
        print(f"[ACE-Step] Vocal separation failed: {process_result.get('error')}", flush=True)
        return None, None, file_id

    base_name = Path(stored_name).stem
    vocals_file = paths.UVR_RAW_DIR / f"{base_name}_vocals.wav"
    instrumental_file = paths.INSTRUMENTAL_DIR / f"{base_name}_instrumental.wav"

    try:
        if input_path.exists():
            input_path.unlink()
            print(f"[ACE-Step] Deleted input copy: {input_path}", flush=True)
    except Exception as del_err:
        print(f"[ACE-Step] Warning: Could not delete input copy: {del_err}", flush=True)

    if vocals_file.exists():
        shutil.copy2(vocals_file, _asset_path(job_id, "vocals_raw"))
        _set_asset_ready(job, job_id, "vocals_raw", _asset_path(job_id, "vocals_raw"))
        job["vocals_url"] = f"/api/song-generation/{job_id}/audio/vocals_raw"
    if instrumental_file.exists():
        shutil.copy2(instrumental_file, _asset_path(job_id, "instrumental"))
        _set_asset_ready(job, job_id, "instrumental", _asset_path(job_id, "instrumental"))
        job["instrumental_url"] = f"/api/song-generation/{job_id}/audio/instrumental"

    job["processed"] = bool(vocals_file.exists() or instrumental_file.exists())

    _set_status(job, "separated", "Stems ready")
    _set_progress(job, 75)
    return vocals_file if vocals_file.exists() else None, instrumental_file if instrumental_file.exists() else None, file_id


def _run_rvc(job: dict, job_id: str, file_id: str, vocals_file: Path, instrumental_file: Path | None) -> None:
    model_name = job.get("params", {}).get("model_name")
    model_obj = job.get("params", {}).get("model")
    if not (model_name and model_obj and vocals_file and vocals_file.exists()):
        return

    _set_status(job, "rvc_running", f"Applying voice model: {model_name}...")
    _set_progress(job, 80)

    inference_params = {
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

    track_obj = {
        "name": sanitize_filename_for_display(job.get("params", {}).get("title", "untitled")),
        "fileId": file_id,
        "vocalFileType": "raw_vocals",
        "processed": False,
    }

    inference_job_id = str(uuid.uuid4())
    inference_run_id = make_run_id()
    active_jobs[inference_job_id] = {
        "id": inference_job_id,
        "type": "inference",
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
        return

    run_id = inference_result.get("runId") or inference_result.get("run_id") or inference_run_id
    inferred = paths.INFERENCE_RUNS_DIR / run_id / "inferred.wav"
    if inferred.exists():
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


def continue_song_generation_full(job_id: str) -> None:
    job = song_generation_jobs[job_id]
    params = _normalize_acestep15_params(job.get("params") or {})
    job["params"] = params
    infer_params = {**ACESTEP_DEFAULTS, **params}

    duration_raw = params.get("duration") if params.get("duration") not in (None, "") else params.get("audio_duration")
    auto_duration = _coerce_bool(params.get("auto_duration"), False)
    if auto_duration or duration_raw in (None, "", 0):
        duration = None
    else:
        duration = int(duration_raw)
    enhance_vocals = params.get("enhance_vocals", True)

    full_path = _asset_path(job_id, "full_mix")
    if not full_path.exists():
        _set_status(job, "full_generating", "Generating full song...")
        _set_progress(job, 15)
        full_params = dict(infer_params)
        if duration is not None:
            full_params["audio_duration"] = duration
        full_params["auto_duration"] = auto_duration
        _run_acestep15_generation(job, job_id, full_params, full_path)
        _set_asset_ready(job, job_id, "full_mix", full_path)
        _set_status(job, "full_ready", "Full song ready")
        _set_progress(job, 45)

    source_path = full_path if full_path.exists() else _asset_path(job_id, "preview_mix")
    vocals_file, inst_file, file_id = _run_separation(job, job_id, source_path)

    if enhance_vocals and file_id and vocals_file:
        _run_rvc(job, job_id, file_id, vocals_file, inst_file)

    _set_status(job, "completed", "Song generation complete")
    _set_progress(job, 100)
    job["completed_at"] = datetime.now().isoformat()


def run_song_generation_thread(job_id, params):
    """Run ACE-Step song generation as subprocess in background thread"""
    job = song_generation_jobs[job_id]

    try:
        params = _normalize_acestep15_params(params or {})
        job.setdefault("id", job_id)
        job["params"] = params
        job.setdefault("assets", _init_assets())
        job.setdefault("timings", {})
        job.setdefault("created_at", datetime.now().isoformat())
        job["audio_url"] = f"/api/song-generation/audio/{job_id}"
        _set_status(job, "queued", "Job queued...")
        _set_progress(job, 0)

        infer_params = {**ACESTEP_DEFAULTS, **params}

        _set_status(job, "full_generating", "Generating full song...")
        _set_progress(job, 10)
        full_path = _asset_path(job_id, "full_mix")
        full_params = dict(infer_params)
        duration_raw = params.get("duration") if params.get("duration") not in (None, "") else params.get("audio_duration")
        auto_duration = _coerce_bool(params.get("auto_duration"), False)
        if not auto_duration and duration_raw not in (None, "", 0):
            full_params["audio_duration"] = int(duration_raw)
        full_params["auto_duration"] = auto_duration
        _run_acestep15_generation(job, job_id, full_params, full_path)
        _set_asset_ready(job, job_id, "full_mix", full_path)
        _set_status(job, "full_ready", "Full song ready")
        _set_progress(job, 45)

        source_path = full_path
        vocals_file, inst_file, file_id = _run_separation(job, job_id, source_path)

        if params.get("enhance_vocals", True) and file_id and vocals_file:
            _run_rvc(job, job_id, file_id, vocals_file, inst_file)

        _set_status(job, "completed", "Song generation complete")
        _set_progress(job, 100)
        job["completed_at"] = datetime.now().isoformat()

    except Exception as e:
        import traceback

        job["status"] = "failed"
        job["error"] = str(e)
        job["status_message"] = f"Generation failed: {str(e)}"
        print(f"Song generation error for job {job_id}: {e}")
        print(traceback.format_exc())


class AceStepProvider:
    name = "ace_step"

    def run(self, job_id, params):
        return run_song_generation_thread(job_id, params)
