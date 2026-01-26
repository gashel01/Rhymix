import sys
import subprocess
import pkg_resources
import os

def check_and_install_dependencies():
    """Check and install required dependencies for diarization."""
    print("Checking diarization dependencies...")
    
    # Define required packages with versions
    required_packages = [
        "numpy==1.23.5",
        "librosa==0.9.1",
        "numba==0.56.4",
        "torch>=1.10",
        "torchaudio",
        "pyannote-audio==2.1.1",
        "python-dotenv",
        "pydub"
    ]
    
    # Check for virtual environment
    in_venv = hasattr(sys, 'real_prefix') or (hasattr(sys, 'base_prefix') and sys.base_prefix != sys.prefix)
    if not in_venv:
        print("WARNING: Not running in a virtual environment. It's recommended to use a virtual environment.")
    
    # Check and install missing packages
    try:
        # Get installed packages
        installed = {pkg.key: pkg.version for pkg in pkg_resources.working_set}
        
        # Check for missing or incorrect versions
        to_install = []
        for package in required_packages:
            package_name = package.split('==')[0]
            
            if '==' in package:
                required_version = package.split('==')[1]
                
                if package_name.lower() not in installed:
                    print(f"MISSING: {package_name}")
                    to_install.append(package)
                elif installed[package_name.lower()] != required_version:
                    print(f"VERSION MISMATCH: {package_name} (found {installed[package_name.lower()]}, need {required_version})")
                    to_install.append(package)
            else:
                # For packages without specific version requirements
                if package_name.lower() not in installed:
                    print(f"MISSING: {package_name}")
                    to_install.append(package)
        
        # Install missing packages
        if to_install:
            print(f"Installing {len(to_install)} packages...")
            subprocess.check_call([sys.executable, "-m", "pip", "install"] + to_install)
            print("SUCCESS: Dependencies installed successfully")
        else:
            print("SUCCESS: All dependencies are already installed")
            
        return True
    except Exception as e:
        print(f"ERROR: Failed checking/installing dependencies: {str(e)}")
        return False

if __name__ == "__main__":
    check_and_install_dependencies() 