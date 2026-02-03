import logging
import os
import re
import tempfile
import urllib.parse
import uuid
from pathlib import Path

from flask import Blueprint, after_this_request, jsonify, request, send_file

from backend.paths.manager import paths
from backend.storage.inference_runs import load_inference_run_metadata
from backend.storage.metadata import get_upload_base_name

bp = Blueprint("download", __name__)


def _sanitize_download_name(value, fallback):
    name = os.path.basename(str(value or ""))
    name = re.sub(r'[\\/:*?"<>|]+', "_", name)
    name = re.sub(r"_+", "_", name).strip("._ ")
    return name or fallback


@bp.route("/api/download/<file_type>/<path:filename>")
def download_file(file_type, filename):
    try:
        print(f"Download request - Type: {file_type}, Filename: {filename}")
        filename = os.path.basename(urllib.parse.unquote(filename))
        print(f"Sanitized filename: {filename}")
        requested_download_name = request.args.get("downloadName")

        dir_map = {
            "raw_vocals": paths.UVR_RAW_DIR,
            "processed_vocals": paths.UVR_PROCESSED_DIR,
            "exports": paths.EXPORT_DIR,
            "instrumental": paths.INSTRUMENTAL_DIR,
        }
        if file_type not in dir_map:
            print(f"Invalid file type: {file_type}")
            return jsonify({"error": f"Invalid file type: {file_type}"}), 400

        target_dir = dir_map[file_type]
        print(f"Looking in directory: {target_dir}")

        if not target_dir.exists():
            print(f"Directory does not exist: {target_dir}")
            return (
                jsonify({"error": f"Directory {file_type} does not exist", "directory": str(target_dir)}),
                404,
            )

        existing = [f.name for f in target_dir.glob("*.wav")]
        print(f"Files in directory ({len(existing)}): {existing[:5]}...")

        file_path = target_dir / filename
        file_id = filename
        if file_type in {"raw_vocals", "processed_vocals", "instrumental"}:
            base_name = get_upload_base_name(file_id)
            if not base_name:
                return jsonify({"error": f"Unknown fileId: {file_id}"}), 404
            if file_type == "instrumental":
                filename = f"{base_name}_instrumental.wav"
            else:
                filename = f"{base_name}_vocals.wav"
            file_path = target_dir / filename

        print(f"Full file path: {file_path}")

        if not file_path.exists():
            print(f"File not found: {file_path}")
            matches = [f for f in existing if filename.lower() in f.lower() or f.lower() in filename.lower()]
            return (
                jsonify(
                    {
                        "error": f"File {filename} not found in {dir_map[file_type]}",
                        "requested_filename": filename,
                        "available_files": existing,
                        "similar_matches": matches[:10],
                    }
                ),
                404,
            )

        print(f"File found, sending: {file_path}")
        download_name = _sanitize_download_name(requested_download_name, filename)
        return send_file(file_path, mimetype="audio/wav", as_attachment=True, download_name=download_name)

    except Exception as e:
        print(f"Error in download_file: {e}")
        import traceback

        traceback.print_exc()
        return (
            jsonify({"error": f"Internal server error: {e}", "file_type": file_type, "filename": filename}),
            500,
        )


@bp.route("/api/download/inference/<path:run_id>", methods=["GET"])
def download_inference(run_id):
    """Download inference result file"""
    try:
        run_id = urllib.parse.unquote(run_id)
        run_meta = load_inference_run_metadata(run_id)
        requested_download_name = request.args.get("downloadName")

        if run_meta:
            output_name = run_meta.get("outputFileName", "inferred.wav")
            file_path = paths.INFERENCE_RUNS_DIR / run_id / output_name
            if not file_path.exists():
                return jsonify({"error": "File not found"}), 404
            download_name = _sanitize_download_name(requested_download_name, output_name)
            return send_file(file_path, as_attachment=True, download_name=download_name)

        # Legacy fallback
        file_path = paths.get_inference_file_path(run_id)
        if not file_path.exists():
            return jsonify({"error": "File not found"}), 404
        download_name = _sanitize_download_name(requested_download_name, file_path.name)
        return send_file(file_path, as_attachment=True, download_name=download_name)

    except Exception as e:
        logging.error(f"Error downloading inference file: {e}")
        return jsonify({"error": str(e)}), 500


def _resolve_download_source(source):
    if not source:
        return None
    if isinstance(source, dict):
        src_type = source.get("type")
        src_id = source.get("id") or source.get("fileId") or source.get("runId")
        if not src_type or not src_id:
            return None
        if src_type == "instrumental":
            base_name = get_upload_base_name(src_id)
            if not base_name:
                return None
            return paths.INSTRUMENTAL_DIR / f"{base_name}_instrumental.wav"
        if src_type in {"raw_vocals", "processed_vocals"}:
            base_name = get_upload_base_name(src_id)
            if not base_name:
                return None
            target_dir = paths.UVR_RAW_DIR if src_type == "raw_vocals" else paths.UVR_PROCESSED_DIR
            return target_dir / f"{base_name}_vocals.wav"
        if src_type == "inference":
            run_meta = load_inference_run_metadata(src_id)
            output_name = run_meta.get("outputFileName", "inferred.wav") if run_meta else "inferred.wav"
            candidate = paths.INFERENCE_RUNS_DIR / src_id / output_name
            if candidate.exists():
                return candidate
            legacy = paths.get_inference_file_path(src_id)
            return legacy if legacy.exists() else None
        return None

    if isinstance(source, str):
        parsed = urllib.parse.urlparse(source)
        path = parsed.path if parsed.scheme or source.startswith("/") else source
        if path.startswith("/api/download/inference/"):
            run_id = path.split("/api/download/inference/")[-1]
            return _resolve_download_source({"type": "inference", "id": urllib.parse.unquote(run_id)})
        if path.startswith("/api/download/"):
            rest = path.split("/api/download/")[-1]
            parts = rest.split("/", 1)
            if len(parts) == 2:
                file_type, file_id = parts
                return _resolve_download_source({"type": file_type, "id": urllib.parse.unquote(file_id)})
        candidate = Path(path)
        if candidate.exists():
            allowed_roots = {
                paths.UVR_RAW_DIR,
                paths.UVR_PROCESSED_DIR,
                paths.INSTRUMENTAL_DIR,
                paths.INFERENCE_DIR,
                paths.INFERENCE_RUNS_DIR,
                paths.EXPORT_DIR,
            }
            try:
                candidate = candidate.resolve()
                if any(str(candidate).startswith(str(root.resolve())) for root in allowed_roots):
                    return candidate
            except Exception:
                return None
    return None


@bp.route("/api/audio/merge", methods=["POST"])
def merge_audio():
    try:
        data = request.get_json() or {}
        instrumental = data.get("instrumental") or data.get("instrumentalUrlOrPath")
        vocal = data.get("vocal") or data.get("vocalUrlOrPath")
        requested_download_name = data.get("downloadName") or "merged.wav"
        output_format = (data.get("format") or Path(requested_download_name).suffix.lstrip(".") or "wav").lower()

        download_name = _sanitize_download_name(requested_download_name, f"merged.{output_format}")
        if not download_name.lower().endswith(f".{output_format}"):
            download_name = f"{Path(download_name).stem}.{output_format}"

        inst_path = _resolve_download_source(instrumental)
        vocal_path = _resolve_download_source(vocal)
        if not inst_path or not vocal_path:
            return jsonify({"error": "Missing instrumental or vocal source"}), 400
        if not inst_path.exists() or not vocal_path.exists():
            return jsonify({"error": "Instrumental or vocal file not found"}), 404

        output_path = Path(tempfile.gettempdir()) / f"merge_{uuid.uuid4().hex}.{output_format}"

        filter_complex = (
            "[0:a]volume=0.8[a0];[1:a]volume=0.8[a1];[a0][a1]amix=inputs=2:normalize=0:dropout_transition=0"
        )
        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            str(inst_path),
            "-i",
            str(vocal_path),
            "-filter_complex",
            filter_complex,
            "-ac",
            "2",
        ]
        if output_format == "mp3":
            cmd += ["-c:a", "libmp3lame", "-q:a", "2"]
        elif output_format in {"m4a", "aac"}:
            cmd += ["-c:a", "aac", "-b:a", "192k"]
        cmd += [str(output_path)]

        import subprocess

        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if result.returncode != 0:
            logging.error(f"FFmpeg merge failed: {result.stderr}")
            return jsonify({"error": "Failed to merge audio"}), 500

        @after_this_request
        def _cleanup(response):
            try:
                output_path.unlink(missing_ok=True)
            except Exception:
                pass
            return response

        mime = "audio/wav" if output_format == "wav" else "audio/mpeg"
        return send_file(output_path, as_attachment=True, download_name=download_name, mimetype=mime)

    except Exception as e:
        logging.error(f"Error merging audio: {e}")
        return jsonify({"error": str(e)}), 500
