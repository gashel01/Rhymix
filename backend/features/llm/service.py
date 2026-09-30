import json
import os
from json import JSONDecodeError

import requests

GROQ_AUTOFILL_URL = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_GROQ_MODEL = os.getenv("GROQ_AUTOFILL_MODEL", "llama-3.1-8b-instant")


def _clean_text(value):
    return " ".join(str(value or "").strip().split())


def _strip_markdown_fences(raw_text: str) -> str:
    text = str(raw_text or "").strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        return "\n".join(lines).strip()
    return text


def _string_list(value):
    if isinstance(value, list):
        return [_clean_text(item) for item in value if _clean_text(item)]
    if isinstance(value, str):
        return [_clean_text(item) for item in value.split(",") if _clean_text(item)]
    return []


def _require_text(payload: dict, key: str) -> str:
    value = _clean_text(payload.get(key))
    if not value:
        raise RuntimeError(f"Groq returned an empty `{key}` suggestion.")
    return value


def _require_list(payload: dict, key: str) -> list:
    value = payload.get(key)
    if not isinstance(value, list):
        raise RuntimeError(f"Groq returned an invalid `{key}` suggestion.")
    return value


def _require_dict(payload: dict, key: str) -> dict:
    value = payload.get(key)
    if not isinstance(value, dict):
        raise RuntimeError(f"Groq returned an invalid `{key}` suggestion.")
    return value


def _base_system_prompt(output_key: str) -> str:
    return (
        "You are an autofill assistant for a music creation app. "
        "Return only a single valid JSON object. "
        "Do not use markdown fences. "
        "Do not add explanations. "
        f"The JSON object must contain exactly one top-level string field named `{output_key}`."
    )


def _build_create_describe_messages(context: dict):
    genre_tokens = _string_list(context.get("genreTokens"))
    lines = [
        "Generate one concise music-generation description for a song creation prompt.",
        "Write in plain production language that works as a text-to-music prompt.",
        "Focus on genre, mood, arrangement, instrumentation, rhythm, and sonic texture.",
        "Do not mention JSON in the result.",
        "",
        f"Title: {_clean_text(context.get('title')) or 'Untitled'}",
        f"Genres/Style tags: {', '.join(genre_tokens) if genre_tokens else 'None'}",
        f"BPM: {_clean_text(context.get('bpm')) or 'Unknown'}",
        f"Key: {_clean_text(context.get('keyscale')) or 'Unknown'}",
        f"Time signature: {_clean_text(context.get('timeSignature')) or 'Unknown'}",
        f"Instrumental only: {'Yes' if context.get('instrumentalOnly') else 'No'}",
        f"Persona/model hint: {_clean_text(context.get('personaName')) or 'None'}",
        "",
        "Return JSON with one field:",
        '{"describePrompt":"..."}',
    ]
    return [
        {"role": "system", "content": _base_system_prompt("describePrompt")},
        {"role": "user", "content": "\n".join(lines)},
    ]


def _build_create_lyrics_messages(context: dict):
    genre_tokens = _string_list(context.get("genreTokens"))
    lines = [
        "Write complete song lyrics for a music generation workflow.",
        "Make them singable and structured with clear verses and chorus.",
        "Avoid markdown fences or commentary.",
        "",
        f"Title: {_clean_text(context.get('title')) or 'Untitled'}",
        f"Genres/Style tags: {', '.join(genre_tokens) if genre_tokens else 'None'}",
        f"Describe prompt hint: {_clean_text(context.get('describePrompt')) or 'None'}",
        f"Instrumental only: {'Yes' if context.get('instrumentalOnly') else 'No'}",
        "",
        "Return JSON with one field:",
        '{"lyrics":"..."}',
    ]
    return [
        {"role": "system", "content": _base_system_prompt("lyrics")},
        {"role": "user", "content": "\n".join(lines)},
    ]


def _build_cover_style_messages(context: dict):
    source = context.get("sourceSong") if isinstance(context.get("sourceSong"), dict) else {}
    lines = [
        "Generate one concise cover style prompt for a voice-conversion cover workflow.",
        "Describe the target production style, genre blend, instrumentation, and mix character.",
        "Do not rewrite lyrics. Do not explain the output.",
        "",
        f"Source title: {_clean_text(source.get('title')) or _clean_text(context.get('sourceTitle')) or 'Unknown'}",
        f"Source artist: {_clean_text(source.get('artist')) or 'Unknown'}",
        f"Current style prompt: {_clean_text(context.get('stylePrompt')) or 'None'}",
        f"Preserve tempo: {'Yes' if context.get('preserveTempo') else 'No'}",
        f"Pitch shift: {_clean_text(context.get('pitchShift')) or '0'}",
        "",
        "Return JSON with one field:",
        '{"stylePrompt":"..."}',
    ]
    return [
        {"role": "system", "content": _base_system_prompt("stylePrompt")},
        {"role": "user", "content": "\n".join(lines)},
    ]


def _build_create_genre_messages(context: dict):
    genre_tokens = _string_list(context.get("genreTokens"))
    lines = [
        "Generate a short comma-separated genre and style tag list for a song creation form.",
        "Return only concise style tags, not a sentence.",
        "Prefer 3 to 6 tags.",
        "Avoid repeating the same tag with slightly different wording.",
        "",
        f"Title: {_clean_text(context.get('title')) or 'Untitled'}",
        f"Current tags: {', '.join(genre_tokens) if genre_tokens else 'None'}",
        f"Describe prompt hint: {_clean_text(context.get('describePrompt')) or 'None'}",
        f"Lyrics hint: {_clean_text(context.get('lyrics')) or 'None'}",
        f"Instrumental only: {'Yes' if context.get('instrumentalOnly') else 'No'}",
        "",
        "Return JSON with one field:",
        '{"genreText":"..."}',
    ]
    return [
        {"role": "system", "content": _base_system_prompt("genreText")},
        {"role": "user", "content": "\n".join(lines)},
    ]


def _build_studio_creation_lyrics_messages(context: dict):
    lines = [
        "Write concise, singable lyrics for a Studio generation workflow.",
        "Keep them usable as direct generation input.",
        "Prefer 8 to 16 lines with a clear hook.",
        "Avoid markdown fences or commentary.",
        "",
        f"Style of music: {_clean_text(context.get('style')) or 'Unknown'}",
        f"Current lyrics hint: {_clean_text(context.get('lyrics')) or 'None'}",
        f"Model hint: {_clean_text(context.get('model')) or 'Unknown'}",
        "",
        "Return JSON with one field:",
        '{"lyrics":"..."}',
    ]
    return [
        {"role": "system", "content": _base_system_prompt("lyrics")},
        {"role": "user", "content": "\n".join(lines)},
    ]


def _build_studio_creation_style_messages(context: dict):
    lines = [
        "Generate one concise style prompt for a Studio music generation form.",
        "Write in direct music-production language.",
        "Focus on genre blend, mood, instrumentation, groove, and sonic character.",
        "Keep it to one short phrase or sentence.",
        "",
        f"Lyrics hint: {_clean_text(context.get('lyrics')) or 'None'}",
        f"Current style: {_clean_text(context.get('style')) or 'None'}",
        f"Model hint: {_clean_text(context.get('model')) or 'Unknown'}",
        "",
        "Return JSON with one field:",
        '{"styleText":"..."}',
    ]
    return [
        {"role": "system", "content": _base_system_prompt("styleText")},
        {"role": "user", "content": "\n".join(lines)},
    ]


TASKS = {
    "create_describe_prompt": {
        "output_key": "describePrompt",
        "build_messages": _build_create_describe_messages,
        "normalize": lambda payload: {"describePrompt": _require_text(payload, "describePrompt")},
    },
    "create_lyrics": {
        "output_key": "lyrics",
        "build_messages": _build_create_lyrics_messages,
        "normalize": lambda payload: {"lyrics": _require_text(payload, "lyrics")},
    },
    "create_genre_style": {
        "output_key": "genreText",
        "build_messages": _build_create_genre_messages,
        "normalize": lambda payload: {"genreText": _require_text(payload, "genreText")},
    },
    "cover_style_prompt": {
        "output_key": "stylePrompt",
        "build_messages": _build_cover_style_messages,
        "normalize": lambda payload: {"stylePrompt": _require_text(payload, "stylePrompt")},
    },
    "studio_creation_lyrics": {
        "output_key": "lyrics",
        "build_messages": _build_studio_creation_lyrics_messages,
        "normalize": lambda payload: {"lyrics": _require_text(payload, "lyrics")},
    },
    "studio_creation_style": {
        "output_key": "styleText",
        "build_messages": _build_studio_creation_style_messages,
        "normalize": lambda payload: {"styleText": _require_text(payload, "styleText")},
    },
}


def get_supported_tasks():
    return tuple(TASKS.keys())


def request_groq_autofill(api_key: str, task: str, context: dict | None):
    normalized_task = _clean_text(task)
    if normalized_task not in TASKS:
        raise ValueError(f"Unsupported autofill task `{normalized_task}`.")

    clean_key = _clean_text(api_key)
    if not clean_key:
        raise ValueError("Set your Groq API key in Settings first.")

    task_spec = TASKS[normalized_task]
    messages = task_spec["build_messages"](context or {})

    response = requests.post(
        GROQ_AUTOFILL_URL,
        headers={
            "Authorization": f"Bearer {clean_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": DEFAULT_GROQ_MODEL,
            "temperature": 0.7,
            "max_tokens": 900,
            "response_format": {"type": "json_object"},
            "messages": messages,
        },
        timeout=45,
    )

    if response.status_code >= 400:
        try:
            payload = response.json()
        except Exception:
            payload = None
        message = (
            payload.get("error", {}).get("message")
            if isinstance(payload, dict)
            else response.text.strip()
        )
        raise RuntimeError(message or "Groq autofill request failed.")

    try:
        data = response.json()
    except Exception as exc:
        raise RuntimeError("Groq returned an invalid response payload.") from exc

    content = (
        data.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
    )
    if not _clean_text(content):
        raise RuntimeError("Groq returned an empty autofill response.")

    try:
        parsed = json.loads(_strip_markdown_fences(content))
    except JSONDecodeError as exc:
        raise RuntimeError("Groq returned invalid JSON for autofill.") from exc

    if not isinstance(parsed, dict):
        raise RuntimeError("Groq returned an invalid autofill shape.")

    suggestion = task_spec["normalize"](parsed)
    return {
        "suggestion": suggestion,
        "meta": {
            "task": normalized_task,
            "provider": "groq",
            "model": DEFAULT_GROQ_MODEL,
            "warning": None,
        },
    }
