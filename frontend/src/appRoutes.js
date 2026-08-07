/**
 * How a URL becomes a view, and back.
 *
 * Rhymix routes two ways at once: most views live in the hash (`#inference`),
 * the studio lives in the path (`/studio/<assetId>`). Both have to survive a
 * reload and a Back press, and both were parsed inline in App.js against
 * `window.location` — so nothing here could be tested without a browser, and
 * a mistake showed up as "the address bar says one thing and the screen shows
 * another".
 *
 * Every function takes the parts of a location explicitly. None reads
 * `window`.
 */

/* Views that can be restored from the URL hash. Every view that navigation
   writes a hash for must be listed here, or reloading and going back land on
   Home while the URL still claims otherwise. */
export const HASH_VIEWS = [
  "datasets",
  "training",
  "talking-workflow",
  "models",
  "inference-model-selection",
  "inference-params",
  "inference",
  "create-song",
];

/**
 * The hash as a route, or null for Home and anything unrecognised.
 *
 * Studio is deliberately absent: it routes on the path, see readStudioRoute.
 */
export const readHashRoute = (rawHash = "") => {
  const hash = String(rawHash || "").replace(/^#/, "");
  if (!hash || hash === "home") return null;
  const [view, query] = hash.split("?");
  if (!HASH_VIEWS.includes(view)) return null;
  return { view, query: query || null };
};

/** The `#create-song?...` query, as the state the view expects. */
export const parseCreateSongQuery = (query) => {
  const sp = new URLSearchParams(query || "");
  return {
    mode: sp.get("mode") === "cover" ? "cover" : "create",
    sourceSongId: sp.get("sourceSongId") || null,
    sourceSong: null,
  };
};

export const createSongHash = (sourceSongId) =>
  `#create-song?mode=cover&sourceSongId=${encodeURIComponent(sourceSongId)}`;

/**
 * The studio's own route, or null when the path is not the studio's.
 *
 * `/studio` opens whatever project the query names; `/studio/<assetId>` opens
 * a specific asset. The assetId is URL-encoded in the path, so it is decoded
 * here rather than by every caller.
 */
export const readStudioRoute = ({ pathname = "", search = "" } = {}) => {
  const path = pathname || "";
  const params = new URLSearchParams(search || "");
  const projectId = params.get("projectId") || null;
  const sourceFileId = params.get("sourceFileId") || null;

  if (path === "/studio" || path === "/studio/") {
    return { assetId: null, projectId, sourceFileId };
  }
  const match = path.match(/^\/studio\/(.+)$/);
  if (!match) return null;
  return { assetId: decodeURIComponent(match[1]), projectId, sourceFileId };
};

/**
 * The URL a view change should push, or null when it would not change
 * anything.
 *
 * Returning null is what stops re-clicking the current nav item from stacking
 * duplicate history entries — the Back button would then need as many presses
 * as the user made clicks.
 */
export const nextNavigationUrl = (view, { pathname = "", search = "", hash = "" } = {}) => {
  const base = `${pathname}${search}`;
  // Home drops the query string too: it belongs to whatever view set it.
  const nextUrl = view === "home" ? pathname : `${base}#${view}`;
  const currentUrl = `${base}${hash}`;
  return nextUrl === currentUrl ? null : nextUrl;
};

/**
 * The id the cover flow uses for a source song.
 *
 * The prefix is not decoration: an upload and an inference run can share a
 * numeric id, and the backend looks the two up in different places.
 */
export const toCoverSourceId = (track, source) => {
  if (!track || typeof track !== "object") return null;
  if (source === "inference" && track.runId) return `run:${track.runId}`;
  if (track.fileId) return `upload:${track.fileId}`;
  if (track.id && source === "inference") return `run:${track.id}`;
  if (track.id) return `upload:${track.id}`;
  return null;
};

/** What the cover view needs to know about the song it is covering, or null
 *  when the track cannot be identified. */
export const buildCoverSourceSong = (track, source) => {
  const sourceSongId = toCoverSourceId(track, source);
  if (!sourceSongId) return null;
  return {
    sourceSongId,
    title: track?.displayName || track?.name || track?.originalName || "Untitled source",
    artist: track?.artist || null,
    duration: track?.duration || null,
    audioUrl: track?.audioUrl || track?.vocalUrl || track?.instrumentalUrl || null,
    instrumentalUrl: track?.instrumentalUrl || null,
    vocalsUrl: track?.vocalUrl || track?.originalVocalUrl || null,
    source,
  };
};

/** Tracks carry whichever id the view that produced them uses. */
export const getTrackId = (track) =>
  track?.fileId || track?.trackId || track?.id || track?.runId || track?.tempId || null;

/**
 * What the model picker needs to find its way back.
 *
 * Ids rather than the objects themselves: the context outlives the list the
 * tracks came from, and holding the objects would pin a stale copy.
 */
export const buildNavContext = ({ source, selectedTracks = [], selectedModel = null }) => {
  const ids = (selectedTracks || []).map(getTrackId).filter(Boolean);
  return {
    source,
    selectedTrackIds: Array.from(new Set(ids)),
    selectedModelId: selectedModel?.id || selectedModel?.modelId || null,
    selectedModelName: selectedModel?.name || selectedModel?.modelName || null,
  };
};
