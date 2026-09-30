/**
 * Colour helpers.
 *
 * `hexToRgba` existed three times — ClipView, MidiOverlay and StudioWaveform —
 * byte-for-byte identical in all three. Three copies of a parser is three
 * places to fix when it turns out `#abc` shorthand or an alpha clamp is wrong,
 * and nothing makes the next reader check whether they have drifted.
 */

/** `#rgb` or `#rrggbb` (with or without the hash) → `rgba(...)`, or null. */
export const hexToRgba = (hex, alpha) => {
  if (!hex || typeof hex !== "string") return null;
  const trimmed = hex.replace("#", "").trim();
  if (trimmed.length !== 3 && trimmed.length !== 6) return null;
  const full =
    trimmed.length === 3
      ? trimmed
          .split("")
          .map((c) => c + c)
          .join("")
      : trimmed;
  const intVal = Number.parseInt(full, 16);
  if (Number.isNaN(intVal)) return null;
  const r = (intVal >> 16) & 255;
  const g = (intVal >> 8) & 255;
  const b = intVal & 255;
  const a = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

/**
 * Relative luminance (WCAG), used to pick ink that stays legible on a given
 * fill — the Studio's lane palette runs from a dark indigo to a bright green,
 * so a fixed black or white fails at one end.
 */
export const readableInk = (hex) => {
  const trimmed = String(hex || "").replace("#", "").trim();
  const full =
    trimmed.length === 3 ? trimmed.split("").map((c) => c + c).join("") : trimmed;
  const value = Number.parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(value)) return "#0b0b0f";
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel((value >> 16) & 255) +
    0.7152 * channel((value >> 8) & 255) +
    0.0722 * channel(value & 255);
  return luminance > 0.35 ? "#0b0b0f" : "#ffffff";
};

/**
 * A shade of `hex` itself — darker on a light lane colour, lighter on a dark
 * one — for ink drawn over a fill of that same colour. `readableInk` picks a
 * flat black or white, which is legible but throws away the hue entirely:
 * paint a bright purple lane and the waveform peaks looked the same as a
 * bright yellow one. Blending toward black/white instead of jumping straight
 * to it keeps the peaks recognisably the colour that was picked.
 */
export const inkShade = (hex) => {
  const trimmed = String(hex || "").replace("#", "").trim();
  const full = trimmed.length === 3 ? trimmed.split("").map((c) => c + c).join("") : trimmed;
  const value = Number.parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(value)) return "#0b0b0f";
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const mixTo = luminance > 0.35 ? 0 : 255;
  const amount = 0.62;
  const mix = (c) => Math.round(c + (mixTo - c) * amount);
  /* hexToRgba only parses `#rrggbb` — an "rgb(...)" string here would fail
     to parse, silently falling back to a flat white for every lane. */
  const toHex = (c) => c.toString(16).padStart(2, "0");
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
};
