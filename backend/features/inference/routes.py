import json
import logging
import os
import shutil
import uuid
import urllib.parse

from flask import Blueprint, jsonify, request, send_file
from werkzeug.utils import secure_filename

from backend.features.inference.service import run_infer_script, start_inference_job
from backend.jobs.registry import active_jobs
from backend.paths.manager import paths
from backend.storage.inference_runs import ALLOWED_RUN_REACTIONS, list_inference_runs, load_inference_run_metadata, save_inference_run_metadata

bp = Blueprint("inference", __name__)


def _public_run(run: dict) -> dict:
    """A run as the browser should see it.

    `instrumentalPath` is an absolute path on this machine; the client has no
    use for it and no business knowing it. What it needs is whether the file is
    still there — which is also the honest answer after the source song has
    been deleted out from under the run.
    """
    from backend.routes.download import resolve_run_asset

    public = dict(run)
    public.pop("instrumentalPath", None)
    run_id = run.get("runId") or run.get("id")
    public["hasInstrumental"] = bool(run_id and resolve_run_asset(run_id, "instrumental"))
    # What it re-sang, with its audio: the library offers both sides, the
    # original that went into the model and the take that came out.
    from backend.features.track_sources import resolve_source

    ref = None
    if run.get("songJobId"):
        ref = f"songgen:{run['songJobId']}"
    elif run.get("sourceRunId"):
        ref = f"run:{run['sourceRunId']}"
    elif run.get("inputFileId"):
        ref = f"upload:{run['inputFileId']}"
    public["source"] = resolve_source(ref) if ref else None

    # A conversion wears the cover of whatever it re-sang: same song, other
    # voice. None when the source has no cover, which is then a gradient.
    try:
        from backend.features.cover_art.routes import run_cover_url

        public["coverUrl"] = run_cover_url(run)
    except Exception:
        public["coverUrl"] = None
    # A real remix, not the vocal the mix endpoint falls back to.
    public["hasMix"] = bool(
        run_id
        and run.get("mixFileName")
        and (paths.INFERENCE_RUNS_DIR / run_id / run["mixFileName"]).exists()
    )
    return public


@bp.route("/api/start-inference", methods=["POST"])
def start_inference():
    """Start an inference job for a track"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided"}), 400

        model = data.get("model")  # Now expecting full model object
        track = data.get("track")
        params = data.get("params", {})

        # Debug logging
        logging.info(f"Received inference request - Model: {model.get('name') if model else 'None'}")
        logging.info(f"Full track data: {json.dumps(track, indent=2) if track else 'None'}")
        logging.info(f"Track type: {type(track)}")
        logging.info(f"Track keys: {list(track.keys()) if track and isinstance(track, dict) else 'Not a dict'}")
        logging.info(f"Track vocal: {track.get('vocal') if track else 'None'}")
        logging.info(f"Track instrumental: {track.get('instrumental') if track else 'None'}")

        if not model or not track:
            return jsonify({"error": "Model and track are required"}), 400

        job_id, run_id = start_inference_job(model, track, params)
        return jsonify({"jobId": job_id, "runId": run_id})

    except Exception as e:
        logging.error(f"Error starting inference: {e}")
        return jsonify({"error": str(e)}), 500


_INFERENCE_TERMINAL = {"completed", "failed", "error", "cancelled"}


@bp.route("/api/inference-jobs", methods=["GET"])
def list_active_inference_jobs():
    """Conversions still running — what a fresh page load needs to rebuild the
    placeholder row a conversion shows before it has landed as a real one.

    `active_jobs` is shared with every other job kind (training, diarisation,
    song generation's own RVC step), so this only surfaces the ones this
    endpoint's own start_inference_job put there, and only while they are
    still going: a page loaded after the job finished should see it as the
    real row it became, not a placeholder for a job that is already over.
    """
    jobs = []
    for job in active_jobs.values():
        if job.get("type") != "inference":
            continue
        # Song generation's own RVC step registers here too, under the exact
        # same shape, to get the same status polling this endpoint's own
        # jobs use — it is not one of this endpoint's own jobs, and the song
        # generating it already has a visible row of its own. Without this,
        # a hum (or cover, or plain) generation with a voice attached showed
        # a second, redundant "Converting" placeholder for the same voice —
        # and if that internal step ever got stuck instead of reaching a
        # terminal status, this list never emptied, so the library kept
        # polling every few seconds forever.
        if job.get("internal"):
            continue
        if job.get("status") in _INFERENCE_TERMINAL:
            continue
        track = job.get("track") or {}
        jobs.append(
            {
                "id": job.get("id"),
                "status": job.get("status"),
                "progress": job.get("progress", 0),
                "modelName": job.get("model_name"),
                "trackId": track.get("songJobId") or track.get("fileId"),
                "trackTitle": track.get("name"),
            }
        )
    return jsonify({"jobs": jobs})


@bp.route("/api/inference-status/<job_id>", methods=["GET"])
def inference_status(job_id):
    """Get the status of an inference job"""
    # First check in-memory jobs
    if job_id in active_jobs:
        job = active_jobs[job_id]

        # Check if there's an updated status file from the worker process
        status_file = f"job_status_{job_id}.json"
        if os.path.exists(status_file):
            try:
                with open(status_file, "r") as f:
                    worker_status = json.load(f)

                # Update in-memory job with worker status
                job.update(
                    {
                        "status": worker_status.get("status", job.get("status")),
                        "progress": worker_status.get("progress", job.get("progress", 0)),
                        "error": worker_status.get("error", job.get("error")),
                        "logs": worker_status.get("logs", job.get("logs", [])),
                        "outputFile": worker_status.get("output_file", job.get("outputFile")),
                    }
                )

                # Clean up status file if job is complete
                if worker_status.get("status") in ["completed", "failed"]:
                    try:
                        os.unlink(status_file)
                    except Exception:
                        pass

            except Exception:
                # If we can't read the status file, continue with in-memory data
                pass

        # Return job data
        return jsonify(
            {
                "id": job["id"],
                "type": job["type"],
                "model_name": job["model_name"],
                "track": job["track"],
                "status": job["status"],
                "progress": job["progress"],
                "logs": job["logs"],
                "started_at": job["started_at"],
                "completed_at": job.get("completed_at"),
                "error": job.get("error"),
                "outputFile": job.get("outputFile"),
                "runId": job.get("runId") or job.get("run_id"),
                "outputUrl": job.get("outputUrl"),
            }
        )

    # Check if there's a status file for a completed job
    status_file = f"job_status_{job_id}.json"
    if os.path.exists(status_file):
        try:
            with open(status_file, "r") as f:
                job_data = json.load(f)

            # Create temporary job entry for completed job
            temp_job = {
                "id": job_id,
                "type": "inference",
                "status": job_data.get("status", "unknown"),
                "progress": job_data.get("progress", 0),
                "logs": job_data.get("logs", []),
                "error": job_data.get("error"),
                "outputFile": job_data.get("output_file"),
            }

            return jsonify(temp_job)

        except Exception as e:
            return jsonify({"error": f"Failed to read job status: {str(e)}"}), 500

    return jsonify({"error": "Job not found"}), 404


@bp.route("/api/past-inference-results", methods=["GET"])
def get_past_inference_results():
    """Get list of past inference results by scanning inference directory"""
    try:
        results = list_inference_runs()
        results.sort(key=lambda x: x.get("createdAt", ""), reverse=True)
        return jsonify({"results": [_public_run(run) for run in results]})

    except Exception as e:
        logging.error(f"Error getting past inference results: {e}")
        import traceback

        logging.info(traceback.format_exc())
        return jsonify({"error": f"Failed to get results: {str(e)}"}), 500


@bp.route("/api/delete-inference-runs", methods=["POST"])
def delete_inference_runs():
    try:
        data = request.get_json(silent=True) or {}
        run_ids = (
            data.get("runIds")
            or data.get("run_ids")
            or data.get("runs")
            or data.get("ids")
        )
        if run_ids is None:
            return jsonify({"error": "No runIds provided"}), 400
        if not isinstance(run_ids, list):
            return jsonify({"error": "runIds must be a list"}), 400

        results = []
        total_deleted = 0
        total_failed = 0
        base_runs_dir = paths.INFERENCE_RUNS_DIR.resolve()
        base_legacy_dir = paths.INFERENCE_DIR.resolve()

        for raw in run_ids:
            run_id = urllib.parse.unquote(str(raw))
            deleted = []
            failed = []

            run_dir = (paths.INFERENCE_RUNS_DIR / run_id).resolve()
            if base_runs_dir in run_dir.parents or run_dir == base_runs_dir:
                if run_dir.exists() and run_dir.is_dir():
                    try:
                        shutil.rmtree(run_dir)
                        deleted.append(f"run:{run_id}")
                    except Exception as e:
                        failed.append(f"Failed to delete run dir: {e}")
            else:
                failed.append("Invalid runId path")

            legacy_path = paths.get_inference_file_path(run_id).resolve()
            if base_legacy_dir in legacy_path.parents or legacy_path == base_legacy_dir:
                if legacy_path.exists() and legacy_path.is_file():
                    try:
                        legacy_path.unlink(missing_ok=True)
                        deleted.append(f"legacy:{legacy_path.name}")
                    except Exception as e:
                        failed.append(f"Failed to delete legacy file: {e}")
            else:
                failed.append("Invalid legacy path")

            if not deleted and not failed:
                failed.append("Run not found")

            results.append({"runId": run_id, "deleted": deleted, "failed": failed})
            if deleted:
                total_deleted += 1
            total_failed += len(failed)

        return jsonify(
            {
                "message": f"Processed {len(run_ids)} runs",
                "results": results,
                "total_deleted": total_deleted,
                "total_failed": total_failed,
            }
        )

    except Exception as e:
        logging.error(f"Error deleting inference runs: {e}")
        return jsonify({"error": str(e)}), 500


@bp.route("/api/runs/<path:run_id>/reaction", methods=["PATCH"])
def update_run_reaction(run_id):
    data = request.get_json(silent=True) or {}
    reaction = data.get("reaction")
    if reaction not in ALLOWED_RUN_REACTIONS:
        return jsonify({"error": "Invalid reaction"}), 400

    import urllib.parse

    run_id = urllib.parse.unquote(run_id)
    run_meta = load_inference_run_metadata(run_id)
    if not run_meta:
        return jsonify({"error": "Run not found"}), 404

    run_meta.pop("isFavorite", None)
    run_meta["reaction"] = reaction
    save_inference_run_metadata(run_id, run_meta)
    return jsonify(run_meta)


@bp.route("/api/process-audio", methods=["POST"])
def process_audio():
    try:
        if "audio" not in request.files:
            return jsonify({"error": "No audio file provided"}), 400
        f = request.files["audio"]
        if not f.filename:
            return jsonify({"error": "Empty filename"}), 400

        pid = str(uuid.uuid4())
        tmp = paths.TEMP_WAV_DIR / f"process_{pid}"
        tmp.mkdir(parents=True, exist_ok=True)
        in_path = str(tmp / secure_filename(f.filename))
        f.save(in_path)

        form = request.form
        export_format = form.get("exportFormat", "wav")
        out_path = str(tmp / f"output_{pid}.wav")

        # typed form helpers
        b = lambda k, d=False: form.get(k, str(d)).lower() == "true"
        i = lambda k, d=0: int(form.get(k, d))
        fl = lambda k, d=0.0: float(form.get(k, d))
        s = lambda k, d="": form.get(k, d)

        result_message, output_file = run_infer_script(
            pitch=i("pitch", 0),
            filter_radius=i("filterRadius", 3),
            index_rate=fl("indexRate", 0.75),
            volume_envelope=i("volumeEnvelope", 1),
            protect=fl("protect", 0.33),
            hop_length=i("hopLength", 128),
            f0_method=s("f0Method", "rmvpe"),
            input_path=in_path,
            output_path=out_path,
            pth_path=s("modelPath", ""),
            index_path=s("indexPath", ""),
            split_audio=b("splitAudio", True),
            f0_autotune=b("f0Autotune", False),
            f0_autotune_strength=fl("f0AutotuneStrength", 0.5),
            clean_audio=b("cleanAudio", False),
            clean_strength=fl("cleanStrength", 0.5),
            export_format=export_format,
            f0_file=s("f0File", ""),
            embedder_model=s("embedderModel", "hubert_base"),
            embedder_model_custom=form.get("embedderModelCustom", None),
            formant_shifting=b("formantShifting", False),
            formant_qfrency=fl("formantQfrency", 1.0),
            formant_timbre=fl("formantTimbre", 1.0),
            post_process=b("postProcess", False),
            reverb=b("reverb"),
            pitch_shift=b("pitchShift"),
            limiter=b("limiter"),
            gain=b("gain"),
            distortion=b("distortion"),
            chorus=b("chorus"),
            bitcrush=b("bitcrush"),
            clipping=b("clipping"),
            compressor=b("compressor"),
            delay=b("delay"),
            reverb_room_size=fl("reverbRoomSize", 0.5),
            reverb_damping=fl("reverbDamping", 0.5),
            reverb_wet_gain=fl("reverbWetGain", 0.5),
            reverb_dry_gain=fl("reverbDryGain", 0.5),
            reverb_width=fl("reverbWidth", 0.5),
            reverb_freeze_mode=fl("reverbFreezeMode", 0.5),
            pitch_shift_semitones=fl("pitchShiftSemitones", 0.0),
            limiter_threshold=fl("limiterThreshold", -6),
            limiter_release_time=fl("limiterReleaseTime", 0.01),
            gain_db=fl("gainDb", 0.0),
            distortion_gain=fl("distortionGain", 25),
            chorus_rate=fl("chorusRate", 1.0),
            chorus_depth=fl("chorusDepth", 0.25),
            chorus_center_delay=fl("chorusCenterDelay", 7),
            chorus_feedback=fl("chorusFeedback", 0.0),
            chorus_mix=fl("chorusMix", 0.5),
            bitcrush_bit_depth=i("bitcrushBitDepth", 8),
            clipping_threshold=fl("clippingThreshold", -6),
            compressor_threshold=fl("compressorThreshold", 0),
            compressor_ratio=fl("compressorRatio", 1),
            compressor_attack=fl("compressorAttack", 1.0),
            compressor_release=fl("compressorRelease", 100),
            delay_seconds=fl("delaySeconds", 0.5),
            delay_feedback=fl("delayFeedback", 0.0),
            delay_mix=fl("delayMix", 0.5),
            sid=i("sid", 0),
        )

        if not os.path.exists(output_file):
            return jsonify({"error": "Failed to generate output file"}), 500

        return jsonify(
            {
                "message": result_message,
                "outputUrl": f"/api/audio-results/{pid}/output.{export_format}",
                "processId": pid,
            }
        )
    except Exception as e:
        logging.getLogger(__name__).error(f"Error processing audio: {e}")
        import traceback

        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@bp.route("/api/audio-results/<process_id>/output.<format>")
def get_audio_result(process_id, format):
    try:
        d = paths.TEMP_WAV_DIR / f"process_{process_id}"
        f = next((x for x in d.iterdir() if x.name.startswith("output_") and x.suffix == f".{format}"), None)
        if not f:
            return jsonify({"error": f"No output file found in format {format}"}), 404
        return send_file(f, mimetype=f"audio/{format}", as_attachment=False, download_name=f"converted_output.{format}")
    except Exception as e:
        logging.getLogger(__name__).error(f"Error getting audio result: {e}")
        import traceback

        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
