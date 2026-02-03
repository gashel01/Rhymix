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

# ACE-Step default parameters (can be overridden)
ACESTEP_DEFAULTS = {
    "infer_step": 60,
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

# ACE-Step paths
ACESTEP_DIR = paths.BASE_DIR / "ACE-Step"
ACESTEP_CHECKPOINT_PATH = ACESTEP_DIR / "checkpoints"
ACESTEP_VENV_PATH = ACESTEP_DIR / "venv"  # ACE-Step's own virtual environment

# Song generation output directory
SONG_GENERATION_DIR = paths.BASE_DIR / "data" / "generated_songs"
SONG_GENERATION_DIR.mkdir(parents=True, exist_ok=True)


def get_acestep_python():
    """Get the Python executable for ACE-Step (from its venv if exists)"""
    if sys.platform == "win32":
        venv_python = ACESTEP_VENV_PATH / "Scripts" / "python.exe"
    else:
        venv_python = ACESTEP_VENV_PATH / "bin" / "python"

    if venv_python.exists():
        return str(venv_python)

    # Fallback to system python
    return sys.executable


def run_song_generation_thread(job_id, params):
    """Run ACE-Step song generation as subprocess in background thread"""
    job = song_generation_jobs[job_id]

    try:
        job["status"] = "initializing"
        job["progress"] = 5
        job["status_message"] = "Preparing generation..."

        # Prepare output path
        title_safe = re.sub(r"[^\w\-_]", "_", params.get("title", "untitled"))
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_filename = f"{title_safe}_{timestamp}.wav"
        output_path = SONG_GENERATION_DIR / output_filename

        # Merge with defaults
        infer_params = {**ACESTEP_DEFAULTS, **params}

        # Create a temporary params file for the subprocess
        params_file = SONG_GENERATION_DIR / f"{job_id}_params.json"
        with open(params_file, "w") as f:
            json.dump(
                {
                    "audio_duration": infer_params.get("audio_duration", 180),
                    "prompt": infer_params.get("prompt", ""),
                    "lyrics": infer_params.get("lyrics", ""),
                    "infer_step": infer_params.get("infer_step", 60),
                    "guidance_scale": infer_params.get("guidance_scale", 15.0),
                    "scheduler_type": infer_params.get("scheduler_type", "euler"),
                    "cfg_type": infer_params.get("cfg_type", "apg"),
                    "omega_scale": infer_params.get("omega_scale", 10.0),
                    "actual_seeds": infer_params.get("actual_seeds", [-1]),
                    "guidance_interval": infer_params.get("guidance_interval", 0.5),
                    "guidance_interval_decay": infer_params.get("guidance_interval_decay", 0.0),
                    "min_guidance_scale": infer_params.get("min_guidance_scale", 3.0),
                    "use_erg_tag": infer_params.get("use_erg_tag", True),
                    "use_erg_lyric": infer_params.get("use_erg_lyric", True),
                    "use_erg_diffusion": infer_params.get("use_erg_diffusion", True),
                    "oss_steps": infer_params.get("oss_steps", []),
                    "guidance_scale_text": infer_params.get("guidance_scale_text", 0.0),
                    "guidance_scale_lyric": infer_params.get("guidance_scale_lyric", 0.0),
                },
                f,
            )

        # Find checkpoint path
        checkpoint_path = str(ACESTEP_CHECKPOINT_PATH)
        alt_paths = [
            ACESTEP_DIR / "ckpts",
            ACESTEP_DIR / "models",
            Path.home() / ".cache" / "acestep",
        ]
        for alt in alt_paths:
            if alt.exists():
                checkpoint_path = str(alt)
                break

        job["status"] = "generating"
        job["progress"] = 10
        job["status_message"] = "Starting ACE-Step subprocess..."

        # Get the right Python executable
        python_exe = get_acestep_python()

        # Create a wrapper script that will be run
        wrapper_script = SONG_GENERATION_DIR / f"{job_id}_runner.py"
        with open(wrapper_script, "w") as f:
            f.write(
                f"""
import sys
import json
import os

# Force unbuffered output
sys.stdout.reconfigure(line_buffering=True) if hasattr(sys.stdout, 'reconfigure') else None
sys.stderr.reconfigure(line_buffering=True) if hasattr(sys.stderr, 'reconfigure') else None

# Windows DLL fix for PyTorch - must be done BEFORE importing torch
if sys.platform == "win32":
    try:
        # Find torch lib directory and add to PATH and DLL directories
        import site
        torch_lib_paths = []

        # Check site-packages
        for sp in site.getsitepackages():
            torch_lib = os.path.join(sp, "torch", "lib")
            if os.path.exists(torch_lib):
                torch_lib_paths.append(torch_lib)

        # Check venv torch
        venv_sp = os.path.join(os.path.dirname(sys.executable), "..", "Lib", "site-packages", "torch", "lib")
        if os.path.exists(venv_sp):
            torch_lib_paths.append(os.path.abspath(venv_sp))

        # Add to PATH (older Windows compatibility)
        for tlp in torch_lib_paths:
            if tlp not in os.environ.get("PATH", ""):
                os.environ["PATH"] = tlp + os.pathsep + os.environ.get("PATH", "")

        # Add to DLL search path (Windows 10 1607+)
        for tlp in torch_lib_paths:
            try:
                os.add_dll_directory(tlp)
            except (AttributeError, OSError):
                pass

    except Exception as e:
        print(f"Warning: Could not set DLL directory: {{e}}")

# Monkey-patch tqdm BEFORE importing ACE-Step to capture progress
from tqdm import tqdm as original_tqdm
class ProgressTqdm(original_tqdm):
    def __init__(self, *args, **kwargs):
        # Force output to stdout for capturing
        kwargs['file'] = sys.stdout
        kwargs['mininterval'] = 0.5
        kwargs['ncols'] = 80
        super().__init__(*args, **kwargs)

    def update(self, n=1):
        super().update(n)
        if self.total:
            pct = int((self.n / self.total) * 100)
            # Map tqdm progress to 25-90% of our total progress
            mapped_pct = 25 + int((self.n / self.total) * 65)
            print(f"TQDM_PROGRESS:{{mapped_pct}}:Step {{self.n}}/{{self.total}}")
            sys.stdout.flush()

# Replace tqdm globally
import tqdm as tqdm_module
tqdm_module.tqdm = ProgressTqdm

# Add ACE-Step to path
sys.path.insert(0, r"{ACESTEP_DIR}")

from acestep.pipeline_ace_step import ACEStepPipeline

# Load params
with open(r"{params_file}", "r") as pf:
    params = json.load(pf)

print("PROGRESS:15:Loading model...")
sys.stdout.flush()

# Initialize pipeline
pipeline = ACEStepPipeline(
    checkpoint_dir=r"{checkpoint_path}",
    dtype="bfloat16",
    torch_compile=False,
    cpu_offload=True,
    overlapped_decode=False
)

print("PROGRESS:25:Generating audio...")
sys.stdout.flush()

# Run generation
pipeline(
    audio_duration=params["audio_duration"],
    prompt=params["prompt"],
    lyrics=params["lyrics"],
    infer_step=params["infer_step"],
    guidance_scale=params["guidance_scale"],
    scheduler_type=params["scheduler_type"],
    cfg_type=params["cfg_type"],
    omega_scale=params["omega_scale"],
    manual_seeds=", ".join(map(str, params["actual_seeds"])),
    guidance_interval=params["guidance_interval"],
    guidance_interval_decay=params["guidance_interval_decay"],
    min_guidance_scale=params["min_guidance_scale"],
    use_erg_tag=params["use_erg_tag"],
    use_erg_lyric=params["use_erg_lyric"],
    use_erg_diffusion=params["use_erg_diffusion"],
    oss_steps=", ".join(map(str, params["oss_steps"])),
    guidance_scale_text=params["guidance_scale_text"],
    guidance_scale_lyric=params["guidance_scale_lyric"],
    save_path=r"{output_path}",
)

print("PROGRESS:95:Finalizing...")
sys.stdout.flush()

if os.path.exists(r"{output_path}"):
    print("SUCCESS")
else:
    print("ERROR:Output file not created")
"""
            )

        # Set up environment for subprocess
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"  # Force unbuffered output
        env["TQDM_DISABLE"] = "0"  # Keep tqdm enabled but it will output to stderr
        env["TQDM_MININTERVAL"] = "1"  # Update every second

        if sys.platform == "win32":
            # Add torch lib to PATH for the subprocess
            venv_torch_lib = ACESTEP_VENV_PATH / "Lib" / "site-packages" / "torch" / "lib"
            if venv_torch_lib.exists():
                env["PATH"] = str(venv_torch_lib) + os.pathsep + env.get("PATH", "")

        # Run the subprocess - merge stderr into stdout so we see all output
        process = subprocess.Popen(
            [python_exe, "-u", str(wrapper_script)],  # -u for unbuffered output
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,  # Merge stderr into stdout
            text=True,
            cwd=str(ACESTEP_DIR),
            bufsize=1,
            env=env,
        )

        job["subprocess_pid"] = process.pid

        # Monitor output for progress updates
        success = False
        error_output = []

        for line in iter(process.stdout.readline, ""):
            if process.poll() is not None and not line:
                break

            line = line.rstrip("\n\r")

            # Always print to Flask console
            print(f"[ACE-Step] {line}", flush=True)

            # Parse our custom progress markers
            if line.startswith("PROGRESS:") or line.startswith("TQDM_PROGRESS:"):
                parts = line.split(":", 2)
                if len(parts) >= 2:
                    try:
                        job["progress"] = int(parts[1])
                        if len(parts) >= 3:
                            job["status_message"] = parts[2]
                    except ValueError:
                        pass
            elif line == "SUCCESS":
                success = True
            elif line.startswith("ERROR:"):
                error_output.append(line[6:])
            # Parse tqdm progress bar output (e.g., "50%|████      | 30/60")
            elif "%|" in line or ("it/s" in line and "/" in line):
                import re as regex

                # Match patterns like "50%|████| 30/60" or "30/60 [00:15<00:15, 2.00it/s]"
                step_match = regex.search(r"(\\d+)/(\\d+)", line)
                pct_match = regex.search(r"(\\d+)%", line)
                if step_match:
                    current = int(step_match.group(1))
                    total = int(step_match.group(2))
                    # Map to 25-90% range
                    pct = 25 + int((current / total) * 65)
                    job["progress"] = min(pct, 90)
                    job["status_message"] = f"Generating audio... Step {current}/{total}"
                elif pct_match:
                    pct = int(pct_match.group(1))
                    mapped_pct = 25 + int((pct / 100) * 65)
                    job["progress"] = min(mapped_pct, 90)

        # Wait for process to finish
        process.wait()

        # Check remaining output
        remaining = process.stdout.read()
        if remaining:
            for line in remaining.split("\\n"):
                line = line.strip()
                if line:
                    print(f"[ACE-Step] {line}", flush=True)
                    if line == "SUCCESS":
                        success = True
                    elif line.startswith("ERROR:"):
                        error_output.append(line[6:])

        # Clean up temp files
        try:
            params_file.unlink()
            wrapper_script.unlink()
        except Exception:
            pass

        if process.returncode != 0 or not success:
            error_msg = "\\n".join(error_output) if error_output else f"Process exited with code {process.returncode}"
            raise Exception(error_msg)

        # Check if file was created
        if not output_path.exists():
            raise Exception("Generated audio file not found")

        job["output_file"] = str(output_path)
        job["output_filename"] = output_filename

        # Always run through the process pipeline for vocal separation
        job["status"] = "processing"
        job["progress"] = 92
        job["status_message"] = "Preparing for vocal separation..."

        try:
            # Register generated audio as a unique upload
            title_safe = sanitize_filename_for_display(params.get("title", "untitled"))
            stored_name, file_id = make_storage_name(title_safe)
            input_path = paths.INPUT_DIR / stored_name

            # Copy to input directory with unique name
            print(f"[ACE-Step] Copying generated song to input: {input_path}", flush=True)
            shutil.copy(str(output_path), str(input_path))
            register_upload_metadata(title_safe, stored_name, file_id)

            job["progress"] = 94
            job["status_message"] = "Starting vocal separation..."

            # Create a processing job and run it
            process_job_id = str(uuid.uuid4())
            active_jobs[process_job_id] = {
                "id": process_job_id,
                "status": "starting",
                "progress": 0,
                "config": {"segment": False, "process": True, "export": False, "clean": False},
                "started_at": time.time(),
            }

            # Run process in same thread (we're already in a background thread)
            print(f"[ACE-Step] Starting vocal separation job: {process_job_id}", flush=True)
            process_audio_files_thread(process_job_id, segment=False, process=True, export=False, clean=False)

            # Check if processing succeeded
            process_result = active_jobs.get(process_job_id, {})
            if process_result.get("status") == "failed":
                print(f"[ACE-Step] Vocal separation failed: {process_result.get('error')}", flush=True)
                job["processed"] = False
            else:
                print(f"[ACE-Step] Vocal separation completed successfully", flush=True)
                job["processed"] = True
                job["process_job_id"] = process_job_id

                # Store paths to the processed files
                base_name = Path(stored_name).stem
                vocals_file = paths.UVR_RAW_DIR / f"{base_name}_vocals.wav"
                instrumental_file = paths.INSTRUMENTAL_DIR / f"{base_name}_instrumental.wav"

                if vocals_file.exists():
                    job["vocals_file"] = str(vocals_file)
                    job["vocals_url"] = f"/api/download/raw_vocals/{file_id}"
                    print(f"[ACE-Step] Vocals file: {vocals_file}", flush=True)

                if instrumental_file.exists():
                    job["instrumental_file"] = str(instrumental_file)
                    job["instrumental_url"] = f"/api/download/instrumental/{file_id}"
                    print(f"[ACE-Step] Instrumental file: {instrumental_file}", flush=True)

                # Run voice conversion (inference) if a model was selected
                model_name = params.get("model_name")
                model_obj = params.get("model")  # Full model object with checkpoints

                if model_name and model_obj and vocals_file.exists():
                    job["progress"] = 85
                    job["status_message"] = f"Applying voice model: {model_name}..."
                    print(f"[ACE-Step] Starting voice conversion with model: {model_name}", flush=True)

                    try:
                        # Prepare inference parameters (default settings)
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

                        # Track object for inference
                        track_obj = {
                            "name": title_safe,
                            "fileId": file_id,
                            "vocalFileType": "raw_vocals",
                            "processed": False,  # ACE-Step vocals are in raw directory
                        }

                        # Create inference job
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

                        # Run inference synchronously (we're already in a background thread)
                        print(f"[ACE-Step] Running inference job: {inference_job_id}", flush=True)
                        print(f"[ACE-Step] Model object: {model_obj}", flush=True)
                        run_inference_job(inference_job_id, inference_run_id, model_obj, track_obj, inference_params)

                        # Check result
                        inference_result = active_jobs.get(inference_job_id, {})
                        if inference_result.get("status") == "completed":
                            job["inference_completed"] = True
                            job["inference_job_id"] = inference_job_id

                            output_url = inference_result.get("outputUrl")
                            if output_url:
                                job["vocals_url"] = output_url
                        else:
                            print(
                                f"[ACE-Step] Voice conversion failed: {inference_result.get('error')}", flush=True
                            )
                            job["inference_completed"] = False

                    except Exception as infer_err:
                        print(f"[ACE-Step] Voice conversion error: {infer_err}", flush=True)
                        import traceback

                        traceback.print_exc()
                        job["inference_completed"] = False

            # Clean up - delete the generated song file after processing
            job["progress"] = 98
            job["status_message"] = "Cleaning up..."
            try:
                output_path.unlink()
                print(f"[ACE-Step] Deleted generated song file: {output_path}", flush=True)
                # Also delete the input copy
                if input_path.exists():
                    input_path.unlink()
                    print(f"[ACE-Step] Deleted input copy: {input_path}", flush=True)
            except Exception as del_err:
                print(f"[ACE-Step] Warning: Could not delete files: {del_err}", flush=True)

        except Exception as proc_err:
            print(f"[ACE-Step] Warning: Could not process vocals: {proc_err}", flush=True)
            import traceback

            traceback.print_exc()
            job["processed"] = False

        job["status"] = "completed"
        job["progress"] = 100
        job["status_message"] = "Song generation and processing complete!"
        job["completed_at"] = datetime.now().isoformat()

        # Generate URL for playback (now points to the separated vocals)
        job["audio_url"] = f"/api/song-generation/audio/{job_id}"

    except Exception as e:
        import traceback

        job["status"] = "failed"
        job["progress"] = 0
        job["error"] = str(e)
        job["status_message"] = f"Generation failed: {str(e)}"
        print(f"Song generation error for job {job_id}: {e}")
        print(traceback.format_exc())


class AceStepProvider:
    name = "ace_step"

    def run(self, job_id, params):
        return run_song_generation_thread(job_id, params)
