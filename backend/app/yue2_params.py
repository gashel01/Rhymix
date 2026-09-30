"""Pure parameter handling for the YuE2 song-generation provider.

Nothing here touches a GPU, a subprocess or the filesystem.  It decides what
payload to send to WanGP and which combinations are illegal; the provider only
performs.  That split is why this file can be tested in milliseconds.

The rules below are not inventions - they come from WanGP's own YuE2 handler
(`models/TTS/yue2/yue2_handler.py`) and pipeline (`models/TTS/yue2/pipeline.py`).
Where a rule is surprising, the comment says where it comes from.
"""

from __future__ import annotations

# WanGP model_type identifiers (defaults/yue2.json, defaults/yue2_hum.json)
MODEL_TEXT = "yue2"
MODEL_HUM = "yue2_hum"

# Composition planning.  Labels mirror the WanGP UI so support requests match.
MODE_MELODY_AND_CHORDS = 0
MODE_MELODY_ONLY = 1
MODE_DIRECT = 2

MODE_LABELS = {
    MODE_MELODY_AND_CHORDS: "Melody and chords",
    MODE_MELODY_ONLY: "Melody only",
    MODE_DIRECT: "Direct generation",
}

# Hum-to-Song reuses model_mode with a different meaning and has no mode 2.
HUM_MODE_CONTINUE = 0
HUM_MODE_ONLY = 1

HUM_MODE_LABELS = {
    HUM_MODE_CONTINUE: "Continue Hum",
    HUM_MODE_ONLY: "Hum Only",
}

# duration_slider in the handler: min 1, max 600.  It is an upper bound on the
# song, not a target - generation can stop earlier on its own end token.
DURATION_MIN = 1
DURATION_MAX = 600
DURATION_DEFAULT = 120

# The semantic stage emits this many tokens per second of audio
# (`frame_rate = 25` in pipeline.py).  Used to warn about truncation.
FRAME_RATE = 25

DEFAULTS = {
    "duration_seconds": DURATION_DEFAULT,
    "num_inference_steps": 32,
    "guidance_scale": 1.0,
    "temperature": 1.0,
    "top_k": 100,
    "top_p": 0.95,
    "model_mode": MODE_MELODY_AND_CHORDS,
    "seed": -1,
    "save_score": False,
}


def _coerce_bool(value, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}
    return bool(value)


def _coerce_int(value, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _coerce_float(value, default: float) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return default if result != result else result  # reject NaN


def strip_comment_lines(lyrics: str) -> tuple[str, list[str]]:
    """Drop the lines WanGP will silently discard, and say which ones.

    `shared/utils/prompt_parser.py` removes every line whose first non-space
    character is '#' before the prompt ever reaches the model.  On rap lyrics a
    hashtag at the start of a line is entirely plausible, and losing it without
    a word would look like the model ignoring the input.  We reproduce the rule
    here so the caller can warn instead.
    """
    if not lyrics:
        return "", []
    kept: list[str] = []
    dropped: list[str] = []
    for line in str(lyrics).replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if line.strip().startswith("#"):
            dropped.append(line)
        else:
            kept.append(line)
    return "\n".join(kept), dropped


def estimate_semantic_tokens(duration_seconds: int) -> int:
    """Semantic tokens the requested duration will ask the model to emit."""
    return max(0, int(duration_seconds)) * FRAME_RATE


def normalize(params: dict | None) -> dict:
    """Coerce a raw request payload into the shape the provider works with."""
    params = dict(params or {})
    is_hum = _coerce_bool(params.get("hum"), False) or bool(params.get("hum_audio"))

    duration = _coerce_int(params.get("duration_seconds"), DEFAULTS["duration_seconds"])
    duration = max(DURATION_MIN, min(DURATION_MAX, duration))

    mode_default = HUM_MODE_CONTINUE if is_hum else DEFAULTS["model_mode"]
    model_mode = _coerce_int(params.get("model_mode"), mode_default)

    normalized = {
        "hum": is_hum,
        "lyrics": str(params.get("lyrics") or params.get("prompt") or ""),
        "style": str(params.get("style") or params.get("alt_prompt") or ""),
        "duration_seconds": duration,
        "num_inference_steps": max(1, _coerce_int(params.get("num_inference_steps"), DEFAULTS["num_inference_steps"])),
        "guidance_scale": _coerce_float(params.get("guidance_scale"), DEFAULTS["guidance_scale"]),
        "temperature": _coerce_float(params.get("temperature"), DEFAULTS["temperature"]),
        "top_k": _coerce_int(params.get("top_k"), DEFAULTS["top_k"]),
        "top_p": _coerce_float(params.get("top_p"), DEFAULTS["top_p"]),
        "model_mode": model_mode,
        "seed": _coerce_int(params.get("seed"), DEFAULTS["seed"]),
        "save_score": _coerce_bool(params.get("save_score"), DEFAULTS["save_score"]),
        # Path to a source song to transcribe (cover) or a hum recording.
        "audio_guide": params.get("audio_guide") or params.get("source_audio") or params.get("hum_audio") or None,
        # Path to a .abc score to impose instead of letting the model plan.
        "custom_guide": params.get("custom_guide") or params.get("score_abc") or None,
    }
    return normalized


def validate(params: dict) -> list[str]:
    """Return blocking errors.  Empty list means the payload is sendable."""
    p = normalize(params)
    errors: list[str] = []

    if not p["lyrics"].strip():
        errors.append("Lyrics are required.")

    if p["hum"]:
        if p["model_mode"] not in HUM_MODE_LABELS:
            errors.append("Hum-to-Song only accepts Continue Hum (0) or Hum Only (1).")
        if not p["audio_guide"]:
            errors.append("Hum-to-Song requires a hum recording.")
        if p["custom_guide"]:
            # The handler drops custom_guide entirely for the hum model.
            errors.append("Hum-to-Song does not accept a manual ABC score.")
    else:
        if p["model_mode"] not in MODE_LABELS:
            errors.append("Composition planning must be 0, 1 or 2.")

    # A source song is transcribed into ABC and overrides any supplied score,
    # so accepting both would silently ignore one of them.
    if p["audio_guide"] and p["custom_guide"] and not p["hum"]:
        errors.append("A source song and an ABC score cannot be combined - the source song would override the score.")

    # Direct generation skips planning entirely, so there is no score to save
    # and no score to impose.  Both combinations are user error, not a no-op.
    if p["model_mode"] == MODE_DIRECT and not p["hum"]:
        if p["save_score"]:
            errors.append("Direct generation produces no score - turn off Save Score or pick another planning mode.")
        if p["custom_guide"]:
            errors.append("Direct generation ignores an ABC score - pick Melody and chords or Melody only.")
        if p["audio_guide"]:
            errors.append("Transcribing a source song requires Melody and chords or Melody only.")

    if not DURATION_MIN <= p["duration_seconds"] <= DURATION_MAX:
        errors.append(f"Duration must be between {DURATION_MIN} and {DURATION_MAX} seconds.")

    return errors


def warnings(params: dict) -> list[str]:
    """Return non-blocking advice worth surfacing in the UI."""
    p = normalize(params)
    notes: list[str] = []

    _, dropped = strip_comment_lines(p["lyrics"])
    if dropped:
        preview = dropped[0].strip()
        notes.append(
            f"{len(dropped)} lyric line(s) starting with '#' will be discarded before generation "
            f"(first: {preview!r})."
        )

    # guidance != 1 builds a negative prefix and runs CFG, doubling the cost of
    # the semantic stage - the dominant one.  Worth saying out loud.
    if p["guidance_scale"] != 1.0:
        notes.append("Guidance above 1.0 enables classifier-free guidance and roughly doubles generation time.")

    if p["custom_guide"]:
        notes.append("Lyrics must stay metrically compatible with the supplied score, or they will not fit the melody.")

    if p["hum"]:
        notes.append("Hum-to-Song does not clone the humming voice; it only follows the melody.")
    elif p["audio_guide"]:
        notes.append("A cover generates a new recording and does not preserve the original backing track.")

    if p["model_mode"] == MODE_DIRECT and not p["hum"]:
        notes.append("Direct generation skips composition planning; musical coherence is usually lower.")

    return notes


def build_settings(params: dict) -> dict:
    """Build the WanGP settings dict consumed by `session.submit_task`.

    Keys and defaults follow `Yue2Handler.update_default_settings`.
    """
    p = normalize(params)
    lyrics, _ = strip_comment_lines(p["lyrics"])

    settings = {
        "model_type": MODEL_HUM if p["hum"] else MODEL_TEXT,
        "prompt": lyrics,
        "alt_prompt": p["style"],
        "duration_seconds": p["duration_seconds"],
        "video_length": 0,
        "num_inference_steps": p["num_inference_steps"],
        "guidance_scale": p["guidance_scale"],
        "temperature": p["temperature"],
        "top_k": p["top_k"],
        "top_p": p["top_p"],
        "model_mode": p["model_mode"],
        "seed": p["seed"],
        "negative_prompt": "",
        "prompt_enhancer": "",
        "repeat_generation": 1,
        # Never let WanGP split lyrics into separate songs: "G" would queue one
        # song per line and "PG" one per section.
        "multi_prompts_gen_type": "FG",
        "custom_settings": {"save_score": 1 if p["save_score"] else 0},
        "custom_guide": None,
        "audio_prompt_type": "",
    }

    if p["hum"]:
        # The hum model requires its audio input and has no other source mode.
        settings["audio_prompt_type"] = "A"
        settings["audio_guide"] = str(p["audio_guide"])
    elif p["audio_guide"]:
        # Cover: SheetSage2 transcribes the source song into ABC.
        settings["audio_prompt_type"] = "A"
        settings["audio_guide"] = str(p["audio_guide"])
    elif p["custom_guide"]:
        settings["custom_guide"] = str(p["custom_guide"])

    return settings


def describe(params: dict) -> dict:
    """Small summary for logs and job metadata."""
    p = normalize(params)
    if p["hum"]:
        kind, mode_label = "hum", HUM_MODE_LABELS.get(p["model_mode"], str(p["model_mode"]))
    else:
        kind = "cover" if p["audio_guide"] else ("score" if p["custom_guide"] else "text")
        mode_label = MODE_LABELS.get(p["model_mode"], str(p["model_mode"]))
    return {
        "kind": kind,
        "planning": mode_label,
        "duration_seconds": p["duration_seconds"],
        "semantic_tokens": estimate_semantic_tokens(p["duration_seconds"]),
        "saves_score": p["save_score"],
    }
