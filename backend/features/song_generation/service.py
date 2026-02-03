from backend.features.song_generation.providers.ace_step import AceStepProvider, SONG_GENERATION_DIR, SONG_GENERATION_JOBS_DIR

_PROVIDERS = {"ace_step": AceStepProvider()}


def get_provider(params: dict):
    key = (params or {}).get("provider") or "ace_step"
    return _PROVIDERS.get(str(key).lower(), _PROVIDERS["ace_step"])


def run_song_generation_thread(job_id, params):
    provider = get_provider(params)
    return provider.run(job_id, params)


__all__ = ["SONG_GENERATION_DIR", "SONG_GENERATION_JOBS_DIR", "run_song_generation_thread"]
