export const API_BASE = "";

export const GENRE_RECS = [
  "Electro-pop",
  "Synthwave",
  "Alt-pop",
  "Indie rock",
  "Trap",
  "Lo-fi",
  "Ambient",
  "Cinematic",
];

export const ACESTEP_MAIN_MODELS = ["acestep-v15-turbo", "acestep-v15-base", "acestep-v15-sft"];
export const ACESTEP_LM_MODELS = ["acestep-5Hz-lm-0.6B", "acestep-5Hz-lm-1.7B", "acestep-5Hz-lm-4B"];

export const SONG_ASSET_KEYS = [
  "full_mix",
  "instrumental",
  "vocals_raw",
  "vocals_rvc",
  "final_mix_rvc",
];

export const SONG_ASSET_LABELS = {
  full_mix: "Full",
  instrumental: "Instrumental",
  vocals_raw: "Raw Vocals",
  vocals_rvc: "Enhanced Vocals",
  final_mix_rvc: "Final Mix (Enhanced)",
};

export const isAssetReady = (asset) => !!(asset && (asset.ready || asset.url));

export const getBestAssetKey = (assets) => {
  if (!assets) return null;
  if (isAssetReady(assets.full_mix)) return "full_mix";
  const ready = SONG_ASSET_KEYS.find((k) => isAssetReady(assets[k]));
  return ready || null;
};

export const fmt = (s) => {
  const m = Math.floor(s / 60);
  const sec = String(s % 60).padStart(2, "0");
  return `${m}:${sec}`;
};

export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const normalize = (s) => s.trim().replace(/\s+/g, " ");
export const toKey = (s) => normalize(s).toLowerCase();

export const resolveAssetUrl = (song, assetKey) => {
  const direct = song?.assets?.[assetKey]?.url;
  if (direct) return direct;
  if (assetKey) return `/api/song-generation/${song.id}/audio/${assetKey}`;
  return `/api/song-generation/audio/${song.id}`;
};
