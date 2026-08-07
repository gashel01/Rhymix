import {
  HASH_VIEWS,
  buildCoverSourceSong,
  buildNavContext,
  createSongHash,
  getTrackId,
  nextNavigationUrl,
  parseCreateSongQuery,
  readHashRoute,
  readStudioRoute,
  toCoverSourceId,
} from "./appRoutes";

describe("readHashRoute", () => {
  it("reads a plain view", () => {
    expect(readHashRoute("#inference")).toEqual({ view: "inference", query: null });
  });

  it("does not care whether the hash carries its #", () => {
    expect(readHashRoute("models")).toEqual(readHashRoute("#models"));
  });

  it("splits the query off", () => {
    expect(readHashRoute("#create-song?mode=cover&sourceSongId=upload:7")).toEqual({
      view: "create-song",
      query: "mode=cover&sourceSongId=upload:7",
    });
  });

  it("treats home and nothing as the same", () => {
    expect(readHashRoute("")).toBeNull();
    expect(readHashRoute("#")).toBeNull();
    expect(readHashRoute("#home")).toBeNull();
  });

  it("refuses a view it cannot restore", () => {
    // Returning the view anyway would land on a blank screen after a reload.
    expect(readHashRoute("#nonsense")).toBeNull();
    expect(readHashRoute("#studio")).toBeNull();
  });

  it("every listed view round-trips", () => {
    HASH_VIEWS.forEach((view) => {
      expect(readHashRoute(`#${view}`)).toEqual({ view, query: null });
    });
  });
});

describe("parseCreateSongQuery", () => {
  it("reads the cover mode and its source", () => {
    expect(parseCreateSongQuery("mode=cover&sourceSongId=upload:7")).toEqual({
      mode: "cover",
      sourceSongId: "upload:7",
      sourceSong: null,
    });
  });

  it("is create mode unless the query says cover", () => {
    expect(parseCreateSongQuery("mode=remix").mode).toBe("create");
    expect(parseCreateSongQuery("").mode).toBe("create");
    expect(parseCreateSongQuery(null).mode).toBe("create");
  });

  it("round-trips the hash it writes", () => {
    const hash = createSongHash("run:12/34");
    const route = readHashRoute(hash);
    expect(parseCreateSongQuery(route.query)).toMatchObject({
      mode: "cover",
      sourceSongId: "run:12/34",
    });
  });
});

describe("readStudioRoute", () => {
  it("opens the studio with no asset", () => {
    expect(readStudioRoute({ pathname: "/studio" }))
      .toEqual({ assetId: null, projectId: null, sourceFileId: null });
    expect(readStudioRoute({ pathname: "/studio/" }).assetId).toBeNull();
  });

  it("reads the asset out of the path", () => {
    expect(readStudioRoute({ pathname: "/studio/abc123" }).assetId).toBe("abc123");
  });

  it("decodes an asset id that had to be escaped", () => {
    expect(readStudioRoute({ pathname: "/studio/vocal%3A7" }).assetId).toBe("vocal:7");
  });

  it("picks up the project and source from the query", () => {
    expect(readStudioRoute({ pathname: "/studio", search: "?projectId=p1&sourceFileId=f2" }))
      .toEqual({ assetId: null, projectId: "p1", sourceFileId: "f2" });
  });

  it("keeps the query when the path also names an asset", () => {
    expect(readStudioRoute({ pathname: "/studio/a1", search: "?projectId=p1" }))
      .toEqual({ assetId: "a1", projectId: "p1", sourceFileId: null });
  });

  it("is null for any other path", () => {
    expect(readStudioRoute({ pathname: "/" })).toBeNull();
    expect(readStudioRoute({ pathname: "/studios/x" })).toBeNull();
    expect(readStudioRoute({})).toBeNull();
    expect(readStudioRoute()).toBeNull();
  });
});

describe("nextNavigationUrl", () => {
  it("hangs the view off the current path", () => {
    expect(nextNavigationUrl("models", { pathname: "/", hash: "" })).toBe("/#models");
  });

  it("keeps the query string", () => {
    expect(nextNavigationUrl("models", { pathname: "/", search: "?a=1", hash: "" }))
      .toBe("/?a=1#models");
  });

  it("returns null when the URL would not change", () => {
    // Re-clicking the current nav item must not stack a duplicate history
    // entry — Back would then need as many presses as the user made clicks.
    expect(nextNavigationUrl("models", { pathname: "/", hash: "#models" })).toBeNull();
  });

  it("drops the hash going home", () => {
    expect(nextNavigationUrl("home", { pathname: "/", hash: "#models" })).toBe("/");
  });

  it("drops the query going home too", () => {
    // The query belongs to whatever view set it; carrying it to Home would
    // reopen the studio's project on the next reload.
    expect(nextNavigationUrl("home", { pathname: "/", search: "?projectId=p1", hash: "#models" }))
      .toBe("/");
  });

  it("returns null when already home with a bare path", () => {
    expect(nextNavigationUrl("home", { pathname: "/", search: "", hash: "" })).toBeNull();
  });
});

describe("toCoverSourceId", () => {
  it("prefixes by where the audio lives", () => {
    // An upload and an inference run can share a numeric id, and the backend
    // looks the two up in different places.
    expect(toCoverSourceId({ runId: 7 }, "inference")).toBe("run:7");
    expect(toCoverSourceId({ fileId: 7 }, "home")).toBe("upload:7");
  });

  it("prefers a run id over a file id when coming from inference", () => {
    expect(toCoverSourceId({ runId: 7, fileId: 9 }, "inference")).toBe("run:7");
  });

  it("falls back to the plain id, prefixed by the source", () => {
    expect(toCoverSourceId({ id: 3 }, "inference")).toBe("run:3");
    expect(toCoverSourceId({ id: 3 }, "home")).toBe("upload:3");
  });

  it("has no id for a track that carries none", () => {
    expect(toCoverSourceId({}, "home")).toBeNull();
    expect(toCoverSourceId(null, "home")).toBeNull();
    expect(toCoverSourceId("string", "home")).toBeNull();
  });
});

describe("buildCoverSourceSong", () => {
  it("names the song from whichever field the track has", () => {
    expect(buildCoverSourceSong({ fileId: 1, displayName: "Nice" }, "home").title).toBe("Nice");
    expect(buildCoverSourceSong({ fileId: 1, originalName: "raw.wav" }, "home").title).toBe("raw.wav");
  });

  it("has a title even when the track has no name at all", () => {
    expect(buildCoverSourceSong({ fileId: 1 }, "home").title).toBe("Untitled source");
  });

  it("takes any audio it can find for the main url", () => {
    expect(buildCoverSourceSong({ fileId: 1, instrumentalUrl: "/i.wav" }, "home").audioUrl)
      .toBe("/i.wav");
  });

  it("accepts both spellings of the vocal url", () => {
    expect(buildCoverSourceSong({ fileId: 1, vocalUrl: "/v.wav" }, "home").vocalsUrl).toBe("/v.wav");
    expect(buildCoverSourceSong({ fileId: 1, originalVocalUrl: "/o.wav" }, "home").vocalsUrl)
      .toBe("/o.wav");
  });

  it("remembers where it came from", () => {
    expect(buildCoverSourceSong({ fileId: 1 }, "inference").source).toBe("inference");
  });

  it("is null for a track it cannot identify", () => {
    expect(buildCoverSourceSong({}, "home")).toBeNull();
  });
});

describe("getTrackId", () => {
  it("takes whichever id the producing view uses", () => {
    expect(getTrackId({ fileId: "f" })).toBe("f");
    expect(getTrackId({ runId: "r" })).toBe("r");
    expect(getTrackId({ tempId: "t" })).toBe("t");
  });

  it("prefers the most specific one", () => {
    expect(getTrackId({ fileId: "f", id: "i", runId: "r" })).toBe("f");
  });

  it("is null for a track with no id", () => {
    expect(getTrackId({})).toBeNull();
    expect(getTrackId(null)).toBeNull();
  });
});

describe("buildNavContext", () => {
  it("keeps ids, not the track objects", () => {
    // The context outlives the list the tracks came from; holding the objects
    // would pin a stale copy.
    const context = buildNavContext({
      source: "home",
      selectedTracks: [{ fileId: "a" }, { fileId: "b" }],
    });
    expect(context).toEqual({
      source: "home",
      selectedTrackIds: ["a", "b"],
      selectedModelId: null,
      selectedModelName: null,
    });
  });

  it("drops duplicates", () => {
    const tracks = [{ fileId: "a" }, { fileId: "a" }, { fileId: "b" }];
    expect(buildNavContext({ source: "home", selectedTracks: tracks }).selectedTrackIds)
      .toEqual(["a", "b"]);
  });

  it("skips a track with no id rather than storing a null", () => {
    expect(buildNavContext({ source: "home", selectedTracks: [{}, { id: "a" }] }).selectedTrackIds)
      .toEqual(["a"]);
  });

  it("accepts either naming convention for the model", () => {
    expect(buildNavContext({ source: "home", selectedModel: { id: "m", name: "Nova" } }))
      .toMatchObject({ selectedModelId: "m", selectedModelName: "Nova" });
    expect(buildNavContext({ source: "home", selectedModel: { modelId: "m", modelName: "Nova" } }))
      .toMatchObject({ selectedModelId: "m", selectedModelName: "Nova" });
  });

  it("copes with no selection at all", () => {
    expect(buildNavContext({ source: "home" }).selectedTrackIds).toEqual([]);
    expect(buildNavContext({ source: "home", selectedTracks: null }).selectedTrackIds).toEqual([]);
  });
});
