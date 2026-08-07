/**
 * The arithmetic behind studio playback.
 *
 * useStudioPlayback is 1,051 lines, nearly all of it Web Audio wiring that
 * only means anything with a live AudioContext. Threaded through it were a
 * dozen small pure functions — decibels to gain, ticks to seconds, note names
 * to MIDI numbers, and every clamp applied to an effect parameter — defined
 * inside the hook body, so they were rebuilt on every render and reachable
 * from nothing.
 *
 * They are the parts that can be wrong quietly. A gain curve off by a factor
 * of two, a note name parsed an octave out, an effect clamped to the wrong
 * range: none of it throws, it just sounds wrong, and finding out means
 * listening.
 */

/** Decibels as a linear gain multiplier. 0dB is 1, -6dB is about a half. */
export const dbToGain = (value) => Math.pow(10, (value || 0) / 20);

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const ticksToSec = (ticks, bpm, ppq) => {
  const safeBpm = Number(bpm) || 120;
  const safePpq = Number(ppq) || 480;
  return (Number(ticks) || 0) / ((safeBpm * safePpq) / 60);
};

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** MIDI 60 is C4, so the octave is (note / 12) - 1. */
export const midiNoteToName = (noteNumber) => {
  const value = Math.round(Number(noteNumber) || 0);
  const octave = Math.floor(value / 12) - 1;
  const name = NOTE_NAMES[((value % 12) + 12) % 12];
  return `${name}${octave}`;
};

/** The inverse, falling back to middle C rather than to NaN — an unparsable
 *  name should play something, not silence the note and everything after it. */
export const noteNameToMidi = (noteName) => {
  if (!noteName || typeof noteName !== "string") return 60;
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(noteName.trim());
  if (!match) return 60;
  const letter = match[1].toUpperCase();
  const accidental = match[2];
  const octave = Number(match[3]);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[letter] ?? 0;
  const offset = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  return (octave + 1) * 12 + base + offset;
};

/** A440 as the reference: MIDI 69 is 440Hz. */
export const midiToFreq = (noteNumber) =>
  440 * Math.pow(2, (Number(noteNumber || 60) - 69) / 12);

/** A pitch shift in semitones as a sample playback rate. */
export const semitonesToRate = (semitones) => Math.pow(2, (Number(semitones) || 0) / 12);

/** The soundfont that best matches what the lane says it is. */
export const resolveSoundfontName = (instrumentLabel, laneName) => {
  const key = `${instrumentLabel || ""} ${laneName || ""}`.toLowerCase();
  if (key.includes("piano")) return "acoustic_grand_piano";
  if (key.includes("guitar")) return "electric_guitar_clean";
  if (key.includes("bass")) return "acoustic_bass";
  if (key.includes("string")) return "string_ensemble_1";
  if (key.includes("synth")) return "synth_pad_1_new_age";
  if (key.includes("drum") || key.includes("beat")) return "synth_drum";
  return "acoustic_grand_piano";
};

/**
 * How loud a lane should be.
 *
 * Solo is exclusive: the moment any lane is soloed, every lane that isn't
 * goes silent, whatever its own fader and mute say.
 */
export const computeLaneGain = (lane, soloSet) => {
  if (soloSet?.size && !soloSet.has(lane.id)) return 0;
  if (lane.mute) return 0;
  return dbToGain(lane.gainDb ?? 0);
};

/** The set of lanes currently soloed. */
export const getSoloSet = (lanes = []) =>
  new Set((lanes || []).filter((lane) => lane.solo).map((lane) => lane.id));

/**
 * Every effect parameter, clamped to what the node can actually take.
 *
 * A disabled effect is expressed as a mix (or drive, or cutoff) that makes it
 * inaudible rather than by unhooking the node — the graph stays the same
 * shape, so toggling an effect during playback never clicks.
 */
export const resolveFxParams = (fx = {}) => ({
  // Above 20kHz the filter is out of hearing, which is what "off" means here.
  lowpassCutoff: fx.lowpass?.enabled ? clamp(Number(fx.lowpass?.cutoff ?? 12000), 200, 20000) : 20000,
  distortionDrive: fx.distortion?.enabled ? clamp(Number(fx.distortion?.drive ?? 20), 0, 100) : 0,
  echoTime: clamp(Number(fx.echo?.time ?? 0.25), 0.05, 1.5),
  // Feedback is capped below 1 on purpose: at 1 the delay line never decays.
  echoFeedback: clamp(Number(fx.echo?.feedback ?? 0.3), 0, 0.85),
  echoMix: fx.echo?.enabled ? clamp(Number(fx.echo?.mix ?? 0.25), 0, 1) : 0,
  reverbDecay: clamp(Number(fx.reverb?.decay ?? 2.5), 0.5, 8),
  reverbMix: fx.reverb?.enabled ? clamp(Number(fx.reverb?.mix ?? 0.25), 0, 1) : 0,
  chorusRate: clamp(Number(fx.chorus?.rate ?? 0.8), 0.1, 5),
  chorusDepth: clamp(Number(fx.chorus?.depth ?? 0.012), 0, 0.03),
  chorusTime: clamp(Number(fx.chorus?.time ?? 0.02), 0.005, 0.05),
  chorusMix: fx.chorus?.enabled ? clamp(Number(fx.chorus?.mix ?? 0.3), 0, 1) : 0,
});

/**
 * The waveshaper curve for a given drive, 0 to 100.
 *
 * Drive 0 is the identity line — a straight y = x, which passes the signal
 * through untouched. The general formula does not reduce to that at k = 0, so
 * it is a case of its own; without it, "distortion off" still colours the
 * sound.
 */
export const makeDistortionCurve = (amount) => {
  const k = clamp(Number(amount) || 0, 0, 100);
  const n = 44100;
  const curve = new Float32Array(n);
  const deg = Math.PI / 180;
  for (let i = 0; i < n; i += 1) {
    const x = (i * 2) / n - 1;
    curve[i] = k <= 0 ? x : ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
};

export const PLAYBACK_LOOKAHEAD_SEC = 0.75;
export const PLAYBACK_START_DELAY_SEC = 0.05;
export const PLAYBACK_TRANSPORT_UPDATE_MS = 50;

/** The loop, or null when there is nothing to loop over. Looping is only on
 *  when the transport says so AND a range is selected. */
export const getLoopBounds = (runtimeState) => {
  if (!runtimeState?.ui?.loop || !runtimeState?.selection?.range) return null;
  const { start: rawStart, end: rawEnd } = runtimeState.selection.range;
  const start = Math.min(rawStart, rawEnd);
  const end = Math.max(rawStart, rawEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end };
};

/**
 * How far ahead to schedule from `windowStart`.
 *
 * Never past the end of a loop: notes scheduled beyond it would still fire
 * after the transport had jumped back, and be heard over the loop's start.
 */
export const resolveWindowEnd = (windowStart, runtimeState) => {
  const loopBounds = getLoopBounds(runtimeState);
  const baseEnd = windowStart + PLAYBACK_LOOKAHEAD_SEC;
  if (!loopBounds) return baseEnd;
  return Math.min(baseEnd, loopBounds.end);
};
