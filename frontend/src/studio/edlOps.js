const MIN_CLIP_LENGTH = 0.01;

const makeId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `clip-${Math.random().toString(16).slice(2)}`;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const clipLength = (clip) => Math.max(0, (clip.srcEndSec ?? 0) - (clip.srcStartSec ?? 0));

export const splitClip = (clips, clipId, atTimeSec) => {
  const next = [];
  let didSplit = false;

  for (const clip of clips) {
    if (clip.id !== clipId) {
      next.push(clip);
      continue;
    }

    const length = clipLength(clip);
    if (length <= MIN_CLIP_LENGTH) {
      next.push(clip);
      continue;
    }

    const localTime = atTimeSec - clip.timelineStartSec;
    if (localTime <= 0 || localTime >= length) {
      next.push(clip);
      continue;
    }

    const left = {
      ...clip,
      id: makeId(),
      srcEndSec: clip.srcStartSec + localTime,
      fadeOutSec: 0,
    };
    const right = {
      ...clip,
      id: makeId(),
      srcStartSec: clip.srcStartSec + localTime,
      timelineStartSec: atTimeSec,
      fadeInSec: 0,
    };

    next.push(left, right);
    didSplit = true;
  }

  return didSplit ? next : clips;
};

export const trimClipLeft = (clips, clipId, newEdgeTimeSec) => {
  return clips.map((clip) => {
    if (clip.id !== clipId) return clip;
    const length = clipLength(clip);
    const clipStart = clip.timelineStartSec;
    const clipEnd = clipStart + length;
    const nextEdge = clamp(newEdgeTimeSec, clipStart, clipEnd - MIN_CLIP_LENGTH);
    const delta = nextEdge - clipStart;
    return {
      ...clip,
      timelineStartSec: nextEdge,
      srcStartSec: clip.srcStartSec + delta,
    };
  });
};

export const trimClipRight = (clips, clipId, newEdgeTimeSec) => {
  return clips.map((clip) => {
    if (clip.id !== clipId) return clip;
    const length = clipLength(clip);
    const clipStart = clip.timelineStartSec;
    const clipEnd = clipStart + length;
    const nextEdge = clamp(newEdgeTimeSec, clipStart + MIN_CLIP_LENGTH, clipEnd);
    const newLength = nextEdge - clipStart;
    return {
      ...clip,
      srcEndSec: clip.srcStartSec + newLength,
    };
  });
};

export const moveClip = (clips, clipId, newTimelineStartSec, options = {}) => {
  const { snap = false, gridSec = 0.5, laneId } = options;
  const nextStart = snap ? Math.round(newTimelineStartSec / gridSec) * gridSec : newTimelineStartSec;
  return clips.map((clip) =>
    clip.id === clipId
      ? {
          ...clip,
          timelineStartSec: Math.max(0, nextStart),
          laneId: laneId ?? clip.laneId,
        }
      : clip
  );
};

export const deleteSelection = (clips, range, laneIds = null, clipIds = null) => {
  if (Array.isArray(clipIds) && clipIds.length) {
    const clipSet = new Set(clipIds);
    return clips.filter((clip) => !clipSet.has(clip.id));
  }

  if (!range) return clips;
  const { start, end } = range;
  const allowedLanes = Array.isArray(laneIds) ? new Set(laneIds) : null;
  return clips.filter((clip) => {
    if (allowedLanes && !allowedLanes.has(clip.laneId)) return true;
    const clipStart = clip.timelineStartSec;
    const clipEnd = clip.timelineStartSec + clipLength(clip);
    const overlaps = clipStart < end && clipEnd > start;
    return !overlaps;
  });
};

export const duplicateSelection = (clips, range, laneIds = null, pasteTimeSec = null) => {
  if (!range) return clips;
  const { start, end } = range;
  const allowedLanes = Array.isArray(laneIds) ? new Set(laneIds) : null;
  const selected = clips.filter((clip) => {
    if (allowedLanes && !allowedLanes.has(clip.laneId)) return false;
    const clipStart = clip.timelineStartSec;
    const clipEnd = clip.timelineStartSec + clipLength(clip);
    return clipStart < end && clipEnd > start;
  });
  if (!selected.length) return clips;
  const offset = pasteTimeSec != null ? pasteTimeSec - start : 0;
  const duplicates = selected.map((clip) => ({
    ...clip,
    id: makeId(),
    timelineStartSec: Math.max(0, clip.timelineStartSec + offset),
  }));
  return [...clips, ...duplicates];
};
