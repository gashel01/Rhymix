import logging
import os
import threading
import uuid
from datetime import datetime
from pathlib import Path

from backend.features.inference.models import resolve_checkpoint
from backend.jobs.registry import active_jobs
from backend.paths.manager import paths
from backend.storage.inference_runs import (
    load_inference_run_metadata,
    make_run_id,
    save_inference_run_metadata,
)
from backend.storage.metadata import get_upload_base_name, get_upload_metadata

# Now try importing the core functions
try:
    from core import (
        run_infer_script,
        run_preprocess_script,
        run_extract_script,
        run_train_script,
        run_index_script,
    )
except ImportError as e:
    import sys as _sys
    print(f"[rhymix] WARNING: applio not installed - inference unavailable ({e})", file=_sys.stderr)
    # Stubs so dependent modules can import without crashing.
    # All will raise a clear error if actually called before setup.bat runs.
    run_infer_script = None
    run_preprocess_script = None
    run_extract_script = None
    run_train_script = None
    run_index_script = None
    run_singer_training_pipeline = None


def start_inference_job(model, track, params):
    # Create a unique job ID
    job_id = str(uuid.uuid4())
    run_id = make_run_id()

    # Initialize job
    active_jobs[job_id] = {
        "id": job_id,
        "type": "inference",
        "model_name": model["name"],
        "track": track,
        "params": params,
        "run_id": run_id,
        "status": "starting",
        "progress": 0,
        "logs": ["Starting inference..."],
        "started_at": datetime.now().isoformat(),
    }

    # Start inference in background thread
    thread = threading.Thread(target=run_inference_job, args=(job_id, run_id, model, track, params))
    thread.daemon = True
    thread.start()

    return job_id, run_id


def run_inference_job(job_id, run_id, model, track, params):
    """Run inference job in isolated process"""
    # Process-level exception handler to prevent any crashes from affecting Flask
    try:
        # Set process name for debugging
        import multiprocessing

        multiprocessing.current_process().name = f"Inference-{job_id[:8]}"

        # Disable FFmpeg requirement for torchaudio
        os.environ["TORIO_USE_FFMPEG"] = "0"
        os.environ["TORCHAUDIO_USE_FFMPEG"] = "0"
        os.environ["FFMPEG_ROOT"] = ""

        # Disable verbose logging immediately
        for logger_name in ["byteflow", "torio", "torch", "applio"]:
            logger = logging.getLogger(logger_name)
            logger.setLevel(logging.CRITICAL)
            logger.disabled = True

        # Since we're in a separate process, use file-based status updates
        print(f"Inference process started for job {job_id}")

        # Import required modules
        from core import run_infer_script

        # Update status using file-based system
        active_jobs[job_id].update(
            {
                "status": "processing",
                "progress": 10,
                "logs": active_jobs[job_id].get("logs", [])
                + [f"Running inference for track: {track.get('name', 'unknown')}"],
            }
        )

        # Import inference function from applio (suppress FFmpeg warnings)
        import warnings

        # Suppress torio debug messages
        torio_logger = logging.getLogger("torio")
        torio_logger.setLevel(logging.ERROR)
        torio_logger.disabled = True

        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message=".*FFmpeg.*")
            warnings.filterwarnings("ignore", category=UserWarning)
            from core import run_infer_script

        # Prepare inference parameters
        selected_checkpoint = resolve_checkpoint(model)

        if not selected_checkpoint or not selected_checkpoint.get("path"):
            active_jobs[job_id].update(
                {"status": "failed", "error": f"No valid checkpoint found for model: {model.get('name')}"}
            )
            return

        model_path = selected_checkpoint["path"]
        index_path = model.get("indexPath")

        # Debug: Check if model file exists
        print(f"Selected checkpoint: {selected_checkpoint}")
        print(f"Raw model path: {model_path}")

        # Convert relative path to absolute path
        if not os.path.isabs(model_path):
            model_path = str(paths.APPLIO_MODELS_DIR / model_path)
            print(f"Absolute model path: {model_path}")

        print(f"Model file exists: {os.path.exists(model_path)}")
        print(f"APPLIO_MODELS_DIR: {paths.APPLIO_MODELS_DIR}")

        if not os.path.exists(model_path):
            active_jobs[job_id].update({"status": "failed", "error": f"Model file not found: {model_path}"})
            return

        # Get input audio path. Two sources are possible:
        #  - the original upload's vocals — a plain re-inference
        #  - a previous run's output — layered inference, one model on top of another
        file_id = track.get("fileId") or track.get("id")
        source_run_id = track.get("sourceRunId")
        vocals_file_type = track.get("vocalFileType") or track.get("vocalsFileType")
        use_processed = track.get("processed", True)
        if vocals_file_type in {"raw_vocals", "processed_vocals"}:
            use_processed = vocals_file_type == "processed_vocals"

        input_path = None
        if source_run_id:
            source_meta = load_inference_run_metadata(source_run_id)
            if not source_meta:
                active_jobs[job_id].update(
                    {"status": "failed", "error": f"Unknown source run: {source_run_id}"}
                )
                return
            source_path = paths.INFERENCE_RUNS_DIR / source_run_id / source_meta.get(
                "outputFileName", "inferred.wav"
            )
            if not source_path.exists():
                active_jobs[job_id].update(
                    {"status": "failed", "error": f"Source run output missing: {source_path.name}"}
                )
                return
            input_path = str(source_path)
        elif file_id:
            base_name = get_upload_base_name(file_id)
            if not base_name:
                active_jobs[job_id].update({"status": "failed", "error": f"Unknown fileId: {file_id}"})
                return
            input_path = str(paths.get_vocal_file_path(f"{base_name}_vocals.wav", processed=use_processed))
        else:
            vocal_filename = track.get("vocal", "").split("/").pop().split("\\").pop()
            input_path = str(paths.get_vocal_file_path(vocal_filename, processed=use_processed))

        # Fallback: if the file isn't in the processed dir, try the raw one.
        # Only applies to upload-sourced input — a run output lives elsewhere entirely.
        if not source_run_id and input_path and not os.path.exists(input_path):
            fallback_name = None
            if file_id:
                base_name = get_upload_base_name(file_id)
                if base_name:
                    fallback_name = f"{base_name}_vocals.wav"
            if not fallback_name:
                vocal_filename = track.get("vocal", "").split("/").pop().split("\\").pop()
                fallback_name = vocal_filename
            alt_path = str(paths.get_vocal_file_path(fallback_name, processed=not use_processed))
            if os.path.exists(alt_path):
                input_path = alt_path
                print(f"[Inference] Using {'raw' if not use_processed else 'processed'} vocals: {input_path}")

        # Create output directory
        run_dir = paths.INFERENCE_RUNS_DIR / run_id
        run_dir.mkdir(exist_ok=True, parents=True)
        logging.info(f"Starting inference run {run_id}")
        logging.info(f"Track payload: {track}")
        # Generate output filename
        output_filename = "inferred.wav"
        output_path = str(run_dir / output_filename)

        # Update status
        active_jobs[job_id].update(
            {
                "status": "processing",
                "progress": 20,
                "logs": active_jobs[job_id].get("logs", []) + ["Starting inference process..."],
            }
        )

        # Set up the inference parameters
        inference_params = {
            "pitch": params.get("pitch", 0),
            "index_rate": params.get("indexRate", 0.5),
            "volume_envelope": params.get("volumeEnvelope", True),
            "protect": params.get("protectVoiced", 0.5),
            "f0_method": params.get("f0Method", "rmvpe"),
            "input_path": input_path,
            "output_path": output_path,
            "pth_path": model_path,
            "index_path": index_path if index_path and os.path.exists(index_path) else "",
            "split_audio": False,
            "f0_autotune": False,
            "f0_autotune_strength": 1.0,
            "proposed_pitch": False,
            "proposed_pitch_threshold": 0.1,
            "clean_audio": False,
            "clean_strength": 0.5,
            "export_format": "WAV",
            "embedder_model": "contentvec",
            "embedder_model_custom": None,
        }

        # Call the inference script (catch FFmpeg errors)
        try:
            active_jobs[job_id].update(
                {
                    "status": "processing",
                    "progress": 50,
                    "logs": active_jobs[job_id].get("logs", []) + ["Running inference..."],
                }
            )
            if run_infer_script is None:
                raise RuntimeError("applio is not installed. Run setup.bat first.")
            result = run_infer_script(**inference_params)
        except RuntimeError as e:
            if "FFmpeg" in str(e) or "torio" in str(e):
                active_jobs[job_id].update(
                    {
                        "status": "processing",
                        "progress": 50,
                        "logs": active_jobs[job_id].get("logs", [])
                        + ["FFmpeg warning ignored, continuing with inference..."],
                    }
                )
                # Try again with warnings suppressed
                result = run_infer_script(**inference_params)
            else:
                raise e

        # run_infer_script returns a tuple (message, output_file)
        if result and len(result) == 2:
            message, output_file_path = result
            # Check if output file was actually created
            if os.path.exists(output_file_path):
                file_record = get_upload_metadata(file_id) if file_id else None
                model_name = model.get("name") or model.get("modelName")
                model_id = model.get("id") or model.get("modelId") or model.get("model_id") or model_name
                checkpoint_epoch = selected_checkpoint.get("epochs") or selected_checkpoint.get("epoch")
                if isinstance(checkpoint_epoch, str):
                    try:
                        checkpoint_epoch = int(checkpoint_epoch)
                    except ValueError:
                        checkpoint_epoch = None
                elif isinstance(checkpoint_epoch, (int, float)):
                    checkpoint_epoch = int(checkpoint_epoch)
                else:
                    checkpoint_epoch = None
                checkpoint_filename = selected_checkpoint.get("filename") or selected_checkpoint.get("pthFile")
                if checkpoint_filename:
                    checkpoint_filename = Path(checkpoint_filename).name
                else:
                    checkpoint_path = selected_checkpoint.get("path") or model_path
                    checkpoint_filename = Path(checkpoint_path).name if checkpoint_path else None
                checkpoint_id = selected_checkpoint.get("checkpointId") or selected_checkpoint.get("id")
                if not checkpoint_id and checkpoint_filename:
                    checkpoint_id = Path(checkpoint_filename).stem
                index_file = Path(index_path).name if index_path else None
                model_checkpoint = {
                    "epoch": checkpoint_epoch,
                    "checkpointId": checkpoint_id,
                    "pthFile": checkpoint_filename,
                    "indexFile": index_file,
                }
                if not any(model_checkpoint.values()):
                    model_checkpoint = None
                run_payload = {
                    "id": run_id,
                    "runId": run_id,
                    "modelName": model_name,
                    "modelId": model_id,
                    "modelCheckpoint": model_checkpoint,
                    "reaction": "none",
                    # inputFileId stays the root upload even when layering, so the
                    # instrumental and display names keep resolving. sourceRunId is
                    # what records the layer this run was stacked on.
                    "inputFileId": file_id,
                    "sourceRunId": source_run_id,
                    "inputStoredName": file_record.get("storedName") if file_record else None,
                    "inputOriginalName": file_record.get("originalName") if file_record else None,
                    "inputDisplayName": file_record.get("safeDisplayName") if file_record else None,
                    "outputFileName": output_filename,
                    "outputUrl": f"/api/download/inference/{run_id}",
                    "params": params,
                    "vocalFileType": vocals_file_type
                    or ("processed_vocals" if use_processed else "raw_vocals"),
                    "createdAt": datetime.now().isoformat(),
                }
                save_inference_run_metadata(run_id, run_payload)
                active_jobs[job_id].update(
                    {
                        "status": "completed",
                        "progress": 100,
                        "logs": active_jobs[job_id].get("logs", []) + ["Inference completed successfully!"],
                        "outputFile": output_filename,
                        "runId": run_id,
                        "outputUrl": run_payload["outputUrl"],
                    }
                )
            else:
                active_jobs[job_id].update(
                    {
                        "status": "failed",
                        "error": "Output file not created",
                        "logs": active_jobs[job_id].get("logs", [])
                        + ["Inference failed: Output file not created"],
                    }
                )
        else:
            error_msg = "Inference failed - invalid result format"
            active_jobs[job_id].update(
                {
                    "status": "failed",
                    "error": error_msg,
                    "logs": active_jobs[job_id].get("logs", []) + [f"Inference failed: {error_msg}"],
                }
            )

    except Exception as e:
        logging.error(f"Error in inference job {job_id}: {e}")
        import traceback

        logging.error(f"Traceback: {traceback.format_exc()}")
        active_jobs[job_id].update(
            {
                "status": "failed",
                "error": str(e),
                "logs": active_jobs[job_id].get("logs", []) + [f"Inference error: {str(e)}"],
            }
        )
    except BaseException as e:
        # Catch system-level exceptions that might crash the process
        logging.critical(f"Critical error in inference job {job_id}: {e}")
        import traceback

        logging.critical(f"Critical traceback: {traceback.format_exc()}")
        try:
            job = active_jobs.get(job_id)
            if job:
                job["status"] = "failed"
                job["error"] = f"Critical error: {str(e)}"
                job["logs"].append(f"Critical inference error: {str(e)}")
        except Exception:
            pass  # Don't let cleanup crash the app
