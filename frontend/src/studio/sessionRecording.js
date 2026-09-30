/* "Record to Timeline" (speed-beatmaker backlog item #1, Ableton-style "Record to Arrangement"):
   converts a performed Session clip-slot span — a lane playing one looping clip-slot from
   startTimelineSec to endTimelineSec — into real, non-looping Timeline clips. A Timeline clip
   never loops, so a span longer than one loop cycle has to be tiled into back-to-back repeats
   of the source window, ending in a shortened final clip if the recorded duration doesn't land
   on an exact multiple of the loop length. Pure and DOM/audio-free so it's directly testable. */

const MIN_REMAINDER_SEC = 0.02;

export const tileRecordedSpanIntoClips = (span) => {
  const loopLen = Number(span?.srcEndSec) - Number(span?.srcStartSec);
  const spanLen = Number(span?.endTimelineSec) - Number(span?.startTimelineSec);
  if (!(loopLen > 0) || !(spanLen > 0) || !span?.laneId) return [];

  const base = {
    laneId: span.laneId,
    sourceAssetId: span.assetId ?? null,
    gainDb: Number(span.gainDb) || 0,
    clipType: span.clipType === "midi" ? "midi" : "audio",
    midi: span.clipType === "midi" ? span.midi || null : null,
    label: span.label || null,
  };

  // Floating-point-safe cycle count: a recorded span that lands almost exactly on N cycles
  // (clock drift from setTimeout scheduling) shouldn't spawn a near-zero Nth+1 sliver clip.
  const fullCycles = Math.floor((spanLen + 1e-6) / loopLen);
  const clips = [];
  for (let i = 0; i < fullCycles; i += 1) {
    clips.push({
      ...base,
      srcStartSec: span.srcStartSec,
      srcEndSec: span.srcEndSec,
      timelineStartSec: span.startTimelineSec + i * loopLen,
    });
  }

  const remainder = spanLen - fullCycles * loopLen;
  if (remainder > MIN_REMAINDER_SEC) {
    clips.push({
      ...base,
      srcStartSec: span.srcStartSec,
      srcEndSec: span.srcStartSec + remainder,
      timelineStartSec: span.startTimelineSec + fullCycles * loopLen,
    });
  }

  return clips;
};

/* One span per lane, keyed by laneId — mirrors triggerClipSlot's own "one clip-slot playing per
   lane at a time" rule, so recording never needs to reconcile overlapping spans on the same
   lane. Returns the full flat clip list ready for actions.addTimelineClips(...). */
export const tileRecordedSpansIntoClips = (spansByLaneId) =>
  Object.values(spansByLaneId || {}).flatMap((span) => tileRecordedSpanIntoClips(span));
