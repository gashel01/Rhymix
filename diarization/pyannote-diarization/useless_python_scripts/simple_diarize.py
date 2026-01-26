import os
import sys
from pathlib import Path
import torch
from pyannote.audio import Pipeline
from pydub import AudioSegment
import re
from dotenv import load_dotenv
import json
import time
import argparse
import traceback
import socket
import pickle
import struct

# Load environment variables
script_dir = Path(__file__).resolve().parent
config_path = script_dir / "config" / ".env"
load_dotenv(config_path)

# Get HF token from environment
HF_TOKEN = os.getenv("HUGGINGFACE_TOKEN")

# Set up logging
VERBOSE = True  # Set to True for detailed logging
logs = []
start_time = time.time()

def log_message(message, level="INFO", print_to_console=True):
    """Add a log entry with timestamp and elapsed time"""
    current_time = time.time()
    elapsed = current_time - start_time
    
    entry = {
        "time": time.strftime("%H:%M:%S"),
        "elapsed": f"{elapsed:.2f}s",
        "level": level,
        "message": message
    }
    
    logs.append(entry)
    
    if print_to_console:
        prefix = f"[{level}]"
        if level == "ERROR":
            print(f"ERROR: {message}")
        elif level == "WARNING":
            print(f"WARNING: {message}")
        elif level == "PROGRESS":
            print(f"PROGRESS ({elapsed:.2f}s): {message}")
        else:
            print(f"{message}")
    
    return entry

if not HF_TOKEN:
    log_message("No Hugging Face token found in config/.env", "ERROR")
    sys.exit(1)

def check_gpu():
    """Check if GPU is available and print info"""
    log_message("Checking for GPU availability...")
    
    if torch.cuda.is_available():
        try:
            # Test CUDA availability with a simple operation
            test_tensor = torch.tensor([1.0, 2.0, 3.0], device='cuda')
            test_result = test_tensor.sum().item()
            
            device_count = torch.cuda.device_count()
            log_message(f"GPU available: {device_count} device(s)")
            
            # Get detailed GPU information
            for i in range(device_count):
                device_name = torch.cuda.get_device_name(i)
                total_memory_mb = torch.cuda.get_device_properties(i).total_memory / (1024 * 1024)
                free_memory = torch.cuda.memory_reserved(i) - torch.cuda.memory_allocated(i)
                free_memory_mb = free_memory / (1024 * 1024)
                
                log_message(f"  - Device {i}: {device_name}")
                log_message(f"    • Total Memory: {total_memory_mb:.0f} MB")
                log_message(f"    • Free Memory: {free_memory_mb:.0f} MB")
                
            # Try to optimize GPU memory usage
            torch.cuda.empty_cache()
            
            log_message("GPU is ready for use with PyTorch")
            return True
            
        except Exception as e:
            log_message(f"GPU detection error: {str(e)}", "WARNING")
            log_message("Falling back to CPU due to GPU initialization error", "WARNING")
            return False
    else:
        log_message("GPU not available, using CPU", "WARNING")
        log_message("Processing will be significantly slower without GPU acceleration", "WARNING")
        return False

def save_logs(output_dir, filename="diarization_log.json"):
    """Save logs to a JSON file"""
    log_path = Path(output_dir) / filename
    try:
        with open(log_path, "w") as f:
            json.dump(logs, f, indent=2)
        log_message(f"Logs saved to {log_path}")
    except Exception as e:
        log_message(f"Failed to save logs: {e}", "ERROR")

def save_progress_logs(output_dir, percent, stage):
    """Save logs with current progress to a progress file"""
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
        print(f"Error saving progress logs: {e}")

def process_diarization(diarization, audio_file, output_dir):
    """Process the diarization result and count speakers and segments"""
    log_message("Processing diarization results...")
    
    speakers = {}
    duration = 0
    segment_count = 0
    
    # First count all segments to track progress
    total_segments = sum(1 for _ in diarization.itertracks(yield_label=True))
    log_message(f"Found {total_segments} total segments to process")
    
    # Process each segment
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        segment_count += 1
        segment_duration = turn.end - turn.start
        duration += segment_duration
        
        # Update progress every 10% of segments
        if segment_count % max(1, total_segments // 10) == 0:
            progress_pct = (segment_count / total_segments) * 100
            log_message(f"Processing segments: {segment_count}/{total_segments} ({progress_pct:.1f}%)", "PROGRESS")
        
        if speaker not in speakers:
            speakers[speaker] = {
                "count": 0,
                "duration": 0
            }
        
        speakers[speaker]["count"] += 1
        speakers[speaker]["duration"] += segment_duration
    
    # Log speaker statistics
    log_message(f"Found {len(speakers)} speakers in the audio file")
    for speaker, stats in speakers.items():
        log_message(f"  - {speaker}: {stats['count']} segments, {stats['duration']:.2f}s total")
    
    log_message(f"Total diarization duration: {duration:.2f}s")
    
    # Create speaker directories and extract audio segments
    log_message("Extracting audio segments for each speaker...")
    
    # Load audio file
    audio_path = Path(audio_file)
    try:
        log_message(f"Looking for separated vocals track...")
        
        # First check for vocals file directly in data\talking\temp directory
        base_filename = audio_path.stem
        safe_name = slugify(base_filename)
        
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
                vocals_path = Path(direct_path)
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
                # If not found, check standard locations
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
                        vocals_path = path
                        log_message(f"Found separated vocals track: {vocals_path}")
                        break
        
        # Determine which audio to use (vocals or original)
        diarization_audio_path = vocals_path if vocals_path else audio_path
        log_message(f"Using {'SEPARATED VOCALS' if vocals_path else 'ORIGINAL AUDIO'} for diarization: {diarization_audio_path}")
        
        # Load the appropriate audio file
        if diarization_audio_path.suffix.lower() == ".mp3":
            audio = AudioSegment.from_mp3(diarization_audio_path)
        else:
            audio = AudioSegment.from_file(diarization_audio_path)
        log_message(f"Audio loaded: {len(audio)/1000:.2f}s at {audio.frame_rate}Hz")
    except Exception as e:
        log_message(f"Error loading audio file: {e}", "ERROR")
        traceback.print_exc()
        # Continue with extraction to at least get the diarization text file
    
    # Save speaker statistics to output directory
    speakers_file = Path(output_dir) / "speakers.json"
    with open(speakers_file, "w") as f:
        json.dump(speakers, f, indent=2)
    
    log_message(f"Speaker statistics saved to {speakers_file}")
    return speakers

def extract_speaker_segments(diarization, audio_file, output_dir):
    """Extract audio segments for each speaker"""
    log_message("Extracting audio segments for each speaker...")
    
    # Load audio file
    audio_path = Path(audio_file)
    try:
        # First check for vocals file directly in data\talking\temp directory
        base_filename = audio_path.stem
        safe_name = slugify(base_filename)
        
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
                vocals_path = Path(direct_path)
                log_message(f"FOUND SEPARATED VOCALS IN DATA TEMP DIRECTORY: {vocals_path}")
                break
        
        # If not found directly, check in the same directory as the input file
        if not vocals_path:
            input_dir = audio_path.parent
            direct_vocals_path = input_dir / f"{base_filename}_vocals.wav"
            
            if direct_vocals_path.exists():
                vocals_path = direct_vocals_path
                log_message(f"Found separated vocals in same directory for segment extraction: {vocals_path}")
            else:
                # If not found, check standard locations
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
                        vocals_path = path
                        log_message(f"Found separated vocals for segment extraction: {vocals_path}")
                        break
        
        # Use the vocals track if available, otherwise use original audio
        extraction_audio_path = vocals_path if vocals_path else audio_path
        log_message(f"Using {'SEPARATED VOCALS' if vocals_path else 'ORIGINAL AUDIO'} for segment extraction: {extraction_audio_path}")
        
        # Load the appropriate audio for extraction
        if extraction_audio_path.suffix.lower() == ".mp3":
            audio = AudioSegment.from_mp3(extraction_audio_path)
        else:
            audio = AudioSegment.from_file(extraction_audio_path)
            
        log_message(f"Audio loaded for segment extraction: {len(audio)/1000:.2f}s")
    except Exception as e:
        log_message(f"Error loading audio for segment extraction: {e}", "ERROR")
        save_progress_logs(output_dir, 60, f"Error extracting segments: {e}")
        return
    
    # Group segments by speaker
    segments_by_speaker = {}
    speakers = set()
    
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        speakers.add(speaker)
        if speaker not in segments_by_speaker:
            segments_by_speaker[speaker] = []
        segments_by_speaker[speaker].append((turn.start, turn.end))
    
    # Get total segments for progress calculation
    total_speakers = len(segments_by_speaker)
    total_segments = sum(len(segs) for segs in segments_by_speaker.values())
    log_message(f"Extracting {total_segments} segments across {total_speakers} speakers")
    save_progress_logs(output_dir, 62, f"Found {total_speakers} speakers with {total_segments} segments")
    
    # Create speakers.json file with information
    speaker_info = {
        "totalSpeakers": total_speakers,
        "totalSegments": total_segments,
        "speakers": {}
    }
    
    # Calculate base progress (60% at start of extraction)
    base_progress = 62
    # Each speaker extraction takes up to 35% of the progress bar
    speaker_progress_chunk = 35 / max(1, total_speakers) 
    
    # Keep track of processed segments for progress
    processed_segments = 0
    processed_speakers = 0
    
    # Create directories and extract segments
    for speaker in speakers:
        speaker_dir = output_dir / speaker
        speaker_dir.mkdir(exist_ok=True, parents=True)
        
        current_speaker_progress = base_progress + (processed_speakers * speaker_progress_chunk)
        save_progress_logs(output_dir, current_speaker_progress, f"Extracting audio for {speaker}")
        
        if speaker not in segments_by_speaker or not segments_by_speaker[speaker]:
            log_message(f"No segments for {speaker}, skipping")
            processed_speakers += 1
            continue
        
        segment_count = len(segments_by_speaker[speaker])
        speaker_info["speakers"][speaker] = {
            "segmentCount": segment_count,
            "directory": str(speaker_dir)
        }
        
        # Extract each segment
        for i, (start, end) in enumerate(segments_by_speaker[speaker]):
            # Format timestamps for filename - include milliseconds for precision
            start_mins = int(start // 60)
            start_secs = int(start % 60)
            end_mins = int(end // 60)
            end_secs = int(end % 60)
            
            # Create filename with both formats of timestamp info for compatibility
            segment_file = f"{speaker}_{i+1}_{start_mins:02d}m{start_secs:02d}s-{end_mins:02d}m{end_secs:02d}s_{start:.3f}s-{end:.3f}s.wav"
            segment_path = speaker_dir / segment_file
            
            # Extract segment
            start_ms = int(start * 1000)
            end_ms = int(end * 1000)
            segment = audio[start_ms:end_ms]
            segment.export(segment_path, format="wav")
            
            # Update progress periodically
            if i % max(1, segment_count // 10) == 0 or i == segment_count - 1:
                segment_progress = (i + 1) / segment_count
                current_progress = current_speaker_progress + (segment_progress * speaker_progress_chunk)
                save_progress_logs(output_dir, current_progress, 
                                 f"Extracting {speaker}: {i+1}/{segment_count} segments")
        
        processed_segments += segment_count
        processed_speakers += 1
        overall_progress = base_progress + (processed_speakers / total_speakers * speaker_progress_chunk)
        log_message(f"Completed extracting {speaker}: {segment_count} segments")
        save_progress_logs(output_dir, overall_progress, f"Completed extracting {speaker}")
    
    # Save speaker information
    with open(output_dir / "speakers.json", "w") as f:
        json.dump(speaker_info, f, indent=2)
    
    # Done with extraction
    save_progress_logs(output_dir, 95, "All speaker segments extracted")
    log_message(f"All speaker segments extracted successfully")

def run_diarization_with_gpu_optimization(pipeline, audio_path, file_size_mb, output_dir):
    """Run diarization with GPU optimizations for larger files"""
    log_message("Running GPU-optimized diarization...")
    save_progress_logs(output_dir, 30, "Running GPU-accelerated speaker analysis")
    
    start_time = time.time()
    
    # For very large files (over 50MB), consider splitting and processing in chunks
    # This helps prevent CUDA out-of-memory errors
    if file_size_mb > 50 and torch.cuda.is_available():
        log_message(f"Large file detected ({file_size_mb:.1f} MB). Using optimized processing.", "WARNING")
        save_progress_logs(output_dir, 32, "Large file detected - using optimized processing")
        
        try:
            # Clear GPU cache before processing
            torch.cuda.empty_cache()
            
            # Process with optimized memory settings
            with torch.cuda.amp.autocast(enabled=True):  # Use mixed precision if available
                log_message("Starting diarization with memory optimization...")
                diarization = pipeline(audio_path)
            
            processing_time = time.time() - start_time
            log_message(f"Diarization completed in {processing_time:.2f}s with GPU acceleration")
            return diarization
            
        except RuntimeError as e:
            if "CUDA out of memory" in str(e):
                log_message("GPU memory exceeded. Falling back to CPU (this will be slower)", "WARNING")
                save_progress_logs(output_dir, 35, "GPU memory exceeded - falling back to CPU (slower)")
                
                # Move pipeline to CPU to avoid memory issues
                pipeline = pipeline.to("cpu")
                torch.cuda.empty_cache()  # Free up GPU memory
                
                cpu_start_time = time.time()
                diarization = pipeline(audio_path)
                cpu_time = time.time() - cpu_start_time
                
                log_message(f"CPU fallback diarization completed in {cpu_time:.2f}s")
                return diarization
            else:
                raise  # Re-raise if it's not a memory error
    else:
        # Standard processing for typical files
        diarization = pipeline(audio_path)
        processing_time = time.time() - start_time
        log_message(f"Diarization completed in {processing_time:.2f}s")
        return diarization

def get_audio_duration(audio_path):
    """Get the duration of an audio file in seconds"""
    try:
        if str(audio_path).lower().endswith('.mp3'):
            audio = AudioSegment.from_mp3(audio_path)
        else:
            audio = AudioSegment.from_file(audio_path)
        return len(audio) / 1000  # Convert ms to seconds
    except Exception as e:
        log_message(f"Could not determine audio duration: {e}", "WARNING")
        return 0

def get_diarization_from_service(audio_path):
    """Get diarization results from the model service with retry"""
    log_message("Attempting to connect to diarization model service...")
    
    # Retry parameters
    max_retries = 3
    retry_delay = 2  # seconds
    
    # First try to connect to the service
    for attempt in range(max_retries):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(10)  # 10 second timeout
        
        try:
            if attempt > 0:
                log_message(f"Retry attempt {attempt} of {max_retries}...")
            
            # Try to connect
            sock.connect(("localhost", 9000))
            log_message(f"Connected to model service on localhost:9000")
            
            # Read the audio data
            log_message(f"Reading audio file: {audio_path}")
            with open(audio_path, "rb") as f:
                audio_data = f.read()
            
            # Create the request
            request = {
                "action": "diarize",
                "audio_data": audio_data
            }
            
            # Serialize and send the request
            log_message(f"Sending diarization request for {len(audio_data)/1024/1024:.1f} MB of audio data")
            request_data = pickle.dumps(request)
            sock.sendall(struct.pack('>I', len(request_data)))
            sock.sendall(request_data)
            
            # Receive the response length
            log_message("Waiting for model service response...")
            raw_msglen = sock.recv(4)
            if not raw_msglen:
                raise ValueError("Connection closed by model service")
            
            msglen = struct.unpack('>I', raw_msglen)[0]
            log_message(f"Receiving {msglen/1024/1024:.1f} MB of data from model service")
            
            # Read the message data in chunks
            buffer = bytearray()
            while len(buffer) < msglen:
                chunk = sock.recv(min(4096, msglen - len(buffer)))
                if not chunk:
                    raise ValueError("Connection closed by model service")
                buffer.extend(chunk)
                
                # Log progress for large responses
                if msglen > 1024*1024 and len(buffer) % (1024*1024) < 4096:
                    log_message(f"Received {len(buffer)/1024/1024:.1f} MB of {msglen/1024/1024:.1f} MB")
            
            # Unserialize the response
            log_message("Deserializing response from model service")
            response = pickle.loads(buffer)
            
            if not response.get("success"):
                raise ValueError(f"Model service error: {response.get('error')}")
            
            log_message("Successfully received diarization results from model service")
            return response.get("diarization")
        
        except (socket.timeout, ConnectionRefusedError) as e:
            log_message(f"Connection error: {e}", "WARNING")
            if attempt < max_retries - 1:
                log_message(f"Retrying in {retry_delay} seconds...", "WARNING")
                time.sleep(retry_delay)
                retry_delay *= 2  # Exponential backoff
            else:
                log_message("Maximum retry attempts reached", "WARNING")
                log_message("Falling back to direct model loading", "WARNING")
                return None
        except Exception as e:
            log_message(f"Error communicating with model service: {e}", "ERROR")
            log_message("Falling back to direct model loading", "WARNING")
            return None
        finally:
            sock.close()
    
    return None

def diarize_audio(audio_file, output_dir=None, log_file=None, force_gpu=False):
    """Perform speaker diarization on an audio file"""
    global start_time
    start_time = time.time()
    
    log_message(f"Starting diarization for: {audio_file}")
    
    # Initial progress update
    if output_dir:
        save_progress_logs(Path(output_dir), 1, "Initializing diarization process")
    
    # Check if file exists, if not, try finding it in input_audio directory
    audio_path = Path(audio_file)
    if not audio_path.exists():
        # Try finding in input_audio directory
        input_audio_dir = Path(__file__).resolve().parent / "input_audio"
        alternative_path = input_audio_dir / audio_path.name
        if alternative_path.exists():
            log_message(f"Found file in input_audio directory: {alternative_path}")
            audio_path = alternative_path
        else:
            log_message(f"File not found at {audio_file} or in input_audio directory", "ERROR")
            if output_dir:
                save_progress_logs(Path(output_dir), 0, "Error: Audio file not found")
            sys.exit(1)
    
    # Set default output directory if not provided
    if output_dir is None:
        output_dir = Path("output/talking")
    else:
        output_dir = Path(output_dir)
    
    log_message(f"Output will be saved to: {output_dir}")
    output_dir.mkdir(exist_ok=True, parents=True)
    
    # Get audio file info
    file_size_mb = audio_path.stat().st_size / (1024 * 1024)
    log_message(f"Audio file size: {file_size_mb:.2f} MB")
    
    # Estimate processing time based on file size
    estimated_time = file_size_mb * 1.5  # rough estimate: 1.5 seconds per MB
    log_message(f"Estimated processing time: {estimated_time:.1f} seconds")
    save_progress_logs(output_dir, 5, f"Analyzing audio file ({file_size_mb:.1f} MB)")
    
    # Convert MP3 to WAV if needed
    if audio_path.suffix.lower() == ".mp3":
        log_message("Converting MP3 to WAV (this may take a while for large files)...")
        save_progress_logs(output_dir, 8, "Converting MP3 to WAV format")
        conversion_start = time.time()
        audio = AudioSegment.from_mp3(audio_path)
        temp_wav = Path("temp_input.wav")
        audio.export(temp_wav, format="wav")
        conversion_time = time.time() - conversion_start
        log_message(f"Conversion completed in {conversion_time:.2f}s")
        audio_path = temp_wav
        save_progress_logs(output_dir, 10, "Audio conversion complete")
    
    # Check for GPU, but respect the force_gpu flag
    if force_gpu:
        log_message("GPU usage explicitly requested")
        use_gpu = check_gpu()
        if not use_gpu:
            log_message("GPU was requested but not available - will use CPU", "WARNING")
    else:
        use_gpu = check_gpu()
    
    device = "cuda" if use_gpu else "cpu"
    save_progress_logs(output_dir, 12, f"Preparing to use {device.upper()} for processing")
    
    # Initialize the pipeline
    log_message("Loading diarization model from Hugging Face (this will take a while)...")
    save_progress_logs(output_dir, 15, "Loading diarization model (may take several minutes)")
    model_load_start = time.time()

    try:
        # First try to get diarization from the model service
        log_message("Trying to connect to diarization model service...")
        save_progress_logs(output_dir, 15, "Connecting to diarization service")
        
        diarization = get_diarization_from_service(audio_path)
        
        if diarization is not None:
            log_message("Successfully retrieved diarization from model service")
            save_progress_logs(output_dir, 40, "Speaker analysis complete, processing results")
        else:
            # Fallback to direct model loading
            log_message("Model service unavailable, loading model directly", "WARNING")
            save_progress_logs(output_dir, 15, "Loading diarization model (may take several minutes)")
            
            # Original model loading code...
            pipeline = Pipeline.from_pretrained(
                "pyannote/speaker-diarization@2.1", 
                use_auth_token=HF_TOKEN
            )
            
            # Move to GPU if available
            if use_gpu:
                pipeline = pipeline.to("cuda")
            
            # Run diarization
            diarization = pipeline(audio_path)
            
    except Exception as e:
        log_message(f"Error during diarization: {str(e)}", "ERROR")
        save_progress_logs(output_dir, 0, f"Error: {str(e)}")
        sys.exit(1)
    
    # Process and analyze the diarization results
    save_progress_logs(output_dir, 55, "Identifying and labeling speakers")
    speakers = process_diarization(diarization, audio_path, output_dir)
    
    # Save results to file
    filename = audio_path.stem
    safe_filename = re.sub(r'[\\/*?:"<>|]', "_", filename)
    output_file = output_dir / f"{safe_filename}_diarization.txt"
    
    log_message("Saving diarization results to text file...")
    save_progress_logs(output_dir, 58, "Saving diarization results")
    with open(output_file, "w") as f:
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            f.write(f"[{turn.start:.2f} - {turn.end:.2f}] {speaker}\n")
    
    log_message(f"Diarization saved to: {output_file}")
    
    # Extract audio segments for each speaker
    log_message("Starting speaker audio extraction...")
    save_progress_logs(output_dir, 60, "Starting speaker audio extraction")
    extract_speaker_segments(diarization, audio_path, output_dir)
    
    # Clean up temp file if created
    if audio_path.name == "temp_input.wav" and audio_path.exists():
        os.remove(audio_path)
        log_message("Temporary WAV file removed")
    
    # Save logs if requested
    if log_file:
        with open(log_file, "w") as f:
            json.dump(logs, f, indent=2)
        log_message(f"Logs saved to: {log_file}")
    
    total_time = time.time() - start_time
    log_message(f"Total processing time: {total_time:.2f} seconds")
    
    # Save final progress
    save_progress_logs(output_dir, 100, "Processing complete!")
    
    return output_file

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Speaker diarization script")
    parser.add_argument("audio_file", help="Path to the audio file to process")
    parser.add_argument("output_dir", help="Output directory for results", nargs='?', default=None)
    parser.add_argument("--log-file", help="Path to save log file", default=None)
    parser.add_argument("--use-gpu", help="Force GPU usage if available", action="store_true")
    args = parser.parse_args()
    
    try:
        # Override GPU detection if --use-gpu flag is specified
        force_gpu = args.use_gpu
        
        diarization_file = diarize_audio(args.audio_file, args.output_dir, args.log_file, force_gpu)
        log_message(f"Successfully completed diarization: {diarization_file}", "SUCCESS")
    except Exception as e:
        log_message(f"ERROR during diarization: {str(e)}", "ERROR")
        import traceback
        traceback.print_exc()
        sys.exit(1)

# Function to slugify strings for filenames
def slugify(text):
    """Convert to lowercase, remove non-alpha chars and convert spaces to hyphens"""
    text = re.sub(r'[^\w\s-]', '', text.lower())
    return re.sub(r'[-\s]+', '_', text).strip('-_') 