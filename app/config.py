import os
from pathlib import Path


class Config:
    # Base directory
    BASE_DIR = Path(__file__).parent.parent
    
    # Flask settings
    SECRET_KEY = os.getenv('FLASK_SECRET_KEY', 'dev-key')
    
    # Main data directories
    DATA_DIR = BASE_DIR / "data"
    UPLOADS_DIR = DATA_DIR / "uploads"
    ORIGINALS_DIR = DATA_DIR / "originals"
    
    # Singing voice separation directories
    SINGING_DIR = DATA_DIR / "singing"
    SINGING_UPLOADS_DIR = SINGING_DIR / "uploads"
    SINGING_TEMP_DIR = SINGING_DIR / "temp"
    SINGING_VOCALS_DIR = SINGING_DIR / "vocals"
    SINGING_VOCALS_RAW_DIR = SINGING_VOCALS_DIR / "raw"
    SINGING_VOCALS_PROCESSED_DIR = SINGING_VOCALS_DIR / "processed"
    SINGING_INSTRUMENTALS_DIR = SINGING_DIR / "instrumentals"
    SINGING_EXPORTS_DIR = SINGING_DIR / "exports"
    SINGING_JOBS_DIR = SINGING_DIR / "jobs"
    
    # Talking voice diarization directories
    TALKING_DIR = DATA_DIR / "talking"
    TALKING_UPLOADS_DIR = TALKING_DIR / "uploads"
    TALKING_RESULTS_DIR = TALKING_DIR / "results"
    TALKING_SPEAKER_UNKNOWN_DIR_SUFFIX = "speaker_unknown"
    # Talking voice diarization temp directories vocal and og file wav
    TALKING_TEMP_DIR = TALKING_DIR / "temp"
    
    # Legacy paths for backward compatibility
    INPUT_DIR = SINGING_UPLOADS_DIR
    TEMP_WAV_DIR = SINGING_TEMP_DIR
    UVR_RAW_DIR = SINGING_VOCALS_RAW_DIR
    UVR_PROCESSED_DIR = SINGING_VOCALS_PROCESSED_DIR
    INSTRUMENTAL_DIR = SINGING_INSTRUMENTALS_DIR
    EXPORT_DIR = SINGING_EXPORTS_DIR
    DIARIZATION_CONFIG_DIR = BASE_DIR / "diarization/pyannote-diarization/config"
    DIARIZATION_INPUT = TALKING_UPLOADS_DIR
    SPEAKER_DIR = TALKING_RESULTS_DIR
    ORIGINAL_AUDIO_DIR = ORIGINALS_DIR
    
    # Processing settings
    MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB
    ALLOWED_EXTENSIONS = {'wav', 'mp3', 'ogg', 'flac', 'm4a'}
    
    # Job settings
    MAX_ACTIVE_JOBS = 10
    JOB_TIMEOUT = 3600  # 1 hour in seconds 