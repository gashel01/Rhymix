import json
import os
from json import JSONDecodeError

import requests

GROQ_AUTOFILL_URL = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_GROQ_MODEL = os.getenv("GROQ_AUTOFILL_MODEL", "llama-3.1-8b-instant")
FOUNDATION_INSTRUMENT_OPTIONS = (
    "Keys",
    "Synth",
    "Strings",
    "Guitar",
    "Bass",
    "Brass",
    "Woodwinds",
    "Choir",
    "Pluck",
    "Pad",
    "FX",
)
ORCHESTRATOR_FX_PRESET_OPTIONS = (
    "clean",
    "wide_pop",
    "dream_wash",
    "echo_trail",
    "grit_drive",
    "dark_filter",
    "chorus_shimmer",
)


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


def _build_studio_foundation_generate_prompt_messages(context: dict):
    lines = [
        "Generate one concise Foundation-1 prompt field for loop generation.",
        "Use Foundation-1 style layered tags, not a natural-language sentence.",
        "Return a short comma-separated tag string built around:",
        "1. instrument identity or sub-family",
        "2. one musical behavior or notation term",
        "3. optionally one role descriptor",
        "Do not include BPM, bars, key, or FX tags because those are controlled separately.",
        "Do not repeat the instrument family if it is already obvious from the sub-family.",
        "Good prompt field examples: `Synth Lead, Arp, Rising` or `Grand Piano, Chord Progression, Sustained`.",
        "",
        f"Bars: {_clean_text(context.get('bars')) or 'Unknown'}",
        f"BPM: {_clean_text(context.get('bpm')) or 'Unknown'}",
        f"Key: {_clean_text(context.get('key')) or 'Unknown'}",
        f"Instrument family: {_clean_text(context.get('instrumentFamily')) or 'Unknown'}",
        f"Current style tags: {_clean_text(context.get('styleTags')) or 'None'}",
        f"Current FX tags: {_clean_text(context.get('fxTags')) or 'None'}",
        f"Current prompt: {_clean_text(context.get('prompt')) or 'None'}",
        "",
        "Return JSON with one field:",
        '{"prompt":"..."}',
    ]
    return [
        {"role": "system", "content": _base_system_prompt("prompt")},
        {"role": "user", "content": "\n".join(lines)},
    ]


def _build_studio_foundation_restyle_prompt_messages(context: dict):
    lines = [
        "Generate one concise Foundation-1 prompt field for restyling an existing source.",
        "Use Foundation-1 style layered tags, not a natural-language sentence.",
        "Assume the source timing and loop length already exist; the goal is to steer instrument identity and phrase behavior.",
        "Return a short comma-separated tag string built around instrument identity plus musical behavior.",
        "Do not include BPM, bars, key, or FX tags because those are controlled separately.",
        "Good prompt field examples: `Wavetable Bass, Bassline, Triplets` or `Choir, Top Melody, Epic`.",
        "",
        f"Mode: {_clean_text(context.get('mode')) or 'restyle'}",
        f"Bars: {_clean_text(context.get('bars')) or 'Unknown'}",
        f"BPM: {_clean_text(context.get('bpm')) or 'Unknown'}",
        f"Key: {_clean_text(context.get('key')) or 'Unknown'}",
        f"Instrument family: {_clean_text(context.get('instrumentFamily')) or 'Unknown'}",
        f"Source summary: {_clean_text(context.get('sourceSummary')) or 'Unknown source'}",
        f"Current style tags: {_clean_text(context.get('styleTags')) or 'None'}",
        f"Current FX tags: {_clean_text(context.get('fxTags')) or 'None'}",
        f"Current prompt: {_clean_text(context.get('prompt')) or 'None'}",
        "",
        "Return JSON with one field:",
        '{"prompt":"..."}',
    ]
    return [
        {"role": "system", "content": _base_system_prompt("prompt")},
        {"role": "user", "content": "\n".join(lines)},
    ]


def _build_studio_foundation_style_tags_messages(context: dict):
    lines = [
        "Generate concise Foundation-1 timbre tags for a Foundation-1 loop or restyle job.",
        "Return only comma-separated timbre descriptors from Foundation-1 style vocabulary.",
        "Prefer 3 to 6 tags.",
        "Use timbre and texture terms such as Warm, Bright, Wide, Airy, Thick, Rich, Tight, Full, Gritty, Clean, Retro, Crisp, Focused, Metallic, Dark, Shiny, Analog, Sparkly, Ambient, Smooth, Deep, Punchy, Dreamy.",
        "Do not return genres, BPM, bars, key, or FX terms.",
        "",
        f"Mode: {_clean_text(context.get('mode')) or 'generate'}",
        f"Prompt hint: {_clean_text(context.get('prompt')) or 'None'}",
        f"Bars: {_clean_text(context.get('bars')) or 'Unknown'}",
        f"BPM: {_clean_text(context.get('bpm')) or 'Unknown'}",
        f"Key: {_clean_text(context.get('key')) or 'Unknown'}",
        f"Instrument family: {_clean_text(context.get('instrumentFamily')) or 'Unknown'}",
        f"Current style tags: {_clean_text(context.get('styleTags')) or 'None'}",
        "",
        "Return JSON with one field:",
        '{"styleTags":"..."}',
    ]
    return [
        {"role": "system", "content": _base_system_prompt("styleTags")},
        {"role": "user", "content": "\n".join(lines)},
    ]


def _build_studio_foundation_fx_tags_messages(context: dict):
    lines = [
        "Generate concise Foundation-1 FX tags for a loop or restyle job.",
        "Return only comma-separated FX descriptors from Foundation-1 style vocabulary.",
        "Prefer 1 to 4 tags.",
        "Use tags like Low Reverb, Medium Reverb, High Reverb, Plate Reverb, Low Delay, Medium Delay, High Delay, Ping Pong Delay, Stereo Delay, Mono Delay, Low Distortion, Medium Distortion, High Distortion, Phaser, Low Phaser, Medium Phaser, High Phaser, Bitcrush, High Bitcrush, Dry, Wet.",
        "Do not return timbre tags, genres, BPM, bars, or key terms.",
        "",
        f"Mode: {_clean_text(context.get('mode')) or 'generate'}",
        f"Prompt hint: {_clean_text(context.get('prompt')) or 'None'}",
        f"Instrument family: {_clean_text(context.get('instrumentFamily')) or 'Unknown'}",
        f"Current style tags: {_clean_text(context.get('styleTags')) or 'None'}",
        f"Current FX tags: {_clean_text(context.get('fxTags')) or 'None'}",
        "",
        "Return JSON with one field:",
        '{"fxTags":"..."}',
    ]
    return [
        {"role": "system", "content": _base_system_prompt("fxTags")},
        {"role": "user", "content": "\n".join(lines)},
    ]


def _build_studio_stage_drums_prompt_messages(context: dict):
    lines = [
        "Generate one concise drum-generation description for an audio-conditioned drum stem model.",
        "Write one short production-oriented phrase or sentence describing the target drums.",
        "Focus on groove feel, punch, kit character, energy, and mix texture.",
        "Do not mention BPM numbers unless necessary. Do not mention stems, JSON, or instructions.",
        "",
        f"Source summary: {_clean_text(context.get('sourceSummary')) or 'Selected melodic source'}",
        f"BPM: {_clean_text(context.get('bpm')) or 'Unknown'}",
        f"Current description: {_clean_text(context.get('prompt')) or 'None'}",
        "",
        "Return JSON with one field:",
        '{"prompt":"..."}',
    ]
    return [
        {"role": "system", "content": _base_system_prompt("prompt")},
        {"role": "user", "content": "\n".join(lines)},
    ]


def _build_studio_orchestrator_plan_messages(context: dict):
    total_bars = max(4, int(context.get("totalBars") or 16))
    instruments = _string_list(context.get("supportedInstruments")) or list(FOUNDATION_INSTRUMENT_OPTIONS)
    fx_presets = _string_list(context.get("supportedFxPresets")) or list(ORCHESTRATOR_FX_PRESET_OPTIONS)
    lines = [
        "Plan a Studio song arrangement for Rhymix using only existing tools.",
        "You are not generating audio. You are generating a song plan JSON that Rhymix will execute.",
        "Use Foundation-1 for all non-drum musical roles.",
        "Drums are generated separately and last, so do not include a drum lane in roles.",
        "Return section lengths using only 4 or 8 bars.",
        "The enabled section bars must sum exactly to the requested total bars.",
        "Use only supported instrument families and FX presets from the provided lists.",
        "Keep prompts concise and aligned with Foundation-1 tag-style prompting.",
        "Style and FX tags should be concise comma-separated strings.",
        "Each section should contain one or more role steps.",
        "",
        f"User song prompt: {_clean_text(context.get('prompt')) or 'Untitled song'}",
        f"Requested total bars: {total_bars}",
        f"Supported Foundation instruments: {', '.join(instruments)}",
        f"Supported FX presets: {', '.join(fx_presets)}",
        "",
        "Return JSON in this shape only:",
        '{'
        '"plan":{'
        '"global":{"bpm":118,"keyNote":"C","scale":"major","totalBars":16,"drumPrompt":"..."},'
        '"roles":[{"id":"bass","laneName":"Bass","instrumentFamily":"Bass","basePrompt":"Electric Bass, Bassline, Warm","styleTags":"Warm, Punchy","fxTags":"Dry","fxPreset":"clean"}],'
        '"sections":[{"id":"intro","label":"Intro","bars":4,"enabled":true,"steps":[{"id":"intro-bass","roleId":"bass","enabled":true,"prompt":"Electric Bass, Bassline, Sparse","styleTags":"Warm, Focused","fxTags":"Dry"}]}]'
        '}'
        '}',
    ]
    system_prompt = (
        "You are an autofill assistant for a music creation app. "
        "Return only one valid JSON object with a top-level `plan` object. "
        "Do not use markdown fences. Do not add explanations."
    )
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": "\n".join(lines)},
    ]


def _normalize_orchestrator_plan(payload: dict):
    plan = _require_dict(payload, "plan")
    global_payload = _require_dict(plan, "global")
    roles = _require_list(plan, "roles")
    sections = _require_list(plan, "sections")

    def clean_role(item, index):
        if not isinstance(item, dict):
            raise RuntimeError("Groq returned an invalid `roles` entry.")
        instrument = _clean_text(item.get("instrumentFamily"))
        if instrument not in FOUNDATION_INSTRUMENT_OPTIONS:
            raise RuntimeError(f"Unsupported Foundation instrument `{instrument}` in orchestrator plan.")
        fx_preset = _clean_text(item.get("fxPreset")) or "clean"
        if fx_preset not in ORCHESTRATOR_FX_PRESET_OPTIONS:
            raise RuntimeError(f"Unsupported FX preset `{fx_preset}` in orchestrator plan.")
        role_id = _clean_text(item.get("id")) or f"role_{index + 1}"
        lane_name = _clean_text(item.get("laneName")) or instrument
        base_prompt = _clean_text(item.get("basePrompt"))
        if not base_prompt:
            raise RuntimeError("Each orchestrator role needs a `basePrompt`.")
        return {
            "id": role_id,
            "laneName": lane_name,
            "instrumentFamily": instrument,
            "basePrompt": base_prompt,
            "styleTags": _clean_text(item.get("styleTags")),
            "fxTags": _clean_text(item.get("fxTags")),
            "fxPreset": fx_preset,
        }

    normalized_roles = [clean_role(role, index) for index, role in enumerate(roles)]
    role_ids = {role["id"] for role in normalized_roles}

    def clean_step(item, section_id, index):
        if not isinstance(item, dict):
            raise RuntimeError("Groq returned an invalid orchestrator section step.")
        role_id = _clean_text(item.get("roleId"))
        if role_id not in role_ids:
            raise RuntimeError(f"Orchestrator step references unknown role `{role_id}`.")
        return {
            "id": _clean_text(item.get("id")) or f"{section_id}_step_{index + 1}",
            "roleId": role_id,
            "enabled": False if item.get("enabled") is False else True,
            "prompt": _clean_text(item.get("prompt")),
            "styleTags": _clean_text(item.get("styleTags")),
            "fxTags": _clean_text(item.get("fxTags")),
        }

    normalized_sections = []
    for index, section in enumerate(sections):
        if not isinstance(section, dict):
            raise RuntimeError("Groq returned an invalid `sections` entry.")
        bars = int(section.get("bars") or 0)
        if bars not in {4, 8}:
            raise RuntimeError("Each orchestrator section must be 4 or 8 bars.")
        section_id = _clean_text(section.get("id")) or f"section_{index + 1}"
        steps = [clean_step(step, section_id, step_index) for step_index, step in enumerate(_require_list(section, "steps"))]
        if not steps:
            raise RuntimeError("Each orchestrator section needs at least one step.")
        normalized_sections.append(
            {
                "id": section_id,
                "label": _clean_text(section.get("label")) or f"Section {index + 1}",
                "bars": bars,
                "enabled": False if section.get("enabled") is False else True,
                "steps": steps,
            }
        )

    key_note = _clean_text(global_payload.get("keyNote")) or "C"
    scale = (_clean_text(global_payload.get("scale")) or "major").lower()
    if scale not in {"major", "minor"}:
        scale = "major"
    total_bars = max(4, int(global_payload.get("totalBars") or sum(section["bars"] for section in normalized_sections if section["enabled"]) or 16))

    return {
        "plan": {
            "global": {
                "bpm": max(40, min(240, int(global_payload.get("bpm") or 120))),
                "keyNote": key_note,
                "scale": scale,
                "totalBars": total_bars,
                "drumPrompt": _clean_text(global_payload.get("drumPrompt")) or "Punchy modern pop drums, clean kick, crisp snare, energetic hats",
            },
            "roles": normalized_roles,
            "sections": normalized_sections,
        }
    }


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
    "studio_foundation_generate_prompt": {
        "output_key": "prompt",
        "build_messages": _build_studio_foundation_generate_prompt_messages,
        "normalize": lambda payload: {"prompt": _require_text(payload, "prompt")},
    },
    "studio_foundation_restyle_prompt": {
        "output_key": "prompt",
        "build_messages": _build_studio_foundation_restyle_prompt_messages,
        "normalize": lambda payload: {"prompt": _require_text(payload, "prompt")},
    },
    "studio_foundation_style_tags": {
        "output_key": "styleTags",
        "build_messages": _build_studio_foundation_style_tags_messages,
        "normalize": lambda payload: {"styleTags": _require_text(payload, "styleTags")},
    },
    "studio_foundation_fx_tags": {
        "output_key": "fxTags",
        "build_messages": _build_studio_foundation_fx_tags_messages,
        "normalize": lambda payload: {"fxTags": _require_text(payload, "fxTags")},
    },
    "studio_stage_drums_prompt": {
        "output_key": "prompt",
        "build_messages": _build_studio_stage_drums_prompt_messages,
        "normalize": lambda payload: {"prompt": _require_text(payload, "prompt")},
    },
    "studio_orchestrator_plan": {
        "output_key": "plan",
        "build_messages": _build_studio_orchestrator_plan_messages,
        "normalize": _normalize_orchestrator_plan,
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
