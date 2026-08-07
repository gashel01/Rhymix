"""The orchestrator's plan: its vocabulary, and what makes a plan valid.

``orchestrate_song`` is handed a plan built by a model — global settings, a set
of roles, and sections that schedule those roles over bars. Everything in it
arrives untrusted, so it is validated once, up front, before any generation
starts. That is worth doing here rather than partway through a job: a plan that
fails on its fourth section has already spent minutes of GPU time.

:func:`normalize_orchestrator_plan` both validates and fills in defaults, so
the job downstream can index into the result without guarding every field.
"""

from backend.features.studio.project_edits import format_key_signature, get_lane_by_id

ORCHESTRATOR_FX_PRESETS = {
    "clean": {},
    "wide_pop": {
        "chorus": {"enabled": True, "rate": 0.7, "depth": 0.01, "mix": 0.22},
        "reverb": {"enabled": True, "decay": 2.2, "mix": 0.18},
    },
    "dream_wash": {
        "reverb": {"enabled": True, "decay": 5.5, "mix": 0.35},
        "chorus": {"enabled": True, "rate": 0.4, "depth": 0.018, "mix": 0.28},
        "lowpass": {"enabled": True, "cutoff": 9800},
    },
    "echo_trail": {
        "echo": {"enabled": True, "time": 0.32, "feedback": 0.38, "mix": 0.22},
        "reverb": {"enabled": True, "decay": 2.8, "mix": 0.16},
    },
    "grit_drive": {
        "distortion": {"enabled": True, "drive": 24},
        "lowpass": {"enabled": True, "cutoff": 9000},
    },
    "dark_filter": {
        "lowpass": {"enabled": True, "cutoff": 3600},
        "reverb": {"enabled": True, "decay": 2.0, "mix": 0.12},
    },
    "chorus_shimmer": {
        "chorus": {"enabled": True, "rate": 1.1, "depth": 0.014, "mix": 0.32},
        "reverb": {"enabled": True, "decay": 3.2, "mix": 0.2},
    },
}


def apply_lane_fx_preset(project_record: dict, lane_id: str, preset_name: str | None) -> None:
    lane = get_lane_by_id(project_record, lane_id)
    if not lane:
        return
    preset_key = str(preset_name or "clean").strip() or "clean"
    preset = ORCHESTRATOR_FX_PRESETS.get(preset_key, ORCHESTRATOR_FX_PRESETS["clean"])
    # Copied, so editing one lane's FX does not edit the preset itself — and
    # with it every other lane that ever used it.
    lane["fx"] = dict(preset)


def apply_orchestrator_project_settings(project_record: dict, global_plan: dict) -> None:
    project = project_record.get("project") or {}
    project["bpm"] = global_plan["bpm"]
    project["key"] = format_key_signature(global_plan["keyNote"], global_plan["scale"])
    project_record["project"] = project


def bars_to_seconds(bars: int, bpm: float) -> float:
    safe_bpm = max(40.0, float(bpm or 120.0))
    return float(bars or 0) * 4.0 * 60.0 / safe_bpm


def normalize_orchestrator_plan(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise RuntimeError("orchestrate_song payload must be an object")
    plan = payload.get("plan")
    if not isinstance(plan, dict):
        raise RuntimeError("orchestrate_song requires a `plan` object")
    global_plan = plan.get("global")
    roles = plan.get("roles")
    sections = plan.get("sections")
    if not isinstance(global_plan, dict) or not isinstance(roles, list) or not isinstance(sections, list):
        raise RuntimeError("orchestrate_song plan must include `global`, `roles`, and `sections`")

    normalized_roles = []
    role_ids = set()
    for index, role in enumerate(roles):
        if not isinstance(role, dict):
            raise RuntimeError("Invalid role in orchestrator plan")
        role_id = str(role.get("id") or f"role_{index + 1}").strip()
        if not role_id:
            raise RuntimeError("Each orchestrator role needs an id")
        if role_id in role_ids:
            raise RuntimeError(f"Duplicate orchestrator role id `{role_id}`")
        role_ids.add(role_id)
        instrument_family = str(role.get("instrumentFamily") or "").strip()
        if not instrument_family:
            raise RuntimeError(f"Role `{role_id}` is missing an instrumentFamily")
        fx_preset = str(role.get("fxPreset") or "clean").strip() or "clean"
        if fx_preset not in ORCHESTRATOR_FX_PRESETS:
            raise RuntimeError(f"Unsupported FX preset `{fx_preset}` in orchestrator plan")
        base_prompt = str(role.get("basePrompt") or "").strip()
        if not base_prompt:
            raise RuntimeError(f"Role `{role_id}` is missing a basePrompt")
        normalized_roles.append(
            {
                "id": role_id,
                "laneName": str(role.get("laneName") or instrument_family).strip() or instrument_family,
                "instrumentFamily": instrument_family,
                "basePrompt": base_prompt,
                "styleTags": str(role.get("styleTags") or "").strip(),
                "fxTags": str(role.get("fxTags") or "").strip(),
                "fxPreset": fx_preset,
            }
        )

    normalized_sections = []
    enabled_total_bars = 0
    for index, section in enumerate(sections):
        if not isinstance(section, dict):
            raise RuntimeError("Invalid section in orchestrator plan")
        bars = int(section.get("bars") or 0)
        if bars not in {4, 8}:
            raise RuntimeError("Each orchestrator section must be 4 or 8 bars")
        section_id = str(section.get("id") or f"section_{index + 1}").strip() or f"section_{index + 1}"
        steps = section.get("steps")
        if not isinstance(steps, list) or not steps:
            raise RuntimeError(f"Section `{section_id}` must include at least one step")
        normalized_steps = []
        for step_index, step in enumerate(steps):
            if not isinstance(step, dict):
                raise RuntimeError(f"Invalid step in section `{section_id}`")
            role_id = str(step.get("roleId") or "").strip()
            if role_id not in role_ids:
                raise RuntimeError(f"Section `{section_id}` references unknown role `{role_id}`")
            normalized_steps.append(
                {
                    "id": str(step.get("id") or f"{section_id}_step_{step_index + 1}").strip() or f"{section_id}_step_{step_index + 1}",
                    "roleId": role_id,
                    "enabled": False if step.get("enabled") is False else True,
                    "prompt": str(step.get("prompt") or "").strip(),
                    "styleTags": str(step.get("styleTags") or "").strip(),
                    "fxTags": str(step.get("fxTags") or "").strip(),
                }
            )
        enabled = False if section.get("enabled") is False else True
        if enabled:
            enabled_total_bars += bars
        normalized_sections.append(
            {
                "id": section_id,
                "label": str(section.get("label") or f"Section {index + 1}").strip() or f"Section {index + 1}",
                "bars": bars,
                "enabled": enabled,
                "steps": normalized_steps,
            }
        )
        if enabled and not any(step["enabled"] for step in normalized_steps):
            raise RuntimeError(f"Enabled section `{section_id}` must include at least one enabled step")

    total_bars = max(4, int(global_plan.get("totalBars") or enabled_total_bars or 16))
    if enabled_total_bars != total_bars:
        raise RuntimeError("Enabled orchestrator sections must sum exactly to the requested total bars")

    return {
        "global": {
            "bpm": max(40, min(240, int(global_plan.get("bpm") or 120))),
            "keyNote": str(global_plan.get("keyNote") or "C").strip() or "C",
            "scale": "minor" if str(global_plan.get("scale") or "major").strip().lower() == "minor" else "major",
            "totalBars": total_bars,
            "drumPrompt": str(global_plan.get("drumPrompt") or "").strip() or "Punchy modern pop drums, clean kick, crisp snare, energetic hats",
        },
        "roles": normalized_roles,
        "sections": normalized_sections,
    }
