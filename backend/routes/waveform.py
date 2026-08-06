"""Precomputed waveform peaks.

The browser used to draw waveforms by downloading each WAV in full — twenty
~30 MB files on a single page load, which saturated the dev proxy and left most
waveforms blank. Peaks are computed here once, cached on disk, and served as a
few KB of JSON instead.
"""

import hashlib
import json
import logging

import soundfile as sf
from flask import Blueprint, jsonify

from backend.paths.manager import paths
from backend.routes.download import resolve_inference_path, resolve_media_path

bp = Blueprint("waveform", __name__)
logger = logging.getLogger(__name__)

# min/max pairs per waveform. 800 pairs is well past the pixel width of any
# lane in the UI, so the result is indistinguishable from the full signal.
BUCKETS = 800


def _cache_key(path):
    stat = path.stat()
    raw = f"{path.resolve()}|{stat.st_mtime_ns}|{stat.st_size}|{BUCKETS}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _compute_peaks(path):
    """Return ([min, max, min, max, ...], duration_seconds).

    Read in blocks so memory stays flat however long the file is.
    """
    with sf.SoundFile(str(path)) as handle:
        frames = len(handle)
        samplerate = handle.samplerate or 1
        duration = frames / float(samplerate)

        if frames <= 0:
            return [], 0.0

        blocksize = max(1, frames // BUCKETS)
        peaks = []
        for block in handle.blocks(blocksize=blocksize, dtype="float32", always_2d=True):
            if block.size == 0:
                continue
            mono = block.mean(axis=1)
            peaks.append(round(float(mono.min()), 4))
            peaks.append(round(float(mono.max()), 4))

    return peaks, duration


def _peaks_payload(path):
    cache_file = paths.WAVEFORM_CACHE_DIR / f"{_cache_key(path)}.json"

    if cache_file.exists():
        try:
            return json.loads(cache_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            logger.warning("Discarding unreadable peaks cache %s", cache_file)

    peaks, duration = _compute_peaks(path)
    payload = {"peaks": [peaks], "duration": duration}

    try:
        paths.WAVEFORM_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps(payload), encoding="utf-8")
    except OSError:
        logger.warning("Could not write peaks cache %s", cache_file, exc_info=True)

    return payload


@bp.route("/api/waveform/inference/<path:run_id>")
def waveform_inference(run_id):
    try:
        file_path = resolve_inference_path(run_id)
        if file_path is None:
            return jsonify({"error": "File not found"}), 404
        return jsonify(_peaks_payload(file_path))
    except Exception:
        logger.exception("Error computing inference peaks for %s", run_id)
        return jsonify({"error": "Could not compute waveform"}), 500


@bp.route("/api/waveform/<file_type>/<path:filename>")
def waveform_file(file_type, filename):
    try:
        file_path, error = resolve_media_path(file_type, filename)
        if error:
            payload, status = error
            return jsonify(payload), status
        return jsonify(_peaks_payload(file_path))
    except Exception:
        logger.exception("Error computing peaks for %s/%s", file_type, filename)
        return jsonify({"error": "Could not compute waveform"}), 500
