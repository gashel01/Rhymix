"""Tests for the decisions made before a YuE2 job reaches the GPU.

Every rule asserted here was read out of WanGP's YuE2 handler and pipeline.
They are the combinations that either fail loudly inside the engine or, worse,
succeed while quietly doing something other than what was asked - lyrics
vanishing, a score being ignored, a request costing twice what it should.

None of this needs a GPU, a checkpoint or WanGP itself.
"""

import pytest

from backend.app.yue2_params import (
    DURATION_MAX,
    MODE_DIRECT,
    MODE_MELODY_AND_CHORDS,
    MODE_MELODY_ONLY,
    MODEL_HUM,
    MODEL_TEXT,
    build_settings,
    describe,
    estimate_semantic_tokens,
    normalize,
    strip_comment_lines,
    validate,
    warnings,
)

LYRICS = "[Verse]\nI left the window open half the night\n\n[Chorus]\nTell me where the quiet goes"
STYLE = "melancholic indie pop, female vocals, 92 BPM"


def base(**overrides):
    params = {"lyrics": LYRICS, "style": STYLE}
    params.update(overrides)
    return params


class TestCommentLines:
    def test_hash_lines_are_reported_not_silently_lost(self):
        # WanGP's prompt parser drops these before the model ever sees them.
        # On rap lyrics a leading hashtag is plausible, so we surface it.
        cleaned, dropped = strip_comment_lines("keep this\n#gone\nkeep that")
        assert cleaned == "keep this\nkeep that"
        assert dropped == ["#gone"]

    def test_leading_whitespace_still_counts_as_a_comment(self):
        _, dropped = strip_comment_lines("   # indented")
        assert len(dropped) == 1

    def test_hash_inside_a_line_is_untouched(self):
        cleaned, dropped = strip_comment_lines("money # fame")
        assert dropped == []
        assert cleaned == "money # fame"

    def test_warning_mentions_the_dropped_line(self):
        notes = warnings(base(lyrics="#hook\nverse"))
        assert any("#hook" in note for note in notes)


class TestValidation:
    def test_a_clean_request_passes(self):
        assert validate(base()) == []

    def test_lyrics_are_required(self):
        assert validate(base(lyrics="  ")) != []

    def test_direct_generation_cannot_save_a_score(self):
        # Mode 2 skips planning entirely, so there is nothing to export.
        errors = validate(base(model_mode=MODE_DIRECT, save_score=True))
        assert any("Save Score" in e for e in errors)

    def test_direct_generation_cannot_take_a_score(self):
        errors = validate(base(model_mode=MODE_DIRECT, custom_guide="song.abc"))
        assert errors != []

    def test_direct_generation_cannot_transcribe_a_source_song(self):
        errors = validate(base(model_mode=MODE_DIRECT, audio_guide="source.wav"))
        assert errors != []

    def test_source_song_and_score_cannot_be_combined(self):
        # The source song is transcribed into ABC and overrides the file, so
        # accepting both would silently discard one.
        errors = validate(base(audio_guide="source.wav", custom_guide="song.abc"))
        assert any("override" in e for e in errors)

    def test_duration_is_clamped_rather_than_rejected(self):
        assert normalize(base(duration_seconds=99999))["duration_seconds"] == DURATION_MAX
        assert validate(base(duration_seconds=99999)) == []

    def test_planning_mode_must_be_known(self):
        assert validate(base(model_mode=7)) != []


class TestHum:
    def test_hum_requires_audio(self):
        assert validate(base(hum=True)) != []

    def test_hum_with_audio_passes(self):
        assert validate(base(hum=True, hum_audio="hum.wav")) == []

    def test_hum_rejects_direct_generation(self):
        # yue2_hum only exposes Continue Hum (0) and Hum Only (1).
        assert validate(base(hum=True, hum_audio="hum.wav", model_mode=MODE_DIRECT)) != []

    def test_hum_rejects_a_manual_score(self):
        errors = validate(base(hum=True, hum_audio="hum.wav", custom_guide="song.abc"))
        assert errors != []

    def test_supplying_hum_audio_implies_hum_mode(self):
        assert normalize(base(hum_audio="hum.wav"))["hum"] is True

    def test_hum_warns_that_the_voice_is_not_cloned(self):
        notes = warnings(base(hum=True, hum_audio="hum.wav"))
        assert any("clone" in note for note in notes)


class TestSettings:
    def test_lyrics_go_to_prompt_and_style_to_alt_prompt(self):
        settings = build_settings(base())
        assert settings["prompt"].startswith("[Verse]")
        assert settings["alt_prompt"] == STYLE

    def test_lyrics_are_never_split_into_separate_songs(self):
        # "G" would queue one song per line and "PG" one per section; both
        # would turn a single request into a pile of one-line tracks.
        assert build_settings(base())["multi_prompts_gen_type"] == "FG"

    def test_comment_lines_are_stripped_before_sending(self):
        settings = build_settings(base(lyrics="#note\nreal line"))
        assert "#note" not in settings["prompt"]

    def test_text_generation_sends_no_audio_prompt(self):
        settings = build_settings(base())
        assert settings["model_type"] == MODEL_TEXT
        assert settings["audio_prompt_type"] == ""

    def test_cover_sets_the_source_flag(self):
        settings = build_settings(base(audio_guide="source.wav"))
        assert settings["audio_prompt_type"] == "A"
        assert settings["audio_guide"] == "source.wav"

    def test_hum_uses_the_hum_model(self):
        settings = build_settings(base(hum=True, hum_audio="hum.wav"))
        assert settings["model_type"] == MODEL_HUM
        assert settings["audio_prompt_type"] == "A"

    def test_a_supplied_score_is_passed_through(self):
        settings = build_settings(base(custom_guide="song.abc"))
        assert settings["custom_guide"] == "song.abc"
        assert settings["audio_prompt_type"] == ""

    def test_save_score_is_an_int_flag(self):
        assert build_settings(base(save_score=True))["custom_settings"]["save_score"] == 1
        assert build_settings(base())["custom_settings"]["save_score"] == 0

    def test_seed_defaults_to_random(self):
        assert build_settings(base())["seed"] == -1

    def test_seed_is_preserved_when_given(self):
        assert build_settings(base(seed=965926063))["seed"] == 965926063


class TestWarnings:
    def test_guidance_above_one_is_flagged_as_expensive(self):
        # Anything but 1.0 builds a negative prefix and runs CFG, doubling the
        # cost of the semantic stage - the dominant one.
        assert any("doubles" in n for n in warnings(base(guidance_scale=3.0)))

    def test_default_guidance_is_not_flagged(self):
        assert not any("doubles" in n for n in warnings(base()))

    def test_a_supplied_score_warns_about_metre(self):
        assert any("metrically" in n for n in warnings(base(custom_guide="song.abc")))

    def test_cover_warns_the_backing_track_is_not_kept(self):
        assert any("backing track" in n for n in warnings(base(audio_guide="source.wav")))

    def test_direct_generation_warns_about_coherence(self):
        assert any("coherence" in n for n in warnings(base(model_mode=MODE_DIRECT)))


class TestDescribe:
    def test_semantic_tokens_follow_the_frame_rate(self):
        # 25 tokens per second of audio, straight from pipeline.py.
        assert estimate_semantic_tokens(120) == 3000

    @pytest.mark.parametrize(
        "params,expected",
        [
            ({}, "text"),
            ({"audio_guide": "source.wav"}, "cover"),
            ({"custom_guide": "song.abc"}, "score"),
            ({"hum": True, "hum_audio": "hum.wav"}, "hum"),
        ],
    )
    def test_kind_reflects_the_request(self, params, expected):
        assert describe(base(**params))["kind"] == expected

    def test_planning_label_matches_the_ui(self):
        assert describe(base(model_mode=MODE_MELODY_ONLY))["planning"] == "Melody only"
        assert describe(base(model_mode=MODE_MELODY_AND_CHORDS))["planning"] == "Melody and chords"
