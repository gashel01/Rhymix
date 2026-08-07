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
    replace_clip_segment,
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


class TestReplaceClipSegment:
    """The one edit in the module that is not an append.

    Note: nothing in the app calls this yet — see the function's docstring.
    """

    @pytest.fixture
    def with_clip(self, record):
        record["clips"] = [{
            "id": "c1",
            "laneId": "lane-1",
            "sourceAssetId": "asset-1",
            "srcStartSec": 0.0,
            "srcEndSec": 30.0,
            "timelineStartSec": 0.0,
            "fadeInSec": 0.5,
            "fadeOutSec": 0.25,
            "gainDb": -3.0,
        }]
        return record

    def test_splits_into_head_replacement_and_tail(self, with_clip):
        assert replace_clip_segment(with_clip, {"clipId": "c1", "startSec": 10, "endSec": 20}, "new", 10.0)
        clips = sorted(with_clip["clips"], key=lambda c: c["timelineStartSec"])
        assert len(clips) == 3
        head, middle, tail = clips
        assert (head["srcStartSec"], head["srcEndSec"]) == (0.0, 10.0)
        assert middle["sourceAssetId"] == "new"
        assert (tail["srcStartSec"], tail["srcEndSec"]) == (20.0, 30.0)
        assert tail["timelineStartSec"] == 20.0

    def test_the_fragments_stay_on_the_same_lane_with_the_same_gain(self, with_clip):
        replace_clip_segment(with_clip, {"clipId": "c1", "startSec": 10, "endSec": 20}, "new", 10.0)
        for clip in with_clip["clips"]:
            assert clip["laneId"] == "lane-1"
            assert clip["gainDb"] == -3.0

    def test_every_fragment_gets_its_own_id(self, with_clip):
        replace_clip_segment(with_clip, {"clipId": "c1", "startSec": 10, "endSec": 20}, "new", 10.0)
        ids = [clip["id"] for clip in with_clip["clips"]]
        assert len(set(ids)) == 3
        assert "c1" not in ids

    def test_replacing_the_head_leaves_no_empty_fragment(self, with_clip):
        # A startSec of 0 used to be read as "no start" by an `or`, so this
        # returned False and changed nothing.
        assert replace_clip_segment(with_clip, {"clipId": "c1", "startSec": 0, "endSec": 10}, "new", 10.0)
        assert len(with_clip["clips"]) == 2

    def test_replacing_the_whole_clip_leaves_only_the_replacement(self, with_clip):
        assert replace_clip_segment(with_clip, {"clipId": "c1", "startSec": 0, "endSec": 30}, "new", 30.0)
        assert len(with_clip["clips"]) == 1
        assert with_clip["clips"][0]["sourceAssetId"] == "new"

    def test_a_zero_start_is_still_preferred_over_the_timeline_start(self, with_clip):
        # Both keys present: startSec wins even at 0, which is the case the
        # `or` got backwards.
        payload = {"clipId": "c1", "startSec": 0, "timelineStartSec": 25, "endSec": 10}
        assert replace_clip_segment(with_clip, payload, "new", 10.0)
        starts = sorted(clip["timelineStartSec"] for clip in with_clip["clips"])
        assert starts == [0.0, 10.0]

    def test_finds_the_clip_by_the_range_when_none_is_named(self, with_clip):
        assert replace_clip_segment(with_clip, {"startSec": 10, "endSec": 20}, "new", 10.0)
        assert len(with_clip["clips"]) == 3

    def test_matches_by_source_asset_when_given_one(self, with_clip):
        payload = {"startSec": 10, "endSec": 20, "sourceAssetId": "other"}
        assert replace_clip_segment(with_clip, payload, "new", 10.0) is False
        assert len(with_clip["clips"]) == 1

    def test_accepts_timeline_start_as_the_range_start(self, with_clip):
        assert replace_clip_segment(with_clip, {"timelineStartSec": 10, "endSec": 20}, "new", 10.0)

    @pytest.mark.parametrize("payload", [
        None,
        "not a dict",
        {"startSec": 10},
        {"endSec": 20},
        {"startSec": 20, "endSec": 10},
        {"startSec": 10, "endSec": 10},
        {"startSec": "abc", "endSec": 20},
    ], ids=["none", "string", "no-end", "no-start", "backwards", "empty", "junk"])
    def test_refuses_a_range_it_cannot_use(self, with_clip, payload):
        assert replace_clip_segment(with_clip, payload, "new", 10.0) is False
        assert len(with_clip["clips"]) == 1

    def test_refuses_when_no_clip_covers_the_range(self, with_clip):
        assert replace_clip_segment(with_clip, {"startSec": 100, "endSec": 110}, "new", 10.0) is False
        assert len(with_clip["clips"]) == 1

    def test_refuses_a_range_that_only_partly_overlaps(self, with_clip):
        # Half in, half past the end: splitting on it would silently drop the
        # part of the range that has no audio behind it.
        assert replace_clip_segment(with_clip, {"startSec": 25, "endSec": 40}, "new", 15.0) is False

    def test_works_on_a_clip_that_is_already_trimmed(self, record):
        record["clips"] = [{
            "id": "c1", "laneId": "l", "sourceAssetId": "a",
            "srcStartSec": 100.0, "srcEndSec": 130.0, "timelineStartSec": 0.0,
        }]
        assert replace_clip_segment(record, {"clipId": "c1", "startSec": 10, "endSec": 20}, "new", 10.0)
        clips = sorted(record["clips"], key=lambda c: c["timelineStartSec"])
        # The fragments must keep pointing into the source at the right offsets,
        # not restart from zero.
        assert (clips[0]["srcStartSec"], clips[0]["srcEndSec"]) == (100.0, 110.0)
        assert (clips[2]["srcStartSec"], clips[2]["srcEndSec"]) == (120.0, 130.0)

    def test_leaves_other_clips_alone(self, with_clip):
        other = {"id": "c2", "laneId": "lane-2", "sourceAssetId": "asset-2",
                 "srcStartSec": 0.0, "srcEndSec": 5.0, "timelineStartSec": 40.0}
        with_clip["clips"].append(other)
        replace_clip_segment(with_clip, {"clipId": "c1", "startSec": 10, "endSec": 20}, "new", 10.0)
        assert other in with_clip["clips"]
