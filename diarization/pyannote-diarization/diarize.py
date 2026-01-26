import os
import sys
import traceback
from pathlib import Path
import time
import json

# Add the parent directory to sys.path to import check_dependencies
script_dir = Path(__file__).resolve().parent
parent_dir = script_dir.parent
sys.path.append(str(parent_dir))

# Add root directory to import Config
root_dir = parent_dir.parent
sys.path.append(str(root_dir))

# Try to import dependencies checker
try:
    from check_dependencies import check_and_install_dependencies
except ImportError:
    print("ERROR: Failed to import dependency checker. Continuing without checks.")
    check_and_install_dependencies = lambda: True

# Try to import Config
try:
    from app.config import Config
except ImportError:
    print("ERROR: Failed to import Config. Will use hardcoded paths.")
    # Define a dummy Config class if import fails
    class Config:
        BASE_DIR = Path(__file__).resolve().parent.parent.parent
        DATA_DIR = BASE_DIR / "data"
        TALKING_DIR = DATA_DIR / "talking"
        TALKING_UPLOADS_DIR = TALKING_DIR / "uploads"  
        TALKING_RESULTS_DIR = TALKING_DIR / "results"
        ORIGINAL_AUDIO_DIR = DATA_DIR / "originals"

# Check dependencies before importing pyannote
if not check_and_install_dependencies():
    print("ERROR: Failed to ensure all dependencies are installed.")
    print("Please run: pip install torch==2.0.1 torchaudio==2.0.2 torchvision==0.15.2 pyannote.audio==2.1.1 pytorch-lightning==2.0.6 pydub==0.25.1 python-dotenv==1.0.0")
    sys.exit(1)

try:
    # Import pyannote and other dependencies after checking
    from pyannote.audio import Pipeline
    from dotenv import load_dotenv
    from pydub import AudioSegment
    import re
    import unicodedata
    import shutil
except ImportError as e:
    print(f"ERROR: Error importing required modules: {str(e)}")
    print("Please ensure all dependencies are installed correctly.")
    sys.exit(1)

# === ENV ===
script_dir = Path(__file__).resolve().parent
dotenv_path = script_dir / "config" / ".env"
load_dotenv(dotenv_path)
HUGGINGFACE_TOKEN = os.getenv("HUGGINGFACE_TOKEN")

if not HUGGINGFACE_TOKEN:
    print("ERROR: Missing Hugging Face token. Add it to config/.env as HUGGINGFACE_TOKEN=your_token_here")
    sys.exit(1)

if len(sys.argv) < 2:
    print("ERROR: No input file provided.")
    sys.exit(1)

# Define the slugify function before it's used
def slugify(value, max_length=50):
    value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode('ascii')
    value = re.sub(r'[^\w\s-]', '', value).strip().lower()
    value = re.sub(r'[-\s]+', '_', value)
    return value[:max_length]

def extract_original_filename(path):
    """Extract original filename from path which might contain UUID"""
    filename = os.path.basename(path)
    # Check if this is a tagged filename (contains __jobid_)
    if "__jobid_" in filename:
        original_part = filename.split("__jobid_")[0]
        return original_part
    return filename

input_path = sys.argv[1]
if not os.path.exists(input_path):
    print(f"ERROR: File not found: {input_path}")
    sys.exit(1)

# === AUDIO PREP ===
ext = os.path.splitext(input_path)[1].lower()
if ext == ".mp3":
    print("Converting MP3 to WAV...")
    audio = AudioSegment.from_mp3(input_path)
    temp_wav = "temp_input.wav"
    audio.export(temp_wav, format="wav")
    audio_path = temp_wav
else:
    audio_path = input_path

# === CHECK FOR SEPARATED VOCALS ===
# Extract the base filename to check for a vocals track
base_filename = os.path.splitext(os.path.basename(input_path))[0]
safe_foldername = slugify(base_filename)

# First check for vocals file directly in data\talking\temp directory
vocals_path = None
data_temp_dir = str(Config.TALKING_DIR / "temp")
talking_temp_dir = Config.TALKING_DIR / "temp"
talking_temp_dir.mkdir(exist_ok=True, parents=True)

# Try both with original filename and with safe_foldername
direct_vocals_paths = [
    os.path.join(data_temp_dir, f"{base_filename}_vocals.wav"),
    str(talking_temp_dir / f"{base_filename}_vocals.wav"),
    os.path.join(data_temp_dir, f"{safe_foldername}_vocals.wav"),
    str(talking_temp_dir / f"{safe_foldername}_vocals.wav")
]

# Check these direct paths first
for direct_path in direct_vocals_paths:
    if os.path.exists(direct_path):
        vocals_path = direct_path
        print(f"FOUND SEPARATED VOCALS IN DATA TEMP DIRECTORY: {vocals_path}")
        break

# If not found directly, check in the same directory as the input file
if not vocals_path:
    input_dir = os.path.dirname(input_path)
    direct_vocals_path = os.path.join(input_dir, f"{base_filename}_vocals.wav")
    
    if os.path.exists(direct_vocals_path):
        vocals_path = direct_vocals_path
        print(f"FOUND SEPARATED VOCALS IN SAME DIRECTORY: {vocals_path}")
    else:
        # If not found in the same directory or data\talking\temp, check standard locations
        possible_vocal_paths = [
            talking_temp_dir / f"{base_filename}_vocals.wav",
            talking_temp_dir / f"{safe_foldername}_vocals.wav",
            Path(f"../../data/talking/temp/{base_filename}_vocals.wav"),
            Path(f"../../data/talking/temp/{safe_foldername}_vocals.wav"),
            Path(f"../temp/{base_filename}_vocals.wav"),
            Path(f"../temp/{safe_foldername}_vocals.wav"),
            Path(f"temp/{base_filename}_vocals.wav"),
            Path(f"temp/{safe_foldername}_vocals.wav")
        ]
        
        # Check all possible paths for vocals file
        for path in possible_vocal_paths:
            if path.exists():
                vocals_path = str(path)
                print(f"FOUND SEPARATED VOCALS: {vocals_path}")
                break

# Use vocals for diarization if available, otherwise use original audio
diarization_audio_path = vocals_path if vocals_path else audio_path
print(f"Running diarization on {'VOCALS' if vocals_path else 'ORIGINAL AUDIO'}: {diarization_audio_path}")

# === DIARIZATION ===
pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization", use_auth_token=HUGGINGFACE_TOKEN)
diarization = pipeline(diarization_audio_path)

# Ensure output directory exists
output_dir = Config.TALKING_RESULTS_DIR
output_dir.mkdir(exist_ok=True, parents=True)

filename = os.path.splitext(os.path.basename(input_path))[0]
filename = re.sub(r'[\\/*?:"<>|]', "_", filename)[:100]
output_txt = str(output_dir / f"{filename}_diarization.txt")

with open(output_txt, "w") as f:
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        f.write(f"[{turn.start:.2f} - {turn.end:.2f}] {speaker}\n")

print(f"SUCCESS: Diarization saved to: {output_txt}")

# === SPLIT BY SPEAKER ===
print("INFO: Splitting audio by speaker...")

# When creating the output folder name
filename = os.path.basename(input_path)
original_filename = extract_original_filename(filename)
safe_foldername = slugify(original_filename)
output_folder = str(output_dir / safe_foldername)

os.makedirs(output_folder, exist_ok=True)

# Load the audio to use for segment extraction
# First check for vocals file directly in data\talking\temp directory
data_temp_dir = str(Config.TALKING_DIR / "temp")
talking_temp_dir = Config.TALKING_DIR / "temp"
base_filename_for_audio = os.path.splitext(os.path.basename(input_path))[0]
safe_name_for_audio = slugify(base_filename_for_audio)

# Check for vocals in talking temp directory
direct_vocals_paths = [
    os.path.join(data_temp_dir, f"{base_filename_for_audio}_vocals.wav"),
    str(talking_temp_dir / f"{base_filename_for_audio}_vocals.wav"),
    os.path.join(data_temp_dir, f"{safe_name_for_audio}_vocals.wav"),
    str(talking_temp_dir / f"{safe_name_for_audio}_vocals.wav")
]

# Check for vocals files
audio_for_segments = None
for direct_path in direct_vocals_paths:
    if os.path.exists(direct_path):
        audio_for_segments = direct_path
        print(f"Using vocals from TALKING TEMP DIRECTORY for segment extraction: {audio_for_segments}")
        break

# If not found in talking temp, check in same directory
if not audio_for_segments:
    input_dir = os.path.dirname(audio_path)
    direct_vocals_path = os.path.join(input_dir, f"{base_filename_for_audio}_vocals.wav")
    
    if os.path.exists(direct_vocals_path):
        audio_for_segments = direct_vocals_path
        print(f"Using vocals from same directory for segment extraction: {audio_for_segments}")
    else:
        # If still not found, use whatever vocals path was found earlier or fall back to original audio
        audio_for_segments = vocals_path if vocals_path else audio_path
        print(f"Loading audio for segment extraction: {audio_for_segments}")

audio = AudioSegment.from_wav(audio_for_segments)

# After loading the audio file and before processing segments
audio_length_ms = len(audio)  # Total duration in milliseconds

# Create a list to store all identified segments
segments = []
with open(output_txt, "r", encoding="utf-8") as f:
    for line in f:
        match = re.match(r"\[(\d+\.\d+) - (\d+\.\d+)\] (SPEAKER_\d+)", line.strip())
        if match:
            start, end, speaker = match.groups()
            start_ms = int(float(start) * 1000)
            end_ms = int(float(end) * 1000)
            segments.append((start_ms, end_ms, speaker))

# Sort segments by start time
segments.sort(key=lambda x: x[0])

# Create the unknown speaker directory
unknown_speaker = "speaker_unknown"
unknown_dir = os.path.join(output_folder, unknown_speaker.lower())
os.makedirs(unknown_dir, exist_ok=True)
unknown_counter = 0

# Find gaps between segments
current_pos = 0
for start_ms, end_ms, speaker in segments:
    # If there's a gap between current position and the start of this segment
    if start_ms > current_pos:
        # This is an unknown/gap segment
        unknown_counter += 1
        
        # Format timestamps for filename - include milliseconds for more precision
        start_seconds = current_pos / 1000.0
        end_seconds = start_ms / 1000.0
        
        # Include both rounded minutes/seconds format and precise decimal seconds
        start_mins = int(start_seconds // 60)
        start_secs = int(start_seconds % 60)
        end_mins = int(end_seconds // 60)
        end_secs = int(end_seconds % 60)
        
        # Create filename with both formats of timestamp info for compatibility
        filename = f"part{unknown_counter}_{start_mins:02d}m{start_secs:02d}s-{end_mins:02d}m{end_secs:02d}s_{start_seconds:.3f}s-{end_seconds:.3f}s.wav"
        part_path = os.path.join(unknown_dir, filename)
        
        # Extract the gap segment
        gap_segment = audio[current_pos:start_ms]
        
        # Only save if the gap is significant (e.g., longer than 500ms)
        if len(gap_segment) > 500:
            gap_segment.export(part_path, format="wav")
            print(f"SAVED UNKNOWN GAP: {part_path} ({current_pos}ms - {start_ms}ms)")
    
    # Update current position to the end of this segment
    current_pos = max(current_pos, end_ms)

# Check for gap at the end of the audio
if current_pos < audio_length_ms:
    unknown_counter += 1
    
    # Format timestamps for filename - include milliseconds for more precision
    start_seconds = current_pos / 1000.0
    end_seconds = audio_length_ms / 1000.0
    
    # Include both rounded minutes/seconds format and precise decimal seconds
    start_mins = int(start_seconds // 60)
    start_secs = int(start_seconds % 60)
    end_mins = int(end_seconds // 60)
    end_secs = int(end_seconds % 60)
    
    # Create filename with both formats of timestamp info for compatibility
    filename = f"part{unknown_counter}_{start_mins:02d}m{start_secs:02d}s-{end_mins:02d}m{end_secs:02d}s_{start_seconds:.3f}s-{end_seconds:.3f}s.wav"
    part_path = os.path.join(unknown_dir, filename)
    
    # Extract the final gap segment
    final_gap = audio[current_pos:audio_length_ms]
    
    # Only save if the gap is significant
    if len(final_gap) > 500:
        final_gap.export(part_path, format="wav")
        print(f"SAVED UNKNOWN GAP: {part_path} ({current_pos}ms - {audio_length_ms}ms)")

# Then continue with the regular speaker processing
counters = {}
for start_ms, end_ms, speaker in segments:
    speaker_dir = os.path.join(output_folder, speaker.lower())
    os.makedirs(speaker_dir, exist_ok=True)

    counters.setdefault(speaker, 0)
    counters[speaker] += 1

    # Format timestamps for filename - include milliseconds for precision
    start_seconds = start_ms / 1000.0
    end_seconds = end_ms / 1000.0
    
    # Include both rounded minutes/seconds format and precise decimal seconds
    start_mins = int(start_seconds // 60)
    start_secs = int(start_seconds % 60)
    end_mins = int(end_seconds // 60)
    end_secs = int(end_seconds % 60)
    
    # Create filename with both formats of timestamp info for compatibility
    filename = f"part{counters[speaker]}_{start_mins:02d}m{start_secs:02d}s-{end_mins:02d}m{end_secs:02d}s_{start_seconds:.3f}s-{end_seconds:.3f}s.wav"
    part_path = os.path.join(speaker_dir, filename)

    segment = audio[start_ms:end_ms]
    segment.export(part_path, format="wav")
    print(f"SAVED: {part_path}")

# === CLEANUP TEMP ===
if os.path.exists("temp_input.wav"):
    os.remove("temp_input.wav")

# === MAIN EXECUTION ===
if __name__ == "__main__":
    # Add handling for files uploaded through the web interface
    use_uploaded_file = len(sys.argv) > 2 and sys.argv[2] == "--uploaded"
    
    if use_uploaded_file:
        # For uploaded files, we'll copy them to a specific directory for processing
        uploads_dir = str(Config.TALKING_UPLOADS_DIR)
        os.makedirs(uploads_dir, exist_ok=True)
        
        # Copy the input file to the uploads directory
        filename = os.path.basename(input_path)
        uploaded_path = os.path.join(uploads_dir, filename)
        shutil.copy2(input_path, uploaded_path)
        
        # Update the input path to use the copied file
        input_path = uploaded_path

    # If this was an uploaded file, we'll store the output in a specific location
    if use_uploaded_file:
        # Create a specific output directory for uploaded files
        web_output_dir = str(Config.TALKING_RESULTS_DIR)
        os.makedirs(web_output_dir, exist_ok=True)
        
        # Copy the output text file to the web output directory
        web_output_txt = os.path.join(web_output_dir, f"{filename}_diarization.txt")
        shutil.copy2(output_txt, web_output_txt)
        
        # Also update the output folder for the split audio
        output_folder = os.path.join(web_output_dir, safe_foldername)

    print("SUCCESS: Done! Speaker folders created.")

# Add near the beginning of the script, before any functions are defined
start_time = time.time()  # Add this line to track processing time
logs = []  # Initialize logs list if it doesn't exist

def update_progress(output_dir, percent, stage):
    """Update the progress file"""
    progress_file = Path(output_dir) / "progress.json"
    progress_data = {
        "percent": percent,
        "stage": stage,
        "current_time": time.strftime("%H:%M:%S"),
        "elapsed": f"{time.time() - start_time:.2f}s",
        "logs": logs
    }
    
    try:
        with open(progress_file, "w") as f:
            json.dump(progress_data, f, indent=2)
    except Exception as e:
        print(f"Error updating progress: {e}")

# Then add progress updates at key points in the code
# For example, before loading the model:
update_progress(output_folder, 40, "Loading speaker diarization model")

# Before running diarization:
update_progress(output_folder, 50, "Running speaker diarization")

# When processing segments:
update_progress(output_folder, 70, "Processing speaker segments")

# For creating segments - add this inside the speaker splitting loop:
segments = []
with open(output_txt, "r", encoding="utf-8") as f:
    for line in f:
        match = re.match(r"\[(\d+\.\d+) - (\d+\.\d+)\] (SPEAKER_\d+)", line.strip())
        if match:
            segments.append(match.groups())

# Track progress during segment processing
segment_index = 0
for segment in segments:
    start, end, speaker = segment
    start_ms = int(float(start) * 1000)
    end_ms = int(float(end) * 1000)

    speaker_dir = os.path.join(output_folder, speaker.lower())
    os.makedirs(speaker_dir, exist_ok=True)

    counters.setdefault(speaker, 0)
    counters[speaker] += 1

    # Format timestamps for filename - include milliseconds for precision
    start_seconds = start_ms / 1000.0
    end_seconds = end_ms / 1000.0
    
    # Include both rounded minutes/seconds format and precise decimal seconds
    start_mins = int(start_seconds // 60)
    start_secs = int(start_seconds % 60)
    end_mins = int(end_seconds // 60)
    end_secs = int(end_seconds % 60)
    
    # Create filename with both formats of timestamp info for compatibility
    filename = f"part{counters[speaker]}_{start_mins:02d}m{start_secs:02d}s-{end_mins:02d}m{end_secs:02d}s_{start_seconds:.3f}s-{end_seconds:.3f}s.wav"
    part_path = os.path.join(speaker_dir, filename)

    segment = audio[start_ms:end_ms]
    segment.export(part_path, format="wav")
    print(f"SAVED: {part_path}")
    
    # Update progress periodically
    segment_index += 1
    if segment_index % 5 == 0 or segment_index == len(segments):
        progress = 70 + min(25, (segment_index / max(1, len(segments))) * 25)
        update_progress(output_folder, progress, f"Processed {segment_index}/{len(segments)} segments")

# At the end:
update_progress(output_folder, 95, "Finalizing results")
