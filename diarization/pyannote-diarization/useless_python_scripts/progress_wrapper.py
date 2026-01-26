import os
import sys
import time
import json
import subprocess
from pathlib import Path

# Start timing
start_time = time.time()

# Set up logs
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

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python progress_wrapper.py <input_file> <output_dir> [--log-file path/to/log.json]")
        sys.exit(1)
        
    input_file = sys.argv[1]
    output_dir = sys.argv[2]
    
    # Look for log file parameter
    log_file = None
    if len(sys.argv) >= 5 and sys.argv[3] == "--log-file":
        log_file = sys.argv[4]
    
    # Create directories if needed
    os.makedirs(output_dir, exist_ok=True)
    
    try:
        # Start with early progress updates
        log_message("Starting diarization process")
        update_progress(output_dir, 20, "Preparing audio for diarization")
        
        # Construct command for original script
        script_dir = os.path.dirname(os.path.abspath(__file__))
        original_script = os.path.join(script_dir, "diarize.py")
        
        # Build command - use same parameters
        cmd = [sys.executable, original_script, input_file]
        if log_file:
            cmd.extend(["--log-file", log_file])
            
        # Update progress before running
        log_message("Loading diarization model")
        update_progress(output_dir, 40, "Loading diarization model")
        
        # Run the original script
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        
        update_progress(output_dir, 50, "Running speaker diarization")
        
        # Monitor the process with periodic updates
        stdout, stderr = process.communicate()
        
        # Update based on result
        if process.returncode == 0:
            log_message("Diarization completed successfully")
            update_progress(output_dir, 100, "Processing complete")
        else:
            log_message(f"Diarization failed: {stderr}", "ERROR")
            update_progress(output_dir, 0, f"Error: {stderr}")
            sys.exit(process.returncode)
        
        # Write logs if requested
        if log_file:
            try:
                with open(log_file, "w") as f:
                    json.dump(logs, f, indent=2)
            except Exception as e:
                log_message(f"Error saving log file: {e}", "ERROR")
        
    except Exception as e:
        log_message(f"Error: {str(e)}", "ERROR")
        update_progress(output_dir, 0, f"Error: {str(e)}")
        sys.exit(1) 