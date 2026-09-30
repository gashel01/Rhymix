import { CATEGORY_COLORS, ensureLaneColors, resolveLaneColor } from "./laneColors";

const LEGACY = {
  mix: "#2a6f97",
  vocal: "#ff7a59",
  instrumental: "#6fbf73",
  stem: "#b084f5",
  generated: "#ffb454",
};

describe("resolveLaneColor", () => {
  it("gives a typed lane its category colour", () => {
    expect(resolveLaneColor({ type: "vocal" })).toBe(CATEGORY_COLORS.vocal);
  });

  it("keeps a colour the user chose", () => {
    expect(resolveLaneColor({ type: "vocal", color: "#123456" })).toBe("#123456");
  });

  it("upgrades a lane still wearing exactly its old category colour", () => {
    // Lane colours are persisted per project, so every project made before the
    // palette change carries the old muted hues. The timeline now paints clips
    // at full strength, where those read as washed out.
    expect(resolveLaneColor({ type: "vocal", color: LEGACY.vocal })).toBe(CATEGORY_COLORS.vocal);
    expect(resolveLaneColor({ type: "stem", color: LEGACY.stem })).toBe(CATEGORY_COLORS.stem);
  });

  it("is case-insensitive about the legacy value", () => {
    expect(resolveLaneColor({ type: "vocal", color: LEGACY.vocal.toUpperCase() }))
      .toBe(CATEGORY_COLORS.vocal);
  });

  it("does not upgrade a legacy colour sitting on a different category", () => {
    // The remap is "this lane still has ITS OWN old colour", not "this colour
    // appears in the old palette" — otherwise a deliberate choice that happens
    // to match another category's old value would be overwritten.
    expect(resolveLaneColor({ type: "vocal", color: LEGACY.instrumental }))
      .toBe(LEGACY.instrumental);
  });

  it("falls back to an auto colour for an unknown type", () => {
    expect(typeof resolveLaneColor({ type: "nonsense" })).toBe("string");
    expect(resolveLaneColor({ type: "nonsense" })).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("ensureLaneColors", () => {
  it("assigns a colour to every lane", () => {
    const lanes = ensureLaneColors([{ id: "1", type: "vocal" }, { id: "2" }, { id: "3" }]);
    lanes.forEach((lane) => expect(lane.color).toMatch(/^#[0-9a-f]{6}$/i));
  });

  it("does not mutate its input", () => {
    const input = [{ id: "1", type: "vocal" }];
    const output = ensureLaneColors(input);
    expect(input[0].color).toBeUndefined();
    expect(output[0].color).toBe(CATEGORY_COLORS.vocal);
  });

  it("remaps legacy colours on load", () => {
    const [lane] = ensureLaneColors([{ id: "1", type: "vocal", color: LEGACY.vocal }]);
    expect(lane.color).toBe(CATEGORY_COLORS.vocal);
  });

  it("leaves a hand-picked colour alone", () => {
    const [lane] = ensureLaneColors([{ id: "1", type: "vocal", color: "#abcdef" }]);
    expect(lane.color).toBe("#abcdef");
  });

  it("gives untyped lanes distinct colours", () => {
    const lanes = ensureLaneColors([{ id: "1" }, { id: "2" }, { id: "3" }]);
    expect(new Set(lanes.map((l) => l.color)).size).toBe(3);
  });

  it("never hands a lane the UI accent", () => {
    // #ff9f0a means "primary action" everywhere else; a lane wearing it would
    // read as selected.
    const lanes = ensureLaneColors(
      Array.from({ length: 12 }, (_, i) => ({ id: String(i) }))
    );
    lanes.forEach((lane) => expect(lane.color.toLowerCase()).not.toBe("#ff9f0a"));
  });

  it("handles an empty list", () => {
    expect(ensureLaneColors([])).toEqual([]);
  });
});
