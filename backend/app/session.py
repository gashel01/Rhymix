import asyncio
import base64
import math
import os
import time
import wave
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional
import uuid
import logging

import numpy as np

from .audio_preprocess import preprocess_audio
from .crepe_adapter import transcribe_crepe
from .dsp_melody import MelodyProcessor, NoteEvent
from .dsp_rhythm import RhythmProcessor, RhythmEvent
from .midi_export import notes_to_midi_base64
from .basic_pitch_adapter import transcribe_basic_pitch
from .ddsp_adapter import transcribe_ddsp, synthesize_ddsp_audio
from .dubler_melody import (
    MAGIC_WAND_PRESETS,
    transcribe_dubler_melody,
    transcribe_dubler_melody_v2,
    transcribe_magic_wand,
)
from .dubler_drums import (
    add_calibration_sample,
    reset_calibration,
    transcribe_dubler_drums,
)

try:
    from backend.features.studio.storage import get_project, save_project
except Exception:  # pragma: no cover
    get_project = None
    save_project = None

try:
    from backend.paths.manager import paths
except Exception:  # pragma: no cover
    paths = None


def estimate_bpm_from_onsets(onset_times: List[float]) -> Optional[float]:
    if len(onset_times) < 2:
        return None
    intervals = [b - a for a, b in zip(onset_times[:-1], onset_times[1:]) if b > a]
    if not intervals:
        return None
    median = float(np.median(intervals))
    if median <= 0:
        return None
    bpm = 60.0 / median
    return max(60.0, min(200.0, bpm))


def _now_iso():
    from datetime import datetime

    return datetime.now().isoformat()


def ticks_per_second(bpm: float, ppq: int) -> float:
    return (bpm * ppq) / 60.0


def quantize_tick(value: int, grid: int) -> int:
    if grid <= 1:
        return value
    return int(round(value / grid) * grid)


def apply_swing(start_tick: int, grid: int, swing: float) -> int:
    if swing <= 0 or grid <= 0:
        return start_tick
    # Swing every other grid (odd index)
    step = start_tick // grid
    if step % 2 == 1:
        return int(start_tick + grid * swing * 0.5)
    return start_tick


@dataclass
class TranscriptionSession:
    session_id: str
    mode: str
    sample_rate: int
    frame_size: int
    instrument: str
    target_bpm: Optional[float]
    target_ppq: int
    quantize: str
    swing: float
    target_key: Optional[str] = None
    engine_override: Optional[str] = None
    ddsp_strict: Optional[bool] = None
    project_id: Optional[str] = None
    lane_id: Optional[str] = None
    lane_name: Optional[str] = None
    insert_at_sec: Optional[float] = None
    ddsp_synth: Optional[bool] = None
    calibrate_label: Optional[str] = None
    calibrate_only: Optional[bool] = None
    enable_formants: Optional[bool] = None
    decode_mode: Optional[str] = None
    crepe_conf: Optional[float] = None
    crepe_stable_frames: Optional[int] = None
    crepe_hangover_frames: Optional[int] = None
    crepe_min_note_ms: Optional[float] = None
    note_min_ms: Optional[float] = None
    note_gap_sec: Optional[float] = None
    note_min_velocity: Optional[int] = None
    return_processed_audio: Optional[bool] = None
    preview_only: Optional[bool] = None
    created_at: float = field(default_factory=time.time)
    _queue: asyncio.Queue = field(default_factory=asyncio.Queue, init=False, repr=False)
    _task: Optional[asyncio.Task] = field(default=None, init=False, repr=False)
    _running: bool = field(default=True, init=False, repr=False)
    _buffer: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.float32), init=False)
    _cursor_time: float = field(default=0.0, init=False)
    _melody: Optional[MelodyProcessor] = field(default=None, init=False, repr=False)
    _rhythm: Optional[RhythmProcessor] = field(default=None, init=False, repr=False)
    _onset_times: List[float] = field(default_factory=list, init=False)
    _recorded_chunks: List[bytes] = field(default_factory=list, init=False)
    _use_basic_pitch: bool = field(default=False, init=False, repr=False)
    _use_crepe: bool = field(default=False, init=False, repr=False)
    _use_ddsp: bool = field(default=False, init=False, repr=False)
    _engine_mode: str = field(default="basic_pitch", init=False, repr=False)
    _basic_pitch_error: Optional[str] = field(default=None, init=False, repr=False)
    _crepe_error: Optional[str] = field(default=None, init=False, repr=False)
    _ddsp_error: Optional[str] = field(default=None, init=False, repr=False)
    _ddsp_synth_asset: Optional[dict] = field(default=None, init=False, repr=False)
    _raw_audio_path: Optional[Path] = field(default=None, init=False, repr=False)
    _processed_audio_path: Optional[Path] = field(default=None, init=False, repr=False)

    def start(self):
        engine = (self.engine_override or os.getenv("VOICE_MIDI_MELODY_ENGINE", "basic_pitch")).lower().strip()
        self._engine_mode = engine
        self._use_basic_pitch = self.mode == "melody" and engine in {"basic_pitch", "auto", "bp"}
        self._use_crepe = self.mode == "melody" and engine in {"crepe", "auto"}
        self._use_ddsp = self.mode == "melody" and engine in {"ddsp"}
        if self.mode == "melody":
            self._melody = MelodyProcessor(sample_rate=self.sample_rate, hop_size=self.frame_size)
        elif self.mode == "rhythm":
            self._rhythm = RhythmProcessor(sample_rate=self.sample_rate, hop_size=self.frame_size)
        self._task = asyncio.create_task(self._worker())

    async def enqueue_bytes(self, data: bytes):
        if not self._running:
            return
        await self._queue.put(data)

    async def _worker(self):
        while self._running:
            data = await self._queue.get()
            if data is None:
                break
            if (
                self.mode in {"dubler_melody", "dubler_drums"}
                or self._engine_mode in {"ddsp", "crepe"}
                or self._use_basic_pitch
                or bool(self.return_processed_audio)
            ):
                self._recorded_chunks.append(bytes(data))
            frame = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
            if frame.size == 0:
                continue
            self._buffer = np.concatenate([self._buffer, frame])
            while self._buffer.size >= self.frame_size:
                chunk = self._buffer[: self.frame_size]
                self._buffer = self._buffer[self.frame_size :]
                self._process_frame(chunk)

    def _process_frame(self, frame: np.ndarray):
        if self.mode == "melody" and self._melody:
            self._melody.process(frame, self._cursor_time)
        elif self.mode == "rhythm" and self._rhythm:
            self._rhythm.process(frame, self._cursor_time)
            # Store onset times for BPM estimation
            if self._rhythm.events:
                last = self._rhythm.events[-1]
                if not self._onset_times or last.time_sec > self._onset_times[-1]:
                    self._onset_times.append(last.time_sec)
        self._cursor_time += self.frame_size / float(self.sample_rate)

    async def stop(self) -> Dict:
        self._running = False
        await self._queue.put(None)
        if self._task:
            await self._task
        return self._finalize()

    async def cancel(self):
        self._running = False
        await self._queue.put(None)
        if self._task:
            await self._task

    def _finalize(self) -> Dict:
        bpm = self.target_bpm
        notes: List[Dict] = []
        engine_used = "aubio"
        cc_events: List[Dict] = []

        if self.preview_only:
            self._ensure_processed_audio()
            processed_audio_b64 = self._processed_audio_base64()
            if self.return_processed_audio:
                self._cleanup_audio_files()
            return {
                "clip": None,
                "midiFileBase64": None,
                "stats": {
                    "notes": 0,
                    "durationSec": self._cursor_time,
                    "engine": "preview",
                },
                "synthAsset": None,
                "projectId": self.project_id,
                "processedAudioBase64": processed_audio_b64,
                "processedAudioMime": "audio/wav" if processed_audio_b64 else None,
            }

        if self.mode == "dubler_melody":
            notes, cc_events = self._run_dubler_melody()
            engine_used = "dubler_melody"
        elif self.mode == "dubler_drums":
            if self.calibrate_only and self.calibrate_label:
                calibration = self._run_dubler_calibration()
                return {
                    "clip": None,
                    "midiFileBase64": None,
                    "stats": {
                        "notes": 0,
                        "durationSec": self._cursor_time,
                        "engine": "dubler_drums",
                        "calibration": calibration,
                    },
                }
            notes = self._run_dubler_drums()
            engine_used = "dubler_drums"
        elif self.mode == "melody" and self._melody:
            if self._engine_mode == "ddsp":
                ddsp_notes = self._run_ddsp()
                if ddsp_notes:
                    notes = ddsp_notes
                    engine_used = "ddsp"
                else:
                    strict = (
                        self.ddsp_strict
                        if self.ddsp_strict is not None
                        else os.getenv("VOICE_MIDI_DDSP_STRICT", "0").lower() in {"1", "true", "yes"}
                    )
                    if not strict:
                        bp_notes = self._run_basic_pitch()
                        if bp_notes:
                            notes = bp_notes
                            engine_used = "basic_pitch_fallback"
            elif self._engine_mode == "crepe":
                crepe_notes = self._run_crepe()
                if crepe_notes:
                    notes = crepe_notes
                    engine_used = "crepe"
            else:
                bp_notes = self._run_basic_pitch() if self._use_basic_pitch else []
                if bp_notes:
                    notes = bp_notes
                    engine_used = "basic_pitch"
                if self._engine_mode == "auto" and len(notes) < 3 and self._use_crepe:
                    crepe_notes = self._run_crepe()
                    if len(crepe_notes) > len(notes):
                        notes = crepe_notes
                        engine_used = "crepe"
            if not notes:
                events = self._melody.finalize(self._cursor_time)
                for ev in events:
                    notes.append(
                        {
                            "startSec": ev.start_sec,
                            "endSec": ev.end_sec,
                            "note": ev.note,
                            "velocity": ev.velocity,
                            "channel": 0,
                        }
                    )
        elif self.mode == "rhythm" and self._rhythm:
            events = self._rhythm.finalize()
            if bpm is None:
                bpm = estimate_bpm_from_onsets([e.time_sec for e in events]) or 120.0
            for ev in events:
                notes.append(
                    {
                        "startSec": ev.time_sec,
                        "endSec": ev.time_sec + 0.1,
                        "note": ev.note,
                        "velocity": ev.velocity,
                        "channel": 9,
                    }
                )

        if bpm is None:
            bpm = estimate_bpm_from_onsets([n["startSec"] for n in notes]) or 120.0

        ppq = int(self.target_ppq or 480)
        tps = ticks_per_second(bpm, ppq)
        apply_filters = self.mode in {"melody", "dubler_melody"}
        if apply_filters:
            min_note_ms = (
                float(self.note_min_ms)
                if self.note_min_ms is not None
                else float(os.getenv("VOICE_MIDI_MIN_NOTE_MS", "0.06"))
            )
            min_velocity = (
                int(self.note_min_velocity)
                if self.note_min_velocity is not None
                else int(os.getenv("VOICE_MIDI_MIN_VELOCITY", "1"))
            )
            merge_gap = (
                float(self.note_gap_sec)
                if self.note_gap_sec is not None
                else float(os.getenv("VOICE_MIDI_NOTE_GAP_SEC", "0.04"))
            )
        else:
            min_note_ms = float(os.getenv("VOICE_MIDI_MIN_NOTE_MS", "0.06"))
            min_velocity = 1
            merge_gap = float(os.getenv("VOICE_MIDI_NOTE_GAP_SEC", "0.04"))
        grid = None
        if self.quantize and self.quantize != "off":
            if self.quantize == "1/16":
                grid = int(ppq / 4)
            elif self.quantize == "1/8":
                grid = int(ppq / 2)
            else:
                grid = int(ppq)

        notes = _merge_adjacent_notes(notes, gap_sec=merge_gap)
        if self.target_key and self.mode in {"melody", "dubler_melody"}:
            if self.mode == "dubler_melody" and any("midiRaw" in n for n in notes):
                pass
            else:
                notes = _snap_notes_to_scale(notes, self.target_key)

        out_notes = []
        for n in notes:
            duration = max(0.0, n["endSec"] - n["startSec"])
            if duration < min_note_ms:
                continue
            if apply_filters and int(n.get("velocity", 0)) < min_velocity:
                continue
            start_tick = int(round(n["startSec"] * tps))
            duration_tick = int(round(duration * tps))
            if grid:
                start_tick = quantize_tick(start_tick, grid)
                start_tick = apply_swing(start_tick, grid, float(self.swing or 0.0))
                duration_tick = max(grid, quantize_tick(duration_tick, grid))
            duration_tick = max(1, duration_tick)
            out_notes.append(
                {
                    "startTick": start_tick,
                    "durationTick": duration_tick,
                    "note": int(n["note"]),
                    "velocity": int(n["velocity"]),
                    "channel": int(n["channel"]),
                }
            )

        out_notes.sort(key=lambda n: n["startTick"])
        clip = {
            "ppq": ppq,
            "bpm": float(bpm),
            "timeSig": [4, 4],
            "notes": out_notes,
            "mode": self.mode,
            "instrument": self.instrument,
        }
        if cc_events:
            clip["cc"] = cc_events
        midi_b64 = notes_to_midi_base64(out_notes, bpm=float(bpm), ppq=ppq) if out_notes else None
        self._ensure_processed_audio()
        processed_audio_b64 = self._processed_audio_base64()
        if self.return_processed_audio:
            self._cleanup_audio_files()
        return {
            "clip": clip,
            "midiFileBase64": midi_b64,
            "stats": {
                "notes": len(out_notes),
                "durationSec": self._cursor_time,
                "engine": engine_used,
                "basicPitchError": self._basic_pitch_error,
                "crepeError": self._crepe_error,
                "ddspError": self._ddsp_error,
                "ccEvents": len(cc_events),
            },
            "synthAsset": self._ddsp_synth_asset,
            "projectId": self.project_id,
            "processedAudioBase64": processed_audio_b64,
            "processedAudioMime": "audio/wav" if processed_audio_b64 else None,
        }

    def _voice_midi_dir(self) -> Path:
        if paths and getattr(paths, "BASE_DIR", None):
            base_dir = paths.BASE_DIR
        else:
            base_dir = Path(__file__).resolve().parents[2]
        return base_dir / "data" / "studio" / "voice_midi"

    def _write_wav(self, path: Path, pcm_bytes: bytes):
        path.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(path), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(self.sample_rate)
            wav.writeframes(pcm_bytes)

    def _set_audio_paths(self, raw_path: Path, processed_path: Optional[Path] = None):
        self._raw_audio_path = raw_path
        if processed_path and processed_path.exists():
            self._processed_audio_path = processed_path
        else:
            self._processed_audio_path = None

    def _processed_audio_base64(self) -> Optional[str]:
        if not self.return_processed_audio:
            return None
        path = self._processed_audio_path or self._raw_audio_path
        if not path or not path.exists():
            return None
        try:
            data = path.read_bytes()
        except Exception:
            return None
        if not data:
            return None
        return base64.b64encode(data).decode("ascii")

    def _cleanup_audio_files(self):
        keep_wav = os.getenv("VOICE_MIDI_KEEP_WAV", "").lower() in {"1", "true", "yes"}
        if keep_wav:
            return
        for path in {self._raw_audio_path, self._processed_audio_path}:
            if not path:
                continue
            try:
                path.unlink(missing_ok=True)
            except Exception:
                pass

    def _ensure_processed_audio(self):
        if not self.return_processed_audio:
            return
        if self._processed_audio_path or self._raw_audio_path:
            return
        if not self._recorded_chunks:
            return
        tmp_dir = self._voice_midi_dir()
        raw_path = tmp_dir / f"{self.session_id}_preview.wav"
        processed_path = tmp_dir / f"{self.session_id}_preview_clean.wav"
        try:
            pcm_bytes = b"".join(self._recorded_chunks)
            self._write_wav(raw_path, pcm_bytes)
            use_pre = os.getenv("VOICE_MIDI_PREPROCESS", "1").lower() not in {"0", "false", "no"}
            target_sr = os.getenv("VOICE_MIDI_PREPROCESS_SR")
            gate_db = os.getenv("VOICE_MIDI_GATE_DB")
            gate_mode = os.getenv("VOICE_MIDI_GATE_MODE", "soft")
            low_pass = os.getenv("VOICE_MIDI_LOW_PASS")
            high_pass = os.getenv("VOICE_MIDI_HIGH_PASS")
            trim_db = os.getenv("VOICE_MIDI_TRIM_DB")
            normalize = os.getenv("VOICE_MIDI_NORMALIZE", "1").lower() not in {"0", "false", "no"}
            if use_pre:
                preprocess_audio(
                    str(raw_path),
                    str(processed_path),
                    target_sr=int(target_sr) if target_sr else None,
                    gate_db=float(gate_db) if gate_db else -45.0,
                    gate_mode=gate_mode or "soft",
                    low_pass_hz=float(low_pass) if low_pass else 6000.0,
                    high_pass_hz=float(high_pass) if high_pass else 80.0,
                    trim_db=float(trim_db) if trim_db else 35.0,
                    normalize=normalize,
                )
            self._set_audio_paths(raw_path, processed_path if use_pre else None)
        except Exception:
            self._set_audio_paths(raw_path, None)

    def _run_basic_pitch(self) -> List[Dict]:
        if not self._recorded_chunks:
            return []
        tmp_dir = self._voice_midi_dir()
        wav_path = tmp_dir / f"{self.session_id}_voice.wav"
        processed_path = tmp_dir / f"{self.session_id}_voice_clean.wav"
        try:
            pcm_bytes = b"".join(self._recorded_chunks)
            self._write_wav(wav_path, pcm_bytes)
            use_pre = os.getenv("VOICE_MIDI_PREPROCESS", "1").lower() not in {"0", "false", "no"}
            target_sr = os.getenv("VOICE_MIDI_PREPROCESS_SR")
            gate_db = os.getenv("VOICE_MIDI_GATE_DB")
            gate_mode = os.getenv("VOICE_MIDI_GATE_MODE", "soft")
            low_pass = os.getenv("VOICE_MIDI_LOW_PASS")
            high_pass = os.getenv("VOICE_MIDI_HIGH_PASS")
            trim_db = os.getenv("VOICE_MIDI_TRIM_DB")
            normalize = os.getenv("VOICE_MIDI_NORMALIZE", "1").lower() not in {"0", "false", "no"}
            input_path = str(wav_path)
            if use_pre:
                preprocess_audio(
                    input_path,
                    str(processed_path),
                    target_sr=int(target_sr) if target_sr else None,
                    gate_db=float(gate_db) if gate_db else -45.0,
                    gate_mode=gate_mode or "soft",
                    low_pass_hz=float(low_pass) if low_pass else 6000.0,
                    high_pass_hz=float(high_pass) if high_pass else 80.0,
                    trim_db=float(trim_db) if trim_db else 35.0,
                    normalize=normalize,
                )
                input_path = str(processed_path)
            self._set_audio_paths(wav_path, processed_path if use_pre else None)
            min_freq = os.getenv("VOICE_MIDI_BP_MIN_FREQ")
            max_freq = os.getenv("VOICE_MIDI_BP_MAX_FREQ")
            notes, _midi = transcribe_basic_pitch(
                input_path,
                min_freq=float(min_freq) if min_freq else 65.0,
                max_freq=float(max_freq) if max_freq else 1200.0,
            )
            return notes
        except Exception as exc:
            self._basic_pitch_error = str(exc)
            return []
        finally:
            keep_wav = os.getenv("VOICE_MIDI_KEEP_WAV", "").lower() in {"1", "true", "yes"} or bool(
                self.return_processed_audio
            )
            if not keep_wav:
                try:
                    wav_path.unlink(missing_ok=True)
                except Exception:
                    pass
                try:
                    processed_path.unlink(missing_ok=True)
                except Exception:
                    pass

    def _run_crepe(self) -> List[Dict]:
        if not self._recorded_chunks:
            return []
        tmp_dir = self._voice_midi_dir()
        wav_path = tmp_dir / f"{self.session_id}_voice.wav"
        processed_path = tmp_dir / f"{self.session_id}_voice_clean.wav"
        try:
            pcm_bytes = b"".join(self._recorded_chunks)
            self._write_wav(wav_path, pcm_bytes)
            use_pre = os.getenv("VOICE_MIDI_PREPROCESS", "1").lower() not in {"0", "false", "no"}
            target_sr = os.getenv("VOICE_MIDI_PREPROCESS_SR")
            gate_db = os.getenv("VOICE_MIDI_GATE_DB")
            gate_mode = os.getenv("VOICE_MIDI_GATE_MODE", "soft")
            low_pass = os.getenv("VOICE_MIDI_LOW_PASS")
            high_pass = os.getenv("VOICE_MIDI_HIGH_PASS")
            trim_db = os.getenv("VOICE_MIDI_TRIM_DB")
            normalize = os.getenv("VOICE_MIDI_NORMALIZE", "1").lower() not in {"0", "false", "no"}
            input_path = str(wav_path)
            if use_pre:
                if not target_sr:
                    target_sr = os.getenv("VOICE_MIDI_CREPE_SR", "16000")
                if not low_pass:
                    low_pass = "5000"
                if not high_pass:
                    high_pass = "80"
                preprocess_audio(
                    input_path,
                    str(processed_path),
                    target_sr=int(target_sr) if target_sr else None,
                    gate_db=float(gate_db) if gate_db else -45.0,
                    gate_mode=gate_mode or "soft",
                    low_pass_hz=float(low_pass) if low_pass else 6000.0,
                    high_pass_hz=float(high_pass) if high_pass else 80.0,
                    trim_db=float(trim_db) if trim_db else 35.0,
                    normalize=normalize,
                )
                if processed_path.exists() and processed_path.stat().st_size > 0:
                    input_path = str(processed_path)
                else:
                    logging.getLogger("voice_midi").warning(
                        "CREPE: preprocess output missing; using raw audio %s", wav_path
                    )
            self._set_audio_paths(wav_path, processed_path if use_pre else None)
            conf = self.crepe_conf if self.crepe_conf is not None else os.getenv("VOICE_MIDI_CREPE_CONF")
            fmin = os.getenv("VOICE_MIDI_CREPE_FMIN")
            fmax = os.getenv("VOICE_MIDI_CREPE_FMAX")
            crepe_sr = os.getenv("VOICE_MIDI_CREPE_SR")
            stable_frames = (
                self.crepe_stable_frames
                if self.crepe_stable_frames is not None
                else os.getenv("VOICE_MIDI_CREPE_STABLE_FRAMES")
            )
            hangover_frames = (
                self.crepe_hangover_frames
                if self.crepe_hangover_frames is not None
                else os.getenv("VOICE_MIDI_CREPE_HANGOVER")
            )
            min_note_duration = (
                self.crepe_min_note_ms
                if self.crepe_min_note_ms is not None
                else os.getenv("VOICE_MIDI_CREPE_MIN_NOTE_MS")
            )
            logging.getLogger("voice_midi").info("CREPE: starting transcription")
            notes = transcribe_crepe(
                input_path,
                sample_rate=int(crepe_sr) if crepe_sr else self.sample_rate,
                confidence_threshold=float(conf) if conf is not None else 0.3,
                fmin=float(fmin) if fmin else 50.0,
                fmax=float(fmax) if fmax else 1200.0,
                stable_frames_required=int(stable_frames) if stable_frames is not None else 3,
                hangover_frames=int(hangover_frames) if hangover_frames is not None else 3,
                min_note_duration=float(min_note_duration) if min_note_duration is not None else 0.07,
            )
            if not notes:
                base_conf = float(conf) if conf is not None else 0.3
                fallback_conf = max(0.12, base_conf * 0.5)
                logging.getLogger("voice_midi").info(
                    "CREPE: retry with lower confidence threshold=%.2f", fallback_conf
                )
                notes = transcribe_crepe(
                    input_path,
                    sample_rate=int(crepe_sr) if crepe_sr else self.sample_rate,
                    confidence_threshold=fallback_conf,
                    fmin=float(fmin) if fmin else 50.0,
                    fmax=float(fmax) if fmax else 1200.0,
                    stable_frames_required=max(2, int(stable_frames) - 1)
                    if stable_frames is not None
                    else 2,
                    hangover_frames=max(2, int(hangover_frames) - 1)
                    if hangover_frames is not None
                    else 2,
                    min_note_duration=0.05,
                )
            logging.getLogger("voice_midi").info("CREPE: finished notes=%d", len(notes))
            return notes
        except Exception as exc:
            self._crepe_error = str(exc)
            return []
        finally:
            keep_wav = os.getenv("VOICE_MIDI_KEEP_WAV", "").lower() in {"1", "true", "yes"} or bool(
                self.return_processed_audio
            )
            if not keep_wav:
                try:
                    wav_path.unlink(missing_ok=True)
                except Exception:
                    pass
                try:
                    processed_path.unlink(missing_ok=True)
                except Exception:
                    pass

    def _run_ddsp(self) -> List[Dict]:
        if not self._recorded_chunks:
            return []
        tmp_dir = self._voice_midi_dir()
        wav_path = tmp_dir / f"{self.session_id}_voice.wav"
        processed_path = tmp_dir / f"{self.session_id}_voice_clean.wav"
        synth_path = None
        try:
            pcm_bytes = b"".join(self._recorded_chunks)
            self._write_wav(wav_path, pcm_bytes)
            use_pre = os.getenv("VOICE_MIDI_PREPROCESS", "1").lower() not in {"0", "false", "no"}
            target_sr = os.getenv("VOICE_MIDI_PREPROCESS_SR")
            gate_db = os.getenv("VOICE_MIDI_GATE_DB")
            gate_mode = os.getenv("VOICE_MIDI_GATE_MODE", "soft")
            low_pass = os.getenv("VOICE_MIDI_LOW_PASS")
            high_pass = os.getenv("VOICE_MIDI_HIGH_PASS")
            trim_db = os.getenv("VOICE_MIDI_TRIM_DB")
            normalize = os.getenv("VOICE_MIDI_NORMALIZE", "1").lower() not in {"0", "false", "no"}
            input_path = str(wav_path)
            if use_pre:
                preprocess_audio(
                    input_path,
                    str(processed_path),
                    target_sr=int(target_sr) if target_sr else None,
                    gate_db=float(gate_db) if gate_db else -45.0,
                    gate_mode=gate_mode or "soft",
                    low_pass_hz=float(low_pass) if low_pass else 6000.0,
                    high_pass_hz=float(high_pass) if high_pass else 80.0,
                    trim_db=float(trim_db) if trim_db else 35.0,
                    normalize=normalize,
                )
                input_path = str(processed_path)
            self._set_audio_paths(wav_path, processed_path if use_pre else None)
            conf = os.getenv("VOICE_MIDI_DDSP_CONF")
            fmin = os.getenv("VOICE_MIDI_DDSP_FMIN")
            fmax = os.getenv("VOICE_MIDI_DDSP_FMAX")
            frame_rate = os.getenv("VOICE_MIDI_DDSP_FRAME_RATE")
            notes = transcribe_ddsp(
                input_path,
                sample_rate=self.sample_rate,
                confidence_threshold=float(conf) if conf else 0.3,
                fmin=float(fmin) if fmin else 50.0,
                fmax=float(fmax) if fmax else 1200.0,
                frame_rate=int(frame_rate) if frame_rate else 250,
            )
            synth_enabled = self.ddsp_synth if self.ddsp_synth is not None else True
            if synth_enabled:
                if paths and getattr(paths, "EXPORT_DIR", None):
                    export_dir = paths.EXPORT_DIR
                else:
                    export_dir = tmp_dir
                export_dir.mkdir(parents=True, exist_ok=True)
                synth_path = export_dir / f"ddsp_{self.session_id}.wav"
                synth_info = synthesize_ddsp_audio(
                    input_path,
                    str(synth_path),
                    sample_rate=self.sample_rate,
                    instrument_label=self.instrument,
                    fmin=float(fmin) if fmin else 50.0,
                    fmax=float(fmax) if fmax else 1200.0,
                    frame_rate=int(frame_rate) if frame_rate else 250,
                    require_model=bool(self.ddsp_strict),
                )
                self._ddsp_synth_asset = self._attach_ddsp_asset(synth_info, synth_path)
            return notes
        except Exception as exc:
            self._ddsp_error = str(exc)
            return []
        finally:
            keep_wav = os.getenv("VOICE_MIDI_KEEP_WAV", "").lower() in {"1", "true", "yes"} or bool(
                self.return_processed_audio
            )
            if not keep_wav:
                try:
                    wav_path.unlink(missing_ok=True)
                except Exception:
                    pass
                try:
                    processed_path.unlink(missing_ok=True)
                except Exception:
                    pass
                if synth_path is not None:
                    # keep synth output (it is the final asset)
                    pass

    def _run_dubler_melody(self) -> tuple[list, list]:
        if not self._recorded_chunks:
            return [], []
        tmp_dir = self._voice_midi_dir()
        wav_path = tmp_dir / f"{self.session_id}_dubler.wav"
        processed_path = tmp_dir / f"{self.session_id}_dubler_clean.wav"
        try:
            pcm_bytes = b"".join(self._recorded_chunks)
            self._write_wav(wav_path, pcm_bytes)
            use_pre = os.getenv("VOICE_MIDI_PREPROCESS", "1").lower() not in {"0", "false", "no"}
            target_sr = os.getenv("VOICE_MIDI_PREPROCESS_SR")
            gate_db = os.getenv("VOICE_MIDI_GATE_DB")
            gate_mode = os.getenv("VOICE_MIDI_GATE_MODE", "soft")
            low_pass = os.getenv("VOICE_MIDI_LOW_PASS")
            high_pass = os.getenv("VOICE_MIDI_HIGH_PASS")
            trim_db = os.getenv("VOICE_MIDI_TRIM_DB")
            normalize = os.getenv("VOICE_MIDI_NORMALIZE", "1").lower() not in {"0", "false", "no"}
            crepe_sr = os.getenv("VOICE_MIDI_CREPE_SR")
            input_path = str(wav_path)
            if use_pre:
                preprocess_audio(
                    input_path,
                    str(processed_path),
                    target_sr=int(target_sr) if target_sr else (int(crepe_sr) if crepe_sr else None),
                    gate_db=float(gate_db) if gate_db else -45.0,
                    gate_mode=gate_mode or "soft",
                    low_pass_hz=float(low_pass) if low_pass else 6000.0,
                    high_pass_hz=float(high_pass) if high_pass else 80.0,
                    trim_db=float(trim_db) if trim_db else 35.0,
                    normalize=normalize,
                )
                if processed_path.exists() and processed_path.stat().st_size > 0:
                    input_path = str(processed_path)
                else:
                    logging.getLogger("voice_midi").warning(
                        "Dubler Melody: preprocess output missing; using raw audio %s", wav_path
                    )
            self._set_audio_paths(wav_path, processed_path if use_pre else None)
            decode_mode = (self.decode_mode or "rules").lower().strip()
            magic_preset = None
            if decode_mode in MAGIC_WAND_PRESETS:
                magic_preset = decode_mode
            elif decode_mode in {"magic_wand", "wand", "magic"}:
                magic_preset = "wand_sing"
            if magic_preset:
                notes, cc_events, _pb, _debug = transcribe_magic_wand(
                    input_path,
                    sample_rate=int(crepe_sr) if crepe_sr else self.sample_rate,
                    preset=magic_preset,
                    key=self.target_key,
                    scale=None,
                    strict_key=False,
                    emit_pitchbend=False,
                    return_debug=False,
                )
            else:
                root = None
                scale = None
                if self.target_key:
                    parsed = _parse_key_string(self.target_key)
                    if parsed:
                        root, scale = parsed
                decode_mode_use = decode_mode if decode_mode in {"rules", "viterbi"} else "rules"
                notes, cc_events, _pb, _debug = transcribe_dubler_melody_v2(
                    input_path,
                    sample_rate=int(crepe_sr) if crepe_sr else self.sample_rate,
                    fmin=float(os.getenv("VOICE_MIDI_CREPE_FMIN", "50")),
                    fmax=float(os.getenv("VOICE_MIDI_CREPE_FMAX", "1200")),
                    confidence_threshold=float(
                        self.crepe_conf
                        if self.crepe_conf is not None
                        else os.getenv("VOICE_MIDI_CREPE_CONF", "0.3")
                    ),
                    stable_frames_required=int(
                        self.crepe_stable_frames
                        if self.crepe_stable_frames is not None
                        else os.getenv("VOICE_MIDI_CREPE_STABLE_FRAMES", "3")
                    ),
                    hangover_frames=int(
                        self.crepe_hangover_frames
                        if self.crepe_hangover_frames is not None
                        else os.getenv("VOICE_MIDI_CREPE_HANGOVER", "3")
                    ),
                    min_note_duration=float(
                        self.crepe_min_note_ms
                        if self.crepe_min_note_ms is not None
                        else os.getenv("VOICE_MIDI_CREPE_MIN_NOTE_MS", "0.07")
                    ),
                    key_restrict=bool(root and scale),
                    root=root,
                    scale=scale,
                    quantize_strength=1.0,
                    snap_window_cents=60.0,
                    decode_mode=decode_mode_use,
                    emit_pitchbend=False,
                    return_debug=False,
                )
            if self.enable_formants is False:
                cc_events = []
            return notes, cc_events
        except Exception as exc:
            self._crepe_error = str(exc)
            return [], []
        finally:
            keep_wav = os.getenv("VOICE_MIDI_KEEP_WAV", "").lower() in {"1", "true", "yes"} or bool(
                self.return_processed_audio
            )
            if not keep_wav:
                try:
                    wav_path.unlink(missing_ok=True)
                except Exception:
                    pass
                try:
                    processed_path.unlink(missing_ok=True)
                except Exception:
                    pass

    def _run_dubler_drums(self) -> list:
        if not self._recorded_chunks:
            return []
        tmp_dir = self._voice_midi_dir()
        wav_path = tmp_dir / f"{self.session_id}_dubler_drums.wav"
        processed_path = tmp_dir / f"{self.session_id}_dubler_drums_clean.wav"
        try:
            pcm_bytes = b"".join(self._recorded_chunks)
            self._write_wav(wav_path, pcm_bytes)
            use_pre = os.getenv("VOICE_MIDI_PREPROCESS", "1").lower() not in {"0", "false", "no"}
            input_path = str(wav_path)
            if use_pre:
                preprocess_audio(
                    input_path,
                    str(processed_path),
                    target_sr=int(os.getenv("VOICE_MIDI_PREPROCESS_SR", "22050")),
                    gate_db=float(os.getenv("VOICE_MIDI_GATE_DB", "-45")),
                    gate_mode=os.getenv("VOICE_MIDI_GATE_MODE", "soft"),
                    low_pass_hz=float(os.getenv("VOICE_MIDI_LOW_PASS", "8000")),
                    high_pass_hz=float(os.getenv("VOICE_MIDI_HIGH_PASS", "40")),
                    trim_db=float(os.getenv("VOICE_MIDI_TRIM_DB", "35")),
                    normalize=os.getenv("VOICE_MIDI_NORMALIZE", "1").lower() not in {"0", "false", "no"},
                )
                input_path = str(processed_path)
            self._set_audio_paths(wav_path, processed_path if use_pre else None)
            return transcribe_dubler_drums(
                input_path,
                sample_rate=self.sample_rate,
                base_dir=self._voice_midi_dir(),
            )
        except Exception as exc:
            self._crepe_error = str(exc)
            return []
        finally:
            keep_wav = os.getenv("VOICE_MIDI_KEEP_WAV", "").lower() in {"1", "true", "yes"} or bool(
                self.return_processed_audio
            )
            if not keep_wav:
                try:
                    wav_path.unlink(missing_ok=True)
                except Exception:
                    pass
                try:
                    processed_path.unlink(missing_ok=True)
                except Exception:
                    pass

    def _run_dubler_calibration(self) -> dict:
        if not self._recorded_chunks:
            return {"error": "empty audio"}
        tmp_dir = self._voice_midi_dir()
        wav_path = tmp_dir / f"{self.session_id}_dubler_cal.wav"
        try:
            pcm_bytes = b"".join(self._recorded_chunks)
            self._write_wav(wav_path, pcm_bytes)
            return add_calibration_sample(
                str(wav_path),
                label=self.calibrate_label or "kick",
                sample_rate=self.sample_rate,
                base_dir=self._voice_midi_dir(),
            )
        finally:
            keep_wav = os.getenv("VOICE_MIDI_KEEP_WAV", "").lower() in {"1", "true", "yes"}
            if not keep_wav:
                try:
                    wav_path.unlink(missing_ok=True)
                except Exception:
                    pass

    def _attach_ddsp_asset(self, synth_info: dict, synth_path: Path) -> Optional[dict]:
        if not synth_info or not synth_path:
            return None
        if not self.project_id or not get_project or not save_project:
            return None
        project_record = get_project(self.project_id)
        if not project_record:
            return None
        asset_id = f"ddsp:{uuid.uuid4().hex}"
        asset = {
            "id": asset_id,
            "kind": "derived",
            "label": "DDSP Synth",
            "path": str(synth_path),
            "url": f"/api/download/exports/{synth_path.name}",
            "durationSec": synth_info.get("durationSec", 0.0),
            "sampleRate": synth_info.get("sampleRate"),
        }
        assets = project_record.get("assets") or {}
        assets[asset_id] = asset
        project_record["assets"] = assets

        lanes = project_record.get("lanes") or []
        lane = None
        if self.lane_id:
            lane = next((l for l in lanes if l.get("id") == self.lane_id), None)
        if not lane:
            lane = {
                "id": self.lane_id or uuid.uuid4().hex,
                "projectId": project_record.get("project", {}).get("id"),
                "type": "generated",
                "name": self.lane_name or "DDSP Synth",
                "sourceAssetId": None,
                "mute": False,
                "solo": False,
                "gainDb": 0.0,
                "order": len(lanes) + 1,
            }
            lanes.append(lane)
            project_record["lanes"] = lanes

        clips = project_record.get("clips") or []
        clip = {
            "id": uuid.uuid4().hex,
            "laneId": lane["id"],
            "sourceAssetId": asset_id,
            "srcStartSec": 0.0,
            "srcEndSec": max(0.01, float(asset.get("durationSec") or 0.0)),
            "timelineStartSec": max(0.0, float(self.insert_at_sec or 0.0)),
            "fadeInSec": 0.0,
            "fadeOutSec": 0.0,
            "gainDb": 0.0,
        }
        clips.append(clip)
        project_record["clips"] = clips

        # Update project duration
        duration = 0.0
        for clip_item in clips:
            end = float(clip_item.get("timelineStartSec") or 0.0) + float(clip_item.get("srcEndSec") or 0.0)
            duration = max(duration, end)
        project = project_record.get("project") or {}
        project["durationSec"] = duration
        project["updatedAt"] = _now_iso()
        project_record["project"] = project
        save_project(project_record)
        return {
            "assetId": asset_id,
            "assetUrl": asset.get("url"),
            "durationSec": asset.get("durationSec"),
            "laneId": lane.get("id"),
        }


def _merge_adjacent_notes(notes: List[Dict], gap_sec: float = 0.04) -> List[Dict]:
    if not notes:
        return []
    notes_sorted = sorted(notes, key=lambda n: (n["startSec"], n["endSec"]))
    merged = [notes_sorted[0].copy()]
    for note in notes_sorted[1:]:
        prev = merged[-1]
        if note["note"] == prev["note"] and note["startSec"] - prev["endSec"] <= gap_sec:
            prev["endSec"] = max(prev["endSec"], note["endSec"])
            prev["velocity"] = max(prev["velocity"], note.get("velocity", prev["velocity"]))
        else:
            merged.append(note.copy())
    return merged


def _parse_key_string(key: str):
    if not key:
        return None
    key = key.strip().lower()
    parts = key.replace("major", "maj").replace("minor", "min").split()
    if not parts:
        return None
    root = parts[0]
    mode = "maj"
    if len(parts) > 1:
        if "min" in parts[1]:
            mode = "min"
        elif "maj" in parts[1]:
            mode = "maj"
    return root, mode


def _note_name_to_pc(name: str):
    mapping = {
        "c": 0,
        "c#": 1,
        "db": 1,
        "d": 2,
        "d#": 3,
        "eb": 3,
        "e": 4,
        "f": 5,
        "f#": 6,
        "gb": 6,
        "g": 7,
        "g#": 8,
        "ab": 8,
        "a": 9,
        "a#": 10,
        "bb": 10,
        "b": 11,
    }
    return mapping.get(name)


def _snap_notes_to_scale(notes: List[Dict], key: str) -> List[Dict]:
    parsed = _parse_key_string(key)
    if not parsed:
        return notes
    root, mode = parsed
    root_pc = _note_name_to_pc(root)
    if root_pc is None:
        return notes
    if mode == "min":
        scale = {0, 2, 3, 5, 7, 8, 10}
    else:
        scale = {0, 2, 4, 5, 7, 9, 11}
    scale_pcs = {(root_pc + step) % 12 for step in scale}
    snapped = []
    for note in notes:
        midi = int(note["note"])
        best = midi
        best_dist = 12
        for delta in range(-6, 7):
            candidate = midi + delta
            if candidate < 0 or candidate > 127:
                continue
            if candidate % 12 in scale_pcs:
                dist = abs(delta)
                if dist < best_dist:
                    best_dist = dist
                    best = candidate
                    if dist == 0:
                        break
        snapped_note = note.copy()
        snapped_note["note"] = best
        snapped.append(snapped_note)
    return snapped
