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
 *
 * This is for chrome that identifies a track — the chip beside its title. It is
 * deliberately kept off the waveform: there, colour already means something
 * else (orange instrumental, blue vocal, and grey for whatever has not played
 * yet), and a second colour system on the same pixels would erase the first.
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
