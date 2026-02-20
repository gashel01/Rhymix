import os
import threading

from flask import Flask
from flask_cors import CORS

from app.utils.file_handling import FileHandler  # noqa: F401
from app.utils.audio_processor import AudioProcessor  # noqa: F401
from app.config import Config  # noqa: F401

from backend.logging_setup import configure_logging
from backend.paths.manager import paths


def create_app():
    app = Flask(__name__, static_folder="frontend/build", static_url_path="")
    CORS(app)

    configure_logging()
    paths.ensure_directories_exist()

    # Register routes
    from backend.routes.upload import bp as upload_bp
    from backend.routes.download import bp as download_bp
    from backend.routes.models import bp as models_bp
    from backend.routes.maintenance import bp as maintenance_bp
    from backend.routes.training import bp as training_bp

    from backend.features.processing.routes import bp as processing_bp
    from backend.features.inference.routes import bp as inference_bp
    from backend.features.song_generation.routes import bp as song_generation_bp
    from backend.features.diarization.routes import bp as diarization_bp
    from backend.features.studio.routes import bp as studio_bp
    from backend.features.beatbox_wizard.routes import bp as beatbox_wizard_bp

    # Order: specific APIs first, catch-all frontend last
    app.register_blueprint(upload_bp)
    app.register_blueprint(download_bp)
    app.register_blueprint(models_bp)
    app.register_blueprint(maintenance_bp)
    app.register_blueprint(training_bp)
    app.register_blueprint(processing_bp)
    app.register_blueprint(inference_bp)
    app.register_blueprint(song_generation_bp)
    app.register_blueprint(diarization_bp)
    app.register_blueprint(studio_bp)
    app.register_blueprint(beatbox_wizard_bp)

    from backend.routes.base import bp as base_bp

    app.register_blueprint(base_bp)

    if os.getenv("RHYMIX_WARMUP_ON_STARTUP", "").lower() in {"1", "true", "yes", "y", "on"}:
        from backend.routes.maintenance import warmup_models

        threading.Thread(target=warmup_models, daemon=True).start()

    return app
