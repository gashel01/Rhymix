import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Load environment
script_dir = Path(__file__).resolve().parent
config_path = script_dir / "config" / ".env"
load_dotenv(config_path)

# Get HF token from environment
HF_TOKEN = os.getenv("HUGGINGFACE_TOKEN")

if not HF_TOKEN:
    print("ERROR: No Hugging Face token found in config/.env")
    sys.exit(1)

print("Checking pyannote.audio version...")
try:
    import pyannote.audio
    print(f"pyannote.audio version: {pyannote.audio.__version__}")
except ImportError:
    print("pyannote.audio not installed!")
    sys.exit(1)

print("\nChecking for model files...")
try:
    from huggingface_hub import scan_cache_dir, HfApi
    
    # First check local cache
    cache = scan_cache_dir()
    pyannote_repos = [repo for repo in cache.repos if 'pyannote' in repo.repo_id]
    
    if pyannote_repos:
        print(f"Found {len(pyannote_repos)} pyannote repositories in cache:")
        for repo in pyannote_repos:
            print(f"  - {repo.repo_id} ({len(repo.revisions)} revisions)")
            for rev in repo.revisions:
                print(f"    • {rev.commit_hash} - {len(rev.refs)} refs")
    else:
        print("No pyannote repositories found in local cache.")
    
    # Check if user has access to the models
    print("\nVerifying Hugging Face token access...")
    api = HfApi()
    api.set_access_token(HF_TOKEN)
    
    try:
        user_info = api.whoami()
        print(f"Authenticated as: {user_info.get('name', 'Unknown')}")
    except Exception as e:
        print(f"Error authenticating: {e}")
    
    print("\nAttempting to check model access...")
    try:
        from pyannote.audio import Pipeline
        print("Loading pipeline (this will download the model if needed)...")
        pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization", 
            use_auth_token=HF_TOKEN
        )
        print("✅ Success! Model loaded correctly.")
    except Exception as e:
        print(f"❌ Error loading model: {e}")
        raise
        
except Exception as e:
    print(f"Error during verification: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1) 