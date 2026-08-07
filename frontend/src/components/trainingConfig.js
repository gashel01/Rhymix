/**
 * Training, minus the rendering.
 *
 * What a training run is: a config object, a dataset assembled from the
 * selected vocals, and a poll loop that turns status responses into progress
 * and log lines. All of it lived inside a 1,243-line component with no tests
 * at all, and a run takes tens of minutes on a GPU — so every one of these
 * rules could only be checked by starting one and waiting.
 */

export const DEFAULT_TRAINING_CONFIG = {
  // Basic settings
  modelName: "",
  epochs: 100,
  batchSize: 8,
  saveEvery: 20,
  learningRate: 0.0001,

  // Voice features
  modelType: "standard", // standard, light, tiny
  useF0: true,
  usePitch: true,
  customPitch: 0, // -12 to +12
  useEnhancer: false,
  useEmotional: false,

  // Applio specific settings
  saveOnlyLatest: false,
  saveEveryWeights: true,
  sampleRate: 48000,
  gpu: 0,
  rvcVersion: "v2",
  pitchGuidance: true,
  overtrainingDetector: true,
  overtrainingThreshold: 5,
  pretrained: true,
  cleanup: true,
  indexAlgorithm: "Auto",
  cacheDataInGpu: false,
  customPretrained: false,
  gPretrainedPath: null,
  dPretrainedPath: null,
};

/** A run needs a name to save under and something to learn from. */
export const canStartTraining = (config, selectedVocals) =>
  Boolean(config?.modelName) && (selectedVocals?.length || 0) > 0;

/**
 * The body posted to /api/start-training.
 *
 * A deliberate subset of the config: the fields the UI keeps for itself
 * (modelType, useEnhancer, learningRate…) are not sent, because Applio does
 * not take them.
 */
export const buildTrainingPayload = (config) => ({
  modelName: config.modelName,
  rvcVersion: config.rvcVersion,
  saveEveryEpoch: config.saveEvery,
  saveOnlyLatest: config.saveOnlyLatest,
  saveEveryWeights: config.saveEveryWeights,
  totalEpoch: config.epochs,
  sampleRate: config.sampleRate,
  batchSize: config.batchSize,
  gpu: config.gpu,
  // Either switch turns pitch guidance on: they are the same setting under
  // two names, one in the basic panel and one in the Applio panel.
  pitchGuidance: config.pitchGuidance || config.useF0,
  overtrainingDetector: config.overtrainingDetector,
  overtrainingThreshold: config.overtrainingThreshold,
  pretrained: config.pretrained,
  cleanup: config.cleanup,
  indexAlgorithm: config.indexAlgorithm,
  cacheDataInGpu: config.cacheDataInGpu,
  customPretrained: config.customPretrained,
  gPretrainedPath: config.gPretrainedPath,
  dPretrainedPath: config.dPretrainedPath,
});

/**
 * A track name reduced to something safe to put on disk.
 *
 * The name reaches the filesystem on the backend, so anything that could
 * change the path — separators, drive colons, control characters — has to go
 * before it is sent, not after.
 */
export const toSafeName = (name) =>
  (name || "track")
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);

/** The files to fetch for the dataset, in the order they were selected. */
export const toVocalFiles = (selectedVocals = []) =>
  (selectedVocals || []).map((track) => ({
    filename: track.displayName || track.originalName || track.vocal,
    url: track.vocalUrl,
    type: "vocal",
  }));

/**
 * What a dataset file is called once uploaded.
 *
 * The speaker prefix is what tells Applio these are all one voice; the index
 * keeps two tracks with the same name apart.
 */
export const datasetFileName = (vocalFile, index) =>
  `speaker01_${index + 1}_${toSafeName(vocalFile.filename)}_${vocalFile.type}.wav`;

/**
 * The log lines not shown yet, and the new consumed count.
 *
 * The status endpoint returns the whole log on every poll, so appending what
 * it returns would fill the box with duplicates — one full copy every three
 * seconds.
 */
export const takeNewLogs = (logs, consumed) => {
  const all = Array.isArray(logs) ? logs : [];
  // A shorter log than last time means the job restarted; showing it from the
  // top again is right, and slicing from `consumed` would show nothing.
  if (all.length < consumed) return { fresh: all, consumed: all.length };
  if (all.length === consumed) return { fresh: [], consumed };
  return { fresh: all.slice(consumed), consumed: all.length };
};

/**
 * A status response, as the decision the poll loop has to make.
 *
 * `done` is what stops the interval, so it must be true for every terminal
 * state — a status the UI does not recognise leaves the loop polling for ever.
 */
export const readTrainingStatus = (data) => {
  const progress = data?.progress;
  if (data?.status === "completed") {
    return {
      done: true,
      failed: false,
      progress,
      message: "Training completed successfully!",
    };
  }
  if (data?.status === "failed") {
    return {
      done: true,
      failed: true,
      progress,
      message: `Training failed: ${data.error || "Unknown error"}`,
    };
  }
  return { done: false, failed: false, progress, message: null };
};
