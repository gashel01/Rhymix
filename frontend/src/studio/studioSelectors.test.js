import {
  buildStudioUrl,
  clipLengthSec,
  clipTimelineEnd,
  describeSelection,
  filterAssets,
  findDefaultSourceClip,
  findSelectedClip,
  findSelectedLane,
  findSelectionSourceClip,
  getActiveJobs,
  getCurrentJob,
  getProjectDurationSec,
  getUiStorageKey,
  listAssets,
  readUiPrefs,
  summarizeJob,
  writeUiPrefs,
} from "./studioSelectors";

describe("clip geometry", () => {
  it("length is the trimmed span, not srcEndSec", () => {
    // srcEndSec is an offset into the source, not a length. The two agree only
    // while the clip is untrimmed, and the backend got this wrong twice.
    expect(clipLengthSec({ srcStartSec: 2, srcEndSec: 6 })).toBe(4);
  });

  it("length is never zero", () => {
    expect(clipLengthSec({ srcStartSec: 3, srcEndSec: 3 })).toBe(0.01);
    expect(clipLengthSec({})).toBe(0.01);
    expect(clipLengthSec(null)).toBe(0.01);
  });

  it("end accounts for the trim", () => {
    expect(clipTimelineEnd({ timelineStartSec: 10, srcStartSec: 2, srcEndSec: 6 })).toBe(14);
  });

  it("end matches the naive form only when untrimmed", () => {
    expect(clipTimelineEnd({ timelineStartSec: 10, srcStartSec: 0, srcEndSec: 6 })).toBe(16);
  });
});

describe("summarizeJob", () => {
  it("shows the error ahead of the status message", () => {
    // A job keeps whatever statusMessage it had when it died, so a failed
    // export used to read "Export · Rendering mixdown..." and say nothing
    // about the failure.
    const text = summarizeJob({
      type: "render",
      status: "failed",
      statusMessage: "Rendering mixdown...",
      error: "ffmpeg exited 1",
    });
    expect(text).toBe("Export · ffmpeg exited 1");
  });

  it("shows the status message while the job is running", () => {
    expect(summarizeJob({ type: "render", status: "running", statusMessage: "Rendering..." }))
      .toBe("Export · Rendering...");
  });

  it("humanises a job type it has no label for", () => {
    expect(summarizeJob({ type: "some_new_job", status: "running" }))
      .toBe("some new job · running");
  });

  it("takes the empty label from its caller", () => {
    expect(summarizeJob(null)).toBe("No recent activity");
    expect(summarizeJob(null, "Idle")).toBe("Idle");
  });
});

describe("job selection", () => {
  const jobs = [
    { id: "1", status: "completed" },
    { id: "2", status: "running" },
    { id: "3", status: "failed" },
    { id: "4", status: "queued" },
  ];

  it("counts queued and running as active", () => {
    expect(getActiveJobs(jobs).map((j) => j.id)).toEqual(["2", "4"]);
  });

  it("shows the newest running job", () => {
    expect(getCurrentJob(jobs).id).toBe("4");
  });

  it("falls back to the newest job of any kind", () => {
    expect(getCurrentJob([{ id: "1", status: "completed" }]).id).toBe("1");
  });

  it("has nothing to show for no jobs", () => {
    expect(getCurrentJob([])).toBeNull();
    expect(getActiveJobs()).toEqual([]);
  });
});

describe("assets", () => {
  const assets = {
    "vocal:1": { label: "Lead Vocal" },
    "inst:2": { id: "override", label: "Backing" },
  };

  it("gives each asset its map key as an id", () => {
    expect(listAssets(assets).map((a) => a.id)).toEqual(["vocal:1", "override"]);
  });

  it("copes with no assets", () => {
    expect(listAssets(undefined)).toEqual([]);
  });

  it("searches the label and the id", () => {
    const list = listAssets(assets);
    expect(filterAssets(list, "lead")).toHaveLength(1);
    expect(filterAssets(list, "inst")).toHaveLength(0); // id was overridden
    expect(filterAssets(list, "vocal")).toHaveLength(1);
  });

  it("returns everything for an empty query", () => {
    const list = listAssets(assets);
    expect(filterAssets(list, "  ")).toBe(list);
  });
});

describe("finding the clip a selection is about", () => {
  const clips = [
    { id: "c1", laneId: "l1", sourceAssetId: "a1", timelineStartSec: 0, srcStartSec: 0, srcEndSec: 10 },
    { id: "c2", laneId: "l2", sourceAssetId: "a2", timelineStartSec: 10, srcStartSec: 0, srcEndSec: 10 },
    { id: "m1", laneId: "l3", clipType: "midi", timelineStartSec: 0, srcStartSec: 0, srcEndSec: 30 },
  ];

  it("finds the clip named by the selection", () => {
    expect(findSelectedClip(clips, { clipIds: ["c2"] }).id).toBe("c2");
    expect(findSelectedClip(clips, { clipIds: [] })).toBeNull();
    expect(findSelectedClip(clips, null)).toBeNull();
  });

  it("finds a clip a range overlaps, not only one it contains", () => {
    // A range drawn across a clip boundary still has that clip's audio under
    // most of it, and the AI tools need something to work from.
    expect(findSelectionSourceClip(clips, { range: { start: 8, end: 12 } }).id).toBe("c1");
  });

  it("skips MIDI, which has no audio to send", () => {
    const midiOnly = [clips[2]];
    expect(findSelectionSourceClip(midiOnly, { range: { start: 0, end: 5 } })).toBeNull();
  });

  it("honours a lane restriction", () => {
    expect(findSelectionSourceClip(clips, { range: { start: 0, end: 20 }, laneIds: ["l2"] }).id)
      .toBe("c2");
  });

  it("has nothing for a range that touches no clip", () => {
    expect(findSelectionSourceClip(clips, { range: { start: 100, end: 110 } })).toBeNull();
  });

  it("has nothing for an empty range", () => {
    expect(findSelectionSourceClip(clips, { range: { start: 5, end: 5 } })).toBeNull();
    expect(findSelectionSourceClip(clips, {})).toBeNull();
  });

  it("prefers the mix lane as the default source", () => {
    const lanes = [{ id: "l2", type: "mix" }, { id: "l1", type: "vocal" }];
    expect(findDefaultSourceClip(clips, lanes).id).toBe("c2");
  });

  it("falls back to any audio clip when there is no mix lane", () => {
    expect(findDefaultSourceClip(clips, [{ id: "l1", type: "vocal" }]).id).toBe("c1");
  });

  it("has no default when the project holds only MIDI", () => {
    expect(findDefaultSourceClip([clips[2]], [])).toBeNull();
  });

  it("finds the lane from the selection, or from the selected clip", () => {
    const lanes = [{ id: "l1", name: "Vocals" }, { id: "l2", name: "Music" }];
    expect(findSelectedLane(lanes, { laneIds: ["l2"] }, null).name).toBe("Music");
    expect(findSelectedLane(lanes, {}, { laneId: "l1" }).name).toBe("Vocals");
    expect(findSelectedLane(lanes, {}, null)).toBeNull();
  });
});

describe("describeSelection", () => {
  const base = { selectedClip: null, selectedLane: null, selection: null, lanes: [], clips: [] };

  it("names the clip and its length", () => {
    const text = describeSelection({
      ...base,
      selectedClip: { id: "c1", label: "Verse", srcStartSec: 2, srcEndSec: 6 },
    });
    expect(text).toBe("Clip · Verse · 4.00s");
  });

  it("falls back to the clip id only when it has no name", () => {
    expect(describeSelection({ ...base, selectedClip: { id: "c1", srcEndSec: 1 } }))
      .toContain("c1");
  });

  it("describes a range with its lane count", () => {
    expect(describeSelection({
      ...base,
      selection: { range: { start: 1.5, end: 4 }, laneIds: ["l1", "l2"] },
      lanes: [{ id: "l1" }, { id: "l2" }, { id: "l3" }],
    })).toBe("Range · 1.50s to 4.00s · 2 lanes");
  });

  it("counts every lane when the range names none", () => {
    expect(describeSelection({
      ...base,
      selection: { range: { start: 0, end: 4 } },
      lanes: [{ id: "l1" }],
    })).toBe("Range · 0.00s to 4.00s · 1 lane");
  });

  it("orders a backwards range", () => {
    expect(describeSelection({ ...base, selection: { range: { start: 4, end: 1 } } }))
      .toContain("1.00s to 4.00s");
  });

  it("names the lane when only a lane is selected", () => {
    expect(describeSelection({ ...base, selectedLane: { name: "Vocals" } })).toBe("Lane · Vocals");
  });

  it("explains what to do when the project is empty", () => {
    expect(describeSelection(base)).toMatch(/No clips yet/);
  });

  it("says nothing is selected when there are clips but no selection", () => {
    expect(describeSelection({ ...base, clips: [{ id: "c1" }] })).toBe("No active selection");
  });
});

describe("getProjectDurationSec", () => {
  it("reaches the end of the furthest clip", () => {
    const clips = [
      { timelineStartSec: 0, srcEndSec: 10 },
      { timelineStartSec: 30, srcEndSec: 20 },
    ];
    expect(getProjectDurationSec({ durationSec: 0 }, clips)).toBe(50);
  });

  it("does not overstate a trimmed clip", () => {
    const clips = [{ timelineStartSec: 0, srcStartSec: 100, srcEndSec: 110 }];
    expect(getProjectDurationSec({ durationSec: 0 }, clips)).toBe(10);
  });

  it("treats the stored duration as a floor, not the answer", () => {
    // It can lag an edit made since the last save.
    expect(getProjectDurationSec({ durationSec: 200 }, [{ timelineStartSec: 0, srcEndSec: 10 }]))
      .toBe(200);
  });

  it("gives an empty project a ruler to look at", () => {
    expect(getProjectDurationSec(null, [])).toBe(10);
  });
});

describe("buildStudioUrl", () => {
  it("keeps the bare path for a direct entry", () => {
    // The asset in the URL is the one the page was opened with; carrying it
    // into a different project would reopen the wrong thing on reload.
    expect(buildStudioUrl({ assetId: "a1", isDirectStudioEntry: true, projectId: "p1" }))
      .toBe("/studio?projectId=p1");
  });

  it("keeps the asset when the page was opened on one", () => {
    expect(buildStudioUrl({ assetId: "a1", isDirectStudioEntry: false, projectId: "p1" }))
      .toBe("/studio/a1?projectId=p1");
  });

  it("escapes both parts", () => {
    expect(buildStudioUrl({ assetId: "vocal:1", isDirectStudioEntry: false, projectId: "p/1" }))
      .toBe("/studio/vocal%3A1?projectId=p%2F1");
  });

  it("omits the query when there is no project", () => {
    expect(buildStudioUrl({ assetId: "a1", isDirectStudioEntry: false })).toBe("/studio/a1");
    expect(buildStudioUrl({})).toBe("/studio");
  });
});

describe("UI preferences", () => {
  beforeEach(() => window.localStorage.clear());

  it("keys them per project", () => {
    expect(getUiStorageKey("p1")).not.toBe(getUiStorageKey("p2"));
  });

  it("round-trips", () => {
    writeUiPrefs("p1", { zoom: 2, focusMode: true });
    expect(readUiPrefs("p1")).toEqual({ zoom: 2, focusMode: true });
  });

  it("does not leak between projects", () => {
    writeUiPrefs("p1", { zoom: 2 });
    expect(readUiPrefs("p2")).toBeNull();
  });

  it("has nothing to read for no project", () => {
    expect(readUiPrefs(null)).toBeNull();
    expect(() => writeUiPrefs(null, { zoom: 1 })).not.toThrow();
  });

  it("opens with defaults rather than not at all on corrupt storage", () => {
    window.localStorage.setItem(getUiStorageKey("p1"), "{not json");
    expect(readUiPrefs("p1")).toBeNull();
  });

  it("survives storage being blocked entirely", () => {
    const setItem = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    expect(() => writeUiPrefs("p1", { zoom: 1 })).not.toThrow();
    window.localStorage.setItem = setItem;
  });
});
