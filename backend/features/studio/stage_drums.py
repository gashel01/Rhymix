import json
import os
import queue
import shlex
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

from backend.features.studio.assets import probe_audio
from backend.paths.manager import paths

STAGE_TEMP_DIR = paths.BASE_DIR / "data" / "studio" / "stage"
STAGE_EXPORT_PREFIX = "stage_drums"
STAGE_WORKER_PREFIX = "__STAGE__"
STAGE_WORKER_READY_TIMEOUT_SEC = 900
STAGE_WORKER_REQUEST_TIMEOUT_SEC = 1800

_STAGE_WORKER = None
_STAGE_WORKER_GUARD = threading.Lock()


def _as_float(value, default=None):
    try:
        number = float(value)
    except Exception:
        return default
    if not (number == number):
        return default
    return number

def _candidate_runtime_roots():
    candidates = []
    for raw in (
        os.environ.get("STAGE_DIR"),
        paths.BASE_DIR / "stage",
    ):
        if not raw:
            continue
        try:
            candidates.append(Path(raw))
        except Exception:
            continue
    return candidates


def _resolve_worker_python(root: Path):
    explicit = str(os.environ.get("STAGE_PYTHON") or "").strip()
    if explicit:
        return explicit

    candidates = [
        root / ".venv" / "Scripts" / "python.exe",
        root / ".venv" / "bin" / "python",
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return sys.executable


def _resolve_worker():
    worker = str(os.environ.get("STAGE_WORKER") or "").strip()
    if worker:
        return {
            "cwd": None,
            "command": shlex.split(worker, posix=False),
        }

    script_candidates = (
        "scripts/rhymix_stage_worker.py",
        "rhymix_stage_worker.py",
    )
    for root in _candidate_runtime_roots():
        for rel in script_candidates:
            candidate = root / rel
            if candidate.exists():
                python_exe = _resolve_worker_python(root)
                return {
                    "cwd": str(root),
                    "command": [python_exe, str(candidate)],
                }
    raise RuntimeError(
        "STAGE runtime is not installed. Clone the stage repo into /stage or set STAGE_DIR/STAGE_WORKER."
    )


def _copy_audio_to_exports(source_path: Path) -> tuple[Path, str]:
    ext = source_path.suffix or ".wav"
    export_name = f"{STAGE_EXPORT_PREFIX}_{uuid.uuid4().hex}{ext}"
    export_path = paths.EXPORT_DIR / export_name
    paths.EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_path, export_path)
    return export_path, f"/api/download/exports/{export_name}"


def _resolve_output_path(raw_path, base_dir):
    candidate = Path(str(raw_path))
    if candidate.is_absolute():
        return candidate
    root = Path(base_dir) if base_dir else Path.cwd()
    return (root / candidate).resolve()


class _StageWorkerClient:
    def __init__(self, runner: dict):
        self._runner = runner
        self._process = None
        self._stdout_queue = queue.Queue()
        self._stderr_tail = []
        self._stderr_lock = threading.Lock()
        self._request_lock = threading.Lock()

    def _append_stderr(self, line: str):
        text = str(line or "").rstrip()
        if not text:
            return
        with self._stderr_lock:
            self._stderr_tail.append(text)
            self._stderr_tail = self._stderr_tail[-60:]

    def _stderr_snapshot(self):
        with self._stderr_lock:
            return "\n".join(self._stderr_tail[-20:])

    def _stdout_reader(self):
        stream = self._process.stdout
        while stream:
            line = stream.readline()
            if not line:
                break
            self._stdout_queue.put(line.rstrip("\r\n"))

    def _stderr_reader(self):
        stream = self._process.stderr
        while stream:
            line = stream.readline()
            if not line:
                break
            self._append_stderr(line)

    def _wait_for_message(self, predicate, timeout_sec: float):
        deadline = time.time() + max(1.0, float(timeout_sec or 1.0))
        while time.time() < deadline:
            if self._process and self._process.poll() is not None:
                stderr = self._stderr_snapshot()
                raise RuntimeError(
                    "STAGE worker exited unexpectedly"
                    + (f": {stderr}" if stderr else "")
                )
            try:
                line = self._stdout_queue.get(timeout=0.25)
            except queue.Empty:
                continue
            if not line.startswith(STAGE_WORKER_PREFIX):
                continue
            raw_payload = line[len(STAGE_WORKER_PREFIX):].strip()
            if not raw_payload:
                continue
            try:
                payload = json.loads(raw_payload)
            except Exception:
                continue
            if predicate(payload):
                return payload
        return None

    def _start(self):
        if self._process and self._process.poll() is None:
            return
        root = Path(self._runner.get("cwd") or Path.cwd())
        hf_cache = root / ".hf-cache"
        hf_cache.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        env["HF_HOME"] = str(hf_cache)
        env["HUGGINGFACE_HUB_CACHE"] = str(hf_cache / "hub")
        env["HF_HUB_CACHE"] = str(hf_cache / "hub")
        env["TRANSFORMERS_CACHE"] = str(hf_cache / "transformers")
        env["XDG_CACHE_HOME"] = str(hf_cache)
        self._process = subprocess.Popen(
            self._runner["command"],
            cwd=self._runner.get("cwd"),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        threading.Thread(target=self._stdout_reader, daemon=True).start()
        threading.Thread(target=self._stderr_reader, daemon=True).start()
        ready = self._wait_for_message(
            predicate=lambda payload: payload.get("event") in {"ready", "error"},
            timeout_sec=STAGE_WORKER_READY_TIMEOUT_SEC,
        )
        if ready is None:
            raise RuntimeError(
                "STAGE worker failed to become ready"
                + (f": {self._stderr_snapshot()}" if self._stderr_snapshot() else "")
            )
        if ready.get("event") == "error":
            raise RuntimeError(str(ready.get("error") or "STAGE worker startup failed"))

    def request(self, request_path: Path, response_path: Path):
        with self._request_lock:
            self._start()
            request_id = uuid.uuid4().hex
            command = {
                "id": request_id,
                "request": str(request_path),
                "response": str(response_path),
            }
            if not self._process or not self._process.stdin:
                raise RuntimeError("STAGE worker stdin is not available")
            self._process.stdin.write(json.dumps(command) + "\n")
            self._process.stdin.flush()
            message = self._wait_for_message(
                predicate=lambda payload: payload.get("id") == request_id,
                timeout_sec=STAGE_WORKER_REQUEST_TIMEOUT_SEC,
            )
            if message is None:
                raise RuntimeError(
                    "STAGE worker timed out"
                    + (f": {self._stderr_snapshot()}" if self._stderr_snapshot() else "")
                )
            if message.get("status") == "completed":
                return
            error = message.get("error") or "STAGE worker request failed"
            raise RuntimeError(error)


def _get_stage_worker():
    global _STAGE_WORKER
    with _STAGE_WORKER_GUARD:
        if _STAGE_WORKER is not None:
            return _STAGE_WORKER
        runner = _resolve_worker()
        _STAGE_WORKER = _StageWorkerClient(runner)
        return _STAGE_WORKER


def run_stage_drums_job(payload: dict):
    STAGE_TEMP_DIR.mkdir(parents=True, exist_ok=True)

    conditioning_audio_path = str(payload.get("conditioningAudioPath") or "").strip()
    if not conditioning_audio_path:
        raise RuntimeError("conditioningAudioPath is required for STAGE drum generation")
    conditioning_audio = Path(conditioning_audio_path).expanduser()
    if not conditioning_audio.is_absolute():
        conditioning_audio = (paths.BASE_DIR / conditioning_audio).resolve()
    else:
        conditioning_audio = conditioning_audio.resolve()
    if not conditioning_audio.exists():
        raise RuntimeError(f"STAGE conditioning audio not found: {conditioning_audio}")

    request_payload = {
        "mode": "drums",
        "prompt": str(payload.get("prompt") or "").strip(),
        "bpm": _as_float(payload.get("bpm"), None),
        "seed": int(payload.get("seed") or 42),
        "durationSec": max(0.5, _as_float(payload.get("durationSec"), 8.0) or 8.0),
        "conditioningAudioPath": str(conditioning_audio),
        "addClick": bool(payload.get("addClick")),
        "label": str(payload.get("label") or "STAGE Drums").strip() or "STAGE Drums",
    }

    worker = _get_stage_worker()
    runner = _resolve_worker()
    request_path = STAGE_TEMP_DIR / f"request_{uuid.uuid4().hex}.json"
    response_path = STAGE_TEMP_DIR / f"response_{uuid.uuid4().hex}.json"
    request_path.write_text(json.dumps(request_payload, indent=2), encoding="utf-8")

    try:
        worker.request(request_path, response_path)
        if not response_path.exists():
            raise RuntimeError("STAGE worker did not produce a response JSON file")
        result = json.loads(response_path.read_text(encoding="utf-8"))
        if result.get("error"):
            traceback_text = str(result.get("traceback") or "").strip()
            message = str(result.get("error") or "STAGE worker failed").strip()
            if traceback_text:
                message = f"{message}\n{traceback_text}"
            raise RuntimeError(message)

        raw_audio_path = result.get("audioPath") or result.get("assetPath") or result.get("outputPath")
        if not raw_audio_path:
            raise RuntimeError("STAGE worker did not return an audio output path")
        source = _resolve_output_path(raw_audio_path, runner.get("cwd"))
        if not source.exists():
            raise RuntimeError(f"STAGE audio output not found: {source}")
        exported_audio_path, exported_audio_url = _copy_audio_to_exports(source)
        probed = probe_audio(exported_audio_path)
        return {
            "provider": "stage",
            "mode": "drums",
            "prompt": request_payload.get("prompt"),
            "bpm": result.get("bpm", request_payload.get("bpm")),
            "durationSec": result.get("durationSec", probed.get("durationSec", 0.0)),
            "variants": [
                {
                    "label": result.get("label") or request_payload.get("label") or "STAGE Drums",
                    "audioPath": str(exported_audio_path),
                    "audioUrl": exported_audio_url,
                    "durationSec": result.get("durationSec", probed.get("durationSec", 0.0)),
                    "sampleRate": result.get("sampleRate", probed.get("sampleRate")),
                }
            ],
        }
    finally:
        for temp_path in (request_path, response_path):
            try:
                Path(temp_path).unlink(missing_ok=True)
            except Exception:
                pass
