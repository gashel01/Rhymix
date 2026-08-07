import logging
import queue
import threading
import time

from clean_vocals import process_all, progress_queue

from backend.jobs.registry import active_jobs
from backend.paths.manager import paths
from backend.storage.metadata import (
    get_upload_metadata,
    list_upload_metadata,
    update_track_processing,
    _normalize_progress_value,
)


def collect_output_files(segment_audio, process_audio):
    return {
        "raw_vocals": [f.name for f in paths.UVR_RAW_DIR.glob("*_vocals.wav")],
        "processed_vocals": [f.name for f in paths.UVR_PROCESSED_DIR.glob("*_vocals.wav")] if process_audio else [],
    }


def _collect_processing_file_ids() -> list[str]:
    ids = []
    for record in list_upload_metadata():
        stored = record.get("storedName")
        file_id = record.get("fileId")
        if not stored or not file_id:
            continue
        if (paths.INPUT_DIR / stored).exists():
            ids.append(file_id)
    return ids


def _get_active_processing_job():
    candidates = []
    for job in active_jobs.values():
        cfg = job.get("config")
        if not isinstance(cfg, dict):
            continue
        if not all(k in cfg for k in ("segment", "process", "export", "clean")):
            continue
        status = job.get("status")
        if status in {"starting", "processing"}:
            candidates.append(job)
    if not candidates:
        return None
    return max(candidates, key=lambda j: j.get("started_at", 0))


def get_progress_events():
    events = []
    try:
        while True:
            events.append(progress_queue.get_nowait())
    except queue.Empty:
        return events


def process_audio_files_thread(job_id, segment, process, export, clean):
    job = active_jobs[job_id]
    job.update(status="processing", steps=[])
    ordered_file_ids = []

    def monitor():
        def handle_progress_event(p):
            if isinstance(p, dict):
                fp = p.get("file_progress", job.get("file_progress", 0))
                fp = int(fp * 100) if isinstance(fp, float) and 0 <= fp <= 1 else fp
                current_file = p.get("current_file", job.get("current_file", 0))
                total_files = p.get("total_files", job.get("total_files", 0))
                job.update(
                    progress=p.get("progress", job.get("progress", 0)),
                    file_progress=fp,
                    current_file=current_file,
                    total_files=total_files,
                    status_message=p.get("message", job.get("status_message", "")),
                )
                print(
                    f"Job progress: {job['progress']}%, File progress: {fp}%, File: {job['current_file']}/{job['total_files']}"
                )
                msg = p.get("message")
                if msg and (not job["steps"] or job["steps"][-1]["message"] != msg):
                    if p.get("file_progress") is not None and not str(msg).endswith("%"):
                        sp = int(p["file_progress"] * 100) if isinstance(p["file_progress"], float) else p[
                            "file_progress"
                        ]
                        msg = f"{msg} ({sp}%)"
                    job["steps"].append({"message": msg, "progress": fp, "time": time.time()})

                file_id = p.get("file_id")
                file_index = current_file
                if not file_id:
                    if isinstance(file_index, str) and file_index.isdigit():
                        file_index = int(file_index)
                    if isinstance(file_index, int) and 1 <= file_index <= len(ordered_file_ids):
                        file_id = ordered_file_ids[file_index - 1]
                if file_id:
                    message = p.get("message") or job.get("status_message") or "Processing..."
                    raw_progress = p.get("file_progress", p.get("progress", 0))
                    progress_pct = _normalize_progress_value(raw_progress)
                    normalized_message = str(message)
                    msg_lower = normalized_message.lower()
                    if normalized_message.startswith("[ERROR]"):
                        state = "error"
                    elif (
                        (progress_pct is not None and progress_pct >= 100)
                        or msg_lower.startswith("completed")
                        or msg_lower.startswith("processing complete")
                    ):
                        state = "ready"
                    else:
                        state = "processing"

                    update_track_processing(
                        file_id,
                        state=state,
                        step=state,
                        message=normalized_message,
                        progress=progress_pct,
                    )
            else:
                job["progress"] = p

        while job["status"] == "processing":
            events = get_progress_events()
            for p in events:
                handle_progress_event(p)
            time.sleep(0.5)

        # Drain any remaining progress updates after processing completes
        for p in get_progress_events():
            handle_progress_event(p)

    threading.Thread(target=monitor, daemon=True).start()

    try:
        file_ids = job.get("fileIds") or []
        seen = set()
        input_paths = []
        for fid in file_ids:
            rec = get_upload_metadata(fid)
            if not rec or not rec.get("storedName"):
                continue
            p = paths.INPUT_DIR / rec["storedName"]
            if p.exists() and p not in seen:
                seen.add(p)
                input_paths.append(p)
                ordered_file_ids.append(fid)

        if not ordered_file_ids:
            job.update(status="failed", error="No valid files to process", progress=0)
            return

        for fid in ordered_file_ids:
            update_track_processing(
                fid,
                state="queued",
                step="queued",
                message="Queued for processing",
                progress=0,
            )

        process_all(
            segment_audio=segment,
            process_audio=process,
            export_data=export,
            clean_after=False,
            input_files=input_paths,
        )

        job.update(
            status="completed",
            progress=100,
            completed_at=time.time(),
            output_files=collect_output_files(segment, process),
        )
    except Exception as e:
        job.update(status="failed", error=str(e), progress=0)
        for fid in ordered_file_ids:
            update_track_processing(
                fid,
                state="error",
                step="error",
                message=f"Processing failed: {e}",
                progress=0,
            )
        logging.error(f"Error in processing thread: {e}")
        import traceback

        traceback.print_exc()


__all__ = [
    "collect_output_files",
    "_collect_processing_file_ids",
    "_get_active_processing_job",
    "process_audio_files_thread",
]
