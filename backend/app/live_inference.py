import asyncio
import os
import threading
import uuid
import wave
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from backend.features.inference.models import resolve_checkpoint
from backend.features.studio.storage import get_project, save_project
from backend.paths.manager import paths
try:
    from core import run_infer_script
except ImportError as _e:
    import sys as _sys
    print(f"[rhymix] WARNING: applio not installed - live inference unavailable ({_e})", file=_sys.stderr)
    run_infer_script = None

try:
    from rvc.realtime.core import AUDIO_SAMPLE_RATE, VoiceChanger

    _RVC_IMPORT_ERROR = None
except Exception as exc:
    AUDIO_SAMPLE_RATE = 48000
    VoiceChanger = None
    _RVC_IMPORT_ERROR = exc


def _make_id() -> str:
    return uuid.uuid4().hex


def _safe_float(value, default=0.0):
    try:
        return float(value)
    except Exception:
        return default


def _safe_int(value, default=0):
    try:
        return int(value)
    except Exception:
        return default


def _to_abs_model_path(relative_or_abs: str | None) -> str | None:
    if not relative_or_abs:
        return None
    p = Path(relative_or_abs)
    if p.is_absolute():
        return str(p)
    return str((paths.APPLIO_MODELS_DIR / p).resolve())


def _resolve_model_paths(model: dict | None, selected_checkpoint: dict | None) -> tuple[str, str | None, dict]:
    model_payload = model if isinstance(model, dict) else {}
    checkpoint = selected_checkpoint if isinstance(selected_checkpoint, dict) else None
    if checkpoint is None:
        checkpoint = resolve_checkpoint(model_payload)
    if not checkpoint:
        raise RuntimeError("No valid checkpoint selected for live inference.")

    model_path = _to_abs_model_path(checkpoint.get("path"))
    if not model_path or not Path(model_path).exists():
        raise RuntimeError("Selected model checkpoint path was not found.")

    index_path = _to_abs_model_path(model_payload.get("indexPath"))
    if index_path and not Path(index_path).exists():
        index_path = None

    normalized_model = {
        **model_payload,
        "selectedCheckpoint": checkpoint,
    }
    return model_path, index_path, normalized_model


def _write_wav(path: Path, audio: np.ndarray, sample_rate: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    clipped = np.clip(np.asarray(audio, dtype=np.float32), -1.0, 1.0)
    pcm = (clipped * 32767.0).astype(np.int16)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(pcm.tobytes())


def _resample_audio(audio: np.ndarray, source_rate: int, target_rate: int) -> np.ndarray:
    samples = np.asarray(audio, dtype=np.float32)
    if samples.size == 0 or source_rate == target_rate:
        return samples
    # Polyphase resampler — avoids the aliasing and harmonic smearing that
    # np.interp (linear interpolation) causes on voice signals.
    try:
        from math import gcd
        from scipy.signal import resample_poly
        g = gcd(int(source_rate), int(target_rate))
        return resample_poly(samples, int(target_rate) // g, int(source_rate) // g).astype(np.float32)
    except Exception:
        # Graceful fallback to linear interpolation if scipy is unavailable
        duration = samples.shape[0] / float(source_rate)
        target_length = max(1, int(round(duration * target_rate)))
        src_pos = np.linspace(0.0, 1.0, num=samples.shape[0], endpoint=False, dtype=np.float64)
        tgt_pos = np.linspace(0.0, 1.0, num=target_length, endpoint=False, dtype=np.float64)
        return np.interp(tgt_pos, src_pos, samples).astype(np.float32, copy=False)


@dataclass
class LiveChunkResult:
    audio_bytes: bytes
    latency_ms: float
    input_rms: float


class StudioLiveInferenceSession:
    def __init__(self, payload: dict):
        if VoiceChanger is None:
            raise RuntimeError(f"Realtime RVC dependencies are unavailable: {_RVC_IMPORT_ERROR}")
        self.payload = payload or {}
        self.project_id = str(self.payload.get("projectId") or "").strip() or None
        self.lane_id = str(self.payload.get("laneId") or "").strip() or None
        self.insert_at_sec = _safe_float(self.payload.get("insertAtSec"), 0.0)
        # Force a minimum frame size of 4096 (85ms) to prevent massive per-chunk GPU overhead.
        # Frontend default of 1024 (21ms) causes GPU to fall behind realtime on most cards.
        self.frame_size = max(4096, _safe_int(self.payload.get("frameSize"), 4096))
        self.input_sample_rate = max(8000, _safe_int(self.payload.get("sampleRate"), AUDIO_SAMPLE_RATE))
        self.embedder_model = str(self.payload.get("embedderModel") or "contentvec")
        self.low_latency_monitor = bool(self.payload.get("lowLatencyMonitor", True))
        self.model_name = None
        self._lock = threading.Lock()
        self._dry_frames: list[np.ndarray] = []
        self._wet_frames: list[np.ndarray] = []
        self._input_queue: asyncio.Queue = asyncio.Queue()
        self._output_queue: asyncio.Queue = asyncio.Queue()
        self._worker_task = None
        self._running = False
        self._metrics_every = 12
        self._processed_chunks = 0
        self._dropped_chunks = 0
        self._uploaded_dry_audio: bytes | None = None
        self._uploaded_dry_sample_rate = self.input_sample_rate
        default_max_queue = 6 if self.low_latency_monitor else 32
        default_monitor_chunk = self.frame_size if self.low_latency_monitor else 4096
        self.max_queue_chunks = max(4, _safe_int(self.payload.get("maxQueueChunks"), default_max_queue))
        self.monitor_chunk_samples = max(self.frame_size, _safe_int(self.payload.get("monitorChunkSamples"), default_monitor_chunk))
        self._monitor_buffer = bytearray()
        self._audio_buffer_48k = np.zeros(0, dtype=np.float32)

        model_path, index_path, normalized_model = _resolve_model_paths(
            self.payload.get("model"),
            self.payload.get("selectedCheckpoint"),
        )
        self.model_path = model_path
        self.index_path = index_path
        # FAISS index lookup is unstable in the realtime path on Windows and can hard-crash the process.
        self.index_enabled = bool(self.payload.get("useIndex", False)) and os.name != "nt"
        self.realtime_index_path = index_path if self.index_enabled else None
        self.model = normalized_model
        self.model_name = normalized_model.get("name") or normalized_model.get("modelId") or "Live Model"
        read_chunk_size = max(32, self.frame_size // 128)
        cross_fade_overlap_size = _safe_float(
            self.payload.get("crossFadeOverlapSec"),
            0.035 if self.low_latency_monitor else 0.08,
        )
        extra_convert_size = _safe_float(
            self.payload.get("extraConvertSec"),
            # 80 ms extra lookahead in low-latency mode (was 140 ms).
            # Reduces end-to-end latency at the cost of slightly less overlap
            # context — acceptable for a live filter use-case.
            0.08 if self.low_latency_monitor else 0.5,
        )
        try:
            self.voice_changer = VoiceChanger(
                read_chunk_size=read_chunk_size,
                cross_fade_overlap_size=max(0.01, cross_fade_overlap_size),
                extra_convert_size=max(0.06, extra_convert_size),
                model_path=model_path,
                index_path=self.realtime_index_path,
                # FCPE is substantially faster than RMVPE for live inference
                # while maintaining similar pitch accuracy on voice.
                # Override via {"f0Method": "rmvpe"} in the WS start payload.
                f0_method=str(self.payload.get("f0Method") or "fcpe"),
                embedder_model=self.embedder_model,
                silent_threshold=int(self.payload.get("silentThreshold") or -75),
                vad_enabled=bool(self.payload.get("vadEnabled") or False),
                clean_audio=bool(self.payload.get("cleanAudio") or False),
                clean_strength=_safe_float(self.payload.get("cleanStrength"), 0.5),
            )
        except Exception as exc:
            raise RuntimeError(f"Failed to initialize live inference model '{self.model_name}': {exc}") from exc
        self.pitch = _safe_int(self.payload.get("pitch"), 0)
        requested_index_rate = min(1.0, max(0.0, _safe_float(self.payload.get("indexRate"), 0.5)))
        self.index_rate = requested_index_rate if self.index_enabled else 0.0
        self.protect = min(1.0, max(0.0, _safe_float(self.payload.get("protect"), 0.33)))
        self.volume_envelope = min(1.0, max(0.0, _safe_float(self.payload.get("volumeEnvelope"), 1.0)))
        self.monitor = bool(self.payload.get("monitor", True))
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="live-infer")

    @property
    def output_queue(self) -> asyncio.Queue:
        return self._output_queue

    async def start(self):
        self._running = True
        # Warmup pass — feed a silent block through VoiceChanger so that CUDA
        # kernel JIT compilation happens now rather than on the first real audio
        # chunk (which would cause an audible stutter at the start of every session).
        try:
            loop = asyncio.get_event_loop()
            silence = np.zeros(self.voice_changer.block_frame, dtype=np.float32)
            await loop.run_in_executor(
                self._executor,
                lambda: self.voice_changer.on_request(
                    silence,
                    self.pitch,
                    self.index_rate,
                    self.protect,
                    self.volume_envelope,
                    False,
                    1.0,
                    False,
                    155.0,
                ),
            )
        except Exception:
            pass  # Warmup failure is non-fatal — real audio will still work
        self._worker_task = asyncio.create_task(self._worker())

    async def enqueue_bytes(self, data: bytes):
        if not self._running or not data:
            return
        if self._input_queue.qsize() >= self.max_queue_chunks:
            if self.low_latency_monitor:
                dropped = 0
                while self._input_queue.qsize() >= self.max_queue_chunks:
                    try:
                        stale = self._input_queue.get_nowait()
                        if stale is not None:
                            dropped += 1
                    except asyncio.QueueEmpty:
                        break
                self._dropped_chunks += max(1, dropped)
            else:
                self._dropped_chunks += 1
                return
        await self._input_queue.put(bytes(data))

    async def stop(self) -> dict:
        if not self._running:
            return {"projectId": self.project_id}
        self._running = False
        await self._input_queue.put(None)
        if self._worker_task:
            await self._worker_task
        await self._flush_monitor_buffer(force=True)
        await self._output_queue.put(None)
        # Run the offline re-render (run_infer_script) in the thread pool so
        # the async event loop stays responsive during the commit phase.
        # Other WebSocket connections and FastAPI handlers are unblocked while
        # the full-quality render runs for potentially long recordings.
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._commit_recording)

    async def cancel(self):
        self._running = False
        await self._input_queue.put(None)
        if self._worker_task:
            await self._worker_task
        self._monitor_buffer.clear()
        await self._output_queue.put(None)
        self._executor.shutdown(wait=False)

    def set_uploaded_dry_audio(self, data: bytes, sample_rate: int | None = None):
        if data:
            self._uploaded_dry_audio = bytes(data)
        if sample_rate:
            self._uploaded_dry_sample_rate = max(8000, int(sample_rate))

    async def _worker(self):
        while True:
            item = await self._input_queue.get()
            if item is None:
                # Flush remaining buffer
                try:
                    loop = asyncio.get_event_loop()
                    results = await loop.run_in_executor(self._executor, self._process_accumulate, b"")
                    for result in results:
                        if self.monitor and result.audio_bytes:
                            await self._queue_monitor_audio(result.audio_bytes)
                except Exception:
                    pass
                break
            try:
                loop = asyncio.get_event_loop()
                # Run the ingestion, resampling, and buffer chunking in the threadpool
                results = await loop.run_in_executor(self._executor, self._process_accumulate, item)
                
                for result in results:
                    if self.monitor and result.audio_bytes:
                        await self._queue_monitor_audio(result.audio_bytes)
                    self._processed_chunks += 1
                    if self._processed_chunks % self._metrics_every == 0:
                        await self._output_queue.put(
                            {
                                "type": "metrics",
                                "latencyMs": round(result.latency_ms, 2),
                                "inputRms": round(result.input_rms, 4),
                                "droppedChunks": self._dropped_chunks,
                            }
                        )
            except Exception as exc:
                import traceback
                traceback.print_exc()
                await self._output_queue.put({"type": "error", "message": str(exc)})
                self._running = False
                break

    async def _queue_monitor_audio(self, audio_bytes: bytes):
        if not audio_bytes:
            return
        if self.low_latency_monitor:
            chunk_bytes = max(2, self.monitor_chunk_samples * 2)
            max_buffer_bytes = chunk_bytes * 3
            if len(self._monitor_buffer) > max_buffer_bytes:
                del self._monitor_buffer[:-max_buffer_bytes]
        self._monitor_buffer.extend(audio_bytes)
        await self._flush_monitor_buffer(force=False)

    async def _flush_monitor_buffer(self, force: bool):
        chunk_bytes = max(2, self.monitor_chunk_samples * 2)
        while len(self._monitor_buffer) >= chunk_bytes or (force and self._monitor_buffer):
            take = len(self._monitor_buffer) if force and len(self._monitor_buffer) < chunk_bytes else chunk_bytes
            payload = bytes(self._monitor_buffer[:take])
            del self._monitor_buffer[:take]
            # Send binary frame to the client over WS
            await self._output_queue.put({"type": "audio", "data": payload})

    def _process_accumulate(self, data: bytes) -> list[LiveChunkResult]:
        is_flush = len(data) == 0
        if not is_flush:
            pcm = np.frombuffer(data, dtype=np.int16)
            if pcm.size > 0:
                dry = pcm.astype(np.float32) / 32768.0
                dry = np.ascontiguousarray(dry)
                # Store dry frames for the final offline composite
                self._dry_frames.append(dry.copy())
                
                # Resample to 48kHz for VoiceChanger
                model_input_48k = _resample_audio(dry, self.input_sample_rate, AUDIO_SAMPLE_RATE)
                self._audio_buffer_48k = np.concatenate((self._audio_buffer_48k, model_input_48k))
            
        results = []
        target_size = self.voice_changer.block_frame
        
        while self._audio_buffer_48k.size >= target_size or (is_flush and self._audio_buffer_48k.size > 0):
            if is_flush and self._audio_buffer_48k.size < target_size:
                # Pad out the last chunk with silence to process the trailing phrase
                chunk = np.pad(self._audio_buffer_48k, (0, target_size - self._audio_buffer_48k.size))
                actual_size = self._audio_buffer_48k.size
                self._audio_buffer_48k = np.zeros(0, dtype=np.float32)
            else:
                chunk = self._audio_buffer_48k[:target_size]
                actual_size = target_size
                self._audio_buffer_48k = self._audio_buffer_48k[target_size:]
            
            with self._lock:
                wet, vol, perf = self.voice_changer.on_request(
                    chunk,
                    self.pitch,
                    self.index_rate,
                    self.protect,
                    self.volume_envelope,
                    False,
                    1.0,
                    False,
                    155.0,
                )
            
            wet = np.asarray(wet, dtype=np.float32)
            if wet.size != target_size:
                if wet.size < target_size:
                    wet = np.pad(wet, (0, target_size - wet.size))
                else:
                    wet = wet[:target_size]
            
            if is_flush and actual_size < target_size:
                wet = wet[:actual_size]
                    
            self._wet_frames.append(wet.copy())
            wet_pcm = (np.clip(wet, -1.0, 1.0) * 32767.0).astype(np.int16)
            latency_ms = perf[1] if isinstance(perf, (list, tuple)) and len(perf) > 1 else 0.0
            
            results.append(
                LiveChunkResult(
                    audio_bytes=wet_pcm.tobytes(),
                    latency_ms=float(latency_ms),
                    input_rms=float(vol or 0.0),
                )
            )
            
        return results

    def _render_final_output(self) -> tuple[Path | None, float]:
        if not self._uploaded_dry_audio and not self._dry_frames:
            return None, 0.0
        temp_input_path = paths.EXPORT_DIR / f"studio_live_infer_dry_{_make_id()}.wav"
        output_path = paths.EXPORT_DIR / f"studio_live_infer_{_make_id()}.wav"
        if self._uploaded_dry_audio:
            temp_input_path.write_bytes(self._uploaded_dry_audio)
            with wave.open(str(temp_input_path), "rb") as handle:
                frame_count = handle.getnframes()
                sample_rate = handle.getframerate() or self._uploaded_dry_sample_rate
            dry_duration_sec = frame_count / float(sample_rate)
        else:
            dry = np.concatenate(self._dry_frames, axis=0)
            dry_duration_sec = len(dry) / float(self.input_sample_rate)
            _write_wav(temp_input_path, dry, self.input_sample_rate)
        offline_index_enabled = bool(self.payload.get("useOfflineIndex", False)) and os.name != "nt"
        try:
            _, rendered_output = run_infer_script(
                pitch=self.pitch,
                index_rate=(
                    min(1.0, max(0.0, _safe_float(self.payload.get("indexRate"), 0.0)))
                    if offline_index_enabled
                    else 0.0
                ),
                volume_envelope=self.volume_envelope,
                protect=self.protect,
                f0_method=str(self.payload.get("f0Method") or "rmvpe"),
                input_path=str(temp_input_path),
                output_path=str(output_path),
                pth_path=self.model_path,
                index_path=str(self.index_path or "") if offline_index_enabled else "",
                split_audio=False,
                f0_autotune=False,
                f0_autotune_strength=1.0,
                proposed_pitch=False,
                proposed_pitch_threshold=155.0,
                clean_audio=bool(self.payload.get("cleanAudio") or False),
                clean_strength=_safe_float(self.payload.get("cleanStrength"), 0.5),
                export_format="WAV",
                embedder_model=self.embedder_model,
                embedder_model_custom=None,
                formant_shifting=bool(self.payload.get("formantShifting") or False),
                formant_qfrency=_safe_float(self.payload.get("formantQfrency"), 1.0),
                formant_timbre=_safe_float(self.payload.get("formantTimbre"), 1.0),
            )
            final_path = Path(rendered_output)
            if final_path.exists():
                with wave.open(str(final_path), "rb") as handle:
                    frame_count = handle.getnframes()
                    sample_rate = handle.getframerate() or AUDIO_SAMPLE_RATE
                return final_path, frame_count / float(sample_rate)
            return None, dry_duration_sec
        finally:
            try:
                temp_input_path.unlink(missing_ok=True)
            except Exception:
                pass

    def _commit_recording(self) -> dict:
        if not self._dry_frames and not self._wet_frames:
            return {
                "projectId": self.project_id,
                "laneId": self.lane_id,
                "assetId": None,
                "durationSec": 0.0,
                "modelName": self.model_name,
            }

        export_path, duration_sec = self._render_final_output()
        if export_path is None:
            wet = np.concatenate(self._wet_frames, axis=0) if self._wet_frames else np.zeros(1, dtype=np.float32)
            duration_sec = len(wet) / float(AUDIO_SAMPLE_RATE)
            export_path = paths.EXPORT_DIR / f"studio_live_infer_{_make_id()}.wav"
            _write_wav(export_path, wet, AUDIO_SAMPLE_RATE)
        export_name = export_path.name

        if self.project_id:
            project_record = get_project(self.project_id)
            if project_record:
                asset_id = f"live_infer:{_make_id()}"
                assets = project_record.get("assets") or {}
                assets[asset_id] = {
                    "id": asset_id,
                    "kind": "derived",
                    "label": f"Live Inference · {self.model_name}",
                    "path": str(export_path),
                    "url": f"/api/download/exports/{export_name}",
                    "durationSec": duration_sec,
                    "sampleRate": AUDIO_SAMPLE_RATE,
                }
                project_record["assets"] = assets

                lanes = project_record.get("lanes") or []
                lane_id = self.lane_id
                lane = next((item for item in lanes if item.get("id") == lane_id), None) if lane_id else None
                if lane is None:
                    lane_id = _make_id()
                    order = max([int(item.get("order") or 0) for item in lanes] or [0]) + 1
                    lane = {
                        "id": lane_id,
                        "projectId": self.project_id,
                        "type": "generated",
                        "name": "Live Inference",
                        "sourceAssetId": asset_id,
                        "mute": False,
                        "solo": False,
                        "gainDb": 0.0,
                        "order": order,
                    }
                    lanes.append(lane)
                    project_record["lanes"] = lanes

                clip = {
                    "id": _make_id(),
                    "laneId": lane_id,
                    "sourceAssetId": asset_id,
                    "srcStartSec": 0.0,
                    "srcEndSec": max(0.01, duration_sec),
                    "timelineStartSec": max(0.0, self.insert_at_sec),
                    "fadeInSec": 0.0,
                    "fadeOutSec": 0.0,
                    "gainDb": 0.0,
                    "label": f"Live Inference · {self.model_name}",
                }
                clips = project_record.get("clips") or []
                clips.append(clip)
                project_record["clips"] = clips

                project = project_record.get("project") or {}
                project["durationSec"] = max(
                    _safe_float(project.get("durationSec"), 0.0),
                    self.insert_at_sec + duration_sec,
                )
                project["updatedAt"] = datetime.now().isoformat()
                project_record["project"] = project
                save_project(project_record)
                self.lane_id = lane_id

                return {
                    "projectId": self.project_id,
                    "laneId": lane_id,
                    "assetId": asset_id,
                    "assetUrl": f"/api/download/exports/{export_name}",
                    "durationSec": duration_sec,
                    "modelName": self.model_name,
                }

        return {
            "projectId": self.project_id,
            "laneId": self.lane_id,
            "assetId": None,
            "assetUrl": f"/api/download/exports/{export_name}",
            "durationSec": duration_sec,
            "modelName": self.model_name,
        }
