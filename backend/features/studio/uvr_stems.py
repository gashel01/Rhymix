"""Stem separation for the Studio timeline.

This used to be four hand-rolled DSP bands — an HPSS split followed by
Butterworth filters — labelled "drums", "bass", "mids" and "highs". None of
those were stems: "bass" was a lowpass of the harmonic residue and "drums" was
whatever HPSS called percussive, so a bassline bled into the mids and the hats
landed in "drums" together with every transient in the mix. Worse, the one real
step in it — vocal removal — silently returned the untouched input when the UVR
model failed to import, so a failed separation produced four filtered copies of
the original song and reported success.

It now calls the same UVR pipeline that song generation uses, which is a real
separation model and is already installed, and returns what that model actually
produces: vocals and instrumental.
"""

from __future__ import annotations

import shutil
import time
import uuid
from pathlib import Path

from backend.features.processing.service import process_audio_files_thread
from backend.features.studio.assets import probe_audio
from backend.jobs.registry import active_jobs
from backend.paths.manager import paths
from backend.storage.metadata import (
    make_storage_name,
    register_upload_metadata,
    sanitize_filename_for_display,
    unregister_upload_metadata,
)

# The UVR pipeline only writes these two out. Drums and bass do not exist as a
# separate output of it — asking it for them used to return vocals and
# instrumental regardless, so "Extract Drums" never extracted drums.
UVR_STEMS = ("vocals", "instrumental")
# A real four-way split comes from Demucs (htdemucs). "other" is what is left
# once vocals, drums and bass are taken out.
DEMUCS_STEMS = ("vocals", "drums", "bass", "other")
SUPPORTED_STEMS = tuple(dict.fromkeys(UVR_STEMS + DEMUCS_STEMS))


def _publish(produced: Path, key: str) -> dict:
    """Copy a pipeline output into exports and describe it for the timeline."""
    output_name = f"uvr_stem_{key}_{uuid.uuid4().hex}.wav"
    output_path = paths.EXPORT_DIR / output_name
    output_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(produced, output_path)
    info = probe_audio(output_path)
    return {
        "assetId": f"uvr_stem:{uuid.uuid4().hex}",
        "assetPath": str(output_path),
        "assetUrl": f"/api/download/exports/{output_name}",
        "durationSec": info.get("durationSec", 0.0),
        "sampleRate": info.get("sampleRate"),
        "trackName": key,
        "label": key.title(),
    }


def _extract_demucs_stems(source: Path, wanted: list[str]) -> list[dict]:
    """Separate with Demucs' htdemucs model and publish only the requested stems.

    Weights (~80 MB) are fetched by Demucs on first use and cached by torch. Falls back to
    the CPU if the GPU is out of memory — Live VC and this share the card.
    """
    import torch
    from demucs.api import Separator, save_audio

    names = [name for name in wanted if name in DEMUCS_STEMS]
    if not names:
        raise RuntimeError("None of the requested stems can be separated by Demucs.")

    def run(device: str):
        separator = Separator(model="htdemucs", device=device, progress=False)
        _, separated = separator.separate_audio_file(source)
        return separator.samplerate, separated

    try:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        try:
            samplerate, separated = run(device)
        except torch.cuda.OutOfMemoryError:
            torch.cuda.empty_cache()
            samplerate, separated = run("cpu")
    except Exception as exc:  # model download / decode failures surface as the job's error
        raise RuntimeError(f"Stem separation failed: {exc}") from exc

    stems = []
    for name in names:
        tensor = separated.get(name)
        if tensor is None:
            continue
        temp = paths.EXPORT_DIR / f"demucs_tmp_{uuid.uuid4().hex}_{name}.wav"
        temp.parent.mkdir(parents=True, exist_ok=True)
        try:
            save_audio(tensor.cpu(), str(temp), samplerate=samplerate)
            stems.append(_publish(temp, name))
        finally:
            temp.unlink(missing_ok=True)
    if not stems:
        raise RuntimeError("Stem separation produced no output files.")
    return stems


def extract_uvr_multi_stems(source_path: str, stem_names: list[str] | None = None) -> list[dict]:
    if not source_path:
        raise RuntimeError("sourceAssetPath is required for stem extraction.")
    source = Path(source_path)
    if not source.exists():
        raise RuntimeError(f"Source audio not found: {source_path}")

    wanted = [name.strip().lower() for name in (stem_names or UVR_STEMS) if name and name.strip()]
    wanted = [name for name in wanted if name in SUPPORTED_STEMS] or list(UVR_STEMS)
    if any(name not in UVR_STEMS for name in wanted):
        return _extract_demucs_stems(source, wanted)

    # The pipeline works off the shared input directory and keys everything by
    # the stored filename, so the source has to be registered like an upload.
    title_safe = sanitize_filename_for_display(source.stem or "studio_stem")
    stored_name, file_id = make_storage_name(f"{title_safe}.wav")
    input_path = paths.INPUT_DIR / stored_name
    input_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, input_path)
    register_upload_metadata(title_safe, stored_name, file_id)

    job_id = str(uuid.uuid4())
    active_jobs[job_id] = {
        "id": job_id,
        "status": "starting",
        "progress": 0,
        "config": {"segment": False, "process": True, "export": False, "clean": False},
        "started_at": time.time(),
        "fileIds": [file_id],
    }

    try:
        process_audio_files_thread(job_id, segment=False, process=True, export=False, clean=False)
        result = active_jobs.get(job_id, {})
        if result.get("status") == "failed":
            raise RuntimeError(result.get("error") or "Stem separation failed.")

        base = Path(stored_name).stem
        produced = {
            "vocals": paths.UVR_RAW_DIR / f"{base}_vocals.wav",
            "instrumental": paths.INSTRUMENTAL_DIR / f"{base}_instrumental.wav",
        }

        stems = [_publish(produced[key], key) for key in wanted if produced[key].exists()]
        if not stems:
            raise RuntimeError("Stem separation produced no output files.")
        return stems
    finally:
        input_path.unlink(missing_ok=True)
        # The upload record exists only to get this file past the separation
        # pipeline; it must not outlive it and show up as an import.
        unregister_upload_metadata(file_id)
        active_jobs.pop(job_id, None)
