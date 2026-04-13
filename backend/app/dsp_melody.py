import math
from dataclasses import dataclass, field
from typing import List, Optional

import aubio
import numpy as np


def hz_to_midi(freq: float) -> int:
    if freq <= 0:
        return 0
    return int(round(69 + 12 * math.log2(freq / 440.0)))


@dataclass
class NoteEvent:
    start_sec: float
    end_sec: float
    note: int
    velocity: int


@dataclass
class MelodyProcessor:
    sample_rate: int
    hop_size: int
    buffer_size: Optional[int] = None
    confidence_threshold: float = 0.45
    rms_threshold: float = 0.006
    min_note_duration: float = 0.07
    stable_frames_required: int = 3
    hangover_frames: int = 2
    _pitch: aubio.pitch = field(init=False, repr=False)
    _current_note: Optional[int] = field(default=None, init=False, repr=False)
    _current_start: Optional[float] = field(default=None, init=False, repr=False)
    _current_velocity: int = field(default=80, init=False, repr=False)
    _note_hist: List[int] = field(default_factory=list, init=False, repr=False)
    _candidate_note: Optional[int] = field(default=None, init=False, repr=False)
    _candidate_count: int = field(default=0, init=False, repr=False)
    _invalid_count: int = field(default=0, init=False, repr=False)
    events: List[NoteEvent] = field(default_factory=list, init=False)

    def __post_init__(self):
        if not self.buffer_size:
            self.buffer_size = self.hop_size * 2
        self._pitch = aubio.pitch("yinfft", self.buffer_size, self.hop_size, self.sample_rate)
        self._pitch.set_unit("Hz")
        self._pitch.set_silence(-40)

    def _velocity_from_rms(self, rms: float) -> int:
        # Map RMS to MIDI velocity 20-127
        value = int(20 + min(1.0, rms / 0.3) * 107)
        return max(1, min(127, value))

    def _close_note(self, end_time: float):
        if self._current_note is None or self._current_start is None:
            return
        duration = end_time - self._current_start
        if duration >= self.min_note_duration:
            self.events.append(
                NoteEvent(
                    start_sec=self._current_start,
                    end_sec=end_time,
                    note=self._current_note,
                    velocity=self._current_velocity,
                )
            )
        self._current_note = None
        self._current_start = None
        self._candidate_note = None
        self._candidate_count = 0
        self._invalid_count = 0

    def process(self, frame: np.ndarray, time_sec: float):
        if frame.size == 0:
            return
        rms = float(np.sqrt(np.mean(frame ** 2)))
        if rms < self.rms_threshold:
            self._note_hist.clear()
            self._close_note(time_sec)
            return

        pitch = float(self._pitch(frame)[0])
        confidence = float(self._pitch.get_confidence())
        if confidence < self.confidence_threshold or pitch <= 0:
            self._invalid_count += 1
            if self._invalid_count >= self.hangover_frames:
                self._note_hist.clear()
                self._close_note(time_sec)
            return
        self._invalid_count = 0

        note = hz_to_midi(pitch)
        if note <= 0:
            self._close_note(time_sec)
            return

        self._note_hist.append(note)
        if len(self._note_hist) > 7:
            self._note_hist.pop(0)
        smoothed = int(np.median(self._note_hist))
        velocity = self._velocity_from_rms(rms)

        if self._current_note is None:
            self._current_note = smoothed
            self._current_start = time_sec
            self._current_velocity = velocity
            return

        if smoothed != self._current_note:
            if self._candidate_note == smoothed:
                self._candidate_count += 1
            else:
                self._candidate_note = smoothed
                self._candidate_count = 1
            if self._candidate_count >= self.stable_frames_required:
                self._close_note(time_sec)
                self._current_note = smoothed
                self._current_start = time_sec
                self._current_velocity = velocity
                self._candidate_note = None
                self._candidate_count = 0
        else:
            self._candidate_note = None
            self._candidate_count = 0
            self._current_velocity = max(self._current_velocity, velocity)

    def finalize(self, end_time: float):
        self._close_note(end_time)
        self._note_hist.clear()
        return self.events
