import {
  splitClip,
  trimClipLeft,
  trimClipRight,
  moveClip,
  deleteSelection,
  duplicateSelection,
} from "./edlOps";

const makeClip = (overrides = {}) => ({
  id: overrides.id || "clip-1",
  laneId: overrides.laneId || "lane-1",
  sourceAssetId: overrides.sourceAssetId || "asset-1",
  srcStartSec: overrides.srcStartSec ?? 0,
  srcEndSec: overrides.srcEndSec ?? 10,
  timelineStartSec: overrides.timelineStartSec ?? 0,
  fadeInSec: overrides.fadeInSec ?? 0,
  fadeOutSec: overrides.fadeOutSec ?? 0,
  gainDb: overrides.gainDb ?? 0,
});

describe("edlOps", () => {
  test("splitClip splits into two clips", () => {
    const clips = [makeClip({ id: "clip-a", srcEndSec: 10, timelineStartSec: 0 })];
    const next = splitClip(clips, "clip-a", 4);
    expect(next).toHaveLength(2);
    expect(next[0].srcEndSec).toBeCloseTo(4);
    expect(next[1].timelineStartSec).toBeCloseTo(4);
  });

  test("trimClipLeft adjusts timeline and srcStart", () => {
    const clips = [makeClip({ id: "clip-a", srcEndSec: 10, timelineStartSec: 0 })];
    const next = trimClipLeft(clips, "clip-a", 2);
    expect(next[0].timelineStartSec).toBeCloseTo(2);
    expect(next[0].srcStartSec).toBeCloseTo(2);
  });

  test("trimClipRight adjusts srcEnd", () => {
    const clips = [makeClip({ id: "clip-a", srcEndSec: 10, timelineStartSec: 0 })];
    const next = trimClipRight(clips, "clip-a", 6);
    expect(next[0].srcEndSec).toBeCloseTo(6);
  });

  test("moveClip snaps when enabled", () => {
    const clips = [makeClip({ id: "clip-a", timelineStartSec: 0 })];
    const next = moveClip(clips, "clip-a", 1.24, { snap: true, gridSec: 0.5 });
    expect(next[0].timelineStartSec).toBeCloseTo(1.0);
  });

  test("moveClip can change lanes", () => {
    const clips = [makeClip({ id: "clip-a", laneId: "lane-a" })];
    const next = moveClip(clips, "clip-a", 2, { laneId: "lane-b" });
    expect(next[0].laneId).toBe("lane-b");
  });

  test("deleteSelection removes overlapping clips", () => {
    const clips = [
      makeClip({ id: "clip-a", timelineStartSec: 0 }),
      makeClip({ id: "clip-b", timelineStartSec: 12 }),
    ];
    const next = deleteSelection(clips, { start: 1, end: 9 });
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe("clip-b");
  });

  test("duplicateSelection copies clips with offset", () => {
    const clips = [makeClip({ id: "clip-a", timelineStartSec: 0 })];
    const next = duplicateSelection(clips, { start: 0, end: 5 }, null, 10);
    expect(next).toHaveLength(2);
    expect(next[1].timelineStartSec).toBeCloseTo(10);
  });
});
