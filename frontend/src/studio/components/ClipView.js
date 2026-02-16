import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import StudioWaveform from "./StudioWaveform";
import MidiOverlay from "./MidiOverlay";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const hexToRgba = (hex, alpha) => {
  if (!hex || typeof hex !== "string") return null;
  const trimmed = hex.replace("#", "").trim();
  if (trimmed.length !== 3 && trimmed.length !== 6) return null;
  const full =
    trimmed.length === 3
      ? trimmed
          .split("")
          .map((c) => c + c)
          .join("")
      : trimmed;
  const intVal = Number.parseInt(full, 16);
  if (Number.isNaN(intVal)) return null;
  const r = (intVal >> 16) & 255;
  const g = (intVal >> 8) & 255;
  const b = intVal & 255;
  const a = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

const ClipView = ({
  clip,
  asset,
  isSelected,
  pxPerSec,
  bpm,
  onSelect,
  onDragStart,
  previewClip,
  isDragging,
  onSplit,
  onDelete,
  onSelectRange,
  onTrimStart,
  laneFxActive,
  onUpdateClip,
  snapEnabled,
  gridSec,
  onPreviewMidiNote,
  onStopPreviewMidiNote,
  onPlayMidiClipPreview,
  onStopMidiClipPreview,
  onSetMidiEditorOpen,
  onUndo,
  onRedo,
  laneColor,
}) => {
  const effectiveClip = previewClip || clip;
  const lengthSec = Math.max(0.01, (effectiveClip.srcEndSec ?? 0) - (effectiveClip.srcStartSec ?? 0));
  const width = Math.max(80, lengthSec * pxPerSec);
  const left = (effectiveClip.timelineStartSec ?? 0) * pxPerSec;
  const waveformHeight = 48;
  const label =
    clip.label ||
    asset?.label ||
    (clip.clipType === "midi" ? "MIDI Clip" : clip.sourceAssetId || "Clip");
  const midi = clip.midi || null;
  const midiNotes = Array.isArray(midi?.notes) ? midi.notes : [];
  const midiBpm = Number(midi?.bpm) || Number(bpm) || 120;
  const midiPpq = Number(midi?.ppq) || 480;
  const showMidiOverlay = midiNotes.length > 0;
  const editorPxPerSec = Math.max(pxPerSec, 120);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorPlaying, setEditorPlaying] = useState(false);
  const [editorLoop, setEditorLoop] = useState(false);
  const [editorPlayheadSec, setEditorPlayheadSec] = useState(0);
  const [editorSelection, setEditorSelection] = useState(null);
  const [selectedNoteIndices, setSelectedNoteIndices] = useState(new Set());
  const [editorSelectionBox, setEditorSelectionBox] = useState(null);
  const menuRef = useRef(null);
  const editorTimerRef = useRef(null);
  const editorCanvasRef = useRef(null);
  const editorPlayRef = useRef({ raf: null, startMs: 0, startSec: 0, loopStart: 0, loopEnd: 0, loop: false });
  const selectingRef = useRef(null);
  const editorPlaybackApiRef = useRef({ start: null, stop: null });
  const editorClipboardRef = useRef(null);
  const laneColorSafe = laneColor || "#6aa6ff";
  const clipBg = hexToRgba(laneColorSafe, 0.12);
  const clipBorder = hexToRgba(laneColorSafe, 0.45);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  useEffect(() => {
    if (!editorOpen) return;
    const handleKey = (event) => {
      const key = event.key.toLowerCase();
      const isMod = event.ctrlKey || event.metaKey;
      if ((event.ctrlKey || event.metaKey) && key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          onRedo?.();
        } else {
          onUndo?.();
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === "y") {
        event.preventDefault();
        onRedo?.();
        return;
      }
      if (isMod && key === "c") {
        event.preventDefault();
        if (!selectedNoteIndices || selectedNoteIndices.size === 0) return;
        const ticksToSec = (ticks) => {
          const tps = (midiBpm * midiPpq) / 60;
          return Number(ticks || 0) / (tps || 1);
        };
        const selected = Array.from(selectedNoteIndices)
          .map((idx) => {
            const note = midiNotes[idx];
            if (!note) return null;
            const startSecRaw = Number.isFinite(note.startSec)
              ? Number(note.startSec)
              : ticksToSec(note.startTick);
            const durationSecRaw = Number.isFinite(note.durationSec)
              ? Number(note.durationSec)
              : ticksToSec(note.durationTick);
            return {
              note: note.note,
              midi: note.midi,
              velocity: note.velocity,
              startSecRaw,
              durationSec: Math.max(0.02, durationSecRaw || 0.05),
              source: note,
            };
          })
          .filter(Boolean);
        if (!selected.length) return;
        const baseStart = Math.min(...selected.map((item) => item.startSecRaw));
        editorClipboardRef.current = {
          baseStart,
          notes: selected,
        };
        return;
      }
      if (isMod && key === "v") {
        event.preventDefault();
        if (!onUpdateClip) return;
        const clipboard = editorClipboardRef.current;
        if (!clipboard || !clipboard.notes?.length) return;
        const ticksPerSec = (midiBpm * midiPpq) / 60;
        const clipStart = Number(effectiveClip.srcStartSec || 0);
        const clipEnd = clipStart + lengthSec;
        const pasteAt = clipStart + clamp(editorPlayheadSec, 0, lengthSec);
        const offset = pasteAt - clipboard.baseStart;
        const minDuration = 0.04;
        const nextNotes = [...midiNotes];
        const newIndices = [];
        clipboard.notes.forEach((item) => {
          const base = item.source ? { ...item.source } : {};
          const startRaw = clamp(item.startSecRaw + offset, clipStart, clipEnd - minDuration);
          const durationSec = Math.max(minDuration, item.durationSec || minDuration);
          const startTick = Math.max(0, Math.round(startRaw * ticksPerSec));
          const durationTick = Math.max(1, Math.round(durationSec * ticksPerSec));
          const next = {
            ...base,
            startTick,
            durationTick,
            startSec: startRaw,
            durationSec,
          };
          if ("note" in base || !("midi" in base)) {
            next.note = Number.isFinite(item.note) ? item.note : base.note ?? base.midi ?? 60;
          }
          if ("midi" in base) {
            next.midi = Number.isFinite(item.midi) ? item.midi : base.midi ?? base.note ?? 60;
          }
          if (Number.isFinite(item.velocity)) {
            next.velocity = item.velocity;
          }
          newIndices.push(nextNotes.length);
          nextNotes.push(next);
        });
        const nextMidi = { ...(clip.midi || {}), notes: nextNotes };
        onUpdateClip(clip.id, { midi: nextMidi });
        setSelectedNoteIndices(new Set(newIndices));
        setEditorSelectionBox(null);
        setEditorSelection(null);
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        if (editorPlaying) {
          editorPlaybackApiRef.current.stop?.();
        } else {
          editorPlaybackApiRef.current.start?.();
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setEditorOpen(false);
        onStopPreviewMidiNote?.();
        onStopMidiClipPreview?.();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    editorOpen,
    editorPlaying,
    midiNotes,
    midiBpm,
    midiPpq,
    selectedNoteIndices,
    editorPlayheadSec,
    effectiveClip.srcStartSec,
    lengthSec,
    clip.midi,
    onUpdateClip,
    onStopPreviewMidiNote,
    onStopMidiClipPreview,
    onUndo,
    onRedo,
  ]);

  useEffect(() => {
    onSetMidiEditorOpen?.(editorOpen);
    return () => onSetMidiEditorOpen?.(false);
  }, [editorOpen, onSetMidiEditorOpen]);

  useEffect(() => {
    if (!editorOpen) {
      if (editorTimerRef.current) {
        clearTimeout(editorTimerRef.current);
        editorTimerRef.current = null;
      }
      if (editorPlaying) {
        onStopMidiClipPreview?.();
        setEditorPlaying(false);
      }
      if (editorPlayRef.current.raf) {
        cancelAnimationFrame(editorPlayRef.current.raf);
        editorPlayRef.current.raf = null;
      }
    }
  }, [editorOpen, editorPlaying, onStopMidiClipPreview]);

  useEffect(() => {
    if (!editorOpen) return;
    if (!editorSelectionBox) return;
    const box = editorSelectionBox;
    if (Math.abs(box.width) < 6 && Math.abs(box.height) < 6) return;
    const minX = Math.min(box.left, box.left + box.width);
    const maxX = Math.max(box.left, box.left + box.width);
    const minY = Math.min(box.top, box.top + box.height);
    const maxY = Math.max(box.top, box.top + box.height);
    const startSec = clamp(minX / editorPxPerSec, 0, lengthSec);
    const endSec = clamp(maxX / editorPxPerSec, 0, lengthSec);
    const usableHeight = 440 - 6;
    const range = 128;
    const noteAtY = (y) =>
      clamp(127 - Math.floor((clamp(y, 0, usableHeight) / usableHeight) * range), 0, 127);
    const maxNote = noteAtY(minY);
    const minNote = noteAtY(maxY);
    const ticksToSec = (ticks) => {
      const tps = (midiBpm * midiPpq) / 60;
      return Number(ticks || 0) / (tps || 1);
    };
    const clipStart = Number(effectiveClip.srcStartSec || 0);
    const next = new Set();
    midiNotes.forEach((note, idx) => {
      const noteNum = Number(note.note ?? note.midi ?? 60);
      if (noteNum < minNote || noteNum > maxNote) return;
      const startSecRaw = Number.isFinite(note.startSec)
        ? Number(note.startSec)
        : ticksToSec(note.startTick);
      const durationSecRaw = Number.isFinite(note.durationSec)
        ? Number(note.durationSec)
        : ticksToSec(note.durationTick);
      const relStart = startSecRaw - clipStart;
      const relEnd = relStart + Math.max(0.01, durationSecRaw || 0);
      if (relEnd >= startSec && relStart <= endSec) {
        next.add(idx);
      }
    });
    setSelectedNoteIndices(next);
    setEditorSelection({ startSec, endSec });
  }, [editorOpen, editorSelectionBox, midiNotes, midiBpm, midiPpq, effectiveClip.srcStartSec, editorPxPerSec, lengthSec]);

  const stopEditorPlayback = () => {
    if (editorTimerRef.current) {
      clearTimeout(editorTimerRef.current);
      editorTimerRef.current = null;
    }
    if (editorPlayRef.current.raf) {
      cancelAnimationFrame(editorPlayRef.current.raf);
      editorPlayRef.current.raf = null;
    }
    onStopMidiClipPreview?.();
    setEditorPlaying(false);
  };

  const startEditorPlayback = () => {
    if (!onPlayMidiClipPreview) return;
    const hasSelection =
      editorSelection
      && Number.isFinite(editorSelection.startSec)
      && Number.isFinite(editorSelection.endSec)
      && Math.abs(editorSelection.endSec - editorSelection.startSec) > 0.02;
    const selectionStart = hasSelection ? Math.min(editorSelection.startSec, editorSelection.endSec) : 0;
    const selectionEnd = hasSelection ? Math.max(editorSelection.startSec, editorSelection.endSec) : lengthSec;
    const startSec = clamp(editorPlayheadSec, selectionStart, selectionEnd);
    const selectedNotes =
      selectedNoteIndices && selectedNoteIndices.size
        ? midiNotes.filter((_, idx) => selectedNoteIndices.has(idx))
        : midiNotes;
    const previewClip =
      selectedNotes.length && selectedNotes.length !== midiNotes.length
        ? { ...clip, midi: { ...(clip.midi || {}), notes: selectedNotes } }
        : clip;
    onPlayMidiClipPreview(previewClip, {
      loop: editorLoop,
      startSec,
      loopStartSec: selectionStart,
      loopEndSec: selectionEnd,
    });
    setEditorPlaying(true);
    editorPlayRef.current = {
      raf: editorPlayRef.current.raf,
      startMs: performance.now(),
      startSec,
      loopStart: selectionStart,
      loopEnd: selectionEnd,
      loop: editorLoop,
    };
    const tick = () => {
      const { startMs, startSec: baseSec, loopStart, loopEnd, loop } = editorPlayRef.current;
      const elapsed = (performance.now() - startMs) / 1000;
      const loopLen = Math.max(0, loopEnd - loopStart);
      let nextPos = baseSec + elapsed;
      if (loop && loopLen > 0.01) {
        const offset = (baseSec - loopStart + elapsed) % loopLen;
        nextPos = loopStart + offset;
      } else {
        nextPos = Math.min(loopEnd || lengthSec, nextPos);
        if (nextPos >= (loopEnd || lengthSec) - 0.001) {
          stopEditorPlayback();
          setEditorPlayheadSec(loopEnd || lengthSec);
          return;
        }
      }
      setEditorPlayheadSec(nextPos);
      editorPlayRef.current.raf = requestAnimationFrame(tick);
    };
    editorPlayRef.current.raf = requestAnimationFrame(tick);
  };

  useEffect(() => {
    editorPlaybackApiRef.current.start = startEditorPlayback;
    editorPlaybackApiRef.current.stop = stopEditorPlayback;
  }, [startEditorPlayback, stopEditorPlayback]);

  return (
    <div
      className={`studio-clip ${isSelected ? "selected" : ""} ${isDragging ? "dragging" : ""}`}
      style={{
        width,
        transform: `translateX(${left}px)`,
        "--lane-clip-bg": clipBg || undefined,
        "--lane-clip-border": clipBorder || undefined,
      }}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        if (e.defaultPrevented) return;
        if (e.target.closest(".studio-clip-actions")) return;
        if (e.target.closest(".studio-clip-handle")) return;
        if (e.target.closest(".studio-midi-note")) return;
        e.stopPropagation();
        onDragStart?.(e, clip);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(clip.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onSelect?.(clip.id);
        onSelectRange?.({
          range: {
            start: clip.timelineStartSec ?? 0,
            end: (clip.timelineStartSec ?? 0) + lengthSec,
          },
        });
      }}
    >
      <div className="studio-clip-header">
        <div className="studio-clip-title">
          <span>{label}</span>
          {laneFxActive && <span className="studio-tag">FX</span>}
        </div>
        <div className="studio-clip-actions" ref={menuRef}>
          <button
            className="studio-clip-menu-btn"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setMenuOpen((prev) => !prev);
            }}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="studio-clip-menu" onClick={(e) => e.stopPropagation()}>
              <button
                className="studio-clip-menu-item"
                onClick={() => {
                  onSplit?.(clip.id);
                  setMenuOpen(false);
                }}
              >
                Split at Playhead
              </button>
              <button
                className="studio-clip-menu-item"
                onClick={() => {
                  onSelectRange?.({
                    range: {
                      start: clip.timelineStartSec ?? 0,
                      end: (clip.timelineStartSec ?? 0) + lengthSec,
                    },
                  });
                  setMenuOpen(false);
                }}
              >
                Select Clip Range
              </button>
              {midiNotes.length > 0 && (
                <button
                  className="studio-clip-menu-item"
                  onClick={() => {
                    setEditorOpen(true);
                    setMenuOpen(false);
                  }}
                >
                  Open MIDI Editor
                </button>
              )}
              <button
                className="studio-clip-menu-item"
                onClick={() => {
                  onDelete?.(clip.id);
                  setMenuOpen(false);
                }}
              >
                Delete Clip
              </button>
            </div>
          )}
        </div>
      </div>
      <div
        className="studio-clip-handle left"
        onMouseDown={(e) => {
          e.stopPropagation();
          onTrimStart?.(e, clip, "left");
        }}
      />
      <div
        className="studio-clip-handle right"
        onMouseDown={(e) => {
          e.stopPropagation();
          onTrimStart?.(e, clip, "right");
        }}
      />
      <div className="studio-clip-wave">
        {clip.clipType === "midi" ? (
          <div className="studio-midi-surface" />
        ) : asset?.url ? (
          <StudioWaveform
            url={asset.url}
            height={waveformHeight}
            clipStartSec={effectiveClip.srcStartSec ?? 0}
            pixelsPerSecond={pxPerSec}
            color={laneColorSafe}
          />
        ) : (
          <div className="studio-clip-placeholder">No audio</div>
        )}
        {showMidiOverlay ? (
          <MidiOverlay
            notes={midiNotes}
            bpm={midiBpm}
            ppq={midiPpq}
            pxPerSec={pxPerSec}
            height={waveformHeight}
            clipStartSec={effectiveClip.srcStartSec ?? 0}
            clipDurationSec={lengthSec}
            editable
            snapEnabled={false}
            gridSec={gridSec}
            noteColor={laneColorSafe}
            onUpdateNotes={(nextNotes) => {
              if (!onUpdateClip) return;
              const nextMidi = { ...(clip.midi || {}), notes: nextNotes };
              onUpdateClip(clip.id, { midi: nextMidi });
            }}
            onPreviewNote={({ noteNumber, velocity, durationSec }) => {
              onPreviewMidiNote?.({
                laneId: clip.laneId,
                noteNumber,
                velocity,
                durationSec,
                clipGainDb: clip.gainDb,
                soundfontName: clip.midi?.soundfont,
              });
            }}
            onPreviewEnd={() => onStopPreviewMidiNote?.()}
          />
        ) : clip.clipType === "midi" ? (
          <div className="studio-clip-placeholder studio-midi-empty">
            MIDI Clip · {clip.midi?.notes?.length || 0} notes
          </div>
        ) : null}
      </div>
      <div className="studio-clip-length">{lengthSec.toFixed(2)}s</div>
      {editorOpen &&
        createPortal(
          <div
            className="studio-midi-editor-backdrop"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (event.target === event.currentTarget) {
                setEditorOpen(false);
                onStopPreviewMidiNote?.();
                onStopMidiClipPreview?.();
              }
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <div className="studio-midi-editor" onMouseDown={(event) => event.stopPropagation()}>
              <div className="studio-midi-editor-header">
                <div className="studio-midi-editor-title">
                  {label} · MIDI Editor
                </div>
                <div className="studio-midi-editor-actions">
                  <button
                    className="studio-midi-editor-btn"
                    onClick={() => onUndo?.()}
                  >
                    Undo
                  </button>
                  <button
                    className="studio-midi-editor-btn"
                    onClick={() => onRedo?.()}
                  >
                    Redo
                  </button>
                  <button
                    className={`studio-midi-editor-btn ${editorPlaying ? "active" : ""}`}
                    onClick={() => {
                      if (editorPlaying) {
                        stopEditorPlayback();
                      } else {
                        startEditorPlayback();
                      }
                    }}
                  >
                    {editorPlaying ? "Stop" : "Play"}
                  </button>
                  <button
                    className={`studio-midi-editor-btn ${editorLoop ? "active" : ""}`}
                    onClick={() => {
                      const next = !editorLoop;
                      setEditorLoop(next);
                      if (editorPlaying) {
                        stopEditorPlayback();
                        if (next) {
                          startEditorPlayback();
                        }
                      }
                    }}
                  >
                    {editorLoop ? "Looping" : "Loop"}
                  </button>
                  <button
                    className="studio-midi-editor-close"
                    onClick={() => {
                      setEditorOpen(false);
                      onStopPreviewMidiNote?.();
                      onStopMidiClipPreview?.();
                    }}
                  >
                    Close
                  </button>
                </div>
              </div>
              <div className="studio-midi-editor-body">
              {midiNotes.length > 0 ? (
                <div
                  className="studio-midi-editor-canvas"
                  ref={editorCanvasRef}
                  style={{
                    "--grid-step": `${Math.max(24, Math.round(editorPxPerSec * (gridSec || 0.5)))}px`,
                  }}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    if (event.target.closest(".studio-midi-note")) return;
                    if (event.target.closest(".studio-midi-handle")) return;
                    if (event.target.closest(".studio-midi-editor-playhead")) return;
                    const rect = editorCanvasRef.current?.getBoundingClientRect();
                    if (!rect) return;
                    const x = event.clientX - rect.left;
                    const nextSec = clamp(x / editorPxPerSec, 0, lengthSec);
                    setEditorPlayheadSec(nextSec);
                    selectingRef.current = {
                      startX: x,
                      startY: event.clientY - rect.top,
                      startClientX: event.clientX,
                      startClientY: event.clientY,
                      lastX: x,
                      lastY: event.clientY - rect.top,
                    };
                    setEditorSelection(null);
                    setEditorSelectionBox({
                      left: x,
                      top: event.clientY - rect.top,
                      width: 0,
                      height: 0,
                    });
                    const handleMove = (moveEvent) => {
                      const rectMove = editorCanvasRef.current?.getBoundingClientRect();
                      if (!rectMove) return;
                      const mx = moveEvent.clientX - rectMove.left;
                      const my = moveEvent.clientY - rectMove.top;
                      const sel = selectingRef.current;
                      if (!sel) return;
                      sel.lastX = mx;
                      sel.lastY = my;
                      const dist = Math.max(
                        Math.abs(moveEvent.clientX - sel.startClientX),
                        Math.abs(moveEvent.clientY - sel.startClientY)
                      );
                      if (dist < 4) return;
                      setEditorSelectionBox({
                        left: sel.startX,
                        top: sel.startY,
                        width: mx - sel.startX,
                        height: my - sel.startY,
                      });
                    };
                    const handleUp = () => {
                      window.removeEventListener("mousemove", handleMove);
                      window.removeEventListener("mouseup", handleUp);
                      const sel = selectingRef.current;
                      selectingRef.current = null;
                      if (!sel) return;
                      const dist = Math.max(
                        Math.abs((sel.lastX ?? sel.startX) - sel.startX),
                        Math.abs((sel.lastY ?? sel.startY) - sel.startY)
                      );
                      if (dist < 6) {
                        setEditorSelection(null);
                        setEditorSelectionBox(null);
                        setSelectedNoteIndices(new Set());
                      }
                    };
                    window.addEventListener("mousemove", handleMove);
                    window.addEventListener("mouseup", handleUp);
                  }}
                >
                  {editorSelectionBox && (
                    <div
                      className="studio-midi-editor-selection"
                      style={{
                        left: `${Math.min(editorSelectionBox.left, editorSelectionBox.left + editorSelectionBox.width)}px`,
                        top: `${Math.min(editorSelectionBox.top, editorSelectionBox.top + editorSelectionBox.height)}px`,
                        width: `${Math.abs(editorSelectionBox.width)}px`,
                        height: `${Math.abs(editorSelectionBox.height)}px`,
                      }}
                    />
                  )}
                  <div
                    className="studio-midi-editor-playhead"
                    style={{ left: `${editorPlayheadSec * editorPxPerSec}px` }}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const handleMove = (moveEvent) => {
                        const rect = editorCanvasRef.current?.getBoundingClientRect();
                        if (!rect) return;
                        const mx = moveEvent.clientX - rect.left;
                        const nextSec = clamp(mx / editorPxPerSec, 0, lengthSec);
                        setEditorPlayheadSec(nextSec);
                      };
                      const handleUp = () => {
                        window.removeEventListener("pointermove", handleMove);
                        window.removeEventListener("pointerup", handleUp);
                      };
                      window.addEventListener("pointermove", handleMove);
                      window.addEventListener("pointerup", handleUp);
                    }}
                  />
                  <MidiOverlay
                    notes={midiNotes}
                    bpm={midiBpm}
                    ppq={midiPpq}
                    pxPerSec={editorPxPerSec}
                    height={440}
                    clipStartSec={effectiveClip.srcStartSec ?? 0}
                    clipDurationSec={lengthSec}
                    editable
                    snapEnabled={false}
                    gridSec={gridSec}
                    noteRange={{ min: 0, max: 127 }}
                    selectedIndices={Array.from(selectedNoteIndices)}
                    noteColor={laneColorSafe}
                    onSelectionChange={(nextIndices) => {
                      setSelectedNoteIndices(new Set(nextIndices));
                      setEditorSelection(null);
                      setEditorSelectionBox(null);
                    }}
                    onUpdateNotes={(nextNotes) => {
                      if (!onUpdateClip) return;
                      const nextMidi = { ...(clip.midi || {}), notes: nextNotes };
                      onUpdateClip(clip.id, { midi: nextMidi });
                    }}
                      onPreviewNote={({ noteNumber, velocity, durationSec }) => {
                        onPreviewMidiNote?.({
                          laneId: clip.laneId,
                          noteNumber,
                          velocity,
                          durationSec,
                          clipGainDb: clip.gainDb,
                          soundfontName: clip.midi?.soundfont,
                        });
                      }}
                      onPreviewEnd={() => onStopPreviewMidiNote?.()}
                    />
                  </div>
                ) : (
                  <div className="studio-clip-placeholder studio-midi-empty">
                    No MIDI notes in this clip.
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default ClipView;
