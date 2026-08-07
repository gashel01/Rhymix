import React, { useEffect, useRef, useState } from "react";
import { hexToRgba, readableInk } from "../../utils/color";
import { createPortal } from "react-dom";
import StudioWaveform from "./StudioWaveform";
import MidiOverlay from "./MidiOverlay";
import {
  CLIP_HEIGHT,
  CLIP_HEIGHT_WITH_LYRICS,
  CLIP_HEIGHT_WITH_EDITOR,
  WAVEFORM_HEIGHT,
  WAVEFORM_HEIGHT_WITH_LYRICS,
} from "../timelineMetrics";

/* Regions inside a clip that own a gesture of their own, so the clip body must
   not claim the pointer from them: the trim handles resize, the ⋯ button opens
   a menu, MIDI notes are dragged individually, and the lyrics and MIDI editors
   are full interactive surfaces. Everything else is draggable clip body. */
const OWN_GESTURE = [
  ".studio-clip-handle",
  ".studio-clip-actions",
  ".studio-midi-note",
  ".studio-midi-editor",
  ".studio-clip-lyrics-edit",
  ".studio-clip-lyrics-edit-wrap",
  ".studio-clip-lyrics-edit-actions",
  ".studio-clip-lyrics-entry",
].join(", ");

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
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
  currentTime,
  lyricsEntries,
  selectionRange,
  selectionLaneIds,
  onUpdateLyricsText,
  onDeleteLyricsEntry,
  onRestoreLyricsEntry,
  onResynthesizeSelection,
}) => {
  const effectiveClip = previewClip || clip;
  const lengthSec = Math.max(0.01, (effectiveClip.srcEndSec ?? 0) - (effectiveClip.srcStartSec ?? 0));
  const width = Math.max(80, lengthSec * pxPerSec);
  const left = (effectiveClip.timelineStartSec ?? 0) * pxPerSec;
  const entries = Array.isArray(lyricsEntries)
    ? lyricsEntries.filter(Boolean)
    : lyricsEntries && typeof lyricsEntries === "object"
      ? [lyricsEntries]
      : [];
  const clipStartSec = effectiveClip.timelineStartSec ?? 0;
  const clipEndSec = clipStartSec + lengthSec;
  const resolveEntryTimelineRange = (entry) => {
    if (!entry) return null;
    if (entry.rangeClip && Number.isFinite(entry.rangeClip.start) && Number.isFinite(entry.rangeClip.end)) {
      return {
        start: clipStartSec + Number(entry.rangeClip.start),
        end: clipStartSec + Number(entry.rangeClip.end),
      };
    }
    if (
      entry.clipStartAtTranscribe != null
      && entry.range
      && Number.isFinite(entry.range.start)
      && Number.isFinite(entry.range.end)
    ) {
      const offsetStart = Number(entry.range.start) - Number(entry.clipStartAtTranscribe);
      const offsetEnd = Number(entry.range.end) - Number(entry.clipStartAtTranscribe);
      return {
        start: clipStartSec + offsetStart,
        end: clipStartSec + offsetEnd,
      };
    }
    if (entry.range && Number.isFinite(entry.range.start) && Number.isFinite(entry.range.end)) {
      return {
        start: Number(entry.range.start),
        end: Number(entry.range.end),
      };
    }
    return null;
  };

  const entriesWithRange = entries
    .map((entry) => ({ entry, timelineRange: resolveEntryTimelineRange(entry) }))
    .filter((item) => {
      if (!item.timelineRange) return false;
      const { start, end } = item.timelineRange;
      return end > clipStartSec && start < clipEndSec;
    });
  const hasLyrics = entriesWithRange.length > 0;
  const isAudioClip = clip.clipType !== "midi";
  const showLyrics = isAudioClip && hasLyrics;
  const waveformHeight = showLyrics ? WAVEFORM_HEIGHT_WITH_LYRICS : WAVEFORM_HEIGHT;
  const canEditLyrics = showLyrics && entriesWithRange.length > 0;
  const selectionStartRaw = selectionRange
    ? Math.min(Number(selectionRange.start ?? 0), Number(selectionRange.end ?? 0))
    : null;
  const selectionEndRaw = selectionRange
    ? Math.max(Number(selectionRange.start ?? 0), Number(selectionRange.end ?? 0))
    : null;
  const selectionLaneOk = !Array.isArray(selectionLaneIds) || selectionLaneIds.length === 0 || selectionLaneIds.includes(clip.laneId);
  const selectionOverlapsClip = selectionLaneOk
    && selectionStartRaw != null
    && selectionEndRaw != null
    && selectionEndRaw > clipStartSec
    && selectionStartRaw < clipEndSec;
  const selectionStartInClip = selectionOverlapsClip
    ? clamp(selectionStartRaw - clipStartSec, 0, lengthSec)
    : 0;
  const selectionEndInClip = selectionOverlapsClip
    ? clamp(selectionEndRaw - clipStartSec, 0, lengthSec)
    : 0;
  const selectionWidthSec = selectionOverlapsClip ? Math.max(0.001, selectionEndInClip - selectionStartInClip) : 0;
  const selectionLeftPx = selectionOverlapsClip ? selectionStartInClip * pxPerSec : 0;
  const selectionWidthPx = selectionOverlapsClip ? Math.max(1, selectionWidthSec * pxPerSec) : 0;
  const selectionMatchesEntry = (timelineRange) =>
    Boolean(
      timelineRange
        && selectionStartRaw != null
        && selectionEndRaw != null
        && Math.abs(Number(timelineRange.start ?? 0) - selectionStartRaw) < 0.05
        && Math.abs(Number(timelineRange.end ?? 0) - selectionEndRaw) < 0.05
    );
  const matchedEntry = entriesWithRange.find((item) => selectionMatchesEntry(item.timelineRange));
  const showEditor = canEditLyrics && selectionOverlapsClip && Boolean(matchedEntry);
  const clipHeight = showLyrics ? (showEditor ? CLIP_HEIGHT_WITH_EDITOR : CLIP_HEIGHT_WITH_LYRICS) : CLIP_HEIGHT;
  const matchedOriginal = matchedEntry?.entry?.originalText;
  const canRestoreLyrics =
    matchedOriginal != null && String(matchedOriginal || "") !== String(matchedEntry?.entry?.text || "");
  const isLyricsTranscribing = matchedEntry?.entry?.status === "transcribing";
  const canResynthesizeLyrics =
    Boolean(matchedEntry?.entry?.text && String(matchedEntry.entry.text).trim().length > 0)
    && !isLyricsTranscribing;
  const actionsLeftPx = showEditor
    ? Math.min(selectionLeftPx + selectionWidthPx + 8, Math.max(0, width - 110))
    : 0;
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
  /* The clip is the colour, not a tint of it. Washing the hue down to 0.07 and
     drawing a pale waveform on top gave a correct but inert arrangement — you
     could not tell two lanes apart across the room. Suno paints the whole
     region in the track colour and cuts the signal out of it in darker ink;
     that is what makes the timeline readable at a glance. */
  const clipBg = hexToRgba(laneColorSafe, 0.92);
  const clipBorder = hexToRgba(laneColorSafe, 1);
  /* Which ink stays legible depends on the hue: our palette runs from a dark
     indigo to a bright yellow-green, so this cannot be a fixed colour. */
  const clipInk = readableInk(laneColorSafe);

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
    // The handler calls onUpdateClip(clip.id, ...). Timeline keys ClipView by
    // clip.id so today a change remounts rather than re-runs, but the effect
    // should not depend on that staying true.
    clip.id,
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
        height: clipHeight,
        transform: `translateX(${left}px)`,
        "--lane-clip-bg": clipBg || undefined,
        "--lane-clip-border": clipBorder || undefined,
        "--lane-clip-ink": clipInk,
      }}
      /* Dragging and double-click are discoverable from the cursor and from
         habit; Alt-drag is not, and it is the only way to select a range over
         a clip that spans the whole view. */
      title="Drag to move · Alt-drag to select a range · Double-click to select the whole clip"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if (e.defaultPrevented) return;
        // The whole clip is the drag surface. Only the controls that own a
        // different gesture are carved out, named once in OWN_GESTURE. The
        // previous rule was the inverse — six negative guards ending in
        // "audio clips only drag from their header" — which left ~20% of a
        // clip draggable and the other 80% doing something else entirely.
        if (e.target.closest(OWN_GESTURE)) return;
        // Alt hands the clip surface back to the timeline so a range can be
        // selected across a clip that spans the whole view.
        if (e.altKey) return;
        e.stopPropagation();
        onDragStart?.(e, clip);
      }}
      onClick={(e) => {
        if (e.target.closest(OWN_GESTURE)) return;
        if (e.altKey) return;
        e.stopPropagation();
        onSelect?.(clip.id);
      }}
      onDoubleClick={(e) => {
        if (e.target.closest(OWN_GESTURE)) return;
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
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          onTrimStart?.(e, clip, "left");
        }}
      />
      <div
        className="studio-clip-handle right"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
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
            color={clipInk}
            inkAlpha={0.42}
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
      {showLyrics ? (
        <div className="studio-clip-lyrics-track">
          {entriesWithRange.map((item, index) => {
            const entry = item.entry;
            const entryStartRaw = Number(item.timelineRange.start ?? 0);
            const entryEndRaw = Number(item.timelineRange.end ?? 0);
            const entryStartInClip = clamp(entryStartRaw - clipStartSec, 0, lengthSec);
            const entryEndInClip = clamp(entryEndRaw - clipStartSec, 0, lengthSec);
            const entryWidthSec = Math.max(0.001, entryEndInClip - entryStartInClip);
            const entryLeftPx = entryStartInClip * pxPerSec;
            const entryWidthPx = Math.max(24, entryWidthSec * pxPerSec);
            const isActive = Number.isFinite(currentTime) && currentTime >= entryStartRaw && currentTime <= entryEndRaw;
            return (
              <div
                key={`${clip.id}-lyric-${index}`}
                className={`studio-clip-lyrics-entry${isActive ? " active" : ""}`}
                style={{
                  left: entryLeftPx,
                  width: Math.min(entryWidthPx, Math.max(24, width - entryLeftPx)),
                }}
                title={entry.text || "Lyrics"}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectRange?.({
                    range: { start: entryStartRaw, end: entryEndRaw },
                    laneIds: [clip.laneId],
                  });
                }}
              >
                <span className="studio-clip-lyrics-entry-text">
                  {entry.text || (entry.status === "transcribing" ? "Transcribing..." : "Lyrics")}
                </span>
                {entry.status === "transcribing" && <span className="studio-spinner" />}
              </div>
            );
          })}
          <span className="studio-clip-lyrics-length">{lengthSec.toFixed(2)}s</span>
        </div>
      ) : (
        <div className="studio-clip-length">{lengthSec.toFixed(2)}s</div>
      )}
      {showEditor && (
        <div
          className="studio-clip-lyrics-edit-wrap"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <textarea
            className="studio-clip-lyrics-edit"
            style={{
              left: selectionLeftPx,
              width: Math.max(1, Math.min(selectionWidthPx, Math.max(1, width - selectionLeftPx))),
            }}
            value={matchedEntry?.entry?.text || ""}
            onChange={(event) =>
              onUpdateLyricsText?.(clip.id, event.target.value, {
                range: {
                  start: selectionStartRaw,
                  end: selectionEndRaw,
                },
                rangeClip: matchedEntry?.entry?.rangeClip || null,
                clipStartAtTranscribe: matchedEntry?.entry?.clipStartAtTranscribe ?? null,
              })
            }
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            placeholder={matchedEntry?.entry?.status === "transcribing" ? "Transcribing..." : "Edit lyrics..."}
            disabled={matchedEntry?.entry?.status === "transcribing"}
            rows={1}
          />
          <div
            className="studio-clip-lyrics-edit-actions"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            style={{ left: actionsLeftPx }}
          >
            <button
              type="button"
              className="studio-clip-lyrics-edit-btn"
              disabled={!canResynthesizeLyrics}
              onClick={() =>
                onResynthesizeSelection?.({
                  clip,
                  range: {
                    start: selectionStartRaw,
                    end: selectionEndRaw,
                  },
                  text: matchedEntry?.entry?.text || "",
                  rangeClip: matchedEntry?.entry?.rangeClip || null,
                })
              }
              title={canResynthesizeLyrics ? "Resynthesize vocals" : "Add lyrics to resynthesize"}
            >
              Resing
            </button>
            {canRestoreLyrics && (
              <button
                type="button"
                className="studio-clip-lyrics-edit-btn"
                disabled={isLyricsTranscribing}
                onClick={() =>
                  onRestoreLyricsEntry?.(clip.id, {
                    range: { start: selectionStartRaw, end: selectionEndRaw },
                    rangeClip: matchedEntry?.entry?.rangeClip || null,
                  })
                }
                title="Restore original transcript"
              >
                Restore
              </button>
            )}
            <button
              type="button"
              className="studio-clip-lyrics-edit-btn danger"
              disabled={isLyricsTranscribing}
              onClick={() =>
                onDeleteLyricsEntry?.(clip.id, {
                  range: { start: selectionStartRaw, end: selectionEndRaw },
                  rangeClip: matchedEntry?.entry?.rangeClip || null,
                })
              }
              title="Delete this transcript"
            >
              Delete
            </button>
          </div>
        </div>
      )}
      {editorOpen &&
        createPortal(
          <div
            className="studio-midi-editor-backdrop"
            onPointerDown={(event) => {
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
            <div className="studio-midi-editor" onPointerDown={(event) => event.stopPropagation()}>
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
