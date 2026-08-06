import logging
import os
import sys


def bootstrap_env():
    try:
        from dotenv import load_dotenv

        load_dotenv()
    except Exception:
        pass
    enable_logs = os.getenv("RHYMIX_ENABLE_LOGS", "").lower() in {"1", "true", "yes"}
    log_level = os.getenv("RHYMIX_LOG_LEVEL", "INFO").upper()
    # Disable FFmpeg requirement for torchaudio BEFORE any torch imports
    os.environ["TORIO_USE_FFMPEG"] = "0"
    # Alternative FFmpeg disable methods
    os.environ["TORCHAUDIO_USE_FFMPEG"] = "0"
    os.environ["FFMPEG_ROOT"] = ""
    # Fix OpenMP runtime conflicts
    os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
    # Reduce verbose logging
    os.environ["PYTHONWARNINGS"] = "ignore"
    # Reduce CUDA memory fragmentation on 8 GB VRAM cards (must be set before
    # torch is imported — the allocator reads this once at initialisation).
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

    if enable_logs:
        logging.basicConfig(level=log_level, format="%(levelname)s: %(message)s")
        logging.getLogger().setLevel(log_level)
    else:
        # Set root logger to CRITICAL to suppress all debug output
        logging.basicConfig(level=logging.CRITICAL, format="%(levelname)s: %(message)s")
        logging.getLogger().setLevel(logging.CRITICAL)

        # Suppress ALL debuggers that cause verbose output
        for logger_name in ["torio", "byteflow", "torch", "torchaudio", "applio", "rvc", "core"]:
            logger = logging.getLogger(logger_name)
            logger.setLevel(logging.CRITICAL)
            logger.disabled = True
            # Also disable any handlers
            for handler in logger.handlers:
                handler.setLevel(logging.CRITICAL)

    # Ensure applio and rvc are on the path.
    # Use __file__-relative paths so this works regardless of CWD.
    # backend/env_bootstrap.py  →  ../  →  project root
    _project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    applio_path = os.path.join(_project_root, "applio")

    # Order matters. The project root must come first so first-party packages
    # (app/, backend/, rvc/) always win a name clash — applio ships its own
    # top-level applio/app.py, which otherwise shadows our app/ package and
    # drags the whole Gradio UI into the import graph.
    if _project_root in sys.path:
        sys.path.remove(_project_root)
    sys.path.insert(0, _project_root)

    # applio/ only needs to be importable, never to win a clash → append.
    if applio_path in sys.path:
        sys.path.remove(applio_path)
    sys.path.append(applio_path)


def configure_cuda_backend() -> None:
    """Apply Ampere-specific CUDA performance flags.

    Call this once, *after* torch has been imported for the first time (e.g.
    at the top of any worker that loads a model).  Safe to call multiple times.

    Flags set:
    - allow_tf32 on matmul and cuDNN  → ~10–20 % free speedup on Ampere with
      no perceptible quality loss for audio tasks.
    - cudnn.benchmark = True          → auto-tunes conv kernels for fixed input
      shapes; pays back after the first few batches.
    """
    try:
        import torch
        if not torch.cuda.is_available():
            return
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        torch.backends.cudnn.benchmark = True
    except Exception:
        pass
