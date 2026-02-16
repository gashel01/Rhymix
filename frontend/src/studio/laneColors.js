export const CATEGORY_COLORS = {
  mix: "#2a6f97",
  vocal: "#ff7a59",
  instrumental: "#6fbf73",
  stem: "#b084f5",
  generated: "#ffb454",
};

export const AUTO_COLORS = [
  "#6aa6ff",
  "#ff6b6b",
  "#ffd166",
  "#06d6a0",
  "#4cc9f0",
  "#f28482",
  "#8ac926",
  "#ff9f1c",
];

const normalizeColor = (value) => (typeof value === "string" ? value.toLowerCase() : "");

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
  if (lane?.color) return lane.color;
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
    if (lane?.color) return lane;
    const type = lane?.type;
    const color = type && CATEGORY_COLORS[type] ? CATEGORY_COLORS[type] : pickAutoColor(used);
    used.add(normalizeColor(color));
    return { ...lane, color };
  });
};
