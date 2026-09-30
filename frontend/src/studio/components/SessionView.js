import React, { useEffect, useMemo, useRef, useState } from "react";
import { PlusIcon } from "lucide-react";
import { INSTRUMENT_CHOICES } from "../audioMath";
import StudioWaveform from "./StudioWaveform";
import PianoRoll from "./PianoRoll";
import PianoKeyboard from "./PianoKeyboard";
import { formatBarLength } from "../sessionViewMath";

/* Non-linear clip-launch grid (speed-beatmaker backlog item #1) — rows are scenes, columns are
   the project's existing lanes (no separate "session lane" concept). Each cell is at most one
   clip slot (state.clipSlots, keyed by sceneId+laneId). Playback is driven by
   useStudioPlayback's triggerScene/triggerClipSlot — quantized to the next bar, mutually
   exclusive with the linear timeline transport (see that hook for why).

   Loading a cell: drag-and-drop from the Library panel (original path) OR click an empty cell to
   open a picker (added 2026-09-26 — dragging an asset across the whole app just to fill one cell
   was the #1 friction point reported testing this). See the "superpower Session view" section of
   docs/SPEED_BEATMAKER_UX_BACKLOG.md for the full list of what changed in that pass and why. */

const ASSET_PREVIEW_CAP_SEC = 8; // don't leave an unattended preview looping for a whole song

const SessionView = ({
  lanes = [],
  scenes = [],
  clipSlots = [],
  assets = {},
  activeClipSlotIds,
  bpm = 120,
  onAddScene,
  onRenameScene,
  onRemoveScene,
  onTriggerScene,
  onTriggerClipSlot,
  onStopClipSlot,
  onStopAll,
  onClearClipSlot,
  onDropAssetOnSlot,
  onUpdateClipSlot,
  onDuplicateClipSlot,
  onGenerateIntoSlot,
  onCreateMidiSlot,
  onPreviewMidiNote,
  recordingToTimeline = false,
  onToggleRecordToTimeline,
}) => {
  const [dragOverCell, setDragOverCell] = useState(null);
  const [pickerFor, setPickerFor] = useState(null); // {sceneId, laneId} | null
  const [pickerQuery, setPickerQuery] = useState("");
  const [menuFor, setMenuFor] = useState(null); // {sceneId, laneId} | null — loaded-cell "..." menu
  const [notesEditorFor, setNotesEditorFor] = useState(null); // {sceneId, laneId} | null — MIDI note popover
  const [midiPlayheadSec, setMidiPlayheadSec] = useState(0); // step-input position within the notes editor
  const [rollSelection, setRollSelection] = useState([]);
  const [previewingSlotId, setPreviewingSlotId] = useState(null);
  const gridRef = useRef(null);
  const previewAudioRef = useRef(null);

  const slotFor = (sceneId, laneId) =>
    clipSlots.find((slot) => slot.sceneId === sceneId && slot.laneId === laneId) || null;

  const soundfontOptions = useMemo(
    () => Object.values(assets || {}).filter((asset) => asset?.kind === "soundfont"),
    [assets]
  );

  const closePopovers = () => {
    setPickerFor(null);
    setMenuFor(null);
    setPickerQuery("");
    setNotesEditorFor(null);
  };

  // Close on outside click / Escape — same pattern as TrackList.js's lane menu.
  useEffect(() => {
    if (!pickerFor && !menuFor && !notesEditorFor) return undefined;
    const onMouseDown = (event) => {
      if (!event.target.closest(".studio-session-popover-wrap")) closePopovers();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") closePopovers();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [pickerFor, menuFor, notesEditorFor]);

  /* Step input, same model as ClipView.js's insertMidiNoteAtPlayhead: a key press writes a note
     at the current position and advances it by the note's own length — no mouse-drawing required,
     works the same whether the "key" came from PianoKeyboard's on-screen keys, the QWERTY
     fallback, or real MIDI hardware (all three already funnel through its onNoteOn). */
  const handleMidiNoteOn = (slot, lane, noteNumber) => {
    const midi = slot.midi || {};
    const slotBpm = Number(midi.bpm) || bpm;
    const ppq = Number(midi.ppq) || 480;
    const ticksPerSec = (slotBpm * ppq) / 60;
    const loopLen = Math.max(0.05, Number(slot.srcEndSec || 0) - Number(slot.srcStartSec || 0));
    const stepSec = 0.25;
    const startRaw = Math.min(midiPlayheadSec, Math.max(0, loopLen - stepSec));
    const startTick = Math.max(0, Math.round(startRaw * ticksPerSec));
    const durationTick = Math.max(1, Math.round(stepSec * ticksPerSec));
    const newNote = {
      note: noteNumber,
      velocity: 100,
      startTick,
      durationTick,
      startSec: startRaw,
      durationSec: stepSec,
    };
    onUpdateClipSlot?.(slot, { midi: { ...midi, notes: [...(midi.notes || []), newNote] } });
    onPreviewMidiNote?.({
      laneId: lane.id,
      noteNumber,
      velocity: 100,
      durationSec: Math.min(0.3, stepSec),
      clipGainDb: slot.gainDb,
      soundfontName: midi.soundfont,
    });
    setMidiPlayheadSec((prev) => Math.min(loopLen, prev + stepSec));
  };

  useEffect(() => {
    return () => {
      previewAudioRef.current?.pause();
    };
  }, []);

  const stopPreview = () => {
    previewAudioRef.current?.pause();
    setPreviewingSlotId(null);
  };

  const togglePreview = (slot) => {
    const asset = assets?.[slot.assetId];
    if (!asset?.url) return;
    if (previewingSlotId === slot.id) {
      stopPreview();
      return;
    }
    if (!previewAudioRef.current) {
      previewAudioRef.current = new Audio();
      previewAudioRef.current.addEventListener("ended", () => setPreviewingSlotId(null));
    }
    const audio = previewAudioRef.current;
    audio.pause();
    audio.src = asset.url;
    audio.currentTime = Number(slot.srcStartSec) || 0;
    const capEnd = Math.min(
      Number(slot.srcEndSec) || audio.duration || 0,
      (Number(slot.srcStartSec) || 0) + ASSET_PREVIEW_CAP_SEC
    );
    const stopAt = () => {
      if (audio.currentTime >= capEnd) stopPreview();
    };
    audio.ontimeupdate = stopAt;
    audio.play().catch(() => setPreviewingSlotId(null));
    setPreviewingSlotId(slot.id);
  };

  const pickableAssets = useMemo(() => {
    const query = pickerQuery.trim().toLowerCase();
    return Object.values(assets || {})
      .filter((asset) => asset?.kind !== "soundfont" && asset?.url)
      .filter((asset) => !query || (asset.label || asset.id || "").toLowerCase().includes(query))
      .slice(0, 40); // a session cell picker is for grabbing something fast, not browsing the whole library
  }, [assets, pickerQuery]);

  const handleDrop = (event, sceneId, laneId) => {
    event.preventDefault();
    setDragOverCell(null);
    const draggedAsset = event.dataTransfer?.getData("application/x-rhymix-asset") || "";
    const fallbackId = event.dataTransfer?.getData("text/plain") || "";
    const assetId = draggedAsset || (assets?.[fallbackId] ? fallbackId : "");
    if (!assetId) return;
    onDropAssetOnSlot?.(sceneId, laneId, assetId);
  };

  const moveFocus = (sceneIndex, laneIndex, dRow, dCol) => {
    const targetRow = sceneIndex + dRow;
    const targetCol = laneIndex + dCol;
    const el = gridRef.current?.querySelector(
      `[data-scene-index="${targetRow}"][data-lane-index="${targetCol}"]`
    );
    el?.focus();
  };

  const handleCellKeyDown = (event, scene, lane, sceneIndex, laneIndex, slot, isActive) => {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        moveFocus(sceneIndex, laneIndex, 0, 1);
        return;
      case "ArrowLeft":
        event.preventDefault();
        moveFocus(sceneIndex, laneIndex, 0, -1);
        return;
      case "ArrowDown":
        event.preventDefault();
        moveFocus(sceneIndex, laneIndex, 1, 0);
        return;
      case "ArrowUp":
        event.preventDefault();
        moveFocus(sceneIndex, laneIndex, -1, 0);
        return;
      case " ":
      case "Enter":
        event.preventDefault();
        if (!slot) {
          setPickerFor({ sceneId: scene.id, laneId: lane.id });
        } else if (isActive) {
          onStopClipSlot?.(slot.id);
        } else {
          onTriggerClipSlot?.(slot);
        }
        return;
      default:
    }
  };

  const otherScenesFor = (sceneId) => scenes.filter((scene) => scene.id !== sceneId);

  return (
    <div className="studio-session-view">
      <div className="studio-session-toolbar">
        {/* "Record to Timeline" — Ableton's "Record to Arrangement": Session is for jamming/
            auditioning loop combos, Timeline is the finished song structure. This is the one-way
            capture action that links them — turn it on, trigger scenes/cells like normal, and
            whatever actually plays gets tiled into real Timeline clips on stop. See
            useStudioPlayback.js's toggleRecordToTimeline/openRecordingSpan/closeRecordingSpan and
            sessionRecording.js's tileRecordedSpanIntoClips for how a looped clip-slot becomes
            non-looping Timeline clips. */}
        <button
          type="button"
          className={`studio-session-record-btn ${recordingToTimeline ? "active" : ""}`}
          onClick={() => onToggleRecordToTimeline?.()}
          title={recordingToTimeline ? "Stop recording to Timeline" : "Record what you trigger to the Timeline"}
        >
          <span className="studio-session-record-dot" />
          {recordingToTimeline ? "Recording…" : "Record to Timeline"}
        </button>
        <button
          type="button"
          className="studio-mini studio-session-stop-all"
          onClick={() => onStopAll?.()}
          title="Stop every playing clip-slot"
        >
          ■ Stop all
        </button>
      </div>
      <div
        ref={gridRef}
        className="studio-session-grid"
        style={{ gridTemplateColumns: `160px repeat(${lanes.length}, 1fr)` }}
      >
        <div className="studio-session-corner" />
        {lanes.map((lane) => (
          <div key={lane.id} className="studio-session-lane-header" style={{ borderColor: lane.color || undefined }}>
            {lane.name}
          </div>
        ))}

        {scenes.map((scene, sceneIndex) => (
          <React.Fragment key={scene.id}>
            <div className="studio-session-scene-header">
              <button
                type="button"
                className="studio-session-scene-launch"
                onClick={() => onTriggerScene?.(scene.id)}
                title={`Launch scene: ${scene.name}`}
              >
                ▶
              </button>
              <input
                className="studio-session-scene-name"
                value={scene.name}
                onChange={(e) => onRenameScene?.(scene.id, e.target.value)}
              />
              <button
                type="button"
                className="studio-session-scene-remove"
                onClick={() => onRemoveScene?.(scene.id)}
                title="Delete scene"
              >
                ×
              </button>
            </div>
            {lanes.map((lane, laneIndex) => {
              const slot = slotFor(scene.id, lane.id);
              const isActive = slot && activeClipSlotIds?.has(slot.id);
              const cellKey = `${scene.id}:${lane.id}`;
              const isDragOver = dragOverCell === cellKey;
              const isPickerOpen = pickerFor?.sceneId === scene.id && pickerFor?.laneId === lane.id;
              const isMenuOpen = menuFor?.sceneId === scene.id && menuFor?.laneId === lane.id;
              const isNotesEditorOpen =
                notesEditorFor?.sceneId === scene.id && notesEditorFor?.laneId === lane.id;
              const asset = slot ? assets?.[slot.assetId] : null;
              const laneColor = lane.color || "#6b7280";
              const cellStyle = slot
                ? {
                    borderColor: laneColor,
                    background: `color-mix(in srgb, ${laneColor} 16%, transparent)`,
                  }
                : undefined;
              const loopLenSec = slot ? Math.max(0.05, Number(slot.srcEndSec || 0) - Number(slot.srcStartSec || 0)) : 0;

              return (
                <div key={lane.id} className="studio-session-popover-wrap">
                  <div
                    className={`studio-session-cell ${slot ? "loaded" : "empty"} ${isActive ? "playing" : ""} ${
                      isDragOver ? "drag-over" : ""
                    }`}
                    style={cellStyle}
                    tabIndex={0}
                    data-scene-index={sceneIndex}
                    data-lane-index={laneIndex}
                    onKeyDown={(e) => handleCellKeyDown(e, scene, lane, sceneIndex, laneIndex, slot, isActive)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverCell(cellKey);
                    }}
                    onDragLeave={() => setDragOverCell(null)}
                    onDrop={(e) => handleDrop(e, scene.id, lane.id)}
                    onClick={() => {
                      if (!slot) {
                        setPickerFor({ sceneId: scene.id, laneId: lane.id });
                        return;
                      }
                      if (isActive) onStopClipSlot?.(slot.id);
                      else onTriggerClipSlot?.(slot);
                    }}
                  >
                    {slot ? (
                      <>
                        {isActive && (
                          <span
                            className="studio-session-cell-progress"
                            style={{ animationDuration: `${loopLenSec}s` }}
                          />
                        )}
                        <div className="studio-session-cell-head">
                          <span className="studio-session-cell-label">{slot.label || asset?.label || "Clip"}</span>
                          <button
                            type="button"
                            className="studio-session-cell-menu-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuFor(isMenuOpen ? null : { sceneId: scene.id, laneId: lane.id });
                            }}
                            title="Clip options"
                          >
                            ⋯
                          </button>
                          <button
                            type="button"
                            className="studio-session-cell-clear"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (previewingSlotId === slot.id) stopPreview();
                              onClearClipSlot?.(scene.id, lane.id);
                            }}
                            title="Clear slot"
                          >
                            ×
                          </button>
                        </div>
                        {asset?.url && (
                          <div className="studio-session-cell-wave" onClick={(e) => e.stopPropagation()}>
                            <StudioWaveform
                              url={asset.url}
                              height={22}
                              color={laneColor}
                              clipStartSec={slot.srcStartSec}
                            />
                          </div>
                        )}
                        <span className="studio-session-cell-bars">
                          {formatBarLength(slot.srcStartSec, slot.srcEndSec, bpm)}
                        </span>
                      </>
                    ) : (
                      <span className="studio-session-cell-hint">Click or drop a clip</span>
                    )}
                  </div>

                  {isPickerOpen && (
                    <div className="studio-session-popover" onClick={(e) => e.stopPropagation()}>
                      <input
                        autoFocus
                        className="studio-session-popover-search"
                        placeholder="Search assets…"
                        value={pickerQuery}
                        onChange={(e) => setPickerQuery(e.target.value)}
                      />
                      <button
                        type="button"
                        className="studio-mini studio-session-generate-btn"
                        onClick={() => {
                          onGenerateIntoSlot?.(scene.id, lane.id);
                          closePopovers();
                        }}
                      >
                        ✨ Generate into this slot
                      </button>
                      {lane.type === "midi" && (
                        <button
                          type="button"
                          className="studio-mini studio-session-generate-btn"
                          onClick={() => {
                            onCreateMidiSlot?.(scene.id, lane.id);
                            closePopovers();
                          }}
                        >
                          🎹 Create MIDI clip
                        </button>
                      )}
                      <div className="studio-session-popover-list">
                        {pickableAssets.length ? (
                          pickableAssets.map((candidate) => (
                            <button
                              type="button"
                              key={candidate.id}
                              className="studio-session-popover-item"
                              onClick={() => {
                                onDropAssetOnSlot?.(scene.id, lane.id, candidate.id);
                                closePopovers();
                              }}
                            >
                              {candidate.label || candidate.id}
                            </button>
                          ))
                        ) : (
                          <div className="studio-session-popover-empty">No matching assets.</div>
                        )}
                      </div>
                    </div>
                  )}

                  {isMenuOpen && slot && (
                    <div className="studio-session-popover" onClick={(e) => e.stopPropagation()}>
                      {slot.clipType === "midi" ? (
                        <>
                          <button
                            type="button"
                            className="studio-mini"
                            onClick={() => {
                              setNotesEditorFor({ sceneId: scene.id, laneId: lane.id });
                              setMidiPlayheadSec(0);
                              setMenuFor(null);
                            }}
                          >
                            🎹 Edit notes ({(slot.midi?.notes || []).length})
                          </button>
                          <label className="studio-session-menu-row">
                            Instrument
                            <select
                              value={slot.midi?.soundfont || ""}
                              onChange={(e) =>
                                onUpdateClipSlot?.(slot, {
                                  midi: { ...(slot.midi || {}), soundfont: e.target.value || null },
                                })
                              }
                            >
                              <option value="">Lane default</option>
                              {INSTRUMENT_CHOICES.map((choice) => (
                                <option key={choice.value} value={choice.value}>
                                  {choice.label}
                                </option>
                              ))}
                              {soundfontOptions.map((sf) => (
                                <option key={sf.id} value={sf.id}>
                                  {sf.label || sf.id}
                                </option>
                              ))}
                            </select>
                          </label>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="studio-mini"
                          onClick={() => togglePreview(slot)}
                          disabled={!asset?.url}
                        >
                          {previewingSlotId === slot.id ? "■ Stop preview" : "▶ Preview"}
                        </button>
                      )}

                      <label className="studio-session-menu-row">
                        Gain
                        <input
                          type="range"
                          min={-24}
                          max={12}
                          step={1}
                          value={Number(slot.gainDb) || 0}
                          onChange={(e) => onUpdateClipSlot?.(slot, { gainDb: Number(e.target.value) })}
                        />
                        <span>{Number(slot.gainDb) || 0} dB</span>
                      </label>

                      <label className="studio-session-menu-row">
                        Start
                        <input
                          type="number"
                          step={0.1}
                          min={0}
                          max={asset?.durationSec || undefined}
                          value={Number(slot.srcStartSec) || 0}
                          onChange={(e) =>
                            onUpdateClipSlot?.(slot, { srcStartSec: Math.max(0, Number(e.target.value) || 0) })
                          }
                        />
                      </label>
                      <label className="studio-session-menu-row">
                        End
                        <input
                          type="number"
                          step={0.1}
                          min={0}
                          max={asset?.durationSec || undefined}
                          value={Number(slot.srcEndSec) || 0}
                          onChange={(e) =>
                            onUpdateClipSlot?.(slot, { srcEndSec: Math.max(0, Number(e.target.value) || 0) })
                          }
                        />
                      </label>

                      {otherScenesFor(scene.id).length > 0 && (
                        <label className="studio-session-menu-row">
                          Duplicate to
                          <select
                            value=""
                            onChange={(e) => {
                              if (!e.target.value) return;
                              onDuplicateClipSlot?.(slot, e.target.value);
                              closePopovers();
                            }}
                          >
                            <option value="">Choose a scene…</option>
                            {otherScenesFor(scene.id).map((other) => (
                              <option key={other.id} value={other.id}>
                                {other.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                  )}

                  {isNotesEditorOpen && slot?.clipType === "midi" && (
                    <div
                      className="studio-session-popover studio-session-notes-popover"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="studio-session-menu-row">
                        <span>Notes — {formatBarLength(slot.srcStartSec, slot.srcEndSec, slot.midi?.bpm || bpm)}</span>
                        <button type="button" className="studio-mini" onClick={() => setNotesEditorFor(null)}>
                          Close
                        </button>
                      </div>
                      <PianoRoll
                        notes={slot.midi?.notes || []}
                        bpm={slot.midi?.bpm || bpm}
                        ppq={slot.midi?.ppq || 480}
                        clipStartSec={0}
                        clipDurationSec={loopLenSec}
                        noteColor={laneColor}
                        height={240}
                        playheadSec={midiPlayheadSec}
                        selectedIndices={rollSelection}
                        onSelectionChange={setRollSelection}
                        onSeek={setMidiPlayheadSec}
                        onUpdateNotes={(nextNotes) =>
                          onUpdateClipSlot?.(slot, { midi: { ...(slot.midi || {}), notes: nextNotes } })
                        }
                      />
                      <div className="studio-session-menu-row">
                        <span>
                          Position {midiPlayheadSec.toFixed(2)}s / {loopLenSec.toFixed(2)}s
                        </span>
                        <button type="button" className="studio-mini" onClick={() => setMidiPlayheadSec(0)}>
                          Reset
                        </button>
                        <button
                          type="button"
                          className="studio-mini"
                          onClick={() =>
                            onUpdateClipSlot?.(slot, { midi: { ...(slot.midi || {}), notes: [] } })
                          }
                        >
                          Clear
                        </button>
                      </div>
                      <PianoKeyboard
                        active
                        onNoteOn={(noteNumber) => handleMidiNoteOn(slot, lane, noteNumber)}
                        onNoteOff={() => {}}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>

      <button type="button" className="studio-mini studio-session-add-scene" onClick={() => onAddScene?.()}>
        <PlusIcon size={14} />
        Add scene
      </button>
    </div>
  );
};

export default SessionView;
