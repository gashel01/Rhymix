# API Reference

Rhymix exposes two interfaces: a Flask REST API on port **5000** and a FastAPI WebSocket service on port **8002**.

## REST API (Flask, port 5000)

### Song generation (ACE-Step)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/song-generation/start` | Start a new song generation job. |
| `GET`  | `/api/song-generation/status/<job_id>` | Check job status. |
| `GET`  | `/api/song-generation/jobs` | List all song generation jobs. |
| `GET`  | `/api/song-generation/audio/<job_id>` | Stream the generated song. |

### Audio processing

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/upload` | Upload audio files. |
| `POST` | `/api/process` | Run vocal / instrumental separation. |
| `GET`  | `/api/download/<file_type>/<filename>` | Download processed files. |

### Speaker diarization (WhisperX + pyannote)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/upload-talking` | Upload files for speaker diarization. |
| `GET`  | `/api/talking-status/<job_id>` | Check diarization status. |

### Voice conversion (RVC)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/train` | Train a voice model. |
| `POST` | `/api/inference` | Run voice conversion inference. |

### Studio

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/studio/projects` | Create a project (`{ assetId }`). |
| `GET`  | `/api/studio/projects/by-asset/:assetId` | Load or create a project for an asset. |
| `GET`  | `/api/studio/projects/:projectId` | Full project (lanes + clips + metadata). |
| `PATCH`| `/api/studio/projects/:projectId` | Update the EDL. |
| `POST` | `/api/studio/projects/:projectId/render` | Start a render job. |
| `POST` | `/api/studio/projects/:projectId/jobs/:jobType` | Start an AI job (stem_extract, complete, etc). |

### Jobs (shared)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/jobs/:jobId` | Job status. |
| `GET` | `/api/jobs/:jobId/events` | SSE stream of status / progress / final events. |

---

## WebSocket API (FastAPI, port 8002)

```
ws://localhost:8002/ws/voice_to_midi
```

### Client → Server

Control messages are JSON. Audio frames are binary **int16 PCM little-endian mono**, `frameSize` samples per message.

```jsonc
// start
{
  "type": "start",
  "sessionId": "uuid",
  "mode": "melody" | "rhythm",
  "sampleRate": 48000,
  "frameSize": 1024,
  "instrument": "piano",
  "targetBpm": 120,        // or null
  "targetPPQ": 480,
  "quantize": "1/16",      // or "off"
  "swing": 0.0,

  // optional
  "engine": "basic_pitch" | "crepe" | "ddsp",
  "engineStrict": true,
  "projectId": "...",
  "laneId": "...",
  "laneName": "...",
  "insertAtSec": 12.34,
  "ddspSynth": false
}
```

```jsonc
{ "type": "stop"   }
{ "type": "cancel" }
```

### Server → Client

```jsonc
{ "type": "status", "state": "recording" | "processing" | "done", "progress": 0.42 }
{ "type": "error",  "message": "..." }
{ "type": "final",  "clip": { /* MIDI clip */ }, "midiFileBase64": "...", "stats": { /* ... */ } }
```

The frontend inserts the returned MIDI clip into the selected Studio lane, quantized to the current grid when BPM is set.
