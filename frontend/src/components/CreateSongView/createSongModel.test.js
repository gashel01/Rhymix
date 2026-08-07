import {
  buildCoverParams,
  buildInferParams,
  buildPrompt,
  buildCaptionInput,
  describeEngine,
  extractMissingDeps,
  mapJobToSong,
  resolveGenerateGate,
} from "./createSongModel";

/* A form the way the view holds it, filled in enough to generate. Each test
   overrides only the fields it is about. */
const form = (over = {}) => ({
  mode: "prompt",
  title: "  My Song  ",
  describePrompt: "a warm ballad",
  genreTokens: ["Lo-fi", "Ambient"],
  lyrics: "line one",
  instrumentalOnly: false,
  promptEngine: "llm",
  captionOverride: "",
  duration: 180,
  autoDuration: false,
  enhanceVocals: true,
  useNegativePrompt: false,
  negativePrompt: "",
  selectedModel: null,
  selectedCheckpoint: null,
  mainModelPath: "acestep-v15-turbo",
  lmModelPath: "acestep-5Hz-lm-0.6B",
  device: "auto",
  lmBackend: "vllm",
  useFlashAttention: true,
  offloadToCpu: true,
  offloadDitToCpu: true,
  compileModel: true,
  int8Quantization: true,
  bpm: "",
  keyscale: "",
  timeSignature: "",
  ditInferenceSteps: "",
  shift: "",
  ...over,
});

describe("describeEngine", () => {
  it("runs the language model only for llm", () => {
    expect(describeEngine("llm")).toMatchObject({ useLmCodes: true, initializeLm: true });
    expect(describeEngine("fast")).toMatchObject({ useLmCodes: false, initializeLm: false });
    expect(describeEngine("caption")).toMatchObject({ useLmCodes: false, initializeLm: false });
  });

  it("names each engine for the user", () => {
    expect(describeEngine("fast").label).toBe("Standard");
    expect(describeEngine("caption").label).toBe("Direct caption");
    expect(describeEngine("llm").label).toBe("Quality");
  });

  it("treats an unset engine as the quality one", () => {
    expect(describeEngine(undefined).label).toBe("Quality");
  });
});

describe("buildPrompt", () => {
  it("uses the description in prompt mode and ignores the genres", () => {
    expect(buildPrompt(form())).toBe("a warm ballad");
  });

  it("uses the genres in lyrics mode and ignores the description", () => {
    expect(buildPrompt(form({ mode: "lyrics" }))).toBe("Genres: Lo-fi, Ambient");
  });

  it("appends the instrumental instruction on its own line", () => {
    expect(buildPrompt(form({ instrumentalOnly: true })))
      .toBe("a warm ballad\nInstrumental only, no vocals");
  });

  it("is empty when the user has typed nothing", () => {
    expect(buildPrompt(form({ describePrompt: "   " }))).toBe("");
  });
});

describe("buildCaptionInput", () => {
  it("ignores the caption field unless the caption engine is on", () => {
    expect(buildCaptionInput(form({ captionOverride: "hand written" }))).toBe("a warm ballad");
  });

  it("prefers the hand-written caption when it is on", () => {
    expect(buildCaptionInput(form({ promptEngine: "caption", captionOverride: "hand written" })))
      .toBe("hand written");
  });

  it("falls back to the built prompt when the caption is blank", () => {
    expect(buildCaptionInput(form({ promptEngine: "caption", captionOverride: "  " })))
      .toBe("a warm ballad");
  });
});

describe("buildInferParams", () => {
  it("trims the title", () => {
    expect(buildInferParams(form()).title).toBe("My Song");
  });

  it("sends null duration when the length is automatic", () => {
    const p = buildInferParams(form({ autoDuration: true }));
    expect(p.duration).toBeNull();
    expect(p.audio_duration).toBeNull();
    expect(p.auto_duration).toBe(true);
  });

  it("sends both duration fields when the length is fixed", () => {
    const p = buildInferParams(form({ duration: 90 }));
    expect(p.duration).toBe(90);
    expect(p.audio_duration).toBe(90);
  });

  it("drops the lyrics for an instrumental instead of sending them unused", () => {
    expect(buildInferParams(form({ instrumentalOnly: true })).lyrics).toBe("");
  });

  it("copies the genre list rather than sharing it", () => {
    const f = form();
    const p = buildInferParams(f);
    p.genres.push("mutated");
    expect(f.genreTokens).toEqual(["Lo-fi", "Ambient"]);
  });

  it("sends the sentinel, not an empty string, when there is no negative prompt", () => {
    // The generator matches on this exact string; "" would be treated as a
    // real instruction to avoid nothing.
    expect(buildInferParams(form()).lm_negative_prompt).toBe("NO USER INPUT");
    expect(buildInferParams(form({ useNegativePrompt: true, negativePrompt: "  " })).lm_negative_prompt)
      .toBe("NO USER INPUT");
    expect(buildInferParams(form({ useNegativePrompt: true, negativePrompt: " harsh " })).lm_negative_prompt)
      .toBe("harsh");
  });

  it("sends no caption override unless the caption engine is on", () => {
    expect(buildInferParams(form({ captionOverride: "x" })).caption_override).toBeNull();
    expect(buildInferParams(form({ promptEngine: "caption", captionOverride: "x" })).caption_override)
      .toBe("x");
  });

  it("only sends a model when a checkpoint goes with it", () => {
    const model = { name: "Nova", indexPath: "/i", checkpoints: [{ epochs: 40 }] };
    expect(buildInferParams(form({ selectedModel: model })).model).toBeNull();
    const withCkpt = buildInferParams(form({ selectedModel: model, selectedCheckpoint: { epochs: 40 } }));
    expect(withCkpt.model).toMatchObject({ name: "Nova", indexPath: "/i" });
  });

  it("still names the model even when no checkpoint is chosen", () => {
    expect(buildInferParams(form({ selectedModel: { name: "Nova" } })).model_name).toBe("Nova");
  });

  it("omits the musical fields left blank rather than sending nulls", () => {
    const p = buildInferParams(form());
    ["bpm", "keyscale", "timesignature", "dit_inference_steps", "shift"].forEach((key) => {
      expect(p).not.toHaveProperty(key);
    });
  });

  it("sends the musical fields as numbers once filled in", () => {
    const p = buildInferParams(form({
      bpm: "128",
      keyscale: " C minor ",
      timeSignature: " 4/4 ",
      ditInferenceSteps: "30",
      shift: "3",
    }));
    expect(p.bpm).toBe(128);
    expect(p.keyscale).toBe("C minor");
    expect(p.timesignature).toBe("4/4");
    expect(p.dit_inference_steps).toBe(30);
    expect(p.shift).toBe(3);
  });

  it("keeps a bpm of 0 out of the payload but sends one the user typed", () => {
    // bpm arrives as a string from the input; String(0).trim() is truthy, so 0
    // is a value the user typed and not the empty case.
    expect(buildInferParams(form({ bpm: "0" })).bpm).toBe(0);
    expect(buildInferParams(form({ bpm: undefined }))).not.toHaveProperty("bpm");
  });

  it("follows the engine for the language-model flags", () => {
    expect(buildInferParams(form({ promptEngine: "llm" }))).toMatchObject({
      thinking: true,
      initialize_lm: true,
    });
    expect(buildInferParams(form({ promptEngine: "fast" }))).toMatchObject({
      thinking: false,
      initialize_lm: false,
    });
  });
});

describe("buildCoverParams", () => {
  const cover = (over = {}) => buildCoverParams({
    title: " Cover ",
    effectiveSourceSongId: "song-1",
    coverSelectedModel: { name: "Nova" },
    coverPitchShift: "-2",
    coverStylePrompt: " bright ",
    coverLyrics: " la la ",
    coverLyricsMode: "lyrics",
    coverPreserveTempo: true,
    coverOutputFormat: "wav",
    coverStrength: 0.8,
    ...over,
  });

  it("carries the source, the voice and the strength", () => {
    expect(cover()).toMatchObject({
      title: "Cover",
      source_song_id: "song-1",
      target_voice: "Nova",
      audio_cover_strength: 0.8,
      cover_mode: "full",
    });
  });

  it("reads the pitch shift as a number and falls back to none", () => {
    expect(cover().pitch_shift).toBe(-2);
    expect(cover({ coverPitchShift: "" }).pitch_shift).toBe(0);
    expect(cover({ coverPitchShift: "nonsense" }).pitch_shift).toBe(0);
  });

  it("sends no lyrics when the user chose to keep the original", () => {
    expect(cover({ coverLyricsMode: "keep" }).lyrics).toBeNull();
    expect(cover().lyrics).toBe("la la");
  });

  it("sends null, not an empty string, for a blank style prompt", () => {
    expect(cover({ coverStylePrompt: "   " }).style_prompt).toBeNull();
  });

  it("defaults the output format", () => {
    expect(cover({ coverOutputFormat: "" }).output_format).toBe("wav");
  });
});

describe("extractMissingDeps", () => {
  it("returns nothing for an unrelated error", () => {
    expect(extractMissingDeps("Something went wrong")).toBeNull();
    expect(extractMissingDeps("")).toBeNull();
  });

  it("pulls out the package list", () => {
    const parsed = extractMissingDeps("Missing packages: torch, torchaudio. Install them first.");
    expect(parsed.packages).toEqual(["torch", "torchaudio"]);
  });

  it("pulls out the pip line so it can be copied", () => {
    const parsed = extractMissingDeps("pip install torch torchaudio");
    expect(parsed.pip).toBe("pip install torch torchaudio");
    expect(parsed.packages).toEqual([]);
  });

  it("takes both when both are there", () => {
    const parsed = extractMissingDeps("Missing packages: torch.\npip install torch");
    expect(parsed.packages).toEqual(["torch"]);
    expect(parsed.pip).toBe("pip install torch");
  });
});

describe("mapJobToSong", () => {
  it("names an untitled job", () => {
    expect(mapJobToSong({ id: "1" }).title).toBe("Untitled");
  });

  it("takes the genres from the params when they are there", () => {
    expect(mapJobToSong({ id: "1", params: { genres: ["Trap", "", "Lo-fi"] } }).genres)
      .toEqual(["Trap", "Lo-fi"]);
  });

  it("recovers the genres of a job made before they were a field", () => {
    const job = { id: "1", params: { prompt: "a warm ballad\nGenres: Trap, Lo-fi" } };
    expect(mapJobToSong(job).genres).toEqual(["Trap", "Lo-fi"]);
  });

  it("keeps a colon inside a genre name", () => {
    const job = { id: "1", params: { prompt: "Genres: Drum: Bass, Lo-fi" } };
    expect(mapJobToSong(job).genres).toEqual(["Drum: Bass", "Lo-fi"]);
  });

  it("has no genres when neither source has any", () => {
    expect(mapJobToSong({ id: "1", params: { prompt: "no genre line" } }).genres).toEqual([]);
  });

  it("accepts both naming conventions the backend uses", () => {
    expect(mapJobToSong({ id: "1", created_at: "A" }).createdAt).toBe("A");
    expect(mapJobToSong({ id: "1", createdAt: "B" }).createdAt).toBe("B");
    expect(mapJobToSong({ id: "1", derivation_type: "cover" }).derivationType).toBe("cover");
    expect(mapJobToSong({ id: "1", derivationType: "cover" }).derivationType).toBe("cover");
  });

  it("reports no assets rather than an empty object when the job has none", () => {
    const song = mapJobToSong({ id: "1" });
    expect(song.hasAssets).toBe(false);
    expect(song.assets).toBeUndefined();
    expect(song.selectedAssetKey).toBeNull();
  });

  it("preselects the best ready asset", () => {
    const job = { id: "1", assets: { full_mix: { ready: true }, vocals_raw: { ready: true } } };
    expect(mapJobToSong(job).selectedAssetKey).toBe("full_mix");
  });

  it("preselects nothing while every asset is still rendering", () => {
    const job = { id: "1", assets: { full_mix: { ready: false } } };
    expect(mapJobToSong(job).hasAssets).toBe(true);
    expect(mapJobToSong(job).selectedAssetKey).toBeNull();
  });

  it("distinguishes 'enhancement off' from 'the job never said'", () => {
    expect(mapJobToSong({ id: "1", params: { enhance_vocals: false } }).enhanceVocals).toBe(false);
    expect(mapJobToSong({ id: "1" }).enhanceVocals).toBeNull();
  });
});

describe("resolveGenerateGate", () => {
  const gate = (over = {}) => resolveGenerateGate({
    flowMode: "create",
    generating: false,
    title: "My Song",
    mode: "prompt",
    promptEngine: "llm",
    describePrompt: "a warm ballad",
    genreText: "",
    lyrics: "",
    captionOverride: "",
    instrumentalOnly: false,
    sourceSong: null,
    effectiveSourceSongId: null,
    loadingSourceSong: false,
    sourceSongError: null,
    ...over,
  });

  it("allows a described song", () => {
    expect(gate().canGenerate).toBe(true);
  });

  it("needs a title", () => {
    expect(gate({ title: "   " }).canGenerate).toBe(false);
  });

  it("needs a description in prompt mode", () => {
    expect(gate({ describePrompt: "" }).canGenerate).toBe(false);
  });

  it("refuses while a generation is already running", () => {
    expect(gate({ generating: true }).canGenerate).toBe(false);
  });

  it("needs both a prompt and lyrics in lyrics mode", () => {
    expect(gate({ mode: "lyrics", genreText: "trap" }).canGenerate).toBe(false);
    expect(gate({ mode: "lyrics", genreText: "trap", lyrics: "line" }).canGenerate).toBe(true);
  });

  it("counts an instrumental as having its lyrics settled", () => {
    expect(gate({ mode: "lyrics", genreText: "trap", instrumentalOnly: true }).canGenerate).toBe(true);
  });

  it("never lets the caption alone unlock Generate", () => {
    // hasCaptionInput only exists in lyrics mode, and lyrics mode already
    // requires lyrics — which by itself satisfies hasBasePrompt. So the
    // caption branch cannot change the answer either way. Pinned as it is
    // rather than changed: loosening it would let a caption-only submit
    // through, which the backend has never been asked to handle.
    const withCaption = gate({ mode: "lyrics", promptEngine: "caption", captionOverride: "a caption" });
    expect(withCaption.hasCaptionInput).toBe(true);
    expect(withCaption.canGenerate).toBe(false);

    ["caption", "llm"].forEach((promptEngine) => {
      expect(gate({ mode: "lyrics", promptEngine, captionOverride: "a caption", lyrics: "line" }).canGenerate)
        .toBe(true);
    });
  });

  describe("cover", () => {
    const source = { audioUrl: "/a.wav" };
    const coverGate = (over = {}) =>
      gate({ flowMode: "cover", effectiveSourceSongId: "song-1", sourceSong: source, ...over });

    it("allows a cover once the source has audio", () => {
      expect(coverGate().canGenerate).toBe(true);
    });

    it("accepts a source that has only stems", () => {
      expect(coverGate({ sourceSong: { instrumentalUrl: "/i.wav" } }).hasCoverSourceAudio).toBe(true);
      expect(coverGate({ sourceSong: { vocalsUrl: "/v.wav" } }).hasCoverSourceAudio).toBe(true);
    });

    it("refuses a source with no audio at all", () => {
      expect(coverGate({ sourceSong: { title: "x" } }).canGenerate).toBe(false);
    });

    it("waits for the source to finish loading", () => {
      expect(coverGate({ loadingSourceSong: true }).canGenerate).toBe(false);
    });

    it("refuses when the source failed to load", () => {
      expect(coverGate({ sourceSongError: "404" }).canGenerate).toBe(false);
    });

    it("does not need a prompt — the source is the input", () => {
      expect(coverGate({ describePrompt: "" }).canGenerate).toBe(true);
    });
  });
});
