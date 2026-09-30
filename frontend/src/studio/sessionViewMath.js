// Pure helpers for SessionView's visual pass — kept separate from the component so the bar-length
// math (the one part of the grid's new visuals worth getting numerically right) is unit-testable
// without mounting React.

export const secPerBar = (bpm) => (60 / (Number(bpm) || 120)) * 4;

/** "2 bars" / "1.5 bars" / "—" (no usable length) from a clip-slot's trim + the project BPM. */
export const formatBarLength = (srcStartSec, srcEndSec, bpm) => {
  const lenSec = Number(srcEndSec || 0) - Number(srcStartSec || 0);
  if (!(lenSec > 0)) return "—";
  const bars = lenSec / secPerBar(bpm);
  const rounded = Math.round(bars * 4) / 4; // nearest quarter-bar, readable without being noisy
  const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${label} bar${rounded === 1 ? "" : "s"}`;
};
