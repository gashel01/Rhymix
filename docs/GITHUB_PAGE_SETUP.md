# GitHub page setup (one-time, manual)

The README and workflows cover everything that lives *inside* the repo, but a handful of settings live on the GitHub page itself and have to be set from the web UI. A recruiter sees these **before** they scroll to the README, so they're worth the two minutes.

Go to: https://github.com/gashel01/Rhymix

## 1. About panel (top-right of the repo page)

Click the ⚙️ next to **About** and paste:

**Description**
```
Full-stack AI music studio — DAW-style editor, song generation, voice conversion, vocal separation, diarization, and live voice→MIDI. Flask + FastAPI + React, powered by ACE-Step, Applio/RVC, WhisperX, and Basic Pitch / CREPE / DDSP.
```

**Website** — leave blank (or add a demo video link if you record one)

**Topics** — paste these (GitHub autocompletes as you type):
```
audio-processing
music-generation
voice-conversion
rvc
speaker-diarization
voice-to-midi
ace-step
applio
whisperx
flask
fastapi
react
pytorch
daw
midi
machine-learning
deep-learning
generative-ai
audio-ai
```

Check:
- ☑ Releases
- ☑ Packages (optional)
- ☐ Deployments (leave off — not relevant)

## 2. Default branch

Settings → Branches → Default branch

If you're going to push the polished version onto `new-backend`, either:
- **Option A (recommended):** Change the default to `new-backend` so github.com/gashel01/Rhymix shows the new README by default.
- **Option B:** Merge `new-backend` into `main` so `main` becomes the polished version.

Without this step, recruiters land on `main` and see whatever's there — which may still be the old version.

## 3. Pin the repo to your profile

On your GitHub profile page (github.com/gashel01), click **Customize your pins** and pin Rhymix. This is the single biggest recruiter signal — pinned repos are what they look at first.

## 4. Optional — social preview image

Settings → General → Social preview → Upload an image

A 1280×640 PNG that shows up when the repo is shared on LinkedIn, Twitter, or in chat. A screenshot of Studio mode with the Rhymix title overlaid works great. Skip if you don't have one yet.

## 5. Enable discussions (optional)

Settings → General → Features → Discussions

Good for personal projects where you want feedback without the overhead of formal issues. Not critical for a recruiter repo but signals the project is alive.
