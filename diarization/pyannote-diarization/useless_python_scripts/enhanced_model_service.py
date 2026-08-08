import os
import time
import torch
import threading
import socketserver
import pickle
import struct
import traceback
import gc
import logging
from pathlib import Path
from io import BytesIO
from dotenv import load_dotenv
from pyannote.audio import Pipeline

# Set up logging
LOG_DIR = Path(__file__).parent / "logs"
LOG_DIR.mkdir(exist_ok=True, parents=True)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(LOG_DIR / "enhanced_model_service.log"),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger("enhanced_model_service")

# Load environment variables
script_dir = Path(__file__).resolve().parent
config_path = script_dir / "config" / ".env"
load_dotenv(config_path)

# Get HF token from environment
HF_TOKEN = os.getenv("HUGGINGFACE_TOKEN")
if not HF_TOKEN:
    logger.error("No Hugging Face token found in .env file!")
    logger.error("Please add your token to config/.env file with the format:")
    logger.error("HUGGINGFACE_TOKEN=your_token_here")
    exit(1)

# Global model cache with initialization status
model = {
    "pipeline": None,
    "initializing": False,
    "initialized": False,
    "lock": threading.Lock(),
    "error": None
}

def initialize_model():
    """Initialize the model synchronously"""
    with model["lock"]:
        if model["initialized"]:
            logger.info("Model already initialized, skipping initialization")
            return True
        if model["initializing"]:
            logger.info("Model initialization already in progress, skipping")
            return False
        
        model["initializing"] = True
    
    try:
        logger.info("Starting model initialization...")
        start_time = time.time()
        
        # Check for GPU
        use_gpu = torch.cuda.is_available()
        device = "cuda" if use_gpu else "cpu"
        
        if use_gpu:
            logger.info(f"GPU detected: {torch.cuda.get_device_name(0)}")
            logger.info(f"CUDA version: {torch.version.cuda}")
            
            # Clear CUDA cache
            torch.cuda.empty_cache()
            gc.collect()
        else:
            logger.info("No GPU detected, using CPU (this will be slower)")
        
        # Load the pipeline
        logger.info("Loading pipeline from Hugging Face (this may take a while)...")
        
        # First make sure cache directory exists
        cache_dir = Path.home() / ".cache" / "torch" / "pyannote"
        cache_dir.mkdir(exist_ok=True, parents=True)
        
        pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization@2.1",
            use_auth_token=HF_TOKEN
        )
        
        logger.info(f"Moving pipeline to {device}...")
        pipeline = pipeline.to(device)
        
        # Save to model cache
        with model["lock"]:
            model["pipeline"] = pipeline
            model["initialized"] = True
            model["initializing"] = False
            model["error"] = None
            
        logger.info(f"Model initialized successfully in {time.time() - start_time:.2f}s")
        return True
        
    except Exception as e:
        logger.error(f"Error loading model: {e}")
        
        # Try a more direct download approach
        logger.info("Attempting direct model download using HF token...")
        try:
            # Set the token explicitly
            import huggingface_hub
            huggingface_hub.login(token=HF_TOKEN)
            
            # Force redownload with specific version
            logger.info("Downloading model with explicit version...")
            pipeline = Pipeline.from_pretrained(
                "pyannote/speaker-diarization",
                use_auth_token=HF_TOKEN,
                force_download=True
            )
            
            logger.info(f"Moving pipeline to {device}...")
            pipeline = pipeline.to(device)
            
            # Save to model cache
            with model["lock"]:
                model["pipeline"] = pipeline
                model["initialized"] = True
                model["initializing"] = False
                model["error"] = None
                
            logger.info(f"Model initialized successfully with direct download")
            return True
        except Exception as direct_error:
            logger.error(f"Direct model download failed: {direct_error}")
            logger.error(traceback.format_exc())
            
            with model["lock"]:
                model["initializing"] = False
                model["error"] = str(direct_error)
            return False

class ModelServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True

class ModelRequestHandler(socketserver.BaseRequestHandler):
    def handle(self):
        try:
            client_ip = self.client_address[0]
            logger.info(f"Received connection from {client_ip}")
            
            # Check if model is initialized
            if not model["initialized"]:
                logger.warning("Model not initialized yet, initializing now...")
                if not initialize_model():
                    error_msg = model["error"] or "Failed to initialize model"
                    logger.error(f"Cannot process request: {error_msg}")
                    self.send_error_response(f"Model initialization failed: {error_msg}")
                    return
            
            # Read message length
            raw_msglen = self.request.recv(4)
            if not raw_msglen:
                logger.error("Connection closed by client during header read")
                return
                
            msglen = struct.unpack('>I', raw_msglen)[0]
            logger.info(f"Receiving message of length {msglen} bytes from {client_ip}")
            
            # Read the message
            buffer = BytesIO()
            remaining = msglen
            
            while remaining > 0:
                chunk = self.request.recv(min(4096, remaining))
                if not chunk:
                    logger.error("Connection closed by client during data read")
                    return
                buffer.write(chunk)
                remaining -= len(chunk)
                
            # Process the request
            request_data = buffer.getvalue()
            request = pickle.loads(request_data)
            
            action = request.get('action')
            logger.info(f"Received {action} request from {client_ip}")
            
            if action == 'diarize':
                audio_data = request.get('audio_data')
                if not audio_data:
                    self.send_error_response("No audio data provided")
                    return
                    
                audio_size_kb = len(audio_data) / 1024
                logger.info(f"Processing {audio_size_kb:.1f} KB of audio data")
                
                # Save audio to temporary file
                temp_file = LOG_DIR / f"temp_audio_{int(time.time())}.wav"
                with open(temp_file, 'wb') as f:
                    f.write(audio_data)
                
                logger.info(f"Audio saved to {temp_file}")
                
                try:
                    # Run diarization
                    logger.info("Running diarization...")
                    start_time = time.time()
                    
                    # Get pipeline from cache
                    pipeline = model["pipeline"]
                    
                    # Process the audio
                    diarization = pipeline(str(temp_file))
                    
                    processing_time = time.time() - start_time
                    logger.info(f"Diarization completed in {processing_time:.2f}s")
                    
                    # Send success response
                    response = {
                        'success': True,
                        'diarization': diarization,
                        'processing_time': processing_time
                    }
                    
                    # Delete temporary file
                    try:
                        os.unlink(temp_file)
                        logger.info(f"Temporary file {temp_file} deleted")
                    except Exception as e:
                        logger.warning(f"Failed to delete temporary file: {e}")
                    
                except Exception as e:
                    logger.error(f"Diarization error: {e}")
                    logger.error(traceback.format_exc())
                    response = {
                        'success': False,
                        'error': str(e)
                    }
            else:
                logger.warning(f"Unknown action: {action}")
                response = {
                    'success': False,
                    'error': f"Unknown action: {action}"
                }
                
            # Send response
            self.send_response(response)
            
        except Exception as e:
            logger.error(f"Unhandled exception in request handler: {e}")
            logger.error(traceback.format_exc())
            self.send_error_response(f"Server error: {str(e)}")
    
    def send_response(self, response_obj):
        try:
            response_data = pickle.dumps(response_obj)
            self.request.sendall(struct.pack('>I', len(response_data)))
            self.request.sendall(response_data)
            logger.info(f"Response sent to {self.client_address[0]}")
        except Exception as e:
            logger.error(f"Error sending response: {e}")
    
    def send_error_response(self, error_message):
        self.send_response({
            'success': False,
            'error': error_message
        })

def main():
    try:
        # Initialize model first, synchronously
        logger.info("Starting enhanced diarization model service")
        logger.info("Initializing model...")
        initialize_model()
        
        # Start server
        server = ModelServer(('localhost', 9000), ModelRequestHandler)
        logger.info("Server running on localhost:9000")
        server.serve_forever()
        
    except Exception as e:
        logger.error(f"Error starting server: {e}")
        logger.error(traceback.format_exc())
        return 1

if __name__ == "__main__":
    main() 