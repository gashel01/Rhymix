"""Match a loop to a project: same tempo, same key, a whole number of bars.

This is what makes a dropped loop "just fit" the way it does in Ableton or Incredibox — every
sound is brought onto the project's grid instead of being left to drift against it.

* Tempo/length: a short clip is almost always meant as a loop of 1, 2, 4, 8... bars, so rather
  than trusting a beat tracker (which routinely answers half or double time) the clip is stretched
  to the nearest whole number of bars at the project's tempo. Only long, off-grid audio (a whole
  song) falls back to beat tracking.
* Key: estimated from the audio's chroma (Krumhansl–Schmuckler profiles) and transposed the fewest
  semitones onto the project's key — relative major/minor count as the same key. A clip with no
  clear pitch (drums, noise) is left alone rather than pitched at random.
* Both moves go through ffmpeg's Rubber Band filter, so the stretch keeps pitch and the transpose
  keeps tempo; the result is trimmed/padded to the exact bar count, faded at the edges and brought
  to a common loudness so loops sit together.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import subprocess
from pathlib import Path

import numpy as np

from backend.paths.manager import paths

LOOP_BARS = (1, 2, 4, 8, 16, 32)
# Past this a clip is a song or a take, not a loop: no snapping to whole bars.
MAX_LOOP_SEC = 40.0
# How far off a whole number of bars a clip may be and still be treated as that loop.
LOOP_SNAP_TOLERANCE = 1.25
KEY_MIN_CONFIDENCE = 0.55
TARGET_LUFS = -16.0

_NOTE_PC = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}
_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
_PC_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")


def parse_key(text) -> tuple[int, bool] | None:
    """"C minor", "Cm", "F# major", "Bb" -> (tonic pitch class, is_minor). None if unreadable."""
    match = re.match(r"^\s*([A-Ga-g])\s*([#♯b♭]?)\s*(.*)$", str(text or ""))
    if not match:
        return None
    letter, accidental, rest = match.groups()
    pc = _NOTE_PC[letter.lower()]
    if accidental in ("#", "♯"):
        pc += 1
    elif accidental in ("b", "♭"):
        pc -= 1
    rest = rest.strip().lower()
    minor = rest.startswith("min") or rest == "m" or rest.startswith("m ") or (rest.startswith("m") and not rest.startswith("maj"))
    return pc % 12, minor


def key_name(pc: int, minor: bool) -> str:
    return f"{_PC_NAMES[pc % 12]} {'minor' if minor else 'major'}"


def semitone_shift(src: tuple[int, bool], target: tuple[int, bool]) -> int:
    """Fewest semitones (-5..+6) taking the source key onto the target. Relative major/minor are
    the same set of notes, so both are compared as their relative major."""
    rel = lambda key: (key[0] + 3) % 12 if key[1] else key[0]  # noqa: E731
    delta = (rel(target) - rel(src)) % 12
    return delta - 12 if delta > 6 else delta


def estimate_key(y: np.ndarray, sr: int) -> tuple[int, bool, float]:
    """(tonic pitch class, is_minor, confidence 0..1). Confidence is the winning profile's
    correlation; a flat chroma (unpitched audio) scores low."""
    import librosa

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr).mean(axis=1)
    if not np.isfinite(chroma).all() or chroma.std() < 1e-6:
        return 0, False, 0.0
    best = (0, False, -1.0)
    for minor, profile in ((False, _MAJOR), (True, _MINOR)):
        for pc in range(12):
            score = float(np.corrcoef(chroma, np.roll(profile, pc))[0, 1])
            if score > best[2]:
                best = (pc, minor, score)
    return best


def plan_tempo(duration_sec: float, target_bpm: float, beat_bpm: float | None) -> dict:
    """{"tempo": rubberband tempo ratio (>1 = faster), "bars": whole bars or None}."""
    bar_sec = 240.0 / target_bpm
    if duration_sec <= MAX_LOOP_SEC:
        bars = min(LOOP_BARS, key=lambda n: abs(math.log(duration_sec / (n * bar_sec))))
        ratio = duration_sec / (bars * bar_sec)
        if 1 / LOOP_SNAP_TOLERANCE <= ratio <= LOOP_SNAP_TOLERANCE:
            return {"tempo": 1.0 if abs(ratio - 1) < 0.01 else ratio, "bars": bars}
    if beat_bpm and beat_bpm > 0:
        folded = min((beat_bpm / 2, beat_bpm, beat_bpm * 2), key=lambda b: abs(math.log(b / target_bpm)))
        ratio = target_bpm / folded
        # Stretching a whole song by more than a quarter sounds worse than leaving it be.
        if abs(ratio - 1) < 0.03 or not 1 / LOOP_SNAP_TOLERANCE <= ratio <= LOOP_SNAP_TOLERANCE:
            return {"tempo": 1.0, "bars": None}
        return {"tempo": ratio, "bars": None}
    return {"tempo": 1.0, "bars": None}


def _load_mono(path: Path, sr: int = 22050, max_sec: float = 30.0) -> np.ndarray:
    import librosa

    y, _ = librosa.load(str(path), sr=sr, mono=True, duration=max_sec)
    return y


def _cache_name(source: Path, target_bpm: float, target_key, normalize: bool) -> str:
    stamp = f"{source}|{source.stat().st_mtime_ns}|{target_bpm:.3f}|{target_key}|{normalize}"
    return hashlib.sha1(stamp.encode()).hexdigest()[:20]


def match_loop(source: Path, target_bpm: float, target_key_text: str | None = None, normalize: bool = True) -> dict:
    """Produce a matched copy of `source` in the exports folder and describe it."""
    import soundfile as sf

    from backend.features.studio.assets import probe_audio

    source = Path(source)
    if not source.exists():
        raise RuntimeError(f"Source audio not found: {source}")
    target_bpm = float(target_bpm)
    if not 30 <= target_bpm <= 300:
        raise ValueError("bpm must be between 30 and 300")
    target_key = parse_key(target_key_text)

    digest = _cache_name(source, target_bpm, target_key, normalize)
    out_path = paths.EXPORT_DIR / f"matched_{digest}.wav"
    info_path = out_path.with_suffix(".json")
    if out_path.exists() and info_path.exists():
        return _describe(out_path, json.loads(info_path.read_text(encoding="utf-8")), probe_audio)

    info_src = probe_audio(source)
    duration = float(info_src.get("durationSec") or 0.0)
    if duration <= 0:
        raise RuntimeError("Could not read the audio's duration.")
    plan = plan_tempo(duration, target_bpm, info_src.get("bpm"))

    semitones = 0
    detected = None
    key_note = None
    if target_key:
        pc, minor, confidence = estimate_key(_load_mono(source), 22050)
        detected = key_name(pc, minor)
        if confidence >= KEY_MIN_CONFIDENCE:
            semitones = semitone_shift((pc, minor), target_key)
        else:
            key_note = "no clear key (percussive?) — left unpitched"

    out_path.parent.mkdir(parents=True, exist_ok=True)
    if plan["tempo"] == 1.0 and semitones == 0:
        y, sr = sf.read(str(source), dtype="float32", always_2d=True)
    else:
        tmp = out_path.with_suffix(".tmp.wav")
        rb = f"rubberband=tempo={plan['tempo']:.5f}:pitch={2 ** (semitones / 12):.5f}:formant=preserved:pitchq=quality"
        proc = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(source), "-af", rb, str(tmp)],
            capture_output=True, text=True, check=False,
        )
        if proc.returncode != 0 or not tmp.exists():
            raise RuntimeError(proc.stderr.strip() or "ffmpeg rubberband failed")
        try:
            y, sr = sf.read(str(tmp), dtype="float32", always_2d=True)
        finally:
            tmp.unlink(missing_ok=True)

    if plan["bars"]:
        want = int(round(plan["bars"] * 240.0 / target_bpm * sr))
        y = y[:want] if len(y) >= want else np.pad(y, ((0, want - len(y)), (0, 0)))
    fade = min(int(0.005 * sr), len(y) // 2)
    if fade:
        ramp = np.linspace(0.0, 1.0, fade, dtype="float32")[:, None]
        y[:fade] *= ramp
        y[-fade:] *= ramp[::-1]
    gain_db = 0.0
    if normalize and len(y) >= int(0.5 * sr):
        import pyloudnorm as pyln

        loudness = pyln.Meter(sr).integrated_loudness(y)
        if np.isfinite(loudness):
            gain_db = max(-12.0, min(12.0, TARGET_LUFS - loudness))
            peak = float(np.max(np.abs(y))) or 1.0
            gain_db = min(gain_db, 20 * math.log10(0.97 / peak))
            y = y * (10 ** (gain_db / 20))
    sf.write(str(out_path), y, sr, subtype="PCM_16")

    info = {
        "targetBpm": target_bpm,
        "targetKey": key_name(*target_key) if target_key else None,
        "detectedKey": detected,
        "tempoRatio": round(plan["tempo"], 4),
        "bars": plan["bars"],
        "semitones": semitones,
        "gainDb": round(gain_db, 2),
        "note": key_note,
    }
    info_path.write_text(json.dumps(info), encoding="utf-8")
    return _describe(out_path, info, probe_audio)


def _describe(out_path: Path, info: dict, probe_audio) -> dict:
    probed = probe_audio(out_path)
    return {
        "assetId": f"matched:{out_path.stem.removeprefix('matched_')}",
        "assetPath": str(out_path),
        "assetUrl": f"/api/download/exports/{out_path.name}",
        "durationSec": probed.get("durationSec", 0.0),
        "sampleRate": probed.get("sampleRate"),
        "info": info,
    }
