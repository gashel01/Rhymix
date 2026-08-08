import os
import subprocess
import sys
import time
from pathlib import Path

def setup_diarization_environment():
    """
    Set up a dedicated virtual environment for diarization with exact package versions.
    """
    # Get the directory of this script
    script_dir = Path(__file__).resolve().parent
    
    # Path to requirements file
    requirements_file = script_dir / "requirements.txt"
    
    # Path for virtual environment
    venv_dir = script_dir / "venv"
    
    print("--- Setting up diarization environment ---")
    
    # Check if requirements file exists
    if not requirements_file.exists():
        print("ERROR: Requirements file not found at", requirements_file)
        return False
    
    try:
        # Check if virtual environment exists and has the right packages
        venv_exists = venv_dir.exists()
        
        # If it exists, check if it has the right packages before recreating
        if venv_exists:
            print("Checking existing virtual environment...")
            try:
                # Determine Python executable path
                if os.name == 'nt':  # Windows
                    venv_python = venv_dir / "Scripts" / "python.exe"
                else:  # Unix/Linux/Mac
                    venv_python = venv_dir / "bin" / "python"
                
                if not venv_python.exists():
                    print("WARNING: Existing environment is broken, recreating...")
                    venv_exists = False
                else:
                    # Try importing pyannote to check if environment is working
                    test_imports = subprocess.run([
                        str(venv_python), "-c", 
                        "import numpy, librosa, numba, torch, torchaudio, pyannote.audio; print('Environment OK')"
                    ], capture_output=True, text=True)
                    
                    if test_imports.returncode != 0 or "Environment OK" not in test_imports.stdout:
                        print("WARNING: Existing environment is missing required packages, recreating...")
                        venv_exists = False
                    else:
                        print("SUCCESS: Existing environment is valid!")
                        return True
            except Exception as e:
                print(f"WARNING: Error checking environment: {e}")
                venv_exists = False
        
        # If virtual environment doesn't exist or is invalid, create a new one
        if not venv_exists:
            print(f"Creating fresh virtual environment at {venv_dir}...")
            
            # Remove existing environment if it exists
            if venv_dir.exists():
                import shutil
                shutil.rmtree(venv_dir)
                time.sleep(1)  # Wait a moment to ensure directory is deleted
            
            # Create new virtual environment
            subprocess.check_call([sys.executable, "-m", "venv", str(venv_dir)])
        
        # Get path to Python in virtual environment
        if os.name == 'nt':  # Windows
            venv_python = venv_dir / "Scripts" / "python.exe"
            venv_pip = venv_dir / "Scripts" / "pip.exe"
        else:  # Unix/Linux/Mac
            venv_python = venv_dir / "bin" / "python"
            venv_pip = venv_dir / "bin" / "pip"
        
        # Update pip first
        print("Updating pip in virtual environment...")
        subprocess.check_call([
            str(venv_python), "-m", "pip", "install", "--upgrade", "pip"
        ])
        
        # Install dependencies
        print("Installing diarization dependencies (this may take several minutes)...")
        subprocess.check_call([
            str(venv_python), "-m", "pip", "install", "-r", str(requirements_file)
        ])
        
        # Verify installation
        verify_cmd = subprocess.run([
            str(venv_python), "-c", 
            "import numpy, librosa, numba, torch, torchaudio, pyannote.audio; print('All packages imported successfully')"
        ], capture_output=True, text=True)
        
        if verify_cmd.returncode == 0 and "successfully" in verify_cmd.stdout:
            print("SUCCESS: Diarization environment set up successfully!")
            print(f"INFO: To use this environment manually: {venv_dir}")
            return True
        else:
            print(f"WARNING: Environment verification failed: {verify_cmd.stderr}")
            return False
        
    except subprocess.CalledProcessError as e:
        print(f"ERROR: Error setting up environment: {e}")
        print(f"Error output: {e.stderr if hasattr(e, 'stderr') else 'No error output'}")
        return False
    except Exception as e:
        print(f"ERROR: Unexpected error: {e}")
        return False

if __name__ == "__main__":
    setup_diarization_environment()

# This script should be in the project already, but if not, run:
# python diarization/setup_diarization.py 