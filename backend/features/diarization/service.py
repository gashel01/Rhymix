import json
import os
import subprocess
import sys
import time
import traceback

from backend.jobs.registry import active_jobs
from backend.paths.manager import paths

# Add a new in-memory cache for job status
# Will store the last status and timestamp for each job
job_status_cache = {}


def run_diarization_process(job_id, input_audio_path, original_filename):
    """Run the diarization process in the background"""
    if job_id not in active_jobs:
        print(f"Error: Job {job_id} not found in active_jobs")
        return
    job = active_jobs[job_id]
    job["status"] = "preprocessing"

    try:
        script_root = os.path.abspath("diarization/pyannote-diarization")
        max_process_time, start_time = 3600, time.time()

        def check_timeout():
            if time.time() - start_time > max_process_time:
                job.update(status="failed", error="Process timed out after 1 hour")
                return True
            return False

        original_cwd = os.getcwd()
        print(f"Original working directory: {original_cwd}")

        try:
            abs_in = os.path.abspath(input_audio_path)
            print(f"Original input path: {abs_in}")

            print("Starting vocal separation using clean_diarize.py...")
            job["status_message"] = "Separating vocals from audio"
            clean_diarize_script = os.path.join(original_cwd, "clean_diarize.py")
            try:
                subprocess.run([sys.executable, clean_diarize_script], check=True, text=True)
                print("Vocal separation completed successfully")
                job["status_message"] = "Vocal separation completed, starting diarization"
            except subprocess.CalledProcessError as e:
                print(f"Error during vocal separation: {e}")
                job["status_message"] = f"Vocal separation error: {e}"

            os.chdir(script_root)
            print(f"Changed working directory to: {script_root}")

            if not os.path.exists(abs_in):
                print(f"WARNING: Input file does not exist at: {abs_in}")
                if (
                    "diarization/pyannote-diarization/diarization/pyannote-diarization" in abs_in
                    or "diarization\\pyannote-diarization\\diarization\\pyannote-diarization" in abs_in
                ):
                    fixed = abs_in.replace(
                        "diarization/pyannote-diarization/diarization/pyannote-diarization",
                        "diarization/pyannote-diarization",
                    ).replace(
                        "diarization\\pyannote-diarization\\diarization\\pyannote-diarization",
                        "diarization\\pyannote-diarization",
                    )
                    print(f"Trying corrected path: {fixed}")
                    if os.path.exists(fixed):
                        print(f"Found file at corrected path: {fixed}")
                        abs_in = fixed

                if not os.path.exists(abs_in):
                    base = os.path.basename(abs_in)
                    print(f"Looking for file by base name: {base}")
                    correct_dir = os.path.join(original_cwd, "diarization", "pyannote-diarization", "input_audio")
                    candidate = os.path.join(correct_dir, base)
                    if os.path.exists(candidate):
                        print(f"Found file at: {candidate}")
                        abs_in = candidate

            print(f"Using absolute input path: {abs_in}")

            job.update(status="diarizing", status_message="Performing speaker diarization on vocal track")
            cmd = ["web_runner.bat", abs_in]

            print(f"Running diarization command from {os.getcwd()}: {' '.join(cmd)}")
            print("Note: Diarization scripts will now automatically use separated vocals for better speech detection")

            if check_timeout():
                return

            p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                stdout, stderr = p.communicate(timeout=max_process_time)
            except subprocess.TimeoutExpired:
                p.kill()
                stdout, stderr = p.communicate()
                job.update(status="failed", error="Diarization process timed out")
                return

            print(f"Diarization stdout: {stdout}")
            if stderr:
                print(f"Diarization stderr: {stderr}")

            torchaudio_only = stderr and "torchaudio backend is switched to 'soundfile'" in stderr and not any(
                x in stderr for x in ["RuntimeError", "ValueError", "ImportError"]
            )

            if p.returncode != 0 and not torchaudio_only:
                job.update(status="failed", error=stderr or "Diarization process failed")
                print(f"Diarization failed with return code {p.returncode}: {stderr}")
                return False

            job.update(status="completed", completed_at=int(time.time()))

            if paths.SPEAKER_DIR.exists():
                print(f"Contents of {paths.SPEAKER_DIR}:")
                for item in os.listdir(paths.SPEAKER_DIR):
                    print(f"  - {item}")
                    ip = paths.SPEAKER_DIR / item
                    if ip.is_dir():
                        print(f"    Subdirectories in {item}:")
                        for sub in os.listdir(ip):
                            print(f"    - {sub}")
            else:
                print(f"Speaker directory not found at {paths.SPEAKER_DIR}")

            print("Diarization process completed")
            return True

        finally:
            os.chdir(original_cwd)
            print(f"Restored working directory to: {original_cwd}")

    except Exception as e:
        print(f"Error in diarization process: {e}")
        traceback.print_exc()
        if job_id in active_jobs:
            active_jobs[job_id].update(status="failed", error=str(e))
        return False


def formatTimestamp(seconds):
    m, s = divmod(seconds, 60)
    return f"{int(m):02d}:{s:05.2f}"
