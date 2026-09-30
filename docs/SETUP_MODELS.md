# Model weights setup

`setup.bat` installs all code dependencies automatically, but model weights are too large to include in the repo and must be downloaded once manually. This page lists exactly what you need and where to put it.

## Song generation — YuE2 (downloads itself)

Nothing to do by hand. YuE2 runs inside [WanGP](https://github.com/deepbeepmeep/Wan2GP), which `setup.bat` installs as a sibling of this repo, and WanGP fetches the checkpoints into `../WanGP/ckpts/` the first time you pick the model. Budget roughly **5.5 GB**:

| File | Size | Purpose |
|---|---|---|
| `YuE2_Acoustic_int8_convrot.safetensors` | 1.4 GB | Acoustic model, INT8 — the low-VRAM path |
| `YuE2_AR/` | 2.7 GB | Autoregressive text encoder |
| `sheetsage2/` | 1.3 GB | Audio → ABC/MIDI transcription, used by covers |

> **Licence.** YuE2's weights are **CC BY-NC 4.0 — non-commercial**. The code is Apache-2.0. Anything you generate with it inherits that restriction in spirit; Rhymix says so on every generated job. WanGP's terms also require disclosing that this project uses it.

**On an 8 GB card**, pick the `int8_convrot` weights rather than `bf16`, and make sure `lm_decoder_engine` is `vllm` in `../WanGP/wgp_config.json`. That needs Triton ≥ 3.6 and FlashAttention 2, both installed by `setup.bat`; without them YuE2 falls back to SDPA and runs roughly twice as slow. Measured on an RTX 3070 Ti Laptop: ~4.3 GB peak, about 1.35× real time.

ACE-Step was removed. If you are upgrading an old checkout, `ACE-Step-1.5/` and its venv are no longer referenced by anything and can be deleted.

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

## Checking everything is in place

After downloading, run the app (`run_all.bat`) and navigate to each feature:

- **Song generation** → WanGP downloads the YuE2 weights on first use, with a progress bar. If `WANGP_DIR` is wrong or its venv is missing, the job fails with a message naming the path it looked in.
- **Voice conversion** → if RVC pretraineds are missing, the training or inference step will error on startup.
- **Diarization** → pyannote downloads its model on first run; allow ~1 min on a slow connection.
