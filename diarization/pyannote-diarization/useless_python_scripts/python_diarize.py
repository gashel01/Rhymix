import os
import sys
import subprocess
import venv
import tempfile
import shutil
import json
import time
from pathlib import Path
import argparse

# Add rich for beautiful console output
try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TimeElapsedColumn
    RICH_AVAILABLE = True
except ImportError:
    RICH_AVAILABLE = False
    
# Initialize rich console if available
if RICH_AVAILABLE:
    console = Console()
else:
    console = None

class DiarizationLogger:
    """Class to handle logging for the diarization process"""
    def __init__(self, log_file=None):
        self.logs = []
        self.log_file = log_file
        self.start_time = time.time()
        
    def log(self, message, level="INFO", timestamp=True):
        """Add a log message"""
        if timestamp:
            elapsed = time.time() - self.start_time
            log_entry = {
                "time": time.strftime("%H:%M:%S"),
                "elapsed": f"{elapsed:.2f}s",
                "level": level,
                "message": message
            }
        else:
            log_entry = {
                "level": level,
                "message": message
            }
            
        self.logs.append(log_entry)
        
        # Print to console
        if RICH_AVAILABLE:
            if level == "ERROR":
                console.print(f"[bold red]{log_entry['message']}[/bold red]")
            elif level == "WARNING":
                console.print(f"[bold yellow]{log_entry['message']}[/bold yellow]")
            elif level == "SUCCESS":
                console.print(f"[bold green]{log_entry['message']}[/bold green]")
            else:
                console.print(f"[bold cyan]{log_entry['message']}[/bold cyan]")
        else:
            print(f"{level}: {message}")
            
        # Write to log file if specified
        if self.log_file:
            with open(self.log_file, "a") as f:
                f.write(json.dumps(log_entry) + "\n")
                
        return log_entry
        
    def error(self, message):
        """Log an error message"""
        return self.log(message, level="ERROR")
        
    def warning(self, message):
        """Log a warning message"""
        return self.log(message, level="WARNING")
        
    def success(self, message):
        """Log a success message"""
        return self.log(message, level="SUCCESS")
        
    def get_logs(self):
        """Get all logs"""
        return self.logs
        
    def save_logs_json(self, output_path):
        """Save logs to a JSON file"""
        try:
            # Ensure parent directory exists
            output_path = Path(output_path)
            output_path.parent.mkdir(exist_ok=True, parents=True)
            
            with open(output_path, "w") as f:
                json.dump(self.logs, f, indent=2)
            
            return True
        except Exception as e:
            print(f"ERROR: Could not save logs to {output_path}: {e}")
            # Try saving to a fallback location
            try:
                fallback_path = Path(__file__).parent / "error_logs.json"
                with open(fallback_path, "w") as f:
                    json.dump(self.logs, f, indent=2)
                print(f"Logs saved to fallback location: {fallback_path}")
            except:
                print("Failed to save logs to fallback location")
            return False

# Create global logger
logger = DiarizationLogger()

def create_venv(venv_path):
    """Create a virtual environment if it doesn't exist"""
    if not Path(venv_path).exists():
        logger.log(f"Creating virtual environment at {venv_path}...")
        venv.create(venv_path, with_pip=True)
        return True
    return False

def run_in_venv(venv_path, command, cwd=None):
    """Run a command in the virtual environment"""
    if os.name == 'nt':  # Windows
        python_path = Path(venv_path) / "Scripts" / "python.exe"
        pip_path = Path(venv_path) / "Scripts" / "pip.exe"
    else:  # Unix/Linux/Mac
        python_path = Path(venv_path) / "bin" / "python"
        pip_path = Path(venv_path) / "bin" / "pip"
    
    if isinstance(command, list):
        if command[0] == "python":
            command[0] = str(python_path)
        elif command[0] == "pip":
            command[0] = str(pip_path)
    elif command.startswith("python "):
        command = str(python_path) + command[6:]
    elif command.startswith("pip "):
        command = str(pip_path) + command[3:]
    
    logger.log(f"Running command: {command}")
    if isinstance(command, list):
        return subprocess.run(command, cwd=cwd, check=True, capture_output=True, text=True)
    else:
        return subprocess.run(command, shell=True, cwd=cwd, check=True, capture_output=True, text=True)

def install_gpu_requirements(venv_path):
    """Install PyTorch with GPU support and other requirements"""
    try:
        # Install PyTorch with CUDA support
        logger.log("Installing PyTorch with CUDA support...")
        run_in_venv(venv_path, 
                   ["pip", "install", "torch==1.13.1+cu116", "torchaudio==0.13.1+cu116", 
                    "--extra-index-url", "https://download.pytorch.org/whl/cu116"])
        
        # Install other requirements
        logger.log("Installing other requirements...")
        requirements = [
            "pyannote.audio==2.0.0",
            "pyannote.core==4.5",
            "pyannote.database==4.1.3",
            "pyannote.metrics==3.2.1",
            "pyannote.pipeline==2.3",
            "python-dotenv==0.21.0",
            "pydub==0.25.1"
        ]
        run_in_venv(venv_path, ["pip", "install"] + requirements)
        
        # Verify GPU is available
        verify_script = 'import torch; print(f"CUDA available: {torch.cuda.is_available()}"); print(f"CUDA device count: {torch.cuda.device_count()}"); print(f"GPU device: {torch.cuda.get_device_name(0) if torch.cuda.device_count() > 0 else "None"}")'
        result = run_in_venv(venv_path, ["python", "-c", verify_script])
        
        # Parse the result to get GPU info
        gpu_lines = result.stdout.strip().split('\n')
        for line in gpu_lines:
            logger.log(line)
            
        # Check if GPU is available
        if "CUDA available: True" in result.stdout:
            logger.success("GPU acceleration is enabled!")
        else:
            logger.warning("GPU acceleration not available. Running on CPU.")
        
        return True
    except subprocess.CalledProcessError as e:
        logger.error(f"Error installing requirements: {e}")
        logger.log(f"Output: {e.stdout}")
        logger.log(f"Error: {e.stderr}")
        return False

def run_diarization(venv_path, audio_file, output_dir):
    """Run diarization on an audio file using the virtual environment"""
    try:
        script_dir = Path(__file__).resolve().parent
        diarize_script = script_dir / "simple_diarize.py"
        
        # Add logging flag to capture detailed logs
        log_file = Path(output_dir) / "diarization_log.json"
        
        logger.log(f"Running diarization on {audio_file}...")
        logger.log(f"Output will be saved to {output_dir}")
        
        # Start a progress spinner if rich is available
        if RICH_AVAILABLE:
            with Progress(
                SpinnerColumn(),
                TextColumn("[bold blue]Running diarization...[/bold blue]"),
                BarColumn(),
                TimeElapsedColumn(),
                console=console
            ) as progress:
                task = progress.add_task("Processing...", total=None)
                
                result = run_in_venv(venv_path, 
                                    ["python", str(diarize_script), str(audio_file), 
                                     str(output_dir), "--log-file", str(log_file)])
                
                progress.update(task, completed=100)
        else:
            result = run_in_venv(venv_path, 
                                ["python", str(diarize_script), str(audio_file), 
                                 str(output_dir), "--log-file", str(log_file)])
        
        # Process and display the output
        for line in result.stdout.splitlines():
            if "ERROR:" in line:
                logger.error(line)
            elif "WARNING:" in line:
                logger.warning(line)
            elif "SUCCESS:" in line or "completed" in line.lower():
                logger.success(line)
            else:
                logger.log(line)
                
        if result.stderr:
            for line in result.stderr.splitlines():
                if line.strip():
                    logger.warning(f"STDERR: {line}")
        
        # Save final logs to the output directory
        logger.save_logs_json(Path(output_dir) / "full_process_log.json")
        
        if log_file.exists():
            logger.success("Diarization completed successfully!")
        else:
            logger.warning("Diarization completed but no log file was generated.")
            
        return True
    except subprocess.CalledProcessError as e:
        logger.error(f"Error running diarization: {e}")
        if e.stdout:
            logger.log(f"Output: {e.stdout}")
        if e.stderr:
            logger.log(f"Error: {e.stderr}")
        
        # Save error logs
        logger.save_logs_json(Path(output_dir) / "error_log.json")
        return False

def main():
    parser = argparse.ArgumentParser(description="Run diarization in a Python virtual environment with GPU support")
    parser.add_argument("audio_file", help="Path to the audio file to process")
    parser.add_argument("output_dir", help="Path to the output directory")
    parser.add_argument("--log-file", help="Path to save log file", default=None)
    args = parser.parse_args()
    
    # Initialize logger with log file if specified
    global logger
    logger = DiarizationLogger(args.log_file)
    
    # Create all required directories early
    try:
        # Ensure output directory exists
        output_dir = Path(args.output_dir)
        output_dir.mkdir(exist_ok=True, parents=True)
        
        # Ensure the venv directory parent exists
        script_dir = Path(__file__).resolve().parent
        venv_path = script_dir / "venv-gpu"
        venv_path.parent.mkdir(exist_ok=True, parents=True)
        
        # Create a logs directory for any error logs
        logs_dir = output_dir / "logs"
        logs_dir.mkdir(exist_ok=True, parents=True)
        
        # Set up a default log file in the logs directory
        if not args.log_file:
            args.log_file = str(logs_dir / "diarization_process.log")
    except Exception as e:
        print(f"ERROR: Failed to create required directories: {e}")
        sys.exit(1)
    
    # Start with a title panel if rich is available
    if RICH_AVAILABLE:
        console.print(Panel.fit(
            "[bold blue]PyAnnote Diarization[/bold blue] with GPU Support",
            border_style="green",
            title="Speaker Diarization"
        ))
    
    logger.log(f"Processing audio file: {args.audio_file}")
    logger.log(f"Output directory: {args.output_dir}")
    
    # Create virtual environment if needed
    is_new_venv = create_venv(venv_path)
    
    # Install requirements if new venv
    if is_new_venv:
        try:
            logger.log("New virtual environment created, installing requirements...")
            if not install_gpu_requirements(venv_path):
                error_log_path = logs_dir / "installation_error_log.json"
                logger.error("Failed to install requirements")
                logger.save_logs_json(error_log_path)
                logger.error(f"Logs saved to: {error_log_path}")
                
                # Suggest running the setup script
                logger.warning("Try running the setup script: python diarization/setup_diarization.py")
                sys.exit(1)
        except Exception as e:
            logger.error(f"Exception during requirements installation: {e}")
            # Try to save logs to a safe location
            try:
                fallback_log_path = Path(__file__).parent / "install_error.json"
                logger.save_logs_json(fallback_log_path)
                print(f"Error logs saved to: {fallback_log_path}")
            except:
                pass
            sys.exit(1)
    
    # Run diarization
    try:
        if not run_diarization(venv_path, args.audio_file, args.output_dir):
            logger.error("Diarization failed")
            # Save logs to a known location that will definitely work
            error_log_path = Path(__file__).parent / "diarization_error.json"
            logger.save_logs_json(error_log_path)
            logger.error(f"Error logs saved to: {error_log_path}")
            sys.exit(1)
    except Exception as e:
        logger.error(f"Unexpected error during diarization: {e}")
        error_log_path = Path(__file__).parent / "diarization_exception.json"
        logger.save_logs_json(error_log_path)
        logger.error(f"Error logs saved to: {error_log_path}")
        sys.exit(1)
    
    logger.success("Diarization process completed successfully!")
    
    # Save final logs
    logger.save_logs_json(Path(args.output_dir) / "final_log.json")

if __name__ == "__main__":
    main() 