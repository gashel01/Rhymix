from flask import Blueprint, request, jsonify, send_file
import os
import time
import uuid
import logging
from pathlib import Path

from app.config import Config
from app.utils.file_handling import FileHandler
from app.utils.audio_processor import AudioProcessor
from app.utils.diarization_processor import DiarizationProcessor
from app.utils.job_manager import JobManager

# Create blueprint
diarization_bp = Blueprint('diarization', __name__, url_prefix='/api')

# Set up logging
logger = logging.getLogger(__name__)

# Create job manager instance
job_manager = JobManager()

@diarization_bp.route('/upload-talking', methods=['POST'])
def upload_talking_file():
    """Upload a talking audio file for diarization"""
    try:
        # Check if the post request has the file part
        if 'audio' not in request.files:
            return jsonify({"error": "No audio file provided"}), 400
            
        audio_file = request.files['audio']
        
        # Check if filename is empty
        if audio_file.filename == '':
            return jsonify({"error": "No file selected"}), 400
            
        # Ensure directories exist - create full directory structure
        FileHandler.create_directory_structure(Config.BASE_DIR)
        
        # Generate a job ID
        job_id = f"diarization-{int(time.time())}"
        
        # Create a job
        job_config = {
            "job_type": "diarization",
            "original_filename": audio_file.filename
        }
        job_manager.create_job(job_config)
        
        # Create job-specific directories
        job_dir = Config.TALKING_RESULTS_DIR / job_id
        FileHandler.ensure_directory_exists(job_dir)
        FileHandler.ensure_directory_exists(job_dir / "original")
        FileHandler.ensure_directory_exists(job_dir / "speakers")
        
        # Save uploaded file to uploads directory
        input_path = FileHandler.save_uploaded_file(
            audio_file, 
            Config.TALKING_UPLOADS_DIR
        )
        
        # Copy to originals directory for safekeeping
        import shutil
        original_path = Config.ORIGINALS_DIR / input_path.name
        shutil.copy2(input_path, original_path)
        
        # Also save to job-specific original folder
        job_original_path = job_dir / "original" / input_path.name
        shutil.copy2(input_path, job_original_path)
        
        # Update job with file info
        job_manager.update_job_status(job_id, "processing", "File uploaded successfully")
        job_manager.add_job_step(job_id, f"Saved input file to {input_path}")
        job_manager.add_job_step(job_id, f"Created job directory at {job_dir}")
        
        # Start diarization process in a background thread
        import threading
        thread = threading.Thread(
            target=run_diarization_process,
            args=(job_id, input_path, audio_file.filename)
        )
        thread.daemon = True
        thread.start()
        
        return jsonify({
            "job_id": job_id,
            "status": "processing",
            "message": "Processing started"
        })
    
    except Exception as e:
        logger.error(f"Error in upload: {e}")
        return jsonify({"error": str(e)}), 500

def run_diarization_process(job_id, input_audio_path, original_filename):
    """Background process to run diarization"""
    try:
        # Update job status
        job_manager.update_job_status(job_id, "processing", "Running diarization")
        job_manager.add_job_step(job_id, "Starting diarization process", 0.1)
        
        # Create job output directory
        job_dir = Config.TALKING_RESULTS_DIR / job_id
        speakers_dir = job_dir / "speakers"
        FileHandler.ensure_directory_exists(speakers_dir)
        
        # For demonstration, we'll assume the diarization output file exists
        # In a real implementation, you would run the diarization tool here
        # For example:
        # subprocess.run([Config.DIARIZATION_SCRIPT_PATH, str(input_audio_path), str(output_dir)])
        
        # Simulate the diarization process
        job_manager.update_job_progress(job_id, 0.3)
        job_manager.add_job_step(job_id, "Running diarization algorithm", 0.3)
        time.sleep(2)  # Simulate processing time
        
        # Assume the diarization output file is created at this location
        diarization_output_file = job_dir / "diarization_output.txt"
        
        # In a real implementation, this file would be created by the diarization tool
        # For demonstration, we'll create a sample file
        create_sample_diarization_output(diarization_output_file)
        
        job_manager.update_job_progress(job_id, 0.6)
        job_manager.add_job_step(job_id, "Diarization complete, processing segments", 0.6)
        
        # Parse the diarization output
        segments = DiarizationProcessor.parse_diarization_output(diarization_output_file)
        
        if not segments:
            raise ValueError("No speaker segments found in diarization output")
        
        # Process the segments - extract audio for each speaker and unknown segments
        results = DiarizationProcessor.process_speaker_segments(
            original_audio_path=input_audio_path,
            segments=segments,
            output_base_dir=speakers_dir,
            include_unknown_segments=True,
            min_gap_duration=0.5
        )
        
        # Update job with results
        job_manager.update_job_progress(job_id, 1.0)
        job_manager.complete_job(job_id, results)
        
        logger.info(f"Diarization completed for job {job_id}")
    
    except Exception as e:
        logger.error(f"Error in diarization process: {e}")
        job_manager.fail_job(job_id, str(e))

def create_sample_diarization_output(output_file):
    """Create a sample diarization output file for demonstration"""
    with open(output_file, 'w') as f:
        f.write("[0.50 - 6.34] SPEAKER_00\n")
        f.write("[12.53 - 14.37] SPEAKER_00\n")
        f.write("[19.67 - 26.81] SPEAKER_00\n")
        f.write("[27.82 - 45.59] SPEAKER_00\n")
        f.write("[45.77 - 49.45] SPEAKER_02\n")
        f.write("[48.88 - 88.67] SPEAKER_00\n")
        f.write("[89.73 - 135.72] SPEAKER_00\n")
        f.write("[137.96 - 145.49] SPEAKER_00\n")
        f.write("[147.95 - 168.27] SPEAKER_00\n")
        f.write("[169.74 - 188.99] SPEAKER_00\n")
        f.write("[189.85 - 190.22] SPEAKER_00\n")
        f.write("[192.20 - 192.45] SPEAKER_00\n")
        f.write("[192.45 - 193.01] SPEAKER_01\n")
        f.write("[196.21 - 210.86] SPEAKER_00\n")

@diarization_bp.route('/talking-status/<job_id>', methods=['GET'])
def talking_status(job_id):
    """Get the status of a talking audio processing job"""
    try:
        job = job_manager.get_job(job_id)
        return jsonify(job)
    except ValueError:
        return jsonify({"error": "Job not found"}), 404
    except Exception as e:
        logger.error(f"Error getting job status: {e}")
        return jsonify({"error": str(e)}), 500

@diarization_bp.route('/available-talking-datasets', methods=['GET'])
def available_talking_datasets():
    """List all available talking datasets in the results directory"""
    try:
        # Ensure the results directory exists
        if not Config.TALKING_RESULTS_DIR.exists():
            return jsonify({"datasets": []})
        
        # Scan for job directories (each represents a dataset)
        datasets = []
        
        for job_dir in Config.TALKING_RESULTS_DIR.iterdir():
            if job_dir.is_dir():
                speakers_dir = job_dir / "speakers"
                
                # Skip if no speakers directory
                if not speakers_dir.exists():
                    continue
                    
                # Count speakers in this dataset
                speaker_dirs = [d for d in speakers_dir.iterdir() 
                              if d.is_dir() and (d.name.startswith("speaker_") or d.name == "speaker_unknown")]
                speaker_count = len(speaker_dirs)
                
                # Count all audio samples
                sample_count = sum(len(list(d.glob("*.wav"))) for d in speaker_dirs if d.exists())
                
                # Only include if it has speakers
                if speaker_dirs:
                    # Get a sample audio path if available
                    sample_audio = None
                    for speaker_dir in speaker_dirs:
                        wav_files = list(speaker_dir.glob("*.wav"))
                        if wav_files:
                            sample_audio = str(wav_files[0])
                            break
                    
                    # Check if we have unknown speaker segments
                    unknown_dir = speakers_dir / "speaker_unknown"
                    has_unknown = unknown_dir.exists() and len(list(unknown_dir.glob("*.wav"))) > 0
                    
                    datasets.append({
                        "name": job_dir.name,
                        "path": str(job_dir),
                        "speaker_count": speaker_count,
                        "sample_count": sample_count,
                        "has_unknown_segments": has_unknown,
                        "sample_audio": sample_audio
                    })
        
        # Sort by name
        datasets.sort(key=lambda x: x["name"])
        
        return jsonify({
            "datasets": datasets
        })
        
    except Exception as e:
        logger.error(f"Error fetching talking datasets: {e}")
        return jsonify({"error": str(e)}), 500 