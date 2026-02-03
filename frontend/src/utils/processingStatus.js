const PROCESSING_STATE_RANK = {
  queued: 0,
  uploading: 1,
  processing: 2,
  ready: 3,
  error: 3,
};

const normalizeState = (state) => String(state || "").toLowerCase();

const parseUpdatedAt = (value) => {
  const ts = Date.parse(value || "");
  return Number.isNaN(ts) ? 0 : ts;
};

export const isTerminalProcessingState = (state) => {
  const normalized = normalizeState(state);
  return normalized === "ready" || normalized === "error";
};

export const mergeProcessingUpdate = (current, incoming) => {
  if (!incoming) return current || null;
  if (!current) return incoming;

  const currState = normalizeState(current.state || "ready");
  const nextState = normalizeState(incoming.state || currState);
  const currRank = PROCESSING_STATE_RANK[currState] ?? 2;
  const nextRank = PROCESSING_STATE_RANK[nextState] ?? 2;

  const currTerminal = isTerminalProcessingState(currState);
  const nextTerminal = isTerminalProcessingState(nextState);
  if (currTerminal && !nextTerminal) return current;
  if (nextTerminal && !currTerminal) return incoming;

  if (nextRank > currRank) return incoming;
  if (nextRank < currRank) return current;

  const currTs = parseUpdatedAt(current.updatedAt);
  const nextTs = parseUpdatedAt(incoming.updatedAt);
  if (nextTs > currTs) return incoming;

  return current;
};

export const processingEquals = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.state === b.state &&
    a.step === b.step &&
    a.message === b.message &&
    a.progress === b.progress &&
    a.updatedAt === b.updatedAt
  );
};
