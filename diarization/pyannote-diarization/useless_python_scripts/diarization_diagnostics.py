import os
import sys
import torch
import time
import socket
import pickle
import struct
import logging
import traceback
import platform
import psutil
import json
from datetime import datetime
from pathlib import Path

# Set up logging
LOG_DIR = Path(__file__).parent / "logs"
LOG_DIR.mkdir(exist_ok=True, parents=True)

# Create a unique log file name with timestamp
timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
log_file = LOG_DIR / f"diarization_diagnostics_{timestamp}.log"

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(log_file),
        logging.StreamHandler(sys.stdout)
    ]
)

logger = logging.getLogger("diarization_diagnostics")

def log_system_info():
    """Log detailed information about the system"""
    logger.info("="*80)
    logger.info("SYSTEM DIAGNOSTICS")
    logger.info("="*80)
    
    # Python and dependencies
    logger.info(f"Python version: {sys.version}")
    logger.info(f"Platform: {platform.platform()}")
    
    # PyTorch info
    logger.info(f"PyTorch version: {torch.__version__}")
    logger.info(f"CUDA available: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        logger.info(f"CUDA version: {torch.version.cuda}")
        logger.info(f"GPU count: {torch.cuda.device_count()}")
        for i in range(torch.cuda.device_count()):
            logger.info(f"GPU {i}: {torch.cuda.get_device_name(i)}")
            logger.info(f"GPU {i} capability: {torch.cuda.get_device_capability(i)}")
            props = torch.cuda.get_device_properties(i)
            logger.info(f"GPU {i} memory: {props.total_memory / 1024**2:.0f} MB")
    
    # CPU and memory
    logger.info(f"CPU cores: {psutil.cpu_count(logical=False)} physical, {psutil.cpu_count()} logical")
    memory = psutil.virtual_memory()
    logger.info(f"Memory: {memory.total / 1024**3:.1f} GB total, {memory.available / 1024**3:.1f} GB available")
    
    # Process info
    process = psutil.Process(os.getpid())
    logger.info(f"Process memory usage: {process.memory_info().rss / 1024**2:.1f} MB")
    
    # Environment variables
    logger.info("Environment variables:")
    for var in ['CUDA_VISIBLE_DEVICES', 'PYTORCH_CUDA_ALLOC_CONF', 'PYTORCH_JIT']:
        if var in os.environ:
            logger.info(f"  {var}={os.environ[var]}")
    
    logger.info("="*80)

def test_model_service_connection():
    """Test connection to the model service"""
    logger.info("Testing connection to model service...")
    
    # Create a small audio file for testing
    test_file = LOG_DIR / "test_audio.wav"
    if not test_file.exists():
        logger.info("Creating test audio file...")
        # Create a simple sine wave audio file
        import numpy as np
        from scipy.io import wavfile
        sample_rate = 16000
        duration = 1.0  # seconds
        t = np.linspace(0, duration, int(sample_rate * duration), endpoint=False)
        audio = np.sin(2 * np.pi * 440 * t) * 0.3
        wavfile.write(test_file, sample_rate, audio.astype(np.float32))
    
    # Try to connect to the model service
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5)
        
        logger.info("Connecting to model service on localhost:9000...")
        start_time = time.time()
        sock.connect(("localhost", 9000))
        logger.info(f"Connected in {time.time() - start_time:.2f}s")
        
        # Read the test audio file
        logger.info(f"Reading test audio file: {test_file}")
        with open(test_file, "rb") as f:
            audio_data = f.read()
        
        # Create the request
        request = {
            "action": "diarize",
            "audio_data": audio_data
        }
        
        # Send the request
        logger.info(f"Sending diarization request ({len(audio_data)/1024:.1f} KB)")
        start_time = time.time()
        request_data = pickle.dumps(request)
        sock.sendall(struct.pack('>I', len(request_data)))
        sock.sendall(request_data)
        
        # Receive the response
        logger.info("Waiting for response...")
        raw_msglen = sock.recv(4)
        if not raw_msglen:
            logger.error("Connection closed by server")
            return False
        
        msglen = struct.unpack('>I', raw_msglen)[0]
        logger.info(f"Receiving {msglen/1024:.1f} KB of data")
        
        buffer = bytearray()
        while len(buffer) < msglen:
            chunk = sock.recv(min(4096, msglen - len(buffer)))
            if not chunk:
                logger.error("Connection closed during data transfer")
                return False
            buffer.extend(chunk)
        
        # Unserialize the response
        response = pickle.loads(buffer)
        elapsed = time.time() - start_time
        
        if response.get("success"):
            logger.info(f"Diarization successful in {elapsed:.2f}s")
            if "diarization" in response:
                logger.info("Diarization result received")
            return True
        else:
            logger.error(f"Diarization failed: {response.get('error')}")
            return False
        
    except Exception as e:
        logger.error(f"Error testing model service: {e}")
        logger.error(traceback.format_exc())
        return False
    finally:
        try:
            sock.close()
        except:
            pass

def check_model_files():
    """Check if model files exist and log their details"""
    logger.info("Checking model files...")
    
    # PyAnnote cache directory
    cache_dir = Path.home() / ".cache" / "torch" / "pyannote"
    if cache_dir.exists():
        logger.info(f"Cache directory exists: {cache_dir}")
        # List files in the cache directory
        files = list(cache_dir.glob("**/*"))
        logger.info(f"Found {len(files)} files/directories in cache")
        
        # Log details of the most important files
        for f in files[:20]:  # Limit to first 20 files to avoid huge logs
            if f.is_file():
                size_mb = f.stat().st_size / (1024 * 1024)
                logger.info(f"  {f.relative_to(cache_dir)} ({size_mb:.2f} MB)")
    else:
        logger.warning(f"Cache directory not found: {cache_dir}")
    
    # Hugging Face cache
    hf_cache = Path.home() / ".cache" / "huggingface"
    if hf_cache.exists():
        logger.info(f"Hugging Face cache exists: {hf_cache}")
        # Check if the model is downloaded
        model_dirs = list(hf_cache.glob("**/pyannote*"))
        if model_dirs:
            logger.info(f"Found {len(model_dirs)} pyannote model directories")
            for d in model_dirs:
                logger.info(f"  {d.relative_to(hf_cache)}")
        else:
            logger.warning("No pyannote model directories found in HF cache")
    else:
        logger.warning(f"Hugging Face cache not found: {hf_cache}")

def run_diagnostics():
    """Run all diagnostic checks"""
    try:
        logger.info("Starting diarization diagnostics")
        
        # Log basic system info
        log_system_info()
        
        # Check model files
        check_model_files()
        
        # Test model service connection
        test_model_service_connection()
        
        logger.info("Diagnostics complete")
        
        # Return the log file path for reference
        return log_file
    except Exception as e:
        logger.error(f"Error in diagnostics: {e}")
        logger.error(traceback.format_exc())
        return log_file

if __name__ == "__main__":
    log_file = run_diagnostics()
    print(f"Diagnostics complete. Log file: {log_file}") 