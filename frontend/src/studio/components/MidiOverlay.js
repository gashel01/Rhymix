import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hexToRgba } from "../../utils/color";

const ticksToSec = (ticks, bpm, ppq) => {
  const safeBpm = Number(bpm) || 120;
  const safePpq = Number(ppq) || 480;
  const tps = (safeBpm * safePpq) / 60;
  return Number(ticks || 0) / tps;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const MidiOverlay = ({
  notes = [],
  bpm = 120,
  ppq = 480,
  pxPerSec = 80,
  height = 48,
  clipStartSec = 0,
  clipDurationSec,
  editable = false,
  snapEnabled = false,
  gridSec = 0.5,
  onUpdateNotes,
  onPreviewNote,
  onPreviewEnd,
  noteRange,
  selectedIndices,
  onSelectionChange,
  noteColor,
}) => {
  const notesRef = useRef(notes);
  const dragRef = useRef(null);
  const [dragIndex, setDragIndex] = useState(null);
  const selectedSet = useMemo(() => new Set(selectedIndices || []), [selectedIndices]);

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  const rendered = useMemo(() => {
    if (!Array.isArray(notes) || notes.length === 0) return [];
    const noteNums = notes
      .map((note) => Number(note.note ?? note.midi ?? 60))
      .filter((value) => Number.isFinite(value));
    const rangeProvided =
      noteRange
      && Number.isFinite(noteRange.min)
      && Number.isFinite(noteRange.max);
    if (!noteNums.length && !rangeProvided) return [];
    let minNote = rangeProvided ? clamp(Number(noteRange.min), 0, 127) : Math.min(...noteNums);
    let maxNote = rangeProvided ? clamp(Number(noteRange.max), 0, 127) : Math.max(...noteNums);
    if (minNote > maxNote) {
      const tmp = minNote;
      minNote = maxNote;
      maxNote = tmp;
    }
    const range = Math.max(1, maxNote - minNote + 1);
    const usableHeight = Math.max(12, height - 6);
    const minNoteHeight = rangeProvided ? 2 : 4;
    const noteHeight = Math.max(minNoteHeight, usableHeight / range);
    const safePxPerSec = Math.max(1, pxPerSec);
    const safeClipDuration = Math.max(0.01, Number(clipDurationSec || 0));

    return notes.map((note, idx) => {
      const noteNum = Number(note.note ?? note.midi ?? 60);
      const velocity = Number(note.velocity ?? 90);
      const startTick = Number(note.startTick ?? 0);
      const durTick = Number(note.durationTick ?? 0);
      const startSecRaw = Number.isFinite(note.startSec)
        ? Number(note.startSec)
        : ticksToSec(startTick, bpm, ppq);
      const durSecRaw = Number.isFinite(note.durationSec)
        ? Number(note.durationSec)
        : ticksToSec(durTick, bpm, ppq);
      const startSec = startSecRaw - (Number(clipStartSec) || 0);
      const durationSec = Math.max(0.02, durSecRaw || 0.05);
      if (!Number.isFinite(startSec) || startSec > safeClipDuration) return null;
      const left = startSec * safePxPerSec;
      const width = Math.max(2, durationSec * safePxPerSec);
      const noteIdx = clamp(noteNum, minNote, maxNote) - minNote;
      const top = clamp(
        usableHeight - (noteIdx + 1) * noteHeight,
        2,
        usableHeight - noteHeight + 2
      );
      const opacity = clamp(velocity / 127, 0.35, 1);

      return {
        index: idx,
        noteNum,
        velocity,
        startSecRaw,
        durationSecRaw: durationSec,
        startTick,
        durationTick: Number.isFinite(durTick) && durTick > 0 ? durTick : null,
        minNote,
        maxNote,
        noteHeight,
        key: `${noteNum}-${idx}`,
        style: {
          left,
          width,
          top,
          height: noteHeight,
          opacity,
        },
      };
    });
  // noteRange is read above (it clamps minNote/maxNote) but was missing here,
  // so changing the visible pitch range left the notes drawn at the old one.
  }, [notes, bpm, ppq, pxPerSec, height, clipStartSec, clipDurationSec, noteRange]);

  const startDrag = useCallback(
    (event, info, mode = "move") => {
      if (!editable || !onUpdateNotes || !info) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.currentTarget?.setPointerCapture) {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      let nextSelection = selectedSet;
      if (!nextSelection || nextSelection.size === 0 || !nextSelection.has(info.index)) {
        nextSelection = new Set([info.index]);
      }
      const baseStart = Number(info.startSecRaw || 0);
      const baseDuration = Number(info.durationSecRaw || 0.05);
      const selectedData = Array.from(nextSelection).map((idx) => {
        const note = notesRef.current?.[idx];
        if (!note) return null;
        const noteNum = Number(note.note ?? note.midi ?? 60);
        const startTick = Number(note.startTick ?? 0);
        const durTick = Number(note.durationTick ?? 0);
        const startSecRaw = Number.isFinite(note.startSec)
          ? Number(note.startSec)
          : ticksToSec(startTick, bpm, ppq);
        const durSecRaw = Number.isFinite(note.durationSec)
          ? Number(note.durationSec)
          : ticksToSec(durTick, bpm, ppq);
        return {
          idx,
          noteNum,
          startSecRaw,
          durationSecRaw: Math.max(0.02, durSecRaw || 0.05),
          durationTick: Number.isFinite(durTick) && durTick > 0 ? durTick : null,
        };
      }).filter(Boolean);
      const minStart = selectedData.length
        ? Math.min(...selectedData.map((item) => item.startSecRaw))
        : baseStart;
      const maxEnd = selectedData.length
        ? Math.max(...selectedData.map((item) => item.startSecRaw + item.durationSecRaw))
        : baseStart + baseDuration;
      const minNoteSel = selectedData.length
        ? Math.min(...selectedData.map((item) => item.noteNum))
        : Number(info.noteNum || 60);
      const maxNoteSel = selectedData.length
        ? Math.max(...selectedData.map((item) => item.noteNum))
        : Number(info.noteNum || 60);
      dragRef.current = {
        pointerId: event.pointerId,
        index: info.index,
        mode,
        startX: event.clientX,
        startY: event.clientY,
        baseStartSecRaw: baseStart,
        baseDurationSec: baseDuration,
        baseEndSecRaw: baseStart + baseDuration,
        baseNoteNum: Number(info.noteNum || 60),
        baseVelocity: Number(info.velocity || 90),
        noteHeight: Math.max(4, Number(info.noteHeight || 6)),
        clipStartSec: Number(clipStartSec || 0),
        clipDurationSec: Number(clipDurationSec || 0),
        bpm: Number(bpm) || 120,
        ppq: Number(ppq) || 480,
        durationTick: Number.isFinite(info.durationTick) ? Number(info.durationTick) : null,
        lastStartTick: null,
        lastNoteNum: null,
        lastDurationTick: null,
        lastPreviewNote: null,
        selectedData,
        minStart,
        maxEnd,
        minNoteSel,
        maxNoteSel,
        lastPreviewAt: 0,
      };
      setDragIndex(info.index);
      if (onPreviewNote) {
        const payload = {
          noteNumber: Number(info.noteNum || 60),
          velocity: Number(info.velocity || 90),
        };
        if (mode !== "move") {
          payload.durationSec = baseDuration;
        }
        onPreviewNote(payload);
        dragRef.current.lastPreviewNote = Number(info.noteNum || 60);
        dragRef.current.lastPreviewAt = performance.now();
      }
    },
    // onSelectionChange is not referenced in this callback; listing it only
    // rebuilt startDrag whenever the parent passed a new function identity.
    [editable, onUpdateNotes, clipStartSec, clipDurationSec, bpm, ppq, onPreviewNote, selectedSet]
  );

  useEffect(() => {
    if (!editable || !onUpdateNotes) return undefined;
    const handleMove = (event) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const safePxPerSec = Math.max(1, pxPerSec);
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const deltaSec = dx / safePxPerSec;
      const minDuration = 0.04;
      const clipStart = drag.clipStartSec;
      const clipEnd = Number.isFinite(drag.clipDurationSec) && drag.clipDurationSec > 0
        ? clipStart + drag.clipDurationSec
        : Infinity;
      let nextStartRaw = drag.baseStartSecRaw;
      let nextDurationSec = drag.baseDurationSec;
      let nextNoteNum = drag.baseNoteNum;
      let deltaNotes = 0;

      if (drag.mode === "move") {
        const baseLocalStart = drag.baseStartSecRaw - clipStart;
        let nextLocalStart = baseLocalStart + deltaSec;
        if (snapEnabled && gridSec) {
          const snap = Math.max(0.01, Number(gridSec));
          nextLocalStart = Math.round(nextLocalStart / snap) * snap;
        }
        let maxStart = Number.isFinite(drag.clipDurationSec) && drag.clipDurationSec > 0
          ? drag.clipDurationSec - drag.baseDurationSec
          : Infinity;
        if (Number.isFinite(maxStart)) {
          maxStart = Math.max(0, maxStart);
          nextLocalStart = clamp(nextLocalStart, 0, maxStart);
        } else {
          nextLocalStart = Math.max(0, nextLocalStart);
        }
        nextStartRaw = nextLocalStart + clipStart;
        deltaNotes = Math.round(-dy / drag.noteHeight);
        const minDelta = -drag.minNoteSel;
        const maxDelta = 127 - drag.maxNoteSel;
        deltaNotes = clamp(deltaNotes, minDelta, maxDelta);
        nextNoteNum = clamp(drag.baseNoteNum + deltaNotes, 0, 127);
        if (drag.selectedData && drag.selectedData.length > 1) {
          const minDeltaSec = clipStart - drag.minStart;
          const maxDeltaSec = clipEnd === Infinity ? Infinity : clipEnd - drag.maxEnd;
          const clampedDeltaSec = clamp(deltaSec, minDeltaSec, maxDeltaSec);
          nextStartRaw = drag.baseStartSecRaw + clampedDeltaSec;
        }
      } else if (drag.mode === "resize-left") {
        let nextStart = drag.baseStartSecRaw + deltaSec;
        if (snapEnabled && gridSec) {
          const snap = Math.max(0.01, Number(gridSec));
          nextStart = Math.round(nextStart / snap) * snap;
        }
        const maxStart = Math.min(drag.baseEndSecRaw - minDuration, clipEnd - minDuration);
        nextStartRaw = clamp(nextStart, clipStart, maxStart);
        nextDurationSec = Math.max(minDuration, drag.baseEndSecRaw - nextStartRaw);
      } else if (drag.mode === "resize-right") {
        let nextEnd = drag.baseEndSecRaw + deltaSec;
        if (snapEnabled && gridSec) {
          const snap = Math.max(0.01, Number(gridSec));
          nextEnd = Math.round(nextEnd / snap) * snap;
        }
        const minEnd = drag.baseStartSecRaw + minDuration;
        nextEnd = clamp(nextEnd, minEnd, clipEnd);
        nextDurationSec = Math.max(minDuration, nextEnd - drag.baseStartSecRaw);
        nextStartRaw = drag.baseStartSecRaw;
      }

      const currentNotes = notesRef.current || [];
      const target = currentNotes[drag.index];
      if (!target) return;
      const ticksPerSec = (drag.bpm * drag.ppq) / 60;
      const nextStartTick = Math.max(0, Math.round(nextStartRaw * ticksPerSec));
      const nextDurationTick = Math.max(1, Math.round(nextDurationSec * ticksPerSec));
      if (
        drag.lastStartTick === nextStartTick
        && drag.lastNoteNum === nextNoteNum
        && drag.lastDurationTick === nextDurationTick
      ) {
        return;
      }
      drag.lastStartTick = nextStartTick;
      drag.lastNoteNum = nextNoteNum;
      drag.lastDurationTick = nextDurationTick;
      if (onPreviewNote) {
        const now = performance.now();
        const velocity = Number(target.velocity ?? drag.baseVelocity ?? 90);
        if (drag.mode === "move" && drag.lastPreviewNote !== nextNoteNum) {
          onPreviewNote({ noteNumber: nextNoteNum, velocity });
          drag.lastPreviewNote = nextNoteNum;
          drag.lastPreviewAt = now;
        } else if (drag.mode !== "move" && now - (drag.lastPreviewAt || 0) > 120) {
          onPreviewNote({
            noteNumber: drag.baseNoteNum,
            velocity,
            durationSec: nextDurationSec,
          });
          drag.lastPreviewAt = now;
        }
      }
      let nextNotes = currentNotes;
        if (drag.mode === "move" && drag.selectedData && drag.selectedData.length > 1) {
          const clampedDeltaSec = nextStartRaw - drag.baseStartSecRaw;
          const minStartTick = Math.min(
            ...drag.selectedData.map((item) => Math.max(0, Math.round((item.startSecRaw + clampedDeltaSec) * ticksPerSec)))
          );
          if (minStartTick < 0) {
            return;
          }
          nextNotes = currentNotes.map((note, idx) => {
            const selectedItem = drag.selectedData.find((item) => item.idx === idx);
            if (!selectedItem) return note;
          const next = { ...note };
          const baseStart = selectedItem.startSecRaw;
          const baseDur = selectedItem.durationSecRaw;
          const baseNote = selectedItem.noteNum;
          const startRaw = baseStart + clampedDeltaSec;
          const durationSec = baseDur;
          const noteNum = clamp(baseNote + deltaNotes, 0, 127);
          const startTick = Math.max(0, Math.round(startRaw * ticksPerSec));
          const durationTick = selectedItem.durationTick != null
            ? selectedItem.durationTick
            : Math.max(1, Math.round(durationSec * ticksPerSec));
          if ("note" in next || !("midi" in next)) {
            next.note = noteNum;
          }
          if ("midi" in next) {
            next.midi = noteNum;
          }
          next.startTick = startTick;
          next.durationTick = durationTick;
          if ("startSec" in next || "durationSec" in next) {
            next.startSec = startRaw;
          }
          next.durationSec = durationSec;
          return next;
        });
      } else {
        nextNotes = currentNotes.map((note, idx) => {
          if (idx !== drag.index) return note;
          const next = { ...note };
          if (drag.mode === "move") {
            if ("note" in next || !("midi" in next)) {
              next.note = nextNoteNum;
            }
            if ("midi" in next) {
              next.midi = nextNoteNum;
            }
          }
          next.startTick = nextStartTick;
          next.durationTick =
            drag.mode === "move"
              ? (drag.durationTick != null ? drag.durationTick : nextDurationTick)
              : nextDurationTick;
          next.startSec = nextStartRaw;
          next.durationSec = nextDurationSec;
          return next;
        });
      }
      onUpdateNotes(nextNotes);
    };

    const handleUp = (event) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      setDragIndex(null);
      onPreviewEnd?.();
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [editable, onUpdateNotes, pxPerSec, snapEnabled, gridSec, onPreviewNote, onPreviewEnd]);

  if (!rendered.length) return null;

  const noteBg = noteColor ? hexToRgba(noteColor, 0.72) : null;
  const noteBorder = noteColor ? hexToRgba(noteColor, 0.95) : null;
  const noteSelectedBg = noteColor ? hexToRgba(noteColor, 0.45) : null;
  const noteSelectedBorder = noteColor ? hexToRgba(noteColor, 0.9) : null;

  return (
    <div className="studio-midi-overlay" style={{ pointerEvents: editable ? "auto" : "none" }}>
      {rendered.map((note) => {
        if (!note) return null;
        const isSelected = selectedSet.has(note.index);
        return (
          <div
            key={note.key}
            className={`studio-midi-note${dragIndex === note.index ? " dragging" : ""}${isSelected ? " selected" : ""}`}
            style={{
              ...note.style,
              "--note-bg": noteBg || undefined,
              "--note-border": noteBorder || undefined,
              "--note-selected-bg": noteSelectedBg || undefined,
              "--note-selected-border": noteSelectedBorder || undefined,
            }}
            onPointerDown={(event) => startDrag(event, note, "move")}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!onUpdateNotes) return;
              const currentNotes = notesRef.current || [];
              const nextNotes = currentNotes.filter((_, idx) => idx !== note.index);
              onUpdateNotes(nextNotes);
              onPreviewEnd?.();
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!onUpdateNotes) return;
              const currentNotes = notesRef.current || [];
              const nextNotes = currentNotes.filter((_, idx) => idx !== note.index);
              onUpdateNotes(nextNotes);
              onPreviewEnd?.();
            }}
          >
            <div
              className="studio-midi-handle left"
              onPointerDown={(event) => startDrag(event, note, "resize-left")}
            />
            <div
              className="studio-midi-handle right"
              onPointerDown={(event) => startDrag(event, note, "resize-right")}
            />
          </div>
        );
      })}
    </div>
  );
};

export default MidiOverlay;
