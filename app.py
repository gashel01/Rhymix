import logging
import os

# Environment + logging suppression must run before any torch/torchaudio imports
from backend.env_bootstrap import bootstrap_env

bootstrap_env()

from backend.factory import create_app

app = create_app()


if __name__ == "__main__":
    debug_enabled = os.getenv("FLASK_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}
    app.run(debug=debug_enabled, host="0.0.0.0", port=5000)
