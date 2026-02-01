import os

# Disable FFmpeg requirement for torchaudio BEFORE any torch imports
os.environ['TORIO_USE_FFMPEG'] = '0'
# Alternative FFmpeg disable methods
os.environ['TORCHAUDIO_USE_FFMPEG'] = '0'
os.environ['FFMPEG_ROOT'] = ''
# Fix OpenMP runtime conflicts
os.environ['KMP_DUPLICATE_LIB_OK'] = 'TRUE'
# Reduce verbose logging
os.environ['PYTHONWARNINGS'] = 'ignore'
import logging
# Set root logger to CRITICAL to suppress all debug output
logging.basicConfig(level=logging.CRITICAL, format='%(levelname)s: %(message)s')
logging.getLogger().setLevel(logging.CRITICAL)
# Suppress ALL debuggers that cause verbose output
for logger_name in ['torio', 'byteflow', 'torch', 'torchaudio', 'applio', 'rvc', 'core']:
    logger = logging.getLogger(logger_name)
    logger.setLevel(logging.CRITICAL)
    logger.disabled = True
    # Also disable any handlers
    for handler in logger.handlers:
        handler.setLevel(logging.CRITICAL)

import time
import uuid
import zipfile
import threading
import json
import requests
from bs4 import BeautifulSoup
from pathlib import Path
from flask import Flask, request, jsonify, send_file, send_from_directory, Response, render_template, redirect, url_for
from flask_cors import CORS
from clean_vocals import (
    clean_directories,
    process_all,
    create_needed_directories,
    progress_queue,
)
import queue
import traceback
from werkzeug.utils import secure_filename
from datetime import datetime
import subprocess
from dotenv import load_dotenv
import re
import sys
import shutil
import random
import hashlib
import urllib.parse
import logging
import tempfile
import glob
from logging.config import dictConfig
import gradio as gr

# Import utility functions and Config
from app.utils.file_handling import FileHandler
from app.utils.audio_processor import AudioProcessor
from app.config import Config

# Import applio core functions
applio_path = os.path.abspath("applio")
sys.path.append(applio_path)
# Add RVC module path
rvc_path = os.path.join(applio_path, "rvc")
sys.path.append(rvc_path)

# ===============================
# CENTRALIZED PATH MANAGEMENT
# ===============================

class PathManager:
    """Centralized path management for the application"""

    def __init__(self):
        # Base directories
        self.BASE_DIR = Path(__file__).parent
        self.APPLIO_DIR = self.BASE_DIR / "applio"
        self.METADATA_DIR = self.BASE_DIR / "data" / "metadata"

        # Import paths from Config
        self.INPUT_DIR = Path(Config.INPUT_DIR)
        self.TEMP_WAV_DIR = Path(Config.TEMP_WAV_DIR)
        self.UVR_RAW_DIR = Path(Config.UVR_RAW_DIR)
        self.UVR_PROCESSED_DIR = Path(Config.UVR_PROCESSED_DIR)
        self.INSTRUMENTAL_DIR = Path(Config.INSTRUMENTAL_DIR)
        self.EXPORT_DIR = Path(Config.EXPORT_DIR)
        self.DIARIZATION_CONFIG_DIR = Path(Config.DIARIZATION_CONFIG_DIR)
        self.DIARIZATION_INPUT = Path(Config.DIARIZATION_INPUT)
        self.SPEAKER_DIR = Path(Config.SPEAKER_DIR)
        self.ORIGINAL_AUDIO_DIR = Path(Config.ORIGINAL_AUDIO_DIR)
        self.TALKING_DIR = Path(Config.TALKING_DIR)
        self.TALKING_UPLOADS_DIR = Path(Config.TALKING_UPLOADS_DIR)
        self.TALKING_RESULTS_DIR = Path(Config.TALKING_RESULTS_DIR)

        # Singing-specific directories
        self.SINGING_JOBS_DIR = self.BASE_DIR / "data" / "singing" / "jobs"

        # Talking-specific directories
        self.TALKING_TEMP_DIR = self.TALKING_RESULTS_DIR / "temp"
        self.TALKING_SPEAKER_UNKNOWN_DIR_SUFFIX = "speaker_unknown"

        # Model and training directories (using logs/ instead of applio/logs/)
        self.APPLIO_MODELS_DIR = self.BASE_DIR / "logs"
        self.APPLIO_DATASET_DIR = self.APPLIO_DIR / "assets" / "datasets"
        self.APPLIO_ASSETS_DIR = self.APPLIO_DIR / "assets"

        # Inference-specific directories
        self.INFERENCE_DIR = self.BASE_DIR / "data" / "singing" / "inference"
        self.INFERENCE_RUNS_DIR = self.INFERENCE_DIR / "runs"

    def ensure_directories_exist(self):
        """Ensure all required directories exist"""
        directories = [
            self.INPUT_DIR,
            self.TEMP_WAV_DIR,
            self.UVR_RAW_DIR,
            self.UVR_PROCESSED_DIR,
            self.INSTRUMENTAL_DIR,
            self.EXPORT_DIR,
            self.DIARIZATION_CONFIG_DIR,
            self.DIARIZATION_INPUT,
            self.SPEAKER_DIR,
            self.ORIGINAL_AUDIO_DIR,
            self.TALKING_DIR,
            self.TALKING_UPLOADS_DIR,
            self.TALKING_RESULTS_DIR,
            self.TALKING_TEMP_DIR,
            self.SINGING_JOBS_DIR,
            self.APPLIO_MODELS_DIR,
            self.APPLIO_DATASET_DIR,
            self.INFERENCE_DIR,
            self.INFERENCE_RUNS_DIR,
            self.METADATA_DIR,
        ]

        for directory in directories:
            directory.mkdir(parents=True, exist_ok=True)

    def get_vocal_file_path(self, filename, processed=False):
        """Get path to vocal file (raw or processed)"""
        if processed:
            return self.UVR_PROCESSED_DIR / filename
        else:
            return self.UVR_RAW_DIR / filename

    def get_instrumental_file_path(self, filename):
        """Get path to instrumental file"""
        return self.INSTRUMENTAL_DIR / filename

    def get_export_file_path(self, filename):
        """Get path to export file"""
        return self.EXPORT_DIR / filename

    def get_inference_file_path(self, filename):
        """Get path to inference result file"""
        return self.INFERENCE_DIR / filename

    def get_talking_speaker_dir(self, dataset_name, speaker_name):
        """Get path to a specific speaker directory in talking results"""
        return self.TALKING_RESULTS_DIR / dataset_name / speaker_name

    def get_applio_model_dir(self, model_name):
        """Get path to a specific applio model directory"""
        return self.APPLIO_MODELS_DIR / model_name

    def get_applio_dataset_dir(self, dataset_name):
        """Get path to a specific applio dataset directory"""
        return self.APPLIO_DATASET_DIR / dataset_name

# Initialize path manager
paths = PathManager()
paths.ensure_directories_exist()

# ===============================
# FILENAME + METADATA HELPERS
# ===============================

UPLOAD_METADATA_PATH = paths.METADATA_DIR / "uploads.json"

def sanitize_filename_for_display(filename: str) -> str:
    """Sanitize filename for UI display without breaking unicode."""
    if not filename:
        return "unnamed_file"
    base = Path(filename).name
    cleaned = re.sub(r"[\x00-\x1f\x7f]", "", base).strip()
    return cleaned or "unnamed_file"

def make_storage_name(original_name: str, file_id: str = None) -> tuple[str, str]:
    """Create a safe storage name using a UUID plus the original extension."""
    file_id = file_id or uuid.uuid4().hex
    ext = Path(original_name).suffix.lower()
    if not re.match(r"^\.[a-z0-9]{1,10}$", ext):
        ext = ""
    return f"{file_id}{ext}", file_id

def make_run_id() -> str:
    return uuid.uuid4().hex

def _load_metadata_file(path: Path) -> dict:
    if not path.exists():
        return {"files": {}}
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict) and "files" in data:
            return data
    except Exception:
        pass
    return {"files": {}}

def _save_metadata_file(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(".tmp")
    with tmp_path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, sort_keys=True)
    tmp_path.replace(path)

def register_upload_metadata(original_name: str, stored_name: str, file_id: str) -> dict:
    display_name = sanitize_filename_for_display(original_name)
    created_at = datetime.now().isoformat()
    record = {
        "fileId": file_id,
        "originalName": Path(original_name).name,
        "storedName": stored_name,
        "safeDisplayName": display_name,
        "createdAt": created_at,
    }
    data = _load_metadata_file(UPLOAD_METADATA_PATH)
    data.setdefault("files", {})[file_id] = record
    _save_metadata_file(UPLOAD_METADATA_PATH, data)
    return record

def get_upload_metadata(file_id: str):
    data = _load_metadata_file(UPLOAD_METADATA_PATH)
    return data.get("files", {}).get(file_id)

def list_upload_metadata() -> list[dict]:
    data = _load_metadata_file(UPLOAD_METADATA_PATH)
    return list(data.get("files", {}).values())

def get_upload_base_name(file_id: str):
    record = get_upload_metadata(file_id)
    if not record:
        return None
    return Path(record["storedName"]).stem

def save_inference_run_metadata(run_id: str, payload: dict) -> None:
    run_dir = paths.INFERENCE_RUNS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    run_file = run_dir / "run.json"
    with run_file.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)

def load_inference_run_metadata(run_id: str):
    run_file = paths.INFERENCE_RUNS_DIR / run_id / "run.json"
    if not run_file.exists():
        return None
    try:
        with run_file.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return None

def list_inference_runs() -> list[dict]:
    results = []
    if not paths.INFERENCE_RUNS_DIR.exists():
        return results
    for run_dir in sorted(paths.INFERENCE_RUNS_DIR.glob("*")):
        if not run_dir.is_dir():
            continue
        run_id = run_dir.name
        run_meta = load_inference_run_metadata(run_id)
        if run_meta:
            results.append(run_meta)
    return results

# Now try importing the core functions
try:
    from core import (
        run_infer_script, 
        run_preprocess_script,
        run_extract_script,
        run_train_script,
        run_index_script
    )
except ImportError as e:
    print(f"Error importing core functions: {e}")
    # Use direct path calls as fallback
    run_extract_script = None
    run_train_script = None
    run_index_script = None
    run_singer_training_pipeline = None

app = Flask(__name__, static_folder='frontend/build', static_url_path='')
CORS(app)

# Set up logging at the top of your file
dictConfig({
    'version': 1,
    'formatters': {
        'default': {
            'format': '[%(asctime)s] %(levelname)s in %(module)s: %(message)s',
        },
    },
    'handlers': {
        'wsgi': {
            'class': 'logging.StreamHandler',
            'stream': 'ext://flask.logging.wsgi_errors_stream',
            'formatter': 'default'
        },
        'file': {
            'class': 'logging.FileHandler',
            'filename': 'flask_app.log',
            'formatter': 'default'
        }
    },
    'root': {
        'level': 'DEBUG',
        'handlers': ['wsgi', 'file']
    }
})

# Then use logger instead of print
logger = logging.getLogger(__name__)

# Store active jobs
active_jobs = {}

# Paths are now managed by PathManager (paths object above)

# Directory creation is now handled by PathManager.ensure_directories_exist()

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    file = path if path and os.path.exists(f"{app.static_folder}/{path}") else 'index.html'
    return send_from_directory(app.static_folder, file)

@app.route("/api/upload", methods=["POST"])
def upload_files():
    try:
        files = request.files.getlist('file') + request.files.getlist('files')
        files = [f for f in files if f and f.filename]
        if not files:
            return jsonify({"error": "No files provided"}), 400

        records = []
        for f in files:
            stored_name, file_id = make_storage_name(f.filename)
            path = paths.INPUT_DIR / stored_name
            f.save(path)
            record = register_upload_metadata(f.filename, stored_name, file_id)
            records.append(record)
            print(f"Saved file: {path}")

        return jsonify({
            "message": f"Successfully uploaded {len(records)} files",
            "files": records,
        })

    except Exception as e:
        print(f"Upload error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/process', methods=['POST'])
def process_files():
    d = request.json or {}
    cfg = {k: d.get(k, v) for k, v in 
          {'segment':False,'process':True,'export':False,'clean':False}.items()}

    job_id = str(uuid.uuid4())
    active_jobs[job_id] = {
        'id': job_id, 'status': 'starting', 'progress': 0,
        'config': cfg, 'started_at': time.time()
    }

    time.sleep(1.0)
    threading.Thread(
        target=process_audio_files_thread,
        args=(job_id, *cfg.values())
    ).start()

    return jsonify({'job_id': job_id})


def collect_output_files(segment_audio, process_audio):
    return {
        'raw_vocals': [f.name for f in paths.UVR_RAW_DIR.glob("*_vocals.wav")],
        'processed_vocals': [f.name for f in paths.UVR_PROCESSED_DIR.glob("*_vocals.wav")] if process_audio else [],
        'exports': [f.name for f in paths.EXPORT_DIR.glob("*.zip")]
    }
@app.route('/api/job/<job_id>')
def get_job_status(job_id):
    return (jsonify(active_jobs[job_id]), 200) if job_id in active_jobs else (jsonify({'error':'Job not found'}), 404)

@app.route('/api/download/<file_type>/<path:filename>')
def download_file(file_type, filename):
    try:
        print(f"Download request - Type: {file_type}, Filename: {filename}")
        filename = os.path.basename(urllib.parse.unquote(filename))
        print(f"Sanitized filename: {filename}")

        dir_map = {
            'raw_vocals': paths.UVR_RAW_DIR,
            'processed_vocals': paths.UVR_PROCESSED_DIR,
            'exports': paths.EXPORT_DIR,
            'instrumental': paths.INSTRUMENTAL_DIR
        }
        if file_type not in dir_map:
            print(f"Invalid file type: {file_type}")
            return jsonify({'error': f'Invalid file type: {file_type}'}), 400

        target_dir = dir_map[file_type]
        print(f"Looking in directory: {target_dir}")

        if not target_dir.exists():
            print(f"Directory does not exist: {target_dir}")
            return jsonify({'error': f"Directory {file_type} does not exist", 'directory': str(target_dir)}), 404

        existing = [f.name for f in target_dir.glob('*.wav')]
        print(f"Files in directory ({len(existing)}): {existing[:5]}...")

        file_path = target_dir / filename
        file_id = filename
        if file_type in {'raw_vocals', 'processed_vocals', 'instrumental'}:
            base_name = get_upload_base_name(file_id)
            if not base_name:
                return jsonify({'error': f'Unknown fileId: {file_id}'}), 404
            if file_type == 'instrumental':
                filename = f"{base_name}_instrumental.wav"
            else:
                filename = f"{base_name}_vocals.wav"
            file_path = target_dir / filename

        print(f"Full file path: {file_path}")

        if not file_path.exists():
            print(f"File not found: {file_path}")
            matches = [f for f in existing if filename.lower() in f.lower() or f.lower() in filename.lower()]
            return jsonify({
                'error': f"File {filename} not found in {dir_map[file_type]}",
                'requested_filename': filename, 'available_files': existing,
                'similar_matches': matches[:10]
            }), 404

        print(f"File found, sending: {file_path}")
        return send_file(file_path, mimetype="audio/wav", as_attachment=True, download_name=filename)

    except Exception as e:
        print(f"Error in download_file: {e}")
        traceback.print_exc()
        return jsonify({'error': f"Internal server error: {e}", 'file_type': file_type, 'filename': filename}), 500


def clean_directory(d, force=False, show_empty=True):
    if not d.exists():
        d.mkdir(parents=True, exist_ok=True)
        return show_empty and print(f"  ✅ {d.name} already empty")
    try:
        items = list(d.glob("*"))
        if not items: return show_empty and print(f"  ✅ {d.name} already empty")
        n = 0
        for p in items:
            try:
                (time.sleep(0.1), p.unlink(missing_ok=True)) if p.is_file() else shutil.rmtree(p, ignore_errors=True)
                n += 1
            except Exception:
                if force and os.name == 'nt':
                    try:
                        os.system(f'del /F /Q "{p}"') if p.is_file() else shutil.rmtree(p, ignore_errors=True)
                        n += 1
                    except: pass
        print(f"  ✅ {d.name} cleaned ({n} items removed)")
    except Exception as e:
        print(f"  ❌ Error cleaning {d}: {e}")

def clean_diarization_directories(include_input=False, force=False):
    for d in [paths.TALKING_RESULTS_DIR, paths.TALKING_TEMP_DIR] + ([paths.TALKING_UPLOADS_DIR] if include_input else []):
        print(f"Cleaning diarization directory: {d}")
        clean_directory(d, force=force)

@app.route('/api/clean', methods=['POST'])
def clean_all():
    d = request.json or {}
    include_input, force = d.get('include_input', True), d.get('force', True)

    print("\n" + "="*48 + "\n           CLEANING ALL DIRECTORIES\n" + "="*48)
    print("\n--- Cleaning Singing/Vocal Directories ---"); clean_directories(include_input=include_input, force=force)

    print("\n--- Cleaning Job Directories ---")
    if paths.SINGING_JOBS_DIR.exists():
        print(f"Cleaning job directory: {paths.SINGING_JOBS_DIR}")
        clean_directory(paths.SINGING_JOBS_DIR, force=force)

    print("\n--- Cleaning Diarization/Talking Directories ---"); clean_diarization_directories(include_input=include_input, force=force)

    if include_input:
        print("\n--- Cleaning Original Audio Directory ---")
        clean_directory(paths.ORIGINAL_AUDIO_DIR, force=force)

    print("\n--- Cleaning Additional Temp Directories ---")
    for p, label in [(Path("diarization/pyannote-diarization/temp_segments"), "diarization temp segments"),
                     (Path("temp"), "general temp directory")]:
        if p.exists():
            print(f"Cleaning {label}: {p}")
            clean_directory(p, force=force)

    print("\n" + "="*48 + "\n     ALL DIRECTORIES CLEANED SUCCESSFULLY\n" + "="*48 + "\n")
    return jsonify({'message':'All directories cleaned successfully','included_input':include_input,
                    'cleaned':{'singing_vocals':True,'job_directories':True,'diarization':True,
                               'original_audio':include_input,'temp_files':True}})

@app.route('/api/available-files')
def get_available_files():
    try:
        if not paths.UVR_PROCESSED_DIR.exists():
            return jsonify({'files': [], 'message': 'No processed files available'})

        paths.INSTRUMENTAL_DIR.mkdir(parents=True, exist_ok=True)
        pairs = []
        for record in list_upload_metadata():
            base_name = Path(record["storedName"]).stem
            processed_vocals = paths.UVR_PROCESSED_DIR / f"{base_name}_vocals.wav"
            raw_vocals = paths.UVR_RAW_DIR / f"{base_name}_vocals.wav"
            instrumental = paths.INSTRUMENTAL_DIR / f"{base_name}_instrumental.wav"

            if not (processed_vocals.exists() or raw_vocals.exists() or instrumental.exists()):
                continue

            pairs.append({
                "fileId": record["fileId"],
                "originalName": record["originalName"],
                "safeDisplayName": record["safeDisplayName"],
                "storedName": record["storedName"],
                "createdAt": record["createdAt"],
                "vocalUrlProcessed": f"/api/download/processed_vocals/{record['fileId']}" if processed_vocals.exists() else None,
                "vocalUrlRaw": f"/api/download/raw_vocals/{record['fileId']}" if raw_vocals.exists() else None,
                "instrumentalUrl": f"/api/download/instrumental/{record['fileId']}" if instrumental.exists() else None,
                "vocalPathProcessed": processed_vocals.name if processed_vocals.exists() else None,
                "vocalPathRaw": raw_vocals.name if raw_vocals.exists() else None,
                "instrumentalPath": instrumental.name if instrumental.exists() else None,
                "dateProcessed": datetime.fromtimestamp(
                    max(
                        (processed_vocals.stat().st_mtime if processed_vocals.exists() else 0),
                        (raw_vocals.stat().st_mtime if raw_vocals.exists() else 0),
                        (instrumental.stat().st_mtime if instrumental.exists() else 0),
                    )
                ).strftime('%Y-%m-%d %H:%M:%S'),
            })

        return jsonify({'files': pairs, 'message': f'Found {len(pairs)} processed files'})
    except Exception as e:
        print(f"Error getting available files: {e}"); traceback.print_exc()
        return jsonify({'files': [], 'error': str(e)})


@app.route('/api/delete-files', methods=['POST'])
def delete_files():
    try:
        d = request.json or {}
        fns = d.get('filenames')
        if fns is None: return jsonify({"error":"No filenames provided"}), 400
        if not isinstance(fns, list): return jsonify({"error":"Filenames must be a list"}), 400

        results = []
        print(f"Deleting files for {len(fns)} tracks...")
        data = _load_metadata_file(UPLOAD_METADATA_PATH)

        for fn in fns:
            base = get_upload_base_name(fn)
            if not base:
                results.append({"track": None, "deleted": [], "failed": [{"filename": fn, "error": "Unknown fileId"}]})
                continue

            print(f"Processing track: {base}")
            deleted, failed = [], []
            for p, t in [(paths.UVR_RAW_DIR/f"{base}_vocals.wav","raw vocals"),
                         (paths.UVR_PROCESSED_DIR/f"{base}_vocals.wav","processed vocals"),
                         (paths.INSTRUMENTAL_DIR/f"{base}_instrumental.wav","instrumental")]:
                try:
                    if p.exists():
                        time.sleep(0.1); p.unlink(missing_ok=True)
                        deleted.append(f"{t}: {p.name}"); print(f"  [DELETED] {t}: {p.name}")
                    else:
                        print(f"  [WARNING] File not found: {p}")
                except Exception as e:
                    msg = f"Failed to delete {t}: {e}"
                    failed.append(msg); print(f"  [ERROR] {msg}")

            if deleted or failed:
                results.append({"track": base, "deleted": deleted, "failed": failed})
                if fn in data.get("files", {}):
                    data["files"].pop(fn, None)

        _save_metadata_file(UPLOAD_METADATA_PATH, data)

        return jsonify({
            "message": f"Processed {len(fns)} tracks",
            "results": results,
            "total_deleted": sum(len(r.get('deleted', [])) for r in results),
            "total_failed": sum(len(r.get('failed', [])) for r in results)
        })

    except Exception as e:
        print(f"Error in delete_files: {e}"); traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/api/prepare-processing', methods=['POST'])
def prepare_processing():
    try:
        time.sleep(2.0); clean_directories(include_input=False, force=True)
        return jsonify({"status":"ready"})
    except Exception as e:
        print(f"Error preparing for processing: {e}")
        return jsonify({"error": str(e)}), 500

def get_progress():
    last = None
    try:
        while True: last = progress_queue.get_nowait()
    except queue.Empty:
        return last

def process_audio_files_thread(job_id, segment, process, export, clean):
    job = active_jobs[job_id]; job.update(status='processing', steps=[])
    def monitor():
        while job['status'] == 'processing':
            p = get_progress()
            if p:
                if isinstance(p, dict):
                    fp = p.get('file_progress', job.get('file_progress', 0))
                    fp = int(fp * 100) if isinstance(fp, float) and 0 <= fp <= 1 else fp
                    job.update(
                        progress=p.get('progress', job.get('progress', 0)),
                        file_progress=fp,
                        current_file=p.get('current_file', job.get('current_file', 0)),
                        total_files=p.get('total_files', job.get('total_files', 0)),
                        status_message=p.get('message', job.get('status_message', ''))
                    )
                    print(f"Job progress: {job['progress']}%, File progress: {fp}%, File: {job['current_file']}/{job['total_files']}")
                    msg = p.get('message')
                    if msg and (not job['steps'] or job['steps'][-1]['message'] != msg):
                        if p.get('file_progress') is not None and not str(msg).endswith('%'):
                            sp = int(p['file_progress'] * 100) if isinstance(p['file_progress'], float) else p['file_progress']
                            msg = f"{msg} ({sp}%)"
                        job['steps'].append({'message': msg, 'progress': fp, 'time': time.time()})
                else:
                    job['progress'] = p
            time.sleep(0.5)

    threading.Thread(target=monitor, daemon=True).start()

    try:
        logger.info("Clearing old input files before processing...")
        inp = paths.INPUT_DIR
        if inp.exists():
            now = time.time()
            for f in inp.glob("*"):
                if f.is_file() and now - f.stat().st_mtime > 300:
                    try: f.unlink(); logger.info(f"Removed old input file: {f.name}")
                    except Exception as e: logger.warning(f"Could not remove {f.name}: {e}")

        process_all(segment_audio=segment, process_audio=process, export_data=export, clean_after=False)

        job.update(status='completed', progress=100, completed_at=time.time(),
                   output_files=collect_output_files(segment, process))
    except Exception as e:
        job.update(status='failed', error=str(e), progress=0)
        print(f"Error in processing thread: {e}"); traceback.print_exc()


@app.route('/api/download/dataset', methods=['POST'])
def download_dataset():
    try:
        d = request.json or {}
        proc, raw = d.get('processed', []), d.get('raw', [])
        if not d: return jsonify({"error":"No data provided"}), 400
        if not (proc or raw): return jsonify({"error":"No files selected for download"}), 400

        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        name = f"vocals_dataset_{ts}.zip"
        zpath = paths.TEMP_WAV_DIR / name

        def resolve_vocal_name(ref):
            base = get_upload_base_name(ref)
            if base:
                return f"{base}_vocals.wav"
            return os.path.basename(ref)

        with zipfile.ZipFile(zpath, 'w') as z:
            for files, srcdir, tag in [(proc, paths.UVR_PROCESSED_DIR, "PROCESSED"), (raw, paths.UVR_RAW_DIR, "RAW")]:
                for f in files:
                    fn = resolve_vocal_name(f)
                    p = srcdir / fn
                    if p.exists():
                        z.write(p, f"{fn.replace('_vocals.wav','')}_{tag}.wav")

        return send_file(zpath, mimetype="application/zip", as_attachment=True, download_name=name)
    except Exception as e:
        print(f"Error creating dataset zip: {e}"); traceback.print_exc()
        return jsonify({"error": str(e)}), 500



@app.route('/api/upload-talking', methods=['POST'])
def upload_talking_file():
    """Handle the upload of audio files for diarization"""
    try:
        if 'audio' not in request.files: return jsonify({"error":"No file part"}), 400
        f = request.files['audio']
        if f.filename == '': return jsonify({"error":"No selected file"}), 400

        job_id = str(uuid.uuid4())
        script_root = os.path.abspath("diarization/pyannote-diarization")

        paths.DIARIZATION_INPUT.mkdir(parents=True, exist_ok=True)
        paths.SPEAKER_DIR.mkdir(parents=True, exist_ok=True)

        original_filename = secure_filename(f.filename)
        input_audio_path = paths.DIARIZATION_INPUT / original_filename
        f.save(input_audio_path)

        print(f"Saved audio file to: {input_audio_path}")
        print(f"Using speaker directory at: {paths.SPEAKER_DIR}")

        active_jobs[job_id] = {
            "status":"preprocessing",
            "input_audio_path": str(input_audio_path),
            "original_filename": original_filename,
            "started_at": int(time.time()),
            "job_id": job_id,
            "script_root": script_root,
            "status_message": "Starting vocal separation..."
        }

        threading.Thread(target=run_diarization_process, args=(job_id, str(input_audio_path), original_filename)).start()
        return jsonify({"job_id": job_id, "original_filename": original_filename,
                        "status":"preprocessing", "status_message":"Starting vocal separation..."})
    except Exception as e:
        print(f"Error in upload-talking: {e}"); traceback.print_exc()
        return jsonify({"error": f"Upload failed: {str(e)}"}), 500


def run_diarization_process(job_id, input_audio_path, original_filename):
    """Run the diarization process in the background"""
    if job_id not in active_jobs:
        print(f"Error: Job {job_id} not found in active_jobs")
        return
    job = active_jobs[job_id]; job["status"] = "preprocessing"

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
                if ("diarization/pyannote-diarization/diarization/pyannote-diarization" in abs_in or
                    "diarization\\pyannote-diarization\\diarization\\pyannote-diarization" in abs_in):
                    fixed = abs_in.replace(
                        "diarization/pyannote-diarization/diarization/pyannote-diarization",
                        "diarization/pyannote-diarization"
                    ).replace(
                        "diarization\\pyannote-diarization\\diarization\\pyannote-diarization",
                        "diarization\\pyannote-diarization"
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

            if check_timeout(): return

            p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                stdout, stderr = p.communicate(timeout=max_process_time)
            except subprocess.TimeoutExpired:
                p.kill(); stdout, stderr = p.communicate()
                job.update(status="failed", error="Diarization process timed out")
                return

            print(f"Diarization stdout: {stdout}")
            if stderr: print(f"Diarization stderr: {stderr}")

            torchaudio_only = (stderr and "torchaudio backend is switched to 'soundfile'" in stderr and
                               not any(x in stderr for x in ["RuntimeError", "ValueError", "ImportError"]))

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
        print(f"Error in diarization process: {e}"); traceback.print_exc()
        if job_id in active_jobs: active_jobs[job_id].update(status="failed", error=str(e))
        return False


# Add a new in-memory cache for job status
# Will store the last status and timestamp for each job
job_status_cache = {}


@app.route('/api/talking-status/<job_id>')
def talking_status(job_id):
    try:
        if job_id not in active_jobs:
            print(f"Job ID not found in active_jobs: {job_id}")
            print(f"Available job IDs: {list(active_jobs.keys())}")
            return jsonify({"error":"Job not found","job_id":job_id}), 404

        job, now = active_jobs[job_id], int(time.time())

        if job_id in job_status_cache:
            st, t = job_status_cache[job_id]
            if st in ["completed","failed","error"] and now - t < 5:
                return jsonify({"status": st, "status_message": job.get("status_message",""),
                                "error": job.get("error"), "unique_id": job_id})

        if job.get("status") == "completed":
            base = job.get("original_filename","").split(".")[0]
            spkdir = paths.TALKING_RESULTS_DIR / base
            if os.path.exists(spkdir):
                subs = [d for d in os.listdir(spkdir) if d.startswith("speaker_") and os.path.isdir(os.path.join(spkdir, d))]
                if subs: print(f"Found {len(subs)} speaker directories in {spkdir}")
                else: print(f"No speaker subdirectories found in {spkdir}"); job["status"] = "completed_but_no_speakers"
            else:
                print(f"Speaker directory not found: {spkdir}")
                job["status"] = "completed_but_no_directory"

        job_status_cache[job_id] = (job["status"], now)
        return jsonify({"status": job["status"], "status_message": job.get("status_message",""),
                        "error": job.get("error"), "unique_id": job_id})

    except Exception as e:
        print(f"Error in talking status: {e}"); traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/api/play-speaker-sample/<job_id>/<speaker_name>')
def play_speaker_sample(job_id, speaker_name):
    if job_id not in active_jobs: return jsonify({"error":"Job not found"}), 404
    job = active_jobs[job_id]
    if job.get("status") != "completed": return jsonify({"error":"Job not completed yet"}), 400

    sp = (job.get("speakers") or {}).get(speaker_name)
    if not sp: return jsonify({"error": f"Speaker {speaker_name} not found"}), 404

    p = Path(sp.get("first_sample") or "")
    if p and p.exists(): return send_file(p, mimetype="audio/wav", as_attachment=False)

    d = Path(sp.get("path") or "")
    segs = list(d.glob("*.wav")) if d.is_dir() else []
    if segs: return send_file(segs[0], mimetype="audio/wav", as_attachment=False)

    return jsonify({"error": f"No audio samples found for {speaker_name}"}), 404


@app.route('/api/available-talking-datasets')
def available_talking_datasets():
    try:
        if not paths.SPEAKER_DIR.exists(): return jsonify({"datasets": []})

        ds = []
        for song in paths.SPEAKER_DIR.iterdir():
            if not song.is_dir(): continue
            spk = [d for d in song.iterdir() if d.is_dir() and d.name.startswith("speaker_")]
            if not spk: continue
            counts = [len(list(d.glob("*.wav"))) for d in spk]
            sample = next((str(w[0]) for d in spk if (w := list(d.glob("*.wav")))), None)
            ds.append({"name": song.name, "path": str(song),
                       "speaker_count": len(spk), "sample_count": sum(counts),
                       "sample_audio": sample})

        return jsonify({"datasets": sorted(ds, key=lambda x: x["name"])})
    except Exception as e:
        print(f"Error fetching talking datasets: {e}"); traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/api/speaker-samples/<job_id>/<speaker_name>')
def get_speaker_samples(job_id, speaker_name):
    try:
        def samples_for(path: Path):
            out = []
            for i, w in enumerate(sorted(path.glob("*.wav")), 1):
                try:
                    import wave
                    with wave.open(str(w), "rb") as wf: dur = wf.getnframes() / wf.getframerate()
                except Exception: dur = 5.0
                out.append({"id": i, "name": f"Segment {i}", "path": str(w),
                            "url": f"/api/play-segment/{w.name}?path={urllib.parse.quote(str(path))}",
                            "duration": dur})
            return out

        if job_id.startswith("dataset-"):
            name = job_id[8:]
            sp = next((sd/speaker_name for sd in paths.SPEAKER_DIR.iterdir()
                      if paths.SPEAKER_DIR.exists() and sd.is_dir() and (sd.name == name or name in sd.name)
                      and (sd/speaker_name).is_dir()), None)
            if not sp: return jsonify({"error": f"Speaker {speaker_name} not found in dataset {name}"}), 404
            return jsonify({"speaker": speaker_name, "dataset": name, "samples": samples_for(sp)})

        if job_id not in active_jobs: return jsonify({"error":"Job not found"}), 404
        job = active_jobs[job_id]
        if job.get("status") != "completed": return jsonify({"error":"Job not completed yet"}), 400
        spinfo = (job.get("speakers") or {}).get(speaker_name)
        if not spinfo: return jsonify({"error": f"Speaker {speaker_name} not found in job {job_id}"}), 404

        sp = Path(spinfo["path"])
        if not sp.exists(): return jsonify({"error": f"Speaker directory not found: {sp}"}), 404
        return jsonify({"speaker": speaker_name, "job_id": job_id, "samples": samples_for(sp)})

    except Exception as e:
        print(f"Error getting speaker samples: {e}"); traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/api/play-segment/<path:segment_filename>')
def play_segment_file(segment_filename):
    """Play a specific segment file"""
    speaker, job_id = request.args.get('speaker'), request.args.get('job_id')
    if not (speaker and job_id and segment_filename):
        return jsonify({"error": "Missing parameters"}), 400

    try:
        job_dir = job_id[8:] if job_id.startswith("dataset-") else job_id
        sp = speaker.lower()
        m = re.match(r"speaker\s+(\d+)$", sp)
        sp = f"speaker_{m.group(1).zfill(2)}" if m else sp

        d = paths.TALKING_RESULTS_DIR / job_dir / sp

        # if client sends wildcard patterns, honor them
        if any(x in segment_filename for x in "*?"):
            match = next(iter(d.glob(segment_filename)), None)
            if match: return send_file(match, mimetype="audio/wav", as_attachment=False)

        p = d / segment_filename
        if not p.exists() and segment_filename.startswith("part"):
            num = (re.match(r"part(\d+)", segment_filename) or [None, None])[1]
            p = next(iter(d.glob(f"part{num}*.wav")), None) if num else None
            p = p or next(iter(d.glob("*.wav")), None)  # final fallback: first wav

        if not (p and p.exists()):
            return jsonify({"error": f"Segment file not found for speaker {speaker.lower()}"}), 404

        return send_file(p, mimetype="audio/wav", as_attachment=False)

    except Exception as e:
        logger.error(f"Error serving segment file: {e}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/api/play-original-audio/<job_id>')
def play_original_audio(job_id):
    try:
        d = paths.TALKING_UPLOADS_DIR
        if not d.exists():
            return jsonify({"error":"Uploads directory not found","job_id":job_id}), 404

        f = [p for p in d.glob("*.wav") if not p.name.lower().endswith("vocals.wav")]
        if len(f) != 1:
            return jsonify({"error": f"Expected one original wav file, found {len(f)} in {d}", "job_id": job_id}), 404

        return send_file(f[0], mimetype="audio/wav", as_attachment=False)
    except Exception as e:
        logger.error(f"Error getting original audio: {e}"); traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/api/diarization-timeline/<job_id>')
def get_diarization_timeline(job_id):
    print(f"Getting diarization timeline for job {job_id}")
    try:
        files = glob.glob(str(paths.TALKING_RESULTS_DIR / "*_diarization.txt"))
        if not files: return jsonify({"error": "Diarization data not found"}), 404
        diarization_file = files[0]
        logger.info(f"Found diarization file at: {diarization_file}")

        tl, by_spk = [], {}
        for line in Path(diarization_file).read_text().splitlines():
            m = re.match(r'\[(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\]\s+(\w+)', line.strip())
            if not m: continue
            s, e, spk = float(m[1]), float(m[2]), m[3]
            disp = spk.replace("SPEAKER_", "Speaker ")
            seg = {
                "id": f"segment-{len(tl)}",
                "start": s, "end": e,
                "speaker": disp,
                "text": f"{disp}: {formatTimestamp(s)} - {formatTimestamp(e)}"
            }
            tl.append(seg)
            by_spk.setdefault(spk, []).append(seg)

        tl.sort(key=lambda x: x["start"])
        total = tl[-1]["end"] if tl else 0.0

        # add Unknown segments if folder exists
        job_dir = job_id[8:] if job_id.startswith("dataset-") else job_id
        unk_dir = paths.TALKING_RESULTS_DIR / job_dir / paths.TALKING_SPEAKER_UNKNOWN_DIR_SUFFIX
        logger.info(f"Looking for unknown speaker directory at: {unk_dir}")

        def parse_times(name):
            # unknown_1_01m23s-01m45s.wav OR part1_01m23s-01m45s.wav
            m = re.search(r'(?:unknown|part)(\d+)_([0-9]+)m([0-9]+)s-([0-9]+)m([0-9]+)s', name)
            if m:
                n = int(m[1])
                s = int(m[2]) * 60 + int(m[3])
                e = int(m[4]) * 60 + int(m[5])
                return n, float(s), float(e)
            # optional precise: _12.345s-67.890s anywhere
            m = re.search(r'(\d+(?:\.\d+)?)s-(\d+(?:\.\d+)?)s', name)
            if m: return None, float(m[1]), float(m[2])
            # old: part7.wav
            m = re.match(r'part(\d+)\.wav$', name, re.I)
            if m: return int(m[1]), None, None
            return None, None, None

        if unk_dir.is_dir():
            wavs = sorted([p for p in unk_dir.iterdir() if p.suffix.lower() == ".wav"])
            if wavs:
                logger.info(f"Found {len(wavs)} Unknown speaker segments to add to timeline")
                unknown = []
                for i, w in enumerate(wavs, 1):
                    try:
                        import wave
                        with wave.open(str(w), "rb") as wf:
                            dur = wf.getnframes() / wf.getframerate()
                        n, s, e = parse_times(w.name)
                        if s is None or e is None:
                            # simple placement fallback (kept, but no fancy snapping)
                            s = i * (total / (len(wavs) + 1)) if total else 0.0
                            e = s + dur
                        unknown.append({"id": f"unknown-{n or i}", "start": s, "end": e,
                                        "speaker": "Unknown", "text": "No speech detected"})
                    except Exception as ex:
                        logger.error(f"Error processing unknown segment {w}: {ex}", exc_info=True)

                tl.extend(unknown)
                tl.sort(key=lambda x: x["start"])
                by_spk["Unknown"] = unknown
        else:
            logger.info(f"No unknown speaker segments found for job {job_id}")

        return jsonify({"timeline": tl, "speakers": list(by_spk.keys())})

    except Exception as e:
        logger.error(f"Error getting diarization timeline: {e}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500




def formatTimestamp(seconds):
    m, s = divmod(seconds, 60)
    return f"{int(m):02d}:{s:05.2f}"

@app.route('/api/extract-segment')
def extract_segment():
    job_id, start, end = (request.args.get(k) for k in ("job_id","start","end"))
    seg_id = request.args.get("segment_id", "unknown")
    is_gap = request.args.get("is_gap","false").lower() in ("true","yes","t","1")
    debug  = request.args.get("debug","false").lower() in ("true","yes","t","1")

    if not (job_id and start is not None and end is not None):
        return jsonify({"error":"Missing required parameters"}), 400

    try:
        s, e = float(start), float(end)
        dur = e - s

        job = active_jobs.get(job_id)
        if not job:
            jp = Path(f"diarization/pyannote-diarization/jobs/{job_id}.json")
            if jp.exists():
                try: job = json.loads(jp.read_text())
                except Exception as ex: logger.error(f"Error loading job from disk: {ex}")

        audio = job.get("input_audio_path") if job else None
        if audio and not os.path.exists(audio): audio = None

        if not audio:
            base = job_id.replace("dataset-","")
            exts = ("wav","mp3","ogg","m4a")
            for d in (paths.ORIGINAL_AUDIO_DIR, paths.DIARIZATION_INPUT):
                hits = list(d.glob(f"{base}.*")) or [p for x in exts for p in d.glob(f"*{base}*.{x}")]
                if hits: audio = str(hits[0]); break

        if not audio:
            if debug:
                return jsonify({
                    "error":"Could not find original audio file","job_id":job_id,
                    "job_exists": job is not None, "job_keys": list(job.keys()) if job else None,
                    "original_audio_dir_files":[str(f) for f in paths.ORIGINAL_AUDIO_DIR.glob("*")],
                    "diarization_input_files":[str(f) for f in paths.DIARIZATION_INPUT.glob("*")]
                }), 404
            return jsonify({"error":"Original audio file not found"}), 404

        if not os.path.exists(audio):
            return jsonify({"error": f"Original audio file not found at path: {audio}"}), 404

        tmp = Path("diarization/pyannote-diarization/temp_segments"); tmp.mkdir(parents=True, exist_ok=True)
        out = tmp / f"{'gap' if is_gap else 'segment'}_{seg_id}_{job_id}_{s:.2f}_{e:.2f}.wav"

        if not out.exists():
            cmd = ['ffmpeg','-y','-ss',str(s),'-i',str(audio),'-t',str(dur),'-acodec','pcm_s16le','-ar','44100','-ac','1',str(out)]
            p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if p.returncode != 0:
                return jsonify({"error": f"Error extracting segment: {p.stderr}"}), 500

        return send_file(out, mimetype="audio/wav", as_attachment=False)

    except Exception as e:
        logger.error(f"Error in extract-segment: {e}"); traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/api/reassign-segment', methods=['POST'])
def reassign_segment():
    try:
        d = request.get_json() or {}
        job_id, seg_id, tgt, orig = (d.get(k) for k in ("job_id","segment_id","target_speaker","original_speaker"))
        start, end = d.get("start"), d.get("end")
        if not all([job_id, seg_id, tgt, orig]): return jsonify({"error":"Missing required parameters"}), 400
        if start is None or end is None: return jsonify({"error":"Missing segment start or end time"}), 400
        try: float(start); float(end)
        except (ValueError, TypeError):
            return jsonify({"error": f"Invalid start or end time values: start={start}, end={end}"}), 400

        t = tgt.lower()
        m = re.match(r"speaker\s+(\d+)", t)
        norm = f"speaker_{m.group(1).zfill(2)}" if m else tgt

        job_dir = job_id[8:] if job_id.startswith("dataset-") else job_id
        spdir = Path(f"diarization/pyannote-diarization/foldersong/{job_dir}/{norm}")
        spdir.mkdir(parents=True, exist_ok=True)

        parts = [int(f.stem[4:]) for f in spdir.glob("part*.wav") if f.stem[4:].isdigit()]
        nxt = (max(parts) + 1) if parts else 1

        return jsonify({"success": True, "part_number": nxt, "speaker_name": tgt, "normalized_speaker": norm})
    except Exception as e:
        logger.error(f"Error in reassign-segment: {e}"); traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/api/move-segment', methods=['POST'])
def move_segment():
    try:
        d = request.get_json() or {}
        job_id, seg_id, orig, tgt, part = (d.get(k) for k in ("job_id","segment_id","original_speaker","target_speaker","part_number"))
        if not all([job_id, seg_id, orig, tgt, part]): return jsonify({"error":"Missing required parameters"}), 400

        def norm(s):
            m = re.match(r"speaker\s+(\d+)", s.lower())
            return f"speaker_{m.group(1).zfill(2)}" if m else s.lower()

        job_dir = job_id[8:] if job_id.startswith("dataset-") else job_id
        base = Path("diarization/pyannote-diarization/foldersong") / job_dir
        src_dir, dst_dir = base / norm(orig), base / norm(tgt)
        dst_dir.mkdir(parents=True, exist_ok=True)

        src = (src_dir / f"part{part}.wav") if src_dir.exists() else None
        src = src if (src and src.exists()) else next(iter(src_dir.glob("*.wav")), None)
        if not src: return jsonify({"error":"Source file not found"}), 404

        dst = dst_dir / f"part{part}.wav"
        shutil.move(src, dst)

        return jsonify({"success": True, "source": str(src), "target": str(dst)})
    except Exception as e:
        logger.error(f"Error in move-segment: {e}"); traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/api/process-audio', methods=['POST'])
def process_audio():
    try:
        if 'audio' not in request.files: return jsonify({"error":"No audio file provided"}), 400
        f = request.files['audio']
        if not f.filename: return jsonify({"error":"Empty filename"}), 400

        pid = str(uuid.uuid4())
        tmp = paths.TEMP_WAV_DIR / f"process_{pid}"; tmp.mkdir(parents=True, exist_ok=True)
        in_path = str(tmp / secure_filename(f.filename)); f.save(in_path)

        form = request.form
        export_format = form.get('exportFormat', 'wav')
        out_path = str(tmp / f"output_{pid}.wav")

        # typed form helpers
        b = lambda k, d=False: form.get(k, str(d)).lower() == 'true'
        i = lambda k, d=0: int(form.get(k, d))
        fl = lambda k, d=0.0: float(form.get(k, d))
        s = lambda k, d='': form.get(k, d)

        result_message, output_file = run_infer_script(
            pitch=i('pitch', 0),
            filter_radius=i('filterRadius', 3),
            index_rate=fl('indexRate', 0.75),
            volume_envelope=i('volumeEnvelope', 1),
            protect=fl('protect', 0.33),
            hop_length=i('hopLength', 128),
            f0_method=s('f0Method', 'rmvpe'),
            input_path=in_path,
            output_path=out_path,
            pth_path=s('modelPath', ''),
            index_path=s('indexPath', ''),
            split_audio=b('splitAudio', True),
            f0_autotune=b('f0Autotune', False),
            f0_autotune_strength=fl('f0AutotuneStrength', 0.5),
            clean_audio=b('cleanAudio', False),
            clean_strength=fl('cleanStrength', 0.5),
            export_format=export_format,
            f0_file=s('f0File', ''),
            embedder_model=s('embedderModel', 'hubert_base'),
            embedder_model_custom=form.get('embedderModelCustom', None),
            formant_shifting=b('formantShifting', False),
            formant_qfrency=fl('formantQfrency', 1.0),
            formant_timbre=fl('formantTimbre', 1.0),
            post_process=b('postProcess', False),

            reverb=b('reverb'), pitch_shift=b('pitchShift'), limiter=b('limiter'), gain=b('gain'),
            distortion=b('distortion'), chorus=b('chorus'), bitcrush=b('bitcrush'),
            clipping=b('clipping'), compressor=b('compressor'), delay=b('delay'),

            reverb_room_size=fl('reverbRoomSize', 0.5),
            reverb_damping=fl('reverbDamping', 0.5),
            reverb_wet_gain=fl('reverbWetGain', 0.5),
            reverb_dry_gain=fl('reverbDryGain', 0.5),
            reverb_width=fl('reverbWidth', 0.5),
            reverb_freeze_mode=fl('reverbFreezeMode', 0.5),
            pitch_shift_semitones=fl('pitchShiftSemitones', 0.0),
            limiter_threshold=fl('limiterThreshold', -6),
            limiter_release_time=fl('limiterReleaseTime', 0.01),
            gain_db=fl('gainDb', 0.0),
            distortion_gain=fl('distortionGain', 25),
            chorus_rate=fl('chorusRate', 1.0),
            chorus_depth=fl('chorusDepth', 0.25),
            chorus_center_delay=fl('chorusCenterDelay', 7),
            chorus_feedback=fl('chorusFeedback', 0.0),
            chorus_mix=fl('chorusMix', 0.5),
            bitcrush_bit_depth=i('bitcrushBitDepth', 8),
            clipping_threshold=fl('clippingThreshold', -6),
            compressor_threshold=fl('compressorThreshold', 0),
            compressor_ratio=fl('compressorRatio', 1),
            compressor_attack=fl('compressorAttack', 1.0),
            compressor_release=fl('compressorRelease', 100),
            delay_seconds=fl('delaySeconds', 0.5),
            delay_feedback=fl('delayFeedback', 0.0),
            delay_mix=fl('delayMix', 0.5),
            sid=i('sid', 0),
        )

        if not os.path.exists(output_file):
            return jsonify({"error":"Failed to generate output file"}), 500

        return jsonify({
            "message": result_message,
            "outputUrl": f"/api/audio-results/{pid}/output.{export_format}",
            "processId": pid
        })
    except Exception as e:
        logger.error(f"Error processing audio: {e}"); traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/api/audio-results/<process_id>/output.<format>')
def get_audio_result(process_id, format):
    try:
        d = paths.TEMP_WAV_DIR / f"process_{process_id}"
        f = next((x for x in d.iterdir() if x.name.startswith("output_") and x.suffix == f".{format}"), None)
        if not f: return jsonify({"error": f"No output file found in format {format}"}), 404
        return send_file(f, mimetype=f"audio/{format}", as_attachment=False, download_name=f"converted_output.{format}")
    except Exception as e:
        logger.error(f"Error getting audio result: {e}"); traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/api/prepare-training-dataset', methods=['POST'])
def prepare_training_dataset():
    try:
        files = request.files.getlist('vocals')
        if not files: return jsonify({"error":"No audio files provided"}), 400
        if not files[0].filename: return jsonify({"error":"No audio files selected"}), 400

        name = request.form.get('modelName', 'unnamed_model')
        _sr = int(request.form.get('sampleRate', 48000))  # kept for parity, even if unused here

        d = paths.APPLIO_DATASET_DIR / name
        d.mkdir(parents=True, exist_ok=True)

        for f in files: f.save(str(d / secure_filename(f.filename)))

        return jsonify({"message": f"Dataset prepared with {len(files)} files",
                        "datasetDir": str(d), "modelName": name})
    except Exception as e:
        logger.error(f"Error preparing training dataset: {e}"); traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/api/start-training', methods=['POST'])
def start_training():
    try:
        d = request.json or {}
        model = d.get('modelName')
        if not model: return jsonify({"error":"Model name is required"}), 400

        ds = paths.APPLIO_DATASET_DIR / model
        if not ds.exists(): return jsonify({"error": f"Dataset directory not found: {ds}"}), 404
        if not any(p.suffix.lower() in (".wav",".mp3",".ogg",".flac") for p in ds.iterdir()):
            return jsonify({"error": f"No audio files found in dataset directory: {ds}"}), 400

        job_id = str(uuid.uuid4())
        active_jobs[job_id] = {
            "id": job_id, "model_name": model, "status":"preprocessing",
            "progress": 0, "logs": ["Starting preprocessing..."], "started_at": time.time()
        }

        # keep same defaults + arg order to run_training_pipeline
        args = (
            job_id, model, ds,
            d.get('rvcVersion','v2'),
            d.get('saveEveryEpoch',20),
            d.get('saveOnlyLatest',False),
            d.get('saveEveryWeights',True),
            d.get('totalEpoch',100),
            d.get('sampleRate',48000),
            d.get('batchSize',8),
            d.get('gpu',0),
            d.get('pitchGuidance',True),
            d.get('overtrainingDetector',True),
            d.get('overtrainingThreshold',5),
            d.get('pretrained',True),
            d.get('cleanup',True),
            d.get('indexAlgorithm','Auto'),
            d.get('cacheDataInGpu',False),
            d.get('customPretrained',False),
            d.get('gPretrainedPath'),
            d.get('dPretrainedPath'),
        )
        threading.Thread(target=run_training_pipeline, args=args, daemon=True).start()
        return jsonify({"jobId": job_id, "message": "Training process started"})
    except Exception as e:
        logger.error(f"Error starting training: {e}"); traceback.print_exc()
        return jsonify({"error": str(e)}), 500


def run_training_pipeline(job_id, model_name, dataset_dir, rvc_version, save_every_epoch, save_only_latest,
                          save_every_weights, total_epoch, sample_rate, batch_size, gpu, pitch_guidance,
                          overtraining_detector, overtraining_threshold, pretrained, cleanup, index_algorithm,
                          cache_data_in_gpu, custom_pretrained, g_pretrained_path, d_pretrained_path):
    os.environ['TORIO_USE_FFMPEG'] = '0'
    job = active_jobs[job_id]

    try:
        job.update(status="preprocessing")
        job["logs"] += [
            "Starting preprocessing...",
            f"Training model: {model_name}",
            f"Dataset directory: {dataset_dir}",
            f"RVC version: {rvc_version}",
            f"Sample rate: {sample_rate}",
            f"Batch size: {batch_size}",
            f"GPU: {gpu}",
            f"Epochs: {total_epoch}",
            "Starting Applio training pipeline...",
        ]
        job["status"] = "training"

        def monitor():
            stage, logs_dir = 1, paths.APPLIO_MODELS_DIR / model_name
            while job["status"] in ("preprocessing", "training"):
                if stage < 2 and (logs_dir / "0_gt_wavs").exists():
                    job["logs"].append("Preprocessing complete"); job["progress"] = 33; stage = 2
                if stage < 3 and (logs_dir / f"{rvc_version}_extracted").exists():
                    job["logs"].append("Feature extraction complete"); job["progress"] = 66; stage = 3
                eps = [int(m.group(1)) for f in logs_dir.glob("*.pth")
                       if (m := re.search(r'_(\d+)\.pth$', f.name))]
                if eps:
                    cur = max(eps)
                    job["progress"] = int(66 + min(cur / total_epoch, 1) * 34)
                    job["logs"].append(f"Training progress: Epoch {cur}/{total_epoch}")
                time.sleep(5)

        threading.Thread(target=monitor, daemon=True).start()

        from applio.core import run_preprocess_script, run_extract_script, run_train_script

        try:
            job["logs"].append("Step 1/3: Preprocessing audio files...")
            run_preprocess_script(model_name=model_name, dataset_path=dataset_dir, sample_rate=sample_rate,
                                  cpu_cores=8, cut_preprocess="Automatic", process_effects=True,
                                  noise_reduction=True, clean_strength=0.5, chunk_len=30.0, overlap_len=0.3,
                                  normalization_mode="none")
            job["logs"].append("✅ Preprocessing completed successfully"); job["progress"] = 33

            job["logs"].append("Step 2/3: Extracting features...")
            run_extract_script(model_name=model_name, f0_method="rmvpe", cpu_cores=8, gpu=gpu,
                               sample_rate=sample_rate, embedder_model="contentvec",
                               embedder_model_custom=None, include_mutes=2)
            job["logs"].append("✅ Feature extraction completed successfully"); job["progress"] = 66

            job["logs"].append("Step 3/3: Training model...")
            run_train_script(model_name=model_name, save_every_epoch=save_every_epoch, save_only_latest=save_only_latest,
                             save_every_weights=save_every_weights, total_epoch=total_epoch, sample_rate=sample_rate,
                             batch_size=batch_size, gpu=gpu, overtraining_detector=overtraining_detector,
                             overtraining_threshold=overtraining_threshold, pretrained=pretrained, cleanup=cleanup,
                             index_algorithm=index_algorithm, cache_data_in_gpu=cache_data_in_gpu,
                             custom_pretrained=custom_pretrained, g_pretrained_path=g_pretrained_path,
                             d_pretrained_path=d_pretrained_path, vocoder="HiFi-GAN", checkpointing=False)
            job["logs"].append("✅ Training completed successfully"); job["progress"] = 100
            result = {"success": True, "message": "Training completed successfully"}

        except Exception as e:
            msg = f"Training pipeline failed: {e}"
            job["logs"].append(f"❌ Error: {msg}")
            result = {"success": False, "error": msg}

        if result and ("failed" in str(result).lower() or "error" in str(result).lower()):
            raise Exception(f"Training pipeline failed: {result}")

        logs_dir = paths.APPLIO_MODELS_DIR / model_name
        job.update(
            status="completed", progress=100, completed_at=time.time(),
            model_files={"pth_files": [str(f) for f in logs_dir.glob("*.pth")],
                         "index_files": [str(f) for f in logs_dir.glob("*.index")]}
        )
        job["logs"] += [
            f"Training completed. Result: {result}",
            f"Training took {int(job['completed_at'] - job['started_at'])} seconds",
        ]
        return result

    except Exception as e:
        logger.error(f"Error in training pipeline: {e}"); traceback.print_exc()
        job.update(status="failed", error=str(e))
        job["logs"].append(f"Error: {e}")
        return f"Training failed: {e}"

@app.route('/api/training-status/<job_id>')
def training_status(job_id):
    if job_id not in active_jobs:
        return jsonify({"error":"Job not found"}), 404

    j = active_jobs[job_id]
    return jsonify({
        "id": j["id"],
        "model_name": j["model_name"],
        "status": j["status"],
        "progress": j["progress"],
        "logs": j["logs"],
        "started_at": j["started_at"],
        "completed_at": j.get("completed_at"),
        "error": j.get("error")
    })

@app.route('/api/available-models')
def available_models():
    try:
        root = Path(paths.APPLIO_MODELS_DIR)
        if not root.exists(): return jsonify({"models": []})

        models = []
        for d in (p for p in root.iterdir() if p.is_dir()):
            pths = [f for f in d.glob("*.pth") if not f.name.startswith(("D_","G_")) and "e_" in f.name]
            if not pths: continue

            idx = next(d.glob("*.index"), None)
            info = json.loads((d/"model_info.json").read_text()) if (d/"model_info.json").exists() else {}

            cps = sorted(({
                "filename": f.name,
                "epochs": int(m.group(1)) if (m := re.search(r'_(\d+)e_', f.name)) else 0,
                "isBest": "best" in f.name.lower(),
                "created": datetime.fromtimestamp(f.stat().st_ctime).isoformat(),
                "path": str(f.relative_to(root)),
                "size_mb": round(f.stat().st_size / (1024**2), 2)
            } for f in pths), key=lambda x: x["epochs"], reverse=True)

            size = sum(f.stat().st_size for f in pths) + (idx.stat().st_size if idx else 0)
            models.append({
                "name": d.name,
                "created": max(cps, key=lambda x: x["created"])["created"],
                "epochs": cps[0]["epochs"],
                "size_mb": round(size / (1024**2), 2),
                "sampleRate": info.get("sample_rate", 48000),
                "status": "completed",
                "checkpoints": cps,
                "indexPath": str(idx.relative_to(root)) if idx else None
            })

        return jsonify({"models": sorted(models, key=lambda x: x["created"], reverse=True)})
    except Exception as e:
        logging.error(f"Error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/models/<model_name>', methods=['DELETE'])
def delete_model(model_name):
    try:
        name = secure_filename(model_name)
        if not name: return jsonify({"error":"Invalid model name"}), 400

        d = paths.APPLIO_MODELS_DIR / name
        if not d.exists(): return jsonify({"error":f"Model '{name}' not found"}), 404
        if not d.is_dir(): return jsonify({"error":f"'{name}' is not a valid model directory"}), 400

        shutil.rmtree(d)
        logging.info(f"Successfully deleted model: {name}")

        return jsonify({
            "message": f"Model '{name}' and all its files have been deleted successfully",
            "modelName": name
        })
    except Exception as e:
        logging.error(f"Error deleting model '{model_name}': {e}")
        return jsonify({"error": f"Failed to delete model: {e}"}), 500


import re, requests
from bs4 import BeautifulSoup
from flask import request, jsonify

@app.route('/api/search-online-models')
def search_online_models():
    q = request.args.get('query', '')
    page = request.args.get('page', 1)
    if not q: return jsonify({"models": [], "total_pages": 1})

    try:
        raw = requests.post("https://voice-models.com/fetch_data.php",
                            data={'page': page, 'search': q}, timeout=10).json()

        models = []
        html = (raw.get("table") or "").strip()
        if html:
            soup = BeautifulSoup(html, "html.parser")
            for tr in soup.select("tr"):
                tds = tr.find_all("td")
                if len(tds) < 2: continue
                a = tds[0].find("a", class_="fs-5")
                b = tds[1].find("button", class_="copy-btn")
                if not (a and b): continue
                title = a.get_text(strip=True)
                m = re.search(r'(\d+)\s?(?:epochs|epoch|e)\b', title, re.I)
                badge = tds[0].find("span", class_="badge")
                models.append({
                    "name": title,
                    "url": b.get("data-clipboard-text"),
                    "epochs": int(m.group(1)) if m else None,
                    "size_mb": badge.get_text(strip=True).replace(" MB", "") if badge else None,
                    "is_rmvpe": "rmvpe" in title.lower(),
                    "is_v2": "v2" in title.lower()
                })

        total_pages = 1
        pg = raw.get("pagination") or ""
        if pg:
            last = BeautifulSoup(pg, "html.parser").find("li", class_="last")
            onclick = last.find("a").get("onclick") if last and last.find("a") else ""
            m = re.search(r'\((\d+)', onclick)
            if m: total_pages = int(m.group(1))

        return jsonify({"models": models, "total_pages": total_pages, "current_page": int(page)})

    except Exception as e:
        return jsonify({"error": str(e), "models": []}), 500


@app.route('/api/download-model', methods=['POST'])
def download_model():
    """Download an RVC model from Hugging Face - ensures both .pth and .index files are present"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided"}), 400
        
        model_url = data.get('url')
        model_name = data.get('modelName', 'downloaded_model')
        model_id = data.get('modelId', '')
        files_info = data.get('files', {})
        user_query = data.get('userQuery', '')  # User's search query for filename
        
        if not model_url:
            return jsonify({"error": "No URL provided"}), 400
        
        # Use user query as base filename, fallback to model name
        # Clean and sanitize the query for use as filename
        if user_query:
            base_name = re.sub(r'[^a-zA-Z0-9\s]', '', user_query)
            base_name = re.sub(r'\s+', '', base_name)  # Remove spaces
        else:
            # Fallback to model name if no query
            base_name = re.sub(r'[^a-zA-Z0-9\s]', '', model_name)
            base_name = re.sub(r'\s+', '', base_name)
        
        if not base_name:
            base_name = "downloaded_model"
        
        # Secure the model name for directory
        secure_name = secure_filename(base_name)
        if not secure_name:
            secure_name = "downloaded_model"
        
        # Create model directory
        model_dir = paths.APPLIO_MODELS_DIR / secure_name
        model_dir.mkdir(parents=True, exist_ok=True)
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        
        downloaded_files = []
        
        # If we have a zip file, download and extract it
        if files_info.get('zip'):
            zip_url = f"https://huggingface.co/{model_id}/resolve/main/{files_info['zip']}"
            zip_filename = f"{secure_name}.zip"
            zip_path = model_dir / zip_filename
            
            logging.info(f"Downloading zip file from {zip_url}")
            response = requests.get(zip_url, headers=headers, stream=True, timeout=60)
            response.raise_for_status()
            
            with open(zip_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            # Extract zip file
            try:
                with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                    zip_ref.extractall(model_dir)
                # Remove zip file after extraction
                zip_path.unlink()
                downloaded_files.append("zip (extracted)")
                
                # Verify .pth and .index files exist after extraction
                pth_files = list(model_dir.glob("*.pth"))
                index_files = list(model_dir.glob("*.index"))
                
                if not pth_files:
                    return jsonify({"error": "Model zip file does not contain a .pth file"}), 400
                if not index_files:
                    return jsonify({"error": "Model zip file does not contain an .index file"}), 400
                
                # Rename files according to naming convention
                # .pth file: extract epochs and rate, rename to {userQuery}_{epochs}e_{rate}.pth
                # .index file: rename to {userQuery}.index
                # Defaults: epoch=666, rate=48200 if not found
                
                # Process .pth file
                pth_file = pth_files[0]  # Use first .pth file found
                pth_original_name = pth_file.stem  # Name without extension
                
                # Try to extract epochs and rate from filename
                # Pattern: modelname_500e_48200s.pth or modelname_500e_48200.pth or similar
                epochs_match = re.search(r'_(\d+)e', pth_original_name, re.IGNORECASE)
                rate_match = re.search(r'_(\d+)(?:s|\.)', pth_original_name, re.IGNORECASE)
                
                # Extract epoch and rate, use defaults if not found
                epochs = int(epochs_match.group(1)) if epochs_match else 666
                rate = int(rate_match.group(1)) if rate_match else 48200
                
                # Build new .pth filename: {userQuery}_{epochs}e_{rate}.pth
                new_pth_name = f"{secure_name}_{epochs}e_{rate}.pth"
                
                new_pth_path = model_dir / new_pth_name
                if pth_file.name != new_pth_name:
                    pth_file.rename(new_pth_path)
                    logging.info(f"Renamed .pth file from {pth_file.name} to {new_pth_name} (epochs: {epochs}, rate: {rate})")
                    pth_files = [new_pth_path]
                
                # Process .index file - rename to {userQuery}.index
                index_file = index_files[0]  # Use first .index file found
                expected_index_name = f"{secure_name}.index"
                new_index_path = model_dir / expected_index_name
                if index_file.name != expected_index_name:
                    index_file.rename(new_index_path)
                    logging.info(f"Renamed index file from {index_file.name} to {expected_index_name}")
                    index_files = [new_index_path]
                    
            except zipfile.BadZipFile:
                return jsonify({"error": "Downloaded file is not a valid zip file"}), 400
        
        # If we have individual .pth and .index files, download them separately
        elif files_info.get('pth') or files_info.get('index'):
            # Download .pth file
            if files_info.get('pth'):
                pth_url = f"https://huggingface.co/{model_id}/resolve/main/{files_info['pth']}"
                # Extract original filename from path (may include epochs/steps like "edSheeran_500e_48200s.pth")
                original_pth_filename = files_info['pth'].split('/')[-1]
                
                # Check if the filename already contains the base name
                # If it does, keep it as is; otherwise, prepend base name
                if secure_name.lower() in original_pth_filename.lower():
                    pth_filename = original_pth_filename
                else:
                    # Extract base from original filename (remove extension and any suffix)
                    # Example: "model_500e_48200s.pth" -> "model_500e_48200s.pth" (keep as is)
                    pth_filename = original_pth_filename
                
                pth_path = model_dir / pth_filename
                
                logging.info(f"Downloading .pth file from {pth_url}")
                response = requests.get(pth_url, headers=headers, stream=True, timeout=60)
                response.raise_for_status()
                
                with open(pth_path, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        f.write(chunk)
                
                downloaded_files.append(f".pth ({pth_filename})")
            
            # Download .index file
            if files_info.get('index'):
                index_url = f"https://huggingface.co/{model_id}/resolve/main/{files_info['index']}"
                # .index file should use base name only (following naming convention: baseName.index)
                # Example: "edSheeran.index" not "edSheeran_500e_48200s.index"
                index_filename = f"{secure_name}.index"
                index_path = model_dir / index_filename
                
                logging.info(f"Downloading .index file from {index_url}")
                response = requests.get(index_url, headers=headers, stream=True, timeout=60)
                response.raise_for_status()
                
                with open(index_path, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        f.write(chunk)
                
                downloaded_files.append(f".index ({index_filename})")
            
            # Verify both files exist
            pth_files = list(model_dir.glob("*.pth"))
            index_files = list(model_dir.glob("*.index"))
            
            if not pth_files:
                return jsonify({"error": "Failed to download .pth file"}), 400
            if not index_files:
                return jsonify({"error": "Failed to download .index file"}), 400
            
            # Rename files according to naming convention (same as zip extraction)
            final_pth = pth_files[0]
            final_index = index_files[0]
            
            # Extract epoch and rate from .pth filename if present
            # Use defaults: epoch=666, rate=48200 if not found
            epochs_match = re.search(r'_(\d+)e', final_pth.stem, re.IGNORECASE)
            rate_match = re.search(r'_(\d+)(?:s|\.)', final_pth.stem, re.IGNORECASE)
            
            epochs = int(epochs_match.group(1)) if epochs_match else 666
            rate = int(rate_match.group(1)) if rate_match else 48200
            
            # Rename .pth: {userQuery}_{epochs}e_{rate}.pth
            new_pth_name = f"{secure_name}_{epochs}e_{rate}.pth"
            
            new_pth_path = model_dir / new_pth_name
            if final_pth.name != new_pth_name:
                final_pth.rename(new_pth_path)
                logging.info(f"Renamed .pth file from {final_pth.name} to {new_pth_name} (epochs: {epochs}, rate: {rate})")
                pth_files = [new_pth_path]
            
            # Rename .index to {modelName}.index
            expected_index_name = f"{secure_name}.index"
            new_index_path = model_dir / expected_index_name
            if final_index.name != expected_index_name:
                final_index.rename(new_index_path)
                index_files = [new_index_path]
        
        else:
            # Fallback: try to download from URL directly
            logging.info(f"Downloading from URL: {model_url}")
            response = requests.get(model_url, headers=headers, stream=True, timeout=60)
            response.raise_for_status()
            
            # Try to determine file type from URL or Content-Type
            content_type = response.headers.get('Content-Type', '')
            if 'application/zip' in content_type or model_url.endswith('.zip'):
                zip_filename = f"{secure_name}.zip"
                zip_path = model_dir / zip_filename
                
                with open(zip_path, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        f.write(chunk)
                
                # Extract if it's a zip
                try:
                    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                        zip_ref.extractall(model_dir)
                    # Remove zip file after extraction
                    zip_path.unlink()
                    downloaded_files.append("zip (extracted)")
                    
                    # Verify and rename files according to naming convention
                    pth_files = list(model_dir.glob("*.pth"))
                    index_files = list(model_dir.glob("*.index"))
                    
                    if not pth_files:
                        return jsonify({"error": "Model zip file does not contain a .pth file"}), 400
                    if not index_files:
                        return jsonify({"error": "Model zip file does not contain an .index file"}), 400
                    
                    # Rename files (same logic as above)
                    pth_file = pth_files[0]
                    pth_original_name = pth_file.stem
                    
                    # Extract epoch and rate, use defaults if not found
                    epochs_match = re.search(r'_(\d+)e', pth_original_name, re.IGNORECASE)
                    rate_match = re.search(r'_(\d+)(?:s|\.)', pth_original_name, re.IGNORECASE)
                    
                    epochs = int(epochs_match.group(1)) if epochs_match else 666
                    rate = int(rate_match.group(1)) if rate_match else 48200
                    
                    # Rename .pth: {userQuery}_{epochs}e_{rate}.pth
                    new_pth_name = f"{secure_name}_{epochs}e_{rate}.pth"
                    
                    new_pth_path = model_dir / new_pth_name
                    if pth_file.name != new_pth_name:
                        pth_file.rename(new_pth_path)
                        logging.info(f"Renamed .pth file from {pth_file.name} to {new_pth_name} (epochs: {epochs}, rate: {rate})")
                        pth_files = [new_pth_path]
                    
                    index_file = index_files[0]
                    expected_index_name = f"{secure_name}.index"
                    new_index_path = model_dir / expected_index_name
                    if index_file.name != expected_index_name:
                        index_file.rename(new_index_path)
                        logging.info(f"Renamed index file from {index_file.name} to {expected_index_name}")
                        index_files = [new_index_path]
                        
                except zipfile.BadZipFile:
                    return jsonify({"error": "Downloaded file is not a valid zip file"}), 400
            else:
                # Try to get filename from URL
                filename = model_url.split('/')[-1].split('?')[0]
                if not filename or '.' not in filename:
                    return jsonify({"error": "Could not determine file type from URL"}), 400
                
                file_path = model_dir / filename
                with open(file_path, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        f.write(chunk)
                downloaded_files.append(filename)
        
        # Final verification: check that we have both .pth and .index files
        pth_files = list(model_dir.glob("*.pth"))
        index_files = list(model_dir.glob("*.index"))
        
        if not pth_files:
            return jsonify({"error": "Model folder does not contain a .pth file. RVC models require both .pth and .index files."}), 400
        if not index_files:
            return jsonify({"error": "Model folder does not contain an .index file. RVC models require both .pth and .index files."}), 400
        
        # Extract epoch and size information from final files
        final_pth = pth_files[0]
        final_index = index_files[0]
        
        # Extract epoch and rate from .pth filename (e.g., "eminem_500e_48200.pth" -> 500, 48200)
        epochs_match = re.search(r'_(\d+)e', final_pth.stem, re.IGNORECASE)
        rate_match = re.search(r'_(\d+)(?:s|\.)', final_pth.stem, re.IGNORECASE)
        
        epochs = int(epochs_match.group(1)) if epochs_match else None
        rate = int(rate_match.group(1)) if rate_match else None
        
        # Calculate total size in MB
        total_size = final_pth.stat().st_size + final_index.stat().st_size
        size_mb = round(total_size / (1024 * 1024), 2)
        
        logging.info(f"Successfully downloaded RVC model to {model_dir}")
        logging.info(f"  - .pth file: {final_pth.name} ({epochs} epochs)" if epochs else f"  - .pth file: {final_pth.name}")
        logging.info(f"  - .index file: {final_index.name}")
        logging.info(f"  - Total size: {size_mb} MB")
        
        return jsonify({
            "message": f"RVC model downloaded successfully",
            "modelName": secure_name,
            "path": str(model_dir.relative_to(paths.APPLIO_MODELS_DIR)),
            "files": {
                "pth": [f.name for f in pth_files],
                "index": [f.name for f in index_files]
            },
            "epochs": epochs,
            "size": size_mb
        })
        
    except requests.RequestException as e:
        logging.error(f"Error downloading model: {e}")
        return jsonify({"error": f"Failed to download model: {str(e)}"}), 500
    except Exception as e:
        logging.error(f"Error downloading model: {e}")
        return jsonify({"error": f"An error occurred: {str(e)}"}), 500

@app.route('/api/start-inference', methods=['POST'])
def start_inference():
    """Start an inference job for a track"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided"}), 400

        model = data.get("model")  # Now expecting full model object
        track = data.get("track")
        params = data.get("params", {})

        # Debug logging
        logging.info(f"Received inference request - Model: {model.get('name') if model else 'None'}")
        logging.info(f"Full track data: {json.dumps(track, indent=2) if track else 'None'}")
        logging.info(f"Track type: {type(track)}")
        logging.info(f"Track keys: {list(track.keys()) if track and isinstance(track, dict) else 'Not a dict'}")
        logging.info(f"Track vocal: {track.get('vocal') if track else 'None'}")
        logging.info(f"Track instrumental: {track.get('instrumental') if track else 'None'}")

        if not model or not track:
            return jsonify({"error": "Model and track are required"}), 400

        # Create a unique job ID
        job_id = str(uuid.uuid4())
        run_id = make_run_id()

        # Initialize job
        active_jobs[job_id] = {
            "id": job_id,
            "type": "inference",
            "model_name": model["name"],
            "track": track,
            "params": params,
            "run_id": run_id,
            "status": "starting",
            "progress": 0,
            "logs": ["Starting inference..."],
            "started_at": datetime.now().isoformat(),
        }

        # Start inference in background thread
        import threading
        thread = threading.Thread(
            target=run_inference_job,
            args=(job_id, run_id, model, track, params)
        )
        thread.daemon = True
        thread.start()

        return jsonify({"jobId": job_id, "runId": run_id})

    except Exception as e:
        logging.error(f"Error starting inference: {e}")
        return jsonify({"error": str(e)}), 500


def run_inference_job(job_id, run_id, model, track, params):
    """Run inference job in isolated process"""
    # Process-level exception handler to prevent any crashes from affecting Flask
    try:
        # Set process name for debugging
        import multiprocessing
        multiprocessing.current_process().name = f"Inference-{job_id[:8]}"

        # Disable FFmpeg requirement for torchaudio
        os.environ['TORIO_USE_FFMPEG'] = '0'
        os.environ['TORCHAUDIO_USE_FFMPEG'] = '0'
        os.environ['FFMPEG_ROOT'] = ''

        # Disable verbose logging immediately
        import logging
        for logger_name in ['byteflow', 'torio', 'torch', 'applio']:
            logger = logging.getLogger(logger_name)
            logger.setLevel(logging.CRITICAL)
            logger.disabled = True

        # Since we're in a separate process, use file-based status updates
        print(f"Inference process started for job {job_id}")

        # Import required modules
        from core import run_infer_script
       
        # Update status using file-based system
        active_jobs[job_id].update({
            'status': 'processing',
            'progress': 10,
            'logs': active_jobs[job_id].get('logs', []) + [f"Running inference for track: {track.get('name', 'unknown')}"]
        })

        # Import inference function from applio (suppress FFmpeg warnings)
        import warnings
        import logging

        # Suppress torio debug messages
        torio_logger = logging.getLogger('torio')
        torio_logger.setLevel(logging.ERROR)
        torio_logger.disabled = True

        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message=".*FFmpeg.*")
            warnings.filterwarnings("ignore", category=UserWarning)
            from core import run_infer_script

        # Prepare inference parameters
        selected_checkpoint = model.get("selectedCheckpoint") or model.get("bestCheckpoint")
        
        # Fallback: if no selected checkpoint, try to get from checkpoints array
        if not selected_checkpoint and model.get("checkpoints"):
            checkpoints = model.get("checkpoints", [])
            # Try to find best checkpoint first
            selected_checkpoint = next((c for c in checkpoints if c.get("isBest")), None)
            # Otherwise use first checkpoint
            if not selected_checkpoint and checkpoints:
                selected_checkpoint = checkpoints[0]
        
        if not selected_checkpoint or not selected_checkpoint.get("path"):
            active_jobs[job_id].update({
                'status': 'failed',
                'error': f"No valid checkpoint found for model: {model.get('name')}"
            })
            return
        
        model_path = selected_checkpoint["path"]
        index_path = model.get("indexPath")

        # Debug: Check if model file exists
        print(f"Selected checkpoint: {selected_checkpoint}")
        print(f"Raw model path: {model_path}")

        # Convert relative path to absolute path
        if not os.path.isabs(model_path):
            model_path = str(paths.APPLIO_MODELS_DIR / model_path)
            print(f"Absolute model path: {model_path}")

        print(f"Model file exists: {os.path.exists(model_path)}")
        print(f"APPLIO_MODELS_DIR: {paths.APPLIO_MODELS_DIR}")

        if not os.path.exists(model_path):
            active_jobs[job_id].update({
                'status': 'failed',
                'error': f"Model file not found: {model_path}"
            })
            return

        # Get input audio path (use vocal file)
        file_id = track.get("fileId") or track.get("id")
        vocals_file_type = track.get("vocalFileType") or track.get("vocalsFileType")
        use_processed = track.get("processed", True)
        if vocals_file_type in {"raw_vocals", "processed_vocals"}:
            use_processed = vocals_file_type == "processed_vocals"

        input_path = None
        if file_id:
            base_name = get_upload_base_name(file_id)
            if not base_name:
                active_jobs[job_id].update({
                    'status': 'failed',
                    'error': f"Unknown fileId: {file_id}"
                })
                return
            input_path = str(paths.get_vocal_file_path(f"{base_name}_vocals.wav", processed=use_processed))
        else:
            vocal_filename = track.get("vocal", "").split("/").pop().split("\\").pop()
            input_path = str(paths.get_vocal_file_path(vocal_filename, processed=use_processed))

        # Fallback: if file doesn't exist in processed dir, try raw dir
        if input_path and not os.path.exists(input_path):
            fallback_name = None
            if file_id:
                base_name = get_upload_base_name(file_id)
                if base_name:
                    fallback_name = f"{base_name}_vocals.wav"
            if not fallback_name:
                vocal_filename = track.get("vocal", "").split("/").pop().split("\\").pop()
                fallback_name = vocal_filename
            alt_path = str(paths.get_vocal_file_path(fallback_name, processed=not use_processed))
            if os.path.exists(alt_path):
                input_path = alt_path
                print(f"[Inference] Using {'raw' if not use_processed else 'processed'} vocals: {input_path}")

        # Create output directory
        run_dir = paths.INFERENCE_RUNS_DIR / run_id
        run_dir.mkdir(exist_ok=True, parents=True)
        logging.info(f"Starting inference run {run_id}")
        logging.info(f"Track payload: {track}")
        # Generate output filename
        output_filename = "inferred.wav"
        output_path = str(run_dir / output_filename)

        # Update status
        active_jobs[job_id].update({
            'status': 'processing',
            'progress': 20,
            'logs': active_jobs[job_id].get('logs', []) + ["Starting inference process..."]
        })

        # Set up the inference parameters
        inference_params = {
            "pitch": params.get("pitch", 0),
            "index_rate": params.get("indexRate", 0.5),
            "volume_envelope": params.get("volumeEnvelope", True),
            "protect": params.get("protectVoiced", 0.5),
            "f0_method": params.get("f0Method", "rmvpe"),
            "input_path": input_path,
            "output_path": output_path,
            "pth_path": model_path,
            "index_path": index_path if index_path and os.path.exists(index_path) else "",
            "split_audio": False,
            "f0_autotune": False,
            "f0_autotune_strength": 1.0,
            "proposed_pitch": False,
            "proposed_pitch_threshold": 0.1,
            "clean_audio": False,
            "clean_strength": 0.5,
            "export_format": "WAV",
            "embedder_model": "contentvec",
            "embedder_model_custom": None,
        }

        # Call the inference script (catch FFmpeg errors)
        try:
            active_jobs[job_id].update({
                'status': 'processing',
                'progress': 50,
                'logs': active_jobs[job_id].get('logs', []) + ["Running inference..."]
            })
            result = run_infer_script(**inference_params)
        except RuntimeError as e:
            if "FFmpeg" in str(e) or "torio" in str(e):
                active_jobs[job_id].update({
                    'status': 'processing',
                    'progress': 50,
                    'logs': active_jobs[job_id].get('logs', []) + ["FFmpeg warning ignored, continuing with inference..."]
                })
                # Try again with warnings suppressed
                result = run_infer_script(**inference_params)
            else:
                raise e

        # run_infer_script returns a tuple (message, output_file)
        if result and len(result) == 2:
            message, output_file_path = result
            # Check if output file was actually created
            if os.path.exists(output_file_path):
                file_record = get_upload_metadata(file_id) if file_id else None
                run_payload = {
                    "id": run_id,
                    "runId": run_id,
                    "modelName": model.get("name"),
                    "modelId": model.get("id"),
                    "inputFileId": file_id,
                    "inputStoredName": file_record.get("storedName") if file_record else None,
                    "inputOriginalName": file_record.get("originalName") if file_record else None,
                    "inputDisplayName": file_record.get("safeDisplayName") if file_record else None,
                    "outputFileName": output_filename,
                    "outputUrl": f"/api/download/inference/{run_id}",
                    "params": params,
                    "vocalFileType": vocals_file_type or ("processed_vocals" if use_processed else "raw_vocals"),
                    "createdAt": datetime.now().isoformat(),
                }
                save_inference_run_metadata(run_id, run_payload)
                active_jobs[job_id].update({
                    'status': 'completed',
                    'progress': 100,
                    'logs': active_jobs[job_id].get('logs', []) + ["Inference completed successfully!"],
                    'outputFile': output_filename,
                    'runId': run_id,
                    'outputUrl': run_payload["outputUrl"]
                })
            else:
                active_jobs[job_id].update({
                    'status': 'failed',
                    'error': "Output file not created",
                    'logs': active_jobs[job_id].get('logs', []) + [f"Inference failed: Output file not created"]
                })
        else:
            error_msg = "Inference failed - invalid result format"
            active_jobs[job_id].update({
                'status': 'failed',
                'error': error_msg,
                'logs': active_jobs[job_id].get('logs', []) + [f"Inference failed: {error_msg}"]
            })

    except Exception as e:
        logging.error(f"Error in inference job {job_id}: {e}")
        import traceback
        logging.error(f"Traceback: {traceback.format_exc()}")
        active_jobs[job_id].update({
            'status': 'failed',
            'error': str(e),
            'logs': active_jobs[job_id].get('logs', []) + [f"Inference error: {str(e)}"]
        })
    except BaseException as e:
        # Catch system-level exceptions that might crash the process
        logging.critical(f"Critical error in inference job {job_id}: {e}")
        import traceback
        logging.critical(f"Critical traceback: {traceback.format_exc()}")
        try:
            job = active_jobs.get(job_id)
            if job:
                job["status"] = "failed"
                job["error"] = f"Critical error: {str(e)}"
                job["logs"].append(f"Critical inference error: {str(e)}")
        except:
            pass  # Don't let cleanup crash the app

@app.route('/api/inference-status/<job_id>', methods=['GET'])
def inference_status(job_id):
    """Get the status of an inference job"""
    # First check in-memory jobs
    if job_id in active_jobs:
        job = active_jobs[job_id]

        # Check if there's an updated status file from the worker process
        status_file = f"job_status_{job_id}.json"
        if os.path.exists(status_file):
            try:
                with open(status_file, 'r') as f:
                    worker_status = json.load(f)

                # Update in-memory job with worker status
                job.update({
                    'status': worker_status.get('status', job.get('status')),
                    'progress': worker_status.get('progress', job.get('progress', 0)),
                    'error': worker_status.get('error', job.get('error')),
                    'logs': worker_status.get('logs', job.get('logs', [])),
                    'outputFile': worker_status.get('output_file', job.get('outputFile'))
                })

                # Clean up status file if job is complete
                if worker_status.get('status') in ['completed', 'failed']:
                    try:
                        os.unlink(status_file)
                    except:
                        pass

            except Exception as e:
                # If we can't read the status file, continue with in-memory data
                pass

        # Return job data
        return jsonify({
            "id": job["id"],
            "type": job["type"],
            "model_name": job["model_name"],
            "track": job["track"],
            "status": job["status"],
            "progress": job["progress"],
            "logs": job["logs"],
            "started_at": job["started_at"],
            "completed_at": job.get("completed_at"),
            "error": job.get("error"),
            "outputFile": job.get("outputFile"),
            "runId": job.get("runId") or job.get("run_id"),
            "outputUrl": job.get("outputUrl")
        })

    # Check if there's a status file for a completed job
    status_file = f"job_status_{job_id}.json"
    if os.path.exists(status_file):
        try:
            with open(status_file, 'r') as f:
                job_data = json.load(f)

            # Create temporary job entry for completed job
            temp_job = {
                "id": job_id,
                "type": "inference",
                "status": job_data.get("status", "unknown"),
                "progress": job_data.get("progress", 0),
                "logs": job_data.get("logs", []),
                "error": job_data.get("error"),
                "outputFile": job_data.get("output_file")
            }

            return jsonify(temp_job)

        except Exception as e:
            return jsonify({"error": f"Failed to read job status: {str(e)}"}), 500

    return jsonify({"error": "Job not found"}), 404

@app.route('/api/past-inference-results', methods=['GET'])
def get_past_inference_results():
    """Get list of past inference results by scanning inference directory"""
    try:
        results = list_inference_runs()
        results.sort(key=lambda x: x.get("createdAt", ""), reverse=True)
        return jsonify({"results": results})

    except Exception as e:
        print(f"Error getting past inference results: {e}")
        import traceback
        print(traceback.format_exc())
        return jsonify({"error": f"Failed to get results: {str(e)}"}), 500

@app.route('/api/download/inference/<path:run_id>', methods=['GET'])
def download_inference(run_id):
    """Download inference result file"""
    try:
        run_id = urllib.parse.unquote(run_id)
        run_meta = load_inference_run_metadata(run_id)

        if run_meta:
            output_name = run_meta.get("outputFileName", "inferred.wav")
            file_path = paths.INFERENCE_RUNS_DIR / run_id / output_name
            if not file_path.exists():
                return jsonify({"error": "File not found"}), 404
            return send_file(file_path, as_attachment=True, download_name=output_name)

        # Legacy fallback
        file_path = paths.get_inference_file_path(run_id)
        if not file_path.exists():
            return jsonify({"error": "File not found"}), 404
        return send_file(file_path, as_attachment=True, download_name=file_path.name)

    except Exception as e:
        logging.error(f"Error downloading inference file: {e}")
        return jsonify({"error": str(e)}), 500

# ===============================
# SONG GENERATION (ACE-Step) API
# ===============================

# Store active song generation jobs
song_generation_jobs = {}

# ACE-Step default parameters (can be overridden)
ACESTEP_DEFAULTS = {
    "infer_step": 60,
    "guidance_scale": 15.0,
    "scheduler_type": "euler",
    "cfg_type": "apg",
    "omega_scale": 10.0,
    "actual_seeds": [-1],  # -1 = random
    "guidance_interval": 0.5,
    "guidance_interval_decay": 0.0,
    "min_guidance_scale": 3.0,
    "use_erg_tag": True,
    "use_erg_lyric": True,
    "use_erg_diffusion": True,
    "oss_steps": [],
    "guidance_scale_text": 0.0,
    "guidance_scale_lyric": 0.0,
}

# ACE-Step paths
ACESTEP_DIR = Path(os.path.dirname(__file__)) / "ACE-Step"
ACESTEP_CHECKPOINT_PATH = ACESTEP_DIR / "checkpoints"
ACESTEP_VENV_PATH = ACESTEP_DIR / "venv"  # ACE-Step's own virtual environment

# Song generation output directory
SONG_GENERATION_DIR = Path(os.path.dirname(__file__)) / "data" / "generated_songs"
SONG_GENERATION_DIR.mkdir(parents=True, exist_ok=True)

def get_acestep_python():
    """Get the Python executable for ACE-Step (from its venv if exists)"""
    if sys.platform == "win32":
        venv_python = ACESTEP_VENV_PATH / "Scripts" / "python.exe"
    else:
        venv_python = ACESTEP_VENV_PATH / "bin" / "python"
    
    if venv_python.exists():
        return str(venv_python)
    
    # Fallback to system python
    return sys.executable

def run_song_generation_thread(job_id, params):
    """Run ACE-Step song generation as subprocess in background thread"""
    job = song_generation_jobs[job_id]
    
    try:
        job['status'] = 'initializing'
        job['progress'] = 5
        job['status_message'] = 'Preparing generation...'
        
        # Prepare output path
        title_safe = re.sub(r'[^\w\-_]', '_', params.get('title', 'untitled'))
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_filename = f"{title_safe}_{timestamp}.wav"
        output_path = SONG_GENERATION_DIR / output_filename
        
        # Merge with defaults
        infer_params = {**ACESTEP_DEFAULTS, **params}
        
        # Create a temporary params file for the subprocess
        params_file = SONG_GENERATION_DIR / f"{job_id}_params.json"
        with open(params_file, 'w') as f:
            json.dump({
                "audio_duration": infer_params.get('audio_duration', 180),
                "prompt": infer_params.get('prompt', ''),
                "lyrics": infer_params.get('lyrics', ''),
                "infer_step": infer_params.get('infer_step', 60),
                "guidance_scale": infer_params.get('guidance_scale', 15.0),
                "scheduler_type": infer_params.get('scheduler_type', 'euler'),
                "cfg_type": infer_params.get('cfg_type', 'apg'),
                "omega_scale": infer_params.get('omega_scale', 10.0),
                "actual_seeds": infer_params.get('actual_seeds', [-1]),
                "guidance_interval": infer_params.get('guidance_interval', 0.5),
                "guidance_interval_decay": infer_params.get('guidance_interval_decay', 0.0),
                "min_guidance_scale": infer_params.get('min_guidance_scale', 3.0),
                "use_erg_tag": infer_params.get('use_erg_tag', True),
                "use_erg_lyric": infer_params.get('use_erg_lyric', True),
                "use_erg_diffusion": infer_params.get('use_erg_diffusion', True),
                "oss_steps": infer_params.get('oss_steps', []),
                "guidance_scale_text": infer_params.get('guidance_scale_text', 0.0),
                "guidance_scale_lyric": infer_params.get('guidance_scale_lyric', 0.0),
            }, f)
        
        # Find checkpoint path
        checkpoint_path = str(ACESTEP_CHECKPOINT_PATH)
        alt_paths = [
            ACESTEP_DIR / "ckpts",
            ACESTEP_DIR / "models", 
            Path.home() / ".cache" / "acestep",
        ]
        for alt in alt_paths:
            if alt.exists():
                checkpoint_path = str(alt)
                break
        
        job['status'] = 'generating'
        job['progress'] = 10
        job['status_message'] = 'Starting ACE-Step subprocess...'
        
        # Get the right Python executable
        python_exe = get_acestep_python()
        
        # Create a wrapper script that will be run
        wrapper_script = SONG_GENERATION_DIR / f"{job_id}_runner.py"
        with open(wrapper_script, 'w') as f:
            f.write(f'''
import sys
import json
import os

# Force unbuffered output
sys.stdout.reconfigure(line_buffering=True) if hasattr(sys.stdout, 'reconfigure') else None
sys.stderr.reconfigure(line_buffering=True) if hasattr(sys.stderr, 'reconfigure') else None

# Windows DLL fix for PyTorch - must be done BEFORE importing torch
if sys.platform == "win32":
    try:
        # Find torch lib directory and add to PATH and DLL directories
        import site
        torch_lib_paths = []
        
        # Check site-packages
        for sp in site.getsitepackages():
            torch_lib = os.path.join(sp, "torch", "lib")
            if os.path.exists(torch_lib):
                torch_lib_paths.append(torch_lib)
        
        # Check venv torch
        venv_sp = os.path.join(os.path.dirname(sys.executable), "..", "Lib", "site-packages", "torch", "lib")
        if os.path.exists(venv_sp):
            torch_lib_paths.append(os.path.abspath(venv_sp))
        
        # Add to PATH (older Windows compatibility)
        for tlp in torch_lib_paths:
            if tlp not in os.environ.get("PATH", ""):
                os.environ["PATH"] = tlp + os.pathsep + os.environ.get("PATH", "")
        
        # Add to DLL search path (Windows 10 1607+)
        for tlp in torch_lib_paths:
            try:
                os.add_dll_directory(tlp)
            except (AttributeError, OSError):
                pass
                
    except Exception as e:
        print(f"Warning: Could not set DLL directory: {{e}}")

# Monkey-patch tqdm BEFORE importing ACE-Step to capture progress
from tqdm import tqdm as original_tqdm
class ProgressTqdm(original_tqdm):
    def __init__(self, *args, **kwargs):
        # Force output to stdout for capturing
        kwargs['file'] = sys.stdout
        kwargs['mininterval'] = 0.5
        kwargs['ncols'] = 80
        super().__init__(*args, **kwargs)
    
    def update(self, n=1):
        super().update(n)
        if self.total:
            pct = int((self.n / self.total) * 100)
            # Map tqdm progress to 25-90% of our total progress
            mapped_pct = 25 + int((self.n / self.total) * 65)
            print(f"TQDM_PROGRESS:{{mapped_pct}}:Step {{self.n}}/{{self.total}}")
            sys.stdout.flush()

# Replace tqdm globally
import tqdm as tqdm_module
tqdm_module.tqdm = ProgressTqdm

# Add ACE-Step to path
sys.path.insert(0, r"{ACESTEP_DIR}")

from acestep.pipeline_ace_step import ACEStepPipeline

# Load params
with open(r"{params_file}", "r") as pf:
    params = json.load(pf)

print("PROGRESS:15:Loading model...")
sys.stdout.flush()

# Initialize pipeline
pipeline = ACEStepPipeline(
    checkpoint_dir=r"{checkpoint_path}",
    dtype="bfloat16",
    torch_compile=False,
    cpu_offload=True,
    overlapped_decode=False
)

print("PROGRESS:25:Generating audio...")
sys.stdout.flush()

# Run generation
pipeline(
    audio_duration=params["audio_duration"],
    prompt=params["prompt"],
    lyrics=params["lyrics"],
    infer_step=params["infer_step"],
    guidance_scale=params["guidance_scale"],
    scheduler_type=params["scheduler_type"],
    cfg_type=params["cfg_type"],
    omega_scale=params["omega_scale"],
    manual_seeds=", ".join(map(str, params["actual_seeds"])),
    guidance_interval=params["guidance_interval"],
    guidance_interval_decay=params["guidance_interval_decay"],
    min_guidance_scale=params["min_guidance_scale"],
    use_erg_tag=params["use_erg_tag"],
    use_erg_lyric=params["use_erg_lyric"],
    use_erg_diffusion=params["use_erg_diffusion"],
    oss_steps=", ".join(map(str, params["oss_steps"])),
    guidance_scale_text=params["guidance_scale_text"],
    guidance_scale_lyric=params["guidance_scale_lyric"],
    save_path=r"{output_path}",
)

print("PROGRESS:95:Finalizing...")
sys.stdout.flush()

if os.path.exists(r"{output_path}"):
    print("SUCCESS")
else:
    print("ERROR:Output file not created")
''')
        
        # Set up environment for subprocess
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"  # Force unbuffered output
        env["TQDM_DISABLE"] = "0"  # Keep tqdm enabled but it will output to stderr
        env["TQDM_MININTERVAL"] = "1"  # Update every second
        
        if sys.platform == "win32":
            # Add torch lib to PATH for the subprocess
            venv_torch_lib = ACESTEP_VENV_PATH / "Lib" / "site-packages" / "torch" / "lib"
            if venv_torch_lib.exists():
                env["PATH"] = str(venv_torch_lib) + os.pathsep + env.get("PATH", "")
        
        # Run the subprocess - merge stderr into stdout so we see all output
        process = subprocess.Popen(
            [python_exe, "-u", str(wrapper_script)],  # -u for unbuffered output
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,  # Merge stderr into stdout
            text=True,
            cwd=str(ACESTEP_DIR),
            bufsize=1,
            env=env,
        )
        
        job['subprocess_pid'] = process.pid
        
        # Monitor output for progress updates
        success = False
        error_output = []
        
        for line in iter(process.stdout.readline, ''):
            if process.poll() is not None and not line:
                break
            
            line = line.rstrip('\n\r')
            
            # Always print to Flask console
            print(f"[ACE-Step] {line}", flush=True)
            
            # Parse our custom progress markers
            if line.startswith("PROGRESS:") or line.startswith("TQDM_PROGRESS:"):
                parts = line.split(":", 2)
                if len(parts) >= 2:
                    try:
                        job['progress'] = int(parts[1])
                        if len(parts) >= 3:
                            job['status_message'] = parts[2]
                    except ValueError:
                        pass
            elif line == "SUCCESS":
                success = True
            elif line.startswith("ERROR:"):
                error_output.append(line[6:])
            # Parse tqdm progress bar output (e.g., "50%|████      | 30/60")
            elif "%|" in line or ("it/s" in line and "/" in line):
                import re as regex
                # Match patterns like "50%|████| 30/60" or "30/60 [00:15<00:15, 2.00it/s]"
                step_match = regex.search(r'(\d+)/(\d+)', line)
                pct_match = regex.search(r'(\d+)%', line)
                if step_match:
                    current = int(step_match.group(1))
                    total = int(step_match.group(2))
                    # Map to 25-90% range
                    pct = 25 + int((current / total) * 65)
                    job['progress'] = min(pct, 90)
                    job['status_message'] = f'Generating audio... Step {current}/{total}'
                elif pct_match:
                    pct = int(pct_match.group(1))
                    mapped_pct = 25 + int((pct / 100) * 65)
                    job['progress'] = min(mapped_pct, 90)
        
        # Wait for process to finish
        process.wait()
        
        # Check remaining output
        remaining = process.stdout.read()
        if remaining:
            for line in remaining.split('\n'):
                line = line.strip()
                if line:
                    print(f"[ACE-Step] {line}", flush=True)
                    if line == "SUCCESS":
                        success = True
                    elif line.startswith("ERROR:"):
                        error_output.append(line[6:])
        
        # Clean up temp files
        try:
            params_file.unlink()
            wrapper_script.unlink()
        except:
            pass
        
        if process.returncode != 0 or not success:
            error_msg = "\n".join(error_output) if error_output else f"Process exited with code {process.returncode}"
            raise Exception(error_msg)
        
        # Check if file was created
        if not output_path.exists():
            raise Exception("Generated audio file not found")
        
        job['output_file'] = str(output_path)
        job['output_filename'] = output_filename
        
        # Always run through the process pipeline for vocal separation
        job['status'] = 'processing'
        job['progress'] = 92
        job['status_message'] = 'Preparing for vocal separation...'
        
        try:
            # Register generated audio as a unique upload
            title_safe = sanitize_filename_for_display(params.get('title', 'untitled'))
            stored_name, file_id = make_storage_name(title_safe)
            input_path = paths.INPUT_DIR / stored_name

            # Copy to input directory with unique name
            print(f"[ACE-Step] Copying generated song to input: {input_path}", flush=True)
            shutil.copy(str(output_path), str(input_path))
            register_upload_metadata(title_safe, stored_name, file_id)
            
            job['progress'] = 94
            job['status_message'] = 'Starting vocal separation...'
            
            # Create a processing job and run it
            process_job_id = str(uuid.uuid4())
            active_jobs[process_job_id] = {
                'id': process_job_id,
                'status': 'starting',
                'progress': 0,
                'config': {'segment': False, 'process': True, 'export': False, 'clean': False},
                'started_at': time.time()
            }
            
            # Run process in same thread (we're already in a background thread)
            print(f"[ACE-Step] Starting vocal separation job: {process_job_id}", flush=True)
            process_audio_files_thread(process_job_id, segment=False, process=True, export=False, clean=False)
            
            # Check if processing succeeded
            process_result = active_jobs.get(process_job_id, {})
            if process_result.get('status') == 'failed':
                print(f"[ACE-Step] Vocal separation failed: {process_result.get('error')}", flush=True)
                job['processed'] = False
            else:
                print(f"[ACE-Step] Vocal separation completed successfully", flush=True)
                job['processed'] = True
                job['process_job_id'] = process_job_id
                
                # Store paths to the processed files
                base_name = Path(stored_name).stem
                vocals_file = paths.UVR_RAW_DIR / f"{base_name}_vocals.wav"
                instrumental_file = paths.INSTRUMENTAL_DIR / f"{base_name}_instrumental.wav"
                
                if vocals_file.exists():
                    job['vocals_file'] = str(vocals_file)
                    job['vocals_url'] = f"/api/download/raw_vocals/{file_id}"
                    print(f"[ACE-Step] Vocals file: {vocals_file}", flush=True)
                
                if instrumental_file.exists():
                    job['instrumental_file'] = str(instrumental_file)
                    job['instrumental_url'] = f"/api/download/instrumental/{file_id}"
                    print(f"[ACE-Step] Instrumental file: {instrumental_file}", flush=True)
                
                # Run voice conversion (inference) if a model was selected
                model_name = params.get('model_name')
                model_obj = params.get('model')  # Full model object with checkpoints
                
                if model_name and model_obj and vocals_file.exists():
                    job['progress'] = 85
                    job['status_message'] = f'Applying voice model: {model_name}...'
                    print(f"[ACE-Step] Starting voice conversion with model: {model_name}", flush=True)
                    
                    try:
                        # Prepare inference parameters (default settings)
                        inference_params = {
                            "pitch": 0,
                            "indexRate": 0.88,
                            "protectVoiced": 0.6,
                            "f0Method": "rmvpe",
                            "splitAudio": False,
                            "autotune": False,
                            "autotuneStrength": 1,
                            "proposedPitch": False,
                            "proposedPitchThreshold": 155,
                            "cleanAudio": False,
                            "cleanStrength": 0.5,
                            "exportFormat": "WAV",
                            "volumeEnvelopeEnabled": True,
                            "formantShifting": False,
                            "formantPreset": "none",
                            "formantQfrency": 1,
                            "formantTimbre": 1,
                            "postProcess": False,
                            "reverb": False,
                            "reverbRoomSize": 0.5,
                            "reverbDamping": 0.5,
                            "reverbWetGain": 0.33,
                            "reverbDryGain": 0.4,
                            "reverbWidth": 1,
                            "reverbFreezeMode": 0,
                            "pitchShift": False,
                            "pitchShiftSemitones": 0,
                            "limiter": False,
                            "limiterThreshold": -6,
                            "limiterReleaseTime": 0.05,
                            "gain": False,
                            "gainDb": 0,
                            "distortion": False,
                            "distortionGain": 25,
                            "chorus": False,
                            "chorusRate": 1,
                            "chorusDepth": 0.25,
                            "chorusCenterDelay": 7,
                            "chorusFeedback": 0,
                            "chorusMix": 0.5,
                            "bitcrush": False,
                            "bitcrushBitDepth": 8,
                            "clipping": False,
                            "clippingThreshold": -6,
                            "compressor": False,
                            "compressorThreshold": 0,
                            "compressorRatio": 1,
                            "compressorAttack": 1,
                            "compressorRelease": 100,
                            "delay": False,
                            "delaySeconds": 0.5,
                            "delayFeedback": 0,
                            "delayMix": 0.5,
                            "sid": 0,
                            "volumeEnvelope": 1,
                        }
                        
                        # Track object for inference
                        track_obj = {
                            "name": title_safe,
                            "fileId": file_id,
                            "vocalFileType": "raw_vocals",
                            "processed": False,  # ACE-Step vocals are in raw directory
                        }
                        
                        # Create inference job
                        inference_job_id = str(uuid.uuid4())
                        inference_run_id = make_run_id()
                        active_jobs[inference_job_id] = {
                            "id": inference_job_id,
                            "type": "inference",
                            "model_name": model_name,
                            "track": track_obj,
                            "params": inference_params,
                            "run_id": inference_run_id,
                            "status": "starting",
                            "progress": 0,
                            "logs": ["Starting inference..."],
                            "started_at": datetime.now().isoformat(),
                        }
                        
                        # Run inference synchronously (we're already in a background thread)
                        print(f"[ACE-Step] Running inference job: {inference_job_id}", flush=True)
                        print(f"[ACE-Step] Model object: {model_obj}", flush=True)
                        run_inference_job(inference_job_id, inference_run_id, model_obj, track_obj, inference_params)
                        
                        # Check result
                        inference_result = active_jobs.get(inference_job_id, {})
                        if inference_result.get('status') == 'completed':
                            job['inference_completed'] = True
                            job['inference_job_id'] = inference_job_id
                            
                            output_url = inference_result.get("outputUrl")
                            if output_url:
                                job['vocals_url'] = output_url
                        else:
                            print(f"[ACE-Step] Voice conversion failed: {inference_result.get('error')}", flush=True)
                            job['inference_completed'] = False
                            
                    except Exception as infer_err:
                        print(f"[ACE-Step] Voice conversion error: {infer_err}", flush=True)
                        import traceback
                        traceback.print_exc()
                        job['inference_completed'] = False
            
            # Clean up - delete the generated song file after processing
            job['progress'] = 98
            job['status_message'] = 'Cleaning up...'
            try:
                output_path.unlink()
                print(f"[ACE-Step] Deleted generated song file: {output_path}", flush=True)
                # Also delete the input copy
                if input_path.exists():
                    input_path.unlink()
                    print(f"[ACE-Step] Deleted input copy: {input_path}", flush=True)
            except Exception as del_err:
                print(f"[ACE-Step] Warning: Could not delete files: {del_err}", flush=True)
            
        except Exception as proc_err:
            print(f"[ACE-Step] Warning: Could not process vocals: {proc_err}", flush=True)
            import traceback
            traceback.print_exc()
            job['processed'] = False
        
        job['status'] = 'completed'
        job['progress'] = 100
        job['status_message'] = 'Song generation and processing complete!'
        job['completed_at'] = datetime.now().isoformat()
        
        # Generate URL for playback (now points to the separated vocals)
        job['audio_url'] = f"/api/song-generation/audio/{job_id}"
        
    except Exception as e:
        import traceback
        job['status'] = 'failed'
        job['progress'] = 0
        job['error'] = str(e)
        job['status_message'] = f'Generation failed: {str(e)}'
        print(f"Song generation error for job {job_id}: {e}")
        print(traceback.format_exc())


@app.route('/api/song-generation/start', methods=['POST'])
def start_song_generation():
    """Start a new song generation job"""
    try:
        data = request.get_json() or {}
        
        # Validate required fields
        title = data.get('title', '').strip()
        if not title:
            return jsonify({"error": "Title is required"}), 400
        
        # Create job
        job_id = str(uuid.uuid4())
        job = {
            'id': job_id,
            'status': 'queued',
            'progress': 0,
            'status_message': 'Job queued...',
            'title': title,
            'params': data,
            'created_at': datetime.now().isoformat(),
            'output_file': None,
            'audio_url': None,
            'error': None,
        }
        
        song_generation_jobs[job_id] = job
        
        # Start generation in background thread
        threading.Thread(
            target=run_song_generation_thread,
            args=(job_id, data),
            daemon=True
        ).start()
        
        return jsonify({
            "job_id": job_id,
            "status": "queued",
            "message": "Song generation started"
        })
        
    except Exception as e:
        print(f"Error starting song generation: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/song-generation/status/<job_id>', methods=['GET'])
def get_song_generation_status(job_id):
    """Get status of a song generation job"""
    if job_id not in song_generation_jobs:
        return jsonify({"error": "Job not found"}), 404
    
    job = song_generation_jobs[job_id]
    return jsonify({
        'id': job['id'],
        'status': job['status'],
        'progress': job['progress'],
        'status_message': job.get('status_message', ''),
        'title': job.get('title', ''),
        'audio_url': job.get('audio_url'),
        'vocals_url': job.get('vocals_url'),
        'instrumental_url': job.get('instrumental_url'),
        'processed': job.get('processed', False),
        'inference_completed': job.get('inference_completed', False),
        'model_name': job.get('params', {}).get('model_name'),
        'output_filename': job.get('output_filename'),
        'created_at': job.get('created_at'),
        'completed_at': job.get('completed_at'),
        'error': job.get('error'),
    })


@app.route('/api/song-generation/jobs', methods=['GET'])
def list_song_generation_jobs():
    """List all song generation jobs"""
    jobs = []
    for job_id, job in song_generation_jobs.items():
        jobs.append({
            'id': job['id'],
            'status': job['status'],
            'progress': job['progress'],
            'title': job.get('title', ''),
            'audio_url': job.get('audio_url'),
            'vocals_url': job.get('vocals_url'),
            'instrumental_url': job.get('instrumental_url'),
            'processed': job.get('processed', False),
            'inference_completed': job.get('inference_completed', False),
            'model_name': job.get('params', {}).get('model_name'),
            'created_at': job.get('created_at'),
            'completed_at': job.get('completed_at'),
        })
    
    # Also scan for existing generated songs on disk
    try:
        for wav_file in SONG_GENERATION_DIR.glob("*.wav"):
            # Check if already in active jobs
            filename = wav_file.name
            existing = any(j.get('output_filename') == filename for j in song_generation_jobs.values())
            if not existing:
                stat = wav_file.stat()
                jobs.append({
                    'id': f"file_{hashlib.md5(filename.encode()).hexdigest()[:8]}",
                    'status': 'completed',
                    'progress': 100,
                    'title': filename.rsplit('_', 1)[0].replace('_', ' '),
                    'audio_url': f"/api/song-generation/file/{filename}",
                    'output_filename': filename,
                    'created_at': datetime.fromtimestamp(stat.st_ctime).isoformat(),
                    'completed_at': datetime.fromtimestamp(stat.st_mtime).isoformat(),
                })
    except Exception as e:
        print(f"Error scanning generated songs: {e}")
    
    # Sort by created_at descending
    jobs.sort(key=lambda x: x.get('created_at', ''), reverse=True)
    
    return jsonify({"jobs": jobs})


@app.route('/api/song-generation/audio/<job_id>', methods=['GET'])
def get_song_generation_audio(job_id):
    """Stream audio for a song generation job"""
    if job_id not in song_generation_jobs:
        return jsonify({"error": "Job not found"}), 404
    
    job = song_generation_jobs[job_id]
    if job['status'] != 'completed' or not job.get('output_file'):
        return jsonify({"error": "Audio not ready"}), 404
    
    output_path = Path(job['output_file'])
    if not output_path.exists():
        return jsonify({"error": "Audio file not found"}), 404
    
    return send_file(output_path, mimetype='audio/wav')


@app.route('/api/song-generation/file/<filename>', methods=['GET'])
def get_song_generation_file(filename):
    """Stream audio file by filename"""
    file_path = SONG_GENERATION_DIR / filename
    if not file_path.exists():
        return jsonify({"error": "File not found"}), 404
    
    return send_file(file_path, mimetype='audio/wav')


@app.route('/api/song-generation/delete/<job_id>', methods=['DELETE'])
def delete_song_generation(job_id):
    """Delete a generated song"""
    try:
        # Check if it's an active job
        if job_id in song_generation_jobs:
            job = song_generation_jobs[job_id]
            if job.get('output_file'):
                output_path = Path(job['output_file'])
                if output_path.exists():
                    output_path.unlink()
            del song_generation_jobs[job_id]
            return jsonify({"message": "Deleted successfully"})
        
        # Check if it's a file-based job (starts with "file_")
        if job_id.startswith("file_"):
            # Find the file
            for wav_file in SONG_GENERATION_DIR.glob("*.wav"):
                file_id = f"file_{hashlib.md5(wav_file.name.encode()).hexdigest()[:8]}"
                if file_id == job_id:
                    wav_file.unlink()
                    return jsonify({"message": "Deleted successfully"})
        
        return jsonify({"error": "Job not found"}), 404
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
