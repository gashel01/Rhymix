"""Persistent YuE2 worker - runs inside WanGP's virtualenv, not Rhymix's.

Rhymix drives every engine the same way: a subprocess in its own venv, spoken to
over a line protocol on stdin/stdout.  This file is the YuE2 end of that pipe.

Unlike `ace_step.py`, the worker script is a real file rather than a string
built at runtime.  It can afford to be, because everything it needs arrives as
JSON on stdin instead of being interpolated into source.  It also means this
file is readable and greppable like any other.

The `print()` calls below are the IPC protocol, not debug noise - same
convention as `ace_step.py`.

Protocol
--------
    <- WORKER_READY                       once the WanGP session is live
    -> {"job_id", "settings", "output_path", "score_dir"}    one JSON per line
    -> {"warmup": true}
    <- PROGRESS:<pct>:<message>
    <- RESULT:<json>                      artefact paths for the job
    <- JOB_END:<job_id>:SUCCESS
    <- JOB_END:<job_id>:ERROR:<message>
    <- WARMUP_OK | WARMUP_ERROR:<message>
"""

import json
import os
import shutil
import sys
import traceback
from pathlib import Path

# Must match the parent's Popen(encoding="utf-8") in yue2.py — this worker
# runs under WanGP's own venv/console defaults, which on Windows is cp1252
# ("charmap") unless told otherwise, and lyrics routinely carry characters
# that codec can't hold.
if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True, encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(line_buffering=True, encoding="utf-8")


def _print(message):
    print(message)
    sys.stdout.flush()


def _fail(job_id, message):
    _print(f"JOB_END:{job_id}:ERROR:{message}")


WANGP_DIR = os.environ.get("WANGP_DIR", "").strip()
# Attention stays sdpa: YuE2 ignores WanGP's global attention mode entirely and
# picks its kernels from lm_decoder_engine instead (see pipeline.py:64).
WANGP_ATTENTION = os.environ.get("WANGP_ATTENTION", "sdpa").strip()
WANGP_PROFILE = os.environ.get("WANGP_AUDIO_PROFILE", "3").strip()

_session = None


def _get_session():
    """Create the WanGP session once and keep the model resident."""
    global _session
    if _session is not None:
        return _session
    if not WANGP_DIR or not Path(WANGP_DIR).is_dir():
        raise RuntimeError(f"WANGP_DIR is not a directory: {WANGP_DIR!r}")

    sys.path.insert(0, WANGP_DIR)
    os.chdir(WANGP_DIR)

    from shared.api import init

    _session = init(
        root=Path(WANGP_DIR),
        cli_args=["--attention", WANGP_ATTENTION, "--profile", WANGP_PROFILE],
    )
    return _session


def _pct_from_progress(data):
    """Map a WanGP progress event onto 10..90, leaving room either side."""
    try:
        current = getattr(data, "current_step", None)
        total = getattr(data, "total_steps", None)
        if current is not None and total:
            return 10 + int(min(1.0, float(current) / float(total)) * 80)
        fraction = getattr(data, "progress", None)
        if fraction is not None:
            fraction = float(fraction)
            if fraction > 1.0:
                fraction = fraction / 100.0
            return 10 + int(max(0.0, min(1.0, fraction)) * 80)
    except Exception:
        pass
    return None


SIDE_FILE_KEYS = {".abc": "score_abc", ".mid": "score_midi"}


def _collect_side_files(result, score_dir):
    """Write out the ABC / MIDI composition that `save_score` produced.

    These do NOT land on disk next to the audio when driving WanGP through its
    API - `GeneratedArtifact.side_files` hands them back as bytes in memory
    (the handler docs say so: "API artifacts return these side files in
    memory"). Looking for files beside the wav finds nothing, silently, which
    is exactly how the first integration run lost every score it generated.

    Persisting them is what makes the composition reusable later as a
    `custom_guide` - the whole point of preferring YuE2.
    """
    artefacts = {}
    if not score_dir:
        return artefacts
    target_dir = Path(score_dir)

    for artifact in getattr(result, "artifacts", None) or ():
        side_files = getattr(artifact, "side_files", None) or {}
        # Keyed by FILENAME, not by suffix: process_side_files() names each one
        # after the media file it accompanies ("<song stem>.abc"). Looking up
        # ".abc" directly finds nothing, which is how the score went missing on
        # the first two runs.
        for filename, blob in side_files.items():
            key = SIDE_FILE_KEYS.get(Path(str(filename)).suffix.lower())
            if not key or not blob:
                continue
            try:
                target_dir.mkdir(parents=True, exist_ok=True)
                destination = target_dir / f"score{Path(str(filename)).suffix.lower()}"
                destination.write_bytes(blob if isinstance(blob, (bytes, bytearray)) else str(blob).encode("utf-8"))
                artefacts[key] = str(destination)
            except Exception as exc:
                _print(f"ERROR:could not write {filename}: {exc}")
    return artefacts


def _run_job(payload):
    job_id = str(payload.get("job_id") or "job")
    settings = payload.get("settings") or {}
    output_path = payload.get("output_path")
    score_dir = payload.get("score_dir")

    session = _get_session()
    _print("PROGRESS:5:Submitting to YuE2...")

    job = session.submit_task(settings)

    last_pct = 5
    for event in job.events.iter(timeout=0.2):
        kind = getattr(event, "kind", None)
        if kind == "progress":
            pct = _pct_from_progress(event.data)
            phase = getattr(event.data, "phase", "") or "Generating"
            if pct is not None and pct > last_pct:
                last_pct = pct
                _print(f"PROGRESS:{pct}:{phase}")
        elif kind == "stream":
            line = getattr(event.data, "text", "")
            text = str(line).strip()
            if not text:
                continue
            # Surface the two conditions that silently degrade a result.
            if "reached its token limit" in text:
                _print("ERROR:Output was truncated - shorten the lyrics or raise the duration.")
            elif "Maximum audio duration limited by context" in text:
                _print(f"ERROR:{text}")

    result = job.result()
    if not getattr(result, "success", False):
        messages = []
        for error in getattr(result, "errors", None) or []:
            messages.append(str(getattr(error, "message", error)))
        raise RuntimeError("; ".join(messages) or "YuE2 generation failed")

    generated = [str(f) for f in (getattr(result, "generated_files", None) or [])]
    audio_files = [f for f in generated if Path(f).suffix.lower() in {".wav", ".flac", ".mp3", ".m4a"}]
    if not audio_files:
        raise RuntimeError("YuE2 produced no audio file")

    source_audio = audio_files[0]
    artefacts = {"source": source_audio}

    if output_path:
        target = Path(output_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_audio, target)
        artefacts["audio"] = str(target)

    artefacts.update(_collect_side_files(result, score_dir))
    if score_dir and settings.get("custom_settings", {}).get("save_score") and "score_abc" not in artefacts:
        # Asking for a score and getting none is worth saying out loud: it means
        # the rewrite-lyrics loop will not be available for this song.
        _print("ERROR:Save Score was requested but YuE2 returned no composition.")

    _print(f"RESULT:{json.dumps(artefacts)}")
    _print("PROGRESS:95:Finalizing...")
    _print(f"JOB_END:{job_id}:SUCCESS")


def main():
    try:
        _get_session()
    except Exception as exc:
        _print(f"WARMUP_ERROR:{exc}")
        _print(f"ERROR:{traceback.format_exc()}")
        return 1

    _print("WORKER_READY")

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as exc:
            _print(f"ERROR:bad request: {exc}")
            continue

        if payload.get("warmup"):
            _print("WARMUP_OK")
            continue

        job_id = str(payload.get("job_id") or "job")
        try:
            _run_job(payload)
        except Exception as exc:
            _print(f"ERROR:{traceback.format_exc()}")
            _fail(job_id, str(exc).replace("\n", " ")[:500])

    return 0


if __name__ == "__main__":
    sys.exit(main())
