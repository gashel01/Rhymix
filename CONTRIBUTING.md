# Contributing to Rhymix

Rhymix is a personal R&D project, but PRs, issues, and ideas are welcome. This guide covers how to get the repo running locally and what I expect from a contribution.

## Before you start

- Open an issue first for anything non-trivial (new feature, big refactor). A 30-second "does this make sense?" conversation saves everyone time.
- For bug reports, include: OS, Python version, GPU + CUDA version, and the smallest reproduction you can manage.
- For typos, docs fixes, and tiny tweaks, just open a PR directly.

## Dev setup

```bash
# 1. Clone and create the venv
git clone https://github.com/gashel01/Rhymix.git
cd Rhymix
py -3.10 -m venv venv
venv\Scripts\activate

# 2. Install deps (CUDA 12.1 PyTorch separately)
pip install -r requirements.txt
pip install torch==2.4.1 torchvision==0.19.1 torchaudio==2.4.1 \
    --index-url https://download.pytorch.org/whl/cu121

# 3. Frontend
cd frontend && npm install && cd ..

# 4. Env
copy .env.example .env      # tweak as needed

# 5. Run
run_all.bat                  # starts Flask + FastAPI + React
```

For the full configuration reference see [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Project layout

Only the directories authored in this repo are tracked. The AI model repos (ACE-Step, Applio, WhisperX, SoulX-Singer, stable-audio-tools, stage) live alongside at runtime but are git-ignored. If you're contributing, you should only need to touch code under:

- `app/`, `backend/` — Flask + FastAPI backend
- `frontend/src/` — React app (Studio, Beatbox Wizard, components, hooks)
- `tests/` — pytest unit tests
- `docs/` — documentation

## Running tests

```bash
pytest tests/
```

CI runs the same tests on every push (see `.github/workflows/ci.yml`). If you add a new test that needs a new dependency, add that dependency to **both** `requirements.txt` and `requirements-ci.txt` (the latter is the minimal set CI installs).

## Coding style

- **Python** — follow PEP 8. Type hints where they help, not everywhere. No new unpinned dependencies in `requirements.txt`.
- **JavaScript / React** — match the existing style in `frontend/src/`. Functional components with hooks. Keep EDL operations pure (see `frontend/src/studio/edlOps.js`).
- **Commits** — clear one-line subject, wrap the body at 72 chars if you need one. Prefer small focused commits over one giant "fix everything" commit.

## Pull requests

1. Branch off the current default branch (`new-backend`).
2. Keep the PR scoped to one thing.
3. Run `pytest tests/` and `npm --prefix frontend run build` locally before opening the PR.
4. The CI check must be green before I'll merge.
5. Describe *why* the change is needed, not just *what* it does — the diff already shows the what.

## Things that are out of scope

- Containerization / Docker — Rhymix needs CUDA, local model checkpoints, and a mic. It's not meant to run in a container.
- Porting to non-Windows — I'll accept cross-platform fixes but won't block Windows-specific PRs for them.
- Pulling the vendored AI repos into this repo — they stay external, always.

Thanks for contributing!
