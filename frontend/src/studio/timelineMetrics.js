/* Timeline geometry, in one place.
 *
 * LANE_HEIGHT was declared twice — in Timeline.js and in SelectionOverlay.js —
 * so the selection rectangle and the lanes it highlights were kept in sync by
 * hand. The track list on the left also has to match, or the faders drift out
 * of line with the lanes they control.
 *
 * The previous 110px lane spent most of its height on nothing: a 90px clip
 * holding a 34px waveform, so ~69% of a track showed no information at all.
 * These values give the waveform the room instead.
 */
export const LANE_HEIGHT = 68;

/** Gap between one lane's clip and the next lane's. */
export const LANE_GUTTER = 6;

/** Height of the clip box itself, by what it has to show. */
export const CLIP_HEIGHT = LANE_HEIGHT - LANE_GUTTER;
export const CLIP_HEIGHT_WITH_LYRICS = CLIP_HEIGHT + 22;
export const CLIP_HEIGHT_WITH_EDITOR = CLIP_HEIGHT + 42;

/** Signal height inside the clip. The header now floats over the waveform
 *  rather than taking a row of its own, so this is the full inner height. */
export const WAVEFORM_HEIGHT = CLIP_HEIGHT - 8;
export const WAVEFORM_HEIGHT_WITH_LYRICS = WAVEFORM_HEIGHT - 18;

/* ---------------------------------------------------------------------------
 * Zoom
 *
 * pxPerSec = BASE_PX_PER_SEC * zoom. The slider used to run 0.5 → 2.5, i.e.
 * 40 → 200 px/s. A 161-second track needs ~4.6 px/s to fit a ~745px viewport,
 * so *no* position of that slider could show a whole song: at its widest the
 * view held about 11% of the track, and it opened at 6%.
 *
 * The range now reaches down far enough to frame a long track, and the slider
 * is logarithmic — a linear control over a 200:1 range would cram every useful
 * position into its first few pixels.
 * ------------------------------------------------------------------------- */
export const BASE_PX_PER_SEC = 80;
export const ZOOM_MIN = 0.015;
export const ZOOM_MAX = 4;

const LOG_MIN = Math.log(ZOOM_MIN);
const LOG_MAX = Math.log(ZOOM_MAX);

/* `Number(zoom) || 1` looked like a guard against NaN, but 0 is falsy too, so
   a zoom of 0 became 1 — a full zoom-in — while -5 correctly clamped to the
   minimum. Same class of input, opposite results. isFinite says what was
   meant: fall back only when there is no usable number. */
export const clampZoom = (zoom) => {
  // `zoom == null` catches both null and undefined; "" is the third way a
  // missing value arrives here (from an input element). All three mean "no
  // value", not "zero" — Number() would turn null and "" into 0 and clamp them
  // to the minimum, which is a real zoom level and not what was meant.
  if (zoom == null || zoom === "") return 1;
  const value = Number(zoom);
  if (!Number.isFinite(value)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
};

/** zoom → slider position in 0..1 */
export const zoomToSlider = (zoom) =>
  (Math.log(clampZoom(zoom)) - LOG_MIN) / (LOG_MAX - LOG_MIN);

/** slider position in 0..1 → zoom */
export const sliderToZoom = (position) => {
  const p = Math.min(1, Math.max(0, Number(position) || 0));
  return clampZoom(Math.exp(LOG_MIN + p * (LOG_MAX - LOG_MIN)));
};

/** The zoom that frames `durationSec` inside `widthPx`, with a little air. */
export const fitZoom = (durationSec, widthPx) => {
  const duration = Number(durationSec);
  const width = Number(widthPx);
  if (!(duration > 0) || !(width > 0)) return 1;
  return clampZoom((width - 32) / (duration * BASE_PX_PER_SEC));
};
