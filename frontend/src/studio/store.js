import React, { createContext, useContext, useMemo, useReducer } from "react";
import {
  splitClip,
  trimClipLeft,
  trimClipRight,
  moveClip,
  moveClips,
  deleteSelection,
  duplicateSelection,
} from "./edlOps";
import { ensureLaneColors, resolveLaneColor } from "./laneColors";
import { ticksToSec } from "./audioMath";
import { getMasterVolume, getMasterPan } from "../masterAudio";

const StudioStateContext = createContext(null);
const StudioDispatchContext = createContext(null);

const deepClone = (value) => {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};

export const initialState = {
  project: null,
  lanes: [],
  clips: [],
  assets: {},
  metadata: {},
  /* Session/pattern view (non-linear clip launch, speed-beatmaker backlog item #1) — independent
     of clips' timelineStartSec: a scene is a "row" (state.scenes), a clip slot is one cell of the
     grid (scene × lane), state.clipSlots holds at most one slot per (sceneId, laneId) pair. */
  scenes: [],
  clipSlots: [],
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
    masterVolume: 1,
    masterPan: 0,
    gridSec: 0.5,
    gridDiv: 1,
    metronome: false,
    loop: false,
    workspaceSection: "edit",
    inspectorSection: "clip",
    focusMode: false,
    rightPanelContext: "nothing",
    expandedAiCard: "live",
    drawerTool: "live",
    drawerOpen: false,
    activityFilter: "all",
    showCreatePanel: false,
    showLibraryPanel: false,
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

const snapshotState = (state) => ({
  project: deepClone(state.project),
  lanes: deepClone(state.lanes),
  clips: deepClone(state.clips),
  metadata: deepClone(state.metadata),
  selection: deepClone(state.selection),
  scenes: deepClone(state.scenes),
  clipSlots: deepClone(state.clipSlots),
});

// Each entry is a deep copy of the whole EDL, so an unbounded stack grows with
// every edit for the life of the session. Fifty steps is far more than anyone
// reaches for, and it keeps a long editing session flat in memory.
const MAX_HISTORY = 50;

const applyEdlChange = (state, nextEdl) => {
  const past = [...state.history.past, snapshotState(state)].slice(-MAX_HISTORY);
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

export const studioReducer = (state, action) => {
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
        scenes: action.payload.scenes || [],
        clipSlots: action.payload.clipSlots || [],
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
      const { laneId, assetId, startSec, durationSec, tempoRate } = action.payload;
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
        // Playback-rate-based BPM match from the drag-drop "stretch to match" prompt (Timeline.js
        // handleExternalDrop) — a simple speed change, not a pitch-preserving time-stretch, so
        // matching tempo also shifts pitch; that tradeoff is disclosed to the user at drop time.
        // 1 = play at native speed (the default/only option before this existed).
        tempoRate: Number(tempoRate) > 0 ? Number(tempoRate) : 1,
      };
      return applyEdlChange(state, { clips: [...state.clips, clip] });
    }
    /* "Record to Timeline" (Ableton-style "Record to Arrangement" for the Session view, backlog
       item #1): materializes a whole performed take — possibly dozens of tiled repeats across
       several lanes, see sessionRecording.js's tileRecordedSpansIntoClips — as ONE history entry,
       so undo removes the whole take in one step rather than one undo per tiny tiled clip. Each
       spec is already a fully-formed clip shape (tileRecordedSpansIntoClips' job), this just fills
       in the fields every clip needs regardless of origin (id, fade/tempo defaults). */
    case "ADD_TIMELINE_CLIPS": {
      const specs = Array.isArray(action.payload?.clips) ? action.payload.clips : [];
      if (!specs.length) return state;
      const newClips = specs.map((spec) => {
        const clip = {
          id: makeId(),
          laneId: spec.laneId,
          sourceAssetId: spec.sourceAssetId ?? null,
          srcStartSec: Number(spec.srcStartSec) || 0,
          srcEndSec: Math.max(0.01, Number(spec.srcEndSec) || 0.01),
          timelineStartSec: Math.max(0, Number(spec.timelineStartSec) || 0),
          fadeInSec: 0,
          fadeOutSec: 0,
          gainDb: Number(spec.gainDb) || 0,
          tempoRate: 1,
        };
        if (spec.clipType === "midi") {
          clip.clipType = "midi";
          clip.midi = spec.midi || null;
          if (spec.label) clip.label = spec.label;
        }
        return clip;
      });
      return applyEdlChange(state, { clips: [...state.clips, ...newClips] });
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
      const { laneId, clip, startTick, bpm, ppq, minDurationSec } = action.payload;
      if (!laneId || !clip) return state;
      const resolvedBpm = Number(bpm) || clip.bpm || state.project?.bpm || 120;
      const resolvedPpq = Number(ppq) || clip.ppq || 480;
      const notes = Array.isArray(clip.notes) ? clip.notes : [];
      let maxTick = 0;
      notes.forEach((note) => {
        const end = (note.startTick || 0) + (note.durationTick || 0);
        if (end > maxTick) maxTick = end;
      });
      const notesDurationSec = maxTick > 0 ? ticksToSec(maxTick, resolvedBpm, resolvedPpq) : 0;
      const durationSec = Math.max(notesDurationSec, Number(minDurationSec) || 0, 0.5);
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
    case "REMOVE_ASSET": {
      const assetId = action.payload?.assetId;
      if (!assetId || !state.assets?.[assetId]) return state;
      const assets = { ...(state.assets || {}) };
      delete assets[assetId];
      return {
        ...state,
        assets,
      };
    }
    case "REGISTER_ASSET": {
      const asset = action.payload?.asset;
      if (!asset?.id) return state;
      return {
        ...state,
        assets: { ...(state.assets || {}), [asset.id]: asset },
      };
    }
    case "SET_ASSET_TAGS": {
      const { assetId, tags } = action.payload || {};
      if (!assetId || !state.assets?.[assetId]) return state;
      return {
        ...state,
        assets: {
          ...state.assets,
          [assetId]: { ...state.assets[assetId], tags: Array.isArray(tags) ? tags : [] },
        },
      };
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
    case "MOVE_CLIPS": {
      const moves = Array.isArray(action.payload.moves) ? action.payload.moves : [];
      const prevStartById = new Map(
        moves.map((move) => [move.clipId, state.clips.find((clip) => clip.id === move.clipId)?.timelineStartSec])
      );
      const clips = moveClips(state.clips, moves);
      let metadata = state.metadata;
      const lyricsReplacement = state.metadata?.lyricsReplacement;
      if (lyricsReplacement) {
        let nextLyricsReplacement = lyricsReplacement;
        moves.forEach((move) => {
          if (!lyricsReplacement[move.clipId]) return;
          const prevStartSec = Number(prevStartById.get(move.clipId));
          if (!Number.isFinite(prevStartSec)) return;
          const delta = move.newTimelineStartSec - prevStartSec;
          if (Math.abs(delta) <= 1e-6) return;
          if (nextLyricsReplacement === lyricsReplacement) {
            nextLyricsReplacement = { ...lyricsReplacement };
          }
          nextLyricsReplacement[move.clipId] = shiftLyricsEntries(lyricsReplacement[move.clipId], delta);
        });
        if (nextLyricsReplacement !== lyricsReplacement) {
          metadata = { ...(state.metadata || {}), lyricsReplacement: nextLyricsReplacement };
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
    case "ADD_SCENE": {
      const scene = {
        id: makeId(),
        name: action.payload?.name || `Scene ${state.scenes.length + 1}`,
      };
      return applyEdlChange(state, { scenes: [...state.scenes, scene] });
    }
    case "RENAME_SCENE": {
      const { sceneId, name } = action.payload || {};
      if (!sceneId) return state;
      const scenes = state.scenes.map((scene) => (scene.id === sceneId ? { ...scene, name } : scene));
      return applyEdlChange(state, { scenes });
    }
    case "REMOVE_SCENE": {
      const sceneId = action.payload?.sceneId;
      if (!sceneId) return state;
      const scenes = state.scenes.filter((scene) => scene.id !== sceneId);
      const clipSlots = state.clipSlots.filter((slot) => slot.sceneId !== sceneId);
      return applyEdlChange(state, { scenes, clipSlots });
    }
    case "SET_CLIP_SLOT": {
      // One slot per (sceneId, laneId) — setting an existing cell replaces it, never duplicates.
      const { sceneId, laneId, assetId, srcStartSec, srcEndSec, clipType, midi, gainDb, label } =
        action.payload || {};
      if (!sceneId || !laneId) return state;
      const existingIndex = state.clipSlots.findIndex(
        (slot) => slot.sceneId === sceneId && slot.laneId === laneId
      );
      const slot = {
        id: existingIndex >= 0 ? state.clipSlots[existingIndex].id : makeId(),
        sceneId,
        laneId,
        assetId: assetId ?? null,
        srcStartSec: Number(srcStartSec) || 0,
        srcEndSec: Number(srcEndSec) || 0,
        clipType: clipType || "audio",
        midi: midi || null,
        gainDb: Number(gainDb) || 0,
        label: label || null,
      };
      const clipSlots =
        existingIndex >= 0
          ? state.clipSlots.map((item, index) => (index === existingIndex ? slot : item))
          : [...state.clipSlots, slot];
      return applyEdlChange(state, { clipSlots });
    }
    case "CLEAR_CLIP_SLOT": {
      const { sceneId, laneId } = action.payload || {};
      if (!sceneId || !laneId) return state;
      const clipSlots = state.clipSlots.filter(
        (slot) => !(slot.sceneId === sceneId && slot.laneId === laneId)
      );
      return applyEdlChange(state, { clipSlots });
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
          future: [snapshotState(state), ...state.history.future].slice(0, MAX_HISTORY),
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
          past: [...state.history.past, snapshotState(state)].slice(-MAX_HISTORY),
          future,
        },
      };
    }
    default:
      return state;
  }
};

/* Seeds the store's copy of masterVolume/masterPan from whatever the shared,
   app-wide fader is already sitting at — rather than always snapping back to
   unity — since a project's own saved prefs only arrive later (once loaded),
   and until then this is what the "one fader everywhere" feature relies on
   to avoid stomping a level set from outside Studio (e.g. the Library) back
   to defaults the moment Studio is first opened. */
const buildInitialState = () => ({
  ...initialState,
  ui: { ...initialState.ui, masterVolume: getMasterVolume(), masterPan: getMasterPan() },
});

export const StudioProvider = ({ children }) => {
  const [state, dispatch] = useReducer(studioReducer, initialState, buildInitialState);
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
      addClip: (laneId, assetId, startSec, durationSec, tempoRate) =>
        dispatch({ type: "ADD_CLIP", payload: { laneId, assetId, startSec, durationSec, tempoRate } }),
      addTimelineClips: (clips) => dispatch({ type: "ADD_TIMELINE_CLIPS", payload: { clips } }),
      reorderLanes: (laneIds) => dispatch({ type: "REORDER_LANES", payload: { laneIds } }),
      addLane: (payload) => dispatch({ type: "ADD_LANE", payload }),
      removeLane: (laneId) => dispatch({ type: "REMOVE_LANE", payload: { laneId } }),
      addMidiClip: (laneId, clip, startTick, bpm, ppq, minDurationSec) =>
        dispatch({ type: "ADD_MIDI_CLIP", payload: { laneId, clip, startTick, bpm, ppq, minDurationSec } }),
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
      // `moves`: [{ clipId, newTimelineStartSec, laneId }] — one dispatch, one
      // history entry, so dragging a multi-clip selection undoes as one step.
      moveClips: (moves) => dispatch({ type: "MOVE_CLIPS", payload: { moves } }),
      deleteSelection: (range, laneIds, clipIds) =>
        dispatch({ type: "DELETE_SELECTION", payload: { range, laneIds, clipIds } }),
      duplicateSelection: (range, laneIds, pasteTimeSec) =>
        dispatch({ type: "DUPLICATE_SELECTION", payload: { range, laneIds, pasteTimeSec } }),
      duplicateLane: (laneId) => dispatch({ type: "DUPLICATE_LANE", payload: { laneId } }),
      deleteAllLanes: () => dispatch({ type: "REMOVE_ALL_LANES" }),
      removeAsset: (assetId) => dispatch({ type: "REMOVE_ASSET", payload: { assetId } }),
      registerAsset: (asset) => dispatch({ type: "REGISTER_ASSET", payload: { asset } }),
      setAssetTags: (assetId, tags) => dispatch({ type: "SET_ASSET_TAGS", payload: { assetId, tags } }),
      addScene: (name) => dispatch({ type: "ADD_SCENE", payload: { name } }),
      renameScene: (sceneId, name) => dispatch({ type: "RENAME_SCENE", payload: { sceneId, name } }),
      removeScene: (sceneId) => dispatch({ type: "REMOVE_SCENE", payload: { sceneId } }),
      setClipSlot: (payload) => dispatch({ type: "SET_CLIP_SLOT", payload }),
      clearClipSlot: (sceneId, laneId) => dispatch({ type: "CLEAR_CLIP_SLOT", payload: { sceneId, laneId } }),
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
