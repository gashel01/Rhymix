import { studioReducer, initialState } from "./store";

const withLanes = (state, lanes) => ({ ...state, lanes });

describe("session view (scenes/clipSlots) reducer", () => {
  test("ADD_SCENE appends a scene with a default name", () => {
    const next = studioReducer(initialState, { type: "ADD_SCENE", payload: {} });
    expect(next.scenes).toHaveLength(1);
    expect(next.scenes[0].name).toBe("Scene 1");
    expect(next.scenes[0].id).toBeTruthy();
  });

  test("ADD_SCENE respects an explicit name", () => {
    const next = studioReducer(initialState, { type: "ADD_SCENE", payload: { name: "Intro" } });
    expect(next.scenes[0].name).toBe("Intro");
  });

  test("RENAME_SCENE updates only the matching scene", () => {
    let state = studioReducer(initialState, { type: "ADD_SCENE", payload: { name: "A" } });
    state = studioReducer(state, { type: "ADD_SCENE", payload: { name: "B" } });
    const sceneId = state.scenes[0].id;
    const next = studioReducer(state, { type: "RENAME_SCENE", payload: { sceneId, name: "Renamed" } });
    expect(next.scenes[0].name).toBe("Renamed");
    expect(next.scenes[1].name).toBe("B");
  });

  test("REMOVE_SCENE deletes the scene and its clip slots", () => {
    let state = studioReducer(initialState, { type: "ADD_SCENE", payload: { name: "A" } });
    const sceneId = state.scenes[0].id;
    state = studioReducer(state, {
      type: "SET_CLIP_SLOT",
      payload: { sceneId, laneId: "lane-1", assetId: "asset-1", srcStartSec: 0, srcEndSec: 4 },
    });
    expect(state.clipSlots).toHaveLength(1);
    const next = studioReducer(state, { type: "REMOVE_SCENE", payload: { sceneId } });
    expect(next.scenes).toHaveLength(0);
    expect(next.clipSlots).toHaveLength(0);
  });

  test("SET_CLIP_SLOT creates a slot for a (scene, lane) pair", () => {
    let state = studioReducer(initialState, { type: "ADD_SCENE", payload: { name: "A" } });
    const sceneId = state.scenes[0].id;
    const next = studioReducer(state, {
      type: "SET_CLIP_SLOT",
      payload: { sceneId, laneId: "lane-1", assetId: "asset-1", srcStartSec: 0, srcEndSec: 8 },
    });
    expect(next.clipSlots).toHaveLength(1);
    expect(next.clipSlots[0]).toMatchObject({
      sceneId,
      laneId: "lane-1",
      assetId: "asset-1",
      srcStartSec: 0,
      srcEndSec: 8,
      clipType: "audio",
    });
  });

  test("SET_CLIP_SLOT on an already-loaded cell replaces it, never duplicates", () => {
    let state = studioReducer(initialState, { type: "ADD_SCENE", payload: { name: "A" } });
    const sceneId = state.scenes[0].id;
    state = studioReducer(state, {
      type: "SET_CLIP_SLOT",
      payload: { sceneId, laneId: "lane-1", assetId: "asset-1", srcStartSec: 0, srcEndSec: 4 },
    });
    const firstId = state.clipSlots[0].id;
    const next = studioReducer(state, {
      type: "SET_CLIP_SLOT",
      payload: { sceneId, laneId: "lane-1", assetId: "asset-2", srcStartSec: 0, srcEndSec: 6 },
    });
    expect(next.clipSlots).toHaveLength(1);
    expect(next.clipSlots[0].id).toBe(firstId);
    expect(next.clipSlots[0].assetId).toBe("asset-2");
  });

  test("SET_CLIP_SLOT for a different lane in the same scene adds a second slot", () => {
    let state = studioReducer(initialState, { type: "ADD_SCENE", payload: { name: "A" } });
    const sceneId = state.scenes[0].id;
    state = studioReducer(state, {
      type: "SET_CLIP_SLOT",
      payload: { sceneId, laneId: "lane-1", assetId: "asset-1", srcStartSec: 0, srcEndSec: 4 },
    });
    const next = studioReducer(state, {
      type: "SET_CLIP_SLOT",
      payload: { sceneId, laneId: "lane-2", assetId: "asset-2", srcStartSec: 0, srcEndSec: 4 },
    });
    expect(next.clipSlots).toHaveLength(2);
  });

  test("CLEAR_CLIP_SLOT removes only the targeted cell", () => {
    let state = studioReducer(initialState, { type: "ADD_SCENE", payload: { name: "A" } });
    const sceneId = state.scenes[0].id;
    state = studioReducer(state, {
      type: "SET_CLIP_SLOT",
      payload: { sceneId, laneId: "lane-1", assetId: "asset-1", srcStartSec: 0, srcEndSec: 4 },
    });
    state = studioReducer(state, {
      type: "SET_CLIP_SLOT",
      payload: { sceneId, laneId: "lane-2", assetId: "asset-2", srcStartSec: 0, srcEndSec: 4 },
    });
    const next = studioReducer(state, { type: "CLEAR_CLIP_SLOT", payload: { sceneId, laneId: "lane-1" } });
    expect(next.clipSlots).toHaveLength(1);
    expect(next.clipSlots[0].laneId).toBe("lane-2");
  });

  test("SET_PROJECT loads scenes/clipSlots from the payload, defaulting to empty arrays", () => {
    const withData = studioReducer(withLanes(initialState, []), {
      type: "SET_PROJECT",
      payload: {
        project: { id: "p1", bpm: 120 },
        lanes: [],
        clips: [],
        assets: {},
        metadata: {},
        scenes: [{ id: "s1", name: "Scene 1" }],
        clipSlots: [{ id: "cs1", sceneId: "s1", laneId: "lane-1" }],
      },
    });
    expect(withData.scenes).toHaveLength(1);
    expect(withData.clipSlots).toHaveLength(1);

    const withoutData = studioReducer(initialState, {
      type: "SET_PROJECT",
      payload: { project: { id: "p2", bpm: 120 }, lanes: [], clips: [], assets: {}, metadata: {} },
    });
    expect(withoutData.scenes).toEqual([]);
    expect(withoutData.clipSlots).toEqual([]);
  });

  test("scenes/clipSlots participate in undo/redo like lanes/clips", () => {
    let state = studioReducer(initialState, { type: "ADD_SCENE", payload: { name: "A" } });
    const sceneId = state.scenes[0].id;
    state = studioReducer(state, {
      type: "SET_CLIP_SLOT",
      payload: { sceneId, laneId: "lane-1", assetId: "asset-1", srcStartSec: 0, srcEndSec: 4 },
    });
    expect(state.clipSlots).toHaveLength(1);
    const undone = studioReducer(state, { type: "UNDO" });
    expect(undone.clipSlots).toHaveLength(0);
    expect(undone.scenes).toHaveLength(1);
    const redone = studioReducer(undone, { type: "REDO" });
    expect(redone.clipSlots).toHaveLength(1);
  });
});
