import { tileRecordedSpanIntoClips, tileRecordedSpansIntoClips } from "./sessionRecording";

describe("tileRecordedSpanIntoClips", () => {
  test("exact multiple of loop length produces only full-cycle clips, no remainder sliver", () => {
    const clips = tileRecordedSpanIntoClips({
      laneId: "lane-1",
      assetId: "asset-1",
      srcStartSec: 0,
      srcEndSec: 2,
      startTimelineSec: 10,
      endTimelineSec: 16, // 3 exact cycles of 2s
    });
    expect(clips).toHaveLength(3);
    expect(clips.map((c) => c.timelineStartSec)).toEqual([10, 12, 14]);
    clips.forEach((c) => {
      expect(c.srcStartSec).toBe(0);
      expect(c.srcEndSec).toBe(2);
      expect(c.laneId).toBe("lane-1");
      expect(c.sourceAssetId).toBe("asset-1");
    });
  });

  test("span with a remainder shorter than one loop appends one shortened final clip", () => {
    const clips = tileRecordedSpanIntoClips({
      laneId: "lane-1",
      assetId: "asset-1",
      srcStartSec: 0,
      srcEndSec: 2,
      startTimelineSec: 0,
      endTimelineSec: 5, // 2 full cycles + 1s remainder
    });
    expect(clips).toHaveLength(3);
    expect(clips[2]).toMatchObject({ timelineStartSec: 4, srcStartSec: 0, srcEndSec: 1 });
  });

  test("a loop window that starts mid-asset (non-zero srcStartSec) tiles from that offset", () => {
    const clips = tileRecordedSpanIntoClips({
      laneId: "lane-1",
      assetId: "asset-1",
      srcStartSec: 3,
      srcEndSec: 4.5, // 1.5s loop
      startTimelineSec: 0,
      endTimelineSec: 3, // exactly 2 cycles
    });
    expect(clips).toHaveLength(2);
    clips.forEach((c) => {
      expect(c.srcStartSec).toBe(3);
      expect(c.srcEndSec).toBe(4.5);
    });
    expect(clips.map((c) => c.timelineStartSec)).toEqual([0, 1.5]);
  });

  test("a near-exact-multiple span (float drift) doesn't spawn a near-zero sliver clip", () => {
    const clips = tileRecordedSpanIntoClips({
      laneId: "lane-1",
      assetId: "asset-1",
      srcStartSec: 0,
      srcEndSec: 2,
      startTimelineSec: 0,
      endTimelineSec: 4.0000001, // 2 cycles + a sub-millisecond sliver
    });
    expect(clips).toHaveLength(2);
  });

  test("remainder under the minimum threshold is dropped, not emitted as a sliver clip", () => {
    const clips = tileRecordedSpanIntoClips({
      laneId: "lane-1",
      assetId: "asset-1",
      srcStartSec: 0,
      srcEndSec: 2,
      startTimelineSec: 0,
      endTimelineSec: 2.005, // 5ms past one cycle — below the 20ms floor
    });
    expect(clips).toHaveLength(1);
  });

  test("a MIDI clip-slot carries its midi payload and clipType through every tiled repeat", () => {
    const midi = { notes: [{ note: 60, startTick: 0, durationTick: 480 }] };
    const clips = tileRecordedSpanIntoClips({
      laneId: "lane-midi",
      clipType: "midi",
      midi,
      srcStartSec: 0,
      srcEndSec: 1,
      startTimelineSec: 0,
      endTimelineSec: 2,
      label: "MIDI · Piano",
    });
    expect(clips).toHaveLength(2);
    clips.forEach((c) => {
      expect(c.clipType).toBe("midi");
      expect(c.midi).toBe(midi);
      expect(c.label).toBe("MIDI · Piano");
    });
  });

  test("a degenerate span (zero-length loop or non-positive duration) produces nothing", () => {
    expect(tileRecordedSpanIntoClips({ laneId: "l", srcStartSec: 1, srcEndSec: 1, startTimelineSec: 0, endTimelineSec: 5 })).toEqual([]);
    expect(tileRecordedSpanIntoClips({ laneId: "l", srcStartSec: 0, srcEndSec: 2, startTimelineSec: 5, endTimelineSec: 5 })).toEqual([]);
    expect(tileRecordedSpanIntoClips({ laneId: "l", srcStartSec: 0, srcEndSec: 2, startTimelineSec: 5, endTimelineSec: 3 })).toEqual([]);
    expect(tileRecordedSpanIntoClips(null)).toEqual([]);
  });
});

describe("tileRecordedSpansIntoClips", () => {
  test("tiles multiple lanes' spans independently and flattens into one clip list", () => {
    const clips = tileRecordedSpansIntoClips({
      "lane-a": { laneId: "lane-a", assetId: "a1", srcStartSec: 0, srcEndSec: 2, startTimelineSec: 0, endTimelineSec: 4 },
      "lane-b": { laneId: "lane-b", assetId: "b1", srcStartSec: 0, srcEndSec: 1, startTimelineSec: 0, endTimelineSec: 3 },
    });
    const laneAClips = clips.filter((c) => c.laneId === "lane-a");
    const laneBClips = clips.filter((c) => c.laneId === "lane-b");
    expect(laneAClips).toHaveLength(2);
    expect(laneBClips).toHaveLength(3);
  });

  test("an empty map of spans produces an empty clip list", () => {
    expect(tileRecordedSpansIntoClips({})).toEqual([]);
    expect(tileRecordedSpansIntoClips(undefined)).toEqual([]);
  });
});
