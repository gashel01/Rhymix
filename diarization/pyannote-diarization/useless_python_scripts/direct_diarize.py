import os
import sys
import time
import argparse
import json
from pathlib import Path
import torch
from pydub import AudioSegment
from dotenv import load_dotenv

# Start timing
start_time = time.time()

# Set up logging
logs = []

def log_message(message, level="INFO"):
    """Log a message with timing information"""
    elapsed = time.time() - start_time
    entry = {
        "time": time.strftime("%H:%M:%S"),
        "elapsed": f"{elapsed:.2f}s",
        "level": level,
        "message": message
    }
    logs.append(entry)
    print(f"[{level}] {message}")
    return entry

# Load environment variables
script_dir = Path(__file__).resolve().parent
config_path = script_dir / "config" / ".env"
load_dotenv(config_path)

# Get HF token
HF_TOKEN = os.getenv("HUGGINGFACE_TOKEN")
if not HF_TOKEN:
    log_message("No Hugging Face token found in config/.env", "ERROR")
    sys.exit(1)

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
        log_message(f"Error updating progress: {e}", "ERROR")

def handle_audio(audio_path, output_dir):
    """Process the audio file for diarization"""
    try:
        log_message(f"Processing audio file: {audio_path}")
        update_progress(output_dir, 25, "Preparing audio for diarization")
        
        # Import needed modules
        from pydub import AudioSegment
        
        # Check if audio needs conversion from MP3 to WAV
        if audio_path.suffix.lower() == ".mp3":
            temp_wav = output_dir / "temp_input.wav"
            log_message("Converting MP3 to WAV")
            audio = AudioSegment.from_mp3(audio_path)
            audio.export(temp_wav, format="wav")
            audio_path = temp_wav
            log_message("Conversion complete")
            
        # Check for separated vocals track
        log_message("Checking for separated vocals track...")
        
        # First check for vocals file directly in data\talking\temp directory
        base_filename = audio_path.stem
        safe_name = base_filename.replace(" ", "_").lower()
        
        # Check in data\talking\temp with both path styles
        data_temp_dir = os.path.join("data", "talking", "temp")
        win_style_temp_dir = os.path.join("data\\talking\\temp")
        
        # Try both with original filename and with safe_foldername
        direct_vocals_paths = [
            os.path.join(data_temp_dir, f"{base_filename}_vocals.wav"),
            os.path.join(win_style_temp_dir, f"{base_filename}_vocals.wav"),
            os.path.join(data_temp_dir, f"{safe_name}_vocals.wav"),
            os.path.join(win_style_temp_dir, f"{safe_name}_vocals.wav")
        ]
        
        vocals_path = None
        # Check these direct paths first
        for direct_path in direct_vocals_paths:
            if os.path.exists(direct_path):
                vocals_path = direct_path
                log_message(f"FOUND SEPARATED VOCALS IN DATA TEMP DIRECTORY: {vocals_path}")
                break
        
        # If not found directly, check in the same directory as the input file
        if not vocals_path:
            input_dir = audio_path.parent
            direct_vocals_path = input_dir / f"{base_filename}_vocals.wav"
            
            if direct_vocals_path.exists():
                vocals_path = direct_vocals_path
                log_message(f"Found separated vocals in same directory: {vocals_path}")
            else:
                # Check for vocals in standard locations
                possible_vocal_paths = [
                    Path(f"data/talking/temp/{base_filename}_vocals.wav"),  # Try with original name first
                    Path(f"data/talking/temp/{safe_name}_vocals.wav"),
                    Path(f"../../data/talking/temp/{base_filename}_vocals.wav"),
                    Path(f"../../data/talking/temp/{safe_name}_vocals.wav"),
                    Path(f"../temp/{base_filename}_vocals.wav"),
                    Path(f"../temp/{safe_name}_vocals.wav"),
                    Path(f"temp/{base_filename}_vocals.wav"),
                    Path(f"temp/{safe_name}_vocals.wav")
                ]
                
                # Check all possible locations
                for path in possible_vocal_paths:
                    if path.exists():
                        vocals_path = str(path)
                        log_message(f"Found separated vocals track: {vocals_path}")
                        break
        
        # Use vocals track if available, otherwise use original audio
        diarization_audio_path = vocals_path if vocals_path else audio_path
        log_message(f"Using {'SEPARATED VOCALS' if vocals_path else 'ORIGINAL AUDIO'} for diarization: {diarization_audio_path}")
        
        update_progress(output_dir, 30, "Loading diarization model")
        
        # Import here to avoid loading PyAnnote until needed
        log_message("Importing pyannote.audio")
        from pyannote.audio import Pipeline
        log_message("Checking model availability...")
        
        # Load the pipeline
        log_message("Loading diarization pipeline (this may take a while)")
        update_progress(output_dir, 40, "Loading speaker diarization model")
        
        pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization", 
            use_auth_token=HF_TOKEN
        )
        
        # Move to GPU if available
        if torch.cuda.is_available():
            log_message(f"Using GPU: {torch.cuda.get_device_name(0)}")
            pipeline = pipeline.to("cuda")
        else:
            log_message("No GPU available, using CPU (this will be slower)")
            
        log_message("Model loaded successfully")
        update_progress(output_dir, 50, "Running speaker diarization")
        
        # Process the audio
        diarization = pipeline(str(diarization_audio_path))
        
        # Create output directories
        speakers_dir = Path(output_dir) / "speakers"
        speakers_dir.mkdir(exist_ok=True, parents=True)
        
        # Save diarization results
        output_file = Path(output_dir) / "diarization.txt"
        
        # Process segments and extract audio
        log_message("Processing diarization results")
        update_progress(output_dir, 70, "Processing speaker segments")
        
        speakers_data = {}
        segment_index = 0
        
        # Use the same audio source for segment extraction as for diarization
        extraction_audio_path = diarization_audio_path
        log_message(f"Loading audio for segment extraction: {extraction_audio_path}")
        audio = AudioSegment.from_file(extraction_audio_path)
        
        # Get all segments in a list first so we can calculate progress properly
        segments = [(turn, _, speaker) for turn, _, speaker in diarization.itertracks(yield_label=True)]
        total_segments = len(segments)
        log_message(f"Found {total_segments} segments to process")
        
        with open(output_file, "w") as f:
            for turn, _, speaker in segments:
                # Write to diarization file
                f.write(f"[{turn.start:.2f} - {turn.end:.2f}] {speaker}\n")
                
                # Extract and save audio segment
                speaker_dir = speakers_dir / speaker
                speaker_dir.mkdir(exist_ok=True)
                
                # Track speaker stats
                if speaker not in speakers_data:
                    speakers_data[speaker] = {"count": 0, "duration": 0}
                
                speakers_data[speaker]["count"] += 1
                speakers_data[speaker]["duration"] += (turn.end - turn.start)
                
                # Extract segment audio
                start_ms = int(turn.start * 1000)
                end_ms = int(turn.end * 1000)
                segment_audio = audio[start_ms:end_ms]
                
                # Format timestamps for filename - include minutes/seconds format
                start_mins = int(turn.start // 60)
                start_secs = int(turn.start % 60)
                end_mins = int(turn.end // 60)
                end_secs = int(turn.end % 60)
                
                # Create filename with both timestamp formats for compatibility
                segment_file = speaker_dir / f"{speaker}_{segment_index:04d}_{start_mins:02d}m{start_secs:02d}s-{end_mins:02d}m{end_secs:02d}s_{turn.start:.3f}s-{turn.end:.3f}s.wav"
                segment_audio.export(segment_file, format="wav")
                segment_index += 1
                
                # Update progress periodically
                if segment_index % 10 == 0:
                    progress = 70 + min(25, (segment_index / max(1, total_segments)) * 25)
                    update_progress(output_dir, progress, f"Processed {segment_index}/{total_segments} segments")
        
        # Save speakers data
        speakers_file = Path(output_dir) / "speakers.json"
        with open(speakers_file, "w") as f:
            json.dump(speakers_data, f, indent=2)
        
        log_message(f"Diarization completed with {len(speakers_data)} speakers and {segment_index} segments")
        update_progress(output_dir, 95, "Finalizing results")
        
        # Clean up temp file if created
        if audio_path.name == "temp_input.wav" and audio_path.exists():
            os.remove(audio_path)
            log_message("Removed temporary WAV file")
        
        return True
        
    except Exception as e:
        log_message(f"Error in diarization: {str(e)}", "ERROR")
        import traceback
        log_message(traceback.format_exc(), "ERROR")
        update_progress(output_dir, 0, f"Error: {str(e)}")
        return False

def main():
    parser = argparse.ArgumentParser(description="Direct diarization script")
    parser.add_argument("audio_file", help="Path to audio file")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument("--log-file", help="Path to save log file")
    args = parser.parse_args()
    
    log_message(f"Starting direct diarization with file: {args.audio_file}")
    
    # Process the audio file
    success = handle_audio(Path(args.audio_file), Path(args.output_dir))
    
    # Save log file if requested
    if args.log_file:
        try:
            with open(args.log_file, "w") as f:
                json.dump(logs, f, indent=2)
        except Exception as e:
            log_message(f"Error saving log file: {e}", "ERROR")
    
    if success:
        log_message("Diarization completed successfully")
        return 0
    else:
        log_message("Diarization failed", "ERROR")
        return 1

if __name__ == "__main__":
    sys.exit(main()) 