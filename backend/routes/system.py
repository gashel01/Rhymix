"""What the machine has left.

This app is built around one hard limit — 8 GB of VRAM, shared by a song
generator that wants 4.3 of them — so "how much is left" is not a curiosity
here, it is the thing that decides whether the next job runs. The rail shows it
permanently for that reason.

Everything is read fresh per request and nothing is cached: a number that is
thirty seconds stale is worse than no number, because it will be believed.
"""

import logging
import shutil

from flask import Blueprint, jsonify

from backend.paths.manager import paths

bp = Blueprint("system", __name__)
logger = logging.getLogger(__name__)


def _gpu() -> dict | None:
    """VRAM in use and total, or None when there is no CUDA device.

    `mem_get_info` reports the driver's view, which counts every process on the
    card — not just this one. That is the number that matters: the engine in
    WanGP's own venv is a different process, and its 4.3 GB are just as gone.
    """
    try:
        import torch

        if not torch.cuda.is_available():
            return None
        free, total = torch.cuda.mem_get_info()
        return {
            "name": torch.cuda.get_device_name(0),
            "usedBytes": total - free,
            "totalBytes": total,
        }
    except Exception:
        # A missing or broken CUDA install is not an error worth surfacing on
        # every poll; the rail simply shows nothing for the GPU.
        return None


@bp.route("/api/system")
def system_status():
    payload = {"gpu": _gpu(), "disk": None}
    try:
        usage = shutil.disk_usage(paths.BASE_DIR)
        payload["disk"] = {"freeBytes": usage.free, "totalBytes": usage.total}
    except Exception:
        logger.exception("Could not read disk usage")
    return jsonify(payload)
