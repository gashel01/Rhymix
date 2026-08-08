import os
import time
import torch
from pathlib import Path
from pyannote.audio import Pipeline
from dotenv import load_dotenv
import threading
import json
import socketserver
import pickle
import struct
from io import BytesIO
import sys
import traceback
import gc
import nvidia_smi
import logging

# Create a logs directory
LOG_DIR = Path(__file__).parent / "logs"
LOG_DIR.mkdir(exist_ok=True, parents=True)

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(LOG_DIR / "model_service.log"),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger("model_service")

# Load environment variables
script_dir = Path(__file__).resolve().parent
config_path = script_dir / "config" / ".env"
load_dotenv(config_path)

# Get HF token from environment
HF_TOKEN = os.getenv("HUGGINGFACE_TOKEN")

# Global model cache
model_cache = {
    "pipeline": None,
    "last_used": 0,
    "initialized": False,
    "lock": threading.Lock()
}

def initialize_models():
    """Initialize and cache the diarization models"""
    start_time = time.time()
    logger.info("Loading diarization model from Hugging Face (this will take a while)...")
    
    try:
        # Check for GPU
        use_gpu = torch.cuda.is_available()
        device = "cuda" if use_gpu else "cpu"
        
        if use_gpu:
            # Get GPU information
            try:
                nvidia_smi.nvmlInit()
                handle = nvidia_smi.nvmlDeviceGetHandleByIndex(0)
                info = nvidia_smi.nvmlDeviceGetMemoryInfo(handle)
                total_memory = info.total / 1024 / 1024  # Convert to MB
                free_memory = info.free / 1024 / 1024    # Convert to MB
                used_memory = info.used / 1024 / 1024    # Convert to MB
                
                logger.info(f"GPU detected ({torch.cuda.get_device_name(0)})")
                logger.info(f"  - Total Memory: {total_memory:.0f} MB")
                logger.info(f"  - Used Memory: {used_memory:.0f} MB")
                logger.info(f"  - Free Memory: {free_memory:.0f} MB")
                
                # Set PyTorch to use less memory if we're low on VRAM
                if free_memory < 2000:  # Less than 2GB free
                    logger.warning("Low GPU memory, using more aggressive memory optimization")
                    torch.cuda.set_per_process_memory_fraction(0.7)  # Use only 70% of available memory
            except Exception as e:
                logger.error(f"Could not get detailed GPU memory info: {e}")
                logger.info("Using default GPU settings")
            
            # Clear CUDA cache to ensure we have enough memory
            torch.cuda.empty_cache()
            gc.collect()  # Force garbage collection
        else:
            logger.info("No GPU detected, using CPU (this will be slower)")
        
        # Enable mixed precision if available
        if use_gpu and hasattr(torch.cuda, 'amp'):
            logger.info("Enabling mixed precision for faster processing and lower memory usage")
        
        # Load the pipeline
        logger.info("Loading pipeline from Hugging Face...")
        try:
            # First try to load from cache
            cache_dir = Path.home() / ".cache" / "torch" / "pyannote"
            
            # Create the cache directory if it doesn't exist
            if not cache_dir.exists():
                cache_dir.mkdir(parents=True, exist_ok=True)
                logger.info(f"Created cache directory: {cache_dir}")
            else:
                logger.info(f"Using existing cache directory: {cache_dir}")
            
            # Log the cache directory contents before loading
            cache_files = list(cache_dir.glob("**/*"))
            logger.info(f"Cache directory contains {len(cache_files)} files/directories before loading")
            
            # Load the pipeline
            pipeline = Pipeline.from_pretrained(
                "pyannote/speaker-diarization@2.1", 
                use_auth_token=HF_TOKEN,
                cache_dir=str(cache_dir)
            )
            
            # Log the cache directory contents after loading
            cache_files_after = list(cache_dir.glob("**/*"))
            logger.info(f"Cache directory contains {len(cache_files_after)} files/directories after loading")
            
        except Exception as e:
            logger.error(f"Error loading from cache: {e}")
            logger.error(traceback.format_exc())
            
            # Try without specifying cache directory
            logger.info("Trying to load without cache directory...")
            pipeline = Pipeline.from_pretrained(
                "pyannote/speaker-diarization@2.1", 
                use_auth_token=HF_TOKEN
            )
        
        # Move to appropriate device
        logger.info(f"Moving pipeline to {device}...")
        pipeline = pipeline.to(device)
        
        # Update cache
        with model_cache["lock"]:
            model_cache["pipeline"] = pipeline
            model_cache["initialized"] = True
            model_cache["last_used"] = time.time()
        
        logger.info(f"Model loaded successfully in {time.time() - start_time:.2f}s")
        return True
    except Exception as e:
        logger.error(f"Error loading models: {e}")
        logger.error(traceback.format_exc())
        return False

def get_pipeline():
    """Get the cached pipeline or initialize it if needed"""
    with model_cache["lock"]:
        if not model_cache["initialized"]:
            threading.Thread(target=initialize_models).start()
            raise ValueError("Models not initialized yet, please try again in a minute")
        
        # Update last used time
        model_cache["last_used"] = time.time()
        return model_cache["pipeline"]

# Start a background thread to initialize models at startup
print("Starting model initialization in background...")
threading.Thread(target=initialize_models).start()

# 30-minute auto-unload to free memory if not used
def check_model_timeout():
    while True:
        time.sleep(60)  # Check every minute
        with model_cache["lock"]:
            if model_cache["initialized"] and (time.time() - model_cache["last_used"]) > 1800:  # 30 minutes
                print("Models unused for 30 minutes, unloading to free memory")
                model_cache["pipeline"] = None
                model_cache["initialized"] = False
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()

# Start timeout checker in background
threading.Thread(target=check_model_timeout, daemon=True).start()

# Create a simple socket server to serve model inferences
class ModelServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True

class ModelRequestHandler(socketserver.BaseRequestHandler):
    def handle(self):
        try:
            logger.info(f"Received connection from {self.client_address}")
            
            # Get message length
            raw_msglen = self.request.recv(4)
            if not raw_msglen:
                logger.error("Connection closed by client")
                return
                
            msglen = struct.unpack('>I', raw_msglen)[0]
            logger.info(f"Receiving message of length {msglen} bytes")
            
            # Read the data
            data = self.read_data(msglen)
            if not data:
                logger.error("Failed to read complete data")
                return
                
            # Parse the request
            request = pickle.loads(data)
            logger.info(f"Received request with action: {request.get('action')}")
            
            if request.get('action') == 'diarize':
                audio_data = request.get('audio_data')
                logger.info(f"Received audio data: {len(audio_data)/1024:.1f} KB")
                
                try:
                    # Get the pipeline
                    logger.info("Getting pipeline from cache...")
                    start_time = time.time()
                    pipeline = get_pipeline()
                    logger.info(f"Got pipeline in {time.time() - start_time:.2f}s")
                    
                    # Create a temporary file for the audio data
                    import tempfile
                    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
                        temp_filename = temp_file.name
                        temp_file.write(audio_data)
                        logger.info(f"Saved audio data to temporary file: {temp_filename}")
                    
                    # Log memory status before diarization
                    if torch.cuda.is_available():
                        free_mem = torch.cuda.memory_allocated() / 1024**2
                        logger.info(f"GPU memory allocated before diarization: {free_mem:.1f} MB")
                    
                    # Run diarization
                    logger.info("Running diarization...")
                    diarization_start = time.time()
                    diarization = pipeline(temp_filename)
                    logger.info(f"Diarization completed in {time.time() - diarization_start:.2f}s")
                    
                    # Clean up temporary file
                    try:
                        os.unlink(temp_filename)
                        logger.info(f"Removed temporary file: {temp_filename}")
                    except Exception as e:
                        logger.warning(f"Failed to remove temporary file: {e}")
                    
                    # Create response
                    logger.info("Creating response...")
                    response = {
                        'success': True,
                        'diarization': diarization
                    }
                except Exception as e:
                    logger.error(f"Error in diarization: {e}")
                    logger.error(traceback.format_exc())
                    response = {
                        'success': False,
                        'error': str(e)
                    }
            else:
                logger.warning(f"Unknown action: {request.get('action')}")
                response = {
                    'success': False,
                    'error': 'Unknown action'
                }
                
            # Serialize and send the response
            logger.info("Sending response...")
            response_data = pickle.dumps(response)
            response_size = len(response_data) / 1024
            logger.info(f"Response size: {response_size:.1f} KB")
            self.request.sendall(struct.pack('>I', len(response_data)))
            self.request.sendall(response_data)
            logger.info("Response sent successfully")
            
        except Exception as e:
            logger.error(f"Error in request handler: {e}")
            logger.error(traceback.format_exc())
            
    def read_data(self, length):
        buffer = BytesIO()
        remaining = length
        
        while remaining > 0:
            data = self.request.recv(min(4096, remaining))
            if not data:
                return None
            buffer.write(data)
            remaining -= len(data)
            
        return buffer.getvalue()

def validate_pytorch_cuda():
    """Validate that PyTorch is correctly installed with CUDA support"""
    print(f"PyTorch version: {torch.__version__}")
    
    if torch.cuda.is_available():
        print(f"CUDA is available: {torch.version.cuda}")
        print(f"GPU device: {torch.cuda.get_device_name(0)}")
        
        # Print the architecture capabilities
        capability = torch.cuda.get_device_capability(0)
        print(f"CUDA device capability: {capability[0]}.{capability[1]}")
        
        # Test CUDA with a simple operation
        try:
            a = torch.tensor([1.0, 2.0, 3.0], device='cuda')
            b = a * 2
            print(f"CUDA test successful: {a} * 2 = {b}")
            return True
        except Exception as e:
            print(f"CUDA test failed: {e}")
            return False
    else:
        print("CUDA is not available")
        print("Reasons this might happen:")
        print("1. PyTorch was installed without CUDA support")
        print("2. NVIDIA drivers are not properly installed")
        print("3. Your GPU is not CUDA-compatible")
        print("4. CUDA toolkit is not installed or not in PATH")
        return False

# Call this at startup
validate_pytorch_cuda()

if __name__ == "__main__":
    try:
        print(f"Python version: {sys.version}")
        print(f"PyTorch version: {torch.__version__}")
        print(f"Running from: {os.path.dirname(os.path.abspath(__file__))}")
        
        # Check if HF token is available
        if not HF_TOKEN:
            print("ERROR: No Hugging Face token found in config/.env file")
            print("Please add your token to config/.env file with the format:")
            print("HUGGINGFACE_TOKEN=your_token_here")
            sys.exit(1)
        
        # Try binding to the port
        try:
            server = ModelServer(('localhost', 9000), ModelRequestHandler)
            print("Model service running on localhost:9000")
            print("Waiting for diarization requests...")
            server.serve_forever()
        except OSError as e:
            if e.errno == 10048:  # Address already in use
                print("ERROR: Port 9000 is already in use")
                print("Another instance of the model service might be running")
                print("Please close that instance before starting a new one")
            else:
                print(f"ERROR starting server: {e}")
            sys.exit(1)
    except Exception as e:
        print(f"ERROR: Unhandled exception in model service: {e}")
        traceback.print_exc()
        sys.exit(1) 