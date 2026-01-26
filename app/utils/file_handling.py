from pathlib import Path
from werkzeug.utils import secure_filename
import shutil
import logging

logger = logging.getLogger(__name__)


class FileHandler:
    """Utility class for file operations"""
    
    @staticmethod
    def save_uploaded_file(file, target_dir: Path) -> Path:
        """
        Securely save an uploaded file
        Args:
            file: Uploaded file object
            target_dir: Directory to save to
        Returns:
            Path to saved file
        """
        FileHandler.ensure_directory_exists(target_dir)
        secure_name = secure_filename(file.filename)
        file_path = target_dir / secure_name
        file.save(file_path)
        logger.debug(f"Saved file: {file_path}")
        return file_path

    @staticmethod
    def ensure_directory_exists(directory: Path) -> None:
        """Ensure directory exists, create if not"""
        directory.mkdir(exist_ok=True, parents=True)
        logger.debug(f"Ensured directory exists: {directory}")

    @staticmethod
    def create_directory_structure(base_dir: Path) -> None:
        """
        Create the full directory structure for the application
        Args:
            base_dir: Base directory for all data
        """
        # Create main directory structure
        data_dir = base_dir / "data"
        uploads_dir = data_dir / "uploads"
        originals_dir = data_dir / "originals"
        
        # Singing voice separation directories
        singing_dir = data_dir / "singing"
        singing_uploads_dir = singing_dir / "uploads"
        singing_temp_dir = singing_dir / "temp"
        singing_vocals_dir = singing_dir / "vocals"
        singing_vocals_raw_dir = singing_vocals_dir / "raw"
        singing_vocals_processed_dir = singing_vocals_dir / "processed"
        singing_instrumentals_dir = singing_dir / "instrumentals"
        singing_exports_dir = singing_dir / "exports"
        singing_jobs_dir = singing_dir / "jobs"
        
        # Talking voice diarization directories
        talking_dir = data_dir / "talking"
        talking_uploads_dir = talking_dir / "uploads"
        talking_results_dir = talking_dir / "results"
        
        # Create all directories
        dirs_to_create = [
            data_dir,
            uploads_dir,
            originals_dir,
            singing_dir,
            singing_uploads_dir,
            singing_temp_dir,
            singing_vocals_dir,
            singing_vocals_raw_dir,
            singing_vocals_processed_dir,
            singing_instrumentals_dir,
            singing_exports_dir,
            singing_jobs_dir,
            talking_dir,
            talking_uploads_dir,
            talking_results_dir
        ]
        
        for directory in dirs_to_create:
            FileHandler.ensure_directory_exists(directory)
            
        logger.info(f"Created directory structure under {data_dir}")
        return data_dir

    @staticmethod
    def get_available_files(dir_path: Path, pattern: str = "*") -> list[Path]:
        """
        List available files matching pattern
        Args:
            dir_path: Directory to search
            pattern: File pattern to match (default "*")
        Returns:
            List of matching files
        """
        FileHandler.ensure_directory_exists(dir_path)
        return sorted(dir_path.glob(pattern))

    @staticmethod
    def clean_directory(directory: Path, exclude: list[Path] = None) -> int:
        """
        Clean directory contents while preserving directory structure
        Args:
            directory: Directory to clean
            exclude: List of paths to exclude from deletion
        Returns:
            Number of files deleted
        """
        if exclude is None:
            exclude = []
        
        if not directory.exists():
            return 0
            
        count = 0
        for item in directory.glob("*"):
            if item in exclude:
                continue
            try:
                if item.is_dir():
                    shutil.rmtree(item)
                else:
                    item.unlink()
                count += 1
            except Exception as e:
                logger.error(f"Error deleting {item}: {e}")
                
        logger.info(f"Cleaned {count} items from {directory}")
        return count 