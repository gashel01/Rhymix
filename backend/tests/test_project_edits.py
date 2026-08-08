"""Tests for the project-record edits studio jobs make.

Nothing here touches storage, ffmpeg, or an adapter — the point of pulling
these out of jobs.py was that they can now run in milliseconds.
"""

import pytest

from backend.features.studio.project_edits import (
    append_clip,
    append_midi_clip,
    clip_length_sec,
    clip_timeline_end,
    create_lane,
    ensure_lane,
    format_key_signature,
    get_lane_by_id,
    register_asset,
    ticks_to_sec,
    update_project_duration,
)


@pytest.fixture
def record():
    return {
        "project": {"id": "p1", "bpm": 120},
        "lanes": [],
        "clips": [],
        "assets": {},
    }


class TestClipGeometry:
    def test_length_is_the_trimmed_span(self):
        assert clip_length_sec({"srcStartSec": 2.0, "srcEndSec": 6.0}) == 4.0

    def test_length_is_never_zero(self):
        # A clip with no length would disappear from the timeline while still
        # occupying a row in the record.
        assert clip_length_sec({"srcStartSec": 3.0, "srcEndSec": 3.0}) == 0.01
        assert clip_length_sec({}) == 0.01

    def test_end_accounts_for_the_trim(self):
        # This is the whole point: srcEndSec is an offset into the source, not
        # a length. A clip trimmed 2s into its source and placed at 10s ends at
        # 14s, not at 16s.
        clip = {"timelineStartSec": 10.0, "srcStartSec": 2.0, "srcEndSec": 6.0}
        assert clip_timeline_end(clip) == 14.0

    def test_end_matches_the_naive_form_only_when_untrimmed(self):
        clip = {"timelineStartSec": 10.0, "srcStartSec": 0.0, "srcEndSec": 6.0}
        assert clip_timeline_end(clip) == 16.0


class TestFormatKeySignature:
    def test_pairs_note_and_mode(self):
        assert format_key_signature("F#", "minor") == "F# minor"

    def test_defaults_to_c_major(self):
        assert format_key_signature(None, None) == "C major"
        assert format_key_signature("  ", "") == "C major"

    def test_falls_back_to_major_for_a_mode_it_does_not_know(self):
        assert format_key_signature("D", "dorian") == "D major"

    def test_lowercases_the_mode_but_leaves_the_note_alone(self):
        assert format_key_signature("Bb", "MINOR") == "Bb minor"


class TestTicksToSec:
    def test_converts_at_the_given_tempo(self):
        # One bar of 4/4 at 120bpm is 2s; at 480 ppq that is 1920 ticks.
        assert ticks_to_sec(1920, 120, 480) == pytest.approx(2.0)

    def test_halving_the_tempo_doubles_the_time(self):
        assert ticks_to_sec(1920, 60, 480) == pytest.approx(4.0)

    def test_assumes_120bpm_and_480ppq_when_not_told(self):
        assert ticks_to_sec(1920, None, None) == pytest.approx(2.0)

    def test_returns_zero_rather_than_dividing_by_zero(self):
        assert ticks_to_sec(1920, 0, 0) == pytest.approx(2.0)  # 0 falls back to the defaults
        assert ticks_to_sec(1920, -120, 480) == 0.0


class TestLanes:
    def test_ensure_lane_creates_then_reuses(self, record):
        first = ensure_lane(record, "vocal", "Vocals")
        second = ensure_lane(record, "vocal", "Something Else")
        assert first is second
        assert len(record["lanes"]) == 1

    def test_ensure_lane_matches_on_type_not_name(self, record):
        ensure_lane(record, "vocal", "Vocals")
        ensure_lane(record, "stem", "Drums")
        assert [lane["type"] for lane in record["lanes"]] == ["vocal", "stem"]

    def test_create_lane_always_adds_one(self, record):
        create_lane(record, "stem", "Drums")
        create_lane(record, "stem", "Bass")
        assert len(record["lanes"]) == 2
        assert record["lanes"][0]["id"] != record["lanes"][1]["id"]

    def test_new_lanes_are_ordered_after_the_existing_ones(self, record):
        create_lane(record, "stem", "Drums")
        create_lane(record, "stem", "Bass")
        assert [lane["order"] for lane in record["lanes"]] == [1, 2]

    def test_a_lane_can_be_created_muted(self, record):
        assert create_lane(record, "stem", "Drums", muted=True)["mute"] is True
        assert create_lane(record, "stem", "Bass")["mute"] is False

    def test_get_lane_by_id(self, record):
        lane = create_lane(record, "stem", "Drums")
        assert get_lane_by_id(record, lane["id"]) is lane
        assert get_lane_by_id(record, "nope") is None
        assert get_lane_by_id(record, None) is None

    def test_works_on_a_record_with_no_lanes_key(self):
        bare = {"project": {"id": "p1"}}
        create_lane(bare, "stem", "Drums")
        assert len(bare["lanes"]) == 1


class TestAppendClip:
    def test_places_the_clip_and_gives_it_the_asset_length(self, record):
        lane = create_lane(record, "stem", "Drums")
        clip = append_clip(record, lane["id"], "asset-1", 5.0, 30.0)
        assert clip["timelineStartSec"] == 5.0
        assert clip["srcStartSec"] == 0.0
        assert clip["srcEndSec"] == 30.0
        assert clip_timeline_end(clip) == 35.0

    def test_never_starts_before_zero_or_lasts_no_time(self, record):
        clip = append_clip(record, "lane-1", "asset-1", -5.0, 0.0)
        assert clip["timelineStartSec"] == 0.0
        assert clip["srcEndSec"] == 0.01

    def test_treats_a_missing_length_as_none_rather_than_failing(self, record):
        assert append_clip(record, "lane-1", "asset-1", None, None)["srcEndSec"] == 0.01


class TestAppendMidiClip:
    def test_length_comes_from_the_last_note(self, record):
        lane = create_lane(record, "midi", "Keys")
        midi = {"ppq": 480, "bpm": 120, "notes": [
            {"startTick": 0, "durationTick": 480},
            {"startTick": 960, "durationTick": 960},
        ]}
        clip = append_midi_clip(record, lane["id"], midi, 0.0)
        # last note ends at tick 1920 = one 4/4 bar at 120bpm = 2s
        assert clip["srcEndSec"] == pytest.approx(2.0)
        assert clip["clipType"] == "midi"
        assert clip["sourceAssetId"] is None

    def test_falls_back_to_the_project_tempo(self, record):
        record["project"]["bpm"] = 60
        midi = {"ppq": 480, "notes": [{"startTick": 0, "durationTick": 1920}]}
        assert append_midi_clip(record, "l", midi, 0.0)["srcEndSec"] == pytest.approx(4.0)

    def test_an_empty_clip_still_has_a_length(self, record):
        assert append_midi_clip(record, "l", {"notes": []}, 0.0)["srcEndSec"] == 0.01

    def test_ignores_junk_in_the_note_list(self, record):
        midi = {"ppq": 480, "bpm": 120, "notes": [None, "x", {"startTick": 0, "durationTick": 1920}]}
        assert append_midi_clip(record, "l", midi, 0.0)["srcEndSec"] == pytest.approx(2.0)

    def test_labels_the_clip_with_its_instrument(self, record):
        assert append_midi_clip(record, "l", {"instrument": "Rhodes"}, 0.0)["label"] == "Rhodes"
        assert append_midi_clip(record, "l", {}, 0.0)["label"] == "MIDI Clip"


class TestUpdateProjectDuration:
    def test_takes_the_furthest_clip_end(self, record):
        append_clip(record, "l", "a", 0.0, 10.0)
        append_clip(record, "l", "b", 30.0, 5.0)
        assert update_project_duration(record) == 35.0
        assert record["project"]["durationSec"] == 35.0

    def test_does_not_overstate_a_trimmed_clip(self, record):
        # The bug this replaces: duration was timelineStartSec + srcEndSec, so
        # a clip trimmed 100s into a long source reported a project a hundred
        # seconds longer than the music. The frontend takes the max of the
        # stored duration and its own correct sum, so it could never shrink
        # back — the ruler and the export tail stayed wrong.
        record["clips"] = [{"timelineStartSec": 0.0, "srcStartSec": 100.0, "srcEndSec": 110.0}]
        assert update_project_duration(record) == 10.0

    def test_an_empty_project_has_no_duration(self, record):
        assert update_project_duration(record) == 0.0

    def test_stamps_the_project_as_updated(self, record):
        update_project_duration(record)
        assert record["project"]["updatedAt"]


class TestRegisterAsset:
    def test_keys_the_asset_by_its_id(self, record):
        assert register_asset(record, {"id": "a1", "label": "Vocals"}) == "a1"
        assert record["assets"]["a1"]["label"] == "Vocals"

    def test_re_registering_replaces(self, record):
        register_asset(record, {"id": "a1", "label": "Old"})
        register_asset(record, {"id": "a1", "label": "New"})
        assert record["assets"]["a1"]["label"] == "New"
        assert len(record["assets"]) == 1
