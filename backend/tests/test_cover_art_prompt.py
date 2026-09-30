"""The cover-art prompt builder.

Pure functions over strings — no model, no GPU, no disk — so the whole file runs
in milliseconds. Every "real library" case below is a shape that actually broke
the first version of this code, kept here so it cannot come back.
"""

import pytest

from backend.features.cover_art.service import (
    HOOK_MAX_WORDS,
    build_prompt,
    extract_hook,
    _mood_from_style,
    _title_is_words,
)


class TestExtractHook:
    def test_repeated_line_wins(self):
        lyrics = (
            "[Verse]\nI left my keys beside your coffee\n"
            "[Chorus]\nAnd the morning mist came down\nNothing left to say\n"
            "And the morning mist came down"
        )
        assert extract_hook(lyrics) == "And the morning mist came down"

    def test_falls_back_to_first_chorus_line(self):
        lyrics = "[Verse]\nWalking through the empty station\n[Chorus]\nNeon signs and broken glass"
        assert extract_hook(lyrics) == "Neon signs and broken glass"

    def test_falls_back_to_first_line_without_sections(self):
        assert extract_hook("Dancing on the rooftop\nUnder satellites") == "Dancing on the rooftop"

    def test_adlibs_and_single_words_are_not_hooks(self):
        lyrics = "[Verse]\n(yeah)\noh\nBurning photographs in the sink\nBurning photographs in the sink"
        assert extract_hook(lyrics) == "Burning photographs in the sink"

    def test_empty_lyrics_give_no_hook(self):
        assert extract_hook("") == ""
        assert extract_hook("   \n\n  ") == ""

    def test_lyrics_of_only_adlibs_give_no_hook(self):
        assert extract_hook("yeah\noh\nuh") == ""

    def test_section_tags_are_never_the_hook(self):
        assert "Chorus" not in extract_hook("[Chorus]\nSalt on the window ledge")


class TestRealLibraryShapes:
    """Shapes taken from actual generated songs, each of which broke v1."""

    def test_unbracketed_section_marker(self):
        # Stored as "Verse 1]" — the opening bracket is simply missing. v1
        # returned "Verse 1]" as the hook.
        lyrics = "Verse 1]\n\nYo, whatever name you claim this week\n\nBad Boy turned to bad news"
        hook = extract_hook(lyrics)
        assert "Verse" not in hook
        assert hook.startswith("Yo, whatever name")

    def test_colon_section_markers(self):
        lyrics = "In the silence I hear your voice\nChorus: Oh I am lost in the moment"
        assert "Chorus" not in extract_hook(lyrics)

    def test_lyrics_with_no_line_breaks_at_all(self):
        # One 1400-character line. v1 handed the entire song to the model.
        lyrics = (
            "In the silence, I hear your voice Whispers in the darkness, a haunting choice "
            "To follow the light, or lose my way Chorus: Like a leaf on the wind, with no "
            "direction to stay I'm chasing the shadows"
        )
        hook = extract_hook(lyrics)
        assert 0 < len(hook.split()) <= HOOK_MAX_WORDS

    def test_hook_never_exceeds_the_cap(self):
        lyrics = "\n".join(["one two three four five six seven eight nine ten eleven twelve thirteen"] * 2)
        assert len(extract_hook(lyrics).split()) <= HOOK_MAX_WORDS

    def test_truncation_does_not_end_on_a_function_word(self):
        # "…with no direction to stay I'm" reads as an interrupted sentence.
        lyrics = "Like a leaf on the wind, with no direction to stay I'm chasing shadows"
        assert not extract_hook(lyrics).lower().endswith(("i'm", " to", " the", " and"))

    def test_apostrophes_do_not_split_a_line(self):
        # `(?=[A-Z][a-z])` exists so "and I'm lost" is not cut at "I'm".
        assert "I'm" in extract_hook("Walking home and I'm lost again tonight")

    def test_a_line_full_of_names_is_not_shredded(self):
        # Real lyrics. Every comma-then-capital here looks like a lost line
        # break, and the run-on repair used to cut this into five one-word
        # lines. The repair must not fire on text that has its own breaks.
        lyrics = (
            "Verse 1]\n\nYo, Puff Daddy, Diddy, Combs, whatever name you claim this week\n\n"
            "You went from makin' hits to makin' headlines\n\n"
            "Bad Boy turned to bad news, champagne turned to handcuffs"
        )
        hook = extract_hook(lyrics)
        assert len(hook.split()) >= 5, f"line was shredded: {hook!r}"
        assert hook.startswith("Yo, Puff Daddy")


class TestMoodFromStyle:
    def test_production_words_are_stripped(self):
        mood = _mood_from_style("melancholic indie pop, female vocals, 92 BPM")
        assert "vocals" not in mood.lower()
        assert "bpm" not in mood.lower()
        assert "melancholic indie pop" in mood

    def test_clean_is_stripped_because_it_draws_a_guitar(self):
        assert "clean" not in _mood_from_style("clean electric guitar").lower()

    def test_keeps_at_most_four_fragments(self):
        mood = _mood_from_style("a, b, c, d, e, f")
        assert len(mood.split(",")) <= 4

    def test_empty_style_is_empty_mood(self):
        assert _mood_from_style("") == ""


class TestTitleIsWords:
    @pytest.mark.parametrize("title", ["Morning Mist", "summer night", "static in my skull", "koko"])
    def test_real_titles_are_kept(self, title):
        assert _title_is_words(title)

    @pytest.mark.parametrize("title", ["dddqqa", "rrreeeee", "ddd", "", "x", "123"])
    def test_working_titles_are_rejected(self, title):
        assert not _title_is_words(title)


class TestBuildPrompt:
    def test_hook_comes_first(self):
        prompt = build_prompt("summer night", "dream pop", "We were neon hearts in a dark city")
        body = prompt.split("album cover art, ", 1)[1]
        assert body.startswith("We were neon hearts")

    def test_negative_instructions_are_always_present(self):
        prompt = build_prompt("x", "", "")
        for phrase in ("no text", "no lettering", "no watermark"):
            assert phrase in prompt

    def test_falls_back_to_abstract_when_nothing_is_usable(self):
        assert "abstract" in build_prompt("ddd", "", "")

    def test_a_working_title_never_reaches_the_prompt(self):
        assert "rrreeeee" not in build_prompt("rrreeeee", "lo-fi", "Something worth singing here")

    def test_style_only_still_produces_a_prompt(self):
        prompt = build_prompt("ddd", "alternative trap pop", "")
        assert "alternative trap pop" in prompt
