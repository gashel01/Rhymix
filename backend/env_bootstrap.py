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

    # Ensure applio and rvc are on the path
    applio_path = os.path.abspath("applio")
    if applio_path not in sys.path:
        sys.path.append(applio_path)
    rvc_path = os.path.join(applio_path, "rvc")
    if rvc_path not in sys.path:
        sys.path.append(rvc_path)
