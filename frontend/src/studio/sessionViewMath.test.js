import { secPerBar, formatBarLength } from "./sessionViewMath";

describe("secPerBar", () => {
  test("120 BPM, 4/4 -> 2 seconds per bar", () => {
    expect(secPerBar(120)).toBeCloseTo(2, 5);
  });
  test("falls back to 120 BPM when given a falsy value", () => {
    expect(secPerBar(0)).toBeCloseTo(2, 5);
    expect(secPerBar(undefined)).toBeCloseTo(2, 5);
  });
  test("140 BPM", () => {
    expect(secPerBar(140)).toBeCloseTo((60 / 140) * 4, 5);
  });
});

describe("formatBarLength", () => {
  test("exactly 2 bars at 120 BPM", () => {
    expect(formatBarLength(0, 4, 120)).toBe("2 bars");
  });
  test("exactly 1 bar reads singular", () => {
    expect(formatBarLength(0, 2, 120)).toBe("1 bar");
  });
  test("a fractional bar length rounds to the nearest quarter-bar", () => {
    expect(formatBarLength(0, 3.05, 120)).toBe("1.5 bars"); // 3.05s / 2s = 1.525 -> 1.5
  });
  test("zero-length slot reads as em dash, not '0 bars'", () => {
    expect(formatBarLength(0, 0, 120)).toBe("—");
  });
  test("inverted start/end (bad data) also reads as em dash", () => {
    expect(formatBarLength(4, 1, 120)).toBe("—");
  });
  test("respects a different project BPM", () => {
    // 140 BPM -> ~1.714s/bar; a 4s loop is ~2.33 bars -> rounds to 2.25
    expect(formatBarLength(0, 4, 140)).toBe("2.25 bars");
  });
});
