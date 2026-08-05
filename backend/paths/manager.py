from pathlib import Path

from app.config import Config


class PathManager:
    """Centralized path management for the application"""

    def __init__(self):
        # Base directories (repo root)
        self.BASE_DIR = Path(__file__).resolve().parents[2]
        self.APPLIO_DIR = self.BASE_DIR / "applio"
        self.METADATA_DIR = self.BASE_DIR / "data" / "metadata"

        # Import paths from Config
        self.INPUT_DIR = Path(Config.INPUT_DIR)
        self.TEMP_WAV_DIR = Path(Config.TEMP_WAV_DIR)
        self.UVR_RAW_DIR = Path(Config.UVR_RAW_DIR)
        self.UVR_PROCESSED_DIR = Path(Config.UVR_PROCESSED_DIR)
        self.INSTRUMENTAL_DIR = Path(Config.INSTRUMENTAL_DIR)
        self.EXPORT_DIR = Path(Config.EXPORT_DIR)
        self.DIARIZATION_CONFIG_DIR = Path(Config.DIARIZATION_CONFIG_DIR)
        self.DIARIZATION_INPUT = Path(Config.DIARIZATION_INPUT)
        self.SPEAKER_DIR = Path(Config.SPEAKER_DIR)
        self.ORIGINAL_AUDIO_DIR = Path(Config.ORIGINAL_AUDIO_DIR)
        self.TALKING_DIR = Path(Config.TALKING_DIR)
        self.TALKING_UPLOADS_DIR = Path(Config.TALKING_UPLOADS_DIR)
        self.TALKING_RESULTS_DIR = Path(Config.TALKING_RESULTS_DIR)

        # Singing-specific directories
        self.SINGING_JOBS_DIR = self.BASE_DIR / "data" / "singing" / "jobs"

        # Talking-specific directories
        self.TALKING_TEMP_DIR = self.TALKING_RESULTS_DIR / "temp"
        self.TALKING_SPEAKER_UNKNOWN_DIR_SUFFIX = "speaker_unknown"

        # Model and training directories (using logs/ instead of applio/logs/)
        self.APPLIO_MODELS_DIR = self.BASE_DIR / "logs"
        self.APPLIO_DATASET_DIR = self.APPLIO_DIR / "assets" / "datasets"
        self.APPLIO_ASSETS_DIR = self.APPLIO_DIR / "assets"

        # Inference-specific directories
        self.INFERENCE_DIR = self.BASE_DIR / "data" / "singing" / "inference"
        self.INFERENCE_RUNS_DIR = self.INFERENCE_DIR / "runs"

        # Precomputed waveform peaks, keyed by source file mtime+size
        self.WAVEFORM_CACHE_DIR = self.BASE_DIR / "data" / "waveform_cache"

    def ensure_directories_exist(self):
        """Ensure all required directories exist"""
        directories = [
            self.INPUT_DIR,
            self.TEMP_WAV_DIR,
            self.UVR_RAW_DIR,
            self.UVR_PROCESSED_DIR,
            self.INSTRUMENTAL_DIR,
            self.EXPORT_DIR,
            self.DIARIZATION_CONFIG_DIR,
            self.DIARIZATION_INPUT,
            self.SPEAKER_DIR,
            self.ORIGINAL_AUDIO_DIR,
            self.TALKING_DIR,
            self.TALKING_UPLOADS_DIR,
            self.TALKING_RESULTS_DIR,
            self.TALKING_TEMP_DIR,
            self.SINGING_JOBS_DIR,
            self.APPLIO_MODELS_DIR,
            self.APPLIO_DATASET_DIR,
            self.INFERENCE_DIR,
            self.INFERENCE_RUNS_DIR,
            self.METADATA_DIR,
            self.WAVEFORM_CACHE_DIR,
        ]

        for directory in directories:
            directory.mkdir(parents=True, exist_ok=True)

    def get_vocal_file_path(self, filename, processed=False):
        """Get path to vocal file (raw or processed)"""
        if processed:
            return self.UVR_PROCESSED_DIR / filename
        else:
            return self.UVR_RAW_DIR / filename

    def get_instrumental_file_path(self, filename):
        """Get path to instrumental file"""
        return self.INSTRUMENTAL_DIR / filename

    def get_export_file_path(self, filename):
        """Get path to export file"""
        return self.EXPORT_DIR / filename

    def get_inference_file_path(self, filename):
        """Get path to inference result file"""
        return self.INFERENCE_DIR / filename

    def get_talking_speaker_dir(self, dataset_name, speaker_name):
        """Get path to a specific speaker directory in talking results"""
        return self.TALKING_RESULTS_DIR / dataset_name / speaker_name

    def get_applio_model_dir(self, model_name):
        """Get path to a specific applio model directory"""
        return self.APPLIO_MODELS_DIR / model_name

    def get_applio_dataset_dir(self, dataset_name):
        """Get path to a specific applio dataset directory"""
        return self.APPLIO_DATASET_DIR / dataset_name


# Initialize path manager
paths = PathManager()
