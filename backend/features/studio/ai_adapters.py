import json
import os
import signal
import subprocess
import sys
import threading
import time


def _kill_process_tree(pid: int) -> None:
    """Kill a process and its children.

    terminate() alone leaves the bridge's model worker running — that worker
    holds several GB and the GPU, so it has to go with its parent.
    """
    if os.name == "nt":
        try:
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                check=False,
                capture_output=True,
                timeout=30,
            )
            return
        except (OSError, subprocess.SubprocessError):
            pass
    try:
        os.kill(pid, signal.SIGTERM)
    except (OSError, ProcessLookupError):
        pass


class AiAudioAdapter:
    def repaint(self, payload: dict) -> dict:
        raise NotImplementedError

    def add_layer(self, payload: dict) -> dict:
        raise NotImplementedError

    def cover(self, payload: dict) -> dict:
        raise NotImplementedError

    def vocal2bgm(self, payload: dict) -> dict:
        raise NotImplementedError

    def stem_extract(self, payload: dict) -> dict:
        raise NotImplementedError

    def understand(self, payload: dict) -> dict:
        raise NotImplementedError

    def lrc(self, payload: dict) -> dict:
        raise NotImplementedError

    def quality_score(self, payload: dict) -> dict:
        raise NotImplementedError


class NotConfiguredAdapter(AiAudioAdapter):
    def _fail(self):
        raise RuntimeError(
            "AI backend not configured. Set STUDIO_AI_ADAPTER=local and STUDIO_AI_BRIDGE to a Python bridge entrypoint."
        )

    def repaint(self, payload: dict) -> dict:
        self._fail()

    def add_layer(self, payload: dict) -> dict:
        self._fail()

    def cover(self, payload: dict) -> dict:
        self._fail()

    def vocal2bgm(self, payload: dict) -> dict:
        self._fail()

    def stem_extract(self, payload: dict) -> dict:
        self._fail()

    def understand(self, payload: dict) -> dict:
        self._fail()

    def lrc(self, payload: dict) -> dict:
        self._fail()

    def quality_score(self, payload: dict) -> dict:
        self._fail()


class LocalPythonAdapter(AiAudioAdapter):
    def __init__(self, entrypoint: str | None = None, python_exe: str | None = None):
        self.entrypoint = entrypoint or os.environ.get("STUDIO_AI_BRIDGE") or "backend.features.studio.ai_bridge_acestep"
        # Default to the interpreter already running the app. A bare "python"
        # resolves against PATH, which lands outside the virtualenv — the bridge
        # then can't import applio or torch and every AI job fails on startup.
        # Only set STUDIO_AI_PYTHON to run the bridge in a *different* env.
        configured = python_exe or os.environ.get("STUDIO_AI_PYTHON")
        if not configured or configured.strip().lower() in {"python", "python3", "py"}:
            configured = sys.executable
        self.python_exe = configured
        self.persistent = str(os.environ.get("STUDIO_AI_PERSISTENT", "1")).strip().lower() not in {
            "0",
            "false",
            "no",
            "off",
        }
        self._process = None
        self._lock = threading.Lock()

    def _build_command(self):
        if self.entrypoint.endswith(".py"):
            return [self.python_exe, "-u", self.entrypoint]
        return [self.python_exe, "-u", "-m", self.entrypoint]

    def _start_process(self):
        cmd = self._build_command()
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        self._process = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env=env,
        )

    def _ensure_process(self):
        if self._process and self._process.poll() is None:
            return
        self._start_process()

    def _terminate_process(self):
        if self._process and self._process.poll() is None:
            _kill_process_tree(self._process.pid)
        self._process = None

    def terminate(self) -> bool:
        """Kill the bridge and whatever it spawned. True if one was running."""
        with self._lock:
            running = bool(self._process and self._process.poll() is None)
            self._terminate_process()
            return running

    def _read_response(self):
        noise = []
        while True:
            line = self._process.stdout.readline() if self._process else ""
            if not line:
                if not self._process or self._process.poll() is not None:
                    self._terminate_process()
                    detail = "\n".join(noise[-10:]) if noise else ""
                    msg = "AI bridge exited unexpectedly"
                    if detail:
                        msg = f"{msg}: {detail}"
                    raise RuntimeError(msg)
                time.sleep(0.01)
                continue
            line = line.strip()
            if not line:
                continue
            try:
                return json.loads(line)
            except json.JSONDecodeError:
                noise.append(line)
                continue

    def _parse_response_text(self, text: str) -> dict:
        raw = str(text or "").strip()
        if not raw:
            raise RuntimeError("AI bridge returned empty output")
        noise = []
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                response = json.loads(line)
                if not isinstance(response, dict):
                    raise RuntimeError("AI bridge returned unexpected response")
                return response
            except json.JSONDecodeError:
                noise.append(line)
                continue
        detail = "\n".join(noise[-10:]) if noise else ""
        msg = "AI bridge returned invalid JSON"
        if detail:
            msg = f"{msg}: {detail}"
        raise RuntimeError(msg)

    def _invoke_persistent(self, method: str, payload: dict) -> dict:
        with self._lock:
            self._ensure_process()
            request_payload = json.dumps({"method": method, "payload": payload})
            try:
                self._process.stdin.write(request_payload + "\n")
                self._process.stdin.flush()
            except Exception:
                self._terminate_process()
                raise RuntimeError("AI bridge stdin write failed")

            response = self._read_response()
            if isinstance(response, dict) and response.get("error"):
                raise RuntimeError(response.get("error"))
            if not isinstance(response, dict):
                raise RuntimeError("AI bridge returned unexpected response")
            return response

    def _invoke(self, method: str, payload: dict) -> dict:
        if self.persistent:
            try:
                return self._invoke_persistent(method, payload)
            except Exception:
                # Fall back to one-shot mode if the persistent bridge fails.
                self._terminate_process()

        cmd = self._build_command()
        request_payload = json.dumps({"method": method, "payload": payload})
        result = subprocess.run(
            cmd,
            input=request_payload,
            text=True,
            capture_output=True,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "AI bridge failed")
        response = self._parse_response_text(result.stdout)
        if isinstance(response, dict) and response.get("error"):
            raise RuntimeError(response.get("error"))
        if not isinstance(response, dict):
            raise RuntimeError("AI bridge returned unexpected response")
        return response

    def repaint(self, payload: dict) -> dict:
        return self._invoke("repaint", payload)

    def add_layer(self, payload: dict) -> dict:
        return self._invoke("add_layer", payload)

    def cover(self, payload: dict) -> dict:
        return self._invoke("cover", payload)

    def vocal2bgm(self, payload: dict) -> dict:
        return self._invoke("vocal2bgm", payload)

    def stem_extract(self, payload: dict) -> dict:
        return self._invoke("stem_extract", payload)

    def understand(self, payload: dict) -> dict:
        return self._invoke("understand", payload)

    def lrc(self, payload: dict) -> dict:
        return self._invoke("lrc", payload)

    def quality_score(self, payload: dict) -> dict:
        return self._invoke("quality_score", payload)


_ADAPTER_LOCK = threading.Lock()
_ADAPTER = None


def get_ai_adapter() -> AiAudioAdapter:
    """Return the shared adapter.

    Building a new one per job defeated STUDIO_AI_PERSISTENT: every job spawned
    its own bridge, each holding a multi-GB model worker, and nothing kept a
    reference to stop them — they simply accumulated. One instance keeps the
    bridge warm and gives cancellation something to terminate.
    """
    global _ADAPTER

    wanted = os.environ.get("STUDIO_AI_ADAPTER", "").strip().lower()
    if wanted != "local":
        return NotConfiguredAdapter()

    with _ADAPTER_LOCK:
        if _ADAPTER is None:
            _ADAPTER = LocalPythonAdapter()
        return _ADAPTER


def terminate_ai_adapter() -> bool:
    """Stop the running bridge, if any. True when one was actually killed."""
    with _ADAPTER_LOCK:
        adapter = _ADAPTER
    return bool(adapter and adapter.terminate())
