"""Tests for the musical decisions a voice-to-MIDI transcription makes.

These lived in session.py, which cannot be imported without aubio and torch,
so none of them ran anywhere. note_math needs only numpy, which CI has.
"""

import pytest

from backend.app.note_math import (
    apply_swing,
    estimate_bpm_from_onsets,
    merge_adjacent_notes,
    note_name_to_pc,
    parse_key_string,
    quantize_tick,
    snap_notes_to_scale,
    ticks_per_second,
)


def note(pitch, start, end, velocity=100):
    return {"note": pitch, "startSec": start, "endSec": end, "velocity": velocity}


class TestEstimateBpm:
    def test_even_onsets_give_their_tempo(self):
        # A hit every half second is 120bpm.
        assert estimate_bpm_from_onsets([0.0, 0.5, 1.0, 1.5]) == pytest.approx(120.0)

    def test_uses_the_median_not_the_mean(self):
        # One long pause between phrases would drag a mean tempo down further
        # than the rest of the take can pull it back.
        steady = [i * 0.5 for i in range(8)]
        with_pause = steady + [steady[-1] + 6.0, steady[-1] + 6.5]
        assert estimate_bpm_from_onsets(with_pause) == pytest.approx(120.0)

    def test_clamps_to_a_plausible_range(self):
        # Outside 60-200 the estimate is nearly always the wrong metrical
        # level, and a plausible wrong tempo is worse than a safe one because
        # the grid it produces looks deliberate.
        assert estimate_bpm_from_onsets([0.0, 0.1, 0.2, 0.3]) == 200.0
        assert estimate_bpm_from_onsets([0.0, 3.0, 6.0]) == 60.0

    def test_needs_at_least_two_onsets(self):
        assert estimate_bpm_from_onsets([]) is None
        assert estimate_bpm_from_onsets([1.0]) is None

    def test_returns_nothing_when_no_time_passes_between_onsets(self):
        assert estimate_bpm_from_onsets([1.0, 1.0, 1.0]) is None

    def test_ignores_onsets_that_go_backwards(self):
        assert estimate_bpm_from_onsets([0.0, 0.5, 0.2, 1.0]) is not None


class TestTicks:
    def test_ticks_per_second(self):
        assert ticks_per_second(120, 480) == pytest.approx(960.0)
        assert ticks_per_second(60, 480) == pytest.approx(480.0)

    def test_quantize_snaps_to_the_nearest_line(self):
        assert quantize_tick(119, 120) == 120
        assert quantize_tick(61, 120) == 120
        assert quantize_tick(59, 120) == 0

    def test_a_grid_of_one_or_less_is_no_grid(self):
        assert quantize_tick(119, 1) == 119
        assert quantize_tick(119, 0) == 119
        assert quantize_tick(119, -5) == 119


class TestSwing:
    def test_pushes_every_other_step_late(self):
        # Step 0 stays, step 1 moves — that is what makes it swing rather than
        # shifting the whole part.
        assert apply_swing(0, 120, 0.5) == 0
        assert apply_swing(120, 120, 0.5) == 150
        assert apply_swing(240, 120, 0.5) == 240
        assert apply_swing(360, 120, 0.5) == 390

    def test_more_swing_moves_it_further(self):
        assert apply_swing(120, 120, 1.0) > apply_swing(120, 120, 0.5)

    def test_no_swing_changes_nothing(self):
        assert apply_swing(120, 120, 0.0) == 120
        assert apply_swing(120, 120, -1) == 120
        assert apply_swing(120, 0, 0.5) == 120


class TestMergeAdjacentNotes:
    def test_joins_a_stutter_of_the_same_pitch(self):
        # Pitch detection breaks a held note wherever the tone wavers past the
        # confidence threshold.
        merged = merge_adjacent_notes([note(60, 0.0, 0.5), note(60, 0.52, 1.0)], gap_sec=0.04)
        assert len(merged) == 1
        assert merged[0]["startSec"] == 0.0
        assert merged[0]["endSec"] == 1.0

    def test_keeps_a_real_repetition_apart(self):
        assert len(merge_adjacent_notes([note(60, 0.0, 0.5), note(60, 1.0, 1.5)], gap_sec=0.04)) == 2

    def test_never_joins_different_pitches(self):
        assert len(merge_adjacent_notes([note(60, 0.0, 0.5), note(62, 0.51, 1.0)], gap_sec=0.04)) == 2

    def test_keeps_the_louder_velocity(self):
        merged = merge_adjacent_notes(
            [note(60, 0.0, 0.5, velocity=40), note(60, 0.51, 1.0, velocity=90)], gap_sec=0.04
        )
        assert merged[0]["velocity"] == 90

    def test_sorts_before_merging(self):
        merged = merge_adjacent_notes([note(60, 0.51, 1.0), note(60, 0.0, 0.5)], gap_sec=0.04)
        assert len(merged) == 1

    def test_keeps_the_later_end_of_an_enclosed_note(self):
        merged = merge_adjacent_notes([note(60, 0.0, 1.0), note(60, 0.2, 0.4)], gap_sec=0.04)
        assert merged[0]["endSec"] == 1.0

    def test_does_not_modify_its_input(self):
        notes = [note(60, 0.0, 0.5), note(60, 0.51, 1.0)]
        merge_adjacent_notes(notes, gap_sec=0.04)
        assert notes[0]["endSec"] == 0.5

    def test_handles_no_notes(self):
        assert merge_adjacent_notes([]) == []


class TestParseKeyString:
    def test_reads_root_and_mode(self):
        assert parse_key_string("C major") == ("c", "maj")
        assert parse_key_string("F# minor") == ("f#", "min")

    def test_accepts_the_short_forms(self):
        assert parse_key_string("A min") == ("a", "min")
        assert parse_key_string("A MAJ") == ("a", "maj")

    def test_a_root_alone_means_major(self):
        assert parse_key_string("D") == ("d", "maj")

    def test_says_nothing_for_nothing(self):
        assert parse_key_string("") is None
        assert parse_key_string(None) is None
        assert parse_key_string("   ") is None


class TestNoteNameToPc:
    def test_knows_naturals_sharps_and_flats(self):
        assert note_name_to_pc("c") == 0
        assert note_name_to_pc("c#") == 1
        assert note_name_to_pc("db") == 1

    def test_is_none_for_a_name_it_does_not_know(self):
        assert note_name_to_pc("h") is None
        assert note_name_to_pc("C") is None  # lower-case only; parse_key_string lowers


class TestSnapNotesToScale:
    def test_moves_an_out_of_key_note_to_its_neighbour(self):
        # C# is not in C major; C is a semitone away.
        [snapped] = snap_notes_to_scale([note(61, 0, 1)], "C major")
        assert snapped["note"] == 60

    def test_leaves_a_note_already_in_key_alone(self):
        [snapped] = snap_notes_to_scale([note(64, 0, 1)], "C major")
        assert snapped["note"] == 64

    def test_minor_allows_the_flat_third(self):
        # Eb is in C minor and not in C major.
        assert snap_notes_to_scale([note(63, 0, 1)], "C minor")[0]["note"] == 63
        assert snap_notes_to_scale([note(63, 0, 1)], "C major")[0]["note"] != 63

    def test_ties_go_to_the_lower_note(self):
        # F# in C major: both F and G are a semitone away.
        assert snap_notes_to_scale([note(66, 0, 1)], "C major")[0]["note"] == 65

    def test_follows_the_root(self):
        # F# is in G major.
        assert snap_notes_to_scale([note(66, 0, 1)], "G major")[0]["note"] == 66

    def test_returns_the_notes_untouched_for_an_unreadable_key(self):
        # Snapping a take to a guessed scale is worse than not snapping it.
        notes = [note(61, 0, 1)]
        assert snap_notes_to_scale(notes, "") is notes
        assert snap_notes_to_scale(notes, "H major") is notes
        assert snap_notes_to_scale(notes, None) is notes

    def test_does_not_modify_its_input(self):
        notes = [note(61, 0, 1)]
        snap_notes_to_scale(notes, "C major")
        assert notes[0]["note"] == 61

    def test_stays_inside_the_midi_range(self):
        for pitch in (0, 1, 126, 127):
            [snapped] = snap_notes_to_scale([note(pitch, 0, 1)], "C major")
            assert 0 <= snapped["note"] <= 127

    def test_every_note_lands_in_the_scale(self):
        snapped = snap_notes_to_scale([note(p, 0, 1) for p in range(40, 80)], "A minor")
        # A natural minor on A is the white notes.
        white = {0, 2, 4, 5, 7, 9, 11}
        assert all(s["note"] % 12 in white for s in snapped)

    def test_handles_no_notes(self):
        assert snap_notes_to_scale([], "C major") == []
