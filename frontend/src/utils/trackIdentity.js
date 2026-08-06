/**
 * A stable colour identity per track.
 *
 * The Models view gives every model a gradient header, and that is most of why
 * it feels alive: each card is a distinct object you can point at across the
 * room. Home and Inference render the same kind of thing — one row per track —
 * entirely in greys, with the only colour on the screen being a badge and the
 * accent. Same information, none of the recognisability.
 *
 * The colour is derived from the track's own name rather than its position, so
 * a track keeps its identity when the list is filtered, sorted or paginated.
 */

/* The palette ModelsView cycles through, kept in step deliberately: a track
   row and a model card should look like they came from the same product. */
export const IDENTITY_GRADIENTS = [
  { from: "#6366f1", to: "#06b6d4" },
  { from: "#ec4899", to: "#9333ea" },
  { from: "#f59e0b", to: "#ea580c" },
  { from: "#10b981", to: "#0d9488" },
  { from: "#8b5cf6", to: "#c026d3" },
  { from: "#3b82f6", to: "#1d4ed8" },
];

/* FNV-1a. Any stable hash would do; this one is short, has no dependencies and
   spreads similar strings ("Take 1", "Take 2") into different buckets, which a
   simple character sum does not. */
const hashString = (value) => {
  const text = String(value || "");
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

export const identityIndex = (name) => hashString(name) % IDENTITY_GRADIENTS.length;

export const trackGradient = (name) => {
  const { from, to } = IDENTITY_GRADIENTS[identityIndex(name)];
  return `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;
};

/** The single hue to tint a waveform or a progress bar with. */
export const trackColor = (name) => IDENTITY_GRADIENTS[identityIndex(name)].from;

/** Same hue, dimmed — for the unplayed part of a waveform, which should read as
 *  the track's colour without competing with the played part. */
export const trackWaveColor = (name) => {
  const hex = trackColor(name).replace("#", "");
  const value = Number.parseInt(hex, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, 0.42)`;
};
