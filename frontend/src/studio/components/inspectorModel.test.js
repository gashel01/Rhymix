import {
  PANEL_CONTEXT,
  describeClip,
  formatKeyParts,
  formatSeconds,
  getActivityJobs,
  getClipBounds,
  getVisibleAiCards,
  nextStepForJob,
  normalizeRange,
  parseKeyParts,
  resolveRightPanelContext,
  summarizeJob,
} from "./inspectorModel";

describe("resolveRightPanelContext", () => {
  it("prefers a range over a clip", () => {
    expect(resolveRightPanelContext({ start: 0, end: 1 }, { id: "c" })).toBe(PANEL_CONTEXT.RANGE);
  });

  it("reports the clip type when only a clip is selected", () => {
    expect(resolveRightPanelContext(null, { id: "c", clipType: "midi" })).toBe(PANEL_CONTEXT.MIDI);
    expect(resolveRightPanelContext(null, { id: "c" })).toBe(PANEL_CONTEXT.AUDIO);
  });

  it("reports nothing when nothing is selected", () => {
    expect(resolveRightPanelContext(null, null)).toBe(PANEL_CONTEXT.NOTHING);
  });
});

describe("normalizeRange", () => {
  it("orders a backwards drag", () => {
    // Dragging right-to-left is normal; the rest of the panel should never
    // have to care which way round it came in.
    expect(normalizeRange({ start: 8, end: 2 })).toEqual({ start: 2, end: 8 });
  });

  it("leaves a forward range alone", () => {
    expect(normalizeRange({ start: 2, end: 8 })).toEqual({ start: 2, end: 8 });
  });

  it("returns null for no range", () => {
    expect(normalizeRange(null)).toBeNull();
    expect(normalizeRange(undefined)).toBeNull();
  });

  it("rejects an empty range rather than returning a zero-width one", () => {
    // A click without a drag produces start === end. Callers treat a range as
    // "there is something selected", so a zero-width one must not be one.
    expect(normalizeRange({})).toBeNull();
    expect(normalizeRange({ start: 4, end: 4 })).toBeNull();
  });

  it("rejects a range it cannot make sense of", () => {
    expect(normalizeRange({ start: "abc", end: 5 })).toBeNull();
  });
});

describe("getClipBounds", () => {
  it("derives end from source length, not from srcEndSec directly", () => {
    const bounds = getClipBounds({ timelineStartSec: 5, srcStartSec: 2, srcEndSec: 6 });
    expect(bounds.start).toBe(5);
    expect(bounds.end).toBe(9); // 5 + (6 - 2)
    expect(bounds.duration).toBe(4);
  });

  it("never produces a zero-length clip", () => {
    const bounds = getClipBounds({ timelineStartSec: 0, srcStartSec: 3, srcEndSec: 3 });
    expect(bounds.duration).toBeGreaterThan(0);
  });

  it("survives a missing clip", () => {
    expect(() => getClipBounds(null)).not.toThrow();
    expect(() => getClipBounds({})).not.toThrow();
  });
});

describe("key parsing", () => {
  it("round-trips", () => {
    const { note, scale } = parseKeyParts("F# minor");
    expect(formatKeyParts(note, scale)).toBe("F# minor");
  });

  it("accepts the separators a project file might carry", () => {
    expect(parseKeyParts("C-minor")).toEqual({ note: "C", scale: "minor" });
    expect(parseKeyParts("C_minor")).toEqual({ note: "C", scale: "minor" });
  });

  it("recognises abbreviated minor", () => {
    expect(parseKeyParts("A min").scale).toBe("minor");
    expect(parseKeyParts("A MINOR").scale).toBe("minor");
  });

  it("defaults to C major for anything unrecognised", () => {
    expect(parseKeyParts("")).toEqual({ note: "C", scale: "major" });
    expect(parseKeyParts(null)).toEqual({ note: "C", scale: "major" });
    expect(parseKeyParts("gibberish")).toEqual({ note: "C", scale: "major" });
  });

  it("does not invent a note that is not in the scale list", () => {
    expect(parseKeyParts("H major").note).toBe("C");
  });
});

describe("formatSeconds", () => {
  it("always shows two decimals and a unit", () => {
    expect(formatSeconds(1)).toBe("1.00s");
    expect(formatSeconds(1.2345)).toBe("1.23s");
  });

  it("shows 0.00s rather than NaN for junk", () => {
    expect(formatSeconds(undefined)).toBe("0.00s");
    expect(formatSeconds("abc")).toBe("0.00s");
  });
});

describe("summarizeJob", () => {
  it("says the panel is empty rather than rendering an empty string", () => {
    expect(summarizeJob(null)).toBe("No recent activity");
  });

  it("prefers the error over the status", () => {
    const text = summarizeJob({ type: "understand", status: "running", error: "boom" });
    expect(text).toContain("boom");
  });

  it("humanises an unknown job type instead of printing a snake_case key", () => {
    const text = summarizeJob({ type: "some_new_job", status: "running" });
    expect(text).toContain("some new job");
    expect(text).not.toContain("some_new_job");
  });
});

describe("getActivityJobs", () => {
  const jobs = [
    { id: "1", status: "completed" },
    { id: "2", status: "running" },
    { id: "3", status: "failed" },
  ];

  it("shows newest first", () => {
    expect(getActivityJobs(jobs, "all").map((j) => j.id)).toEqual(["3", "2", "1"]);
  });

  it("does not mutate the caller's array", () => {
    const input = [...jobs];
    getActivityJobs(input, "all");
    expect(input.map((j) => j.id)).toEqual(["1", "2", "3"]);
  });

  it("filters to what is still running", () => {
    expect(getActivityJobs(jobs, "active").map((j) => j.id)).toEqual(["2"]);
  });

  it("filters to failures", () => {
    expect(getActivityJobs(jobs, "errors").map((j) => j.id)).toEqual(["3"]);
  });

  it("handles no jobs", () => {
    expect(getActivityJobs(null, "all")).toEqual([]);
  });
});

describe("nextStepForJob", () => {
  it("says nothing when there is no job", () => {
    expect(nextStepForJob(null)).toBe("");
  });

  it("gives each status its own advice", () => {
    const texts = ["failed", "completed", "running", "queued"].map((status) =>
      nextStepForJob({ status })
    );
    expect(new Set(texts).size).toBe(4);
    texts.forEach((text) => expect(text.length).toBeGreaterThan(0));
  });

  it("has advice for a status it has never seen", () => {
    expect(nextStepForJob({ status: "paused" }).length).toBeGreaterThan(0);
  });
});

describe("getVisibleAiCards", () => {
  const cards = (context, caps = {}) =>
    getVisibleAiCards({
      resolvedRightPanelContext: context,
      canAnalyze: true,
      canGenerateDrums: true,
      ...caps,
    });

  it("offers the tools that need no selection when there is none", () => {
    expect(cards(PANEL_CONTEXT.NOTHING, { canAnalyze: false, canGenerateDrums: false }))
      .toEqual(["live", "foundation", "voice"]);
  });

  it("offers the same set for a range as for an audio clip", () => {
    expect(cards(PANEL_CONTEXT.RANGE)).toEqual(cards(PANEL_CONTEXT.AUDIO));
  });

  it("offers nothing on a MIDI clip", () => {
    // MIDI has its own editor; none of the audio-model cards apply to it.
    expect(cards(PANEL_CONTEXT.MIDI)).toEqual([]);
  });

  it("gates each card on its capability, not on the context alone", () => {
    expect(cards(PANEL_CONTEXT.AUDIO)).toEqual(["analyze", "foundation", "drums"]);
    expect(cards(PANEL_CONTEXT.AUDIO, { canGenerateDrums: false }))
      .toEqual(["analyze", "foundation"]);
    expect(cards(PANEL_CONTEXT.AUDIO, { canAnalyze: false }))
      .toEqual(["foundation", "drums"]);
  });

  it("still returns the no-selection set for an unknown context", () => {
    expect(cards("something-else")).toEqual(["live", "foundation", "voice"]);
  });
});

describe("describeClip", () => {
  const lanes = [{ id: "l1", name: "Vocals" }];
  const assets = { "vocal:1": { label: "Take 3" } };

  it("never falls back to the clip id", () => {
    // The panel used to headline a raw 32-character uuid because clips carry
    // no label and the chain ended on clip.id.
    const { name } = describeClip({ id: "b9d50585035b48b3914d4547eb5e0f91", laneId: "l1" }, {}, lanes);
    expect(name).not.toContain("b9d5058");
  });

  it("prefers a label the clip carries itself", () => {
    expect(describeClip({ id: "x", label: "Chorus", sourceAssetId: "vocal:1", laneId: "l1" }, assets, lanes).name)
      .toBe("Chorus");
  });

  it("prefers the asset label", () => {
    expect(describeClip({ id: "x", sourceAssetId: "vocal:1", laneId: "l1" }, assets, lanes).name)
      .toBe("Take 3");
  });

  it("falls back to the lane name", () => {
    expect(describeClip({ id: "x", laneId: "l1" }, {}, lanes).name).toBe("Vocals");
  });

  it("omits the lane when it would repeat the name", () => {
    // "Vocals / Audio clip · 161.00s · Vocals" said the same thing twice.
    expect(describeClip({ id: "x", laneId: "l1" }, {}, lanes).lane).toBeNull();
  });

  it("keeps the lane when it adds something", () => {
    expect(describeClip({ id: "x", sourceAssetId: "vocal:1", laneId: "l1" }, assets, lanes).lane)
      .toBe("Vocals");
  });

  it("has a last resort when there is no lane and no asset", () => {
    expect(describeClip({ id: "x" }, {}, []).name).toBe("Clip");
  });
});
