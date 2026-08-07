"""Tests for the orchestrator plan validator.

The plan arrives from a model, so every field is untrusted. Validating it up
front is what keeps a bad plan from failing on its fourth section, minutes of
GPU time in.
"""

import pytest

from backend.features.studio.orchestrator_plan import (
    ORCHESTRATOR_FX_PRESETS,
    apply_lane_fx_preset,
    apply_orchestrator_project_settings,
    bars_to_seconds,
    normalize_orchestrator_plan,
)
from backend.features.studio.project_edits import create_lane


def plan(**over):
    base = {
        "global": {"bpm": 120, "keyNote": "C", "scale": "major", "totalBars": 8},
        "roles": [
            {"id": "keys", "instrumentFamily": "Keys", "basePrompt": "warm rhodes"},
        ],
        "sections": [
            {"id": "s1", "bars": 8, "steps": [{"roleId": "keys"}]},
        ],
    }
    base.update(over)
    return {"plan": base}


class TestBarsToSeconds:
    def test_four_four_at_120(self):
        assert bars_to_seconds(1, 120) == pytest.approx(2.0)
        assert bars_to_seconds(8, 120) == pytest.approx(16.0)

    def test_slower_tempo_means_longer_bars(self):
        assert bars_to_seconds(1, 60) == pytest.approx(4.0)

    def test_clamps_an_absurd_tempo_rather_than_returning_an_hour(self):
        assert bars_to_seconds(1, 1) == bars_to_seconds(1, 40)

    def test_no_bars_is_no_time(self):
        assert bars_to_seconds(0, 120) == 0.0


class TestAcceptedPlan:
    def test_returns_the_three_sections_of_the_plan(self):
        result = normalize_orchestrator_plan(plan())
        assert set(result) == {"global", "roles", "sections"}

    def test_fills_in_a_lane_name_from_the_instrument(self):
        assert normalize_orchestrator_plan(plan())["roles"][0]["laneName"] == "Keys"

    def test_defaults_the_fx_preset_to_clean(self):
        assert normalize_orchestrator_plan(plan())["roles"][0]["fxPreset"] == "clean"

    def test_steps_are_enabled_unless_explicitly_switched_off(self):
        result = normalize_orchestrator_plan(plan())
        assert result["sections"][0]["steps"][0]["enabled"] is True

    def test_gives_ids_to_roles_sections_and_steps_that_have_none(self):
        bare = plan(
            roles=[{"instrumentFamily": "Keys", "basePrompt": "p"}],
            sections=[{"bars": 8, "steps": [{"roleId": "role_1"}]}],
        )
        result = normalize_orchestrator_plan(bare)
        assert result["roles"][0]["id"] == "role_1"
        assert result["sections"][0]["id"] == "section_1"
        assert result["sections"][0]["steps"][0]["id"] == "section_1_step_1"

    def test_clamps_the_tempo_to_something_playable(self):
        assert normalize_orchestrator_plan(plan(
            **{"global": {"bpm": 900, "totalBars": 8}}))["global"]["bpm"] == 240
        assert normalize_orchestrator_plan(plan(
            **{"global": {"bpm": 3, "totalBars": 8}}))["global"]["bpm"] == 40

    def test_any_scale_that_is_not_minor_is_major(self):
        assert normalize_orchestrator_plan(plan(
            **{"global": {"totalBars": 8, "scale": "MINOR"}}))["global"]["scale"] == "minor"
        assert normalize_orchestrator_plan(plan(
            **{"global": {"totalBars": 8, "scale": "dorian"}}))["global"]["scale"] == "major"

    def test_supplies_a_drum_prompt_when_the_plan_gives_none(self):
        assert normalize_orchestrator_plan(plan())["global"]["drumPrompt"]

    def test_infers_the_total_from_the_enabled_sections(self):
        no_total = plan(
            **{"global": {"bpm": 120}},
            sections=[
                {"id": "s1", "bars": 8, "steps": [{"roleId": "keys"}]},
                {"id": "s2", "bars": 4, "steps": [{"roleId": "keys"}]},
            ],
        )
        assert normalize_orchestrator_plan(no_total)["global"]["totalBars"] == 12

    def test_a_disabled_section_does_not_count_towards_the_total(self):
        mixed = plan(
            **{"global": {"totalBars": 8}},
            sections=[
                {"id": "s1", "bars": 8, "steps": [{"roleId": "keys"}]},
                {"id": "s2", "bars": 4, "enabled": False, "steps": [{"roleId": "keys"}]},
            ],
        )
        result = normalize_orchestrator_plan(mixed)
        assert result["global"]["totalBars"] == 8
        assert len(result["sections"]) == 2


class TestRejectedPlan:
    @pytest.mark.parametrize("payload", [None, "text", 42, {}, {"plan": "text"}],
                             ids=["none", "string", "number", "no-plan", "plan-not-object"])
    def test_rejects_something_that_is_not_a_plan(self, payload):
        with pytest.raises(RuntimeError):
            normalize_orchestrator_plan(payload)

    def test_rejects_a_plan_missing_a_top_level_part(self):
        for key in ("global", "roles", "sections"):
            body = plan()["plan"]
            del body[key]
            with pytest.raises(RuntimeError, match="must include"):
                normalize_orchestrator_plan({"plan": body})

    def test_rejects_duplicate_role_ids(self):
        dupes = plan(roles=[
            {"id": "keys", "instrumentFamily": "Keys", "basePrompt": "a"},
            {"id": "keys", "instrumentFamily": "Pad", "basePrompt": "b"},
        ])
        with pytest.raises(RuntimeError, match="Duplicate"):
            normalize_orchestrator_plan(dupes)

    def test_rejects_a_role_with_no_instrument(self):
        with pytest.raises(RuntimeError, match="instrumentFamily"):
            normalize_orchestrator_plan(plan(roles=[{"id": "keys", "basePrompt": "p"}]))

    def test_rejects_a_role_with_no_prompt(self):
        with pytest.raises(RuntimeError, match="basePrompt"):
            normalize_orchestrator_plan(plan(roles=[{"id": "k", "instrumentFamily": "Keys"}]))

    def test_rejects_an_fx_preset_the_renderer_does_not_have(self):
        bad = plan(roles=[
            {"id": "k", "instrumentFamily": "Keys", "basePrompt": "p", "fxPreset": "cathedral"},
        ])
        with pytest.raises(RuntimeError, match="Unsupported FX preset"):
            normalize_orchestrator_plan(bad)

    @pytest.mark.parametrize("bars", [0, 3, 6, 16])
    def test_rejects_a_section_that_is_not_four_or_eight_bars(self, bars):
        with pytest.raises(RuntimeError, match="4 or 8 bars"):
            normalize_orchestrator_plan(plan(
                sections=[{"id": "s1", "bars": bars, "steps": [{"roleId": "keys"}]}]))

    def test_rejects_a_section_with_no_steps(self):
        with pytest.raises(RuntimeError, match="at least one step"):
            normalize_orchestrator_plan(plan(sections=[{"id": "s1", "bars": 8, "steps": []}]))

    def test_rejects_a_step_pointing_at_a_role_that_does_not_exist(self):
        with pytest.raises(RuntimeError, match="unknown role"):
            normalize_orchestrator_plan(plan(
                sections=[{"id": "s1", "bars": 8, "steps": [{"roleId": "bass"}]}]))

    def test_rejects_an_enabled_section_whose_every_step_is_off(self):
        with pytest.raises(RuntimeError, match="at least one enabled step"):
            normalize_orchestrator_plan(plan(sections=[
                {"id": "s1", "bars": 8, "steps": [{"roleId": "keys", "enabled": False}]},
            ]))

    def test_rejects_sections_that_do_not_sum_to_the_requested_total(self):
        # Silently padding or truncating here would produce a song a different
        # length from the one the plan describes.
        with pytest.raises(RuntimeError, match="sum exactly"):
            normalize_orchestrator_plan(plan(**{"global": {"totalBars": 16}}))


class TestApplyToProject:
    def test_writes_tempo_and_key_onto_the_project(self):
        record = {"project": {"id": "p1"}}
        apply_orchestrator_project_settings(record, {"bpm": 90, "keyNote": "F#", "scale": "minor"})
        assert record["project"]["bpm"] == 90
        assert record["project"]["key"] == "F# minor"

    def test_applies_a_named_preset_to_a_lane(self):
        record = {"project": {"id": "p1"}, "lanes": []}
        lane = create_lane(record, "generated", "Keys")
        apply_lane_fx_preset(record, lane["id"], "wide_pop")
        assert lane["fx"] == ORCHESTRATOR_FX_PRESETS["wide_pop"]

    def test_an_unknown_preset_falls_back_to_clean_rather_than_failing(self):
        record = {"project": {"id": "p1"}, "lanes": []}
        lane = create_lane(record, "generated", "Keys")
        apply_lane_fx_preset(record, lane["id"], "cathedral")
        assert lane["fx"] == {}

    def test_copies_the_preset_so_editing_a_lane_does_not_edit_the_preset(self):
        record = {"project": {"id": "p1"}, "lanes": []}
        lane = create_lane(record, "generated", "Keys")
        apply_lane_fx_preset(record, lane["id"], "wide_pop")
        lane["fx"]["reverb"] = {"enabled": False}
        assert ORCHESTRATOR_FX_PRESETS["wide_pop"]["reverb"]["enabled"] is True

    def test_does_nothing_for_a_lane_that_is_not_there(self):
        record = {"project": {"id": "p1"}, "lanes": []}
        apply_lane_fx_preset(record, "nope", "wide_pop")  # must not raise
