import json
import logging
import os
import re
import subprocess
import threading
import time
import uuid
from pathlib import Path

from flask import Blueprint, jsonify, request
from werkzeug.utils import secure_filename

from backend.jobs.registry import active_jobs
from backend.paths.manager import paths


def _safe_model_name(raw):
    """Reduce a client-supplied model name to a single safe path segment.

    The name becomes a directory under the dataset and logs roots, so anything
    like "../.." would write outside them. Returns "" when nothing usable is
    left, which callers reject.
    """
    return secure_filename((raw or "").strip())

bp = Blueprint("training", __name__)


@bp.route("/api/prepare-training-dataset", methods=["POST"])
def prepare_training_dataset():
    try:
        files = request.files.getlist("vocals")
        if not files:
            return jsonify({"error": "No audio files provided"}), 400
        if not files[0].filename:
            return jsonify({"error": "No audio files selected"}), 400

        name = _safe_model_name(request.form.get("modelName"))
        if not name:
            return jsonify({"error": "Invalid model name"}), 400
        _sr = int(request.form.get("sampleRate", 48000))  # kept for parity, even if unused here

        d = paths.APPLIO_DATASET_DIR / name
        d.mkdir(parents=True, exist_ok=True)

        for f in files:
            f.save(str(d / secure_filename(f.filename)))

        return jsonify(
            {"message": f"Dataset prepared with {len(files)} files", "datasetDir": str(d), "modelName": name}
        )
    except Exception as e:
        logging.getLogger(__name__).error(f"Error preparing training dataset: {e}")
        import traceback

        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@bp.route("/api/start-training", methods=["POST"])
def start_training():
    try:
        d = request.json or {}
        model = _safe_model_name(d.get("modelName"))
        if not model:
            return jsonify({"error": "Model name is required"}), 400

        ds = paths.APPLIO_DATASET_DIR / model
        if not ds.exists():
            return jsonify({"error": f"Dataset directory not found: {ds}"}), 404
        if not any(p.suffix.lower() in (".wav", ".mp3", ".ogg", ".flac") for p in ds.iterdir()):
            return jsonify({"error": f"No audio files found in dataset directory: {ds}"}), 400

        job_id = str(uuid.uuid4())
        active_jobs[job_id] = {
            "id": job_id,
            # active_jobs is shared with inference; tag the kind so the job can be
            # listed and reattached to after the user navigates away.
            "type": "training",
            "model_name": model,
            "status": "preprocessing",
            "progress": 0,
            "logs": ["Starting preprocessing..."],
            "started_at": time.time(),
        }
        _persist_jobs()

        # keep same defaults + arg order to run_training_pipeline
        args = (
            job_id,
            model,
            ds,
            d.get("rvcVersion", "v2"),
            d.get("saveEveryEpoch", 20),
            d.get("saveOnlyLatest", False),
            d.get("saveEveryWeights", True),
            d.get("totalEpoch", 100),
            d.get("sampleRate", 48000),
            d.get("batchSize", 8),
            d.get("gpu", 0),
            d.get("pitchGuidance", True),
            d.get("overtrainingDetector", True),
            d.get("overtrainingThreshold", 5),
            d.get("pretrained", True),
            d.get("cleanup", True),
            d.get("indexAlgorithm", "Auto"),
            d.get("cacheDataInGpu", False),
            d.get("customPretrained", False),
            d.get("gPretrainedPath"),
            d.get("dPretrainedPath"),
        )
        threading.Thread(target=run_training_pipeline, args=args, daemon=True).start()
        return jsonify({"jobId": job_id, "message": "Training process started"})
    except Exception as e:
        logging.getLogger(__name__).error(f"Error starting training: {e}")
        import traceback

        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# Applio's run_*_script helpers call subprocess.run() internally and hand back
# no handle, so a running worker can only be reached by looking it up. These
# markers identify one: the scripts all live under rvc/train.
_TRAINING_SCRIPT_MARKERS = ("rvc\\train", "rvc/train")


def _python_processes():
    """Return (pid, command line) for every python process on the machine.

    The query takes no arguments on purpose. Model names come from the client,
    and interpolating one into a shell command would be an injection hole — the
    filtering happens in Python instead.
    """
    script = (
        "Get-CimInstance Win32_Process -Filter \"Name like '%python%'\" | "
        "Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"
    )
    try:
        raw = subprocess.check_output(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
            text=True,
            timeout=30,
            stderr=subprocess.DEVNULL,
        )
        data = json.loads(raw or "[]")
    except (OSError, subprocess.SubprocessError, ValueError):
        logging.getLogger(__name__).warning("Could not enumerate python processes", exc_info=True)
        return []

    if isinstance(data, dict):  # a single match isn't wrapped in a list
        data = [data]
    return [(int(p["ProcessId"]), p.get("CommandLine") or "") for p in data if p.get("ProcessId")]


def _stop_training_processes(model_name=None):
    """Kill Applio training workers. Returns the pids stopped.

    With no model name, stops every training worker on the machine — used at
    startup, where nothing running can belong to this process.
    """
    stopped = []
    for pid, cmdline in _python_processes():
        if model_name is not None and model_name not in cmdline:
            continue
        if not any(marker in cmdline for marker in _TRAINING_SCRIPT_MARKERS):
            continue
        try:
            # /T so the worker's own children go with it.
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                check=False,
                capture_output=True,
                timeout=30,
            )
            stopped.append(pid)
        except (OSError, subprocess.SubprocessError):
            logging.getLogger(__name__).warning("Could not stop training pid %s", pid)
    return stopped


def _jobs_file():
    return paths.METADATA_DIR / "training_jobs.json"


def _persist_jobs():
    """Snapshot training jobs to disk so a restart doesn't lose the history.

    Called on status transitions rather than on every progress tick — after a
    restart a run is finished either way, so the exact percentage is worthless.
    """
    try:
        paths.METADATA_DIR.mkdir(parents=True, exist_ok=True)
        payload = []
        for job in active_jobs.values():
            if job.get("type") != "training":
                continue
            snapshot = {k: v for k, v in job.items() if k != "logs"}
            snapshot["logs"] = job.get("logs", [])[-50:]
            payload.append(snapshot)
        _jobs_file().write_text(json.dumps(payload), encoding="utf-8")
    except (OSError, TypeError, ValueError):
        logging.getLogger(__name__).warning("Could not persist training jobs", exc_info=True)


def restore_training_jobs():
    """Reload persisted jobs and stop whatever the previous process left behind.

    Applio's workers are not killed when the backend dies, and the new process
    has no way to talk to them — they would just hold the GPU while the UI shows
    nothing. Stop them, and mark any run that was live as interrupted.
    """
    log = logging.getLogger(__name__)

    stopped = _stop_training_processes()
    if stopped:
        log.warning("Stopped %d orphaned training worker(s) from a previous run: %s", len(stopped), stopped)

    path = _jobs_file()
    if not path.exists():
        return

    try:
        saved = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        log.warning("Could not read persisted training jobs", exc_info=True)
        return

    for job in saved:
        if not job.get("id"):
            continue
        if job.get("status") not in ("completed", "failed", "cancelled", "interrupted"):
            job["status"] = "interrupted"
            job["error"] = "The backend restarted while this run was in progress"
            job.setdefault("logs", []).append("Interrupted: the backend restarted")
        active_jobs[job["id"]] = job

    _persist_jobs()


@bp.route("/api/training-jobs/<job_id>/cancel", methods=["POST"])
def cancel_training(job_id):
    job = active_jobs.get(job_id)
    if not job or job.get("type") != "training":
        return jsonify({"error": "Job not found"}), 404
    if job["status"] in ("completed", "failed", "cancelled", "interrupted"):
        return jsonify({"error": f"Job already {job['status']}"}), 409

    # Flag before killing: the pipeline thread checks this between steps so it
    # doesn't march on to the next one once the current worker dies.
    job["cancelled"] = True
    stopped = _stop_training_processes(job["model_name"])
    job["status"] = "cancelled"
    job["error"] = "Cancelled"
    job["completed_at"] = time.time()
    job["logs"].append(f"Cancelled — stopped {len(stopped)} process(es)")
    _persist_jobs()

    return jsonify({"jobId": job_id, "status": "cancelled", "stopped": stopped})


def run_training_pipeline(
    job_id,
    model_name,
    dataset_dir,
    rvc_version,
    save_every_epoch,
    save_only_latest,
    save_every_weights,
    total_epoch,
    sample_rate,
    batch_size,
    gpu,
    pitch_guidance,
    overtraining_detector,
    overtraining_threshold,
    pretrained,
    cleanup,
    index_algorithm,
    cache_data_in_gpu,
    custom_pretrained,
    g_pretrained_path,
    d_pretrained_path,
):
    os.environ["TORIO_USE_FFMPEG"] = "0"
    job = active_jobs[job_id]

    try:
        job.update(status="preprocessing")
        job["logs"] += [
            "Starting preprocessing...",
            f"Training model: {model_name}",
            f"Dataset directory: {dataset_dir}",
            f"RVC version: {rvc_version}",
            f"Sample rate: {sample_rate}",
            f"Batch size: {batch_size}",
            f"GPU: {gpu}",
            f"Epochs: {total_epoch}",
            "Starting Applio training pipeline...",
        ]
        job["status"] = "training"

        def monitor():
            stage, logs_dir = 1, paths.APPLIO_MODELS_DIR / model_name
            while job["status"] in ("preprocessing", "training"):
                if stage < 2 and (logs_dir / "0_gt_wavs").exists():
                    job["logs"].append("Preprocessing complete")
                    job["progress"] = 33
                    stage = 2
                if stage < 3 and (logs_dir / f"{rvc_version}_extracted").exists():
                    job["logs"].append("Feature extraction complete")
                    job["progress"] = 66
                    stage = 3
                eps = [
                    int(m.group(1))
                    for f in logs_dir.glob("*.pth")
                    if (m := re.search(r"_(\d+)\.pth$", f.name))
                ]
                if eps:
                    cur = max(eps)
                    job["progress"] = int(66 + min(cur / total_epoch, 1) * 34)
                    job["logs"].append(f"Training progress: Epoch {cur}/{total_epoch}")
                time.sleep(5)

        threading.Thread(target=monitor, daemon=True).start()

        from applio.core import run_preprocess_script, run_extract_script, run_train_script

        try:
            job["logs"].append("Step 1/3: Preprocessing audio files...")
            run_preprocess_script(
                model_name=model_name,
                dataset_path=dataset_dir,
                sample_rate=sample_rate,
                cpu_cores=8,
                cut_preprocess="Automatic",
                process_effects=True,
                noise_reduction=True,
                clean_strength=0.5,
                chunk_len=30.0,
                overlap_len=0.3,
                normalization_mode="none",
            )
            if job.get("cancelled"):
                return {"success": False, "message": "Cancelled"}
            job["logs"].append("✅ Preprocessing completed successfully")
            job["progress"] = 33

            job["logs"].append("Step 2/3: Extracting features...")
            run_extract_script(
                model_name=model_name,
                f0_method="rmvpe",
                cpu_cores=8,
                gpu=gpu,
                sample_rate=sample_rate,
                embedder_model="contentvec",
                embedder_model_custom=None,
                include_mutes=2,
            )
            if job.get("cancelled"):
                return {"success": False, "message": "Cancelled"}
            job["logs"].append("✅ Feature extraction completed successfully")
            job["progress"] = 66

            job["logs"].append("Step 3/3: Training model...")
            run_train_script(
                model_name=model_name,
                save_every_epoch=save_every_epoch,
                save_only_latest=save_only_latest,
                save_every_weights=save_every_weights,
                total_epoch=total_epoch,
                sample_rate=sample_rate,
                batch_size=batch_size,
                gpu=gpu,
                overtraining_detector=overtraining_detector,
                overtraining_threshold=overtraining_threshold,
                pretrained=pretrained,
                cleanup=cleanup,
                index_algorithm=index_algorithm,
                cache_data_in_gpu=cache_data_in_gpu,
                custom_pretrained=custom_pretrained,
                g_pretrained_path=g_pretrained_path,
                d_pretrained_path=d_pretrained_path,
                vocoder="HiFi-GAN",
                checkpointing=False,
            )
            # A killed worker makes subprocess.run() return normally, so the
            # cancel flag is the only thing telling success apart from abort.
            if job.get("cancelled"):
                return {"success": False, "message": "Cancelled"}
            job["logs"].append("✅ Training completed successfully")
            job["progress"] = 100
            result = {"success": True, "message": "Training completed successfully"}

        except Exception as e:
            msg = f"Training pipeline failed: {e}"
            job["logs"].append(f"❌ Error: {msg}")
            result = {"success": False, "error": msg}

        if result and ("failed" in str(result).lower() or "error" in str(result).lower()):
            raise Exception(f"Training pipeline failed: {result}")

        logs_dir = paths.APPLIO_MODELS_DIR / model_name
        job.update(
            status="completed",
            progress=100,
            completed_at=time.time(),
            model_files={
                "pth_files": [str(f) for f in logs_dir.glob("*.pth")],
                "index_files": [str(f) for f in logs_dir.glob("*.index")],
            },
        )
        job["logs"] += [
            f"Training completed. Result: {result}",
            f"Training took {int(job['completed_at'] - job['started_at'])} seconds",
        ]
        _persist_jobs()
        return result

    except Exception as e:
        logging.getLogger(__name__).error(f"Error in training pipeline: {e}")
        import traceback

        traceback.print_exc()
        # Killing a worker usually surfaces here as an exception. That isn't a
        # failure — don't let it overwrite the cancellation the user asked for.
        if job.get("cancelled"):
            job["logs"].append("Pipeline stopped after cancellation")
            _persist_jobs()
            return "Training cancelled"
        job.update(status="failed", error=str(e))
        job["logs"].append(f"Error: {e}")
        _persist_jobs()
        return f"Training failed: {e}"


@bp.route("/api/training-status/<job_id>")
def training_status(job_id):
    if job_id not in active_jobs:
        return jsonify({"error": "Job not found"}), 404

    j = active_jobs[job_id]
    return jsonify(
        {
            "id": j["id"],
            "model_name": j["model_name"],
            "status": j["status"],
            "progress": j["progress"],
            "logs": j["logs"],
            "started_at": j["started_at"],
            "completed_at": j.get("completed_at"),
            "error": j.get("error"),
        }
    )


@bp.route("/api/training-jobs")
def training_jobs():
    """Training runs the UI can reattach to.

    A run outlives the view that started it, so the Models list needs a way to
    show it and hand the job id back. Logs are omitted here — they can be long,
    and /api/training-status/<id> already serves them.
    """
    jobs = [
        {
            "id": j["id"],
            "model_name": j["model_name"],
            "status": j["status"],
            "progress": j.get("progress", 0),
            "started_at": j.get("started_at"),
            "completed_at": j.get("completed_at"),
            "error": j.get("error"),
        }
        for j in active_jobs.values()
        if j.get("type") == "training"
    ]
    jobs.sort(key=lambda j: j.get("started_at") or 0, reverse=True)
    return jsonify({"jobs": jobs})
