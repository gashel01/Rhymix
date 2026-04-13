"""Shared pytest configuration and markers."""

import pytest


def _crepe_available() -> bool:
    """Return True if torchcrepe loaded successfully (i.e. not in CI)."""
    try:
        from backend.app.dubler_melody import transcribe_crepe_frames  # noqa: F401
        return transcribe_crepe_frames is not None
    except Exception:
        return False


CREPE_AVAILABLE = _crepe_available()

requires_crepe = pytest.mark.skipif(
    not CREPE_AVAILABLE,
    reason="torchcrepe / torchaudio not available in this environment (CI skips these)",
)
