/**
 * Inspector, minus the rendering.
 *
 * These are the parts of the right panel that are decisions rather than
 * markup: which context a selection is in, which AI cards that context should
 * offer, how a clip is named, how a job reads. They were defined inside
 * Inspector.js — a 1,635-line file with 21 useState calls — where nothing
 * could reach them, so none of it was tested.
 *
 * Every function here is pure. Moving them out is what makes them testable;
 * it is also 150 lines Inspector no longer carries.
 */

import {
  JOB_TYPE_LABELS,
  clipLengthSec,
  normalizeRange,
  summarizeJob,
} from "../studioSelectors";

/* Re-exported rather than redefined: StudioPage asks the same questions of
   the same state, and the two copies of summarizeJob had already drifted —
   one showed a failed job's stale status message instead of its error. */
export { normalizeRange, summarizeJob };
export const JOB_LABELS = JOB_TYPE_LABELS;

export const SOUND_FONT_OPTIONS = [
  { value: "", label: "Use lane default" },
  { value: "acoustic_grand_piano", label: "Piano" },
  { value: "electric_guitar_clean", label: "Guitar (Clean)" },
  { value: "acoustic_bass", label: "Bass" },
  { value: "string_ensemble_1", label: "Strings" },
  { value: "synth_pad_1_new_age", label: "Synth Pad" },
  { value: "synth_drum", label: "Synth Drum" },
  { value: "choir_aahs", label: "Choir" },
  { value: "flute", label: "Flute" },
  { value: "alto_sax", label: "Sax" },
  { value: "trumpet", label: "Trumpet" },
];

export const FOUNDATION_INSTRUMENT_OPTIONS = [
  "Keys",
  "Synth",
  "Strings",
  "Guitar",
  "Bass",
  "Brass",
  "Woodwinds",
  "Choir",
  "Pluck",
  "Pad",
  "FX",
];

export const FOUNDATION_KEY_NOTES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
export const FOUNDATION_KEY_SCALES = ["major", "minor"];

export const JOB_TOOL_MAP = {
  understand: "analyze",
  foundation_generate: "foundation",
  foundation_restyle: "foundation",
  foundation_extend: "foundation",
  stage_drums_generate: "drums",
};

export const DRAWER_TITLES = {
  clip: "More Clip Controls",
  lane: "Lane Controls & FX",
  project: "Project Settings",
  foundation: "Foundation",
  drums: "STAGE Drums",
  live: "Live Voice Conversion",
  voice: "Voice to MIDI",
};

export const PANEL_CONTEXT = {
  RANGE: "range",
  MIDI: "midi",
  AUDIO: "audio",
  NOTHING: "nothing",
};

export const resolveRightPanelContext = (selectedRange, selectedClip) => {
  if (selectedRange) return PANEL_CONTEXT.RANGE;
  if (selectedClip?.clipType === "midi") return PANEL_CONTEXT.MIDI;
  if (selectedClip) return PANEL_CONTEXT.AUDIO;
  return PANEL_CONTEXT.NOTHING;
};

export const getVisibleAiCards = ({ resolvedRightPanelContext, canAnalyze, canGenerateDrums }) => {
  switch (resolvedRightPanelContext) {
    case PANEL_CONTEXT.RANGE:
      return [
        canAnalyze ? "analyze" : null,
        "foundation",
        canGenerateDrums ? "drums" : null,
      ].filter(Boolean);
    case PANEL_CONTEXT.MIDI:
      return [];
    case PANEL_CONTEXT.AUDIO:
      return [
        canAnalyze ? "analyze" : null,
        "foundation",
        canGenerateDrums ? "drums" : null,
      ].filter(Boolean);
    case PANEL_CONTEXT.NOTHING:
    default:
      return ["live", "foundation", "voice"];
  }
};

export const getClipBounds = (clip) => {
  const start = Number(clip?.timelineStartSec ?? 0);
  const duration = clipLengthSec(clip);
  return { start, end: start + duration, duration };
};

export const formatSeconds = (value) => `${(Number(value) || 0).toFixed(2)}s`;
export const makeRandomSeed = () => Math.floor(Math.random() * 1000000000);
export const parseKeyParts = (rawKey) => {
  const normalized = String(rawKey || "").trim().replace("-", " ").replace("_", " ");
  if (!normalized) return { note: "C", scale: "major" };
  const parts = normalized.split(/\s+/);
  const note = FOUNDATION_KEY_NOTES.includes(parts[0]) ? parts[0] : "C";
  const scale = parts.some((part) => part.toLowerCase().startsWith("min")) ? "minor" : "major";
  return { note, scale };
};
export const formatKeyParts = (note, scale) => `${note || "C"} ${scale || "major"}`.trim();

export const nextStepForJob = (job) => {
  if (!job) return "";
  if (job.status === "failed") return "Open the tool, adjust the source or settings, then retry.";
  if (job.status === "completed") return "Review the new lane or refreshed timeline result.";
  if (job.status === "running") return "You can keep editing while this runs in the background.";
  if (job.status === "queued") return "The job is queued and will start automatically.";
  return "Check the activity list for details.";
};

export const getActivityJobs = (jobs, filter) => {
  const list = [...(jobs || [])].reverse();
  if (filter === "active") {
    return list.filter((job) => !["completed", "failed", "cancelled"].includes(job.status));
  }
  if (filter === "errors") {
    return list.filter((job) => job.status === "failed");
  }
  return list;
};

/* Clips carry no label of their own, so the old fallback chain ended on
   `clip.id` and the panel headlined a raw 32-character uuid — with a second one
   ("lane da43bec9…") in the subtitle. Neither identifies anything to a person.
   The source asset and the lane both have real names; use those, and keep the
   id out of the panel entirely. */
export const describeClip = (clip, assets, lanes) => {
  const assetLabel = assets?.[clip.sourceAssetId]?.label;
  const laneName = lanes?.find((lane) => lane.id === clip.laneId)?.name;
  const name = clip.label || clip.name || assetLabel || laneName || "Clip";
  return {
    name,
    // A clip named after its own lane is the common case ("Vocals" on the
    // Vocals lane); repeating it in the subtitle says nothing.
    lane: laneName && laneName !== name ? laneName : null,
  };
};
