"""Render a MIDI clip to audio through a General MIDI soundfont.

Voice→MIDI and the beatbox wizard both capture notes, not sound — a MIDI
clip sat on the timeline playable only as a silent preview, because
render_mixdown only ever resolves a clip's sourceAssetId to an audio file,
and a MIDI clip has none. FluidSynth plus a free instrument library closes
that the way most DAWs' built-in instruments work: sample playback against
a soundfont, not neural resynthesis, so it needs no model weights beyond
the one .sf3 file and no GPU. (DDSP, already wired in
backend/app/ddsp_adapter.py, is the higher-fidelity alternative for
whichever single instrument someone actually trains — this is what is
available for every instrument, all the time, underneath it.)
"""

from __future__ import annotations

import os
import subprocess
import uuid
from pathlib import Path

import mido

from backend.features.studio.assets import probe_audio
from backend.paths.manager import paths

DEFAULT_PPQ = 480
DEFAULT_BPM = 120.0

FLUIDSYNTH_BIN = os.environ.get(
    "FLUIDSYNTH_BIN",
    str(
        paths.BASE_DIR
        / "tools"
        / "fluidsynth"
        / "fluidsynth-v2.6.1-win10-x64-cpp11"
        / "bin"
        / "fluidsynth.exe"
    ),
)
SOUNDFONT_PATH = os.environ.get(
    "STUDIO_SOUNDFONT",
    str(paths.BASE_DIR / "models" / "soundfonts" / "FluidR3Mono_GM.sf3"),
)

# General MIDI program numbers for exactly the values Inspector.js's own
# SOUND_FONT_OPTIONS already offers (inspectorModel.js) — this list existed
# in the UI before this module did, with nothing behind it to act on a
# choice. Keeping the same keys means that control works as soon as this
# ships, with no frontend change.
GM_PROGRAMS = {
    "acoustic_grand_piano": 0,
    "electric_guitar_clean": 27,
    "acoustic_bass": 32,
    "string_ensemble_1": 48,
    "synth_pad_1_new_age": 88,
    "synth_drum": 118,
    "choir_aahs": 52,
    "flute": 73,
    "alto_sax": 65,
    "trumpet": 56,
}
DEFAULT_SOUNDFONT = "acoustic_grand_piano"


def resolve_program(soundfont: str | None) -> int:
    if not soundfont:
        return GM_PROGRAMS[DEFAULT_SOUNDFONT]
    key = str(soundfont).strip().lower().replace(" ", "_")
    return GM_PROGRAMS.get(key, GM_PROGRAMS[DEFAULT_SOUNDFONT])


def _clip_to_midi_file(clip: dict, bpm: float, out_path: Path) -> int:
    """Write one clip's notes to a standalone .mid, program-changed to its
    instrument. Returns the note count written.

    Mirrors the event-building in midi_export.py's whole-project exporter,
    scoped to a single clip's own notes at the clip's own ppq — there is no
    timeline offset here, the render starts at 0 and the resulting audio
    gets placed on the timeline the same way any other clip's audio does.
    """
    payload = clip.get("midi") or {}
    source_ppq = int(payload.get("ppq") or DEFAULT_PPQ)
    program = resolve_program(payload.get("soundfont"))

    midi_file = mido.MidiFile(ticks_per_beat=source_ppq)
    track = mido.MidiTrack()
    midi_file.tracks.append(track)
    track.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(bpm), time=0))
    track.append(mido.Message("program_change", program=program, time=0))

    events = []
    for note in payload.get("notes") or []:
        pitch = note.get("midi")
        if pitch is None:
            continue
        start = max(0, int(note.get("startTick") or 0))
        duration = max(1, int(note.get("durationTick") or 0))
        velocity = max(1, min(127, int(note.get("velocity") or 100)))
        events.append((start, "note_on", int(pitch), velocity))
        events.append((start + duration, "note_off", int(pitch), 0))

    if not events:
        return 0

    events.sort(key=lambda item: (item[0], item[1] == "note_on"))
    previous = 0
    for absolute, kind, pitch, velocity in events:
        track.append(
            mido.Message(kind, note=pitch, velocity=velocity, time=max(0, absolute - previous))
        )
        previous = absolute

    out_path.parent.mkdir(parents=True, exist_ok=True)
    midi_file.save(str(out_path))
    return len(events) // 2


def render_midi_clip(clip: dict, bpm: float | None = None) -> dict:
    """Render one MIDI clip to a standalone wav via FluidSynth.

    Returns {"path", "url", "durationSec", "sampleRate"} for the caller to
    register as an asset. Raises if the clip has no notes, or the binary,
    soundfont, or render itself is missing/fails.
    """
    fluidsynth_bin = Path(FLUIDSYNTH_BIN)
    soundfont_path = Path(SOUNDFONT_PATH)
    if not fluidsynth_bin.exists():
        raise RuntimeError(f"FluidSynth binary not found at {fluidsynth_bin}")
    if not soundfont_path.exists():
        raise RuntimeError(f"Soundfont not found at {soundfont_path}")

    resolved_bpm = float(bpm or (clip.get("midi") or {}).get("bpm") or DEFAULT_BPM)
    work_id = uuid.uuid4().hex
    paths.TEMP_WAV_DIR.mkdir(parents=True, exist_ok=True)
    mid_path = paths.TEMP_WAV_DIR / f"studio_midi_render_{work_id}.mid"

    try:
        note_count = _clip_to_midi_file(clip, resolved_bpm, mid_path)
        if note_count == 0:
            raise RuntimeError("This MIDI clip has no notes to render")

        paths.EXPORT_DIR.mkdir(parents=True, exist_ok=True)
        out_name = f"studio_midi_render_{work_id}.wav"
        out_path = paths.EXPORT_DIR / out_name

        cmd = [
            str(fluidsynth_bin),
            "-ni",
            "-F",
            str(out_path),
            "-r",
            "44100",
            str(soundfont_path),
            str(mid_path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if result.returncode != 0 or not out_path.exists():
            raise RuntimeError(result.stderr.strip() or "FluidSynth render failed")

        info = probe_audio(out_path)
        return {
            "path": str(out_path),
            "url": f"/api/download/exports/{out_name}",
            "durationSec": info.get("durationSec", 0.0),
            "sampleRate": info.get("sampleRate"),
        }
    finally:
        try:
            mid_path.unlink(missing_ok=True)
        except Exception:
            pass
