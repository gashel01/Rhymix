/**
 * Reading the studio state: clips, selections, jobs.
 *
 * StudioPage is 1,099 lines of which most is markup, but threaded through it
 * are the questions the page keeps asking of its state — how long is this
 * clip, what does the selection cover, which job is the current one. They
 * were written as inline useMemo bodies, so none of them could be called from
 * a test, and three of them were the same arithmetic written three times.
 *
 * That arithmetic is the one rule worth stating once: a clip's length on the
 * timeline is `srcEndSec - srcStartSec`. `srcEndSec` is an offset into the
 * source, not a length; the two agree only while the clip is untrimmed. The
 * backend had the same rule written three ways and got it wrong in two of
 * them — see backend/features/studio/project_edits.py.
 */

/** How long the clip sounds for. Never zero: a clip with no length would
 *  vanish from the timeline while still sitting in the project. */
export const clipLengthSec = (clip) =>
  Math.max(0.01, (clip?.srcEndSec ?? 0) - (clip?.srcStartSec ?? 0));

/** Where the clip stops on the timeline. */
export const clipTimelineEnd = (clip) => (clip?.timelineStartSec ?? 0) + clipLengthSec(clip);

/** A drag ordered start-to-end, or null when it covers nothing. */
export const normalizeRange = (range) => {
  if (!range) return null;
  const start = Math.min(Number(range.start ?? 0), Number(range.end ?? 0));
  const end = Math.max(Number(range.start ?? 0), Number(range.end ?? 0));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end };
};

export const JOB_TYPE_LABELS = {
  stem_extract_uvr: "UVR Stem Extract",
  render: "Export",
};

/**
 * A job in one line.
 *
 * The error comes before the status message on purpose: a job that fails
 * keeps whatever statusMessage it had when it died, so a failed export read
 * "Export · Rendering mixdown..." and said nothing about the failure. The two
 * copies of this function disagreed on that; this is the one that tells the
 * truth.
 */
export const summarizeJob = (job, emptyLabel = "No recent activity") => {
  if (!job) return emptyLabel;
  const label = JOB_TYPE_LABELS[job.type] || String(job.type || "job").replace(/_/g, " ");
  const detail = job.error || job.statusMessage || job.status || "idle";
  return `${label} · ${detail}`;
};

const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];

export const getActiveJobs = (jobs = []) =>
  (jobs || []).filter((job) => !TERMINAL_STATUSES.includes(job.status));

/** The job the header talks about: the newest one still running, or failing
 *  that the newest one there is. */
export const getCurrentJob = (jobs = []) => {
  const active = getActiveJobs(jobs);
  return active[active.length - 1] || (jobs || [])[jobs?.length - 1] || null;
};

/** The asset map as a list, each entry carrying its own key as `id`. */
export const listAssets = (assets) =>
  Object.entries(assets || {}).map(([id, asset]) => ({ id: asset.id || id, ...asset }));

/** `selectedTags` narrows to assets carrying every tag listed (AND, not OR) — the useful
 *  default for combining tags ("140bpm" + "drums"), not the surprising one. */
export const filterAssets = (assetList = [], query = "", selectedTags = []) => {
  const q = String(query || "").trim().toLowerCase();
  const tags = Array.isArray(selectedTags) ? selectedTags.filter(Boolean) : [];
  if (!q && !tags.length) return assetList;
  return assetList.filter((asset) => {
    const assetTags = Array.isArray(asset.tags) ? asset.tags : [];
    const matchesQuery =
      !q || `${asset.label || ""} ${asset.id || ""} ${assetTags.join(" ")}`.toLowerCase().includes(q);
    const matchesTags = !tags.length || tags.every((tag) => assetTags.includes(tag));
    return matchesQuery && matchesTags;
  });
};

export const findSelectedClip = (clips = [], selection) =>
  (clips || []).find((clip) => selection?.clipIds?.[0] === clip.id) || null;

/**
 * The clip a range selection is over.
 *
 * Overlap, not containment: a range drawn across a clip boundary still has
 * that clip's audio under most of it, and the AI tools need something to work
 * from. MIDI is skipped — it has no audio to send.
 */
export const findSelectionSourceClip = (clips = [], selection) => {
  const range = normalizeRange(selection?.range);
  if (!range) return null;
  const laneIds = Array.isArray(selection?.laneIds) ? selection.laneIds : null;
  return (
    (clips || []).find((clip) => {
      if (clip.clipType === "midi") return false;
      if (laneIds?.length && !laneIds.includes(clip.laneId)) return false;
      const clipStart = clip.timelineStartSec ?? 0;
      return range.end > clipStart && range.start < clipStart + clipLengthSec(clip);
    }) || null
  );
};

/** What the tools act on when nothing is selected: the mix, or any audio. */
export const findDefaultSourceClip = (clips = [], lanes = []) => {
  const mixLane = (lanes || []).find((lane) => lane.type === "mix");
  const mixClip = (clips || []).find(
    (clip) => clip.laneId === mixLane?.id && clip.clipType !== "midi"
  );
  if (mixClip) return mixClip;
  return (clips || []).find((clip) => clip.clipType !== "midi" && clip.sourceAssetId) || null;
};

export const findSelectedLane = (lanes = [], selection, selectedClip) => {
  const selectedLaneId = selection?.laneIds?.[0] || selectedClip?.laneId;
  return (lanes || []).find((lane) => lane.id === selectedLaneId) || null;
};

/** What the header says is selected. */
export const describeSelection = ({ selectedClip, selectedLane, selection, lanes = [], clips = [] }) => {
  if (selectedClip) {
    const name = selectedClip.label || selectedClip.name || selectedClip.id;
    return `Clip · ${name} · ${clipLengthSec(selectedClip).toFixed(2)}s`;
  }
  const range = normalizeRange(selection?.range);
  if (range) {
    const laneCount = Array.isArray(selection?.laneIds) ? selection.laneIds.length : lanes.length;
    return `Range · ${range.start.toFixed(2)}s to ${range.end.toFixed(2)}s · ${laneCount} lane${
      laneCount === 1 ? "" : "s"
    }`;
  }
  if (selectedLane) return `Lane · ${selectedLane.name}`;
  if (!clips.length) {
    return "No clips yet. Use the create tools in the right panel or add clips to begin.";
  }
  return "No active selection";
};

/**
 * The span the timeline draws.
 *
 * The stored duration is a floor rather than the answer: it can lag behind an
 * edit made since the last save. Ten seconds minimum, so an empty project
 * still has a ruler to look at.
 */
export const getProjectDurationSec = (project, clips = []) => {
  const ends = (clips || []).map(clipTimelineEnd);
  return Math.max(10, project?.durationSec || 0, ...ends);
};

/**
 * The URL that keeps the address bar matching the open project.
 *
 * Entering at bare /studio keeps that path — the asset in the URL is the one
 * the page was opened with, and carrying it into a different project would
 * reopen the wrong thing on reload.
 */
export const buildStudioUrl = ({ assetId, isDirectStudioEntry, projectId }) => {
  let url = "/studio";
  if (!isDirectStudioEntry && assetId) url = `/studio/${encodeURIComponent(assetId)}`;
  if (projectId) {
    const joiner = url.includes("?") ? "&" : "?";
    url = `${url}${joiner}projectId=${encodeURIComponent(projectId)}`;
  }
  return url;
};

/* ---- Per-project UI preferences ------------------------------------------ */

export const getUiStorageKey = (projectId) => `rhymix:studio-ui:${projectId}`;

export const readUiPrefs = (projectId) => {
  if (!projectId || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(getUiStorageKey(projectId));
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    // Corrupt JSON, or storage blocked entirely. Either way the page opens
    // with defaults rather than not at all.
    return null;
  }
};

export const writeUiPrefs = (projectId, prefs) => {
  if (!projectId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getUiStorageKey(projectId), JSON.stringify(prefs));
  } catch (error) {
    // Ignore storage failures.
  }
};
