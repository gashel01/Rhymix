/* The iOS system palette, dark-mode variants. The previous set mixed a teal, a
   coral, a pea green and two oranges picked independently, so lanes sitting
   next to each other had unrelated hues and visibly different lightness. These
   are tuned as a family against a near-black background.

   The UI accent (#ff9f0a, the same orange every other view in the app uses)
   is deliberately absent: it means "the primary action" everywhere, and a
   lane wearing it would read as selected. */
export const CATEGORY_COLORS = {
  mix: "#5e5ce6",
  vocal: "#ff375f",
  instrumental: "#30d158",
  stem: "#bf5af2",
  generated: "#ffd60a",
  airgen: "#64d2ff",
};

export const AUTO_COLORS = [
  "#64d2ff",
  "#66d4cf",
  "#ffd60a",
  "#ff453a",
  "#40c8e0",
  "#ac8e68",
  "#a2845e",
  "#8e8e93",
];

/* The palette these replaced. Lane colours are persisted per project, so every
   project made before the change still carries these — and the timeline now
   paints clips in the lane colour at full strength, where these muted hues
   read as washed out. A lane still wearing exactly its old category colour is
   remapped on load; a colour picked by hand is never touched. */
const LEGACY_CATEGORY_COLORS = {
  mix: "#2a6f97",
  vocal: "#ff7a59",
  instrumental: "#6fbf73",
  stem: "#b084f5",
  generated: "#ff9f0a",
};

const normalizeColor = (value) => (typeof value === "string" ? value.toLowerCase() : "");

const remapLegacyColor = (lane) => {
  const type = lane?.type;
  const legacy = type && LEGACY_CATEGORY_COLORS[type];
  if (!legacy || !lane?.color) return null;
  return normalizeColor(lane.color) === normalizeColor(legacy) ? CATEGORY_COLORS[type] : null;
};

const pickAutoColor = (usedColors) => {
  const used = usedColors || new Set();
  for (const color of AUTO_COLORS) {
    if (!used.has(normalizeColor(color))) {
      return color;
    }
  }
  return AUTO_COLORS[used.size % AUTO_COLORS.length] || "#2b3a45";
};

export const resolveLaneColor = (lane, lanes = []) => {
  if (lane?.color) return remapLegacyColor(lane) || lane.color;
  const type = lane?.type;
  if (type && CATEGORY_COLORS[type]) return CATEGORY_COLORS[type];
  const used = new Set(lanes.map((item) => normalizeColor(item?.color)).filter(Boolean));
  Object.values(CATEGORY_COLORS).forEach((color) => used.add(normalizeColor(color)));
  return pickAutoColor(used);
};

export const ensureLaneColors = (lanes = []) => {
  const used = new Set(lanes.map((item) => normalizeColor(item?.color)).filter(Boolean));
  Object.values(CATEGORY_COLORS).forEach((color) => used.add(normalizeColor(color)));
  return lanes.map((lane) => {
    if (lane?.color) {
      const remapped = remapLegacyColor(lane);
      return remapped ? { ...lane, color: remapped } : lane;
    }
    const type = lane?.type;
    const color = type && CATEGORY_COLORS[type] ? CATEGORY_COLORS[type] : pickAutoColor(used);
    used.add(normalizeColor(color));
    return { ...lane, color };
  });
};
