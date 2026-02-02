import os
import subprocess
from pathlib import Path
import wave
from datetime import datetime
import soundfile as sf
import librosa
import re
import unicodedata
from vocal import get_model, separate_vocal
import shutil
import librosa.feature
import numpy as np
import argparse
import zipfile
import traceback
import logging
import time
import queue

# Import Config for paths
from app.config import Config

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("processing.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("clean_vocals")

# Global progress queue for communicating with Flask API
progress_queue = queue.Queue()

# Use paths from Config
DATA_DIR = Config.DATA_DIR
SINGING_DIR = Config.SINGING_DIR
INPUT_DIR = Config.INPUT_DIR
TEMP_WAV_DIR = Config.TEMP_WAV_DIR
OUTPUT_DIR = Config.SINGING_VOCALS_DIR  # Parent directory for vocals
UVR_RAW_DIR = Config.UVR_RAW_DIR
UVR_PROCESSED_DIR = Config.UVR_PROCESSED_DIR
INSTRUMENTAL_DIR = Config.INSTRUMENTAL_DIR
EXPORT_DIR = Config.EXPORT_DIR
JOBS_DIR = Config.SINGING_JOBS_DIR

# Add function to clean directories
def clean_directories(include_input=False, force=False):
    """Clean up all temporary directories.
    
    Args:
        include_input: Whether to clean the input directory
        force: Whether to use more aggressive methods to clean locked files
    """
    print("\n================================================")
    print("           CLEANING DIRECTORIES")
    print("================================================")
    
    directories = [
        TEMP_WAV_DIR,
        UVR_RAW_DIR,
        UVR_PROCESSED_DIR,
        INSTRUMENTAL_DIR,
        EXPORT_DIR,
    ]
    
    if include_input:
        directories.append(INPUT_DIR)
    
    for directory in directories:
        print(f"Cleaning {directory}...")
        if not directory.exists():
            directory.mkdir(exist_ok=True, parents=True)
            print(f"  [OK] {directory} created")
            continue
        
        try:
            # Count items before cleaning
            items = list(directory.glob("*"))
            if len(items) == 0:
                print(f"  [OK] {directory} already empty")
                continue
            
            # Try to clean the directory
            removed_count = 0
            failed_files = []
            
            for item in items:
                try:
                    if item.is_file():
                        # Add a small delay before attempting delete
                        time.sleep(0.2)
                        
                        # Try multiple times with increasing delays
                        max_attempts = 3
                        for attempt in range(max_attempts):
                            try:
                                item.unlink(missing_ok=True)
                                removed_count += 1
                                break  # Successfully deleted
                            except Exception as e:
                                if attempt < max_attempts - 1:
                                    print(f"  Retry {attempt+1}/{max_attempts} for {item.name}: {e}")
                                    time.sleep(1 * (attempt + 1))  # Increasing delay
                                else:
                                    print(f"  [ERROR] Error removing {item.name}: {e}")
                                    failed_files.append(item)
                    elif item.is_dir():
                        shutil.rmtree(item, ignore_errors=True)
                        removed_count += 1
                except Exception as e:
                    print(f"  [ERROR] Error removing {item.name}: {e}")
                    failed_files.append(item)
            
            print(f"  [OK] {directory} cleaned ({removed_count} items removed)")
            
            # If any files couldn't be removed, try again with more force
            if failed_files:
                print(f"Double-checking {directory}...")
                print(f"  Found {len(failed_files)} items remaining, attempting cleanup again...")
                
                time.sleep(2.0)  # Longer wait time
                
                for item in failed_files:
                    try:
                        if item.exists():  # Check if it still exists
                            if item.is_file():
                                # Try force deletion on Windows
                                if force and os.name == 'nt':
                                    try:
                                        # Use del /F command on Windows
                                        os.system(f'del /F /Q "{item}"')
                                        print(f"  Removed using force: {item.name}")
                                    except:
                                        # As a last resort, rename the file and clean later
                                        locked_dir = Path("locked_files")
                                        locked_dir.mkdir(exist_ok=True)
                                        try:
                                            new_path = locked_dir / f"locked_{int(time.time())}_{item.name}"
                                            os.rename(item, new_path)
                                            print(f"  Moved locked file to: {new_path}")
                                        except Exception as e:
                                            print(f"  [ERROR] Cannot move locked file: {e}")
                                else:
                                    item.unlink(missing_ok=True)
                                    print(f"  Removed: {item.name}")
                            elif item.is_dir():
                                shutil.rmtree(item, ignore_errors=True)
                                print(f"  Removed directory: {item.name}")
                    except Exception as e:
                        print(f"  [ERROR] Unable to remove {item.name}: {e}")
                        # Continue processing anyway - don't let this stop us
            
            # At the very end of the cleanup process, after all other attempts
            if failed_files:
                print(f"Making final attempt after longer delay for {len(failed_files)} remaining files...")
                # Use a much longer delay for the final attempt
                time.sleep(5.0)
                
                # Try a different approach for Windows systems
                if os.name == 'nt' and force:
                    # On Windows, sometimes files remain locked even after stopping audio
                    # Try to use the OS command to force-close file handles
                    try:
                        # Create batch file with commands to force close handles
                        temp_batch = Path("temp_cleanup.bat")
                        with open(temp_batch, "w") as batch_file:
                            for item in failed_files:
                                if item.exists() and item.is_file():
                                    batch_file.write(f'echo Forcing close of {item}\n')
                                    batch_file.write(f'del /F /Q "{item}"\n')
                        
                        # Execute the batch file
                        subprocess.run([str(temp_batch)], shell=True)
                        
                        # Cleanup
                        if temp_batch.exists():
                            temp_batch.unlink()
                            
                    except Exception as e:
                        print(f"Error during final forced cleanup: {e}")
            
        except Exception as e:
            print(f"  [ERROR] Error cleaning {directory}: {e}")
    
    print("\nDirectory cleaning complete!")

# Check if directories have content
def directories_have_content():
    """Check if any working directories have content"""
    dirs_to_check = [
        INPUT_DIR,
        TEMP_WAV_DIR,
        UVR_RAW_DIR,
        UVR_PROCESSED_DIR,
        INSTRUMENTAL_DIR,
        EXPORT_DIR  # Add export directory to the list
    ]
    
    for directory in dirs_to_check:
        if directory.exists():
            # Check if directory has any files
            files = list(directory.glob("*.*"))
            if files:
                return True
    
    return False

def create_needed_directories(process_audio=True, export_data=False):
    # Always needed
    dirs_to_create = [
        DATA_DIR,
        SINGING_DIR,
        INPUT_DIR, 
        TEMP_WAV_DIR, 
        OUTPUT_DIR, 
        UVR_RAW_DIR, 
        INSTRUMENTAL_DIR,
        JOBS_DIR
    ]
    
    # Add processing directory if needed
    if process_audio:
        dirs_to_create.append(UVR_PROCESSED_DIR)
    
    # Add export directory if needed
    if export_data:
        dirs_to_create.append(EXPORT_DIR)
    
    for folder in dirs_to_create:
        folder.mkdir(exist_ok=True, parents=True)

def normalize_filename(filename):
    """Normalize a filename for consistency while preserving the full track name."""
    # Extract base name without extension
    # base_name = os.path.splitext(filename)[0]
    
    # Only remove truly problematic characters for file systems
    safe_name = re.sub(r'[<>:"|?*\\\/]', '', filename)
    
    # Clean up multiple spaces but preserve other characters
    safe_name = re.sub(r'\s+', ' ', safe_name).strip()
    
    # If the name is empty after cleaning, use a default
    if not safe_name:
        safe_name = "unnamed_track"
        
    print(f"Normalized filename: {filename} -> {safe_name}")
    return safe_name

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

def run_vocal_separation(input_file: Path, output_prefix: str):
    print(f"Extracting vocals from {input_file} using Vocal...")
    audio, sr = librosa.load(str(input_file), sr=44100, mono=False)
    model = get_model("cuda")  # use "cpu" if needed
    
    # Get separated vocals
    separated_vocals = separate_vocal(model, audio, "cuda", silent=False)

    # Place raw vocals in the UVR_RAW_DIR
    vocals_path = UVR_RAW_DIR / f"{output_prefix}_vocals.wav"
    sf.write(vocals_path, separated_vocals.T, sr)
    
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
    
    # Save instrumental
    instrumental_path = INSTRUMENTAL_DIR / f"{output_prefix}_instrumental.wav"
    sf.write(instrumental_path, instrumental.T, sr)
    
    print(f"  [OK] Vocals extracted: {vocals_path.name}")
    print(f"  [OK] Instrumental extracted: {instrumental_path.name}")
    
    return vocals_path

def reduce_noise_reverb(input_file: Path, output_file: Path, is_segment=False):
    """Apply noise reduction and filter with configurable strength"""
    if is_segment:
        # Gentler processing for segments
        # Just slight highpass to remove rumble and no noise reduction
        # Since afftdn was causing issues, we'll just use a basic filter
        filter_args = "highpass=f=60"
    else:
        # Original more aggressive processing for full files
        filter_args = "afftdn=nf=-25,areverse,afftdn=nf=-25,areverse,highpass=f=80,lowpass=f=12000"
    
    subprocess.run([
        "ffmpeg", "-y", "-i", str(input_file),
        "-af", filter_args,
        str(output_file)
    ])

def normalize_volume(input_file: Path, output_file: Path):
    subprocess.run([
        "ffmpeg", "-y", "-i", str(input_file),
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", str(output_file)
    ])

def get_audio_duration(file: Path) -> float:
    with wave.open(str(file), "rb") as wf:
        frames = wf.getnframes()
        rate = wf.getframerate()
        return frames / float(rate)

def contains_meaningful_audio(audio_file: Path, threshold_db=-40, high_freq_ratio_max=0.7) -> bool:
    """
    Check if a segment contains meaningful vocal content by:
    1. Checking if it has sufficient volume (not just silence)
    2. Checking that it's not predominantly high-frequency noise
    """
    try:
        # Load the audio file
        y, sr = librosa.load(str(audio_file), sr=None, mono=True)
        
        # Check if it's too quiet
        rms = librosa.feature.rms(y=y)[0]
        db = 20 * np.log10(np.mean(rms) + 1e-8)  # Convert to dB with safe log
        
        # Calculate spectral centroid to detect high-frequency noise
        cent = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
        # Ratio of frames with centroid above 5000Hz (high-pitched noise or artifacts)
        high_freq_ratio = np.mean(cent > 5000)
        
        print(f"  Segment check: avg_db={db:.1f}dB, high_freq_ratio={high_freq_ratio:.2f}")
        
        # Return True if the segment is loud enough and doesn't have too much high-freq content
        return db > threshold_db and high_freq_ratio < high_freq_ratio_max
    except Exception as e:
        print(f"  [WARNING] Error analyzing audio content: {e}")
        return True  # Default to keeping the segment if analysis fails

def split_into_phrases(input_file: Path, output_folder: Path) -> list:
    output_folder.mkdir(exist_ok=True, parents=True)
    
    # Using more sensitive silence detection for vocals
    # Higher noise threshold (-25dB instead of -35dB) and shorter silence duration (0.3s instead of 0.5s)
    result = subprocess.run(
        f'ffmpeg -i "{input_file}" -af silencedetect=noise=-25dB:d=0.3 -f null - 2>&1',
        shell=True, capture_output=True, text=True
    )
    
    print(f"Silence detection output for {input_file.name}:")
    
    # Parse silence points
    silences = []
    for line in result.stderr.splitlines():  # Note: ffmpeg outputs to stderr
        if "silence_start" in line:
            start = float(line.split("silence_start: ")[-1])
            silences.append((start, None))
            print(f"  Silence starts at: {start:.2f}s")
        elif "silence_end" in line and silences and silences[-1][1] is None:
            parts = line.split("silence_end: ")[-1].split(" ")
            end = float(parts[0])
            duration = float(parts[-1].replace("silence_duration: ", ""))
            silences[-1] = (silences[-1][0], end)
            print(f"  Silence ends at: {end:.2f}s (duration: {duration:.2f}s)")
    
    audio_length = get_audio_duration(input_file)
    print(f"Audio length: {audio_length:.2f}s")
    
    # Create segments between silences
    segments = []
    prev_end = 0
    
    # If no silences found or very few, force segmentation at regular intervals
    if len(silences) < 3:
        print("Too few silences detected. Falling back to fixed interval segmentation.")
        segment_length = 10.0  # 10 second segments
        num_segments = int(audio_length / segment_length)
        
        for i in range(num_segments):
            start = i * segment_length
            end = min((i + 1) * segment_length, audio_length)
            segments.append((start, end))
            
        # Add final segment if needed
        if num_segments * segment_length < audio_length:
            segments.append((num_segments * segment_length, audio_length))
    else:
        # Use normal silence-based segmentation with reduced minimum length
        for start, end in silences:
            if start - prev_end > 0.5:  # Only create segments longer than 0.5 second (was 1.0)
                segments.append((prev_end, start))
            prev_end = end if end is not None else audio_length
        
        # Add final segment if needed
        if prev_end < audio_length - 0.5:
            segments.append((prev_end, audio_length))
    
    # Generate segment files
    segment_files = []
    print(f"Creating {len(segments)} segments:")
    progress_cb = ProgressCallback(len(segments), "Processing segments", 1, len(segments))
    for i, (start, end) in enumerate(segments):
        duration = end - start
        if duration < 1.0:  # Increased minimum duration to 1 second
            print(f"  Skipping short segment {i}: {start:.2f}s - {end:.2f}s (duration: {duration:.2f}s)")
            continue
            
        print(f"  Segment {i}: {start:.2f}s - {end:.2f}s (duration: {duration:.2f}s)")
        
        segment_file = output_folder / f"{input_file.stem}_phrase_{i:03}.wav"
        subprocess.run([
            "ffmpeg", "-y", "-i", str(input_file),
            "-ss", f"{start}", "-to", f"{end}",
            "-ar", "44100", "-ac", "1", "-sample_fmt", "s16",
            str(segment_file)
        ])
        
        # Check if the segment contains meaningful vocal content
        if segment_file.exists():
            if contains_meaningful_audio(segment_file):
                segment_files.append(segment_file)
            else:
                print(f"  [DISCARD] Segment {i}: Contains mostly noise or silence")
                segment_file.unlink()  # Delete the noisy/silent segment
        
        progress_cb.update(1)
    
    return segment_files

def de_choir_vocals(input_file: Path, output_file: Path):
    """Process vocals to try to isolate lead vocal and remove background vocals/choir elements"""
    print(f"Applying de-choir processing to {input_file.name}...")
    
    # Using a combination of techniques to try to isolate lead vocals:
    # 1. Center channel extraction (vocals are usually centered)
    # 2. EQ to emphasize vocal range
    # 3. Slight compression to even out dynamics
    subprocess.run([
        "ffmpeg", "-y", "-i", str(input_file),
        "-af", "pan=mono|c0=0.5*c0+0.5*c1,equalizer=f=200:t=q:w=1:g=-2,equalizer=f=3000:t=q:w=1:g=3,equalizer=f=6000:t=q:w=1:g=-1,compand=0.3|0.3:1|1:-90/-60|-60/-40|-40/-30|-20/-20:6:0:-90:0.2",
        "-ar", "44100", "-ac", "1", str(output_file)
    ])
    return output_file

def create_dataset_exports(segment_audio=True, process_audio=True, clean_after=False):
    """Create zip files with processed vocals for dataset export"""
    print("\nPreparing dataset exports...")
    
    # Create export directory
    create_needed_directories(process_audio, export_data=True)
    
    # Generate timestamp for unique filenames
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # ALWAYS export full vocals regardless of segmentation setting
    if process_audio and UVR_PROCESSED_DIR.exists():
        # Export processed full vocals if they exist
        full_vocals_zip = EXPORT_DIR / f"full_vocals_processed_{timestamp}.zip"
        print(f"Creating processed full vocals export: {full_vocals_zip}")
        
        with zipfile.ZipFile(full_vocals_zip, 'w') as zipf:
            for file in UVR_RAW_DIR.glob("*.wav"):
                zipf.write(file, arcname=file.name)
                print(f"  Added: {file.name}")
        
        print(f"[SUCCESS] Processed full vocals exported to: {full_vocals_zip}")
    else:
        # Export raw full vocals
        full_vocals_zip = EXPORT_DIR / f"full_vocals_raw_{timestamp}.zip"
        print(f"Creating raw full vocals export: {full_vocals_zip}")
        
        with zipfile.ZipFile(full_vocals_zip, 'w') as zipf:
            for file in UVR_RAW_DIR.glob("*_vocals.wav"):
                zipf.write(file, arcname=file.name)
                print(f"  Added: {file.name}")
        
        print(f"[SUCCESS] Raw full vocals exported to: {full_vocals_zip}")
    
    # Export segments if created
    # Segments functionality is currently disabled, so this is kept for future use
    # Define segment directories if needed
    SEGMENTS_DIR = OUTPUT_DIR / "segments"
    RAW_SEGMENTS_DIR = SEGMENTS_DIR / "raw"
    PROCESSED_SEGMENTS_DIR = SEGMENTS_DIR / "processed"
    
    # Export segments if created
    if segment_audio and process_audio:
        if PROCESSED_SEGMENTS_DIR.exists():
            segments_zip = EXPORT_DIR / f"vocal_segments_processed_{timestamp}.zip"
            print(f"Creating processed vocal segments export: {segments_zip}")
            
            with zipfile.ZipFile(segments_zip, 'w') as zipf:
                for file in PROCESSED_SEGMENTS_DIR.glob("*.wav"):
                    zipf.write(file, arcname=file.name)
                    print(f"  Added: {file.name}")
            
            print(f"[SUCCESS] Processed vocal segments exported to: {segments_zip}")
    elif segment_audio and not process_audio:
        if RAW_SEGMENTS_DIR.exists():
            segments_zip = EXPORT_DIR / f"vocal_segments_raw_{timestamp}.zip"
            print(f"Creating raw vocal segments export: {segments_zip}")
            
            with zipfile.ZipFile(segments_zip, 'w') as zipf:
                for file in RAW_SEGMENTS_DIR.glob("*.wav"):
                    zipf.write(file, arcname=file.name)
                    print(f"  Added: {file.name}")
            
            print(f"[SUCCESS] Raw vocal segments exported to: {segments_zip}")
    
    print("\nExport complete! Files are ready in the 'dataset_export' folder.")
    
    # Clean directories after export if requested
    if clean_after:
        print("\nCleaning up directories after export...")
        clean_directories(include_input=False)  # Don't clean input dir after export

def update_progress(message, progress, current_file=0, total_files=0, file_progress=None):
    """Update progress for the current processing task"""
    # Remove emojis from log messages to avoid encoding issues
    import re
    emoji_pattern = re.compile("["
                            u"\U0001F600-\U0001F64F"  # emoticons
                            u"\U0001F300-\U0001F5FF"  # symbols & pictographs
                            u"\U0001F680-\U0001F6FF"  # transport & map symbols
                            u"\U0001F700-\U0001F77F"  # alchemical symbols
                            u"\U0001F780-\U0001F7FF"  # Geometric Shapes
                            u"\U0001F800-\U0001F8FF"  # Supplemental Arrows-C
                            u"\U0001F900-\U0001F9FF"  # Supplemental Symbols and Pictographs
                            u"\U0001FA00-\U0001FA6F"  # Chess Symbols
                            u"\U0001FA70-\U0001FAFF"  # Symbols and Pictographs Extended-A
                            u"\U00002702-\U000027B0"  # Dingbats
                            u"\U000024C2-\U0001F251" 
                            "]+", flags=re.UNICODE)
    
    # Remove emojis for logging
    log_message = emoji_pattern.sub(r'', message)
    logger.info(f"Progress: {log_message}")
    
    # Calculate overall progress (file progress + between-files progress)
    if total_files > 0:
        file_weight = 1.0 / total_files
        overall_progress = ((current_file - 1) * file_weight + (progress * file_weight)) * 100
    else:
        overall_progress = progress * 100
    
    progress_data = {
        'message': message,
        'progress': int(overall_progress),
        'current_file': current_file,
        'total_files': total_files,
        'file_progress': file_progress if file_progress is not None else progress,
        'timestamp': time.time()
    }
    
    # Put progress in the queue for the API to read
    try:
        progress_queue.put(progress_data, block=False)
    except queue.Full:
        # If queue is full (shouldn't happen with our usage), discard old messages
        try:
            progress_queue.get_nowait()
            progress_queue.put(progress_data, block=False)
        except queue.Empty:
            pass
    
    # Also print to console for debugging
    print(f"Progress: {message} - {int(overall_progress)}% (File {current_file}/{total_files})")

# Custom TQDM class to send progress updates
class ProgressCallback:
    def __init__(self, total, desc, file_index, total_files):
        self.total = total
        self.n = 0
        self.desc = desc
        self.file_index = file_index
        self.total_files = total_files

    def update(self, n):
        self.n += n
        progress = min(1.0, self.n / self.total) if self.total > 0 else 0
        update_progress(
            message=f"{self.desc}: {int(progress * 100)}%", 
            progress=progress, 
            current_file=self.file_index, 
            total_files=self.total_files,
            file_progress=progress  # Add explicit file progress
        )

def process_all(segment_audio=True, process_audio=True, export_data=False, clean_after=False, input_files=None):
    """
    Process audio files. If input_files is given, process only those paths; else process all in INPUT_DIR.
    """
    segment_audio = False  # Disable segmentation completely
    if input_files is not None:
        input_files = [Path(p) for p in input_files]
    else:
        input_files = list(INPUT_DIR.glob("*.*"))
    total_files = len(input_files)
    
    if total_files == 0:
        update_progress("No files to process", 0, 0, 1)
        return
    
    update_progress(f"Starting processing of {total_files} files", 0, 1, total_files)
    
    # Process each file
    for i, file_path in enumerate(input_files, 1):
        try:
            update_progress(f"[PROCESSING] {file_path.name}...", 0, i, total_files)
            process_file(file_path, segment_audio, process_audio, export_data, i, total_files)
        except Exception as e:
            logger.error(f"Error processing {file_path}: {str(e)}")
            logger.error(traceback.format_exc())
            update_progress(f"[ERROR] {file_path.name}: {str(e)}", (i-1)/total_files, i, total_files)
    
    # Clean up if requested
    if clean_after:
        update_progress("Cleaning temporary files...", 0.98, total_files, total_files)
        clean_directories(include_input=False)
    
    update_progress("Processing complete!", 1.0, total_files, total_files)

def process_file(file_path, segment_audio, process_audio, export_data, file_index, total_files):
    """Process a single audio file."""
    normalized_name = normalize_filename(file_path.stem)
    print(f"Processing {normalized_name}...")
    
    # Convert to WAV (0% -> 20%)
    wav_path = TEMP_WAV_DIR / f"{normalized_name}.wav"
    if not wav_path.exists() or file_path.suffix.lower() != '.wav':
        update_progress(f"Converting {file_path.name} to WAV format...", 0.1, file_index, total_files)
        convert_to_wav(file_path, wav_path)
        update_progress(f"WAV conversion complete", 0.2, file_index, total_files)
    
    # Extract vocals (20% -> 70%)
    update_progress(f"Extracting vocals from {normalized_name}...", 0.2, file_index, total_files)
    
    def separation_progress_callback(progress):
        # Scale progress from 20% to 70%
        scaled_progress = 0.2 + (progress * 0.5)
        update_progress(
            f"Extracting vocals: {int(progress * 100)}%", 
            scaled_progress, 
            file_index, 
            total_files,
            progress
        )
    
    vocal_path, instrumental_path = extract_vocals(wav_path, normalized_name, progress_callback=separation_progress_callback)
    
    # Process vocals if requested (70% -> 100%)
    if process_audio:
        update_progress(f"Processing vocals from {normalized_name}...", 0.7, file_index, total_files)
        process_vocal_file(normalized_name)
        update_progress(f"Vocal processing complete", 0.9, file_index, total_files)
    
    update_progress(f"Completed {normalized_name}", 1.0, file_index, total_files)

# Replace the extract_vocals function to accept a progress callback
def extract_vocals(wav_path, normalized_name, progress_callback=None):
    """Extract vocals from WAV file using the AI model."""
    print(f"Extracting vocals from {wav_path} using Vocal...")
    
    try:
        # Make sure directories exist (1%)
        UVR_RAW_DIR.mkdir(exist_ok=True, parents=True)
        INSTRUMENTAL_DIR.mkdir(exist_ok=True, parents=True)
        if progress_callback:
            progress_callback(0.01)
        
        # Load audio file (10%)
        print("Loading audio file...")
        audio, sr = librosa.load(str(wav_path), sr=44100, mono=False)
        if progress_callback:
            progress_callback(0.1)
        
        # Initialize model (20%)
        print("Initializing model...")
        import torch
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
        print(f"Using device: {device}")
        model = get_model(device)
        if progress_callback:
            progress_callback(0.2)
        
        # Separate vocals (20% -> 70%)
        print("Separating vocals...")
        separated_vocals = separate_vocal(model, audio, device, silent=False)
        if progress_callback:
            progress_callback(0.7)
        
        # Save vocals (70% -> 80%)
        print("Saving vocals...")
        vocals_path = UVR_RAW_DIR / f"{normalized_name}_vocals.wav"
        sf.write(vocals_path, separated_vocals.T, sr)
        if progress_callback:
            progress_callback(0.8)
        
        # Process and save instrumental (80% -> 100%)
        print("Creating instrumental...")
        # Shape matching code...
        if len(audio.shape) == 1:
            audio = np.expand_dims(audio, axis=0)
        elif audio.shape[0] > 2:
            audio = audio[:2]
        elif len(audio.shape) == 2 and audio.shape[0] < 2:
            audio = np.repeat(audio, 2, axis=0)
        
        if progress_callback:
            progress_callback(0.9)
            
        # Match shapes and create instrumental
        if separated_vocals.shape[1] > audio.shape[1]:
            separated_vocals = separated_vocals[:, :audio.shape[1]]
        elif separated_vocals.shape[1] < audio.shape[1]:
            audio = audio[:, :separated_vocals.shape[1]]
            
        instrumental = audio - separated_vocals
        
        # Save instrumental
        instrumental_path = INSTRUMENTAL_DIR / f"{normalized_name}_instrumental.wav"
        sf.write(instrumental_path, instrumental.T, sr)
        
        print(f"  [OK] Vocals extracted: {vocals_path.name}")
        print(f"  [OK] Instrumental extracted: {instrumental_path.name}")
        
        if progress_callback:
            progress_callback(1.0)
            
        return vocals_path, instrumental_path
            
    except Exception as e:
        print(f"Error extracting vocals: {e}")
        raise

def show_clean_menu():
    """Show menu for cleaning options"""
    print("\n" + "="*48)
    print("              CLEANUP MENU")
    print("="*48)
    
    print("\nWould you like to clean the working directories?")
    print("1. Clean all directories (including input files)")
    print("2. Clean output directories only (keep input files)")
    print("3. Don't clean anything and exit")
    
    while True:
        choice = input("\nEnter your choice (1-3): ").strip()
        if choice in ['1', '2', '3']:
            break
        print("Invalid choice. Please enter 1, 2, or 3.")
    
    if choice == '1':
        clean_directories(include_input=True)
        return True, True  # Cleaned and include_input
    elif choice == '2':
        clean_directories(include_input=False)
        return True, False  # Cleaned but didn't include_input
    else:
        return False, False  # Didn't clean anything

def show_menu():
    print("\n" + "="*48)
    print("     VOCAL EXTRACTION AND PROCESSING MENU")
    print("="*48)
    
    # Option 1: Segmentation
    print("\nDo you want to cut audio into segments?")
    print("1. Yes - Cut vocals into separate phrase segments")
    print("2. No - Keep vocals as one complete file")
    print("3. Exit - Quit without processing")
    
    while True:
        segment_choice = input("\nEnter your choice (1-3): ").strip()
        if segment_choice in ['1', '2', '3']:
            break
        print("Invalid choice. Please enter 1, 2, or 3.")
    
    if segment_choice == '3':
        print("Exiting without processing.")
        exit()
        
    segment_audio = segment_choice == '1'
    
    # Option 2: Processing
    print("\nDo you want to apply audio processing to the vocals?")
    print("1. Yes - Apply noise reduction and normalization")
    print("2. No - Keep raw separated vocals without processing")
    print("3. Exit - Quit without processing")
    
    while True:
        process_choice = input("\nEnter your choice (1-3): ").strip()
        if process_choice in ['1', '2', '3']:
            break
        print("Invalid choice. Please enter 1, 2, or 3.")
    
    if process_choice == '3':
        print("Exiting without processing.")
        exit()
        
    process_audio = process_choice == '1'
    
    # Option 3: Dataset Export
    print("\nDo you want to prepare a dataset export as ZIP files?")
    print("1. Yes - Create ZIP archives of the processed files")
    print("2. No - Skip export")
    print("3. Exit - Quit without processing")
    
    while True:
        export_choice = input("\nEnter your choice (1-3): ").strip()
        if export_choice in ['1', '2', '3']:
            break
        print("Invalid choice. Please enter 1, 2, or 3.")
    
    if export_choice == '3':
        print("Exiting without processing.")
        exit()
        
    export_data = export_choice == '1'
    
    # Option 4: Clean After Processing
    print("\nDo you want to clean up working directories after processing?")
    print("1. Yes - Remove temporary files after processing")
    print("2. No - Keep all files")
    print("3. Exit - Quit without processing")
    
    while True:
        clean_choice = input("\nEnter your choice (1-3): ").strip()
        if clean_choice in ['1', '2', '3']:
            break
        print("Invalid choice. Please enter 1, 2, or 3.")
    
    if clean_choice == '3':
        print("Exiting without processing.")
        exit()
        
    clean_after = clean_choice == '1'
    
    return segment_audio, process_audio, export_data, clean_after

def parse_args():
    parser = argparse.ArgumentParser(description='Vocal separation and processing')
    parser.add_argument('--segment', action='store_true', help='Cut vocals into segments')
    parser.add_argument('--no-segment', dest='segment', action='store_false', help='Keep vocals as complete files')
    parser.add_argument('--process', action='store_true', help='Apply audio processing')
    parser.add_argument('--no-process', dest='process', action='store_false', help='Keep raw vocals without processing')
    parser.add_argument('--export', action='store_true', help='Create dataset exports')
    parser.add_argument('--no-export', dest='export', action='store_false', help='Skip dataset export')
    parser.add_argument('--clean', action='store_true', help='Clean directories after processing')
    parser.add_argument('--no-clean', dest='clean', action='store_false', help='Keep all files after processing')
    parser.add_argument('--use-menu', action='store_true', help='Show interactive menu instead of using arguments')
    parser.add_argument('--clean-only', action='store_true', help='Just clean directories and exit')
    
    parser.set_defaults(segment=True, process=True, export=False, clean=False, use_menu=False, clean_only=False)
    return parser.parse_args()

if __name__ == "__main__":
    args = parse_args()
    
    # Check if we should run the clean-only mode
    if args.clean_only:
        cleaned, _ = show_clean_menu()
        if cleaned:
            print("Cleanup complete. Exiting.")
        else:
            print("No cleaning performed. Exiting.")
        exit()
    
    # Check if directories have existing content and offer to clean
    if directories_have_content():
        print("\nExisting files detected in working directories.")
        
        if args.use_menu:
            # Ask user if they want to clean or continue
            print("What would you like to do?")
            print("1. Clean directories and start fresh")
            print("2. Continue with existing files")
            
            while True:
                choice = input("\nEnter your choice (1-2): ").strip()
                if choice in ['1', '2']:
                    break
                print("Invalid choice. Please enter 1 or 2.")
            
            if choice == '1':
                cleaned, _ = show_clean_menu()
                if cleaned:
                    print("Directories cleaned. Continuing with processing.")
                else:
                    print("No cleaning performed. Continuing with existing files.")
        else:
            # When using command line, just warn
            print("Warning: Using existing files in directories. Use --clean-only to clean first.")
    
    if args.use_menu:
        segment_audio, process_audio, export_data, clean_after = show_menu()
    else:
        segment_audio, process_audio, export_data, clean_after = args.segment, args.process, args.export, args.clean
        
    # Display what will happen
    action_msg = "Will "
    if segment_audio:
        action_msg += "separate vocals AND cut into segments"
    else:
        action_msg += "separate vocals only (no segmentation)"
        
    if process_audio:
        action_msg += " WITH audio processing"
    else:
        action_msg += " WITHOUT audio processing"
        
    if export_data:
        action_msg += " AND create dataset exports"
        
    if clean_after:
        action_msg += " AND clean directories after processing"
    
    print(action_msg)
    
    # Confirm if not using command line arguments
    if args.use_menu:
        confirm = input("\nProceed? (y/n): ").lower()
        if confirm != 'y':
            print("Operation cancelled.")
            exit()
    
    process_all(segment_audio, process_audio, export_data, clean_after)

def process_vocal_file(normalized_name):
    """Process a vocal file to improve quality."""
    # Build all paths
    input_path = UVR_RAW_DIR / f"{normalized_name}_vocals.wav"
    dechoir_path = UVR_PROCESSED_DIR / f"{normalized_name}_vocals_dechoir.wav"
    denoised_path = UVR_PROCESSED_DIR / f"{normalized_name}_denoised.wav"
    processed_path = UVR_PROCESSED_DIR / f"{normalized_name}_vocals.wav"
    
    # Log all paths for debugging
    print(f"\n=== Processing vocal file ===")
    print(f"Normalized name: {normalized_name}")
    print(f"Input path:      {input_path}")
    print(f"Dechoir path:    {dechoir_path}")
    print(f"Denoised path:   {denoised_path}")
    print(f"Output path:     {processed_path}")
    print(f"Input path exists: {input_path.exists()}")
    print(f"===========================\n")
    
    # Make sure output directory exists
    UVR_PROCESSED_DIR.mkdir(exist_ok=True, parents=True)
    
    # Check if input file exists
    if not input_path.exists():
        # Try to look for files with similar names
        potential_files = list(UVR_RAW_DIR.glob(f"*_vocals.wav"))
        print(f"ERROR: Input file not found: {input_path}")
        print(f"Available files in {UVR_RAW_DIR}:")
        for f in potential_files:
            print(f"  - {f.name}")
        raise FileNotFoundError(f"Vocal file not found: {input_path}")
    
    # 1. Apply de-choir processing (convert to mono, remove backing vocals)
    # Using technique from the working version
    print(f"Applying de-choir processing to {input_path.name}...")
    dechoir_cmd = [
        "ffmpeg", "-y", "-i", str(input_path),
        "-af", "pan=mono|c0=0.5*c0+0.5*c1,equalizer=f=200:t=q:w=1:g=-2,equalizer=f=3000:t=q:w=1:g=3,equalizer=f=6000:t=q:w=1:g=-1,compand=0.3|0.3:1|1:-90/-60|-60/-40|-40/-30|-20/-20:6:0:-90:0.2",
        "-ar", "44100", "-ac", "1", str(dechoir_path)
    ]
    subprocess.run(dechoir_cmd, check=True)
    
    # 2. Apply noise reduction and normalization based on working version
    print(f"Applying noise reduction to {dechoir_path.name}...")
    filter_args = "afftdn=nf=-25,areverse,afftdn=nf=-25,areverse,highpass=f=80,lowpass=f=12000"
    denoise_cmd = [
        "ffmpeg", "-y", "-i", str(dechoir_path),
        "-af", filter_args,
        str(denoised_path)
    ]
    subprocess.run(denoise_cmd, check=True)
    
    # 3. Final processing - normalization (from working version)
    print(f"Normalizing volume for {denoised_path.name}...")
    final_cmd = [
        "ffmpeg", "-y", "-i", str(denoised_path),
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", 
        str(processed_path)
    ]
    subprocess.run(final_cmd, check=True)
    
    print(f"[SUCCESS] Successfully processed vocal: {processed_path}")
    return processed_path

# Define the missing uv_separate function
def uv_separate(file_path, file_index, total_files):
    """Extract vocals from audio file using the Ultimate Vocal Remover."""
    base_name = file_path.stem
    
    update_progress(f"Converting {file_path.name} to WAV format...", 0.1, file_index, total_files)
    
    # Get the normalized filename (without extension)
    normalized_name = base_name
    
    # Convert to WAV if not already in that format
    if file_path.suffix.lower() != '.wav':
        TEMP_WAV_DIR.mkdir(exist_ok=True, parents=True)
        wav_path = TEMP_WAV_DIR / f"{normalized_name}.wav"
        
        try:
            # Convert using ffmpeg
            convert_cmd = [
                "ffmpeg", "-y", "-i", str(file_path),
                "-ar", "44100", "-ac", "2", str(wav_path)
            ]
            subprocess.run(convert_cmd, check=True)
            print(f"Converted to WAV: {wav_path}")
            
            # Update the file_path to use the WAV version
            audio_path = wav_path
        except Exception as e:
            print(f"Error converting to WAV: {e}")
            # If conversion fails, try to use the original file
            audio_path = file_path
    else:
        audio_path = file_path
    
    # Extract vocals using the updated extract_vocals function
    update_progress(f"Extracting vocals from {normalized_name}...", 0.2, file_index, total_files)
    try:
        # Create a progress callback for the vocal extraction
        progress_cb = ProgressCallback(100, f"Extracting vocals", file_index, total_files)
        
        # Call the extract_vocals function
        vocals_path, instrumental_path = extract_vocals(
            audio_path, 
            normalized_name, 
            progress_callback=progress_cb
        )
        
        update_progress(f"Successfully extracted vocals for {normalized_name}", 0.4, file_index, total_files)
        return vocals_path
    except Exception as e:
        print(f"Error extracting vocals: {e}")
        logger.error(f"Error extracting vocals: {e}")
        logger.error(traceback.format_exc())
        raise
