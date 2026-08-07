import {
  CARD_GRADIENTS,
  describeDownload,
  describeTraining,
  filterModels,
  formatSampleRate,
  formatSelectionPreview,
  getCardGradient,
  getInstalledIds,
  getSelectableModels,
  getSelectionNames,
  mergeModelCatalog,
  normaliseModelName,
  normalizeId,
  resolveBackTarget,
} from "./modelsCatalog";

const NOW = "2026-01-01T00:00:00.000Z";
const merge = (over = {}) => mergeModelCatalog({ now: NOW, ...over });

describe("normalizeId", () => {
  it("collapses the three spellings of one model into one identity", () => {
    expect(normalizeId("Ariana Grande")).toBe(normalizeId("ariana_grande"));
    expect(normalizeId("ariana-grande")).toBe(normalizeId("arianagrande"));
  });

  it("is empty for nothing", () => {
    expect(normalizeId(null)).toBe("");
    expect(normalizeId("")).toBe("");
  });

  it("survives a non-string", () => {
    expect(normalizeId(42)).toBe("42");
  });
});

describe("getInstalledIds", () => {
  it("answers to both the id and the name", () => {
    const ids = getInstalledIds([{ modelId: "user/Ariana", name: "ariana_v2" }]);
    expect(ids.has(normalizeId("user/Ariana"))).toBe(true);
    expect(ids.has(normalizeId("ariana_v2"))).toBe(true);
  });

  it("is empty for no models", () => {
    expect(getInstalledIds([]).size).toBe(0);
    expect(getInstalledIds().size).toBe(0);
  });
});

describe("mergeModelCatalog", () => {
  const local = [{ name: "ariana", modelId: "user/ariana", created: "2026-01-01T10:00:00Z" }];

  it("marks an installed model complete when it says nothing", () => {
    expect(merge({ localModels: [{ name: "a" }] })[0].status).toBe("completed");
  });

  it("keeps a status the model states for itself", () => {
    expect(merge({ localModels: [{ name: "a", status: "failed" }] })[0].status).toBe("failed");
  });

  it("shows a download that has no model behind it yet", () => {
    const catalogue = merge({
      downloadJobs: { j1: { jobId: "j1", modelName: "Nova", status: "downloading", progress: 40 } },
    });
    expect(catalogue).toHaveLength(1);
    expect(catalogue[0]).toMatchObject({ name: "Nova", status: "downloading", downloadProgress: 40 });
  });

  it("names an anonymous download rather than leaving a blank card", () => {
    expect(merge({ downloadJobs: { j1: {} } })[0].name).toBe("New Model");
  });

  it("overlays an in-flight download on the model it is replacing", () => {
    const catalogue = merge({
      localModels: local,
      downloadJobs: { j1: { modelId: "user/ariana", status: "extracting", progress: 70 } },
    });
    expect(catalogue).toHaveLength(1);
    expect(catalogue[0]).toMatchObject({ status: "extracting", downloadProgress: 70 });
  });

  it("lets a finished download leave the installed entry alone", () => {
    // The completed job carries a thinner copy of the model; overwriting with
    // it would drop the checkpoints the real entry has.
    const catalogue = merge({
      localModels: [{ ...local[0], checkpoints: [{ epochs: 100 }] }],
      downloadJobs: { j1: { modelId: "user/ariana", status: "completed" } },
    });
    expect(catalogue[0].checkpoints).toEqual([{ epochs: 100 }]);
    expect(catalogue[0].status).toBe("completed");
  });

  it("shows a running training run as training", () => {
    const catalogue = merge({
      trainingJobs: [{ id: "t1", model_name: "nova", status: "training", progress: 30 }],
    });
    expect(catalogue[0]).toMatchObject({
      status: "training",
      trainingJobId: "t1",
      trainingProgress: 30,
    });
  });

  it("hides a run that finished or was abandoned", () => {
    expect(merge({ trainingJobs: [{ id: "t1", model_name: "x", status: "completed" }] })).toEqual([]);
    expect(merge({ trainingJobs: [{ id: "t1", model_name: "x", status: "cancelled" }] })).toEqual([]);
  });

  it("calls an interrupted run failed rather than leaving it looking alive", () => {
    // "interrupted" means the backend restarted under it. A card still reading
    // "training" would spin for ever.
    const [card] = merge({ trainingJobs: [{ id: "t1", model_name: "x", status: "interrupted" }] });
    expect(card.status).toBe("failed");
    expect(card.trainingPhase).toBe("interrupted");
  });

  it("keeps the newest of two runs with the same name", () => {
    // A retry after an interrupted run collides on the same card; applying
    // oldest first leaves the newest state showing.
    const [card] = merge({
      trainingJobs: [
        { id: "new", model_name: "nova", started_at: 200, status: "training" },
        { id: "old", model_name: "nova", started_at: 100, status: "interrupted" },
      ],
    });
    expect(card.trainingJobId).toBe("new");
    expect(card.status).toBe("training");
  });

  it("keeps the checkpoints of the model a run is retraining", () => {
    const [card] = merge({
      localModels: [{ name: "nova", checkpoints: [{ epochs: 50 }] }],
      trainingJobs: [{ id: "t1", model_name: "nova", status: "training" }],
    });
    expect(card.checkpoints).toEqual([{ epochs: 50 }]);
  });

  it("sorts newest first", () => {
    const catalogue = merge({
      localModels: [
        { name: "old", created: "2020-01-01T00:00:00Z" },
        { name: "new", created: "2026-01-01T00:00:00Z" },
        { name: "mid", created: "2023-01-01T00:00:00Z" },
      ],
    });
    expect(catalogue.map((m) => m.name)).toEqual(["new", "mid", "old"]);
  });

  it("puts a model with no date last rather than dropping it", () => {
    const catalogue = merge({
      localModels: [{ name: "undated" }, { name: "dated", created: "2020-01-01T00:00:00Z" }],
    });
    expect(catalogue.map((m) => m.name)).toEqual(["dated", "undated"]);
  });

  it("stamps a training run with the time it started", () => {
    const [card] = merge({
      trainingJobs: [{ id: "t1", model_name: "nova", status: "training", started_at: 1700000000 }],
    });
    expect(card.created).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it("copes with all three sources being empty", () => {
    expect(merge()).toEqual([]);
  });

  it("does not mutate the training job list it is given", () => {
    const jobs = [
      { id: "b", model_name: "x", started_at: 200, status: "training" },
      { id: "a", model_name: "y", started_at: 100, status: "training" },
    ];
    merge({ trainingJobs: jobs });
    expect(jobs.map((j) => j.id)).toEqual(["b", "a"]);
  });
});

describe("filterModels", () => {
  const models = [
    { name: "progress_test", sourceName: "Ariana Grande" },
    { name: "nova_v2" },
  ];

  it("returns everything for an empty query", () => {
    expect(filterModels(models, "")).toBe(models);
    expect(filterModels(models, "   ")).toBe(models);
  });

  it("matches the name the user chose", () => {
    expect(filterModels(models, "nova")).toHaveLength(1);
  });

  it("matches the name it was published under", () => {
    // A model saved as "progress_test" is still findable by "ariana".
    expect(filterModels(models, "ariana")[0].name).toBe("progress_test");
  });

  it("treats a space as an underscore", () => {
    expect(filterModels([{ name: "nova_v2" }], "nova v2")).toHaveLength(1);
  });

  it("ignores case", () => {
    expect(filterModels(models, "NOVA")).toHaveLength(1);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterModels(models, "zzz")).toEqual([]);
  });
});

describe("getSelectableModels", () => {
  it("offers only what has finished", () => {
    const models = [
      { name: "a", status: "completed" },
      { name: "b", status: "training" },
      { name: "c", status: "downloading" },
      { name: "d", status: "failed" },
    ];
    expect(getSelectableModels(models).map((m) => m.name)).toEqual(["a"]);
  });
});

describe("track selection", () => {
  it("takes the first name a track answers to", () => {
    expect(getSelectionNames([
      { displayName: "Nice Name", name: "raw" },
      { originalName: "original.wav" },
      { id: "abc" },
    ])).toEqual(["Nice Name", "original.wav", "abc"]);
  });

  it("skips a track that names itself in no way at all", () => {
    expect(getSelectionNames([{}, { name: "ok" }])).toEqual(["ok"]);
  });

  it("lists up to three, then counts the rest", () => {
    expect(formatSelectionPreview(["a", "b", "c"])).toBe("a, b, c");
    expect(formatSelectionPreview(["a", "b", "c", "d", "e"])).toBe("a, b, c +2 more");
  });

  it("is empty for no selection", () => {
    expect(formatSelectionPreview([])).toBe("");
  });
});

describe("resolveBackTarget", () => {
  it("names the view that opened this one", () => {
    expect(resolveBackTarget("home")).toBe("home");
    expect(resolveBackTarget("inference")).toBe("inference");
  });

  it("has no route for anywhere else", () => {
    expect(resolveBackTarget("studio")).toBeNull();
    expect(resolveBackTarget(undefined)).toBeNull();
  });
});

describe("labels", () => {
  it("titles and de-punctuates a model name", () => {
    expect(normaliseModelName("ariana_grande")).toBe("Ariana grande");
  });

  it("survives an empty name", () => {
    expect(normaliseModelName("")).toBe("");
    expect(normaliseModelName(null)).toBe("");
  });

  it("shortens a sample rate", () => {
    expect(formatSampleRate(48000)).toBe("48k");
    expect(formatSampleRate(900)).toBe("900 Hz");
    expect(formatSampleRate(null)).toBe("—");
    expect(formatSampleRate(0)).toBe("—");
  });

  it("names the download phase, never 'training'", () => {
    // Installing a community model is fetch → unzip → install; calling any of
    // it training would be a lie about what the machine is doing.
    expect(describeDownload("extracting", 40)).toBe("Extracting 40%");
    expect(describeDownload("installing")).toBe("Installing");
    expect(describeDownload("who-knows")).toBe("Downloading");
  });

  it("names the training phase", () => {
    expect(describeTraining("indexing", 90)).toBe("Building index 90%");
    expect(describeTraining(undefined)).toBe("Training");
  });

  it("shows a percent of zero rather than hiding it", () => {
    expect(describeDownload("downloading", 0)).toBe("Downloading 0%");
  });
});

describe("getCardGradient", () => {
  it("cycles through the palette", () => {
    expect(getCardGradient(0)).toBe(CARD_GRADIENTS[0]);
    expect(getCardGradient(CARD_GRADIENTS.length)).toBe(CARD_GRADIENTS[0]);
    expect(getCardGradient(CARD_GRADIENTS.length + 2)).toBe(CARD_GRADIENTS[2]);
  });
});
