# Rhymix

A comprehensive audio processing application for voice conversion, vocal separation, speaker diarization, and AI-powered song generation. Built with Flask backend and React frontend, integrating Applio (RVC) for high-quality voice transformation and ACE-Step for music generation.

## Features

- **Song Generation**: Generate complete songs from text prompts and lyrics using ACE-Step AI foundation model
- **Vocal Separation**: Extract vocals and instrumentals from audio files
- **Speaker Diarization**: Separate multiple speakers in audio recordings
- **Voice Model Training**: Train custom voice models using Applio (RVC)
- **Voice Inference**: Convert voices using trained models
- **Audio Processing**: Clean and process audio files with various tools
- **Web Interface**: Modern React-based UI for easy interaction

## Prerequisites

- **Python 3.10** (required for backend)
- **Node.js** and **npm** (required for frontend)
- **CUDA 12.1** compatible GPU (recommended for PyTorch)
- **Windows** (current setup is optimized for Windows)

## Installation

### Backend Setup

1. **Create a virtual environment**:
   ```bash
   py -3.10 -m venv venv
   ```

2. **Activate the virtual environment**:
   ```bash
   venv\Scripts\activate
   ```

3. **Install Python dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Install PyTorch with CUDA 12.1 support**:
   ```bash
   pip install torch==2.4.1 torchvision==0.19.1 torchaudio==2.4.1 --index-url https://download.pytorch.org/whl/cu121
   ```

### Frontend Setup

1. **Navigate to the frontend directory**:
   ```bash
   cd frontend
   ```

2. **Install Node.js dependencies**:
   ```bash
   npm install
   ```

## Running the Application

### Backend

1. **Activate the virtual environment** (if not already activated):
   ```bash
   venv\Scripts\activate
   ```

2. **Start the Flask server**:
   ```bash
   python app.py
   ```

   The backend will typically run on `http://localhost:5000`

### Frontend

1. **Navigate to the frontend directory**:
   ```bash
   cd frontend
   ```

2. **Start the React development server**:
   ```bash
   npm start
   ```

   The frontend will typically run on `http://localhost:3001`

## Project Structure

```
Rhymix/
├── app.py                 # Main Flask application
├── applio/                # Applio (RVC) integration
│   ├── core.py           # Core Applio functions
│   ├── rvc/              # RVC model configurations
│   └── tabs/             # Applio UI components
├── ACE-Step/              # ACE-Step music generation model
│   ├── acestep/          # ACE-Step core modules
│   ├── checkpoints/      # Model checkpoints (if available)
│   └── venv/             # ACE-Step virtual environment (optional)
├── app/                   # Application modules
│   ├── config.py         # Configuration settings
│   ├── routes/           # API routes
│   └── utils/            # Utility functions
├── frontend/              # React frontend application
│   └── src/              # React source files
├── data/                  # Data directories (created at runtime)
│   ├── singing/          # Singing voice processing data
│   ├── talking/          # Speaker diarization data
│   └── generated_songs/  # ACE-Step generated songs
├── logs/                  # Trained models storage
├── diarization/           # Speaker diarization modules
└── requirements.txt       # Python dependencies
```

## API Endpoints

The Flask backend provides REST API endpoints for:

- `/api/song-generation/start` - Start a new song generation job (ACE-Step)
- `/api/song-generation/status/<job_id>` - Check song generation job status
- `/api/song-generation/jobs` - List all song generation jobs
- `/api/song-generation/audio/<job_id>` - Stream generated song audio
- `/api/upload` - Upload audio files
- `/api/process` - Process audio files (vocal separation)
- `/api/upload-talking` - Upload files for speaker diarization
- `/api/talking-status/<job_id>` - Check diarization job status
- `/api/train` - Train voice models
- `/api/inference` - Perform voice conversion
- `/api/download/<file_type>/<filename>` - Download processed files

## Studio Mode

Studio Mode adds a non-destructive DAW-style editor with lanes, clips, and async AI jobs. Open it from the AudioTrackTable via the **Studio** action, or navigate directly to:

```
/studio/:assetId
```

Key endpoints (new):

- `POST /api/studio/projects` `{ assetId }` -> create project
- `GET /api/studio/projects/by-asset/:assetId` -> load or create project
- `GET /api/studio/projects/:projectId` -> project + lanes + clips + metadata
- `PATCH /api/studio/projects/:projectId` -> update EDL
- `POST /api/studio/projects/:projectId/render` -> start render job
- `POST /api/studio/projects/:projectId/jobs/:jobType` -> start AI job
- `GET /api/jobs/:jobId` -> job status
- `GET /api/jobs/:jobId/events` -> SSE progress stream

### Voice → MIDI (Offline Melody)

Studio includes an **Offline Melody** mode (Dubler-style) for voice → MIDI. It adds:

- Voicing-gate-based note starts (less missed soft notes)
- Legato vs staccato articulation
- Vibrato protection
- Optional key/scale restriction
- Optional pitch-bend stream (not wired to UI yet)

You can tune detection in the Studio UI (Detection Tuning sliders) or use `.env` defaults:

```
VOICE_MIDI_CREPE_CONF=0.35
VOICE_MIDI_CREPE_STABLE_FRAMES=4
VOICE_MIDI_CREPE_HANGOVER=4
VOICE_MIDI_CREPE_MIN_NOTE_MS=0.08
VOICE_MIDI_MIN_NOTE_MS=0.09
VOICE_MIDI_NOTE_GAP_SEC=0.06
VOICE_MIDI_MIN_VELOCITY=40
```

For calibration, use `backend/app/dubler_profile.py`:

```
from backend.app.dubler_profile import calibrate_voice_profile, save_profile
profile = calibrate_voice_profile("path/to/calibration.wav", sample_rate=16000)
save_profile("data/studio/voice_midi/profile.json", profile)
```

### Magic Wand Voice → MIDI (API)

For "intention-first" melody extraction (stable notes, soft key guidance), use:

```
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

- `strict_key=False` (default): key/scale guide the decoder softly (musically aware, but still allows chromatic notes).
- `strict_key=True`: hard restrict to the given scale.

### Export MIDI

```
from backend.app.dubler_melody import events_to_midi_file

events_to_midi_file(notes, cc, pb, "out.mid", tempo_bpm=120)
```

Requires `mido`:

```
pip install mido
```

### Calibrated Profile (Advanced)

You can run calibration once and pass the resulting profile into `transcribe_dubler_melody_v2`:

```
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

### AI Adapter Configuration

Studio AI actions are routed through an adapter. By default the adapter is **NotConfigured** and returns a clear error message.

Enable the local Python adapter by setting:

```
STUDIO_AI_ADAPTER=local
STUDIO_AI_BRIDGE=backend.features.studio.ai_bridge_acestep
```

Optional:

```
STUDIO_AI_PYTHON=python
```

Replace `STUDIO_AI_BRIDGE` with your own script/module that accepts JSON on stdin and returns JSON on stdout.

### CMD Setup (Windows)

Run these in **cmd.exe** for the current session:

```
set STUDIO_AI_ADAPTER=local
set STUDIO_AI_BRIDGE=backend.features.studio.ai_bridge_acestep
set STUDIO_AI_PYTHON=python
```

### Stem Extraction (Instrumental)

Studio supports a `stem_extract` AI job that runs **ACE-Step 1.5 base model** to extract instrument stems
from an **instrumental** track. Each stem is added to its own Studio lane.

Defaults:

- Tracks extracted: `drums`, `bass`, `guitar`, `keyboard`, `strings`, `synth`
- Model: `acestep-v15-base` (base model required for extract/lego/complete tasks)

Make sure the base model checkpoint is present in `ACE-Step-1.5/checkpoints` (see ACE-Step docs for download).

Optional overrides:

```
set STUDIO_AI_EXTRACT_MODEL=acestep-v15-base
```

You can also pass `trackNames` (array or comma-separated string) in the `stem_extract` job payload to control
which stems are extracted.

### Voice/Beat → MIDI Clip

Studio includes a Voice/Beat → MIDI Clip panel that records microphone input and converts it into a MIDI clip
for a target lane (melody or rhythm). This uses a lightweight DSP pipeline (aubio + numpy) and does **not**
play audio during recording.

**Backend WebSocket Service (FastAPI)**

Start the FastAPI WebSocket server in a separate process:

```
uvicorn backend.app.main:app --host 0.0.0.0 --port 8002
```

Frontend connects to:

```
ws://localhost:8002/ws/voice_to_midi
```

You can override the WebSocket URL by setting:

```
REACT_APP_VOICE_MIDI_WS=ws://localhost:8002/ws/voice_to_midi
```

**Melody Engine (Basic Pitch)**

Melody mode uses **Basic Pitch** if available, falling back to the lightweight aubio pipeline if not.

Install:

```
pip install basic-pitch
```

Force a specific engine:

```
VOICE_MIDI_MELODY_ENGINE=basic_pitch
```

or

```
VOICE_MIDI_MELODY_ENGINE=aubio
```

Auto mode (try Basic Pitch first, then CREPE if results are weak):

```
VOICE_MIDI_MELODY_ENGINE=auto
```

Additional tuning (optional):

```
VOICE_MIDI_PREPROCESS=1
VOICE_MIDI_GATE_DB=-45
VOICE_MIDI_GATE_MODE=soft
VOICE_MIDI_LOW_PASS=6000
VOICE_MIDI_HIGH_PASS=80
VOICE_MIDI_TRIM_DB=35
VOICE_MIDI_NORMALIZE=1
VOICE_MIDI_PREPROCESS_SR=22050
VOICE_MIDI_BP_MIN_FREQ=65
VOICE_MIDI_BP_MAX_FREQ=1200
VOICE_MIDI_CREPE_CONF=0.5
VOICE_MIDI_CREPE_FMIN=50
VOICE_MIDI_CREPE_FMAX=800
VOICE_MIDI_CREPE_SR=16000
```

Set `VOICE_MIDI_MELODY_ENGINE=crepe` to use the CREPE pitch model for monophonic vocals.

If the Studio project key is set (e.g., `C minor`), you can enable **Snap to project key** in the Voice → MIDI panel to
snap notes into that scale.

**DDSP (Experimental)**

You can also use DDSP’s f0 extraction as an experimental “pro” engine. This is optional and does not replace
Basic Pitch or CREPE.

Install (optional):

```
pip install ddsp
```

Model placement (for true DDSP synthesis):

```
Rhymix/
  models/
    ddsp/
      piano/
        saved_model.pb  (or saved_model/ directory)
      guitar/
        model.gin
        model.ckpt-XXXX.index
        model.ckpt-XXXX.data-00000-of-00001
      default/
        saved_model.pb
```

You can override the base directory:

```
DDSP_MODEL_DIR=models/ddsp
```

Or provide a per-instrument map:

```
DDSP_MODEL_MAP={"piano":"models/ddsp/piano","guitar":"models/ddsp/guitar","default":"models/ddsp/default"}
```

Env (optional tuning):

```
VOICE_MIDI_DDSP_CONF=0.3
VOICE_MIDI_DDSP_FMIN=50
VOICE_MIDI_DDSP_FMAX=1200
VOICE_MIDI_DDSP_FRAME_RATE=250
VOICE_MIDI_DDSP_STRICT=0
```

**Logging**

To enable backend logs (disabled by default), set:

```
RHYMIX_ENABLE_LOGS=1
RHYMIX_LOG_LEVEL=INFO
```

CREPE logs are emitted under the `voice_midi` logger when enabled.

**Protocol**

Client → Server:

```
{"type":"start","sessionId":"uuid","mode":"melody"|"rhythm","sampleRate":48000,"frameSize":1024,"instrument":"piano","targetBpm":120|null,"targetPPQ":480,"quantize":"1/16"|"off","swing":0.0}
{"type":"stop"}
{"type":"cancel"}
```

Binary frames:

- **int16 PCM little-endian mono**, frameSize samples per message

Server → Client:

```
{"type":"status","state":"recording"|"processing"|"done","progress":0..1}
{"type":"error","message":"..."}
{"type":"final","clip":{...},"midiFileBase64":"...optional...","stats":{...}}
```

Client start payload also supports:

```
"engine": "basic_pitch" | "crepe" | "ddsp"
"engineStrict": true|false
"projectId": "..."
"laneId": "..."
"laneName": "..."
"insertAtSec": 12.34
"ddspSynth": true|false
```

**Result**

The frontend inserts the returned MIDI clip into the selected Studio lane (or creates a new MIDI lane),
quantized to the current Studio grid when BPM is set. If the Studio BPM is unset, you can optionally apply
the detected BPM from the backend.

**MIDI Playback (SoundFont)**

Studio previews MIDI clips using a lightweight SoundFont renderer in the browser.
Default SoundFont: **FluidR3_GM** (loaded from a public CDN).

You can override the SoundFont base URL (self-hosted or custom banks):

```
REACT_APP_SOUNDFONT_URL=https://your-cdn/soundfonts/FluidR3_GM/
```

MIDI clips are stored in the Studio project EDL (`data/studio/projects.json`) alongside audio clips.

To change the SoundFont per MIDI clip, select the MIDI clip and use **Details → SoundFont** in the Inspector.

## Technologies Used

- **Backend**: Flask, Python 3.10
- **Frontend**: React, Material-UI
- **Audio Processing**: librosa, soundfile, pydub, pyannote.audio
- **Machine Learning**: PyTorch, Applio (RVC)
- **Voice Conversion**: RVC (Retrieval-based Voice Conversion)
- **Music Generation**: ACE-Step (AI foundation model for music generation)

## Notes

- **ACE-Step Setup**: ACE-Step may require its own virtual environment and model checkpoints. The application will attempt to use ACE-Step's venv if available, otherwise falls back to the main Python environment
- **Song Generation**: Generated songs can be automatically processed through vocal separation and voice conversion workflows
- Ensure you have sufficient disk space for model training, audio processing, and generated songs
- GPU acceleration is recommended for faster processing, especially for ACE-Step song generation
- The application creates necessary directories automatically on first run

## Troubleshooting

- **CUDA errors**: Ensure you have CUDA 12.1 compatible drivers installed
- **Import errors**: Make sure the virtual environment is activated and all dependencies are installed
- **Port conflicts**: If ports 5000 or 3001 are in use, modify the configuration accordingly
- **Memory issues**: Large audio files may require significant RAM/VRAM

## License

Please refer to the individual component licenses:
- Applio: See `applio/TERMS_OF_USE.md`
- ACE-Step: See `ACE-Step/` directory for license information

## Contributing

This project integrates multiple open-source components. When contributing, please ensure compatibility with existing integrations.
