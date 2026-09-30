import logging
from dataclasses import dataclass
from typing import Dict, List, Literal, Optional, Tuple

import librosa
import numpy as np

try:
    from .crepe_adapter import transcribe_crepe_frames
except Exception:  # pragma: no cover — torch/torchaudio not available (e.g. CI)
    transcribe_crepe_frames = None  # type: ignore[assignment]

try:
    import parselmouth
except Exception:  # pragma: no cover
    parselmouth = None

logger = logging.getLogger("voice_midi")


def _hz_to_midi_float(freq: float) -> float:
    if freq <= 0:
        return float("nan")
    return 69.0 + 12.0 * np.log2(freq / 440.0)


def _median_filter_nan(values: np.ndarray, win: int = 5) -> np.ndarray:
    if win <= 1 or values.size == 0:
        return values
    pad = win // 2
    if values.size < win:
        window = values
        return np.full_like(values, np.nan) if np.all(np.isnan(window)) else np.nanmedian(window) * np.ones_like(values)
    try:
        from numpy.lib.stride_tricks import sliding_window_view

        padded = np.pad(values.astype(float), (pad, pad), mode="constant", constant_values=np.nan)
        windows = sliding_window_view(padded, win)
        return np.nanmedian(windows, axis=-1)
    except Exception:
        out = np.copy(values)
        for i in range(values.size):
            start = max(0, i - pad)
            end = min(values.size, i + pad + 1)
            window = values[start:end]
            if np.all(np.isnan(window)):
                out[i] = np.nan
            else:
                out[i] = np.nanmedian(window)
        return out


def _fill_nan_with_interp(values: np.ndarray, times: np.ndarray) -> np.ndarray:
    if values.size == 0 or times.size != values.size:
        return values
    if np.all(np.isfinite(values)):
        return values
    finite = np.isfinite(values)
    if not np.any(finite):
        return np.zeros_like(values, dtype=float)
    filled = np.array(values, dtype=float, copy=True)
    filled[~finite] = np.interp(times[~finite], times[finite], filled[finite])
    return filled


def _compute_rms_series(audio: np.ndarray, sr: int, hop_length: int) -> Tuple[np.ndarray, np.ndarray]:
    rms = librosa.feature.rms(y=audio, frame_length=2048, hop_length=hop_length)[0]
    times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop_length)
    return rms, times


def _align_series(values: np.ndarray, value_times: np.ndarray, target_times: np.ndarray) -> np.ndarray:
    if values.size == 0 or target_times.size == 0:
        return np.zeros_like(target_times)
    finite = np.isfinite(values) & np.isfinite(value_times)
    if not np.any(finite):
        return np.zeros_like(target_times)
    vt = value_times[finite]
    vv = values[finite]
    left = float(vv[0])
    right = float(vv[-1])
    return np.interp(target_times, vt, vv, left=left, right=right)


def _estimate_noise_floor(rms: np.ndarray, conf: np.ndarray, conf_thr: float) -> float:
    if rms.size == 0:
        return 1e-6
    quiet = rms[conf < (conf_thr * 0.6)]
    if quiet.size < 5:
        quiet = rms
    return float(np.percentile(quiet, 20))


def _apply_voicing_hysteresis(mask: np.ndarray, on_frames: int, off_frames: int) -> np.ndarray:
    state = False
    on_count = 0
    off_count = 0
    out = np.zeros_like(mask, dtype=bool)
    for i, val in enumerate(mask):
        if val:
            on_count += 1
            off_count = 0
        else:
            off_count += 1
            on_count = 0
        if not state and on_count >= on_frames:
            state = True
        elif state and off_count >= off_frames:
            state = False
        out[i] = state
    return out


def _apply_octave_guard(
    cents: np.ndarray,
    conf: np.ndarray,
    conf_thr: float,
    octave_jump_cents: float,
    max_frames: int,
) -> np.ndarray:
    out = np.copy(cents)
    last = np.nan
    jump_frames = 0
    for i, val in enumerate(cents):
        if np.isnan(val):
            continue
        if np.isnan(last):
            last = val
            continue
        if abs(val - last) > octave_jump_cents and conf[i] < conf_thr * 1.1:
            jump_frames += 1
            out[i] = last
            if jump_frames > max_frames:
                last = val
                jump_frames = 0
        else:
            last = val
            jump_frames = 0
    return out


def _nearest_onset(start_sec: float, onset_times: np.ndarray, max_distance: float) -> float:
    if onset_times.size == 0:
        return start_sec
    ot = onset_times
    if ot.size > 1 and np.any(np.diff(ot) < 0):
        ot = np.sort(ot)
    idx = np.searchsorted(ot, start_sec)
    candidates = []
    if idx > 0:
        candidates.append(float(ot[idx - 1]))
    if idx < ot.size:
        candidates.append(float(ot[idx]))
    if not candidates:
        return start_sec
    best = start_sec
    best_dist = max_distance + 1.0
    for onset in candidates:
        dist = abs(start_sec - onset)
        if dist <= max_distance:
            if dist < best_dist - 1e-9 or (abs(dist - best_dist) <= 1e-9 and onset <= best):
                best = onset
                best_dist = dist
    return best


def _time_in_sorted(times: np.ndarray, t: float, atol: float = 1e-6) -> bool:
    if times.size == 0:
        return False
    idx = int(np.searchsorted(times, t))
    for j in (idx - 1, idx):
        if 0 <= j < times.size and abs(float(times[j]) - t) <= atol:
            return True
    return False


def _find_next_onset(end_sec: float, onset_times: np.ndarray) -> Optional[float]:
    if onset_times.size == 0:
        return None
    ot = onset_times
    if ot.size > 1 and np.any(np.diff(ot) < 0):
        ot = np.sort(ot)
    idx = np.searchsorted(ot, end_sec)
    if idx < ot.size:
        return float(ot[idx])
    return None


def _detect_attack_times_from_rms(
    times: np.ndarray,
    rms: np.ndarray,
    *,
    min_interval_sec: float = 0.05,
    rise_threshold: float = 0.08,
) -> np.ndarray:
    """
    Detect attack-like moments from RMS rise.
    - times and rms are aligned to CREPE frame times.
    - rise_threshold is relative (normalized) RMS rise.
    """
    if times.size < 3 or rms.size != times.size:
        return np.array([], dtype=float)

    r = rms.astype(float)
    r = r / (np.max(r) + 1e-9)
    dr = np.diff(r, prepend=r[0])
    candidates = np.where(dr >= rise_threshold)[0]
    if candidates.size == 0:
        return np.array([], dtype=float)

    attacks = []
    last_t = -1e9
    for idx in candidates:
        t = float(times[idx])
        if t - last_t >= min_interval_sec:
            attacks.append(t)
            last_t = t
    return np.array(attacks, dtype=float)


def _merge_same_pitch_notes(notes: List[dict], gap_sec: float) -> List[dict]:
    if not notes:
        return []
    notes_sorted = sorted(notes, key=lambda n: (n["startSec"], n["endSec"]))
    merged = [notes_sorted[0].copy()]
    for note in notes_sorted[1:]:
        prev = merged[-1]
        if note["note"] == prev["note"] and note["startSec"] - prev["endSec"] <= gap_sec:
            prev["endSec"] = max(prev["endSec"], note["endSec"])
            prev["velocity"] = max(prev.get("velocity", 0), note.get("velocity", 0))
            if "midiRaw" in note or "midiRaw" in prev:
                values = []
                if "midiRaw" in prev:
                    values.append(prev["midiRaw"])
                if "midiRaw" in note:
                    values.append(note["midiRaw"])
                if values:
                    prev["midiRaw"] = int(np.median(values))
        else:
            merged.append(note.copy())
    return merged


def _velocity_from_window(
    rms_series: np.ndarray,
    times: np.ndarray,
    start_sec: float,
    window_sec: float,
    velocity_min: int,
    velocity_curve: float,
    rms_peak: float,
) -> int:
    if rms_series.size == 0 or rms_peak <= 0:
        return max(1, velocity_min)
    end_sec = start_sec + window_sec
    idx = np.where((times >= start_sec) & (times <= end_sec))[0]
    if idx.size == 0:
        idx = np.where(times >= start_sec)[0][:1]
    if idx.size == 0:
        return max(1, velocity_min)
    window = rms_series[idx]
    value = float(np.percentile(window, 90))
    norm = np.clip(value / rms_peak, 0.0, 1.0)
    vel = velocity_min + (127 - velocity_min) * (norm ** velocity_curve)
    return int(np.clip(vel, 1, 127))


def _compute_formants(audio: np.ndarray, sr: int, note_times: List[float]) -> List[dict]:
    if parselmouth is None:
        return []
    try:
        sound = parselmouth.Sound(audio, sampling_frequency=sr)
        formant = sound.to_formant_burg()
    except Exception:
        return []
    cc_events = []
    for t in note_times:
        try:
            f1 = formant.get_value_at_time(1, t)
            f2 = formant.get_value_at_time(2, t)
        except Exception:
            continue
        # Praat returns NaN on frames where it finds no formant, and NaN is
        # truthy and fails every "<= 0" test, so it used to sail past the guard
        # below and blow up on int(np.clip(nan)) — taking the whole
        # transcription down with it, not just this one frame.
        if f1 is None or f2 is None or not np.isfinite(f1) or not np.isfinite(f2):
            continue
        if f1 <= 0 or f2 <= 0:
            continue
        cc_events.append(
            {
                "timeSec": float(t),
                "cc": 74,
                "value": int(np.clip((f1 - 300.0) / (900.0 - 300.0) * 127.0, 0, 127)),
            }
        )
        cc_events.append(
            {
                "timeSec": float(t),
                "cc": 71,
                "value": int(np.clip((f2 - 800.0) / (2500.0 - 800.0) * 127.0, 0, 127)),
            }
        )
    return cc_events


_SCALE_INTERVALS = {
    "major": [0, 2, 4, 5, 7, 9, 11],
    "minor": [0, 2, 3, 5, 7, 8, 10],
    "pentatonic": [0, 2, 4, 7, 9],
    "blues": [0, 3, 5, 6, 7, 10],
}


@dataclass(frozen=True)
class MagicWandPreset:
    name: str
    description: str
    params: Dict[str, object]


MAGIC_WAND_PRESETS: Dict[str, MagicWandPreset] = {
    "wand_sing": MagicWandPreset(
        name="wand_sing",
        description="Default singing/humming preset (balanced, intention-first).",
        params={
            "fmin": 50.0,
            "fmax": 1200.0,
            "confidence_threshold": 0.30,
            "gate_ratio": 2.5,
            "viterbi_base_sigma_cents": 30.0,
            "viterbi_change_cost": 1.1,
            "viterbi_off_onset_penalty": 1.2,
            "viterbi_onset_change_reward": -0.35,
            "viterbi_rest_toggle_penalty": 0.7,
            "viterbi_rest_cost_voiced": 2.4,
            "viterbi_min_run_frames": 3,
            "detune_max_slope_semitones_per_sec": 3.0,
        },
    ),
    "wand_whistle": MagicWandPreset(
        name="wand_whistle",
        description="Whistling preset (higher fmin, tighter pitch fit).",
        params={
            "fmin": 350.0,
            "fmax": 3000.0,
            "confidence_threshold": 0.25,
            "gate_ratio": 2.2,
            "viterbi_base_sigma_cents": 25.0,
            "viterbi_change_cost": 1.0,
            "viterbi_off_onset_penalty": 1.1,
            "viterbi_onset_change_reward": -0.35,
            "viterbi_rest_toggle_penalty": 0.8,
            "viterbi_rest_cost_voiced": 2.2,
            "viterbi_min_run_frames": 3,
            "detune_max_slope_semitones_per_sec": 4.0,
        },
    ),
    "wand_noisy_room": MagicWandPreset(
        name="wand_noisy_room",
        description="Noisy room preset (stronger gating, more conservative voicing).",
        params={
            "fmin": 60.0,
            "fmax": 1200.0,
            "confidence_threshold": 0.4,
            "gate_ratio": 3.0,
            "flatness_threshold": 0.2,
            "viterbi_base_sigma_cents": 32.0,
            "viterbi_change_cost": 1.2,
            "viterbi_off_onset_penalty": 1.4,
            "viterbi_onset_change_reward": -0.3,
            "viterbi_rest_toggle_penalty": 0.9,
            "viterbi_rest_cost_voiced": 2.8,
            "viterbi_min_run_frames": 3,
            "detune_max_slope_semitones_per_sec": 3.0,
        },
    ),
}


def _parse_root(root: Optional[object]) -> Optional[int]:
    if root is None:
        return None
    if isinstance(root, (int, float)):
        return int(root) % 12
    name = str(root).strip().lower()
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


def _build_allowed_notes(root: Optional[object], scale: Optional[str]) -> Optional[set]:
    if root is None or not scale:
        return None
    root_pc = _parse_root(root)
    if root_pc is None:
        return None
    intervals = _SCALE_INTERVALS.get(scale.lower())
    if not intervals:
        return None
    allowed = set()
    for midi in range(0, 128):
        if (midi - root_pc) % 12 in intervals:
            allowed.add(midi)
    return allowed


_KEY_PROFILE_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_KEY_PROFILE_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def _estimate_key_from_pitch_classes(
    midi_float: np.ndarray,
    conf: np.ndarray,
    voiced: np.ndarray,
    conf_thr: float,
    min_frames: int = 20,
) -> Optional[Tuple[int, str, float]]:
    mask = voiced.astype(bool) & np.isfinite(midi_float) & (conf >= conf_thr)
    if np.sum(mask) < min_frames:
        return None
    midi_round = np.round(midi_float[mask]).astype(int)
    pcs = np.mod(midi_round, 12)
    hist = np.zeros(12, dtype=float)
    weights = conf[mask]
    for pc, w in zip(pcs, weights):
        hist[int(pc)] += float(w)
    if not np.any(hist):
        return None
    hist = hist / (np.linalg.norm(hist) + 1e-9)
    major = _KEY_PROFILE_MAJOR / (np.linalg.norm(_KEY_PROFILE_MAJOR) + 1e-9)
    minor = _KEY_PROFILE_MINOR / (np.linalg.norm(_KEY_PROFILE_MINOR) + 1e-9)
    best_score = -1e9
    best = None
    for root in range(12):
        score_major = float(np.dot(hist, np.roll(major, root)))
        if score_major > best_score:
            best_score = score_major
            best = (root, "major", score_major)
        score_minor = float(np.dot(hist, np.roll(minor, root)))
        if score_minor > best_score:
            best_score = score_minor
            best = (root, "minor", score_minor)
    return best


_ALLOWED_SORT_CACHE: Dict[int, Tuple[object, List[int]]] = {}


def _quantize_midi(
    midi_raw: int,
    midi_float: float,
    allowed: Optional[set],
    prev_note: Optional[int],
    quantize_strength: float,
    snap_window_cents: float,
) -> int:
    if allowed is None or len(allowed) == 0 or quantize_strength <= 0:
        return midi_raw
    if isinstance(allowed, (list, tuple, np.ndarray)):
        allowed_list = list(allowed)
    else:
        cached = _ALLOWED_SORT_CACHE.get(id(allowed))
        if cached and cached[0] is allowed:
            allowed_list = cached[1]
        else:
            allowed_list = sorted(list(allowed))
            _ALLOWED_SORT_CACHE[id(allowed)] = (allowed, allowed_list)
    if len(allowed_list) == 0:
        return midi_raw
    if allowed_list != sorted(allowed_list):
        allowed_list = sorted(allowed_list)
    import bisect

    idx = bisect.bisect_left(allowed_list, midi_float)
    candidates = []
    if idx < len(allowed_list):
        candidates.append(allowed_list[idx])
    if idx > 0:
        candidates.append(allowed_list[idx - 1])
    nearest = min(
        candidates,
        key=lambda n: (abs(n - midi_float), abs((n - prev_note) if prev_note is not None else 0)),
    )
    diff_cents = abs(nearest - midi_float) * 100.0
    if quantize_strength >= 1.0:
        return int(nearest)
    if diff_cents <= snap_window_cents:
        return int(nearest)
    return midi_raw


def _candidate_notes_for_frame(
    midi_val: float,
    allowed_sorted: Optional[List[int]],
    *,
    radius_semitones: float,
    max_candidates: int,
    key_restrict: bool,
) -> List[int]:
    if allowed_sorted and key_restrict:
        import bisect

        lo = midi_val - radius_semitones
        hi = midi_val + radius_semitones
        left = bisect.bisect_left(allowed_sorted, lo)
        right = bisect.bisect_right(allowed_sorted, hi)
        candidates = allowed_sorted[left:right]
        if not candidates:
            idx = bisect.bisect_left(allowed_sorted, midi_val)
            neighbors = []
            if idx < len(allowed_sorted):
                neighbors.append(allowed_sorted[idx])
            if idx > 0:
                neighbors.append(allowed_sorted[idx - 1])
            candidates = neighbors
        if len(candidates) > max_candidates:
            candidates = sorted(candidates, key=lambda n: abs(n - midi_val))[:max_candidates]
            candidates = sorted(candidates)
        return list(candidates)
    low = int(np.floor(midi_val - radius_semitones))
    high = int(np.ceil(midi_val + radius_semitones))
    low = max(0, low)
    high = min(127, high)
    candidates = list(range(low, high + 1))
    if len(candidates) > max_candidates:
        candidates = sorted(candidates, key=lambda n: abs(n - midi_val))[:max_candidates]
        candidates = sorted(candidates)
    return candidates


def _viterbi_decode_notes(
    times: np.ndarray,
    midi_float: np.ndarray,
    conf: np.ndarray,
    voiced: np.ndarray,
    near_onset: np.ndarray,
    vibrato_mask: np.ndarray,
    *,
    candidate_allowed_notes: Optional[set],
    scale_prior_notes: Optional[set],
    key_restrict: bool,
    confidence_threshold: float,
    radius_semitones: float,
    max_candidates: int,
    base_sigma_cents: float,
    scale_prior_penalty_cents: float,
    scale_prior_strength: float,
    change_cost: float,
    jump_cost_per_semitone: float,
    off_onset_penalty: float,
    onset_change_reward: float,
    rest_toggle_penalty: float,
    rest_cost_unvoiced: float,
    rest_cost_lowconf: float,
    rest_cost_voiced: float,
    pitch_unvoiced_cost: float,
    stay_reward: float,
    slide_rate_threshold: float,
    slide_penalty: float,
    vibrato_transition_boost: float,
) -> np.ndarray:
    if times.size == 0:
        return np.array([], dtype=int)
    midi_for_emit = _fill_nan_with_interp(midi_float.astype(float), times.astype(float))
    allowed_sorted = sorted(list(candidate_allowed_notes)) if candidate_allowed_notes else None
    slope_rate = np.zeros_like(midi_float, dtype=float)
    if midi_float.size > 1:
        slope_rate = np.abs(np.gradient(midi_float, times))
        slope_rate[~np.isfinite(slope_rate)] = 0.0

    candidates = []
    emissions = []
    for i, m in enumerate(midi_for_emit):
        if not np.isfinite(m):
            m = 0.0
        cand = _candidate_notes_for_frame(
            m,
            allowed_sorted,
            radius_semitones=radius_semitones,
            max_candidates=max_candidates,
            key_restrict=key_restrict,
        )
        cand = list(cand)
        cand.append(-1)
        candidates.append(cand)

        m_val = float(midi_for_emit[i]) if np.isfinite(midi_for_emit[i]) else m
        raw_sigma = base_sigma_cents / max(1e-6, float(conf[i]))
        sigma_cents = float(np.clip(raw_sigma, 20.0, 120.0))
        costs = np.zeros(len(cand), dtype=float)
        for j, n in enumerate(cand):
            if n == -1:
                if not voiced[i]:
                    costs[j] = rest_cost_unvoiced
                elif conf[i] < confidence_threshold * 0.6:
                    costs[j] = rest_cost_lowconf
                else:
                    costs[j] = rest_cost_voiced
                continue
            if not voiced[i]:
                costs[j] = pitch_unvoiced_cost
                continue
            diff_cents = (m_val - float(n)) * 100.0
            costs[j] = (diff_cents / max(1e-6, sigma_cents)) ** 2
            if scale_prior_notes and (n not in scale_prior_notes):
                prior = (scale_prior_penalty_cents / max(1e-6, sigma_cents)) ** 2
                costs[j] += prior * scale_prior_strength
        emissions.append(costs)

    backptr = []
    prev_cost = emissions[0].copy()
    backptr.append(np.full_like(prev_cost, -1, dtype=int))

    for t in range(1, len(times)):
        curr_cand = candidates[t]
        prev_cand = candidates[t - 1]
        curr_cost = emissions[t]
        dp = np.full(len(curr_cand), np.inf, dtype=float)
        bp = np.zeros(len(curr_cand), dtype=int)
        for j, n in enumerate(curr_cand):
            best_val = np.inf
            best_idx = 0
            for i, p in enumerate(prev_cand):
                cost = prev_cost[i]
                if (p == -1) != (n == -1):
                    cost += rest_toggle_penalty
                if p == n and p != -1:
                    cost += stay_reward
                else:
                    if p == -1 or n == -1:
                        cost += change_cost * 0.6
                    else:
                        cost += change_cost + jump_cost_per_semitone * abs(n - p)
                        if near_onset[t]:
                            cost += onset_change_reward
                        else:
                            cost += off_onset_penalty
                        if slope_rate[t] >= slide_rate_threshold:
                            cost += slide_penalty
                        if vibrato_mask[t]:
                            cost += change_cost * vibrato_transition_boost
                if cost < best_val:
                    best_val = cost
                    best_idx = i
            dp[j] = best_val + curr_cost[j]
            bp[j] = best_idx
        prev_cost = dp
        backptr.append(bp)

    seq = np.full(len(times), -1, dtype=int)
    last_idx = int(np.argmin(prev_cost))
    for t in range(len(times) - 1, -1, -1):
        seq[t] = int(candidates[t][last_idx])
        last_idx = int(backptr[t][last_idx]) if t > 0 else last_idx
    return seq


def _segments_from_decoded_sequence(
    note_seq: np.ndarray,
    times: np.ndarray,
    midi_float: np.ndarray,
    conf: np.ndarray,
    *,
    onset_times: np.ndarray,
    onset_snap_max: float,
    settle_ignore_first_sec: float,
    min_frames: int,
    confidence_threshold: float,
    allowed_midi_notes: Optional[set],
    quantize_strength: float,
    snap_window_cents: float,
) -> List[dict]:
    notes: List[dict] = []
    if note_seq.size == 0 or times.size == 0:
        return notes
    frame_dt = float(np.median(np.diff(times))) if times.size > 1 else 0.01
    i = 0
    prev_note = None
    while i < note_seq.size:
        n = int(note_seq[i])
        if n < 0:
            i += 1
            continue
        start_i = i
        while i < note_seq.size and int(note_seq[i]) == n:
            i += 1
        end_i = i - 1
        start_sec = float(times[start_i])
        end_sec = float(times[end_i] + frame_dt)
        snap = _nearest_onset(start_sec, onset_times, onset_snap_max)
        if abs(snap - start_sec) <= onset_snap_max:
            start_sec = float(snap)
        if end_sec <= start_sec:
            end_sec = start_sec + max(0.001, frame_dt)

        eval_start = start_sec + float(settle_ignore_first_sec)
        seg_times = times[start_i : end_i + 1]
        seg_midi = midi_float[start_i : end_i + 1]
        seg_conf = conf[start_i : end_i + 1]
        idx = np.where(
            (seg_times >= eval_start)
            & (seg_times <= end_sec)
            & np.isfinite(seg_midi)
            & (seg_conf >= confidence_threshold * 0.8)
        )[0]
        if idx.size < min_frames:
            idx = np.where((seg_times >= start_sec) & (seg_times <= end_sec) & np.isfinite(seg_midi))[0]
        if idx.size:
            center = float(np.nanmedian(seg_midi[idx]))
            midi_raw = int(np.round(center))
        else:
            center = float(n)
            midi_raw = int(n)
        midi_note = _quantize_midi(
            midi_raw,
            center,
            allowed_midi_notes,
            prev_note,
            quantize_strength,
            snap_window_cents,
        )
        prev_note = int(midi_note)
        notes.append(
            {
                "startSec": float(start_sec),
                "endSec": float(end_sec),
                "note": int(midi_note),
                "midiRaw": int(midi_raw),
                "velocity": 90,
                "channel": 0,
            }
        )
    return notes


def _suppress_short_runs(
    note_seq: np.ndarray,
    min_frames: int = 3,
) -> np.ndarray:
    if note_seq.size == 0 or min_frames <= 1:
        return note_seq
    out = note_seq.copy()
    i = 0
    n_total = out.size
    while i < n_total:
        n = out[i]
        j = i + 1
        while j < n_total and out[j] == n:
            j += 1
        run_len = j - i
        if run_len < min_frames:
            left = out[i - 1] if i > 0 else None
            right = out[j] if j < n_total else None
            repl = None
            if left is not None and right is not None and left == right:
                repl = left
            elif left is not None and left != -1 and right is not None and right == -1:
                repl = left
            elif right is not None and right != -1 and left is not None and left == -1:
                repl = right
            elif right is not None:
                repl = right
            elif left is not None:
                repl = left
            if repl is not None:
                out[i:j] = repl
        i = j
    return out


def _relabel_notes_by_median_pitch(
    notes: List[dict],
    times: np.ndarray,
    midi_float: np.ndarray,
    conf: np.ndarray,
    voiced: np.ndarray,
    *,
    ignore_first_sec: float,
    min_frames: int,
    confidence_threshold: float,
    allowed_midi_notes: Optional[set],
    quantize_strength: float,
    snap_window_cents: float,
) -> List[dict]:
    if not notes or times.size == 0:
        return notes
    ordered = sorted(notes, key=lambda n: (n["startSec"], n["endSec"]))
    prev_note = None
    for note in ordered:
        start = float(note["startSec"]) + float(ignore_first_sec)
        end = float(note["endSec"])
        if start >= end:
            prev_note = note.get("note")
            continue
        idx = np.where(
            (times >= start)
            & (times <= end)
            & voiced.astype(bool)
            & np.isfinite(midi_float)
            & (conf >= confidence_threshold * 0.8)
        )[0]
        if idx.size >= min_frames:
            center = float(np.nanmedian(midi_float[idx]))
            midi_raw = int(np.round(center))
            midi_note = _quantize_midi(
                midi_raw,
                center,
                allowed_midi_notes,
                prev_note,
                quantize_strength,
                snap_window_cents,
            )
            note["note"] = int(midi_note)
            note["midiRaw"] = int(midi_raw)
        prev_note = note.get("note")
    return ordered


def _detect_vibrato(
    times: np.ndarray,
    cents: np.ndarray,
    conf: np.ndarray,
    voiced: np.ndarray,
    conf_thr: float,
    band_cents: float,
    min_rate_hz: float,
    max_rate_hz: float,
    window_sec: float = 0.6,
) -> np.ndarray:
    mask = np.zeros_like(voiced, dtype=bool)
    if times.size < 4:
        return mask
    for i in range(times.size):
        if not voiced[i] or conf[i] < conf_thr or np.isnan(cents[i]):
            continue
        start_time = times[i] - window_sec
        start_idx = np.searchsorted(times, start_time)
        segment = cents[start_idx : i + 1]
        if segment.size < 6:
            continue
        center = np.nanmedian(segment)
        dev = segment - center
        if np.nanmax(np.abs(dev)) > band_cents:
            continue
        signs = np.sign(dev)
        if np.all(signs == 0):
            continue
        for j in range(1, signs.size):
            if signs[j] == 0:
                signs[j] = signs[j - 1]
        if signs[0] == 0:
            for j in range(1, signs.size):
                if signs[j] != 0:
                    signs[0] = signs[j]
                    break
        zc = np.sum(signs[:-1] * signs[1:] < 0)
        duration = times[i] - times[start_idx] if i > start_idx else 0.0
        if duration <= 0:
            continue
        rate = (zc / 2.0) / duration
        if min_rate_hz <= rate <= max_rate_hz:
            mask[start_idx : i + 1] = True
    return mask


def _estimate_detune_offset_cents(
    midi_float: np.ndarray,
    conf: np.ndarray,
    voiced: np.ndarray,
    vibrato_mask: np.ndarray,
    conf_thr: float,
    times: Optional[np.ndarray] = None,
    max_slope_semitones_per_sec: Optional[float] = None,
) -> float:
    if midi_float.size == 0:
        return 0.0
    mask = (
        voiced.astype(bool)
        & np.isfinite(midi_float)
        & (conf >= conf_thr)
        & (~vibrato_mask.astype(bool))
    )
    if (
        max_slope_semitones_per_sec is not None
        and times is not None
        and times.size == midi_float.size
        and midi_float.size > 2
    ):
        slope = np.abs(np.gradient(midi_float, times))
        slope[~np.isfinite(slope)] = np.inf
        mask = mask & (slope <= max_slope_semitones_per_sec)
    if not np.any(mask):
        return 0.0
    residual = (midi_float[mask] - np.round(midi_float[mask])) * 100.0
    offset = float(np.nanmedian(residual))
    if not np.isfinite(offset):
        return 0.0
    return float(np.clip(offset, -50.0, 50.0))


def transcribe_dubler_melody_v2(
    audio_path: str,
    *,
    sample_rate: int,
    onset_sensitivity: float = 0.25,
    fmin: float = 50.0,
    fmax: float = 1200.0,
    confidence_threshold: float = 0.3,
    stable_frames_required: int = 3,
    hangover_frames: int = 3,
    min_note_duration: float = 0.07,
    gate_ratio: float = 2.5,
    voiced_on_frames: int = 2,
    voiced_off_frames: int = 4,
    flatness_threshold: Optional[float] = 0.25,
    switch_cents: float = 45.0,
    return_cents: float = 25.0,
    candidate_lock_cents: float = 55.0,
    candidate_min_conf: Optional[float] = None,
    closest_margin_cents: float = 5.0,
    f0_median_win: int = 5,
    octave_jump_cents: float = 1000.0,
    octave_jump_max_frames: int = 3,
    onset_snap_max: float = 0.12,
    end_tighten: bool = True,
    key_restrict: bool = False,
    allowed_midi_notes: Optional[set] = None,
    root: Optional[object] = None,
    scale: Optional[str] = None,
    quantize_strength: float = 1.0,
    snap_window_cents: float = 60.0,
    auto_detune: bool = True,
    detune_max_slope_semitones_per_sec: float = 3.0,
    decode_mode: Literal["rules", "viterbi"] = "rules",
    viterbi_radius_semitones: float = 3.0,
    viterbi_max_candidates: int = 9,
    viterbi_base_sigma_cents: float = 35.0,
    viterbi_change_cost: float = 1.2,
    viterbi_jump_cost_per_semitone: float = 0.35,
    viterbi_off_onset_penalty: float = 1.4,
    viterbi_onset_change_reward: float = -0.3,
    viterbi_rest_toggle_penalty: float = 0.6,
    viterbi_rest_cost_unvoiced: float = 0.05,
    viterbi_rest_cost_lowconf: float = 0.6,
    viterbi_rest_cost_voiced: float = 2.0,
    viterbi_pitch_unvoiced_cost: float = 9.0,
    viterbi_stay_reward: float = -0.05,
    viterbi_slide_rate_threshold: float = 6.0,
    viterbi_slide_penalty: float = 0.8,
    viterbi_vibrato_boost: float = 1.2,
    viterbi_min_run_frames: int = 3,
    scale_prior_penalty_cents: float = 35.0,
    scale_prior_strength: float = 0.35,
    auto_key_prior: bool = False,
    auto_key_strength: float = 0.3,
    emit_pitchbend: bool = False,
    pitchbend_range_semitones: float = 2.0,
    pitchbend_smooth_win: int = 3,
    pitchbend_ema_alpha: float = 0.25,
    attack_window: float = 0.06,
    velocity_min: int = 15,
    velocity_curve: float = 0.6,
    articulation_mode: Literal["legato", "staccato"] = "legato",
    retrigger_cents: float = 80.0,
    vibrato_band_cents: float = 60.0,
    vibrato_min_rate_hz: float = 4.0,
    vibrato_max_rate_hz: float = 9.0,
    settle_window_sec: float = 0.09,
    settle_ignore_first_sec: float = 0.02,
    settle_min_frames: int = 4,
    settle_conf_factor: float = 0.8,
    posthoc_relabel: bool = True,
    viterbi_posthoc_relabel: Optional[bool] = None,
    relabel_ignore_first_sec: float = 0.06,
    relabel_min_frames: int = 5,
    release_padding_sec: float = 0.015,
    merge_gap_sec: float = 0.02,
    profile: Optional[Dict] = None,
    return_debug: bool = False,
) -> Tuple[List[dict], List[dict], List[dict], dict]:
    """
    Advanced Dubler-style voice-to-MIDI transcription.
    Returns notes, cc events, pitch-bend events, and optional debug dict.
    decode_mode="rules" preserves the original heuristic note switching.
    decode_mode="viterbi" uses a global decoder over the pitch track.
    auto_detune compensates consistent sharp/flat singing before decoding.
    """
    audio, sr = librosa.load(audio_path, sr=sample_rate, mono=True)
    if audio.size == 0:
        return [], [], [], {}

    if profile:
        confidence_threshold = float(profile.get("confidence_threshold", confidence_threshold))
        fmin = float(profile.get("fmin", fmin))
        fmax = float(profile.get("fmax", fmax))
        gate_ratio = float(profile.get("gate_ratio", gate_ratio))
        onset_sensitivity = float(profile.get("onset_sensitivity", onset_sensitivity))
        if profile.get("flatness_threshold") is not None:
            flatness_threshold = float(profile.get("flatness_threshold"))
    if candidate_min_conf is None:
        candidate_min_conf = confidence_threshold
    if profile and profile.get("candidate_min_conf") is not None:
        candidate_min_conf = float(profile.get("candidate_min_conf"))

    confidence_threshold = float(np.clip(confidence_threshold, 0.0, 1.0))
    candidate_min_conf = float(np.clip(candidate_min_conf, 0.0, 1.0))
    gate_ratio = float(max(0.1, gate_ratio))
    quantize_strength = float(max(0.0, quantize_strength))
    snap_window_cents = float(max(0.0, snap_window_cents))
    detune_max_slope_semitones_per_sec = float(max(0.0, detune_max_slope_semitones_per_sec))
    viterbi_radius_semitones = float(max(0.5, viterbi_radius_semitones))
    viterbi_max_candidates = int(max(3, viterbi_max_candidates))
    viterbi_base_sigma_cents = float(max(5.0, viterbi_base_sigma_cents))
    viterbi_min_run_frames = int(max(1, viterbi_min_run_frames))
    viterbi_rest_toggle_penalty = float(max(0.0, viterbi_rest_toggle_penalty))
    scale_prior_penalty_cents = float(max(0.0, scale_prior_penalty_cents))
    scale_prior_strength = float(max(0.0, scale_prior_strength))
    auto_key_strength = float(max(0.0, auto_key_strength))
    pitchbend_range_semitones = float(max(0.1, pitchbend_range_semitones))
    velocity_min = int(np.clip(velocity_min, 1, 127))

    if hangover_frames > voiced_off_frames:
        voiced_off_frames = int(hangover_frames)

    frame_data = transcribe_crepe_frames(
        audio_path, sample_rate=sr, step_size_ms=10, fmin=fmin, fmax=fmax
    )
    times = frame_data["times"]
    f0_hz = frame_data["f0_hz"]
    conf = frame_data["confidence"]
    times = np.asarray(times, dtype=float)
    f0_hz = np.asarray(f0_hz, dtype=float)
    conf = np.asarray(conf, dtype=float)
    if times.size == 0:
        return [], [], [], {}

    hop_length = max(1, int(round(sr * (times[1] - times[0])))) if times.size > 1 else 512
    rms_series, rms_times = _compute_rms_series(audio, sr, hop_length)
    rms = _align_series(rms_series, rms_times, times)
    attack_times = _detect_attack_times_from_rms(
        times, rms, min_interval_sec=0.05, rise_threshold=0.08
    )
    if attack_times.size:
        rnorm = rms / (np.max(rms) + 1e-9)
        atk_idx = np.searchsorted(times, attack_times)
        atk_idx = np.clip(atk_idx, 0, len(times) - 1)
        keep = rnorm[atk_idx] >= 0.10
        attack_times = attack_times[keep]
    flatness = None
    if flatness_threshold is not None:
        flat = librosa.feature.spectral_flatness(y=audio, hop_length=hop_length)[0]
        flat_times = librosa.frames_to_time(np.arange(flat.size), sr=sr, hop_length=hop_length)
        flatness = _align_series(flat, flat_times, times)

    noise_floor = float(profile.get("noise_floor_rms")) if profile and profile.get("noise_floor_rms") else None
    if noise_floor is None:
        noise_floor = _estimate_noise_floor(rms, conf, confidence_threshold)
    gate = (conf >= confidence_threshold) & (rms >= noise_floor * gate_ratio)
    if flatness is not None:
        gate = gate & (flatness <= flatness_threshold)
    voiced = _apply_voicing_hysteresis(gate, voiced_on_frames, voiced_off_frames)

    midi_float = np.array([_hz_to_midi_float(f) for f in f0_hz])
    cents = midi_float * 100.0
    cents = _median_filter_nan(cents, win=max(1, f0_median_win))
    cents = _apply_octave_guard(cents, conf, confidence_threshold, octave_jump_cents, octave_jump_max_frames)
    midi_float = cents / 100.0

    vibrato_mask = _detect_vibrato(
        times,
        cents,
        conf,
        voiced,
        confidence_threshold,
        vibrato_band_cents,
        vibrato_min_rate_hz,
        vibrato_max_rate_hz,
    )

    detune_offset_cents = 0.0
    if auto_detune:
        detune_offset_cents = _estimate_detune_offset_cents(
            midi_float,
            conf,
            voiced,
            vibrato_mask,
            confidence_threshold,
            times=times,
            max_slope_semitones_per_sec=detune_max_slope_semitones_per_sec,
        )
        if abs(detune_offset_cents) > 1e-6:
            cents = cents - float(detune_offset_cents)
            midi_float = cents / 100.0

    onset_frames = librosa.onset.onset_detect(
        y=audio,
        sr=sr,
        hop_length=hop_length,
        backtrack=True,
        units="frames",
        delta=onset_sensitivity,
    )
    onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=hop_length)
    snap_times = onset_times
    if attack_times.size:
        snap_times = np.unique(np.concatenate([onset_times, attack_times]))
    logger.info("Dubler Melody v2: onsets=%d voiced_frames=%d", len(onset_times), int(np.sum(voiced)))

    if key_restrict and allowed_midi_notes is None:
        allowed_midi_notes = _build_allowed_notes(root, scale)

    auto_key_info = None
    scale_prior_notes = allowed_midi_notes
    scale_prior_strength_effective = 0.0
    if allowed_midi_notes is not None and not key_restrict:
        scale_prior_strength_effective = float(max(0.0, scale_prior_strength))
    if auto_key_prior and not key_restrict and allowed_midi_notes is None:
        est = _estimate_key_from_pitch_classes(midi_float, conf, voiced, confidence_threshold * 0.85)
        if est:
            root_est, scale_est, score = est
            scale_prior_notes = _build_allowed_notes(root_est, scale_est)
            if scale_prior_notes:
                scale_prior_strength_effective = float(max(0.0, auto_key_strength))
                auto_key_info = {"root": int(root_est), "scale": str(scale_est), "score": float(score)}

    notes: List[dict] = []
    pb_times: List[float] = []
    pb_values: List[int] = []
    note_committed_count = 0
    rms_peak = float(np.max(rms)) if rms.size else 1.0

    if decode_mode == "viterbi":
        near_onset = np.zeros_like(times, dtype=bool)
        if snap_times.size:
            idx = np.searchsorted(snap_times, times)
            prev_idx = np.clip(idx - 1, 0, snap_times.size - 1)
            next_idx = np.clip(idx, 0, snap_times.size - 1)
            prev_on = snap_times[prev_idx]
            next_on = snap_times[next_idx]
            dist_prev = np.abs(times - prev_on)
            dist_next = np.abs(times - next_on)
            dist = np.minimum(dist_prev, dist_next)
            near_onset = dist <= onset_snap_max
        scale_prior_notes_use = scale_prior_notes if scale_prior_strength_effective > 0 else None
        candidate_allowed_notes = allowed_midi_notes if key_restrict else None
        note_seq = _viterbi_decode_notes(
            times,
            midi_float,
            conf,
            voiced,
            near_onset,
            vibrato_mask,
            candidate_allowed_notes=candidate_allowed_notes,
            scale_prior_notes=scale_prior_notes_use,
            key_restrict=key_restrict,
            confidence_threshold=confidence_threshold,
            radius_semitones=viterbi_radius_semitones,
            max_candidates=viterbi_max_candidates,
            base_sigma_cents=viterbi_base_sigma_cents,
            scale_prior_penalty_cents=scale_prior_penalty_cents,
            scale_prior_strength=scale_prior_strength_effective,
            change_cost=viterbi_change_cost,
            jump_cost_per_semitone=viterbi_jump_cost_per_semitone,
            off_onset_penalty=viterbi_off_onset_penalty,
            onset_change_reward=viterbi_onset_change_reward,
            rest_toggle_penalty=viterbi_rest_toggle_penalty,
            rest_cost_unvoiced=viterbi_rest_cost_unvoiced,
            rest_cost_lowconf=viterbi_rest_cost_lowconf,
            rest_cost_voiced=viterbi_rest_cost_voiced,
            pitch_unvoiced_cost=viterbi_pitch_unvoiced_cost,
            stay_reward=viterbi_stay_reward,
            slide_rate_threshold=viterbi_slide_rate_threshold,
            slide_penalty=viterbi_slide_penalty,
            vibrato_transition_boost=viterbi_vibrato_boost,
        )
        if viterbi_min_run_frames and viterbi_min_run_frames > 1:
            note_seq = _suppress_short_runs(note_seq, min_frames=int(viterbi_min_run_frames))
        notes = _segments_from_decoded_sequence(
            note_seq,
            times,
            midi_float,
            conf,
            onset_times=snap_times,
            onset_snap_max=onset_snap_max,
            settle_ignore_first_sec=settle_ignore_first_sec,
            min_frames=relabel_min_frames,
            confidence_threshold=confidence_threshold,
            allowed_midi_notes=allowed_midi_notes,
            quantize_strength=quantize_strength,
            snap_window_cents=snap_window_cents,
        )
        note_committed_count = int(len(notes))
        if emit_pitchbend:
            for i, t in enumerate(times):
                n = int(note_seq[i]) if i < note_seq.size else -1
                if n < 0 or not np.isfinite(midi_float[i]):
                    continue
                deviation = midi_float[i] - float(n)
                pb = int(8192 + deviation * (8192.0 / max(0.1, pitchbend_range_semitones)))
                pb = int(np.clip(pb, 0, 16383))
                pb_times.append(float(t))
                pb_values.append(pb)
    else:
        current = None
        current_center = None
        candidate_note = None
        candidate_count = 0
        candidate_start_time: Optional[float] = None
        prev_voiced = False
        return_count = 0
        pending_release_end: Optional[float] = None
        last_note_idx: Optional[int] = None
        frame_dt = float(np.median(np.diff(times))) if times.size > 1 else 0.0

        last_committed_note: Optional[int] = None
        current_committed = False
        settle_buf: List[float] = []
        last_midi_raw_float: Optional[float] = None

        def _init_current(
            start_time: float, end_time: float, midi_note_val: int, midi_raw_val: int, raw_float: float
        ):
            nonlocal current, current_center, candidate_note, candidate_count, candidate_start_time, return_count
            nonlocal current_committed, settle_buf
            current = {
                "startSec": float(start_time),
                "endSec": float(end_time),
                "note": int(midi_note_val),
                "midiRaw": int(midi_raw_val),
                "velocity": 90,
                "channel": 0,
            }
            current_center = float(raw_float)
            candidate_note = None
            candidate_count = 0
            candidate_start_time = None
            return_count = 0
            current_committed = False
            settle_buf = []

        def _commit_current(center_value: Optional[float]):
            nonlocal current, current_committed, last_committed_note, note_committed_count
            if current is None or current_committed:
                return
            if center_value is None or np.isnan(center_value):
                center_value = float(current.get("midiRaw", current.get("note", 0)))
            midi_raw_commit = int(np.round(center_value))
            midi_note_commit = _quantize_midi(
                midi_raw_commit,
                float(center_value),
                allowed_midi_notes,
                last_committed_note,
                quantize_strength,
                snap_window_cents,
            )
            current["note"] = int(midi_note_commit)
            current["midiRaw"] = int(midi_raw_commit)
            current_committed = True
            last_committed_note = int(midi_note_commit)
            note_committed_count += 1

        for i, t in enumerate(times):
            voiced_now = bool(voiced[i]) and not np.isnan(midi_float[i])
            attack = voiced_now and not prev_voiced
            attack_start = max(0.0, t - max(0, voiced_on_frames - 1) * frame_dt) if attack else t
            note_retriggered = False

            if not voiced_now:
                if current:
                    if not current_committed:
                        center = None
                        if settle_buf:
                            center = float(np.nanmedian(np.array(settle_buf, dtype=float)))
                        elif last_midi_raw_float is not None:
                            center = float(last_midi_raw_float)
                        _commit_current(center)
                    current["endSec"] = float(t)
                    notes.append(current)
                    last_note_idx = len(notes) - 1
                    pending_release_end = float(min(times[-1], t + release_padding_sec))
                    current = None
                    current_center = None
                    current_committed = False
                    settle_buf = []
                candidate_note = None
                candidate_count = 0
                return_count = 0
                prev_voiced = voiced_now
                continue

            if pending_release_end is not None and last_note_idx is not None:
                prev_note = notes[last_note_idx]
                desired_end = pending_release_end
                clamp_end = attack_start - 0.002
                end_sec = max(prev_note["endSec"], min(desired_end, clamp_end))
                if end_sec < prev_note["startSec"] + 0.001:
                    end_sec = prev_note["startSec"] + 0.001
                prev_note["endSec"] = end_sec
                pending_release_end = None

            midi_raw_float = midi_float[i]
            midi_raw = int(np.round(midi_raw_float))
            last_midi_raw_float = float(midi_raw_float)
            midi_note = _quantize_midi(
                midi_raw,
                midi_raw_float,
                allowed_midi_notes,
                current["note"] if current else None,
                quantize_strength,
                snap_window_cents,
            )

            start_ref = attack_start
            onset_snap = _nearest_onset(start_ref, snap_times, onset_snap_max)
            snapped = _time_in_sorted(snap_times, onset_snap, atol=1e-6)
            onset_near = snapped and (abs(start_ref - onset_snap) <= onset_snap_max)

            if current is None:
                start_time = onset_snap if onset_near else start_ref
                _init_current(start_time, t, midi_note, midi_raw, midi_raw_float)
                prev_voiced = voiced_now
                continue

            in_vibrato = bool(vibrato_mask[i]) and articulation_mode == "legato"
            if current_center is None:
                current_center = float(midi_raw_float)
            elif not in_vibrato:
                current_center = 0.9 * current_center + 0.1 * float(midi_raw_float)

            diff_to_current_cents = abs((midi_raw_float - current["note"]) * 100.0)
            diff_to_candidate_cents = abs((midi_raw_float - midi_note) * 100.0)

            if in_vibrato:
                midi_note = current["note"]
                diff_to_candidate_cents = diff_to_current_cents
                candidate_note = None
                candidate_count = 0
                candidate_start_time = None
                return_count = 0
            else:
                if conf[i] < confidence_threshold * 0.7:
                    return_count = 0
                elif diff_to_current_cents <= return_cents:
                    return_count += 1
                else:
                    return_count = 0

            if not current_committed:
                elapsed = float(t - current["startSec"])
                if settle_ignore_first_sec <= elapsed <= settle_window_sec:
                    if conf[i] >= confidence_threshold * settle_conf_factor and np.isfinite(midi_raw_float):
                        settle_buf.append(float(midi_raw_float))
                if elapsed >= settle_window_sec:
                    if len(settle_buf) >= settle_min_frames:
                        center = float(np.nanmedian(np.array(settle_buf, dtype=float)))
                    else:
                        center = float(midi_raw_float)
                    _commit_current(center)

            # Dubler-style: allow retrigger on attack/onset even if pitch is same
            if onset_near and (t - current["startSec"]) > min_note_duration and midi_note == current["note"]:
                if onset_snap > current["startSec"] + 0.010:
                    if not current_committed:
                        center = float(np.nanmedian(np.array(settle_buf, dtype=float))) if settle_buf else None
                        _commit_current(center)
                    current["endSec"] = float(max(current["startSec"] + 0.001, onset_snap))
                    notes.append(current)
                    last_note_idx = len(notes) - 1
                    _init_current(onset_snap, t, midi_note, midi_raw, midi_raw_float)
                    prev_voiced = voiced_now
                    note_retriggered = True
                    # Skip switch logic; allow PB emission once at loop end with new current.
                    # (Do not continue here to keep PB emission centralized.)

            # Dubler-like switching rules:
            # - switch only when pitch is far enough from current note (switch_cents)
            # - confirm candidate only if it is close to candidate center (candidate_lock_cents)
            # - allow return to current only after return_cents is satisfied for N frames
            # - in legato, suppress switches unless there is an attack or strong candidate centering
            if not note_retriggered and midi_note != current["note"]:
                if not current_committed and not onset_near:
                    candidate_note = None
                    candidate_count = 0
                    candidate_start_time = None
                elif return_count >= stable_frames_required:
                    candidate_note = None
                    candidate_count = 0
                    candidate_start_time = None
                elif diff_to_current_cents < switch_cents:
                    candidate_note = None
                    candidate_count = 0
                    candidate_start_time = None
                else:
                    candidate_valid = (
                        diff_to_candidate_cents <= candidate_lock_cents
                        or (midi_raw == midi_note and diff_to_candidate_cents <= candidate_lock_cents * 1.1)
                    )
                    candidate_valid = (
                        candidate_valid
                        and conf[i] >= candidate_min_conf
                        and diff_to_candidate_cents <= diff_to_current_cents + closest_margin_cents
                    )
                    allow_switch = True
                    if articulation_mode == "legato" and not onset_near:
                        allow_switch = (
                            diff_to_candidate_cents <= candidate_lock_cents
                            and diff_to_current_cents >= retrigger_cents
                        )
                    if not candidate_valid:
                        candidate_note = None
                        candidate_count = 0
                        candidate_start_time = None
                    elif allow_switch:
                        if candidate_note == midi_note:
                            candidate_count += 1
                        else:
                            candidate_note = midi_note
                            candidate_count = 1
                            candidate_start_time = float(t)
                        effective_stable = stable_frames_required
                        if onset_near:
                            effective_stable = max(1, stable_frames_required - 1)
                        if (
                            candidate_count >= max(1, effective_stable)
                            and diff_to_candidate_cents <= candidate_lock_cents
                        ):
                            if not onset_near and articulation_mode == "legato" and candidate_start_time is not None:
                                new_start = float(min(t, max(candidate_start_time, current["startSec"] + 0.001)))
                                old_end = max(current["startSec"] + 0.001, new_start - 0.001)
                                if not current_committed:
                                    center = float(np.nanmedian(np.array(settle_buf, dtype=float))) if settle_buf else None
                                    _commit_current(center)
                                current["endSec"] = old_end
                                notes.append(current)
                                last_note_idx = len(notes) - 1
                                start_time = new_start
                            else:
                                if not current_committed:
                                    center = float(np.nanmedian(np.array(settle_buf, dtype=float))) if settle_buf else None
                                    _commit_current(center)
                                current["endSec"] = float(t)
                                notes.append(current)
                                last_note_idx = len(notes) - 1
                                start_time = onset_snap if onset_near else t
                            _init_current(start_time, t, midi_note, midi_raw, midi_raw_float)
            elif not note_retriggered:
                candidate_note = None
                candidate_count = 0
                candidate_start_time = None
                if onset_near and (t - current["startSec"]) > min_note_duration:
                    if articulation_mode == "staccato":
                        if not current_committed:
                            center = float(np.nanmedian(np.array(settle_buf, dtype=float))) if settle_buf else None
                            _commit_current(center)
                        current["endSec"] = float(onset_snap)
                        notes.append(current)
                        _init_current(onset_snap, t, midi_note, midi_raw, midi_raw_float)

            current["endSec"] = float(t)
            prev_voiced = voiced_now

            if emit_pitchbend and current:
                deviation = midi_raw_float - current["note"]
                # +/- pitchbend_range_semitones maps to +/-8192 (center=8192).
                pb = int(8192 + deviation * (8192.0 / max(0.1, pitchbend_range_semitones)))
                pb = int(np.clip(pb, 0, 16383))
                pb_times.append(float(t))
                pb_values.append(pb)

        if current:
            if not current_committed:
                center = float(np.nanmedian(np.array(settle_buf, dtype=float))) if settle_buf else None
                _commit_current(center)
            current["endSec"] = float(times[-1])
            notes.append(current)
            last_note_idx = len(notes) - 1

        if pending_release_end is not None and last_note_idx is not None:
            if last_note_idx == len(notes) - 1 and pending_release_end > notes[last_note_idx]["endSec"]:
                notes[last_note_idx]["endSec"] = pending_release_end
            elif last_note_idx < len(notes) - 1:
                next_start = notes[last_note_idx + 1]["startSec"]
                notes[last_note_idx]["endSec"] = min(notes[last_note_idx]["endSec"], next_start - 0.001)

    if min_note_duration > 0:
        notes = [n for n in notes if (n["endSec"] - n["startSec"]) >= min_note_duration]

    if end_tighten and snap_times.size:
        for note in notes:
            next_onset = _find_next_onset(note["endSec"], snap_times)
            if next_onset and 0 <= next_onset - note["endSec"] <= onset_snap_max:
                note["endSec"] = float(max(note["startSec"], next_onset - 0.005))

    if merge_gap_sec > 0:
        notes = _merge_same_pitch_notes(notes, merge_gap_sec)
    notes = [n for n in notes if n["endSec"] > n["startSec"]]
    if notes:
        notes = sorted(notes, key=lambda n: (n["startSec"], n["endSec"]))
        cleaned: List[dict] = []
        for note in notes:
            if cleaned:
                prev = cleaned[-1]
                if note["startSec"] < prev["endSec"]:
                    note["startSec"] = prev["endSec"]
            if note["endSec"] > note["startSec"] + 0.001:
                cleaned.append(note)
        notes = cleaned

    for note in notes:
        note["velocity"] = _velocity_from_window(
            rms,
            times,
            note["startSec"],
            attack_window,
            velocity_min,
            velocity_curve,
            rms_peak,
        )

    # FINAL strict non-overlap and validity pass (Dubler-like hygiene)
    if notes:
        notes = sorted(notes, key=lambda n: (n["startSec"], n["endSec"]))
        out = []
        last_end = 0.0
        for n in notes:
            n = n.copy()
            if n["startSec"] < last_end:
                n["startSec"] = last_end
            if n["endSec"] <= n["startSec"] + 0.001:
                continue
            out.append(n)
            last_end = n["endSec"]
        notes = out

    posthoc_relabel_effective = posthoc_relabel
    if decode_mode == "viterbi":
        posthoc_relabel_effective = (
            bool(viterbi_posthoc_relabel) if viterbi_posthoc_relabel is not None else False
        )

    if posthoc_relabel_effective and notes:
        notes = _relabel_notes_by_median_pitch(
            notes,
            times,
            midi_float,
            conf,
            voiced,
            ignore_first_sec=relabel_ignore_first_sec,
            min_frames=relabel_min_frames,
            confidence_threshold=confidence_threshold,
            allowed_midi_notes=allowed_midi_notes,
            quantize_strength=quantize_strength,
            snap_window_cents=snap_window_cents,
        )
        if merge_gap_sec > 0:
            notes = _merge_same_pitch_notes(notes, merge_gap_sec)
        if notes:
            notes = sorted(notes, key=lambda n: (n["startSec"], n["endSec"]))
            out = []
            last_end = 0.0
            for n in notes:
                n = n.copy()
                if n["startSec"] < last_end:
                    n["startSec"] = last_end
                if n["endSec"] <= n["startSec"] + 0.001:
                    continue
                out.append(n)
                last_end = n["endSec"]
            notes = out

    pb_events = []
    if emit_pitchbend and pb_times:
        pb_arr = np.array(pb_values, dtype=float)
        if pitchbend_smooth_win > 1:
            pb_arr = _median_filter_nan(pb_arr, win=pitchbend_smooth_win)
        if pitchbend_ema_alpha and 0 < pitchbend_ema_alpha < 1:
            ema = pb_arr[0]
            for i in range(pb_arr.size):
                ema = pitchbend_ema_alpha * pb_arr[i] + (1 - pitchbend_ema_alpha) * ema
                pb_arr[i] = ema
        for t, val in zip(pb_times, pb_arr):
            if np.isnan(val):
                continue
            pb_events.append({"timeSec": float(t), "value": int(val), "channel": 0})

    note_times = [n["startSec"] for n in notes]
    cc_events = _compute_formants(audio, sr, note_times)

    debug = {}
    if return_debug:
        debug = {
            "times": times.tolist(),
            "f0_hz": f0_hz.tolist(),
            "midi_float": midi_float.tolist(),
            "confidence": conf.tolist(),
            "rms": rms.tolist(),
            "flatness": flatness.tolist() if flatness is not None else None,
            "voiced": voiced.astype(int).tolist(),
            "onsets": onset_times.tolist(),
            "vibrato": vibrato_mask.astype(int).tolist(),
            "detuneOffsetCents": float(detune_offset_cents),
            "decode_mode": str(decode_mode),
            "autoKeyEstimate": auto_key_info,
            "settle_window_sec": float(settle_window_sec),
            "posthoc_relabel": bool(posthoc_relabel_effective),
            "noteCommittedCount": int(note_committed_count),
        }

    return notes, cc_events, pb_events, debug


def _normalize_scale_name(scale: Optional[str]) -> Optional[str]:
    if not scale:
        return None
    name = str(scale).strip().lower()
    if name in {"maj", "major"}:
        return "major"
    if name in {"min", "minor"}:
        return "minor"
    if name in _SCALE_INTERVALS:
        return name
    return None


def _parse_key_scale(key: Optional[str], scale: Optional[str]) -> Tuple[Optional[int], Optional[str]]:
    if not key and not scale:
        return None, None
    root = _parse_root(key) if key is not None else None
    scale_name = _normalize_scale_name(scale)
    if scale_name is None and key:
        parts = str(key).strip().lower().split()
        if len(parts) > 1:
            root = _parse_root(parts[0])
            scale_name = _normalize_scale_name(parts[1])
    return root, scale_name


def transcribe_magic_wand(
    audio_path: str,
    *,
    sample_rate: int,
    preset: str = "wand_sing",
    key: Optional[str] = None,
    scale: Optional[str] = None,
    strict_key: bool = False,
    emit_pitchbend: bool = False,
    return_debug: bool = False,
) -> Tuple[List[dict], List[dict], List[dict], dict]:
    """
    Convenience wrapper with "magic wand" defaults for intention-first melody extraction.
    """
    if preset not in MAGIC_WAND_PRESETS:
        raise ValueError(f"Unknown preset '{preset}'. Available: {', '.join(MAGIC_WAND_PRESETS)}")
    preset_cfg = MAGIC_WAND_PRESETS[preset]
    params: Dict[str, object] = dict(preset_cfg.params)
    params.update(
        {
            "decode_mode": "viterbi",
            "auto_detune": True,
            "emit_pitchbend": bool(emit_pitchbend),
            "return_debug": bool(return_debug),
        }
    )

    root_pc, scale_name = _parse_key_scale(key, scale)
    if root_pc is not None and scale_name is not None:
        if strict_key:
            params.update({"key_restrict": True, "root": root_pc, "scale": scale_name})
        else:
            allowed = _build_allowed_notes(root_pc, scale_name)
            if allowed:
                params.update(
                    {
                        "key_restrict": False,
                        "allowed_midi_notes": allowed,
                        "quantize_strength": 0.0,
                        "scale_prior_strength": 0.3,
                    }
                )
    elif key or scale:
        logger.warning("Magic wand: invalid key/scale (%s, %s); ignoring.", key, scale)

    return transcribe_dubler_melody_v2(audio_path, sample_rate=sample_rate, **params)


def events_to_midi_file(
    notes: List[dict],
    cc_events: List[dict],
    pb_events: List[dict],
    out_path: str,
    *,
    tempo_bpm: float = 120.0,
    ticks_per_beat: int = 480,
    program: int = 0,
    channel: int = 0,
    pitchbend_range_semitones: float = 2.0,
) -> str:
    """
    Write notes/CC/pitch-bend events to a MIDI file.
    Requires `mido` (pip install mido).
    """
    try:
        import mido
    except Exception as exc:  # pragma: no cover
        raise ImportError("events_to_midi_file requires `mido`. Install with `pip install mido`.") from exc

    tempo_bpm = float(max(1.0, tempo_bpm))
    ticks_per_beat = int(max(1, ticks_per_beat))
    program = int(np.clip(program, 0, 127))
    channel = int(np.clip(channel, 0, 15))
    _ = float(max(0.1, pitchbend_range_semitones))

    def sec_to_ticks(sec: float) -> int:
        return int(round(float(sec) * ticks_per_beat * tempo_bpm / 60.0))

    events = []
    for note in notes or []:
        start = float(note.get("startSec", 0.0))
        end = float(note.get("endSec", start))
        if end < start:
            end = start
        start_tick = sec_to_ticks(start)
        end_tick = sec_to_ticks(end)
        pitch = int(np.clip(int(note.get("note", 0)), 0, 127))
        velocity = int(np.clip(int(note.get("velocity", 90)), 1, 127))
        events.append((start_tick, 1, mido.Message("note_on", note=pitch, velocity=velocity, channel=channel)))
        events.append((end_tick, 0, mido.Message("note_off", note=pitch, velocity=0, channel=channel)))

    for cc in cc_events or []:
        tick = sec_to_ticks(float(cc.get("timeSec", 0.0)))
        cc_num = int(np.clip(int(cc.get("cc", 0)), 0, 127))
        value = int(np.clip(int(cc.get("value", 0)), 0, 127))
        events.append((tick, 2, mido.Message("control_change", control=cc_num, value=value, channel=channel)))

    for pb in pb_events or []:
        tick = sec_to_ticks(float(pb.get("timeSec", 0.0)))
        value = int(np.clip(int(pb.get("value", 8192)), 0, 16383))
        wheel = int(np.clip(value - 8192, -8192, 8191))
        events.append((tick, 3, mido.Message("pitchwheel", pitch=wheel, channel=channel)))

    events.sort(key=lambda item: (item[0], item[1]))

    mid = mido.MidiFile(ticks_per_beat=ticks_per_beat)
    track = mido.MidiTrack()
    mid.tracks.append(track)
    track.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(tempo_bpm), time=0))
    track.append(mido.Message("program_change", program=program, channel=channel, time=0))

    last_tick = 0
    for tick, _order, msg in events:
        delta = max(0, int(tick) - last_tick)
        msg.time = delta
        track.append(msg)
        last_tick = int(tick)

    mid.save(out_path)
    return out_path


def transcribe_dubler_melody(
    audio_path: str,
    *,
    sample_rate: int,
    onset_sensitivity: float = 0.25,
    fmin: float = 50.0,
    fmax: float = 1200.0,
    confidence_threshold: float = 0.3,
    stable_frames_required: int = 3,
    hangover_frames: int = 3,
    min_note_duration: float = 0.07,
) -> Tuple[List[dict], List[dict]]:
    """
    Backward-compatible wrapper returning (notes, cc_events).
    """
    notes, cc_events, _pb, _debug = transcribe_dubler_melody_v2(
        audio_path,
        sample_rate=sample_rate,
        onset_sensitivity=onset_sensitivity,
        fmin=fmin,
        fmax=fmax,
        confidence_threshold=confidence_threshold,
        stable_frames_required=stable_frames_required,
        hangover_frames=hangover_frames,
        min_note_duration=min_note_duration,
    )
    return notes, cc_events


def calibrate_dubler_profile(
    audio_path: str,
    *,
    sample_rate: int,
    fmin: float = 50.0,
    fmax: float = 1200.0,
    step_size_ms: int = 10,
    base_confidence_threshold: float = 0.30,
) -> Dict:
    """
    One-pass calibration to produce a profile dict usable by transcribe_dubler_melody_v2(profile=...).
    Record ~10–20s: 3s silence, then normal humming/singing, then silence.
    """
    audio, sr = librosa.load(audio_path, sr=sample_rate, mono=True)
    if audio.size == 0:
        return {}

    frame_data = transcribe_crepe_frames(
        audio_path, sample_rate=sr, step_size_ms=step_size_ms, fmin=fmin, fmax=fmax
    )
    times = frame_data["times"]
    f0_hz = frame_data["f0_hz"]
    conf = frame_data["confidence"]
    if times.size < 5:
        return {}

    hop_length = max(1, int(round(sr * (times[1] - times[0]))))
    rms_series, rms_times = _compute_rms_series(audio, sr, hop_length)
    rms = _align_series(rms_series, rms_times, times)

    noise_floor = _estimate_noise_floor(rms, conf, base_confidence_threshold)
    voiced_idx = np.where((conf >= base_confidence_threshold * 0.8) & (rms >= noise_floor * 2.0))[0]
    if voiced_idx.size > 20:
        conf_voiced = conf[voiced_idx]
        conf_thr = float(np.clip(np.percentile(conf_voiced, 25), 0.20, 0.55))
    else:
        conf_thr = float(base_confidence_threshold)

    gate_ratio = float(np.clip(2.2 + (0.35 - conf_thr) * 1.2, 2.0, 3.2))

    hz_voiced = f0_hz[voiced_idx] if voiced_idx.size else f0_hz[conf >= conf_thr]
    hz_voiced = hz_voiced[hz_voiced > 0]
    if hz_voiced.size > 10:
        low = float(np.percentile(hz_voiced, 5))
        high = float(np.percentile(hz_voiced, 95))
        fmin_rec = float(np.clip(low * 0.8, 30.0, 400.0))
        fmax_rec = float(np.clip(high * 1.25, 300.0, 2000.0))
    else:
        fmin_rec, fmax_rec = float(fmin), float(fmax)

    flatness_threshold = None
    try:
        flat = librosa.feature.spectral_flatness(y=audio, hop_length=hop_length)[0]
        flat_times = librosa.frames_to_time(np.arange(flat.size), sr=sr, hop_length=hop_length)
        flatness = _align_series(flat, flat_times, times)
        if voiced_idx.size > 10:
            flat_voiced = flatness[voiced_idx]
            flatness_threshold = float(np.clip(np.percentile(flat_voiced, 90), 0.15, 0.45))
    except Exception:
        flatness_threshold = None

    rms_voiced = rms[voiced_idx] if voiced_idx.size else None
    rms_p50 = float(np.percentile(rms_voiced, 50)) if rms_voiced is not None and rms_voiced.size else None
    rms_p90 = float(np.percentile(rms_voiced, 90)) if rms_voiced is not None and rms_voiced.size else None

    profile = {
        "noise_floor_rms": float(noise_floor),
        "confidence_threshold": float(conf_thr),
        "gate_ratio": float(gate_ratio),
        "fmin": float(fmin_rec),
        "fmax": float(fmax_rec),
        "candidate_min_conf": float(np.clip(conf_thr, 0.25, 0.60)),
    }
    if flatness_threshold is not None:
        profile["flatness_threshold"] = float(flatness_threshold)
    if rms_p50 is not None:
        profile["rms_voiced_p50"] = float(rms_p50)
    if rms_p90 is not None:
        profile["rms_voiced_p90"] = float(rms_p90)
    return profile
