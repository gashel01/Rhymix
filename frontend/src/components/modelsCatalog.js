/**
 * The model catalogue: what the Models view actually shows.
 *
 * Three sources feed one grid of cards — models installed on disk, downloads
 * in flight, and training runs. They arrive from three endpoints with three
 * different shapes and three different ideas of what a model is called, and
 * they overlap: a training run and an installed model can be the same model,
 * and a retry can collide with the run it replaced.
 *
 * Reconciling them was written inside ModelsView.js, a 1,462-line component,
 * so the rules below — which state wins, which run wins, what a card is
 * called — could only be checked by starting a download and watching.
 */

/** Model names arrive as "Ariana Grande", "ariana_grande" and "ariana-grande"
 *  for the same thing. Strip everything that varies and compare what is left. */
export const normalizeId = (value) => {
  if (!value) return "";
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
};

/** Every identity the installed models answer to, for spotting which online
 *  search results are already on disk. */
export const getInstalledIds = (localModels = []) => {
  const ids = new Set();
  localModels.forEach((model) => {
    if (model.modelId) ids.add(normalizeId(model.modelId));
    if (model.name) ids.add(normalizeId(model.name));
  });
  return ids;
};

/**
 * One card list from the three sources, newest first.
 *
 * `now` is injected so the result is reproducible; it is only used for cards
 * that have no date of their own.
 */
export const mergeModelCatalog = ({
  localModels = [],
  downloadJobs = {},
  trainingJobs = [],
  now = new Date().toISOString(),
}) => {
  const byId = new Map();

  localModels.forEach((model) => {
    const id = model.modelId || model.name;
    byId.set(normalizeId(id), { ...model, isOnline: false, status: model.status || "completed" });
  });

  Object.values(downloadJobs).forEach((job) => {
    const id = normalizeId(job.modelId || job.modelName);
    const existing = byId.get(id);
    if (existing) {
      // An installed model stays installed. Only a download still in flight
      // has anything to add — a finished one would overwrite the real entry
      // with a thinner copy of itself.
      if (job.status && job.status !== "completed") {
        byId.set(id, {
          ...existing,
          status: job.status,
          downloadProgress: job.progress ?? null,
          downloadPhase: job.phase || null,
          downloadError: job.error || existing.downloadError,
        });
      }
      return;
    }
    byId.set(id, {
      name: job.modelName || job.modelId || "New Model",
      modelId: job.modelId,
      status: job.status || "downloading",
      downloadProgress: job.progress ?? null,
      downloadPhase: job.phase || null,
      downloadError: job.error || null,
      checkpoints: [],
      size_mb: job.size_mb || null,
      created: job.started_at || now,
      isOnline: false,
    });
  });

  // Oldest first: several runs can share a model name (a retry after an
  // interrupted one), and they collide on the same card. Applying them in
  // order leaves the most recent state showing.
  [...trainingJobs]
    .sort((a, b) => (a.started_at || 0) - (b.started_at || 0))
    .forEach((job) => {
      // A finished or abandoned run has nothing left to show; whatever landed
      // on disk is already represented by the real model entry.
      if (job.status === "completed" || job.status === "cancelled") return;
      // "interrupted" means the backend restarted under it — dead, and worth
      // saying so rather than leaving a card that pretends to still be running.
      const isTerminal = job.status === "failed" || job.status === "interrupted";
      const id = normalizeId(job.model_name);
      const existing = byId.get(id);
      const startedAt = job.started_at ? new Date(job.started_at * 1000).toISOString() : null;
      byId.set(id, {
        ...(existing || {}),
        name: job.model_name,
        modelId: existing?.modelId || job.model_name,
        status: isTerminal ? "failed" : "training",
        trainingJobId: job.id,
        trainingProgress: typeof job.progress === "number" ? job.progress : null,
        trainingPhase: job.status || null,
        trainingError: job.error || null,
        checkpoints: existing?.checkpoints || [],
        created: existing?.created || startedAt || now,
        isOnline: false,
      });
    });

  return Array.from(byId.values()).sort((a, b) => {
    const aTime = a.created ? Date.parse(a.created) : 0;
    const bTime = b.created ? Date.parse(b.created) : 0;
    return bTime - aTime;
  });
};

export const filterModels = (models = [], query = "") => {
  if (!query.trim()) return models;
  const q = query.trim().toLowerCase();
  const qUnderscore = q.replace(/\s+/g, "_");
  return models.filter((model) => {
    // Match the alias the user chose AND the name it was published under, so
    // a model saved as "progress_test" is still findable by "ariana".
    const haystacks = [model.name, model.sourceName]
      .filter(Boolean)
      .map((value) => value.toLowerCase());
    return haystacks.some((value) => value.includes(q) || value.includes(qUnderscore));
  });
};

/** Only a finished model can be selected; a download or a training run has
 *  nothing to act on yet. */
export const getSelectableModels = (models = []) =>
  models.filter((model) => model.status === "completed");

/** Tracks name themselves five different ways depending on where they came
 *  from. Take the first one that exists. */
export const getSelectionNames = (selectedTracks = []) =>
  (selectedTracks || [])
    .map(
      (track) =>
        track?.displayName ||
        track?.safeDisplayName ||
        track?.originalName ||
        track?.name ||
        track?.fileId ||
        track?.id
    )
    .filter(Boolean);

export const formatSelectionPreview = (names = []) => {
  const list = names.slice(0, 3);
  const extra = names.length - list.length;
  const base = list.join(", ");
  return extra > 0 ? `${base} +${extra} more` : base;
};

/** Where Back goes depends on where the view was opened from; null means
 *  "there is no route to return to, use the plain back handler". */
export const resolveBackTarget = (ctxSource) =>
  ctxSource === "home" || ctxSource === "inference" ? ctxSource : null;

export const normaliseModelName = (name) => {
  const capitalised = String(name || "").charAt(0).toUpperCase() + String(name || "").slice(1);
  return capitalised.replace(/[^a-zA-Z0-9]/g, " ");
};

export const formatSampleRate = (hz) => {
  if (!hz) return "—";
  const n = Number(hz);
  if (n >= 1000) return `${n / 1000}k`;
  return `${n} Hz`;
};

// Installing a community model is fetch → unzip → install, never training.
// Name the phase the job actually reports, and show how far along it is.
const DOWNLOAD_PHASE_LABELS = {
  starting: "Starting",
  downloading: "Downloading",
  extracting: "Extracting",
  installing: "Installing",
};

export const downloadPhaseLabel = (phase) => DOWNLOAD_PHASE_LABELS[phase] || "Downloading";

export const describeDownload = (phase, percent) => {
  const label = downloadPhaseLabel(phase);
  return typeof percent === "number" ? `${label} ${percent}%` : label;
};

// The backend reports which stage of the pipeline a run is in.
const TRAINING_PHASE_LABELS = {
  preprocessing: "Preprocessing",
  extracting: "Extracting features",
  training: "Training",
  indexing: "Building index",
};

export const trainingPhaseLabel = (phase) => TRAINING_PHASE_LABELS[phase] || "Training";

export const describeTraining = (phase, percent) => {
  const label = trainingPhaseLabel(phase);
  return typeof percent === "number" ? `${label} ${percent}%` : label;
};

export const CARD_GRADIENTS = [
  "linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)",
  "linear-gradient(135deg, #ec4899 0%, #9333ea 100%)",
  "linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)",
  "linear-gradient(135deg, #10b981 0%, #0d9488 100%)",
  "linear-gradient(135deg, #8b5cf6 0%, #c026d3 100%)",
  "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)",
];

export const getCardGradient = (index) => CARD_GRADIENTS[index % CARD_GRADIENTS.length];
