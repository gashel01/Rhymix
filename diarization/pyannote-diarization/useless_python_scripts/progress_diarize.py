# An enhanced version of diarize.py that adds progress tracking
import os
import sys
import time
import json
import traceback
from pathlib import Path

# Start timing
start_time = time.time()

# Setup logging
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

# Main execution
if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python progress_diarize.py <input_file> <output_dir> [--log-file path/to/log.json]")
        sys.exit(1)
        
    input_file = sys.argv[1]
    output_dir = sys.argv[2]
    
    # Check for log file param
    log_file = None
    if len(sys.argv) >= 5 and sys.argv[3] == "--log-file":
        log_file = sys.argv[4]
    
    # Create output directory if needed
    os.makedirs(output_dir, exist_ok=True)
    
    try:
        # Update progress at different stages
        update_progress(output_dir, 25, "Preparing audio for diarization")
        
        # Prepare arguments for original diarize.py
        original_script = os.path.join(os.path.dirname(__file__), "diarize.py")
        
        # Update progress at more stages
        update_progress(output_dir, 40, "Loading speaker diarization model")
        
        # Import the original script to avoid subprocess
        import importlib.util
        spec = importlib.util.spec_from_file_location("diarize", original_script)
        diarize_module = importlib.util.module_from_spec(spec)
        
        # Before running diarization
        update_progress(output_dir, 50, "Running speaker diarization")
        
        # Call the script
        sys.argv = [original_script, input_file, output_dir]
        if log_file:
            sys.argv.extend(["--log-file", log_file])
            
        # Execute the original script (this will run its __main__ section)
        spec.loader.exec_module(diarize_module)
        
        # At the end
        update_progress(output_dir, 95, "Finalizing results")
        update_progress(output_dir, 100, "Processing complete")
        
        # Log completion
        log_message("Diarization completed successfully")
        
        # Write logs if requested
        if log_file:
            try:
                with open(log_file, "w") as f:
                    json.dump(logs, f, indent=2)
            except Exception as e:
                log_message(f"Error saving log file: {e}", "ERROR")
    
    except Exception as e:
        error_msg = str(e)
        log_message(f"Error in diarization: {error_msg}", "ERROR")
        log_message(traceback.format_exc(), "ERROR")
        update_progress(output_dir, 0, f"Error: {error_msg}")
        sys.exit(1) 