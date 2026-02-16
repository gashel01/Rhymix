const ticksToSec = (ticks, bpm, ppq) => {
  const safeBpm = Number(bpm) || 120;
  const safePpq = Number(ppq) || 480;
  return ticks / ((safeBpm * safePpq) / 60);
};

const makeLaneId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `lane-${Math.random().toString(16).slice(2)}`;
};

export const insertMidiClip = ({
  actions,
  lanes,
  project,
  transport,
  targetLaneId,
  createNewLane,
  instrument,
  clip,
  startTick,
  applyDetectedBpm,
}) => {
  if (!clip) return null;
  const resolvedPpq = clip.ppq || 480;
  const resolvedBpm = project?.bpm || clip.bpm || 120;

  let laneId = targetLaneId;
  if (createNewLane || !laneId) {
    laneId = makeLaneId();
    const timestamp = new Date().toLocaleTimeString();
    actions.addLane({
      id: laneId,
      type: "midi",
      name: `${instrument || "MIDI"} ${timestamp}`,
      instrument: instrument || clip.instrument || null,
    });
  }

  if (!project?.bpm && applyDetectedBpm && clip.bpm) {
    actions.updateProject({ bpm: clip.bpm });
    const gridDiv = 1;
    actions.setUi({ gridDiv, gridSec: 60 / clip.bpm / gridDiv });
  }

  const startTickResolved = Number.isFinite(Number(startTick)) ? Number(startTick) : 0;
  actions.addMidiClip(laneId, clip, startTickResolved, resolvedBpm, resolvedPpq);
  return laneId;
};
