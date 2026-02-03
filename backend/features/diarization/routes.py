import glob
import json
import logging
import os
import re
import shutil
import subprocess
import threading
import time
import traceback
import urllib.parse
import uuid
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file
from werkzeug.utils import secure_filename

from backend.features.diarization.service import formatTimestamp, job_status_cache, run_diarization_process
from backend.jobs.registry import active_jobs
from backend.paths.manager import paths

bp = Blueprint("diarization", __name__)
logger = logging.getLogger(__name__)


@bp.route("/api/upload-talking", methods=["POST"])
def upload_talking_file():
    """Handle the upload of audio files for diarization"""
    try:
        if "audio" not in request.files:
            return jsonify({"error": "No file part"}), 400
        f = request.files["audio"]
        if f.filename == "":
            return jsonify({"error": "No selected file"}), 400

        job_id = str(uuid.uuid4())
        script_root = os.path.abspath("diarization/pyannote-diarization")

        paths.DIARIZATION_INPUT.mkdir(parents=True, exist_ok=True)
        paths.SPEAKER_DIR.mkdir(parents=True, exist_ok=True)

        original_filename = secure_filename(f.filename)
        input_audio_path = paths.DIARIZATION_INPUT / original_filename
        f.save(input_audio_path)

        print(f"Saved audio file to: {input_audio_path}")
        print(f"Using speaker directory at: {paths.SPEAKER_DIR}")

        active_jobs[job_id] = {
            "status": "preprocessing",
            "input_audio_path": str(input_audio_path),
            "original_filename": original_filename,
            "started_at": int(time.time()),
            "job_id": job_id,
            "script_root": script_root,
            "status_message": "Starting vocal separation...",
        }

        threading.Thread(
            target=run_diarization_process, args=(job_id, str(input_audio_path), original_filename)
        ).start()
        return jsonify(
            {
                "job_id": job_id,
                "original_filename": original_filename,
                "status": "preprocessing",
                "status_message": "Starting vocal separation...",
            }
        )
    except Exception as e:
        print(f"Error in upload-talking: {e}")
        traceback.print_exc()
        return jsonify({"error": f"Upload failed: {str(e)}"}), 500


@bp.route("/api/talking-status/<job_id>")
def talking_status(job_id):
    try:
        if job_id not in active_jobs:
            print(f"Job ID not found in active_jobs: {job_id}")
            print(f"Available job IDs: {list(active_jobs.keys())}")
            return jsonify({"error": "Job not found", "job_id": job_id}), 404

        job, now = active_jobs[job_id], int(time.time())

        if job_id in job_status_cache:
            st, t = job_status_cache[job_id]
            if st in ["completed", "failed", "error"] and now - t < 5:
                return jsonify(
                    {
                        "status": st,
                        "status_message": job.get("status_message", ""),
                        "error": job.get("error"),
                        "unique_id": job_id,
                    }
                )

        if job.get("status") == "completed":
            base = job.get("original_filename", "").split(".")[0]
            spkdir = paths.TALKING_RESULTS_DIR / base
            if os.path.exists(spkdir):
                subs = [
                    d
                    for d in os.listdir(spkdir)
                    if d.startswith("speaker_") and os.path.isdir(os.path.join(spkdir, d))
                ]
                if subs:
                    print(f"Found {len(subs)} speaker directories in {spkdir}")
                else:
                    print(f"No speaker subdirectories found in {spkdir}")
                    job["status"] = "completed_but_no_speakers"
            else:
                print(f"Speaker directory not found: {spkdir}")
                job["status"] = "completed_but_no_directory"

        job_status_cache[job_id] = (job["status"], now)
        return jsonify(
            {
                "status": job["status"],
                "status_message": job.get("status_message", ""),
                "error": job.get("error"),
                "unique_id": job_id,
            }
        )

    except Exception as e:
        print(f"Error in talking status: {e}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@bp.route("/api/play-speaker-sample/<job_id>/<speaker_name>")
def play_speaker_sample(job_id, speaker_name):
    if job_id not in active_jobs:
        return jsonify({"error": "Job not found"}), 404
    job = active_jobs[job_id]
    if job.get("status") != "completed":
        return jsonify({"error": "Job not completed yet"}), 400

    sp = (job.get("speakers") or {}).get(speaker_name)
    if not sp:
        return jsonify({"error": f"Speaker {speaker_name} not found"}), 404

    p = Path(sp.get("first_sample") or "")
    if p and p.exists():
        return send_file(p, mimetype="audio/wav", as_attachment=False)

    d = Path(sp.get("path") or "")
    segs = list(d.glob("*.wav")) if d.is_dir() else []
    if segs:
        return send_file(segs[0], mimetype="audio/wav", as_attachment=False)

    return jsonify({"error": f"No audio samples found for {speaker_name}"}), 404


@bp.route("/api/available-talking-datasets")
def available_talking_datasets():
    try:
        if not paths.SPEAKER_DIR.exists():
            return jsonify({"datasets": []})

        ds = []
        for song in paths.SPEAKER_DIR.iterdir():
            if not song.is_dir():
                continue
            spk = [d for d in song.iterdir() if d.is_dir() and d.name.startswith("speaker_")]
            if not spk:
                continue
            counts = [len(list(d.glob("*.wav"))) for d in spk]
            sample = next((str(w[0]) for d in spk if (w := list(d.glob("*.wav")))), None)
            ds.append(
                {
                    "name": song.name,
                    "path": str(song),
                    "speaker_count": len(spk),
                    "sample_count": sum(counts),
                    "sample_audio": sample,
                }
            )

        return jsonify({"datasets": sorted(ds, key=lambda x: x["name"])})
    except Exception as e:
        print(f"Error fetching talking datasets: {e}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@bp.route("/api/speaker-samples/<job_id>/<speaker_name>")
def get_speaker_samples(job_id, speaker_name):
    try:
        def samples_for(path: Path):
            out = []
            for i, w in enumerate(sorted(path.glob("*.wav")), 1):
                try:
                    import wave

                    with wave.open(str(w), "rb") as wf:
                        dur = wf.getnframes() / wf.getframerate()
                except Exception:
                    dur = 5.0
                out.append(
                    {
                        "id": i,
                        "name": f"Segment {i}",
                        "path": str(w),
                        "url": f"/api/play-segment/{w.name}?path={urllib.parse.quote(str(path))}",
                        "duration": dur,
                    }
                )
            return out

        if job_id.startswith("dataset-"):
            name = job_id[8:]
            sp = next(
                (
                    sd / speaker_name
                    for sd in paths.SPEAKER_DIR.iterdir()
                    if paths.SPEAKER_DIR.exists()
                    and sd.is_dir()
                    and (sd.name == name or name in sd.name)
                    and (sd / speaker_name).is_dir()
                ),
                None,
            )
            if not sp:
                return jsonify({"error": f"Speaker {speaker_name} not found in dataset {name}"}), 404
            return jsonify({"speaker": speaker_name, "dataset": name, "samples": samples_for(sp)})

        if job_id not in active_jobs:
            return jsonify({"error": "Job not found"}), 404
        job = active_jobs[job_id]
        if job.get("status") != "completed":
            return jsonify({"error": "Job not completed yet"}), 400
        spinfo = (job.get("speakers") or {}).get(speaker_name)
        if not spinfo:
            return jsonify({"error": f"Speaker {speaker_name} not found in job {job_id}"}), 404

        sp = Path(spinfo["path"])
        if not sp.exists():
            return jsonify({"error": f"Speaker directory not found: {sp}"}), 404
        return jsonify({"speaker": speaker_name, "job_id": job_id, "samples": samples_for(sp)})

    except Exception as e:
        print(f"Error getting speaker samples: {e}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@bp.route("/api/play-segment/<path:segment_filename>")
def play_segment_file(segment_filename):
    """Play a specific segment file"""
    speaker, job_id = request.args.get("speaker"), request.args.get("job_id")
    if not (speaker and job_id and segment_filename):
        return jsonify({"error": "Missing parameters"}), 400

    try:
        job_dir = job_id[8:] if job_id.startswith("dataset-") else job_id
        sp = speaker.lower()
        m = re.match(r"speaker\s+(\d+)$", sp)
        sp = f"speaker_{m.group(1).zfill(2)}" if m else sp

        d = paths.TALKING_RESULTS_DIR / job_dir / sp

        # if client sends wildcard patterns, honor them
        if any(x in segment_filename for x in "*?"):
            match = next(iter(d.glob(segment_filename)), None)
            if match:
                return send_file(match, mimetype="audio/wav", as_attachment=False)

        p = d / segment_filename
        if not p.exists() and segment_filename.startswith("part"):
            num = (re.match(r"part(\d+)", segment_filename) or [None, None])[1]
            p = next(iter(d.glob(f"part{num}*.wav")), None) if num else None
            p = p or next(iter(d.glob("*.wav")), None)  # final fallback: first wav

        if not (p and p.exists()):
            return jsonify({"error": f"Segment file not found for speaker {speaker.lower()}"}), 404

        return send_file(p, mimetype="audio/wav", as_attachment=False)

    except Exception as e:
        logger.error(f"Error serving segment file: {e}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@bp.route("/api/play-original-audio/<job_id>")
def play_original_audio(job_id):
    try:
        d = paths.TALKING_UPLOADS_DIR
        if not d.exists():
            return jsonify({"error": "Uploads directory not found", "job_id": job_id}), 404

        f = [p for p in d.glob("*.wav") if not p.name.lower().endswith("vocals.wav")]
        if len(f) != 1:
            return jsonify({"error": f"Expected one original wav file, found {len(f)} in {d}", "job_id": job_id}), 404

        return send_file(f[0], mimetype="audio/wav", as_attachment=False)
    except Exception as e:
        logger.error(f"Error getting original audio: {e}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@bp.route("/api/diarization-timeline/<job_id>")
def get_diarization_timeline(job_id):
    print(f"Getting diarization timeline for job {job_id}")
    try:
        files = glob.glob(str(paths.TALKING_RESULTS_DIR / "*_diarization.txt"))
        if not files:
            return jsonify({"error": "Diarization data not found"}), 404
        diarization_file = files[0]
        logger.info(f"Found diarization file at: {diarization_file}")

        tl, by_spk = [], {}
        for line in Path(diarization_file).read_text().splitlines():
            m = re.match(r"\\[(\\d+(?:\\.\\d+)?)\\s*-\\s*(\\d+(?:\\.\\d+)?)\\]\\s+(\\w+)", line.strip())
            if not m:
                continue
            s, e, spk = float(m[1]), float(m[2]), m[3]
            disp = spk.replace("SPEAKER_", "Speaker ")
            seg = {
                "id": f"segment-{len(tl)}",
                "start": s,
                "end": e,
                "speaker": disp,
                "text": f"{disp}: {formatTimestamp(s)} - {formatTimestamp(e)}",
            }
            tl.append(seg)
            by_spk.setdefault(spk, []).append(seg)

        tl.sort(key=lambda x: x["start"])
        total = tl[-1]["end"] if tl else 0.0

        # add Unknown segments if folder exists
        job_dir = job_id[8:] if job_id.startswith("dataset-") else job_id
        unk_dir = paths.TALKING_RESULTS_DIR / job_dir / paths.TALKING_SPEAKER_UNKNOWN_DIR_SUFFIX
        logger.info(f"Looking for unknown speaker directory at: {unk_dir}")

        def parse_times(name):
            # unknown_1_01m23s-01m45s.wav OR part1_01m23s-01m45s.wav
            m = re.search(r"(?:unknown|part)(\\d+)_([0-9]+)m([0-9]+)s-([0-9]+)m([0-9]+)s", name)
            if m:
                n = int(m[1])
                s = int(m[2]) * 60 + int(m[3])
                e = int(m[4]) * 60 + int(m[5])
                return n, float(s), float(e)
            # optional precise: _12.345s-67.890s anywhere
            m = re.search(r"(\\d+(?:\\.\\d+)?)s-(\\d+(?:\\.\\d+)?)s", name)
            if m:
                return None, float(m[1]), float(m[2])
            # old: part7.wav
            m = re.match(r"part(\\d+)\\.wav$", name, re.I)
            if m:
                return int(m[1]), None, None
            return None, None, None

        if unk_dir.is_dir():
            wavs = sorted([p for p in unk_dir.iterdir() if p.suffix.lower() == ".wav"])
            if wavs:
                logger.info(f"Found {len(wavs)} Unknown speaker segments to add to timeline")
                unknown = []
                for i, w in enumerate(wavs, 1):
                    try:
                        import wave

                        with wave.open(str(w), "rb") as wf:
                            dur = wf.getnframes() / wf.getframerate()
                        n, s, e = parse_times(w.name)
                        if s is None or e is None:
                            # simple placement fallback (kept, but no fancy snapping)
                            s = i * (total / (len(wavs) + 1)) if total else 0.0
                            e = s + dur
                        unknown.append(
                            {
                                "id": f"unknown-{n or i}",
                                "start": s,
                                "end": e,
                                "speaker": "Unknown",
                                "text": "No speech detected",
                            }
                        )
                    except Exception as ex:
                        logger.error(f"Error processing unknown segment {w}: {ex}", exc_info=True)

                tl.extend(unknown)
                tl.sort(key=lambda x: x["start"])
                by_spk["Unknown"] = unknown
        else:
            logger.info(f"No unknown speaker segments found for job {job_id}")

        return jsonify({"timeline": tl, "speakers": list(by_spk.keys())})

    except Exception as e:
        logger.error(f"Error getting diarization timeline: {e}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@bp.route("/api/extract-segment")
def extract_segment():
    job_id, start, end = (request.args.get(k) for k in ("job_id", "start", "end"))
    seg_id = request.args.get("segment_id", "unknown")
    is_gap = request.args.get("is_gap", "false").lower() in ("true", "yes", "t", "1")
    debug = request.args.get("debug", "false").lower() in ("true", "yes", "t", "1")

    if not (job_id and start is not None and end is not None):
        return jsonify({"error": "Missing required parameters"}), 400

    try:
        s, e = float(start), float(end)
        dur = e - s

        job = active_jobs.get(job_id)
        if not job:
            jp = Path(f"diarization/pyannote-diarization/jobs/{job_id}.json")
            if jp.exists():
                try:
                    job = json.loads(jp.read_text())
                except Exception as ex:
                    logger.error(f"Error loading job from disk: {ex}")

        audio = job.get("input_audio_path") if job else None
        if audio and not os.path.exists(audio):
            audio = None

        if not audio:
            base = job_id.replace("dataset-", "")
            exts = ("wav", "mp3", "ogg", "m4a")
            for d in (paths.ORIGINAL_AUDIO_DIR, paths.DIARIZATION_INPUT):
                hits = list(d.glob(f"{base}.*")) or [p for x in exts for p in d.glob(f"*{base}*.{x}")]
                if hits:
                    audio = str(hits[0])
                    break

        if not audio:
            if debug:
                return jsonify(
                    {
                        "error": "Could not find original audio file",
                        "job_id": job_id,
                        "job_exists": job is not None,
                        "job_keys": list(job.keys()) if job else None,
                        "original_audio_dir_files": [str(f) for f in paths.ORIGINAL_AUDIO_DIR.glob("*")],
                        "diarization_input_files": [str(f) for f in paths.DIARIZATION_INPUT.glob("*")],
                    }
                ), 404
            return jsonify({"error": "Original audio file not found"}), 404

        if not os.path.exists(audio):
            return jsonify({"error": f"Original audio file not found at path: {audio}"}), 404

        tmp = Path("diarization/pyannote-diarization/temp_segments")
        tmp.mkdir(parents=True, exist_ok=True)
        out = tmp / f"{'gap' if is_gap else 'segment'}_{seg_id}_{job_id}_{s:.2f}_{e:.2f}.wav"

        if not out.exists():
            cmd = [
                "ffmpeg",
                "-y",
                "-ss",
                str(s),
                "-i",
                str(audio),
                "-t",
                str(dur),
                "-acodec",
                "pcm_s16le",
                "-ar",
                "44100",
                "-ac",
                "1",
                str(out),
            ]
            p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if p.returncode != 0:
                return jsonify({"error": f"Error extracting segment: {p.stderr}"}), 500

        return send_file(out, mimetype="audio/wav", as_attachment=False)

    except Exception as e:
        logger.error(f"Error in extract-segment: {e}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@bp.route("/api/reassign-segment", methods=["POST"])
def reassign_segment():
    try:
        d = request.get_json() or {}
        job_id, seg_id, tgt, orig = (d.get(k) for k in ("job_id", "segment_id", "target_speaker", "original_speaker"))
        start, end = d.get("start"), d.get("end")
        if not all([job_id, seg_id, tgt, orig]):
            return jsonify({"error": "Missing required parameters"}), 400
        if start is None or end is None:
            return jsonify({"error": "Missing segment start or end time"}), 400
        try:
            float(start)
            float(end)
        except (ValueError, TypeError):
            return jsonify({"error": f"Invalid start or end time values: start={start}, end={end}"}), 400

        t = tgt.lower()
        m = re.match(r"speaker\\s+(\\d+)", t)
        norm = f"speaker_{m.group(1).zfill(2)}" if m else tgt

        job_dir = job_id[8:] if job_id.startswith("dataset-") else job_id
        spdir = Path(f"diarization/pyannote-diarization/foldersong/{job_dir}/{norm}")
        spdir.mkdir(parents=True, exist_ok=True)

        parts = [int(f.stem[4:]) for f in spdir.glob("part*.wav") if f.stem[4:].isdigit()]
        nxt = (max(parts) + 1) if parts else 1

        return jsonify({"success": True, "part_number": nxt, "speaker_name": tgt, "normalized_speaker": norm})
    except Exception as e:
        logger.error(f"Error in reassign-segment: {e}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@bp.route("/api/move-segment", methods=["POST"])
def move_segment():
    try:
        d = request.get_json() or {}
        job_id, seg_id, orig, tgt, part = (
            d.get(k) for k in ("job_id", "segment_id", "original_speaker", "target_speaker", "part_number")
        )
        if not all([job_id, seg_id, orig, tgt, part]):
            return jsonify({"error": "Missing required parameters"}), 400

        def norm(s):
            m = re.match(r"speaker\\s+(\\d+)", s.lower())
            return f"speaker_{m.group(1).zfill(2)}" if m else s.lower()

        job_dir = job_id[8:] if job_id.startswith("dataset-") else job_id
        base = Path("diarization/pyannote-diarization/foldersong") / job_dir
        src_dir, dst_dir = base / norm(orig), base / norm(tgt)
        dst_dir.mkdir(parents=True, exist_ok=True)

        src = (src_dir / f"part{part}.wav") if src_dir.exists() else None
        src = src if (src and src.exists()) else next(iter(src_dir.glob("*.wav")), None)
        if not src:
            return jsonify({"error": "Source file not found"}), 404

        dst = dst_dir / f"part{part}.wav"
        shutil.move(src, dst)

        return jsonify({"success": True, "source": str(src), "target": str(dst)})
    except Exception as e:
        logger.error(f"Error in move-segment: {e}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
