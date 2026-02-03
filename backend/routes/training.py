import json
import logging
import os
import re
import threading
import time
import uuid
from pathlib import Path

from flask import Blueprint, jsonify, request

from backend.jobs.registry import active_jobs
from backend.paths.manager import paths

bp = Blueprint("training", __name__)


@bp.route("/api/prepare-training-dataset", methods=["POST"])
def prepare_training_dataset():
    try:
        files = request.files.getlist("vocals")
        if not files:
            return jsonify({"error": "No audio files provided"}), 400
        if not files[0].filename:
            return jsonify({"error": "No audio files selected"}), 400

        name = request.form.get("modelName", "unnamed_model")
        _sr = int(request.form.get("sampleRate", 48000))  # kept for parity, even if unused here

        d = paths.APPLIO_DATASET_DIR / name
        d.mkdir(parents=True, exist_ok=True)

        from werkzeug.utils import secure_filename

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
        model = d.get("modelName")
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
            "model_name": model,
            "status": "preprocessing",
            "progress": 0,
            "logs": ["Starting preprocessing..."],
            "started_at": time.time(),
        }

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
        return result

    except Exception as e:
        logging.getLogger(__name__).error(f"Error in training pipeline: {e}")
        import traceback

        traceback.print_exc()
        job.update(status="failed", error=str(e))
        job["logs"].append(f"Error: {e}")
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
