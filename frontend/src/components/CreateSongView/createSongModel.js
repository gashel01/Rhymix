/**
 * CreateSongView, minus the rendering.
 *
 * The view is 1,263 lines with 65 useState calls. Buried in it are the
 * decisions that actually matter: what gets posted to the generator, when the
 * Generate button is allowed to fire, and how a backend job becomes a song in
 * the list. Written as closures over state, none of them could be called from
 * a test — so the payload shape, which the backend depends on, was checked
 * only by running a generation on a GPU.
 *
 * Every function here is pure and takes its inputs explicitly.
 */

import { getBestAssetKey } from "./constants";

/* Three engines, three behaviours. `caption` lets the user hand-write the
   caption the model conditions on; `llm` runs the language model to produce
   codes; `fast` skips it. */
export const describeEngine = (promptEngine) => ({
  isCaptionEngine: promptEngine === "caption",
  useLmCodes: promptEngine === "llm",
  initializeLm: promptEngine === "llm",
  label:
    promptEngine === "fast"
      ? "Standard"
      : promptEngine === "caption"
        ? "Direct caption"
        : "Quality",
});

/* The backend reports a missing Python package as prose. Pulling the package
   list and the pip line out of it is what lets the view offer a copyable
   install command instead of a wall of text. */
export const extractMissingDeps = (msg) => {
  if (!msg) return null;
  const missingMatch = msg.match(/Missing packages:\s*([^\n.]+)/i);
  const pipMatch = msg.match(/pip install [^\n]+/i);
  if (!missingMatch && !pipMatch) return null;
  const packages = missingMatch
    ? missingMatch[1].split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  return { packages, pip: pipMatch ? pipMatch[0] : "" };
};

export const mapJobToSong = (job) => {
  const hasAssets = job && typeof job.assets === "object" && job.assets !== null;
  const params = job?.params || {};
  const paramsGenres = Array.isArray(params.genres) ? params.genres.filter(Boolean) : [];
  // Jobs from before genres were a field of their own carry them inside the
  // prompt, on a "Genres: a, b" line. Recover them so old songs still show
  // their tags.
  let promptGenres = [];
  if (!paramsGenres.length && typeof params.prompt === "string") {
    const line = params.prompt.split("\n").find((l) => l.trim().toLowerCase().startsWith("genres:"));
    if (line) {
      promptGenres = line
        .split(":")
        .slice(1)
        .join(":")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  const genres = paramsGenres.length ? paramsGenres : promptGenres;
  const personaName = job?.model_name || params?.model_name || null;
  const enhanceVocals = params?.enhance_vocals ?? job?.enhance_vocals ?? null;
  return {
    id: job.id,
    title: job.title || "Untitled",
    duration: 0,
    genres,
    createdAt: job.created_at || job.createdAt,
    audioUrl: job.audio_url,
    vocalsUrl: job.vocals_url,
    instrumentalUrl: job.instrumental_url,
    processed: job.processed,
    inferenceCompleted: job.inference_completed,
    modelName: job.model_name,
    personaName,
    enhanceVocals,
    status: job.status,
    progress: job.progress,
    assets: hasAssets ? job.assets : undefined,
    hasAssets,
    selectedAssetKey: hasAssets ? getBestAssetKey(job.assets) : null,
    request: job.params || null,
    derivationType: job.derivation_type || job.derivationType || null,
    sourceSongId: job.source_song_id || job.sourceSongId || null,
    sourceTitle: job.source_title || job.sourceTitle || null,
    autoFull: true,
  };
};

export const buildPrompt = ({ mode, describePrompt = "", genreTokens = [], instrumentalOnly }) => {
  const bits = [];
  if (mode === "prompt" && describePrompt.trim()) bits.push(describePrompt.trim());
  if (mode !== "prompt" && genreTokens.length) bits.push(`Genres: ${genreTokens.join(", ")}`);
  if (instrumentalOnly) bits.push("Instrumental only, no vocals");
  return bits.join("\n");
};

export const buildCaptionInput = (form) => {
  const basePrompt = buildPrompt(form);
  const { isCaptionEngine } = describeEngine(form.promptEngine);
  if (!isCaptionEngine) return basePrompt;
  const caption = String(form.captionOverride || "").trim();
  return caption || basePrompt;
};

export const buildInferParams = (form) => {
  const {
    title = "",
    duration,
    autoDuration,
    enhanceVocals,
    genreTokens = [],
    lyrics = "",
    instrumentalOnly,
    promptEngine,
    useNegativePrompt,
    negativePrompt = "",
    selectedModel,
    selectedCheckpoint,
    mainModelPath,
    lmModelPath,
    device,
    lmBackend,
    useFlashAttention,
    offloadToCpu,
    offloadDitToCpu,
    compileModel,
    int8Quantization,
    bpm,
    keyscale = "",
    timeSignature = "",
    ditInferenceSteps,
    shift,
  } = form;

  const { isCaptionEngine, useLmCodes, initializeLm } = describeEngine(promptEngine);

  // A model is only usable with a checkpoint chosen; half a selection would
  // make the backend guess.
  let modelForInference = null;
  if (selectedModel && selectedCheckpoint) {
    modelForInference = {
      name: selectedModel.name,
      selectedCheckpoint,
      indexPath: selectedModel.indexPath,
      checkpoints: selectedModel.checkpoints,
    };
  }

  const captionInput = buildCaptionInput(form);
  const durationValue = autoDuration ? null : duration;
  const out = {
    title: title.trim(),
    audio_duration: durationValue,
    duration: durationValue,
    auto_duration: autoDuration,
    enhance_vocals: enhanceVocals,
    prompt: buildPrompt(form),
    genres: [...genreTokens],
    lyrics: instrumentalOnly ? "" : lyrics,
    caption_override: isCaptionEngine ? (captionInput || null) : null,
    prompt_engine: promptEngine,
    thinking: useLmCodes,
    // The generator expects this sentinel, not an empty string, when there is
    // nothing to steer away from.
    lm_negative_prompt: useNegativePrompt ? (negativePrompt.trim() || "NO USER INPUT") : "NO USER INPUT",
    model_name: selectedModel?.name || null,
    model: modelForInference,
    main_model_path: mainModelPath,
    lm_model_path: lmModelPath,
    device,
    lm_backend: lmBackend,
    initialize_lm: initializeLm,
    use_flash_attention: useFlashAttention,
    offload_to_cpu: offloadToCpu,
    offload_dit_to_cpu: offloadDitToCpu,
    compile_model: compileModel,
    int8_quantization: int8Quantization,
  };
  // Omitted rather than sent as null: the generator picks its own value for
  // each of these, and an explicit null would override that with nothing.
  if (String(bpm ?? "").trim()) out.bpm = Number(bpm);
  if (keyscale.trim()) out.keyscale = keyscale.trim();
  if (timeSignature.trim()) out.timesignature = timeSignature.trim();
  if (String(ditInferenceSteps ?? "").trim()) out.dit_inference_steps = Number(ditInferenceSteps);
  if (String(shift ?? "").trim()) out.shift = Number(shift);
  return out;
};

export const buildCoverParams = ({
  title = "",
  effectiveSourceSongId,
  coverSelectedModel,
  coverPitchShift,
  coverStylePrompt = "",
  coverLyrics = "",
  coverLyricsMode,
  coverPreserveTempo,
  coverOutputFormat,
  coverStrength,
}) => ({
  title: title.trim(),
  source_song_id: effectiveSourceSongId,
  target_voice: coverSelectedModel?.name || null,
  pitch_shift: Number.isFinite(Number(coverPitchShift)) ? Number(coverPitchShift) : 0,
  style_prompt: coverStylePrompt.trim() || null,
  lyrics: coverLyricsMode === "lyrics" ? (coverLyrics.trim() || null) : null,
  cover_mode: "full",
  preserve_tempo: !!coverPreserveTempo,
  output_format: coverOutputFormat || "wav",
  audio_cover_strength: coverStrength,
});

/**
 * Why Generate is enabled — or, more usefully, why it is not.
 *
 * Returned as an object rather than a boolean so the view can say which input
 * is still missing instead of leaving a dead button on screen.
 */
export const resolveGenerateGate = ({
  flowMode,
  generating,
  title = "",
  mode,
  promptEngine,
  describePrompt = "",
  genreText = "",
  lyrics = "",
  captionOverride = "",
  instrumentalOnly,
  sourceSong,
  effectiveSourceSongId,
  loadingSourceSong,
  sourceSongError,
}) => {
  const { isCaptionEngine } = describeEngine(promptEngine);

  const hasLyricsInput = instrumentalOnly || lyrics.trim().length > 0;
  const hasDescribeInput = describePrompt.trim().length > 0;
  const hasGenreInput = genreText.trim().length > 0;
  const hasCaptionInput = mode === "lyrics" && captionOverride.trim().length > 0;
  const hasBasePrompt = mode === "prompt" ? hasDescribeInput : (hasGenreInput || hasLyricsInput);
  const hasPromptOrCaption = isCaptionEngine ? (hasCaptionInput || hasBasePrompt) : hasBasePrompt;
  const hasCoverSourceAudio = Boolean(
    sourceSong?.audioUrl || sourceSong?.instrumentalUrl || sourceSong?.vocalsUrl
  );

  const canGenerateCreate =
    !generating &&
    title.trim().length > 0 &&
    (mode === "prompt" ? hasPromptOrCaption : hasPromptOrCaption && hasLyricsInput);

  const canGenerateCover =
    !generating &&
    title.trim().length > 0 &&
    !!effectiveSourceSongId &&
    hasCoverSourceAudio &&
    !loadingSourceSong &&
    !sourceSongError;

  return {
    hasLyricsInput,
    hasDescribeInput,
    hasGenreInput,
    hasCaptionInput,
    hasBasePrompt,
    hasPromptOrCaption,
    hasCoverSourceAudio,
    canGenerateCreate,
    canGenerateCover,
    canGenerate: flowMode === "cover" ? canGenerateCover : canGenerateCreate,
  };
};
