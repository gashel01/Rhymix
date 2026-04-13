from __future__ import annotations

import json
from pathlib import Path

from flask import Blueprint, Response, jsonify, request, send_file

from .audio_ml import decode_audio_upload, normalize_label, process_take, train_from_state
from .schemas import (
    DeleteResponse,
    LABELS,
    ReviewItem,
    ReviewResponse,
    SessionStatusResponse,
    StartSessionRequest,
    StartSessionResponse,
    TakeResponse,
)
from .storage import create_session, load_session, sample_file_path, save_session

# Flask is intentionally used here to match the existing backend server and avoid introducing a second API process.
bp = Blueprint("beatbox_wizard", __name__)


def _json_error(message: str, status: int = 400):
    return jsonify({"error": message}), status


def _validate(model_cls, payload):
    if hasattr(model_cls, "model_validate"):
        return model_cls.model_validate(payload)
    return model_cls.parse_obj(payload)


def _dump(model_obj):
    if hasattr(model_obj, "model_dump"):
        return model_obj.model_dump(by_alias=True)
    return model_obj.dict(by_alias=True)


@bp.route("/api/session/start", methods=["POST"])
def start_session():
    payload = request.get_json(silent=True) or {}
    try:
        req = _validate(StartSessionRequest, payload)
    except Exception as exc:
        return _json_error(f"Invalid request: {exc}", 422)

    state = create_session(
        sample_rate=req.sample_rate,
        window_sec=req.window_sec,
        target_hits_per_label=req.target_hits_per_label,
    )
    resp = StartSessionResponse(
        sessionId=state["sessionId"],
        labels=state["labels"],
        nextLabel=state["nextLabel"],
    )
    return jsonify(_dump(resp))


@bp.route("/api/session/<session_id>/take", methods=["POST"])
def post_take(session_id: str):
    state = load_session(session_id)
    if not state:
        return _json_error("Session not found", 404)

    label = normalize_label(request.form.get("label", ""))
    if not label:
        return _json_error(f"label must be one of {LABELS}", 422)

    audio_file = request.files.get("audio")
    if audio_file is None:
        return _json_error("Missing multipart field: audio", 422)

    _meta = request.form.get("meta")
    if _meta:
        try:
            json.loads(_meta)
        except Exception:
            return _json_error("meta must be valid JSON", 422)

    raw = audio_file.read()
    if not raw:
        return _json_error("Uploaded audio is empty", 422)

    suffix = Path(audio_file.filename or "").suffix or ".wav"
    try:
        audio, sr = decode_audio_upload(raw, suffix=suffix, target_sr=int(state["sampleRate"]))
    except Exception as exc:
        return _json_error(f"Could not decode audio: {exc}", 422)

    try:
        out = process_take(state, label=label, audio=audio, sr=sr, session_id=session_id)
    except Exception as exc:
        return _json_error(f"Failed to process take: {exc}", 500)

    response_model = _validate(TakeResponse, out)
    return jsonify(_dump(response_model))


@bp.route("/api/session/<session_id>/train", methods=["POST"])
def train_session(session_id: str):
    state = load_session(session_id)
    if not state:
        return _json_error("Session not found", 404)
    report = train_from_state(state)
    return jsonify(_dump(report))


@bp.route("/api/session/<session_id>/review", methods=["GET"])
def review_samples(session_id: str):
    state = load_session(session_id)
    if not state:
        return _json_error("Session not found", 404)

    label = normalize_label(request.args.get("label", ""))
    if not label:
        return _json_error(f"label must be one of {LABELS}", 422)

    try:
        limit = max(1, min(50, int(request.args.get("limit", "10"))))
    except Exception:
        limit = 10
    sort_by = (request.args.get("sort") or "confidence").strip().lower()

    items = [s for s in state.get("samples", []) if s.get("label") == label]
    # Worst-first: lower confidence first (unknowns first), or lower quality.
    if sort_by == "quality":
        items = sorted(
            items,
            key=lambda s: (
                float(s.get("meta", {}).get("qualityScore", 0.0)),
                float(s.get("confidence")) if s.get("confidence") is not None else -1.0,
            ),
        )[:limit]
    else:
        items = sorted(
            items,
            key=lambda s: (
                float(s.get("confidence")) if s.get("confidence") is not None else -1.0,
                float(s.get("meta", {}).get("qualityScore", 0.0)),
            ),
        )[:limit]

    review_items = [
        ReviewItem(
            sampleId=s["sampleId"],
            confidence=float(s.get("confidence") or 0.0),
            qualityScore=float(s.get("meta", {}).get("qualityScore", 0.0)),
            audioUrl=f"/api/sample/{session_id}/{s['sampleId']}/audio",
            reviewReason="low_confidence"
            if float(s.get("confidence") or 0.0) < 0.45
            else "low_quality",
        )
        for s in items
    ]
    response = ReviewResponse(label=label, items=review_items)
    return jsonify(_dump(response))


@bp.route("/api/session/<session_id>/sample/<sample_id>", methods=["DELETE"])
def delete_sample(session_id: str, sample_id: str):
    state = load_session(session_id)
    if not state:
        return _json_error("Session not found", 404)
    before = len(state.get("samples", []))
    state["samples"] = [s for s in state.get("samples", []) if s.get("sampleId") != sample_id]
    removed = before - len(state["samples"])
    if removed <= 0:
        return _json_error("Sample not found", 404)
    wav = sample_file_path(session_id, sample_id)
    try:
        wav.unlink(missing_ok=True)
    except Exception:
        pass
    counts = {k: 0 for k in LABELS}
    for sample in state["samples"]:
        lbl = sample.get("label")
        if lbl in counts:
            counts[lbl] += 1
    state["counts"] = counts
    save_session(state)
    return jsonify(_dump(DeleteResponse(ok=True)))


@bp.route("/api/session/<session_id>/status", methods=["GET"])
def session_status(session_id: str):
    state = load_session(session_id)
    if not state:
        return _json_error("Session not found", 404)
    payload = SessionStatusResponse(
        sessionId=state["sessionId"],
        labels=state.get("labels", LABELS),
        counts=state.get("counts", {k: 0 for k in LABELS}),
        nextLabel=state.get("nextLabel", LABELS[0]),
        targetHitsPerLabel=int(state.get("targetHitsPerLabel", 25)),
        sampleRate=int(state.get("sampleRate", 16000)),
        windowSec=float(state.get("windowSec", 0.25)),
        modelTrained=bool(state.get("modelTrained", False)),
        lastTake=state.get("lastTake"),
    )
    return jsonify(_dump(payload))


@bp.route("/api/sample/<session_id>/<sample_id>/audio", methods=["GET"])
def get_sample_audio(session_id: str, sample_id: str):
    path = sample_file_path(session_id, sample_id)
    if not path.exists():
        return _json_error("Sample audio not found", 404)
    return send_file(path, mimetype="audio/wav", as_attachment=False)
