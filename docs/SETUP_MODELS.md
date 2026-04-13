# Model weights setup

`setup.bat` installs all code dependencies automatically, but model weights are too large to include in the repo and must be downloaded once manually. This page lists exactly what you need and where to put it.

## Required for song generation — ACE-Step 1.5

Download the ACE-Step 1.5 checkpoints from the model card and place them in `ACE-Step-1.5/checkpoints/`.

See the [ACE-Step-1.5 README](../ACE-Step-1.5/README.md) for the exact download link and file list — the checkpoint layout varies between the singer and base model variants.

The **base model** (`acestep-v15-base`) is required for stem extraction, lego, and complete tasks in Studio. The **singer model** is required for song generation.

## Required for voice conversion — RVC pretrained models

Download from HuggingFace: https://huggingface.co/lj1995/VoiceConversionWebUI

Place the files in:

```
rvc/
  models/
    pretraineds/      ← pretrained encoder + discriminator weights
    embedders/
      contentvec/
        pytorch_model.bin
    predictors/
      fcpe.pt
      rmvpe.pt
    formant/
      stftpitchshift.exe   (Windows only)
```

These are needed before you can train a voice model or run inference.

## Optional — DDSP models (experimental voice → MIDI engine)

Only needed if you set `VOICE_MIDI_MELODY_ENGINE=ddsp`. Place saved models in:

```
models/
  ddsp/
    default/
      saved_model.pb    (or saved_model/ directory)
    piano/              (optional, per-instrument override)
    guitar/             (optional)
```

See [docs/CONFIGURATION.md](CONFIGURATION.md#ddsp-experimental) for override env vars.

## Optional — CREPE model cache

CREPE downloads its weights automatically on first use via `torchcrepe`. They land in the torchcrepe cache directory (`~/.cache/torchcrepe/` on Windows). No manual step needed.

## Optional — WhisperX model cache

WhisperX downloads the Whisper model on first use. The model is controlled by `WHISPERX_MODEL` (default: `base`). Larger models (`small`, `medium`, `large-v2`) are more accurate but slower. The download happens automatically inside the WhisperX venv.

## Checking everything is in place

After downloading, run the app (`run_all.bat`) and navigate to each feature:

- **Song generation** → if ACE-Step checkpoints are missing, the job will fail with a clear checkpoint error.
- **Voice conversion** → if RVC pretraineds are missing, the training or inference step will error on startup.
- **Diarization** → whisperX downloads its model on first run; allow ~1 min on a slow connection.
