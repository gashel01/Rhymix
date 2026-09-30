"""Song-generation engine registry.

YuE2 is the only engine. ACE-Step was removed: YuE2 beat it on quality and, once
its vllm decoder path was enabled, on speed too - and it can hand back the ABC /
MIDI composition it planned, which is what makes a generated song editable
rather than a sealed stereo file.

The registry is kept even with one entry: the seam is what let YuE2 be added
alongside ACE-Step and then replace it without touching the routes.

LICENCE: YuE2 weights are CC BY-NC 4.0 (non-commercial), and WanGP's terms
require disclosing that this project uses it. Both are surfaced by
`/api/song-generation/providers` and on every generated job.
"""

import os

from backend.features.song_generation.jobs_common import SONG_GENERATION_DIR, SONG_GENERATION_JOBS_DIR
from backend.features.song_generation.providers.yue2 import Yue2Provider

_PROVIDERS = {"yue2": Yue2Provider()}

DEFAULT_PROVIDER = (os.environ.get("SONG_GENERATION_PROVIDER") or "yue2").strip().lower()
if DEFAULT_PROVIDER not in _PROVIDERS:
    DEFAULT_PROVIDER = "yue2"

PROVIDER_LICENSES = {
    "yue2": "CC BY-NC 4.0 - non-commercial. Generated via WanGP.",
}


def get_provider(params: dict):
    key = (params or {}).get("provider") or DEFAULT_PROVIDER
    return _PROVIDERS.get(str(key).lower(), _PROVIDERS[DEFAULT_PROVIDER])


def available_providers() -> list[str]:
    return sorted(_PROVIDERS)


def run_song_generation_thread(job_id, params):
    provider = get_provider(params)
    return provider.run(job_id, params)


__all__ = [
    "DEFAULT_PROVIDER",
    "PROVIDER_LICENSES",
    "SONG_GENERATION_DIR",
    "SONG_GENERATION_JOBS_DIR",
    "available_providers",
    "get_provider",
    "run_song_generation_thread",
]
