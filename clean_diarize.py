import os
import subprocess
from pathlib import Path
import soundfile as sf
import librosa
import numpy as np
import traceback
import logging
import shutil
import re
from vocal import get_model, separate_vocal
import json

from app.config import Config


# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("diarization_processing.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("clean_diarize")

# Define the base data directory
DATA_DIR = Config.DATA_DIR
TALKING_DIR = Config.TALKING_DIR
DIARIZATION_INPUT = Config.TALKING_UPLOADS_DIR
TEMP_WAV_DIR = Config.TALKING_DIR / "temp"  # If not already in Config, define it there or use directly here
RESULTS_DIR = Config.TALKING_RESULTS_DIR
ORIGINAL_AUDIO_DIR = Config.ORIGINAL_AUDIO_DIR


# Make sure all directories exist
for directory in [DATA_DIR, TALKING_DIR, DIARIZATION_INPUT, RESULTS_DIR, ORIGINAL_AUDIO_DIR, TEMP_WAV_DIR]:
    directory.mkdir(exist_ok=True, parents=True)

def slugify(value):
    """
    Convert spaces or other characters to underscores and truncate to a reasonable length.
    Also remove characters that aren't alphanumerics, underscores, or hyphens.
    """
    value = re.sub(r'[^\w\s-]', '', value).strip().lower()
    value = re.sub(r'[-\s]+', '_', value)
    # Truncate to avoid path length issues (especially on Windows)
    return value[:40]  # Limit to 40 characters for safety

# Function to convert to WAV
def convert_to_wav(input_path, output_path):
    """Convert an audio file to WAV format using FFmpeg."""
    print(f"Converting {input_path} to {output_path}")
    
    try:
        # Make sure parent directory exists
        output_path.parent.mkdir(exist_ok=True, parents=True)
        
        # Define FFmpeg command
        cmd = [
            "ffmpeg", "-y", "-i", str(input_path), 
            "-ar", "44100", "-ac", "2",  # 44.1kHz stereo
            str(output_path)
        ]
        
        # Run the command
        subprocess.run(cmd, check=True)
        print(f"Converted to WAV: {output_path}")
        return True
    except Exception as e:
        print(f"Error converting to WAV: {e}")
        return False

# Function to run vocal separation and save results
def process_file(input_file, job_id=None):
    """Process a single audio file for diarization with better file tracking"""
    try:
        # Get base filename without extension
        base_filename = os.path.basename(input_file)
        filename_stem = os.path.splitext(base_filename)[0]
        file_extension = os.path.splitext(base_filename)[1].lower()
        
        # Create a safe folder name
        safe_foldername = ''.join(c for c in filename_stem if c.isalnum() or c in '_ ').strip()
        
        # Create job directory for this processing job
        job_dir = None
        # if job_id:
        #     job_dir = RESULTS_DIR / job_id
        # else:
        #     job_dir = RESULTS_DIR / safe_foldername
        
        # job_dir.mkdir(exist_ok=True, parents=True)
        
        # # Create original audio folder within job directory
        # original_folder = job_dir / "original"
        # original_folder.mkdir(exist_ok=True, parents=True)
        
        # # Copy original file to the originals directory with consistent naming
        # original_file_path = original_folder / f"{filename_stem}_original{file_extension}"
        
        # # Copy original file
        # shutil.copy2(input_file, original_file_path)
        # print(f"Copied original file to: {original_file_path}")
        
        # Also save a copy to the main originals directory
        main_original_path = ORIGINAL_AUDIO_DIR / f"{filename_stem}_original{file_extension}"
        shutil.copy2(input_file, main_original_path)
        
        # Store file paths in a metadata file for the API to use
        # metadata = {
        #     "original_file": str(main_original_path),
        #     "filename_stem": filename_stem,
        #     "processing_dir": str(job_dir),
        #     "job_id": job_id
        # }
        
        # # Save metadata to a JSON file
        # metadata_path = job_dir / "file_metadata.json"
        # with open(metadata_path, "w") as f:
        #     json.dump(metadata, f, indent=2)
            
        # print(f"Saved metadata to: {metadata_path}")
        
        # Convert to WAV if not already in that format
        if input_file.suffix.lower() != '.wav':
            TEMP_WAV_DIR.mkdir(exist_ok=True, parents=True)
            wav_path = TEMP_WAV_DIR / f"{safe_foldername}.wav"
            
            try:
                # Convert using ffmpeg
                convert_to_wav(input_file, wav_path)
                
                # Use the WAV version
                audio_path = wav_path
            except Exception as e:
                print(f"Error converting to WAV: {e}")
                # If conversion fails, try to use the original file
                audio_path = input_file
        else:
            audio_path = input_file
        
        # Extract vocals and instrumental
        try:
            # Load audio
            print(f"Loading audio: {audio_path}")
            audio, sr = librosa.load(str(audio_path), sr=44100, mono=False)
            model = get_model("cuda")  # use "cpu" if needed
            
            # Get separated vocals
            print("Separating vocals...")
            separated_vocals = separate_vocal(model, audio, "cuda", silent=False)
            
          
            # Save vocal at the original location
            vocals_path = TEMP_WAV_DIR / f"{safe_foldername}_vocals.wav"
            sf.write(vocals_path, separated_vocals.T, sr)
            print(f"Saved vocals to: {vocals_path}")
            
            # # Save an additional copy in the diarization folder for direct access by diarization scripts
            # diarization_temp_dir = Path("diarization/pyannote-diarization/temp")
            # diarization_temp_dir.mkdir(exist_ok=True, parents=True)
            # diarization_vocals_path = diarization_temp_dir / f"{safe_foldername}_vocals.wav"
            # sf.write(diarization_vocals_path, separated_vocals.T, sr)
            # print(f"Saved vocals copy for diarization scripts: {diarization_vocals_path}")
            
            # Create instrumental by subtracting vocals from the original audio
            # We need to ensure shapes match first
            if len(audio.shape) == 1:  # If mono
                audio = np.expand_dims(audio, axis=0)  # Make it [1, samples]
            elif audio.shape[0] > 2:  # If multichannel (more than stereo)
                audio = audio[:2]  # Take only first two channels
            elif len(audio.shape) == 2 and audio.shape[0] < 2:  # If [1, samples]
                audio = np.repeat(audio, 2, axis=0)  # Make it stereo [2, samples]
                
            # Match shapes and create instrumental
            if separated_vocals.shape[1] > audio.shape[1]:
                separated_vocals = separated_vocals[:, :audio.shape[1]]
            elif separated_vocals.shape[1] < audio.shape[1]:
                audio = audio[:, :separated_vocals.shape[1]]
                
            # Generate instrumental by subtracting vocals from original
            instrumental = audio - separated_vocals
            
            # Save instrumental in the original folder
            instrumental_path = original_folder / f"{safe_foldername}_instrumental.wav"
            try:
                sf.write(instrumental_path, instrumental.T, sr)
                print(f"Saved instrumental to: {instrumental_path}")
            except Exception as e:
                print(f"Error saving instrumental: {e}")
                # Try with a shorter name
                shortened_instr = original_folder / "instrumental.wav"
                sf.write(shortened_instr, instrumental.T, sr)
                print(f"Saved instrumental to shortened path: {shortened_instr}")
            
            print(f"✅ Successfully processed {input_file.name}")
            return {
                "success": True,
                "original_file": str(original_file_path),
                "processing_dir": str(job_dir),
                "metadata_path": str(metadata_path)
            }
            
        except Exception as e:
            print(f"Error processing audio: {e}")
            traceback.print_exc()
            return {"success": False, "error": str(e)}
    except Exception as e:
        print(f"Error processing file: {e}")
        return {"success": False, "error": str(e)}

def main():
    """Main function to process all audio files in the input directory."""
    print(f"Looking for audio files in {DIARIZATION_INPUT}")
    
    # Get all audio files
    audio_files = []
    for ext in ['.wav', '.mp3', '.flac', '.ogg', '.m4a']:
        audio_files.extend(list(DIARIZATION_INPUT.glob(f"*{ext}")))
    
    if not audio_files:
        print(f"No audio files found in {DIARIZATION_INPUT}")
        return
    
    print(f"Found {len(audio_files)} audio files to process")
    
    # Process each file
    for i, file_path in enumerate(audio_files):
        print(f"\nProcessing file {i+1}/{len(audio_files)}: {file_path.name}")
        result = process_file(file_path)
        if result["success"]:
            print(f"Successfully processed: {file_path}")
            print(f"Original file stored at: {result['original_file']}")
        else:
            print(f"Failed to process {file_path}: {result['error']}")
    
    print("\nAll processing complete!")

if __name__ == "__main__":
    main() 