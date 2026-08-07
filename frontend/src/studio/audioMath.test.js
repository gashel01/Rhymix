import {
  PLAYBACK_LOOKAHEAD_SEC,
  clamp,
  computeLaneGain,
  dbToGain,
  getLoopBounds,
  getSoloSet,
  makeDistortionCurve,
  midiNoteToName,
  midiToFreq,
  noteNameToMidi,
  resolveFxParams,
  resolveSoundfontName,
  resolveWindowEnd,
  semitonesToRate,
  ticksToSec,
} from "./audioMath";

describe("dbToGain", () => {
  it("leaves the signal alone at 0dB", () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(null)).toBe(1);
    expect(dbToGain(undefined)).toBe(1);
  });

  it("halves at -6dB and doubles at +6dB", () => {
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
    expect(dbToGain(6)).toBeCloseTo(1.995, 3);
  });

  it("is effectively silent far down", () => {
    expect(dbToGain(-60)).toBeCloseTo(0.001, 4);
  });
});

describe("clamp", () => {
  it("holds a value inside its range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
  });
});

describe("ticksToSec", () => {
  it("converts at the given tempo and resolution", () => {
    // 1920 ticks at 480ppq is one 4/4 bar; at 120bpm that is 2s.
    expect(ticksToSec(1920, 120, 480)).toBeCloseTo(2);
  });

  it("halving the tempo doubles the time", () => {
    expect(ticksToSec(1920, 60, 480)).toBeCloseTo(4);
  });

  it("assumes 120bpm and 480ppq when told nothing", () => {
    expect(ticksToSec(1920, null, null)).toBeCloseTo(2);
    expect(ticksToSec(1920, 0, 0)).toBeCloseTo(2);
  });

  it("is zero at tick zero", () => {
    expect(ticksToSec(0, 120, 480)).toBe(0);
  });
});

describe("note names", () => {
  it("puts middle C at MIDI 60", () => {
    expect(midiNoteToName(60)).toBe("C4");
    expect(noteNameToMidi("C4")).toBe(60);
  });

  it("round-trips every natural note across octaves", () => {
    for (let midi = 0; midi <= 127; midi += 1) {
      expect(noteNameToMidi(midiNoteToName(midi))).toBe(midi);
    }
  });

  it("names sharps, and reads flats back", () => {
    expect(midiNoteToName(61)).toBe("C#4");
    expect(noteNameToMidi("C#4")).toBe(61);
    expect(noteNameToMidi("Db4")).toBe(61);
  });

  it("handles notes below MIDI 12, whose octave is negative", () => {
    expect(midiNoteToName(0)).toBe("C-1");
    expect(noteNameToMidi("C-1")).toBe(0);
  });

  it("accepts a lower-case letter", () => {
    expect(noteNameToMidi("c4")).toBe(60);
  });

  it("falls back to middle C rather than NaN", () => {
    // A note that parses to NaN would silence itself and, scheduled into the
    // graph, everything after it.
    expect(noteNameToMidi("nonsense")).toBe(60);
    expect(noteNameToMidi("")).toBe(60);
    expect(noteNameToMidi(null)).toBe(60);
    expect(noteNameToMidi(60)).toBe(60);
  });
});

describe("midiToFreq", () => {
  it("puts A4 at 440Hz", () => {
    expect(midiToFreq(69)).toBeCloseTo(440);
  });

  it("doubles an octave up", () => {
    expect(midiToFreq(81)).toBeCloseTo(880);
    expect(midiToFreq(57)).toBeCloseTo(220);
  });

  it("assumes middle C for nothing", () => {
    expect(midiToFreq(null)).toBeCloseTo(midiToFreq(60));
  });
});

describe("semitonesToRate", () => {
  it("does not resample at zero", () => {
    expect(semitonesToRate(0)).toBe(1);
    expect(semitonesToRate(null)).toBe(1);
  });

  it("doubles an octave up and halves an octave down", () => {
    expect(semitonesToRate(12)).toBeCloseTo(2);
    expect(semitonesToRate(-12)).toBeCloseTo(0.5);
  });
});

describe("resolveSoundfontName", () => {
  it("matches on either the instrument or the lane name", () => {
    expect(resolveSoundfontName("Grand Piano", "")).toBe("acoustic_grand_piano");
    expect(resolveSoundfontName("", "Bass Line")).toBe("acoustic_bass");
  });

  it("treats a beat as drums", () => {
    expect(resolveSoundfontName("", "Beat")).toBe("synth_drum");
  });

  it("ignores case", () => {
    expect(resolveSoundfontName("GUITAR", "")).toBe("electric_guitar_clean");
  });

  it("falls back to piano", () => {
    expect(resolveSoundfontName("", "")).toBe("acoustic_grand_piano");
    expect(resolveSoundfontName(null, null)).toBe("acoustic_grand_piano");
  });
});

describe("computeLaneGain", () => {
  const lane = { id: "l1", gainDb: 0 };

  it("is unity at 0dB with nothing soloed", () => {
    expect(computeLaneGain(lane, new Set())).toBe(1);
  });

  it("is silent when muted", () => {
    expect(computeLaneGain({ ...lane, mute: true }, new Set())).toBe(0);
  });

  it("silences every lane that is not soloed", () => {
    // Solo is exclusive: one lane soloed means everything else goes quiet,
    // whatever its own fader says.
    expect(computeLaneGain(lane, new Set(["other"]))).toBe(0);
    expect(computeLaneGain(lane, new Set(["l1"]))).toBe(1);
  });

  it("still respects mute on a soloed lane", () => {
    expect(computeLaneGain({ ...lane, mute: true }, new Set(["l1"]))).toBe(0);
  });

  it("applies the fader", () => {
    expect(computeLaneGain({ ...lane, gainDb: -6 }, new Set())).toBeCloseTo(0.501, 3);
  });

  it("copes with no solo set at all", () => {
    expect(computeLaneGain(lane, undefined)).toBe(1);
  });
});

describe("getSoloSet", () => {
  it("collects the soloed lanes", () => {
    const set = getSoloSet([{ id: "a", solo: true }, { id: "b" }, { id: "c", solo: true }]);
    expect([...set].sort()).toEqual(["a", "c"]);
  });

  it("is empty when nothing is soloed", () => {
    expect(getSoloSet([{ id: "a" }]).size).toBe(0);
    expect(getSoloSet().size).toBe(0);
  });
});

describe("resolveFxParams", () => {
  it("makes every effect inaudible when it is off", () => {
    // Expressed as a mix rather than by unhooking the node, so toggling an
    // effect mid-playback never clicks.
    const off = resolveFxParams({});
    expect(off.lowpassCutoff).toBe(20000);
    expect(off.distortionDrive).toBe(0);
    expect(off.echoMix).toBe(0);
    expect(off.reverbMix).toBe(0);
    expect(off.chorusMix).toBe(0);
  });

  it("an explicit mix does nothing while the effect is disabled", () => {
    expect(resolveFxParams({ reverb: { enabled: false, mix: 0.9 } }).reverbMix).toBe(0);
  });

  it("takes the values once enabled", () => {
    const fx = resolveFxParams({
      lowpass: { enabled: true, cutoff: 3000 },
      reverb: { enabled: true, mix: 0.4, decay: 3 },
      chorus: { enabled: true, mix: 0.5, rate: 1.2 },
    });
    expect(fx.lowpassCutoff).toBe(3000);
    expect(fx.reverbMix).toBe(0.4);
    expect(fx.reverbDecay).toBe(3);
    expect(fx.chorusRate).toBe(1.2);
  });

  it("clamps a cutoff outside what the filter takes", () => {
    expect(resolveFxParams({ lowpass: { enabled: true, cutoff: 1 } }).lowpassCutoff).toBe(200);
    expect(resolveFxParams({ lowpass: { enabled: true, cutoff: 99999 } }).lowpassCutoff).toBe(20000);
  });

  it("never lets echo feedback reach one", () => {
    // At a feedback of 1 the delay line never decays — the echo runs for ever.
    expect(resolveFxParams({ echo: { enabled: true, feedback: 5 } }).echoFeedback).toBe(0.85);
  });

  it("clamps every remaining parameter to its node's range", () => {
    const huge = resolveFxParams({
      distortion: { enabled: true, drive: 1000 },
      echo: { enabled: true, time: 99, mix: 9 },
      reverb: { enabled: true, decay: 99 },
      chorus: { enabled: true, rate: 99, depth: 9, time: 9 },
    });
    expect(huge.distortionDrive).toBe(100);
    expect(huge.echoTime).toBe(1.5);
    expect(huge.echoMix).toBe(1);
    expect(huge.reverbDecay).toBe(8);
    expect(huge.chorusRate).toBe(5);
    expect(huge.chorusDepth).toBe(0.03);
    expect(huge.chorusTime).toBe(0.05);
  });

  it("survives a lane with no fx at all", () => {
    expect(() => resolveFxParams(undefined)).not.toThrow();
  });
});

describe("makeDistortionCurve", () => {
  it("is the identity line at drive zero", () => {
    // The general formula does not reduce to y = x at k = 0, so without the
    // special case "distortion off" still colours the sound.
    const curve = makeDistortionCurve(0);
    expect(curve[0]).toBeCloseTo(-1, 4);
    expect(curve[curve.length - 1]).toBeCloseTo(1, 4);
    expect(curve[curve.length / 2]).toBeCloseTo(0, 4);
  });

  it("is perfectly linear at drive zero and bent above it", () => {
    // Distortion is non-linearity, not loudness — this shaper actually
    // compresses in the middle. What matters is that the gain it applies
    // stops being constant across the input range.
    const gainAt = (curve, x) => {
      const i = Math.round(((x + 1) / 2) * (curve.length - 1));
      return curve[i] / x;
    };
    const flat = makeDistortionCurve(0);
    // Precision 3, not more: the curve is 44,100 discrete samples, so reading
    // it at an arbitrary x carries up to half a sample step of error.
    expect(gainAt(flat, 0.1)).toBeCloseTo(gainAt(flat, 0.9), 3);

    const driven = makeDistortionCurve(50);
    expect(gainAt(driven, 0.1)).not.toBeCloseTo(gainAt(driven, 0.9), 1);
  });

  it("is symmetric about zero", () => {
    const curve = makeDistortionCurve(30);
    const n = curve.length;
    expect(curve[10]).toBeCloseTo(-curve[n - 11], 4);
  });

  it("treats junk as no drive", () => {
    expect(makeDistortionCurve(undefined)[0]).toBeCloseTo(-1, 4);
  });
});

describe("getLoopBounds", () => {
  const looping = (range) => ({ ui: { loop: true }, selection: { range } });

  it("needs both the loop switch and a range", () => {
    expect(getLoopBounds(looping({ start: 1, end: 5 }))).toEqual({ start: 1, end: 5 });
    expect(getLoopBounds({ ui: { loop: false }, selection: { range: { start: 1, end: 5 } } }))
      .toBeNull();
    expect(getLoopBounds({ ui: { loop: true }, selection: {} })).toBeNull();
    expect(getLoopBounds(null)).toBeNull();
  });

  it("orders a backwards range", () => {
    expect(getLoopBounds(looping({ start: 5, end: 1 }))).toEqual({ start: 1, end: 5 });
  });

  it("refuses a range with no width", () => {
    expect(getLoopBounds(looping({ start: 3, end: 3 }))).toBeNull();
  });

  it("refuses a range it cannot read", () => {
    expect(getLoopBounds(looping({ start: NaN, end: 5 }))).toBeNull();
  });
});

describe("resolveWindowEnd", () => {
  it("schedules a lookahead ahead of the cursor", () => {
    expect(resolveWindowEnd(10, { ui: {} })).toBe(10 + PLAYBACK_LOOKAHEAD_SEC);
  });

  it("never schedules past the end of a loop", () => {
    // Notes scheduled beyond the loop would still fire after the transport
    // jumped back, and be heard over the loop's own start.
    const state = { ui: { loop: true }, selection: { range: { start: 0, end: 10.2 } } };
    expect(resolveWindowEnd(10, state)).toBe(10.2);
  });

  it("uses the full lookahead when the loop end is further away", () => {
    const state = { ui: { loop: true }, selection: { range: { start: 0, end: 100 } } };
    expect(resolveWindowEnd(10, state)).toBe(10 + PLAYBACK_LOOKAHEAD_SEC);
  });
});
