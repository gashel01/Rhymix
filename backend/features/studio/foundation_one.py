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

FOUNDATION_TEMP_DIR = paths.BASE_DIR / "data" / "studio" / "foundation"
FOUNDATION_EXPORT_PREFIX = "foundation"
FOUNDATION_WORKER_PREFIX = "__FOUNDATION__"
FOUNDATION_WORKER_READY_TIMEOUT_SEC = 300
FOUNDATION_WORKER_REQUEST_TIMEOUT_SEC = 1800

_FOUNDATION_WORKER = None
_FOUNDATION_WORKER_GUARD = threading.Lock()


def _as_float(value, default=None):
    try:
        number = float(value)
    except Exception:
        return default
    if not (number == number):
        return default
    return number


def _normalize_tags(value):
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return [part.strip() for part in value.split(",") if part.strip()]
    return []


def _candidate_runtime_roots():
    candidates = []
    for raw in (
        os.environ.get("FOUNDATION_ONE_DIR"),
        os.environ.get("RC_STABLE_AUDIO_TOOLS_DIR"),
        paths.BASE_DIR / "Foundation-1",
        paths.BASE_DIR / "RC-stable-audio-tools",
    ):
        if not raw:
            continue
        try:
            candidates.append(Path(raw))
        except Exception:
            continue
    return candidates


def _resolve_runner_python(root: Path):
    explicit = str(os.environ.get("FOUNDATION_ONE_PYTHON") or "").strip()
    if explicit:
        return explicit

    candidates = [
        root / ".venv" / "Scripts" / "python.exe",
        root / ".venv" / "bin" / "python",
        root / "RC-stable-audio-tools" / ".venv" / "Scripts" / "python.exe",
        root / "RC-stable-audio-tools" / ".venv" / "bin" / "python",
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return sys.executable


def _resolve_runner():
    runner = str(os.environ.get("FOUNDATION_ONE_RUNNER") or "").strip()
    if runner:
        return {
            "cwd": None,
            "command": shlex.split(runner, posix=False),
        }

    script_env = str(os.environ.get("FOUNDATION_ONE_SCRIPT") or "").strip()
    if script_env:
        script_path = Path(script_env)
        python_exe = _resolve_runner_python(script_path.parent)
        return {
            "cwd": str(script_path.parent),
            "command": [python_exe, str(script_path)],
        }

    script_candidates = (
        "studio_runner.py",
        "scripts/studio_runner.py",
        "scripts/foundation_one_studio.py",
        "studio/foundation_one_runner.py",
    )
    for root in _candidate_runtime_roots():
        for rel in script_candidates:
            candidate = root / rel
            if candidate.exists():
                python_exe = _resolve_runner_python(root)
                return {
                    "cwd": str(root),
                    "command": [python_exe, str(candidate)],
                }

    raise RuntimeError(
        "Foundation-1 runtime is not installed. Set FOUNDATION_ONE_RUNNER or FOUNDATION_ONE_SCRIPT "
        "to a local Studio runner that accepts --request and --response JSON files."
    )


def _resolve_worker():
    worker = str(os.environ.get("FOUNDATION_ONE_WORKER") or "").strip()
    if worker:
        return {
            "cwd": None,
            "command": shlex.split(worker, posix=False),
        }

    script_candidates = (
        "scripts/studio_worker.py",
        "studio_worker.py",
    )
    for root in _candidate_runtime_roots():
        for rel in script_candidates:
            candidate = root / rel
            if candidate.exists():
                python_exe = _resolve_runner_python(root)
                return {
                    "cwd": str(root),
                    "command": [python_exe, str(candidate)],
                }
    return None


def _copy_audio_to_exports(source_path: Path) -> tuple[Path, str]:
    ext = source_path.suffix or ".wav"
    export_name = f"{FOUNDATION_EXPORT_PREFIX}_{uuid.uuid4().hex}{ext}"
    export_path = paths.EXPORT_DIR / export_name
    paths.EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_path, export_path)
    return export_path, f"/api/download/exports/{export_name}"


def _copy_aux_output(source_path: Path) -> Path:
    FOUNDATION_TEMP_DIR.mkdir(parents=True, exist_ok=True)
    target = FOUNDATION_TEMP_DIR / f"{FOUNDATION_EXPORT_PREFIX}_{uuid.uuid4().hex}{source_path.suffix or '.bin'}"
    shutil.copy2(source_path, target)
    return target


def _resolve_output_path(raw_path, base_dir):
    candidate = Path(str(raw_path))
    if candidate.is_absolute():
        return candidate
    root = Path(base_dir) if base_dir else Path.cwd()
    return (root / candidate).resolve()


def _extract_source_segment(source_path: Path, start_sec, end_sec):
    safe_start = _as_float(start_sec, None)
    safe_end = _as_float(end_sec, None)
    if safe_start is None or safe_end is None or safe_end <= safe_start:
        return None

    FOUNDATION_TEMP_DIR.mkdir(parents=True, exist_ok=True)
    out_path = FOUNDATION_TEMP_DIR / f"foundation_source_{uuid.uuid4().hex}.wav"
    duration = max(0.01, safe_end - safe_start)
    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        str(safe_start),
        "-t",
        str(duration),
        "-i",
        str(source_path),
        "-ac",
        "2",
        "-ar",
        "44100",
        str(out_path),
    ]
    completed = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if completed.returncode != 0 or not out_path.exists():
        message = completed.stderr.strip() or completed.stdout.strip() or "Failed to extract Foundation source segment"
        raise RuntimeError(message)
    return out_path


def _parse_midi_file(midi_path: Path, fallback_bpm=None, fallback_instrument=None):
    import mido

    midi_file = mido.MidiFile(str(midi_path))
    ppq = int(midi_file.ticks_per_beat or 480)
    tempo = None
    track_name = None
    active_notes = {}
    notes = []

    for track in midi_file.tracks:
        tick = 0
        for msg in track:
            tick += int(msg.time or 0)
            if msg.type == "track_name" and not track_name:
                track_name = str(msg.name or "").strip() or track_name
            elif msg.type == "set_tempo" and tempo is None:
                tempo = int(msg.tempo)
            elif msg.type == "note_on" and int(getattr(msg, "velocity", 0) or 0) > 0:
                key = (int(getattr(msg, "channel", 0) or 0), int(msg.note))
                active_notes.setdefault(key, []).append(
                    {
                        "start": tick,
                        "velocity": int(getattr(msg, "velocity", 96) or 96),
                    }
                )
            elif msg.type in {"note_off", "note_on"}:
                key = (int(getattr(msg, "channel", 0) or 0), int(msg.note))
                stack = active_notes.get(key) or []
                if not stack:
                    continue
                started = stack.pop(0)
                duration = max(1, tick - int(started["start"]))
                notes.append(
                    {
                        "note": int(msg.note),
                        "midi": int(msg.note),
                        "velocity": int(started["velocity"]),
                        "startTick": int(started["start"]),
                        "durationTick": duration,
                    }
                )

    notes.sort(key=lambda item: (item.get("startTick", 0), item.get("midi", 60)))
    bpm = None
    if tempo:
        try:
            bpm = round(mido.tempo2bpm(tempo))
        except Exception:
            bpm = None
    if bpm is None:
        bpm = round(_as_float(fallback_bpm, 120) or 120)

    return {
        "notes": notes,
        "ppq": ppq,
        "bpm": bpm,
        "instrument": track_name or fallback_instrument or "Foundation MIDI",
        "source": "foundation_one",
        "midiPath": str(midi_path),
    }


def _normalize_variant(variant: dict, fallback: dict):
    if not isinstance(variant, dict):
        return None

    audio_path = variant.get("audioPath") or variant.get("assetPath") or variant.get("outputPath") or variant.get("wavPath")
    midi_path = variant.get("midiPath") or variant.get("midiFile") or variant.get("midi")
    midi_data = variant.get("midiData") or variant.get("midiClip")

    normalized = {
        "label": variant.get("label") or fallback.get("label") or "Foundation",
        "bpm": variant.get("bpm", fallback.get("bpm")),
        "key": variant.get("key", fallback.get("key")),
        "timeSignature": variant.get("timeSignature", fallback.get("timeSignature")),
        "instrumentFamily": variant.get("instrumentFamily", fallback.get("instrumentFamily")),
        "styleTags": _normalize_tags(variant.get("styleTags", fallback.get("styleTags"))),
        "fxTags": _normalize_tags(variant.get("fxTags", fallback.get("fxTags"))),
        "audioPath": audio_path,
        "midiPath": midi_path,
        "midiData": midi_data if isinstance(midi_data, dict) else None,
        "durationSec": _as_float(variant.get("durationSec"), None),
        "sampleRate": variant.get("sampleRate"),
    }
    if not normalized["audioPath"] and not normalized["midiPath"] and not normalized["midiData"]:
        return None
    return normalized


def _normalize_runner_result(result: dict, fallback: dict):
    if not isinstance(result, dict):
        raise RuntimeError("Foundation-1 runner returned an invalid payload")

    variants = result.get("variants")
    if isinstance(variants, list) and variants:
        normalized_variants = [_normalize_variant(item, fallback) for item in variants]
        normalized_variants = [item for item in normalized_variants if item]
    else:
        normalized = _normalize_variant(result, fallback)
        normalized_variants = [normalized] if normalized else []

    if not normalized_variants:
        raise RuntimeError("Foundation-1 runner did not return audio or MIDI output")

    return {
        "provider": "foundation_one",
        "mode": fallback.get("mode"),
        "prompt": fallback.get("prompt"),
        "bpm": result.get("bpm", fallback.get("bpm")),
        "key": result.get("key", fallback.get("key")),
        "timeSignature": result.get("timeSignature", fallback.get("timeSignature")),
        "bars": result.get("bars", fallback.get("bars")),
        "variants": normalized_variants,
    }


class _FoundationWorkerClient:
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
            self._stderr_tail = self._stderr_tail[-40:]

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

    def _start(self):
        if self._process and self._process.poll() is None:
            return

        self._process = subprocess.Popen(
            self._runner["command"],
            cwd=self._runner.get("cwd"),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        threading.Thread(target=self._stdout_reader, daemon=True).start()
        threading.Thread(target=self._stderr_reader, daemon=True).start()

        ready = self._wait_for_message(
            predicate=lambda payload: payload.get("event") == "ready",
            timeout_sec=FOUNDATION_WORKER_READY_TIMEOUT_SEC,
        )
        if ready is None:
            raise RuntimeError(
                "Foundation-1 worker failed to become ready"
                + (f": {self._stderr_snapshot()}" if self._stderr_snapshot() else "")
            )

    def _wait_for_message(self, predicate, timeout_sec: float):
        deadline = time.time() + max(1.0, float(timeout_sec or 1.0))
        while time.time() < deadline:
            if self._process and self._process.poll() is not None:
                stderr = self._stderr_snapshot()
                raise RuntimeError(
                    "Foundation-1 worker exited unexpectedly"
                    + (f": {stderr}" if stderr else "")
                )
            try:
                line = self._stdout_queue.get(timeout=0.25)
            except queue.Empty:
                continue
            if not line.startswith(FOUNDATION_WORKER_PREFIX):
                continue
            raw_payload = line[len(FOUNDATION_WORKER_PREFIX):].strip()
            if not raw_payload:
                continue
            try:
                payload = json.loads(raw_payload)
            except Exception:
                continue
            if predicate(payload):
                return payload
        return None

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
                raise RuntimeError("Foundation-1 worker stdin is not available")
            self._process.stdin.write(json.dumps(command) + "\n")
            self._process.stdin.flush()

            message = self._wait_for_message(
                predicate=lambda payload: payload.get("id") == request_id,
                timeout_sec=FOUNDATION_WORKER_REQUEST_TIMEOUT_SEC,
            )
            if message is None:
                raise RuntimeError(
                    "Foundation-1 worker timed out"
                    + (f": {self._stderr_snapshot()}" if self._stderr_snapshot() else "")
                )
            if message.get("status") == "completed":
                return
            error = message.get("error") or "Foundation-1 worker request failed"
            raise RuntimeError(error)


def _get_foundation_worker():
    global _FOUNDATION_WORKER
    with _FOUNDATION_WORKER_GUARD:
        if _FOUNDATION_WORKER is not None:
            return _FOUNDATION_WORKER
        runner = _resolve_worker()
        if not runner:
            return None
        _FOUNDATION_WORKER = _FoundationWorkerClient(runner)
        return _FOUNDATION_WORKER


def run_foundation_studio_job(mode: str, payload: dict):
    FOUNDATION_TEMP_DIR.mkdir(parents=True, exist_ok=True)

    temp_paths = []
    source_audio_path = payload.get("sourceAssetPath")
    if source_audio_path and str(mode or "").strip().lower() in {"restyle", "extend"}:
        trimmed_source = _extract_source_segment(
            Path(str(source_audio_path)),
            payload.get("startSec"),
            payload.get("endSec"),
        )
        if trimmed_source:
            source_audio_path = str(trimmed_source)
            temp_paths.append(trimmed_source)

    request_payload = {
        "mode": str(mode or "generate").strip().lower(),
        "prompt": str(payload.get("prompt") or "").strip(),
        "bars": int(payload.get("bars") or 4),
        "bpm": _as_float(payload.get("bpm"), None),
        "key": str(payload.get("key") or "").strip() or None,
        "timeSignature": str(payload.get("timeSignature") or "").strip() or None,
        "instrumentFamily": str(payload.get("instrumentFamily") or "").strip() or None,
        "styleTags": _normalize_tags(payload.get("styleTags")),
        "fxTags": _normalize_tags(payload.get("fxTags")),
        "variantCount": max(1, min(4, int(payload.get("variantCount") or 1))),
        "seed": int(payload.get("seed") or 12345),
        "steps": max(1, int(payload.get("steps") or 250)),
        "cfgScale": _as_float(payload.get("cfgScale"), 6.0),
        "cfgRescale": _as_float(payload.get("cfgRescale"), 0.0),
        "samplerType": str(payload.get("samplerType") or "dpmpp-3m-sde").strip() or "dpmpp-3m-sde",
        "sigmaMin": _as_float(payload.get("sigmaMin"), 0.03),
        "sigmaMax": _as_float(payload.get("sigmaMax"), 1000.0),
        "initNoiseLevel": _as_float(payload.get("initNoiseLevel"), None),
        "sourceAudioPath": source_audio_path,
        "startSec": _as_float(payload.get("startSec"), None),
        "endSec": _as_float(payload.get("endSec"), None),
    }

    request_path = FOUNDATION_TEMP_DIR / f"request_{uuid.uuid4().hex}.json"
    response_path = FOUNDATION_TEMP_DIR / f"response_{uuid.uuid4().hex}.json"
    request_path.write_text(json.dumps(request_payload, indent=2), encoding="utf-8")
    try:
        worker = _get_foundation_worker()
        runner = _resolve_worker() if worker else _resolve_runner()
        if worker:
            worker.request(request_path, response_path)
        else:
            cmd = [*runner["command"], "--request", str(request_path), "--response", str(response_path)]
            completed = subprocess.run(
                cmd,
                cwd=runner.get("cwd"),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )
            if completed.returncode != 0:
                message = completed.stderr.strip() or completed.stdout.strip() or "Foundation-1 runner failed"
                raise RuntimeError(message)
        if not response_path.exists():
            raise RuntimeError("Foundation-1 runner did not produce a response JSON file")

        result = json.loads(response_path.read_text(encoding="utf-8"))
        if result.get("error"):
            traceback_text = str(result.get("traceback") or "").strip()
            message = str(result.get("error") or "Foundation-1 runner failed").strip()
            if traceback_text:
                message = f"{message}\n{traceback_text}"
            raise RuntimeError(message)
        normalized = _normalize_runner_result(result, request_payload)

        for variant in normalized["variants"]:
            audio_path = variant.get("audioPath")
            if audio_path:
                source = _resolve_output_path(audio_path, runner.get("cwd"))
                if not source.exists():
                    raise RuntimeError(f"Foundation audio output not found: {source}")
                exported_audio_path, exported_audio_url = _copy_audio_to_exports(source)
                variant["audioPath"] = str(exported_audio_path)
                variant["audioUrl"] = exported_audio_url
                probed = probe_audio(exported_audio_path)
                if variant.get("durationSec") in (None, 0, 0.0):
                    variant["durationSec"] = probed.get("durationSec", 0.0)
                if not variant.get("sampleRate"):
                    variant["sampleRate"] = probed.get("sampleRate")
            midi_path = variant.get("midiPath")
            if midi_path:
                source = _resolve_output_path(midi_path, runner.get("cwd"))
                if not source.exists():
                    raise RuntimeError(f"Foundation MIDI output not found: {source}")
                midi_copy = _copy_aux_output(source)
                variant["midiPath"] = str(midi_copy)
                if not variant.get("midiData"):
                    variant["midiData"] = _parse_midi_file(
                        midi_copy,
                        fallback_bpm=variant.get("bpm") or normalized.get("bpm"),
                        fallback_instrument=variant.get("instrumentFamily"),
                    )
            elif isinstance(variant.get("midiData"), dict):
                midi_data = dict(variant["midiData"])
                midi_data.setdefault("bpm", round(_as_float(variant.get("bpm"), 120) or 120))
                midi_data.setdefault("ppq", 480)
                midi_data.setdefault("instrument", variant.get("instrumentFamily") or "Foundation MIDI")
                variant["midiData"] = midi_data

        return normalized
    finally:
        for temp_path in [request_path, response_path, *temp_paths]:
            try:
                Path(temp_path).unlink(missing_ok=True)
            except Exception:
                pass
