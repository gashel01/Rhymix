/**
 * Inference, minus the rendering.
 *
 * The parameter panel is 1,030 lines of sliders over a payload the backend
 * takes literally: which checkpoint to load, which audio to convert, and
 * fifty knobs that reach Applio unchanged. The decisions among all that were
 * written inline, so the two that actually change what gets converted — which
 * checkpoint wins, and whether sourceRunId survives — could only be checked
 * by running a conversion.
 */

export const DEFAULT_PARAMS = {
  // Core
  pitch: 0, // semitones
  indexRate: 0.75,
  protectVoiced: 0.5,
  f0Method: "rmvpe",

  // Audio processing (toggles)
  splitAudio: false,
  autotune: false,
  autotuneStrength: 1.0,
  proposedPitch: false,
  proposedPitchThreshold: 155.0,
  cleanAudio: false,
  cleanStrength: 0.5,
  exportFormat: "WAV",

  // Volume envelope: UI as boolean, convert to numeric if needed
  volumeEnvelopeEnabled: true,

  // Formant shifting
  formantShifting: false,
  formantPreset: "none",
  formantQfrency: 1.0,
  formantTimbre: 1.0,

  // Post-processing
  postProcess: false,
  reverb: false,
  reverbRoomSize: 0.5,
  reverbDamping: 0.5,
  reverbWetGain: 0.33,
  reverbDryGain: 0.4,
  reverbWidth: 1.0,
  reverbFreezeMode: 0.0,

  pitchShift: false,
  pitchShiftSemitones: 0.0,

  limiter: false,
  limiterThreshold: -6.0,
  limiterReleaseTime: 0.05,

  gain: false,
  gainDb: 0.0,

  distortion: false,
  distortionGain: 25.0,

  chorus: false,
  chorusRate: 1.0,
  chorusDepth: 0.25,
  chorusCenterDelay: 7.0,
  chorusFeedback: 0.0,
  chorusMix: 0.5,

  bitcrush: false,
  bitcrushBitDepth: 8,

  clipping: false,
  clippingThreshold: -6.0,

  compressor: false,
  compressorThreshold: 0.0,
  compressorRatio: 1.0,
  compressorAttack: 1.0,
  compressorRelease: 100.0,

  delay: false,
  delaySeconds: 0.5,
  delayFeedback: 0.0,
  delayMix: 0.5,

  sid: 0,
};

/** Formant presets are shortcuts for two numbers, not a mode of their own. */
export const FORMANT_PRESETS = {
  f2m: { formantQfrency: 1.0, formantTimbre: 0.8 },
  m2f: { formantQfrency: 1.0, formantTimbre: 1.2 },
  random: { formantQfrency: 32.0, formantTimbre: 9.8 },
};

export const applyFormantPreset = (params, preset) => ({
  ...params,
  formantPreset: preset,
  // "none" and anything unrecognised leave the two values where the user put
  // them — a preset is a starting point, not a lock.
  ...(FORMANT_PRESETS[preset] || {}),
});

/** How the model reads in the header. */
export const describeModel = (model) => {
  const displayBaseName =
    typeof model?.name === "string"
      ? model.name
      : typeof model?.modelName === "string"
        ? model.modelName
        : "Model";
  return {
    displayBaseName,
    // Trained models are saved as "<name>_<epochs>e_<steps>s"; the part before
    // the first underscore is the name a person gave it.
    modelName: displayBaseName.split("_")[0],
    epoch:
      model?.selectedCheckpoint?.epochs ??
      model?.selectedCheckpoint?.epoch ??
      model?.modelCheckpoint?.epoch ??
      "Unknown",
    hasModel: Boolean(model?.name || model?.modelName || model?.id || model?.modelId),
  };
};

/**
 * Which checkpoint of a model to load.
 *
 * The hint is whatever the previous screen already knew. A filename is exact
 * so it wins; an epoch number is next; failing both, the model's own best, and
 * failing that the first one there is — loading *a* checkpoint beats
 * refusing to convert.
 */
export const selectCheckpoint = (checkpoints, hint) => {
  if (!Array.isArray(checkpoints) || !checkpoints.length) return null;
  const hintEpochRaw = hint?.epoch ?? hint?.epochs;
  const hintEpoch = hintEpochRaw == null ? null : Number(hintEpochRaw);
  const hasHintEpoch = Number.isFinite(hintEpoch);
  const hintFile = hint?.pthFile || hint?.filename || null;
  if (hintFile) {
    const byFile = checkpoints.find(
      (cp) => cp?.filename === hintFile || (cp?.path && cp.path.endsWith(hintFile))
    );
    if (byFile) return byFile;
  }
  if (hasHintEpoch) {
    const byEpoch = checkpoints.find((cp) => Number(cp?.epochs) === hintEpoch);
    if (byEpoch) return byEpoch;
  }
  const best = checkpoints.find((cp) => cp?.isBest);
  return best || checkpoints[0];
};

/** The checkpoint the previous screen already chose, if it chose one. */
export const getExistingCheckpoint = (model) =>
  model?.selectedCheckpoint || model?.modelCheckpoint || model?.bestCheckpoint || null;

/**
 * The catalogue entry for a model the picker handed over.
 *
 * Id and name are matched against each other in both directions because the
 * two screens disagree about which field holds which: one view's `modelId` is
 * another's `name`.
 */
export const matchCatalogModel = (models = [], selectedModel) => {
  const targetId = selectedModel?.id || selectedModel?.modelId || null;
  const targetName = selectedModel?.name || selectedModel?.modelName || null;
  return (
    (models || []).find((model) => {
      if (targetId && (model.modelId === targetId || model.name === targetId)) return true;
      if (targetName && (model.name === targetName || model.modelId === targetName)) return true;
      return false;
    }) || null
  );
};

/** The picked model over the catalogue entry: what the user chose wins, the
 *  catalogue fills in what the picker did not carry. */
export const mergeResolvedModel = (matched, selectedModel) => {
  const picked = selectCheckpoint(matched?.checkpoints, getExistingCheckpoint(selectedModel));
  return {
    ...matched,
    ...selectedModel,
    selectedCheckpoint: picked || matched?.bestCheckpoint || matched?.checkpoints?.[0] || null,
  };
};

/** Tracks that came out of an inference run, and so can have another model
 *  stacked on top instead of being converted from source again. */
export const getLayerableTracks = (selectedTracks = []) =>
  (selectedTracks || []).filter((track) => track?.sourceRunId);

export const getPreviousModelName = (layerableTracks = []) =>
  (layerableTracks || []).find((track) => track?.sourceModelName)?.sourceModelName || null;

/**
 * The tracks as the backend should see them.
 *
 * Stripping sourceRunId is the whole mechanism: with it the backend converts
 * the previous run's output, without it it goes back to the original upload's
 * vocals. A track kept by mistake means converting a converted voice.
 */
export const resolveSourceTracks = (selectedTracks, sourceMode) =>
  (Array.isArray(selectedTracks) ? selectedTracks : []).map((track) => {
    if (sourceMode === "layered" && track?.sourceRunId) return track;
    const { sourceRunId, ...rest } = track || {};
    return rest;
  });

export const canStartInference = ({ hasModel, trackCount }) =>
  Boolean(hasModel) && (trackCount || 0) > 0;

/** The request handed to the inference runner. */
export const buildInferenceRequest = ({ params, model, selectedTracks, sourceMode }) => ({
  model,
  tracks: resolveSourceTracks(selectedTracks, sourceMode),
  params: {
    ...params,
    // Applio takes a number here, not a flag.
    volumeEnvelope: params?.volumeEnvelopeEnabled ? 1 : 0,
  },
});
