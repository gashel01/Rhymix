from dataclasses import dataclass, field
from typing import List

import aubio
import numpy as np


@dataclass
class RhythmEvent:
    time_sec: float
    velocity: int
    note: int


@dataclass
class RhythmProcessor:
    sample_rate: int
    hop_size: int
    buffer_size: int = None
    rms_threshold: float = 0.01
    events: List[RhythmEvent] = field(default_factory=list, init=False)
    _onset: aubio.onset = field(init=False, repr=False)

    def __post_init__(self):
        if not self.buffer_size:
            self.buffer_size = self.hop_size * 2
        self._onset = aubio.onset("default", self.buffer_size, self.hop_size, self.sample_rate)
        try:
            self._onset.set_silence(-40)
            self._onset.set_threshold(0.3)
        except Exception:
            pass

    def _velocity_from_rms(self, rms: float) -> int:
        value = int(30 + min(1.0, rms / 0.4) * 97)
        return max(1, min(127, value))

    def _classify_note(self, frame: np.ndarray) -> int:
        if frame.size == 0:
            return 36
        spectrum = np.abs(np.fft.rfft(frame))
        freqs = np.fft.rfftfreq(frame.size, 1.0 / self.sample_rate)
        low_energy = float(np.sum(spectrum[(freqs >= 20) & (freqs <= 150)]))
        high_energy = float(np.sum(spectrum[(freqs >= 2000) & (freqs <= 8000)]))
        if low_energy > high_energy * 1.5:
            return 36  # Kick
        if high_energy > low_energy * 1.5:
            return 42  # Hi-hat
        return 38  # Snare

    def process(self, frame: np.ndarray, time_sec: float):
        if frame.size == 0:
            return
        rms = float(np.sqrt(np.mean(frame ** 2)))
        if rms < self.rms_threshold:
            return
        if self._onset(frame):
            velocity = self._velocity_from_rms(rms)
            note = self._classify_note(frame)
            self.events.append(RhythmEvent(time_sec=time_sec, velocity=velocity, note=note))

    def finalize(self):
        return self.events
