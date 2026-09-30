import pytest

from backend.features.studio.loop_match import parse_key, plan_tempo, semitone_shift


@pytest.mark.parametrize(
    "text,expected",
    [("C minor", (0, True)), ("Cm", (0, True)), ("F# major", (6, False)), ("Bb", (10, False)),
     ("a min", (9, True)), ("Ebmaj", (3, False)), ("Db", (1, False))],
)
def test_parse_key(text, expected):
    assert parse_key(text) == expected


@pytest.mark.parametrize("text", ["", None, "nothing", "H major"])
def test_parse_key_rejects_garbage(text):
    assert parse_key(text) is None


def test_relative_keys_are_the_same_key():
    # A minor and C major share every note: no transpose needed.
    assert semitone_shift((9, True), (0, False)) == 0
    assert semitone_shift((0, False), (9, True)) == 0


def test_shift_takes_the_shortest_way():
    assert semitone_shift((0, False), (7, False)) == -5  # up a fifth is a fourth down
    assert semitone_shift((0, False), (1, False)) == 1
    assert semitone_shift((0, False), (6, False)) == 6
    assert semitone_shift((5, False), (5, False)) == 0


def test_a_short_clip_becomes_a_whole_number_of_bars():
    # 4.1s at 120 BPM (2s bars) is a 2-bar loop, so it must land on exactly 2 bars.
    plan = plan_tempo(4.1, 120, beat_bpm=None)
    assert plan["bars"] == 2
    assert plan["tempo"] == pytest.approx(4.1 / 4.0)


def test_a_loop_already_on_the_grid_is_untouched():
    assert plan_tempo(8.0, 120, None) == {"tempo": 1.0, "bars": 4}


def test_half_time_beat_tracking_is_folded_before_stretching():
    # Long audio -> beat tracking; 70 BPM read for a 140 track must not be doubled slowly.
    plan = plan_tempo(120.0, 140, beat_bpm=70)
    assert plan == {"tempo": 1.0, "bars": None}


def test_a_song_far_from_the_tempo_is_left_alone():
    assert plan_tempo(120.0, 120, beat_bpm=85) == {"tempo": 1.0, "bars": None}
    assert plan_tempo(120.0, 120, beat_bpm=100)["tempo"] == pytest.approx(1.2)


def test_an_off_grid_clip_without_a_tempo_is_not_stretched():
    assert plan_tempo(5.12, 120, beat_bpm=None) == {"tempo": 1.0, "bars": None}
