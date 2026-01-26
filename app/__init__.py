from flask import Flask
from flask_cors import CORS
import logging
from pathlib import Path


def create_app():
    app = Flask(__name__, static_folder='../frontend/build', static_url_path='')
    
    # Configuration
    app.config.from_object('app.config.Config')
    
    # Enable CORS
    CORS(app)
    
    # Setup logging
    logging.basicConfig(
        level=logging.DEBUG,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler("flask_app.log"),
            logging.StreamHandler()
        ]
    )
    
    # Register blueprints
    from app.routes.audio import audio_bp
    from app.routes.diarization import diarization_bp
    from app.routes.jobs import jobs_bp
    
    app.register_blueprint(audio_bp)
    app.register_blueprint(diarization_bp)
    app.register_blueprint(jobs_bp)
    
    return app 