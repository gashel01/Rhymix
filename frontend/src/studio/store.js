import React, { createContext, useContext, useMemo, useReducer } from "react";
import {
  splitClip,
  trimClipLeft,
  trimClipRight,
  moveClip,
  deleteSelection,
  duplicateSelection,
} from "./edlOps";
import { ensureLaneColors, resolveLaneColor } from "./laneColors";

const StudioStateContext = createContext(null);
const StudioDispatchContext = createContext(null);

const deepClone = (value) => {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};

const initialState = {
  project: null,
  lanes: [],
  clips: [],
  assets: {},
  metadata: {},
  selection: {
    clipIds: [],
    range: null,
    laneIds: null,
  },
  transport: {
    isPlaying: false,
    currentTime: 0,
  },
  ui: {
    zoom: 1,
    snap: true,
    gridSec: 0.5,
    gridDiv: 1,
    metronome: false,
    loop: false,
    showCreatePanel: true,
    showLibraryPanel: true,
    showDetailsPanel: true,
    railCollapsed: false,
    midiEditorOpen: false,
  },
  history: {
    past: [],
    future: [],
  },
};

const makeId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `lane-${Math.random().toString(16).slice(2)}`;
};

const ticksToSec = (ticks, bpm, ppq) => {
  const safeBpm = Number(bpm) || 120;
  const safePpq = Number(ppq) || 480;
  const tps = (safeBpm * safePpq) / 60;
  return ticks / tps;
};

const snapshotState = (state) => ({
  project: deepClone(state.project),
  lanes: deepClone(state.lanes),
  clips: deepClone(state.clips),
  metadata: deepClone(state.metadata),
  selection: deepClone(state.selection),
});

const applyEdlChange = (state, nextEdl) => {
  const past = [...state.history.past, snapshotState(state)];
  return {
    ...state,
    ...nextEdl,
    history: {
      past,
      future: [],
    },
  };
};

const shiftLyricsEntries = (entries, delta) => {
  if (!entries || !Number.isFinite(delta) || Math.abs(delta) < 1e-6) return entries;
  const list = Array.isArray(entries) ? entries : [entries];
  const next = list.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const out = { ...entry };
    if (entry.range && Number.isFinite(entry.range.start) && Number.isFinite(entry.range.end)) {
      out.range = {
        start: Number(entry.range.start) + delta,
        end: Number(entry.range.end) + delta,
      };
    }
    if (entry.clipStartAtTranscribe != null && Number.isFinite(Number(entry.clipStartAtTranscribe))) {
      out.clipStartAtTranscribe = Number(entry.clipStartAtTranscribe) + delta;
    }
    return out;
  });
  return Array.isArray(entries) ? next : next[0];
};

const studioReducer = (state, action) => {
  switch (action.type) {
    case "SET_PROJECT": {
      const bpm = action.payload.project?.bpm || 120;
      const gridDiv = state.ui.gridDiv || 1;
      const lanes = ensureLaneColors(action.payload.lanes || []);
      return {
        ...state,
        project: action.payload.project,
        lanes,
        clips: action.payload.clips || [],
        assets: action.payload.assets || {},
        metadata: action.payload.metadata || {},
        selection: { clipIds: [], range: null, laneIds: null },
        ui: { ...state.ui, gridSec: 60 / bpm / gridDiv },
        history: { past: [], future: [] },
      };
    }
    case "UPDATE_PROJECT": {
      const nextProject = { ...(state.project || {}), ...(action.payload || {}) };
      return {
        ...state,
        project: nextProject,
      };
    }
    case "SET_SELECTION":
      return {
        ...state,
        selection: { ...state.selection, ...action.payload },
      };
    case "UPDATE_METADATA": {
      return {
        ...state,
        metadata: { ...(state.metadata || {}), ...(action.payload || {}) },
      };
    }
    case "SET_UI":
      return {
        ...state,
        ui: { ...state.ui, ...action.payload },
      };
    case "SET_TRANSPORT":
      return {
        ...state,
        transport: { ...state.transport, ...action.payload },
      };
    case "UPDATE_LANE": {
      const lanes = state.lanes.map((lane) =>
        lane.id === action.payload.laneId ? { ...lane, ...action.payload.patch } : lane
      );
      return applyEdlChange(state, { lanes });
    }
    case "ADD_CLIP": {
      const { laneId, assetId, startSec, durationSec } = action.payload;
      if (!laneId || !assetId) return state;
      const asset = state.assets?.[assetId];
      const resolvedDuration = Math.max(0.01, Number(durationSec ?? asset?.durationSec ?? 5));
      const clip = {
        id: makeId(),
        laneId,
        sourceAssetId: assetId,
        srcStartSec: 0,
        srcEndSec: resolvedDuration,
        timelineStartSec: Math.max(0, Number(startSec ?? 0)),
        fadeInSec: 0,
        fadeOutSec: 0,
        gainDb: 0,
      };
      return applyEdlChange(state, { clips: [...state.clips, clip] });
    }
    case "REORDER_LANES": {
      const orderedIds = action.payload.laneIds || [];
      const laneMap = new Map(state.lanes.map((lane) => [lane.id, lane]));
      const next = [];
      orderedIds.forEach((laneId, index) => {
        const lane = laneMap.get(laneId);
        if (lane) {
          next.push({ ...lane, order: index + 1 });
          laneMap.delete(laneId);
        }
      });
      if (laneMap.size) {
        laneMap.forEach((lane) => next.push(lane));
      }
      return applyEdlChange(state, { lanes: next });
    }
    case "ADD_LANE": {
      const order = Math.max(0, ...state.lanes.map((lane) => Number(lane.order) || 0)) + 1;
      const color = resolveLaneColor(action.payload, state.lanes);
      const lane = {
        id: action.payload.id || makeId(),
        projectId: state.project?.id,
        type: action.payload.type || "custom",
        name: action.payload.name || "Lane",
        instrument: action.payload.instrument || null,
        sourceAssetId: null,
        mute: false,
        solo: false,
        gainDb: 0,
        color: color || null,
        fx: action.payload.fx || {},
        order,
      };
      return applyEdlChange(state, { lanes: [...state.lanes, lane] });
    }
    case "ADD_MIDI_CLIP": {
      const { laneId, clip, startTick, bpm, ppq } = action.payload;
      if (!laneId || !clip) return state;
      const resolvedBpm = Number(bpm) || clip.bpm || state.project?.bpm || 120;
      const resolvedPpq = Number(ppq) || clip.ppq || 480;
      const notes = Array.isArray(clip.notes) ? clip.notes : [];
      let maxTick = 0;
      notes.forEach((note) => {
        const end = (note.startTick || 0) + (note.durationTick || 0);
        if (end > maxTick) maxTick = end;
      });
      const durationSec = maxTick > 0 ? ticksToSec(maxTick, resolvedBpm, resolvedPpq) : 0.5;
      const startSec = ticksToSec(startTick || 0, resolvedBpm, resolvedPpq);
      const clipEntry = {
        id: makeId(),
        laneId,
        sourceAssetId: null,
        srcStartSec: 0,
        srcEndSec: Math.max(0.01, durationSec),
        timelineStartSec: Math.max(0, startSec),
        fadeInSec: 0,
        fadeOutSec: 0,
        gainDb: 0,
        clipType: "midi",
        midi: clip,
        label: clip.instrument ? `MIDI · ${clip.instrument}` : "MIDI Clip",
      };
      return applyEdlChange(state, { clips: [...state.clips, clipEntry] });
    }
    case "UPDATE_CLIP": {
      const { clipId, patch } = action.payload;
      if (!clipId || !patch) return state;
      const clips = state.clips.map((clip) =>
        clip.id === clipId ? { ...clip, ...patch } : clip
      );
      return applyEdlChange(state, { clips });
    }
    case "REMOVE_LANE": {
      const laneId = action.payload.laneId;
      const lanes = state.lanes.filter((lane) => lane.id !== laneId);
      const clips = state.clips.filter((clip) => clip.laneId !== laneId);
      return applyEdlChange(state, { lanes, clips, selection: { clipIds: [], range: null, laneIds: null } });
    }
    case "REMOVE_ALL_LANES": {
      return applyEdlChange(state, { lanes: [], clips: [], selection: { clipIds: [], range: null, laneIds: null } });
    }
    case "SPLIT_CLIP": {
      const clips = splitClip(state.clips, action.payload.clipId, action.payload.atTimeSec);
      return applyEdlChange(state, { clips });
    }
    case "TRIM_CLIP_LEFT": {
      const clips = trimClipLeft(state.clips, action.payload.clipId, action.payload.newEdgeTimeSec);
      return applyEdlChange(state, { clips });
    }
    case "TRIM_CLIP_RIGHT": {
      const clips = trimClipRight(state.clips, action.payload.clipId, action.payload.newEdgeTimeSec);
      return applyEdlChange(state, { clips });
    }
    case "MOVE_CLIP": {
      const prevClip = state.clips.find((clip) => clip.id === action.payload.clipId);
      const prevStartSec = Number(prevClip?.timelineStartSec);
      const clips = moveClip(state.clips, action.payload.clipId, action.payload.newTimelineStartSec, {
        snap: state.ui.snap,
        gridSec: state.ui.gridSec,
        laneId: action.payload.laneId,
      });
      let metadata = state.metadata;
      if (prevClip && Number.isFinite(prevStartSec)) {
        const nextClip = clips.find((clip) => clip.id === action.payload.clipId);
        const nextStartSec = Number(nextClip?.timelineStartSec);
        if (Number.isFinite(nextStartSec)) {
          const delta = nextStartSec - prevStartSec;
          const lyricsReplacement = state.metadata?.lyricsReplacement;
          if (Math.abs(delta) > 1e-6 && lyricsReplacement && lyricsReplacement[prevClip.id]) {
            metadata = {
              ...(state.metadata || {}),
              lyricsReplacement: {
                ...lyricsReplacement,
                [prevClip.id]: shiftLyricsEntries(lyricsReplacement[prevClip.id], delta),
              },
            };
          }
        }
      }
      return applyEdlChange(state, { clips, metadata });
    }
    case "DELETE_SELECTION": {
      const clips = deleteSelection(
        state.clips,
        action.payload.range,
        action.payload.laneIds,
        action.payload.clipIds
      );
      return applyEdlChange(state, { clips, selection: { clipIds: [], range: null, laneIds: null } });
    }
    case "DUPLICATE_SELECTION": {
      const clips = duplicateSelection(
        state.clips,
        action.payload.range,
        action.payload.laneIds,
        action.payload.pasteTimeSec
      );
      return applyEdlChange(state, { clips });
    }
    case "DUPLICATE_LANE": {
      const laneId = action.payload.laneId;
      const source = state.lanes.find((lane) => lane.id === laneId);
      if (!source) return state;
      const nextId = makeId();
      const order = Math.max(0, ...state.lanes.map((lane) => Number(lane.order) || 0)) + 1;
      const nextLane = {
        ...deepClone(source),
        id: nextId,
        name: source.name ? `${source.name} Copy` : "Lane Copy",
        order,
      };
      const nextClips = state.clips
        .filter((clip) => clip.laneId === laneId)
        .map((clip) => ({
          ...deepClone(clip),
          id: makeId(),
          laneId: nextId,
        }));
      return applyEdlChange(state, { lanes: [...state.lanes, nextLane], clips: [...state.clips, ...nextClips] });
    }
    case "UNDO": {
      const past = [...state.history.past];
      if (!past.length) return state;
      const previous = past.pop();
    return {
        ...state,
        ...previous,
        history: {
          past,
          future: [snapshotState(state), ...state.history.future],
        },
      };
    }
    case "REDO": {
      const future = [...state.history.future];
      if (!future.length) return state;
      const next = future.shift();
      return {
        ...state,
        ...next,
        history: {
          past: [...state.history.past, snapshotState(state)],
          future,
        },
      };
    }
    default:
      return state;
  }
};

export const StudioProvider = ({ children }) => {
  const [state, dispatch] = useReducer(studioReducer, initialState);
  return (
    <StudioStateContext.Provider value={state}>
      <StudioDispatchContext.Provider value={dispatch}>
        {children}
      </StudioDispatchContext.Provider>
    </StudioStateContext.Provider>
  );
};

export const useStudioState = () => {
  const ctx = useContext(StudioStateContext);
  if (!ctx) throw new Error("useStudioState must be used within StudioProvider");
  return ctx;
};

export const useStudioActions = () => {
  const dispatch = useContext(StudioDispatchContext);
  if (!dispatch) throw new Error("useStudioActions must be used within StudioProvider");

  return useMemo(
    () => ({
      setProject: (payload) => dispatch({ type: "SET_PROJECT", payload }),
      updateProject: (patch) => dispatch({ type: "UPDATE_PROJECT", payload: patch }),
      updateMetadata: (patch) => dispatch({ type: "UPDATE_METADATA", payload: patch }),
      setSelection: (payload) => dispatch({ type: "SET_SELECTION", payload }),
      setUi: (payload) => dispatch({ type: "SET_UI", payload }),
      setTransport: (payload) => dispatch({ type: "SET_TRANSPORT", payload }),
      updateLane: (laneId, patch) => dispatch({ type: "UPDATE_LANE", payload: { laneId, patch } }),
      addClip: (laneId, assetId, startSec, durationSec) =>
        dispatch({ type: "ADD_CLIP", payload: { laneId, assetId, startSec, durationSec } }),
      reorderLanes: (laneIds) => dispatch({ type: "REORDER_LANES", payload: { laneIds } }),
      addLane: (payload) => dispatch({ type: "ADD_LANE", payload }),
      removeLane: (laneId) => dispatch({ type: "REMOVE_LANE", payload: { laneId } }),
      addMidiClip: (laneId, clip, startTick, bpm, ppq) =>
        dispatch({ type: "ADD_MIDI_CLIP", payload: { laneId, clip, startTick, bpm, ppq } }),
      updateClip: (clipId, patch) => dispatch({ type: "UPDATE_CLIP", payload: { clipId, patch } }),
      splitClip: (clipId, atTimeSec) => dispatch({ type: "SPLIT_CLIP", payload: { clipId, atTimeSec } }),
      trimClipLeft: (clipId, newEdgeTimeSec) =>
        dispatch({ type: "TRIM_CLIP_LEFT", payload: { clipId, newEdgeTimeSec } }),
      trimClipRight: (clipId, newEdgeTimeSec) =>
        dispatch({ type: "TRIM_CLIP_RIGHT", payload: { clipId, newEdgeTimeSec } }),
      moveClip: (clipId, newTimelineStartSec) =>
        dispatch({ type: "MOVE_CLIP", payload: { clipId, newTimelineStartSec } }),
      moveClipToLane: (clipId, newTimelineStartSec, laneId) =>
        dispatch({ type: "MOVE_CLIP", payload: { clipId, newTimelineStartSec, laneId } }),
      deleteSelection: (range, laneIds, clipIds) =>
        dispatch({ type: "DELETE_SELECTION", payload: { range, laneIds, clipIds } }),
      duplicateSelection: (range, laneIds, pasteTimeSec) =>
        dispatch({ type: "DUPLICATE_SELECTION", payload: { range, laneIds, pasteTimeSec } }),
      duplicateLane: (laneId) => dispatch({ type: "DUPLICATE_LANE", payload: { laneId } }),
      deleteAllLanes: () => dispatch({ type: "REMOVE_ALL_LANES" }),
      undo: () => dispatch({ type: "UNDO" }),
      redo: () => dispatch({ type: "REDO" }),
    }),
    [dispatch]
  );
};

export const useStudioStore = () => {
  const state = useStudioState();
  const actions = useStudioActions();
  return { state, actions };
};
