import {
  DEFAULT_PARAMS,
  applyFormantPreset,
  buildInferenceRequest,
  canStartInference,
  describeModel,
  getExistingCheckpoint,
  getLayerableTracks,
  getPreviousModelName,
  matchCatalogModel,
  mergeResolvedModel,
  resolveSourceTracks,
  selectCheckpoint,
} from "./inferenceParamsModel";

describe("describeModel", () => {
  it("takes the name from either field", () => {
    expect(describeModel({ name: "Nova" }).displayBaseName).toBe("Nova");
    expect(describeModel({ modelName: "Nova" }).displayBaseName).toBe("Nova");
  });

  it("shortens a trained model's name to the part a person chose", () => {
    // Training saves as "<name>_<epochs>e_<steps>s".
    expect(describeModel({ name: "ariana_250e_10000s" }).modelName).toBe("ariana");
  });

  it("reads the epoch from whichever checkpoint field is set", () => {
    expect(describeModel({ selectedCheckpoint: { epochs: 250 } }).epoch).toBe(250);
    expect(describeModel({ selectedCheckpoint: { epoch: 100 } }).epoch).toBe(100);
    expect(describeModel({ modelCheckpoint: { epoch: 50 } }).epoch).toBe(50);
  });

  it("says Unknown rather than showing nothing", () => {
    expect(describeModel({ name: "Nova" }).epoch).toBe("Unknown");
  });

  it("knows when there is no model at all", () => {
    expect(describeModel(null).hasModel).toBe(false);
    expect(describeModel({}).hasModel).toBe(false);
    expect(describeModel({ modelId: "x" }).hasModel).toBe(true);
  });

  it("has a name to show for no model", () => {
    expect(describeModel(null).displayBaseName).toBe("Model");
    expect(describeModel({ name: 42 }).displayBaseName).toBe("Model");
  });
});

describe("applyFormantPreset", () => {
  it("sets both numbers for a known preset", () => {
    expect(applyFormantPreset(DEFAULT_PARAMS, "f2m")).toMatchObject({
      formantPreset: "f2m",
      formantQfrency: 1.0,
      formantTimbre: 0.8,
    });
    expect(applyFormantPreset(DEFAULT_PARAMS, "m2f").formantTimbre).toBe(1.2);
  });

  it("leaves hand-set values alone for none", () => {
    // A preset is a starting point, not a lock.
    const tweaked = { ...DEFAULT_PARAMS, formantQfrency: 5, formantTimbre: 7 };
    expect(applyFormantPreset(tweaked, "none")).toMatchObject({
      formantPreset: "none",
      formantQfrency: 5,
      formantTimbre: 7,
    });
  });

  it("does the same for a preset it does not know", () => {
    expect(applyFormantPreset(DEFAULT_PARAMS, "sideways").formantQfrency)
      .toBe(DEFAULT_PARAMS.formantQfrency);
  });

  it("does not mutate the params it was given", () => {
    const params = { ...DEFAULT_PARAMS };
    applyFormantPreset(params, "random");
    expect(params.formantTimbre).toBe(DEFAULT_PARAMS.formantTimbre);
  });
});

describe("selectCheckpoint", () => {
  const checkpoints = [
    { filename: "a.pth", path: "/m/a.pth", epochs: 100 },
    { filename: "b.pth", path: "/m/b.pth", epochs: 250, isBest: true },
    { filename: "c.pth", path: "/m/c.pth", epochs: 500 },
  ];

  it("matches a filename exactly", () => {
    expect(selectCheckpoint(checkpoints, { filename: "c.pth" }).epochs).toBe(500);
    expect(selectCheckpoint(checkpoints, { pthFile: "a.pth" }).epochs).toBe(100);
  });

  it("matches a filename against the tail of a path", () => {
    expect(selectCheckpoint([{ path: "/deep/dir/x.pth" }], { filename: "x.pth" }).path)
      .toBe("/deep/dir/x.pth");
  });

  it("falls back to the epoch when the filename matches nothing", () => {
    expect(selectCheckpoint(checkpoints, { filename: "gone.pth", epoch: 500 }).epochs).toBe(500);
  });

  it("accepts the epoch under either name, as a string or a number", () => {
    expect(selectCheckpoint(checkpoints, { epoch: 100 }).epochs).toBe(100);
    expect(selectCheckpoint(checkpoints, { epochs: "500" }).epochs).toBe(500);
  });

  it("prefers the model's own best when the hint tells it nothing", () => {
    expect(selectCheckpoint(checkpoints, null).epochs).toBe(250);
    expect(selectCheckpoint(checkpoints, { epoch: 9999 }).epochs).toBe(250);
  });

  it("takes the first when none is marked best", () => {
    // Loading *a* checkpoint beats refusing to convert.
    const plain = [{ epochs: 10 }, { epochs: 20 }];
    expect(selectCheckpoint(plain, null).epochs).toBe(10);
  });

  it("has nothing to pick from an empty model", () => {
    expect(selectCheckpoint([], { epoch: 1 })).toBeNull();
    expect(selectCheckpoint(null, null)).toBeNull();
    expect(selectCheckpoint(undefined, undefined)).toBeNull();
  });

  it("does not treat epoch 0 as no hint", () => {
    const withZero = [{ epochs: 250 }, { epochs: 0 }];
    expect(selectCheckpoint(withZero, { epoch: 0 }).epochs).toBe(0);
  });
});

describe("getExistingCheckpoint", () => {
  it("takes the first field that is set", () => {
    expect(getExistingCheckpoint({ selectedCheckpoint: { id: "s" } }).id).toBe("s");
    expect(getExistingCheckpoint({ modelCheckpoint: { id: "m" } }).id).toBe("m");
    expect(getExistingCheckpoint({ bestCheckpoint: { id: "b" } }).id).toBe("b");
    expect(getExistingCheckpoint({})).toBeNull();
    expect(getExistingCheckpoint(null)).toBeNull();
  });
});

describe("matchCatalogModel", () => {
  const models = [
    { modelId: "user/ariana", name: "ariana_v2", checkpoints: [] },
    { modelId: "user/nova", name: "nova", checkpoints: [] },
  ];

  it("matches on the id", () => {
    expect(matchCatalogModel(models, { id: "user/nova" }).name).toBe("nova");
  });

  it("matches on the name", () => {
    expect(matchCatalogModel(models, { name: "ariana_v2" }).modelId).toBe("user/ariana");
  });

  it("matches across the two fields, because the views disagree which is which", () => {
    expect(matchCatalogModel(models, { id: "nova" }).modelId).toBe("user/nova");
    expect(matchCatalogModel(models, { name: "user/ariana" }).name).toBe("ariana_v2");
  });

  it("is null when nothing matches", () => {
    expect(matchCatalogModel(models, { name: "gone" })).toBeNull();
    expect(matchCatalogModel([], { name: "nova" })).toBeNull();
    expect(matchCatalogModel(undefined, {})).toBeNull();
  });
});

describe("mergeResolvedModel", () => {
  const matched = {
    modelId: "user/nova",
    name: "nova",
    sampleRate: 48000,
    checkpoints: [{ epochs: 100 }, { epochs: 250, isBest: true }],
  };

  it("keeps what the user picked over the catalogue", () => {
    expect(mergeResolvedModel(matched, { name: "nova-as-chosen" }).name).toBe("nova-as-chosen");
  });

  it("fills in what the picker did not carry", () => {
    expect(mergeResolvedModel(matched, { name: "nova" }).sampleRate).toBe(48000);
  });

  it("resolves the checkpoint from the hint the picker had", () => {
    expect(mergeResolvedModel(matched, { selectedCheckpoint: { epoch: 100 } }).selectedCheckpoint)
      .toEqual({ epochs: 100 });
  });

  it("falls back to the best checkpoint", () => {
    expect(mergeResolvedModel(matched, {}).selectedCheckpoint).toEqual({ epochs: 250, isBest: true });
  });

  it("survives a catalogue entry with no checkpoints", () => {
    expect(mergeResolvedModel({ name: "x" }, {}).selectedCheckpoint).toBeNull();
  });
});

describe("layering", () => {
  const tracks = [
    { id: "1", sourceRunId: "run-1", sourceModelName: "Nova" },
    { id: "2" },
    { id: "3", sourceRunId: "run-2" },
  ];

  it("finds the tracks that came out of a run", () => {
    expect(getLayerableTracks(tracks).map((t) => t.id)).toEqual(["1", "3"]);
    expect(getLayerableTracks([])).toEqual([]);
    expect(getLayerableTracks(null)).toEqual([]);
  });

  it("names the model that produced them", () => {
    expect(getPreviousModelName(getLayerableTracks(tracks))).toBe("Nova");
  });

  it("has no name when no run recorded one", () => {
    expect(getPreviousModelName([{ sourceRunId: "r" }])).toBeNull();
    expect(getPreviousModelName([])).toBeNull();
  });
});

describe("resolveSourceTracks", () => {
  const tracks = [
    { id: "1", sourceRunId: "run-1", vocalUrl: "/1.wav" },
    { id: "2", vocalUrl: "/2.wav" },
  ];

  it("keeps sourceRunId for a layered run", () => {
    // With it, the backend converts the previous run's output.
    expect(resolveSourceTracks(tracks, "layered")[0].sourceRunId).toBe("run-1");
  });

  it("strips sourceRunId for an original run", () => {
    // Without it, the backend goes back to the original upload's vocals. A
    // track kept by mistake means converting an already-converted voice.
    const resolved = resolveSourceTracks(tracks, "original");
    expect(resolved[0]).not.toHaveProperty("sourceRunId");
    expect(resolved[0].vocalUrl).toBe("/1.wav");
  });

  it("does not mutate the tracks it was given", () => {
    resolveSourceTracks(tracks, "original");
    expect(tracks[0].sourceRunId).toBe("run-1");
  });

  it("leaves a track with no run alone either way", () => {
    expect(resolveSourceTracks(tracks, "layered")[1]).toEqual({ id: "2", vocalUrl: "/2.wav" });
  });

  it("copes with no tracks", () => {
    expect(resolveSourceTracks(null, "original")).toEqual([]);
    expect(resolveSourceTracks([null], "original")).toEqual([{}]);
  });
});

describe("canStartInference", () => {
  it("needs a model and at least one track", () => {
    expect(canStartInference({ hasModel: true, trackCount: 1 })).toBe(true);
    expect(canStartInference({ hasModel: false, trackCount: 1 })).toBe(false);
    expect(canStartInference({ hasModel: true, trackCount: 0 })).toBe(false);
    expect(canStartInference({})).toBe(false);
  });
});

describe("buildInferenceRequest", () => {
  const request = (over = {}) =>
    buildInferenceRequest({
      params: DEFAULT_PARAMS,
      model: { name: "Nova" },
      selectedTracks: [{ id: "1", sourceRunId: "run-1" }],
      sourceMode: "original",
      ...over,
    });

  it("sends the volume envelope as a number, not a flag", () => {
    expect(request().params.volumeEnvelope).toBe(1);
    expect(request({ params: { ...DEFAULT_PARAMS, volumeEnvelopeEnabled: false } })
      .params.volumeEnvelope).toBe(0);
  });

  it("keeps the UI flag alongside it", () => {
    // The panel reads it back to draw the switch.
    expect(request().params.volumeEnvelopeEnabled).toBe(true);
  });

  it("passes every other knob through untouched", () => {
    const params = { ...DEFAULT_PARAMS, pitch: -3, indexRate: 0.9, f0Method: "crepe" };
    expect(request({ params }).params).toMatchObject({
      pitch: -3,
      indexRate: 0.9,
      f0Method: "crepe",
    });
  });

  it("applies the source mode to the tracks", () => {
    expect(request().tracks[0]).not.toHaveProperty("sourceRunId");
    expect(request({ sourceMode: "layered" }).tracks[0].sourceRunId).toBe("run-1");
  });

  it("carries the model as given", () => {
    expect(request().model).toEqual({ name: "Nova" });
  });
});
