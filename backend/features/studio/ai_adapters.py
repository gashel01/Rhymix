import json
import os
import subprocess
import threading
import time


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
        self.python_exe = python_exe or os.environ.get("STUDIO_AI_PYTHON") or "python"
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
            try:
                self._process.terminate()
            except Exception:
                pass
        self._process = None

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
        try:
            response = json.loads(result.stdout or "{}")
        except json.JSONDecodeError as exc:
            raise RuntimeError("AI bridge returned invalid JSON") from exc
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


def get_ai_adapter() -> AiAudioAdapter:
    adapter = os.environ.get("STUDIO_AI_ADAPTER", "").strip().lower()
    if adapter == "local":
        return LocalPythonAdapter()
    return NotConfiguredAdapter()
