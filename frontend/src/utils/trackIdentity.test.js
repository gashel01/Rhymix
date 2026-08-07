import { IDENTITY_GRADIENTS, identityIndex, trackGradient } from "./trackIdentity";

describe("track identity", () => {
  it("is stable for the same name", () => {
    expect(identityIndex("Summer night")).toBe(identityIndex("Summer night"));
    expect(trackGradient("koko")).toBe(trackGradient("koko"));
  });

  it("does not depend on position, so filtering or sorting cannot change it", () => {
    // The reason the hash is over the name and not the row index: a track keeps
    // its colour when the list is filtered, sorted or paginated.
    const before = ["a", "b", "c"].map(identityIndex);
    const after = ["c", "a", "b"].map(identityIndex);
    expect(after).toEqual([before[2], before[0], before[1]]);
  });

  it("stays inside the palette", () => {
    for (const name of ["", "x", "a much longer track name", "é#!", "123"]) {
      const i = identityIndex(name);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(IDENTITY_GRADIENTS.length);
    }
  });

  it("separates names that differ only in their last character", () => {
    // A plain character sum collides on "Take 1" / "Take 2"; FNV-1a does not.
    expect(identityIndex("Take 1")).not.toBe(identityIndex("Take 2"));
  });

  it("does not collide on anagrams", () => {
    // Another thing a sum gets wrong.
    expect(identityIndex("listen")).not.toBe(identityIndex("silent"));
  });

  it("handles missing names without throwing", () => {
    expect(() => identityIndex(undefined)).not.toThrow();
    expect(() => trackGradient(null)).not.toThrow();
    expect(trackGradient(undefined)).toContain("linear-gradient");
  });

  it("spreads a realistic set of names across the palette", () => {
    const names = ["koko", "Summer night", "Static in my skull", "cera senal 2",
                   "Test", "demo", "vocals only", "take 3"];
    const used = new Set(names.map(identityIndex));
    // Not a guarantee of perfect distribution — just that it is not constant.
    expect(used.size).toBeGreaterThan(1);
  });
});
