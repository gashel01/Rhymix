import threading
import time
import uuid

from flask import Blueprint, jsonify, request

from backend.features.processing.service import (
    _collect_processing_file_ids,
    process_audio_files_thread,
)
from backend.jobs.registry import active_jobs
from backend.storage.metadata import update_track_processing

bp = Blueprint("processing", __name__)


@bp.route("/api/process", methods=["POST"])
def process_files():
    d = request.json or {}
    cfg = {k: d.get(k, v) for k, v in {"segment": False, "process": True, "export": False, "clean": False}.items()}
    cfg["export"] = False
    # When client sends fileIds, only process those (e.g. the batch just uploaded). Otherwise process all.
    requested_ids = d.get("fileIds")
    file_ids = requested_ids if requested_ids is not None else _collect_processing_file_ids()

    job_id = str(uuid.uuid4())
    active_jobs[job_id] = {
        "id": job_id,
        "status": "starting",
        "progress": 0,
        "config": cfg,
        "started_at": time.time(),
        "fileIds": file_ids,
    }
    for fid in file_ids or []:
        update_track_processing(
            fid,
            state="queued",
            step="queued",
            message="Queued for processing",
            progress=0,
        )

    time.sleep(1.0)
    threading.Thread(target=process_audio_files_thread, args=(job_id, *cfg.values())).start()

    return jsonify({"job_id": job_id})
