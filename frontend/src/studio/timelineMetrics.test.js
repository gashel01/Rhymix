import {
  BASE_PX_PER_SEC,
  CLIP_HEIGHT,
  LANE_GUTTER,
  LANE_HEIGHT,
  WAVEFORM_HEIGHT,
  ZOOM_MAX,
  ZOOM_MIN,
  clampZoom,
  fitZoom,
  sliderToZoom,
  zoomToSlider,
} from "./timelineMetrics";

describe("lane geometry", () => {
  it("keeps the clip inside its lane", () => {
    expect(CLIP_HEIGHT).toBe(LANE_HEIGHT - LANE_GUTTER);
    expect(CLIP_HEIGHT).toBeLessThan(LANE_HEIGHT);
  });

  it("gives the waveform most of the clip", () => {
    // The whole point of the density pass: the signal used to occupy 31% of a
    // lane. Anything below half means the box is mostly empty again.
    expect(WAVEFORM_HEIGHT / LANE_HEIGHT).toBeGreaterThan(0.5);
  });
});

describe("clampZoom", () => {
  it("holds the range", () => {
    expect(clampZoom(999)).toBe(ZOOM_MAX);
    expect(clampZoom(0)).toBe(ZOOM_MIN);
    expect(clampZoom(-5)).toBe(ZOOM_MIN);
  });

  it("falls back to 1 for values that are not numbers", () => {
    expect(clampZoom(undefined)).toBe(1);
    expect(clampZoom(null)).toBe(1);
    expect(clampZoom("wide")).toBe(1);
  });
});

describe("zoom slider mapping", () => {
  it("spans the full range end to end", () => {
    expect(sliderToZoom(0)).toBeCloseTo(ZOOM_MIN, 5);
    expect(sliderToZoom(1)).toBeCloseTo(ZOOM_MAX, 5);
  });

  it("round-trips", () => {
    for (const zoom of [ZOOM_MIN, 0.05, 0.5, 1, 2.5, ZOOM_MAX]) {
      expect(sliderToZoom(zoomToSlider(zoom))).toBeCloseTo(zoom, 6);
    }
  });

  it("is monotonic", () => {
    const positions = [0, 0.2, 0.4, 0.6, 0.8, 1];
    const zooms = positions.map(sliderToZoom);
    for (let i = 1; i < zooms.length; i += 1) {
      expect(zooms[i]).toBeGreaterThan(zooms[i - 1]);
    }
  });

  it("is logarithmic, not linear", () => {
    // A linear control over a 260:1 range puts every song-length position in
    // its first pixels. Half-way should be the geometric mean, not the
    // arithmetic one.
    const mid = sliderToZoom(0.5);
    const geometric = Math.sqrt(ZOOM_MIN * ZOOM_MAX);
    const arithmetic = (ZOOM_MIN + ZOOM_MAX) / 2;
    expect(mid).toBeCloseTo(geometric, 4);
    expect(Math.abs(mid - arithmetic)).toBeGreaterThan(1);
  });

  it("clamps out-of-range slider positions instead of extrapolating", () => {
    expect(sliderToZoom(-1)).toBeCloseTo(ZOOM_MIN, 5);
    expect(sliderToZoom(4)).toBeCloseTo(ZOOM_MAX, 5);
  });
});

describe("fitZoom", () => {
  it("frames a whole track inside the viewport", () => {
    const width = 745;
    const duration = 161;
    const zoom = fitZoom(duration, width);
    expect(duration * zoom * BASE_PX_PER_SEC).toBeLessThanOrEqual(width);
  });

  it("reaches low enough for a long track, which the old 0.5 floor did not", () => {
    // The regression this exists for: the slider used to bottom out at 0.5,
    // i.e. 40px/s, so a three-minute song could not be framed at any position.
    const zoom = fitZoom(161, 745);
    expect(zoom).toBeLessThan(0.5);
    expect(zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
  });

  it("never returns a zoom outside the slider's own range", () => {
    for (const [duration, width] of [[1, 4000], [10000, 100], [0.5, 800]]) {
      const zoom = fitZoom(duration, width);
      expect(zoom).toBeGreaterThanOrEqual(ZOOM_MIN);
      expect(zoom).toBeLessThanOrEqual(ZOOM_MAX);
    }
  });

  it("falls back to 1 rather than dividing by zero", () => {
    expect(fitZoom(0, 800)).toBe(1);
    expect(fitZoom(100, 0)).toBe(1);
    expect(fitZoom(undefined, undefined)).toBe(1);
  });
});
