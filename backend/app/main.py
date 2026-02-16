import json
import uuid

try:
    from backend.env_bootstrap import bootstrap_env

    bootstrap_env()
except Exception:
    pass

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from .dubler_drums import reset_calibration, train_and_save_model

from .session import TranscriptionSession

app = FastAPI(title="Voice to MIDI")


@app.websocket("/ws/voice_to_midi")
async def voice_to_midi_ws(websocket: WebSocket):
    await websocket.accept()
    session = None
    try:
        while True:
            message = await websocket.receive()
            if "text" in message and message["text"] is not None:
                payload = json.loads(message["text"])
                msg_type = payload.get("type")
                if msg_type == "reset_calibration":
                    try:
                        from pathlib import Path

                        base_dir = Path("data") / "studio" / "voice_midi"
                        reset_calibration(base_dir)
                        await websocket.send_json({"type": "calibration", "status": "reset"})
                    except Exception as exc:
                        await websocket.send_json({"type": "error", "message": str(exc)})
                    continue
                if msg_type == "train_drum_model":
                    try:
                        from pathlib import Path

                        base_dir = Path("data") / "studio" / "voice_midi"
                        report = train_and_save_model(base_dir=base_dir)
                        await websocket.send_json({"type": "drum_model", "report": report})
                    except Exception as exc:
                        await websocket.send_json({"type": "error", "message": str(exc)})
                    continue
                if msg_type == "start":
                    session_id = payload.get("sessionId") or str(uuid.uuid4())
                    mode = payload.get("mode", "melody")
                    sample_rate = int(payload.get("sampleRate") or 48000)
                    frame_size = int(payload.get("frameSize") or 1024)
                    instrument = str(payload.get("instrument") or "piano")
                    target_bpm = payload.get("targetBpm")
                    target_ppq = int(payload.get("targetPPQ") or 480)
                    quantize = payload.get("quantize") or "1/16"
                    swing = float(payload.get("swing") or 0.0)
                    target_key = payload.get("key")
                    engine_override = payload.get("engine")
                    ddsp_strict = payload.get("engineStrict")
                    project_id = payload.get("projectId")
                    lane_id = payload.get("laneId")
                    lane_name = payload.get("laneName")
                    insert_at_sec = payload.get("insertAtSec")
                    ddsp_synth = payload.get("ddspSynth")
                    calibrate_label = payload.get("calibrateLabel")
                    calibrate_only = payload.get("calibrateOnly")
                    enable_formants = payload.get("enableFormants")
                    decode_mode = payload.get("decodeMode")
                    crepe_conf = payload.get("crepeConf")
                    crepe_stable_frames = payload.get("crepeStableFrames")
                    crepe_hangover_frames = payload.get("crepeHangoverFrames")
                    crepe_min_note_ms = payload.get("crepeMinNoteMs")
                    note_min_ms = payload.get("noteMinMs")
                    note_gap_sec = payload.get("noteGapSec")
                    note_min_velocity = payload.get("noteMinVelocity")
                    return_processed_audio = payload.get("returnProcessedAudio")
                    preview_only = payload.get("previewOnly")

                    session = TranscriptionSession(
                        session_id=session_id,
                        mode=mode,
                        sample_rate=sample_rate,
                        frame_size=frame_size,
                        instrument=instrument,
                        target_bpm=target_bpm,
                        target_ppq=target_ppq,
                        quantize=quantize,
                        swing=swing,
                        target_key=target_key,
                        engine_override=engine_override,
                        ddsp_strict=bool(ddsp_strict) if ddsp_strict is not None else None,
                        project_id=project_id,
                        lane_id=lane_id,
                        lane_name=lane_name,
                        insert_at_sec=float(insert_at_sec) if insert_at_sec is not None else None,
                        ddsp_synth=bool(ddsp_synth) if ddsp_synth is not None else None,
                        calibrate_label=calibrate_label,
                        calibrate_only=bool(calibrate_only) if calibrate_only is not None else None,
                        enable_formants=bool(enable_formants) if enable_formants is not None else None,
                        decode_mode=str(decode_mode) if decode_mode is not None else None,
                        crepe_conf=float(crepe_conf) if crepe_conf is not None else None,
                        crepe_stable_frames=int(crepe_stable_frames) if crepe_stable_frames is not None else None,
                        crepe_hangover_frames=int(crepe_hangover_frames) if crepe_hangover_frames is not None else None,
                        crepe_min_note_ms=float(crepe_min_note_ms) if crepe_min_note_ms is not None else None,
                        note_min_ms=float(note_min_ms) if note_min_ms is not None else None,
                        note_gap_sec=float(note_gap_sec) if note_gap_sec is not None else None,
                        note_min_velocity=int(note_min_velocity) if note_min_velocity is not None else None,
                        return_processed_audio=bool(return_processed_audio)
                        if return_processed_audio is not None
                        else None,
                        preview_only=bool(preview_only) if preview_only is not None else None,
                    )
                    session.start()
                    await websocket.send_json({"type": "status", "state": "recording", "progress": 0.0})
                elif msg_type == "stop":
                    if not session:
                        await websocket.send_json({"type": "error", "message": "No active session"})
                        continue
                    await websocket.send_json({"type": "status", "state": "processing", "progress": 0.2})
                    result = await session.stop()
                    await websocket.send_json(
                        {
                            "type": "final",
                            "clip": result.get("clip"),
                            "midiFileBase64": result.get("midiFileBase64"),
                            "stats": result.get("stats"),
                            "processedAudioBase64": result.get("processedAudioBase64"),
                            "processedAudioMime": result.get("processedAudioMime"),
                        }
                    )
                    await websocket.send_json({"type": "status", "state": "done", "progress": 1.0})
                    break
                elif msg_type == "cancel":
                    if session:
                        await session.cancel()
                    await websocket.send_json({"type": "status", "state": "done", "progress": 1.0})
                    break
            elif "bytes" in message and message["bytes"] is not None:
                if session:
                    await session.enqueue_bytes(message["bytes"])
            else:
                await websocket.send_json({"type": "error", "message": "Unsupported message"})
    except WebSocketDisconnect:
        if session:
            await session.cancel()
    except Exception as exc:
        try:
            await websocket.send_json({"type": "error", "message": str(exc)})
        except Exception:
            pass
        if session:
            await session.cancel()
