# Studio Mode

Studio is a non-destructive DAW-style editor built on top of Rhymix. It gives you lanes, clips, async AI jobs, and a project EDL stored as JSON.

Open it from the `AudioTrackTable` via the **Studio** action, or navigate directly to:

```
/studio/:assetId
```

## Concepts

- **Lanes** — audio, MIDI, or stem lanes. Each has a color, a name, and its own set of clips.
- **Clips** — non-destructive references to source audio / MIDI with start, length, gain, and fades.
- **EDL** — the whole project is a JSON document (`data/studio/projects.json`). All edits go through pure functions in `frontend/src/studio/edlOps.js`.
- **Jobs** — rendering and AI actions run async in the background and stream progress back over SSE.

---

## Voice → MIDI (Offline Melody)

A Dubler-style offline melody mode for singing / humming in a take and getting quantized MIDI back.

Features:
- Voicing-gate-based note starts (fewer missed soft notes).
- Legato vs staccato articulation detection.
- Vibrato protection.
- Optional key / scale restriction.
- Optional pitch-bend stream (not wired to UI yet).

Detection can be tuned from the Studio UI (Detection Tuning sliders) or via `.env`:

```
VOICE_MIDI_CREPE_CONF=0.35
VOICE_MIDI_CREPE_STABLE_FRAMES=4
VOICE_MIDI_CREPE_HANGOVER=4
VOICE_MIDI_CREPE_MIN_NOTE_MS=0.08
VOICE_MIDI_MIN_NOTE_MS=0.09
VOICE_MIDI_NOTE_GAP_SEC=0.06
VOICE_MIDI_MIN_VELOCITY=40
```

### Calibration

Run calibration once per voice for better results:

```python
from backend.app.dubler_profile import calibrate_voice_profile, save_profile

profile = calibrate_voice_profile("path/to/calibration.wav", sample_rate=16000)
save_profile("data/studio/voice_midi/profile.json", profile)
```

---

## Magic Wand Voice → MIDI (API)

Intention-first melody extraction with stable notes and soft key guidance:

```python
from backend.app.dubler_melody import transcribe_magic_wand

notes, cc, pb, debug = transcribe_magic_wand(
    "path/to/audio.wav",
    sample_rate=48000,
    preset="wand_sing",        # or "wand_whistle", "wand_noisy_room"
    key="C",
    scale="major",             # soft prior unless strict_key=True
    strict_key=False,
    emit_pitchbend=True,
    return_debug=True,
)
```

**Soft key prior vs strict key:**
- `strict_key=False` (default): key and scale guide the decoder softly — musically aware, but still allows chromatic notes.
- `strict_key=True`: hard-restrict to the given scale.

### Export MIDI

```python
from backend.app.dubler_melody import events_to_midi_file

events_to_midi_file(notes, cc, pb, "out.mid", tempo_bpm=120)
```

Requires `mido`:
```bash
pip install mido
```

### Calibrated profile (advanced)

```python
from backend.app.dubler_melody import transcribe_dubler_melody_v2
from backend.app.dubler_profile import load_profile

profile = load_profile("data/studio/voice_midi/profile.json")
notes, cc, pb, debug = transcribe_dubler_melody_v2(
    "path/to/audio.wav",
    sample_rate=16000,
    profile=profile,
    decode_mode="viterbi",
)
```

---

## Stem extraction (instrumental)

> **Currently inert.** `stem_extract` ran on ACE-Step's `acestep-v15-base`, which was removed along with the rest of ACE-Step. The job still exists and still accepts `trackNames`, but the default bridge returns an explanation instead of stems. It will come back when the Studio is rebuilt.

The job splits an instrumental into instrument stems, one per Studio lane.

Defaults:
- Tracks: `drums`, `bass`, `guitar`, `keyboard`, `strings`, `synth`

You can pass `trackNames` (array or comma-separated string) in the job payload to control which stems are extracted.

---

## Voice / Beat → MIDI clip (realtime, WebSocket)

A panel that records microphone input and converts it into a MIDI clip for a target lane. Uses a lightweight DSP pipeline and does **not** play audio during recording.

Start the FastAPI WebSocket server in a separate process:

```
uvicorn backend.app.main:app --host 0.0.0.0 --port 8002
```

The frontend connects to:
```
ws://localhost:8002/ws/voice_to_midi
```

Override the URL:
```
REACT_APP_VOICE_MIDI_WS=ws://localhost:8002/ws/voice_to_midi
```

### Melody engine (Basic Pitch / CREPE / DDSP)

Melody mode prefers **Basic Pitch** if installed, then CREPE, then a lightweight aubio fallback.

```bash
pip install basic-pitch
```

Force an engine:
```
VOICE_MIDI_MELODY_ENGINE=basic_pitch   # or crepe / ddsp / aubio / auto
```

See [CONFIGURATION.md](CONFIGURATION.md) for the full voice→MIDI tuning reference.

---

## MIDI playback (SoundFont)

Studio previews MIDI clips using a lightweight SoundFont renderer in the browser. Default SoundFont: **MusyngKite** (loaded from a public CDN) — multi-velocity-layered samples, a quality upgrade over the older FluidR3_GM bank at the same host/format.

Override the SoundFont base URL (self-hosted or custom banks):
```
REACT_APP_SOUNDFONT_URL=https://your-cdn/soundfonts/MusyngKite/
```

You can change the SoundFont per MIDI clip from **Details → SoundFont** in the Inspector.
