import os
import sys
import subprocess
import json
import time
import traceback
from pathlib import Path

def run_diarization(audio_file, output_dir):
    """
    Simplified function to run diarization without fancy console output or venv handling
    """
    print(f"Processing file: {audio_file}")
    print(f"Output directory: {output_dir}")
    
    # Ensure output directory exists
    Path(output_dir).mkdir(exist_ok=True, parents=True)
    
    # Path to the diarization script
    script_dir = Path(__file__).resolve().parent
    diarize_script = script_dir / "simple_diarize.py"
    
    # Run the diarization directly using the system Python
    try:
        start_time = time.time()
        
        # Create logs directory
        logs_dir = Path(output_dir) / "logs"
        logs_dir.mkdir(exist_ok=True, parents=True)
        
        # Create log file
        log_file = logs_dir / "diarization.json"
        
        # Run the diarization script
        print(f"Running: {sys.executable} {diarize_script} {audio_file} {output_dir} --log-file {log_file}")
        
        result = subprocess.run([
            sys.executable,
            str(diarize_script),
            str(audio_file),
            str(output_dir),
            "--log-file", str(log_file)
        ], capture_output=True, text=True)
        
        # Log the result
        elapsed = time.time() - start_time
        
        # Capture both stdout and stderr
        logs = []
        logs.append({
            "time": time.strftime("%H:%M:%S"),
            "elapsed": f"{elapsed:.2f}s",
            "level": "INFO",
            "message": f"Diarization process completed in {elapsed:.2f} seconds"
        })
        
        # Parse stdout logs
        for line in result.stdout.splitlines():
            if "ERROR:" in line:
                logs.append({
                    "time": time.strftime("%H:%M:%S"),
                    "elapsed": f"{elapsed:.2f}s",
                    "level": "ERROR",
                    "message": line
                })
            elif "WARNING:" in line:
                logs.append({
                    "time": time.strftime("%H:%M:%S"),
                    "elapsed": f"{elapsed:.2f}s",
                    "level": "WARNING",
                    "message": line
                })
            else:
                logs.append({
                    "time": time.strftime("%H:%M:%S"),
                    "elapsed": f"{elapsed:.2f}s",
                    "level": "INFO",
                    "message": line
                })
        
        # Add stderr logs if there are any
        if result.stderr:
            for line in result.stderr.splitlines():
                logs.append({
                    "time": time.strftime("%H:%M:%S"),
                    "elapsed": f"{elapsed:.2f}s",
                    "level": "ERROR",
                    "message": line
                })
        
        # Save the logs
        with open(logs_dir / "full_process_log.json", "w") as f:
            json.dump(logs, f, indent=2)
        
        if result.returncode != 0:
            print(f"ERROR: Diarization failed with return code {result.returncode}")
            print(f"STDOUT: {result.stdout}")
            print(f"STDERR: {result.stderr}")
            return False
        
        print(f"Diarization completed successfully in {elapsed:.2f} seconds")
        return True
    
    except Exception as e:
        print(f"ERROR: Exception during diarization: {str(e)}")
        traceback.print_exc()
        return False

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python simple_runner.py <audio_file> <output_dir>")
        sys.exit(1)
    
    audio_file = sys.argv[1]
    output_dir = sys.argv[2]
    
    success = run_diarization(audio_file, output_dir)
    sys.exit(0 if success else 1) 