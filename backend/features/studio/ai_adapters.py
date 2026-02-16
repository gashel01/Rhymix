import json
import os
import subprocess


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

    def _build_command(self):
        if self.entrypoint.endswith(".py"):
            return [self.python_exe, self.entrypoint]
        return [self.python_exe, "-m", self.entrypoint]

    def _invoke(self, method: str, payload: dict) -> dict:
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
