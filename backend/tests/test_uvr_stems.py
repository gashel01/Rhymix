import pytest

from backend.features.studio import uvr_stems


@pytest.fixture
def source(tmp_path):
    path = tmp_path / "song.wav"
    path.write_bytes(b"RIFF")
    return path


def test_drums_and_bass_go_to_demucs_not_uvr(monkeypatch, source):
    # UVR only ever produced vocals + instrumental; a request for drums or bass used to be
    # silently answered with those two. It must reach the four-way separator instead.
    seen = {}

    def fake_demucs(path, wanted):
        seen["wanted"] = wanted
        return [{"label": name.title()} for name in wanted]

    monkeypatch.setattr(uvr_stems, "_extract_demucs_stems", fake_demucs)
    out = uvr_stems.extract_uvr_multi_stems(str(source), ["Drums", "bass"])
    assert seen["wanted"] == ["drums", "bass"]
    assert [stem["label"] for stem in out] == ["Drums", "Bass"]


def test_a_full_split_names_all_four_stems(monkeypatch, source):
    monkeypatch.setattr(uvr_stems, "_extract_demucs_stems", lambda path, wanted: wanted)
    assert uvr_stems.extract_uvr_multi_stems(str(source), ["vocals", "drums", "bass", "other"]) == [
        "vocals",
        "drums",
        "bass",
        "other",
    ]


def test_vocals_and_instrumental_stay_on_the_uvr_pipeline(monkeypatch, source):
    def boom(*args, **kwargs):
        raise AssertionError("Demucs must not run for a UVR-only request")

    monkeypatch.setattr(uvr_stems, "_extract_demucs_stems", boom)
    monkeypatch.setattr(uvr_stems, "process_audio_files_thread", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("uvr ran")))
    with pytest.raises(RuntimeError, match="uvr ran"):
        uvr_stems.extract_uvr_multi_stems(str(source), ["vocals"])
