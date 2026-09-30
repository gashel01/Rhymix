import os
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path

from backend.app import yue2_params
from backend.features.song_generation.jobs_common import SONG_GENERATION_JOBS_DIR, _asset_path as _song_asset_path
from backend.features.song_generation.service import run_song_generation_thread
from backend.features.studio.assets import probe_audio, resolve_asset_path
from backend.features.studio.midi_export import export_midi
from backend.features.studio.midi_render import render_midi_clip
from backend.features.studio.project_edits import (
    append_clip,
    append_midi_clip,
    clip_length_sec,
    create_lane,
    ensure_lane,
    format_key_signature,
    get_lane_by_id,
    register_asset,
    update_project_duration,
)
from backend.features.studio.render import render_mixdown, render_stems
from backend.features.studio.uvr_stems import extract_uvr_multi_stems
from backend.features.studio.storage import (
    append_job_event,
    get_job,
    get_project,
    save_job,
    save_project,
    update_job,
)
from backend.jobs.registry import song_generation_jobs
from backend.paths.manager import paths


def _now_iso():
    from datetime import datetime

    return datetime.now().isoformat()


def create_job(job_type: str, project_id: str, payload: dict | None = None):
    job_id = uuid.uuid4().hex
    job = {
        "id": job_id,
        "type": job_type,
        "projectId": project_id,
        "status": "queued",
        "progress": 0,
        "payload": payload or {},
        "createdAt": _now_iso(),
        "updatedAt": _now_iso(),
        "events": [],
        "error": None,
        "result": None,
    }
    save_job(job)
    append_job_event(job_id, {"type": "status", "status": "queued", "progress": 0})
    return job


def _reload_project_for_async_write(project_id: str, fallback_record: dict) -> dict:
    latest = get_project(project_id)
    if not isinstance(latest, dict):
        return fallback_record
    return latest


def _resolve_asset_path(project_record: dict, asset_id: str) -> Path | None:
    if not asset_id:
        return None
    assets = project_record.get("assets") if isinstance(project_record.get("assets"), dict) else {}
    asset = assets.get(asset_id) if isinstance(assets, dict) else None
    if not asset:
        return None
    raw_path = asset.get("path")
    if not raw_path:
        return None
    try:
        path = Path(raw_path)
    except Exception:
        return None
    return path if path.exists() else None


def _extract_audio_segment(source_path: Path, start_sec: float, end_sec: float, prefix: str) -> Path:
    paths.TEMP_WAV_DIR.mkdir(parents=True, exist_ok=True)
    safe_start = max(0.0, float(start_sec or 0.0))
    safe_end = max(0.0, float(end_sec or 0.0))
    duration = max(0.01, safe_end - safe_start)
    out_path = paths.TEMP_WAV_DIR / f"{prefix}_{uuid.uuid4().hex}.wav"
    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        str(safe_start),
        "-t",
        str(duration),
        "-i",
        str(source_path),
        "-ac",
        "1",
        "-ar",
        "44100",
        str(out_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0 or not out_path.exists():
        raise RuntimeError(result.stderr.strip() or "Failed to extract audio segment")
    return out_path


def _record_stem_result(project_record: dict, payload: dict, result: dict):
    stems = result.get("stems") if isinstance(result, dict) else None
    if not stems:
        return
    source_asset_id = payload.get("sourceAssetId") if isinstance(payload, dict) else None
    for stem in stems:
        if not isinstance(stem, dict):
            continue
        asset_id = stem.get("assetId") or uuid.uuid4().hex
        label = stem.get("label") or stem.get("trackName") or "Stem"
        asset = {
            "id": asset_id,
            "kind": "stem",
            "label": label,
            "url": stem.get("assetUrl"),
            "path": stem.get("assetPath"),
            "durationSec": stem.get("durationSec", 0.0),
            "sampleRate": stem.get("sampleRate"),
        }
        register_asset(project_record, asset)
        lane_name = str(label)
        lane = create_lane(project_record, "stem", lane_name, source_asset_id=source_asset_id)
        append_clip(project_record, lane["id"], asset_id, 0.0, asset.get("durationSec", 0.0))


def _asset_source_path(assets: dict, asset_id):
    """String form of resolve_asset_path, for payloads sent to the AI bridge."""
    resolved = resolve_asset_path(assets, asset_id)
    return str(resolved) if resolved else None


def _record_result(project_record: dict, job_type: str, payload: dict, result: dict):
    if job_type in {"stem_extract", "stem_extract_uvr"}:
        _record_stem_result(project_record, payload, result)
        return
    raise RuntimeError(f"No result recorder for job type: {job_type}")


def run_render_job(job_id: str, project_id: str):
    update_job(job_id, status="running", progress=0, statusMessage="Rendering mixdown...")
    append_job_event(job_id, {"type": "status", "status": "running", "progress": 0})

    project_record = get_project(project_id)
    if not project_record:
        update_job(job_id, status="failed", error="Project not found", progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return

    job_record = get_job(job_id) or {}
    master = (job_record.get("payload") or {}).get("master")

    try:
        output = render_mixdown(project_record, master=master)
        project_record = _reload_project_for_async_write(project_id, project_record)
        asset_id = f"render:{job_id}"
        asset = {
            "id": asset_id,
            "kind": "derived",
            "label": "Render Mixdown",
            "path": output.get("path"),
            "url": output.get("url"),
            "durationSec": output.get("durationSec", 0.0),
            "sampleRate": output.get("sampleRate"),
        }
        register_asset(project_record, asset)
        lane = ensure_lane(project_record, "generated", "Generated Layers")
        append_clip(project_record, lane["id"], asset_id, 0.0, asset.get("durationSec", 0.0))
        update_project_duration(project_record)
        save_project(project_record)

        update_job(job_id, status="completed", progress=100, result={"assetId": asset_id})
        append_job_event(job_id, {"type": "status", "status": "completed", "progress": 100})
    except Exception as exc:
        update_job(job_id, status="failed", progress=100, error=str(exc))
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100, "error": str(exc)})


TERMINAL_JOB_STATUSES = {"completed", "failed", "cancelled"}


def cancel_job(job_id: str):
    """Stop a running job.

    There is no cooperative stop to ask for, so cancelling is just a flag. The
    worker thread checks it before writing a terminal status, so the abort is
    not reported as a failure. Workers that own a subprocess (SoulX) kill it on
    their way out.
    """
    job = get_job(job_id)
    if not job:
        return None, "not_found"
    if job.get("status") in TERMINAL_JOB_STATUSES:
        return job, "already_finished"

    update_job(
        job_id,
        status="cancelled",
        progress=100,
        error="Cancelled",
        statusMessage="Cancelled",
    )
    append_job_event(job_id, {"type": "status", "status": "cancelled", "progress": 100})
    return get_job(job_id), None


def _job_cancelled(job_id: str) -> bool:
    job = get_job(job_id)
    return bool(job and job.get("status") == "cancelled")


def run_stems_render_job(job_id: str, project_id: str):
    """Export one file per lane.

    Unlike the mixdown these aren't added to the timeline as a clip — they are
    an output of the project, not new material for it. They're registered as
    assets so the UI can list and download them.
    """
    update_job(job_id, status="running", progress=0, statusMessage="Rendering stems...")
    append_job_event(job_id, {"type": "status", "status": "running", "progress": 0})

    project_record = get_project(project_id)
    if not project_record:
        update_job(job_id, status="failed", error="Project not found", progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return

    try:
        output = render_stems(project_record)
        project_record = _reload_project_for_async_write(project_id, project_record)

        for index, stem in enumerate(output.get("stems", [])):
            asset = {
                "id": f"stem:{job_id}:{index}",
                "kind": "derived",
                "label": f"Stem · {stem.get('laneName') or index + 1}",
                "path": stem.get("path"),
                "url": stem.get("url"),
                "durationSec": stem.get("durationSec", 0.0),
                "sampleRate": stem.get("sampleRate"),
            }
            register_asset(project_record, asset)

        save_project(project_record)

        update_job(job_id, status="completed", progress=100, result=output)
        append_job_event(job_id, {"type": "status", "status": "completed", "progress": 100})
    except Exception as exc:
        update_job(job_id, status="failed", progress=100, error=str(exc))
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100, "error": str(exc)})


def run_midi_export_job(job_id: str, project_id: str):
    update_job(job_id, status="running", progress=0, statusMessage="Exporting MIDI...")
    append_job_event(job_id, {"type": "status", "status": "running", "progress": 0})

    project_record = get_project(project_id)
    if not project_record:
        update_job(job_id, status="failed", error="Project not found", progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return

    try:
        output = export_midi(project_record)
        project_record = _reload_project_for_async_write(project_id, project_record)
        register_asset(
            project_record,
            {
                "id": f"midi:{job_id}",
                "kind": "derived",
                "label": "MIDI Export",
                "path": output.get("path"),
                "url": output.get("url"),
            },
        )
        save_project(project_record)

        update_job(job_id, status="completed", progress=100, result=output)
        append_job_event(job_id, {"type": "status", "status": "completed", "progress": 100})
    except Exception as exc:
        update_job(job_id, status="failed", progress=100, error=str(exc))
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100, "error": str(exc)})


def run_midi_clip_render_job(job_id: str, project_id: str, payload: dict):
    """Render one MIDI clip through the GM soundfont and point it at its own
    output.

    The notes stay the source of truth — re-running this replaces which
    audio the clip points to, it doesn't fork a new clip — sourceAssetId is
    only ever "what this clip currently sounds like", the same relationship
    a stem or a resynthesized take has to the clip that plays it.
    """
    update_job(job_id, status="running", progress=0, statusMessage="Rendering instrument...")
    append_job_event(job_id, {"type": "status", "status": "running", "progress": 0})

    project_record = get_project(project_id)
    if not project_record:
        update_job(job_id, status="failed", error="Project not found", progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return

    clip_id = payload.get("clipId")
    clips = project_record.get("clips") or []
    clip = next((c for c in clips if c.get("id") == clip_id), None)
    if not clip or clip.get("clipType") != "midi":
        update_job(job_id, status="failed", error="MIDI clip not found", progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return

    # The request can pick an instrument on the spot; otherwise the clip's
    # own choice (Inspector.js's "MIDI Sound" dropdown, already persisted)
    # wins, and a lane the clip sits on can supply a default for either —
    # "Use lane default" in that same dropdown is what an empty
    # clip.midi.soundfont means.
    lane = next((l for l in (project_record.get("lanes") or []) if l.get("id") == clip.get("laneId")), None)
    soundfont = (
        payload.get("soundfont")
        or (clip.get("midi") or {}).get("soundfont")
        or (lane or {}).get("instrument")
    )
    if soundfont:
        clip["midi"] = {**(clip.get("midi") or {}), "soundfont": soundfont}

    try:
        bpm = (project_record.get("project") or {}).get("bpm")
        output = render_midi_clip(clip, bpm=bpm)

        project_record = _reload_project_for_async_write(project_id, project_record)
        asset_id = f"midi_render:{uuid.uuid4().hex}"
        register_asset(
            project_record,
            {
                "id": asset_id,
                "kind": "derived",
                "label": "Instrument Render",
                "path": output.get("path"),
                "url": output.get("url"),
                "durationSec": output.get("durationSec", 0.0),
                "sampleRate": output.get("sampleRate"),
            },
        )

        updated_clips = project_record.get("clips") or []
        for updated_clip in updated_clips:
            if updated_clip.get("id") != clip_id:
                continue
            if soundfont:
                updated_clip["midi"] = {**(updated_clip.get("midi") or {}), "soundfont": soundfont}
            updated_clip["sourceAssetId"] = asset_id
            updated_clip["srcStartSec"] = 0.0
            updated_clip["srcEndSec"] = max(0.01, float(output.get("durationSec") or 0.0))
        project_record["clips"] = updated_clips
        update_project_duration(project_record)
        save_project(project_record)

        update_job(
            job_id, status="completed", progress=100, result={"assetId": asset_id, "clipId": clip_id}
        )
        append_job_event(job_id, {"type": "status", "status": "completed", "progress": 100})
    except Exception as exc:
        update_job(job_id, status="failed", progress=100, error=str(exc))
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100, "error": str(exc)})


def run_soulx_resing_job(job_id: str, project_id: str, payload: dict):
    update_job(job_id, status="running", progress=0, statusMessage="Resynthesizing vocals...")
    append_job_event(job_id, {"type": "status", "status": "running", "progress": 0})

    project_record = get_project(project_id)
    if not project_record:
        update_job(job_id, status="failed", error="Project not found", progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return

    source_asset_id = payload.get("sourceAssetId") or payload.get("assetId")
    lyrics = str(payload.get("lyrics") or "").strip()
    original_lyrics = str(payload.get("originalLyrics") or "").strip()
    if not source_asset_id:
        update_job(job_id, status="failed", error="sourceAssetId is required", progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return
    if not lyrics:
        update_job(job_id, status="failed", error="lyrics are required", progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return

    source_path = _resolve_asset_path(project_record, source_asset_id)
    if not source_path:
        update_job(job_id, status="failed", error="Source audio not found", progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return

    try:
        start_sec = float(payload.get("sourceStartSec") or payload.get("startSec") or 0.0)
        end_sec = float(payload.get("sourceEndSec") or payload.get("endSec") or 0.0)
    except Exception:
        update_job(job_id, status="failed", error="Invalid startSec or endSec", progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return
    if end_sec <= start_sec:
        update_job(job_id, status="failed", error="endSec must be greater than startSec", progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return

    segment_path = None
    try:
        segment_path = _extract_audio_segment(source_path, start_sec, end_sec, "soulx_segment")
        output_name = f"soulx_resing_{uuid.uuid4().hex}.wav"
        paths.EXPORT_DIR.mkdir(parents=True, exist_ok=True)
        output_path = paths.EXPORT_DIR / output_name

        soulx_dir = Path(os.environ.get("SOULX_SINGER_DIR") or (paths.BASE_DIR / "SoulX-Singer"))
        python_exe = Path(
            os.environ.get("SOULX_SINGER_PYTHON") or (soulx_dir / ".venv" / "Scripts" / "python.exe")
        )
        if not soulx_dir.exists():
            raise RuntimeError(f"SoulX-Singer directory not found at {soulx_dir}")
        if not python_exe.exists():
            raise RuntimeError(f"SoulX-Singer venv python not found at {python_exe}")

        language = payload.get("language") or "English"

        cmd = [
            str(python_exe),
            "-m",
            "cli.studio_resing",
            "--input_wav",
            str(segment_path),
            "--lyrics",
            lyrics,
            "--output_wav",
            str(output_path),
            "--language",
            str(language),
        ]
        if original_lyrics:
            cmd.extend(["--prompt_lyrics", original_lyrics])
        result = subprocess.run(
            cmd,
            cwd=str(soulx_dir),
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "SoulX-Singer failed")

        info = probe_audio(output_path)
        result_payload = {
            "assetId": f"soulx_resing:{uuid.uuid4().hex}",
            "assetPath": str(output_path),
            "assetUrl": f"/api/download/exports/{output_name}",
            "durationSec": info.get("durationSec", 0.0),
            "sampleRate": info.get("sampleRate"),
        }

        project_record = _reload_project_for_async_write(project_id, project_record)
        _record_result(project_record, "resynthesize", payload, result_payload)
        update_project_duration(project_record)
        save_project(project_record)

        update_job(job_id, status="completed", progress=100, result={"assetId": result_payload["assetId"]})
        append_job_event(job_id, {"type": "status", "status": "completed", "progress": 100})
    except Exception as exc:
        update_job(job_id, status="failed", progress=100, error=str(exc))
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100, "error": str(exc)})
    finally:
        if segment_path:
            try:
                segment_path.unlink(missing_ok=True)
            except Exception:
                pass


def run_generate_job(job_id: str, project_id: str, payload: dict):
    """Generate new material (song or instrumental, from a typed prompt) and
    land it as a new clip in THIS project only.

    Reuses the standalone Create flow's own engine (YuE2, via
    run_song_generation_thread) rather than a second generation pipeline, but
    deliberately does not go through anything that would make the result show
    up in the general Library: it registers its own transient entry in
    song_generation_jobs (the provider requires one to exist, keyed by job id,
    before it will run), then deletes that entry and its on-disk job folder
    once the audio has been copied out — otherwise it would sit there for
    GET /api/song-generation/jobs's own disk-recovery scan to pick back up
    as an orphaned song days later.
    """
    update_job(job_id, status="running", progress=0, statusMessage="Generating...")
    append_job_event(job_id, {"type": "status", "status": "running", "progress": 0})

    project_record = get_project(project_id)
    if not project_record:
        update_job(job_id, status="failed", error="Project not found", progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return

    prompt = str(payload.get("prompt") or "").strip()
    if not prompt:
        update_job(job_id, status="failed", error="A prompt is required", progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return

    mode = str(payload.get("mode") or "song").strip().lower()
    is_instrumental = mode == "instrumental"
    try:
        duration_sec = max(5, min(180, int(payload.get("durationSec") or 30)))
    except (TypeError, ValueError):
        duration_sec = 30
    start_sec = max(0.0, float(payload.get("startSec") or 0.0))
    lane_id = payload.get("laneId")

    song_job_id = uuid.uuid4().hex
    title = prompt[:60]
    generation_params = {
        "title": title,
        # A magic sentinel YuE2 was trained on for a wordless track, not a
        # placeholder — see next/views/CreateView.js, which uses the same
        # value for its own Instrumental toggle.
        "lyrics": "[instrumental]" if is_instrumental else prompt,
        "style": prompt if is_instrumental else "",
        "duration_seconds": duration_sec,
        "model_mode": yue2_params.MODE_MELODY_AND_CHORDS,
        "instrumental_only": is_instrumental,
        # Stem separation is only needed here to enforce "no vocals" for the
        # instrumental case (see jobs_common._run_separation); a plain song
        # only wants the raw mix, and skipping it roughly halves the wait.
        "separate_stems": is_instrumental,
        "enhance_vocals": False,
        "save_score": False,
        "hum": False,
    }
    errors = yue2_params.validate(generation_params)
    if errors:
        update_job(job_id, status="failed", error=" ".join(errors), progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return

    song_generation_jobs[song_job_id] = {"id": song_job_id}

    stop_polling = threading.Event()

    def _mirror_progress():
        while not stop_polling.wait(1.5):
            sg = song_generation_jobs.get(song_job_id)
            if not sg:
                return
            progress = min(95, int(sg.get("progress") or 0))
            message = sg.get("status_message") or "Generating..."
            update_job(job_id, progress=progress, statusMessage=message)
            append_job_event(job_id, {"type": "status", "status": "running", "progress": progress})

    poll_thread = threading.Thread(target=_mirror_progress, daemon=True)
    poll_thread.start()

    try:
        run_song_generation_thread(song_job_id, generation_params)
        stop_polling.set()

        song_job = song_generation_jobs.get(song_job_id) or {}
        if song_job.get("status") != "completed":
            raise RuntimeError(song_job.get("error") or song_job.get("status_message") or "Generation failed")

        source_path = _song_asset_path(song_job_id, "full_mix")
        if not source_path.exists():
            raise RuntimeError("Generation finished but produced no audio")

        paths.EXPORT_DIR.mkdir(parents=True, exist_ok=True)
        output_name = f"generate_{uuid.uuid4().hex}.wav"
        output_path = paths.EXPORT_DIR / output_name
        shutil.move(str(source_path), str(output_path))

        info = probe_audio(output_path)
        asset_id = f"generate:{uuid.uuid4().hex}"

        project_record = _reload_project_for_async_write(project_id, project_record)
        register_asset(
            project_record,
            {
                "id": asset_id,
                "kind": "generated",
                "label": title or ("Instrumental" if is_instrumental else "Generated Song"),
                "path": str(output_path),
                "url": f"/api/download/exports/{output_name}",
                "durationSec": info.get("durationSec", 0.0),
                "sampleRate": info.get("sampleRate"),
            },
        )
        lane = get_lane_by_id(project_record, lane_id) or ensure_lane(project_record, "generated", "Generated Layers")
        append_clip(project_record, lane["id"], asset_id, start_sec, info.get("durationSec", 0.0))
        update_project_duration(project_record)
        save_project(project_record)

        update_job(job_id, status="completed", progress=100, result={"assetId": asset_id})
        append_job_event(job_id, {"type": "status", "status": "completed", "progress": 100})
    except Exception as exc:
        update_job(job_id, status="failed", progress=100, error=str(exc))
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100, "error": str(exc)})
    finally:
        stop_polling.set()
        song_generation_jobs.pop(song_job_id, None)
        shutil.rmtree(SONG_GENERATION_JOBS_DIR / song_job_id, ignore_errors=True)


AIRGEN_WINDOW_SEC = 15.0
# The drums.pth checkpoint's own trained window: it always regenerates exactly the
# middle span below, anchored by the surrounding context on each side. Hardcoded in
# cli_studio_regen.py's get_mask_2 mask, not a choice this job gets to make.
AIRGEN_REGEN_SPAN_SEC = 7.5
AIRGEN_CONTEXT_SEC = (AIRGEN_WINDOW_SEC - AIRGEN_REGEN_SPAN_SEC) / 2


def run_airgen_regen_job(job_id: str, project_id: str, payload: dict):
    """Regenerate the drums under the timeline selection, guided by AIRGen
    (github.com/Kikyo-16/airgen) - not a general "fill any gap" tool.

    The model's checkpoint only ever regenerates a fixed ~7.5s span in the
    middle of a 15s window it was trained on (~3.75s of real audio anchoring
    it on each side), so the selection's midpoint becomes that window's
    center and the selection itself must fit inside the ~7.5s span - a
    longer selection is rejected rather than silently only fixing part of
    it or stretching the model past what it was trained on.
    """
    update_job(job_id, status="running", progress=0, statusMessage="Rendering mix...")
    append_job_event(job_id, {"type": "status", "status": "running", "progress": 0})

    project_record = get_project(project_id)
    if not project_record:
        update_job(job_id, status="failed", error="Project not found", progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return

    mode = str(payload.get("mode") or "fix_drums").strip()
    if mode not in ("fix_drums", "edit_drums"):
        update_job(job_id, status="failed", error=f"Unsupported mode: {mode}", progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return

    try:
        sel_start = float(payload.get("selStart"))
        sel_end = float(payload.get("selEnd"))
    except (TypeError, ValueError):
        update_job(job_id, status="failed", error="Select a range on the timeline first", progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return
    sel_start, sel_end = min(sel_start, sel_end), max(sel_start, sel_end)
    sel_duration = sel_end - sel_start
    if sel_duration <= 0:
        update_job(job_id, status="failed", error="Select a range on the timeline first", progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return
    if sel_duration > AIRGEN_REGEN_SPAN_SEC:
        update_job(
            job_id,
            status="failed",
            error=(
                f"AIRGen only regenerates {AIRGEN_REGEN_SPAN_SEC:.1f}s at a time - your "
                f"selection is {sel_duration:.1f}s. Select a shorter range."
            ),
            progress=100,
        )
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return

    lane_id = payload.get("laneId")
    window_sec = AIRGEN_WINDOW_SEC
    mix_path = None
    segment_path = None
    try:
        update_job(job_id, progress=5, statusMessage="Rendering mix...")
        append_job_event(job_id, {"type": "status", "status": "running", "progress": 5})
        mix = render_mixdown(project_record)
        mix_path = Path(mix["path"])
        mix_duration = mix.get("durationSec", 0.0)

        # Center the fixed 15s window on the selection's midpoint, then clamp it into the
        # mix's actual bounds - clamping shifts how much context lands on each side, so
        # re-check afterwards that the model's fixed regen span still fully covers the
        # selection rather than trusting the clamp blindly.
        sel_center = (sel_start + sel_end) / 2
        start_sec = max(0.0, min(sel_center - window_sec / 2, mix_duration - window_sec))
        regen_start = start_sec + AIRGEN_CONTEXT_SEC
        regen_end = regen_start + AIRGEN_REGEN_SPAN_SEC
        if mix_duration < window_sec or sel_start < regen_start or sel_end > regen_end:
            raise RuntimeError(
                f"Not enough mix around the selection ({sel_start:.1f}s-{sel_end:.1f}s) for "
                f"AIRGen's {AIRGEN_CONTEXT_SEC:.2f}s of context on each side - needs the "
                f"arrangement to extend further before and/or after it."
            )

        update_job(job_id, progress=15, statusMessage="Extracting window...")
        append_job_event(job_id, {"type": "status", "status": "running", "progress": 15})
        # A little past the 15s AIRGen actually needs, so its own internal
        # onset + DUR*SAMPLE_RATE <= len(audio) check has rounding headroom.
        segment_path = _extract_audio_segment(mix_path, start_sec, start_sec + window_sec + 0.5, "airgen_window")

        airgen_dir = Path(os.environ.get("AIRGEN_DIR") or (paths.BASE_DIR / "AIRGen"))
        python_exe = Path(os.environ.get("AIRGEN_PYTHON") or (airgen_dir / "venv" / "Scripts" / "python.exe"))
        if not airgen_dir.exists():
            raise RuntimeError(f"AIRGen directory not found at {airgen_dir}")
        if not python_exe.exists():
            raise RuntimeError(f"AIRGen venv python not found at {python_exe}")

        checkpoint = airgen_dir / "model_weights" / "drums.pth"
        if not checkpoint.exists():
            raise RuntimeError(f"AIRGen checkpoint not found at {checkpoint}")

        output_name = f"airgen_{mode}_{uuid.uuid4().hex}.wav"
        paths.EXPORT_DIR.mkdir(parents=True, exist_ok=True)
        final_output_path = paths.EXPORT_DIR / output_name

        update_job(job_id, progress=30, statusMessage="Generating (AIRGen)...")
        append_job_event(job_id, {"type": "status", "status": "running", "progress": 30})
        cmd = [
            str(python_exe),
            "cli_studio_regen.py",
            "--audio_path", str(segment_path),
            "--model_path", str(checkpoint),
            "--mode", mode,
            "--output_wav", str(final_output_path),
            "--onset", "0",
        ]
        if mode == "edit_drums":
            drums_path = payload.get("drumsAssetPath")
            if not drums_path:
                raise RuntimeError("edit_drums mode needs a reference drums track")
            cmd.extend(["--drums_path", str(drums_path)])

        result = subprocess.run(cmd, cwd=str(airgen_dir), capture_output=True, text=True, check=False)
        if result.returncode != 0 or not final_output_path.exists():
            raise RuntimeError(result.stderr.strip()[-2000:] or result.stdout.strip()[-2000:] or "AIRGen failed")

        update_job(job_id, progress=90, statusMessage="Placing clip...")
        append_job_event(job_id, {"type": "status", "status": "running", "progress": 90})
        info = probe_audio(final_output_path)
        asset_id = f"airgen_regen:{uuid.uuid4().hex}"

        project_record = _reload_project_for_async_write(project_id, project_record)
        register_asset(
            project_record,
            {
                "id": asset_id,
                "kind": "generated",
                "label": "AI Regen (AIRGen)",
                "path": str(final_output_path),
                "url": f"/api/download/exports/{output_name}",
                "durationSec": info.get("durationSec", 0.0),
                "sampleRate": info.get("sampleRate"),
            },
        )
        # Its own lane, not the target lane it's regenerating from: it overlaps that
        # lane's own audio on the timeline (same window) by design, so the two can be
        # muted/soloed against each other for A/B - dropping it into the source lane
        # would just silently overlap two clips in the same spot.
        lane = get_lane_by_id(project_record, lane_id) or ensure_lane(project_record, "airgen", "AI Regen (AIRGen)")
        clip = append_clip(project_record, lane["id"], asset_id, start_sec, info.get("durationSec", 0.0))
        update_project_duration(project_record)
        save_project(project_record)

        update_job(
            job_id,
            status="completed",
            progress=100,
            result={"assetId": asset_id, "laneId": lane["id"], "clipId": clip.get("id")},
        )
        append_job_event(job_id, {"type": "status", "status": "completed", "progress": 100})
    except Exception as exc:
        update_job(job_id, status="failed", progress=100, error=str(exc))
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100, "error": str(exc)})
    finally:
        for p in (segment_path, mix_path):
            if p:
                try:
                    p.unlink(missing_ok=True)
                except Exception:
                    pass


def run_ai_job(job_id: str, project_id: str, job_type: str, payload: dict):
    """Run one of the Studio's offline audio jobs.

    Only stem separation survives here. The other ten job types (repaint,
    add_layer, cover, understand, lrc, quality_score...) went through an AI
    bridge subprocess backed by ACE-Step; that model was removed, and the
    Studio is being rebuilt rather than ported, so they were failing with
    "AI backend not configured" rather than doing anything.
    """
    update_job(job_id, status="running", progress=0, statusMessage="Separating stems...")
    append_job_event(job_id, {"type": "status", "status": "running", "progress": 0})

    project_record = get_project(project_id)
    if not project_record:
        update_job(job_id, status="failed", error="Project not found", progress=100)
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100})
        return

    try:
        if job_type != "stem_extract_uvr":
            raise RuntimeError(f"Unknown job type: {job_type}")

        assets = project_record.get("assets") if isinstance(project_record.get("assets"), dict) else {}
        source_path = _asset_source_path(assets, payload.get("sourceAssetId"))
        if source_path:
            payload["sourceAssetPath"] = source_path

        result = {"stems": extract_uvr_multi_stems(payload.get("sourceAssetPath"), payload.get("stemNames"))}

        # Killing the job mid-run surfaces here as a normal return; the user
        # asked for it, so don't overwrite the cancelled status.
        if _job_cancelled(job_id):
            return

        project_record = _reload_project_for_async_write(project_id, project_record)
        _record_result(project_record, job_type, payload, result)
        update_project_duration(project_record)
        save_project(project_record)

        update_job(job_id, status="completed", progress=100, result=result)
        append_job_event(job_id, {"type": "status", "status": "completed", "progress": 100})
    except Exception as exc:
        if _job_cancelled(job_id):
            return
        update_job(job_id, status="failed", progress=100, error=str(exc))
        append_job_event(job_id, {"type": "status", "status": "failed", "progress": 100, "error": str(exc)})


def start_job_thread(target, args):
    thread = threading.Thread(target=target, args=args, daemon=True)
    thread.start()
    return thread
