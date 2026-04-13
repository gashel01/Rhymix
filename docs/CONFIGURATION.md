# Configuration Reference

Every environment variable Rhymix reads, grouped by subsystem. Copy `.env.example` to `.env` and set only what you need — everything has a sensible default.

## Logging

| Variable | Default | Notes |
|---|---|---|
| `RHYMIX_ENABLE_LOGS` | `0` | Master switch for backend logs. |
| `RHYMIX_LOG_LEVEL` | `INFO` | Standard Python log level (`DEBUG`, `INFO`, `WARNING`, ...). |

CREPE logs are emitted under the `voice_midi` logger when enabled.

## Studio — AI adapter

| Variable | Default | Notes |
|---|---|---|
| `STUDIO_AI_ADAPTER` | _unset_ | Set to `local` to enable the in-process Python bridge. Leave unset for NotConfigured (friendly error). |
| `STUDIO_AI_BRIDGE` | `backend.features.studio.ai_bridge_acestep` | Module / script that speaks JSON on stdin/stdout. |
| `STUDIO_AI_PYTHON` | `python` | Python executable the bridge is spawned with. |
| `STUDIO_AI_EXTRACT_MODEL` | `acestep-v15-base` | Model used by the `stem_extract` job. |
| `STUDIO_AI_PERSISTENT` | `0` | Keep the bridge process alive between jobs. |

## Studio — Voice / Beat → MIDI

| Variable | Default | Notes |
|---|---|---|
| `REACT_APP_VOICE_MIDI_WS` | `ws://localhost:8002/ws/voice_to_midi` | Frontend WebSocket URL. |
| `VOICE_MIDI_MELODY_ENGINE` | `auto` | `basic_pitch` / `crepe` / `ddsp` / `aubio` / `auto`. |

### Pre-processing

| Variable | Default | Notes |
|---|---|---|
| `VOICE_MIDI_PREPROCESS` | `1` | Enable clean-up before pitch detection. |
| `VOICE_MIDI_KEEP_WAV` | `0` | Keep intermediate WAVs for debugging. |
| `VOICE_MIDI_GATE_DB` | `-45` | Noise gate threshold. |
| `VOICE_MIDI_GATE_MODE` | `soft` | `soft` or `hard`. |
| `VOICE_MIDI_LOW_PASS` | `6000` | Low-pass cutoff (Hz). |
| `VOICE_MIDI_HIGH_PASS` | `80` | High-pass cutoff (Hz). |
| `VOICE_MIDI_TRIM_DB` | `35` | Silence trim. |
| `VOICE_MIDI_NORMALIZE` | `1` | Normalize input to 0 dBFS peak. |
| `VOICE_MIDI_PREPROCESS_SR` | `22050` | Intermediate sample rate. |

### Basic Pitch

| Variable | Default |
|---|---|
| `VOICE_MIDI_BP_MIN_FREQ` | `65` |
| `VOICE_MIDI_BP_MAX_FREQ` | `1200` |

### CREPE

| Variable | Default |
|---|---|
| `VOICE_MIDI_CREPE_CONF` | `0.35` |
| `VOICE_MIDI_CREPE_FMIN` | `50` |
| `VOICE_MIDI_CREPE_FMAX` | `800` |
| `VOICE_MIDI_CREPE_SR` | `16000` |
| `VOICE_MIDI_CREPE_STABLE_FRAMES` | `4` |
| `VOICE_MIDI_CREPE_HANGOVER` | `4` |
| `VOICE_MIDI_CREPE_MIN_NOTE_MS` | `0.08` |

### DDSP (experimental)

| Variable | Default | Notes |
|---|---|---|
| `DDSP_MODEL_DIR` | `models/ddsp` | Base directory for DDSP saved models. |
| `DDSP_MODEL_MAP` | _unset_ | Optional JSON per-instrument map, e.g. `{"piano":"models/ddsp/piano"}`. |
| `VOICE_MIDI_DDSP_CONF` | `0.3` | Confidence threshold. |
| `VOICE_MIDI_DDSP_FMIN` | `50` | Min frequency. |
| `VOICE_MIDI_DDSP_FMAX` | `1200` | Max frequency. |
| `VOICE_MIDI_DDSP_FRAME_RATE` | `250` | Frame rate for analysis. |
| `VOICE_MIDI_DDSP_STRICT` | `0` | Strict mode. |

Model placement:
```
Rhymix/
  models/
    ddsp/
      piano/
        saved_model.pb
      guitar/
        model.gin
        model.ckpt-XXXX.index
        model.ckpt-XXXX.data-00000-of-00001
      default/
        saved_model.pb
```

### Shared note shaping

| Variable | Default |
|---|---|
| `VOICE_MIDI_MIN_NOTE_MS` | `0.09` |
| `VOICE_MIDI_NOTE_GAP_SEC` | `0.06` |
| `VOICE_MIDI_MIN_VELOCITY` | `40` |

### Signal processing (optional EQ + compressor + denoise)

| Variable | Default | Notes |
|---|---|---|
| `VOICE_MIDI_PROCESSING` | `0` | Master switch. |
| `VOICE_MIDI_EQ_LOW_DB` | `0` | Low-shelf gain (dB). |
| `VOICE_MIDI_EQ_MID_DB` | `0` | Mid peak gain (dB). |
| `VOICE_MIDI_EQ_HIGH_DB` | `0` | High-shelf gain (dB). |
| `VOICE_MIDI_EQ_LOW_FREQ` | `200` | Low-shelf corner (Hz). |
| `VOICE_MIDI_EQ_HIGH_FREQ` | `4000` | High-shelf corner (Hz). |
| `VOICE_MIDI_COMPRESSOR_THRESHOLD` | `-20` | dBFS. |
| `VOICE_MIDI_COMPRESSOR_RATIO` | `4` | — |
| `VOICE_MIDI_COMPRESSOR_ATTACK_MS` | `5` | ms. |
| `VOICE_MIDI_COMPRESSOR_RELEASE_MS` | `50` | ms. |
| `VOICE_MIDI_COMPRESSOR_MAKEUP_DB` | `0` | dB. |
| `VOICE_MIDI_NOISE_REDUCTION_STRENGTH` | `0` | 0 to disable. |
| `VOICE_MIDI_PITCH_SHIFT` | `0` | Semitones. |

## RVC / voice conversion

| Variable | Default | Notes |
|---|---|---|
| `RHYMIX_WARMUP_ON_STARTUP` | `0` | Pre-load RVC models at boot. |
| `RVC_MODEL_CACHE_SIZE` | `2` | Number of models kept hot in memory. |

## Frontend

| Variable | Default | Notes |
|---|---|---|
| `REACT_APP_SOUNDFONT_URL` | _CDN default_ | Override the SoundFont base URL (self-host FluidR3_GM or custom banks). |
