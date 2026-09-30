import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import SessionView from "./SessionView";

const lanes = [
  { id: "lane-1", name: "Beat", color: "#ff0000" },
  { id: "lane-2", name: "Vocals", color: "#00ff00" },
];
const scenes = [{ id: "scene-1", name: "Intro" }];
const clipSlots = [
  { id: "slot-1", sceneId: "scene-1", laneId: "lane-1", assetId: "asset-1", label: "Kick loop" },
];
const assets = { "asset-1": { id: "asset-1", label: "Kick loop", durationSec: 4 } };

describe("SessionView (real render)", () => {
  test("renders scene rows, lane columns, and a loaded slot's label", () => {
    render(
      <SessionView lanes={lanes} scenes={scenes} clipSlots={clipSlots} assets={assets} activeClipSlotIds={new Set()} />
    );
    expect(screen.getByText("Beat")).toBeInTheDocument();
    expect(screen.getByText("Vocals")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Intro")).toBeInTheDocument();
    expect(screen.getByText("Kick loop")).toBeInTheDocument();
    expect(screen.getByText("Click or drop a clip")).toBeInTheDocument(); // the other, empty cell
  });

  test("clicking a loaded cell triggers the clip slot", () => {
    const onTriggerClipSlot = jest.fn();
    render(
      <SessionView
        lanes={lanes}
        scenes={scenes}
        clipSlots={clipSlots}
        assets={assets}
        activeClipSlotIds={new Set()}
        onTriggerClipSlot={onTriggerClipSlot}
      />
    );
    fireEvent.click(screen.getByText("Kick loop"));
    expect(onTriggerClipSlot).toHaveBeenCalledWith(clipSlots[0]);
  });

  test("clicking an already-playing cell stops it instead of re-triggering", () => {
    const onStopClipSlot = jest.fn();
    const onTriggerClipSlot = jest.fn();
    render(
      <SessionView
        lanes={lanes}
        scenes={scenes}
        clipSlots={clipSlots}
        assets={assets}
        activeClipSlotIds={new Set(["slot-1"])}
        onTriggerClipSlot={onTriggerClipSlot}
        onStopClipSlot={onStopClipSlot}
      />
    );
    fireEvent.click(screen.getByText("Kick loop"));
    expect(onStopClipSlot).toHaveBeenCalledWith("slot-1");
    expect(onTriggerClipSlot).not.toHaveBeenCalled();
  });

  test("scene launch button fires onTriggerScene with the scene id", () => {
    const onTriggerScene = jest.fn();
    render(
      <SessionView
        lanes={lanes}
        scenes={scenes}
        clipSlots={clipSlots}
        assets={assets}
        activeClipSlotIds={new Set()}
        onTriggerScene={onTriggerScene}
      />
    );
    fireEvent.click(screen.getByTitle("Launch scene: Intro"));
    expect(onTriggerScene).toHaveBeenCalledWith("scene-1");
  });

  test("add scene button fires onAddScene", () => {
    const onAddScene = jest.fn();
    render(
      <SessionView lanes={lanes} scenes={[]} clipSlots={[]} assets={{}} activeClipSlotIds={new Set()} onAddScene={onAddScene} />
    );
    fireEvent.click(screen.getByText("Add scene"));
    expect(onAddScene).toHaveBeenCalled();
  });

  test("clicking an empty cell opens a picker with a matching library asset and a generate entry", () => {
    render(
      <SessionView
        lanes={lanes}
        scenes={scenes}
        clipSlots={clipSlots}
        assets={{ ...assets, "asset-2": { id: "asset-2", label: "Snare hit", url: "/a.wav", durationSec: 1 } }}
        activeClipSlotIds={new Set()}
      />
    );
    // lane-2 ("Vocals") has no slot for scene-1 — its cell is the empty one.
    fireEvent.click(screen.getByText("Click or drop a clip"));
    expect(screen.getByText("Snare hit")).toBeInTheDocument();
    expect(screen.getByText("✨ Generate into this slot")).toBeInTheDocument();
  });

  test("picking an asset from the empty-cell picker loads it via onDropAssetOnSlot", () => {
    const onDropAssetOnSlot = jest.fn();
    render(
      <SessionView
        lanes={lanes}
        scenes={scenes}
        clipSlots={clipSlots}
        assets={{ ...assets, "asset-2": { id: "asset-2", label: "Snare hit", url: "/a.wav", durationSec: 1 } }}
        activeClipSlotIds={new Set()}
        onDropAssetOnSlot={onDropAssetOnSlot}
      />
    );
    fireEvent.click(screen.getByText("Click or drop a clip"));
    fireEvent.click(screen.getByText("Snare hit"));
    expect(onDropAssetOnSlot).toHaveBeenCalledWith("scene-1", "lane-2", "asset-2");
  });

  test("the generate entry fires onGenerateIntoSlot with the scene and lane", () => {
    const onGenerateIntoSlot = jest.fn();
    render(
      <SessionView
        lanes={lanes}
        scenes={scenes}
        clipSlots={clipSlots}
        assets={assets}
        activeClipSlotIds={new Set()}
        onGenerateIntoSlot={onGenerateIntoSlot}
      />
    );
    fireEvent.click(screen.getByText("Click or drop a clip"));
    fireEvent.click(screen.getByText("✨ Generate into this slot"));
    expect(onGenerateIntoSlot).toHaveBeenCalledWith("scene-1", "lane-2");
  });

  test("Stop all button fires onStopAll", () => {
    const onStopAll = jest.fn();
    render(
      <SessionView
        lanes={lanes}
        scenes={scenes}
        clipSlots={clipSlots}
        assets={assets}
        activeClipSlotIds={new Set()}
        onStopAll={onStopAll}
      />
    );
    fireEvent.click(screen.getByText("■ Stop all"));
    expect(onStopAll).toHaveBeenCalled();
  });

  test("pressing Space on a focused loaded cell triggers it, same as a click", () => {
    const onTriggerClipSlot = jest.fn();
    render(
      <SessionView
        lanes={lanes}
        scenes={scenes}
        clipSlots={clipSlots}
        assets={assets}
        activeClipSlotIds={new Set()}
        onTriggerClipSlot={onTriggerClipSlot}
      />
    );
    const cell = screen.getByText("Kick loop").closest(".studio-session-cell");
    fireEvent.keyDown(cell, { key: " " });
    expect(onTriggerClipSlot).toHaveBeenCalledWith(clipSlots[0]);
  });

  test("pressing Space on a focused empty cell opens the picker, same as a click", () => {
    render(
      <SessionView lanes={lanes} scenes={scenes} clipSlots={clipSlots} assets={assets} activeClipSlotIds={new Set()} />
    );
    const cell = screen.getByText("Click or drop a clip").closest(".studio-session-cell");
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(screen.getByText("✨ Generate into this slot")).toBeInTheDocument();
  });

  test("the loaded cell's menu exposes gain/trim controls wired to onUpdateClipSlot", () => {
    const onUpdateClipSlot = jest.fn();
    const slotWithGain = { ...clipSlots[0], gainDb: -3, srcStartSec: 0, srcEndSec: 2 };
    render(
      <SessionView
        lanes={lanes}
        scenes={scenes}
        clipSlots={[slotWithGain]}
        assets={assets}
        activeClipSlotIds={new Set()}
        onUpdateClipSlot={onUpdateClipSlot}
      />
    );
    fireEvent.click(screen.getByTitle("Clip options"));
    fireEvent.change(screen.getByDisplayValue("-3"), { target: { value: "6" } });
    expect(onUpdateClipSlot).toHaveBeenCalledWith(slotWithGain, { gainDb: 6 });
  });

  test("duplicating a loaded slot to another scene fires onDuplicateClipSlot", () => {
    const onDuplicateClipSlot = jest.fn();
    const twoScenes = [...scenes, { id: "scene-2", name: "Drop" }];
    render(
      <SessionView
        lanes={lanes}
        scenes={twoScenes}
        clipSlots={clipSlots}
        assets={assets}
        activeClipSlotIds={new Set()}
        onDuplicateClipSlot={onDuplicateClipSlot}
      />
    );
    fireEvent.click(screen.getByTitle("Clip options"));
    fireEvent.change(screen.getByDisplayValue("Choose a scene…"), { target: { value: "scene-2" } });
    expect(onDuplicateClipSlot).toHaveBeenCalledWith(clipSlots[0], "scene-2");
  });

  const midiLanes = [
    { id: "lane-1", name: "Beat", color: "#ff0000" },
    { id: "lane-2", name: "Synth", color: "#00ff00", type: "midi" },
  ];

  test("the empty-cell picker only offers 'Create MIDI clip' on a MIDI lane", () => {
    render(
      <SessionView lanes={midiLanes} scenes={scenes} clipSlots={clipSlots} assets={assets} activeClipSlotIds={new Set()} />
    );
    // lane-1 ("Beat") already has a slot for scene-1 — its empty counterpart is lane-2 ("Synth", MIDI).
    fireEvent.click(screen.getByText("Click or drop a clip"));
    expect(screen.getByText("🎹 Create MIDI clip")).toBeInTheDocument();
  });

  test("'Create MIDI clip' fires onCreateMidiSlot with the scene and lane", () => {
    const onCreateMidiSlot = jest.fn();
    render(
      <SessionView
        lanes={midiLanes}
        scenes={scenes}
        clipSlots={clipSlots}
        assets={assets}
        activeClipSlotIds={new Set()}
        onCreateMidiSlot={onCreateMidiSlot}
      />
    );
    fireEvent.click(screen.getByText("Click or drop a clip"));
    fireEvent.click(screen.getByText("🎹 Create MIDI clip"));
    expect(onCreateMidiSlot).toHaveBeenCalledWith("scene-1", "lane-2");
  });

  const midiClipSlots = [
    ...clipSlots,
    {
      id: "slot-midi",
      sceneId: "scene-1",
      laneId: "lane-2",
      clipType: "midi",
      srcStartSec: 0,
      srcEndSec: 2,
      midi: { notes: [], bpm: 120, ppq: 480, soundfont: null },
      label: "MIDI clip",
    },
  ];

  test("a loaded MIDI slot's menu opens a note editor with the piano keyboard, not the audio preview button", () => {
    render(
      <SessionView lanes={midiLanes} scenes={scenes} clipSlots={midiClipSlots} assets={assets} activeClipSlotIds={new Set()} />
    );
    fireEvent.click(screen.getAllByTitle("Clip options")[1]); // lane-2's cell, the MIDI slot
    expect(screen.queryByText("▶ Preview")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("🎹 Edit notes (0)"));
    expect(screen.getByText(/Click to add a note/)).toBeInTheDocument();
    expect(document.querySelector(".studio-piano")).toBeInTheDocument();
  });

  test("playing a note in the editor updates the slot's midi.notes and previews the sound", () => {
    const onUpdateClipSlot = jest.fn();
    const onPreviewMidiNote = jest.fn();
    render(
      <SessionView
        lanes={midiLanes}
        scenes={scenes}
        clipSlots={midiClipSlots}
        assets={assets}
        activeClipSlotIds={new Set()}
        onUpdateClipSlot={onUpdateClipSlot}
        onPreviewMidiNote={onPreviewMidiNote}
      />
    );
    fireEvent.click(screen.getAllByTitle("Clip options")[1]);
    fireEvent.click(screen.getByText("🎹 Edit notes (0)"));
    const firstWhiteKey = document.querySelector(".studio-piano-key.white");
    fireEvent.pointerDown(firstWhiteKey);

    expect(onUpdateClipSlot).toHaveBeenCalledTimes(1);
    const [slotArg, patchArg] = onUpdateClipSlot.mock.calls[0];
    expect(slotArg.id).toBe("slot-midi");
    expect(patchArg.midi.notes).toHaveLength(1);
    expect(patchArg.midi.notes[0].startTick).toBe(0);

    expect(onPreviewMidiNote).toHaveBeenCalledTimes(1);
    expect(onPreviewMidiNote.mock.calls[0][0]).toMatchObject({ laneId: "lane-2", soundfontName: null });
  });

  test("assigning an instrument from the MIDI slot's menu sets midi.soundfont", () => {
    const onUpdateClipSlot = jest.fn();
    const assetsWithSoundfont = {
      ...assets,
      "sf-1": { id: "sf-1", kind: "soundfont", label: "Rhodes EP" },
    };
    render(
      <SessionView
        lanes={midiLanes}
        scenes={scenes}
        clipSlots={midiClipSlots}
        assets={assetsWithSoundfont}
        activeClipSlotIds={new Set()}
        onUpdateClipSlot={onUpdateClipSlot}
      />
    );
    fireEvent.click(screen.getAllByTitle("Clip options")[1]);
    fireEvent.change(screen.getByDisplayValue("Lane default"), { target: { value: "sf-1" } });
    expect(onUpdateClipSlot).toHaveBeenCalledWith(
      midiClipSlots[1],
      { midi: { ...midiClipSlots[1].midi, soundfont: "sf-1" } }
    );
  });
});
