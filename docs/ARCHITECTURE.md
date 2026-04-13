# Architecture

Rhymix is a three-process application: a Flask REST server, a FastAPI WebSocket service, and a React single-page app. Heavy AI work runs behind a small set of adapters so the same backend can target local GPU inference, a headless server, or a no-op stub for CI.

## Process layout

```
 React SPA (3001) ──HTTP / SSE──► Flask  (5000)
                 └──────WS───────► FastAPI (8002)
```

- **React SPA** — Studio editor, Voice→MIDI panel, Beatbox Wizard, training / inference UIs.
- **Flask (`app.py` + `backend/factory.py`)** — REST API, job queue, SSE progress streams, file uploads / downloads, project EDL storage.
- **FastAPI (`backend/app/main.py`)** — low-latency WebSocket endpoint for realtime voice→MIDI. Kept separate from Flask to avoid blocking the REST loop with audio streaming.

## Backend layout

```
backend/
├── factory.py            Flask app factory, blueprint registration
├── env_bootstrap.py      .env loading, default fallbacks
├── logging_setup.py      RHYMIX_ENABLE_LOGS / RHYMIX_LOG_LEVEL
├── app/
│   ├── main.py           FastAPI entrypoint (WebSocket voice→MIDI)
│   ├── dubler_melody.py  Magic Wand / Dubler-style melody extraction
│   └── dubler_profile.py Voice calibration (load / save profiles)
├── routes/               Base REST routes (upload, download, training, models)
├── features/
│   ├── studio/           EDL + lanes + clips + AI bridge + render jobs
│   ├── song_generation/  ACE-Step job wrapper
│   ├── inference/        RVC voice conversion
│   ├── diarization/      WhisperX + pyannote pipeline
│   ├── beatbox_wizard/   Rhythm capture → MIDI
│   ├── processing/       Vocal / instrumental separation
│   └── llm/              Prompt helpers
├── jobs/                 Background worker + SSE stream broker
└── storage/              File paths, runtime directory layout
```

## Job system

Long-running AI work (song generation, stem extraction, render, voice→MIDI batch, etc.) goes through a single job abstraction:

1. Client `POST`s to a feature endpoint, gets back a `jobId`.
2. The backend enqueues the job and starts it in a worker.
3. Client `GET /api/jobs/:jobId/events` opens an SSE stream and receives `status`, `progress`, and `final` events.
4. When the job finishes, the result lands in the project EDL (for Studio jobs) or a download-ready location.

## Studio EDL

Studio projects are stored as JSON in `data/studio/projects.json`. Each project has:

- **Lanes** — audio, MIDI, or stem lanes, each with their own color and properties.
- **Clips** — non-destructive references to source audio / MIDI files with start / length / gain / fades.
- **Metadata** — project BPM, key, time signature, render settings.

All edits are pure functions over the EDL (`frontend/src/studio/edlOps.js`), which makes undo / redo, AI-driven edits, and headless rendering all trivially consistent.

## AI adapter

Studio AI actions (stem extract, song complete, instrument lego, etc.) are routed through an adapter controlled by `STUDIO_AI_ADAPTER`:

- **`NotConfigured`** (default) — returns a friendly error. Safe for CI.
- **`local`** — spawns a Python subprocess using `STUDIO_AI_BRIDGE` (default: `backend.features.studio.ai_bridge_acestep`). The bridge reads JSON from stdin and writes JSON to stdout.
- You can replace `STUDIO_AI_BRIDGE` with any script / module that follows the same contract, so the same frontend can target a different model server without touching the UI.

## Voice → MIDI engine abstraction

The voice→MIDI pipeline is engine-pluggable via `VOICE_MIDI_MELODY_ENGINE`:

| Engine | When to use |
|---|---|
| `basic_pitch` | Best general-purpose polyphonic-friendly pitch detector. |
| `crepe` | Best for clean monophonic vocals. |
| `ddsp` | Experimental — smoother f0 for sustained notes. |
| `aubio` | Lightweight fallback, no ML dependencies. |
| `auto` | Tries Basic Pitch first, falls back to CREPE if confidence is low. |

All engines produce the same intermediate representation (frame-level f0 + confidence), which then goes through a shared note-builder (voicing gate, hangover, min-note-length, vibrato protection, optional scale snapping, optional Viterbi decoding). The result is a list of `(start, end, pitch, velocity)` events plus optional CC / pitch-bend streams — ready to be written as a MIDI clip or streamed back to the frontend.
