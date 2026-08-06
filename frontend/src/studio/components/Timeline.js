import React, { useMemo, useRef, useState } from "react";
import ClipView from "./ClipView";
import SelectionOverlay from "./SelectionOverlay";
import { LANE_HEIGHT, LANE_GUTTER, BASE_PX_PER_SEC } from "../timelineMetrics";

const laneHasFx = (lane) => Object.values(lane?.fx || {}).some((fx) => fx?.enabled);

const Timeline = ({
  project,
  lanes,
  clips,
  assets,
  selection,
  currentTime,
  lyricsMap,
  canTranscribeSelection,
  onTranscribeSelection,
  onResynthesizeSelection,
  onClearSelection,
  selectionLyricsEntry,
  onUpdateLyricsText,
  onDeleteLyricsEntry,
  onRestoreLyricsEntry,
  zoom,
  snap,
  gridSec,
  bpm,
  onAddClip,
  onScrollY,
  scrollTopSync,
  onSelectClip,
  onSelectRange,
  onSeek,
  onMoveClip,
  onUpdateClip,
  onPreviewMidiNote,
  onStopPreviewMidiNote,
  onPlayMidiClipPreview,
  onStopMidiClipPreview,
  onUndo,
  onRedo,
  onSetMidiEditorOpen,
  onSplitClip,
  onDeleteClip,
  onTrimClip,
  onTrimClipRight,
  onDeleteSelection,
  onDuplicateSelection,
}) => {
  const bodyRef = useRef(null);
  const rulerRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragLaneId, setDragLaneId] = useState(null);
  const [clipDrag, setClipDrag] = useState(null);
  const [dragPreview, setDragPreview] = useState(null);
  const [trimDrag, setTrimDrag] = useState(null);
  const [trimPreview, setTrimPreview] = useState(null);
  const [dragPlayhead, setDragPlayhead] = useState(false);
  const [dropLaneId, setDropLaneId] = useState(null);
  const [selectionMenuOpen, setSelectionMenuOpen] = useState(false);
  const selectionDragRef = useRef(false);
  const suppressBodyScrollRef = useRef(false);

  const pxPerSec = BASE_PX_PER_SEC * zoom;
  const snapEnabled = Boolean(snap);
  const snapGrid = gridSec || 0.5;

  const durationSec = useMemo(() => {
    let maxEnd = project?.durationSec || 0;
    clips.forEach((clip) => {
      const end = (clip.timelineStartSec ?? 0) + (clip.srcEndSec ?? 0) - (clip.srcStartSec ?? 0);
      if (end > maxEnd) maxEnd = end;
    });
    return Math.max(10, maxEnd);
  }, [project, clips]);

  const timelineWidth = durationSec * pxPerSec + 200;

  const selectionBox = useMemo(() => {
    if (!selection?.range) return null;
    const start = Number(selection.range.start ?? 0);
    const end = Number(selection.range.end ?? 0);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    const left = Math.min(start, end) * pxPerSec;
    const width = Math.max(6, Math.abs(end - start) * pxPerSec);
    let top = 0;
    let height = lanes.length * LANE_HEIGHT;
    if (Array.isArray(selection.laneIds) && selection.laneIds.length) {
      const indices = selection.laneIds
        .map((id) => lanes.findIndex((lane) => lane.id === id))
        .filter((idx) => idx >= 0);
      if (indices.length) {
        const minIndex = Math.min(...indices);
        const maxIndex = Math.max(...indices);
        top = minIndex * LANE_HEIGHT;
        height = (maxIndex - minIndex + 1) * LANE_HEIGHT;
      }
    }
    return { left, width, top, height };
  }, [selection, lanes, pxPerSec]);
  const selectionIsTranscribing = selectionLyricsEntry?.status === "transcribing";

  /* The step used to be chosen from `zoom` alone (4 beats below 0.8, 2 below
     1.2, else 1). Zoomed out to fit a song that put a numbered mark every ~9px
     and the ruler became a smear of overlapping digits. What matters is not the
     zoom value but how many pixels a bar is worth, so pick the step from that
     and label only as often as there is room to read. */
  const timeMarks = useMemo(() => {
    const marks = [];
    const beatsPerBar = 4;
    const beatSec = bpm ? 60 / bpm : 1;
    const barSec = beatSec * beatsPerBar;
    const MIN_LABEL_PX = 64;
    const MIN_TICK_PX = 10;
    const steps = [1, 2, 4, 8, 16, 32, 64, 128, 256];
    const barStep =
      steps.find((step) => step * barSec * pxPerSec >= MIN_LABEL_PX) ?? steps[steps.length - 1];
    const showBeats = beatSec * pxPerSec >= MIN_TICK_PX;
    const stepSec = showBeats ? beatSec : barSec * barStep;
    if (!(stepSec > 0)) return marks;
    for (let t = 0; t <= durationSec; t += stepSec) {
      const beatIndex = Math.round(t / beatSec);
      const isBar = beatIndex % beatsPerBar === 0;
      const bar = Math.floor(beatIndex / beatsPerBar) + 1;
      marks.push({ t, isBar, bar, labelled: isBar && (bar - 1) % barStep === 0 });
    }
    return marks;
  }, [durationSec, pxPerSec, bpm]);

  /* Width of one labelled bar, published to CSS so the background grid
     behind the lanes lines up with the ruler above them. */
  const barPx = useMemo(() => {
    const beatSec = bpm ? 60 / bpm : 1;
    const barSec = beatSec * 4;
    const steps = [1, 2, 4, 8, 16, 32, 64, 128, 256];
    const barStep = steps.find((step) => step * barSec * pxPerSec >= 64) ?? steps[steps.length - 1];
    return barSec * barStep * pxPerSec;
  }, [bpm, pxPerSec]);

  const getTimeFromEvent = (event) => {
    const rect = bodyRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return (event.clientX - rect.left + (bodyRef.current?.scrollLeft || 0)) / pxPerSec;
  };

  const getTimeFromRulerEvent = (event) => {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return (event.clientX - rect.left + (rulerRef.current?.scrollLeft || 0)) / pxPerSec;
  };

  const getLaneFromEvent = (event) => {
    const rect = bodyRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const y = event.clientY - rect.top + (bodyRef.current?.scrollTop || 0);
    const index = Math.floor(y / LANE_HEIGHT);
    if (index < 0 || index >= lanes.length) return null;
    return lanes[index]?.id || null;
  };

  const handleExternalDrop = (event) => {
    event.preventDefault();
    const draggedAsset = event.dataTransfer?.getData("application/x-rhymix-asset") || "";
    const fallbackId = event.dataTransfer?.getData("text/plain") || "";
    const assetId = draggedAsset || (assets?.[fallbackId] ? fallbackId : "");
    if (!assetId) {
      setDropLaneId(null);
      return;
    }
    const laneId = getLaneFromEvent(event) || lanes[0]?.id;
    if (!laneId) {
      setDropLaneId(null);
      return;
    }
    const time = getTimeFromEvent(event);
    const rawStart = Math.max(0, time);
    const snapped = snapEnabled ? Math.round(rawStart / snapGrid) * snapGrid : rawStart;
    const startSec = Math.max(0, snapped);
    const durationSec = assets?.[assetId]?.durationSec;
    onAddClip?.(laneId, assetId, startSec, durationSec);
    setDropLaneId(null);
  };

  const handleClipDragStart = (event, clip) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const time = getTimeFromEvent(event);
    const offset = time - (clip.timelineStartSec ?? 0);
    setClipDrag({
      clipId: clip.id,
      offsetSec: offset,
      laneId: clip.laneId,
    });
    setDragPreview({
      clipId: clip.id,
      timelineStartSec: clip.timelineStartSec ?? 0,
      laneId: clip.laneId,
    });
    onSelectClip?.(clip.id);
  };

  const handleTrimStart = (event, clip, side) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    setTrimDrag({
      clipId: clip.id,
      side,
      clip,
    });
    setTrimPreview({
      clipId: clip.id,
      timelineStartSec: clip.timelineStartSec ?? 0,
      srcStartSec: clip.srcStartSec ?? 0,
      srcEndSec: clip.srcEndSec ?? 0,
    });
    onSelectClip?.(clip.id);
  };

  /* Press on empty lane background (or Alt-press on a clip). Nothing is
     decided here: the old version cleared the selection on mousedown, before
     the 4px threshold below could tell a click from a drag, so simply pressing
     anywhere threw the selection away. Pointer capture keeps the gesture alive
     when the cursor leaves the timeline — which is what the removed
     onMouseLeave={handleMouseUp} used to cut short. */
  const handlePointerDown = (event) => {
    if (event.button !== 0) return;
    if (clipDrag) return;
    if (
      event.target.closest(".studio-clip-lyrics-edit")
      || event.target.closest(".studio-clip-lyrics-edit-wrap")
      || event.target.closest(".studio-clip-lyrics-edit-actions")
    ) {
      return;
    }
    setSelectionMenuOpen(false);
    selectionDragRef.current = false;
    const time = getTimeFromEvent(event);
    const laneId = getLaneFromEvent(event);
    setDragging(true);
    setDragStart(time);
    setDragStartX(event.clientX);
    setDragLaneId(laneId);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* capture is an optimisation; the gesture still works without it */
    }
  };

  const handlePointerMove = (event) => {
    if (clipDrag) return;
    if (!dragging || dragStart == null) return;
    const time = getTimeFromEvent(event);
    const dist = Math.abs(event.clientX - dragStartX);
    if (dist < 4) return;
    selectionDragRef.current = true;
    const selection = { range: { start: dragStart, end: time }, laneIds: dragLaneId ? [dragLaneId] : null };
    onSelectRange?.(selection);
  };

  /* The gesture is classified here, once, on release. The seek used to live in
     an onClick that raced this handler: mouseup set `dragging` to false and the
     click that followed read it as false, so finishing a range selection could
     also jump the playhead. A ref settles it in the same tick. */
  const handlePointerUp = (event) => {
    if (!dragging) return;
    const wasDrag = selectionDragRef.current;
    if (wasDrag) {
      if (selection?.range && canTranscribeSelection) setSelectionMenuOpen(true);
    } else {
      onSelectRange?.(null);
      onSelectClip?.(null);
      onSeek?.(Math.max(0, getTimeFromEvent(event)));
    }
    setDragging(false);
    setDragStart(null);
    setDragStartX(0);
    setDragLaneId(null);
    selectionDragRef.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
  };

  React.useEffect(() => {
    if (!selection?.range || !canTranscribeSelection) {
      setSelectionMenuOpen(false);
    }
  }, [selection?.range, canTranscribeSelection]);

  React.useEffect(() => {
    if (!dragPlayhead) return undefined;
    const handleMove = (event) => {
      const time = getTimeFromRulerEvent(event);
      onSeek?.(Math.max(0, time));
    };
    const handleUp = () => {
      setDragPlayhead(false);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [dragPlayhead, onSeek]);

  React.useEffect(() => {
    if (!clipDrag) return undefined;
    const handleMove = (event) => {
      const time = getTimeFromEvent(event);
      const laneId = getLaneFromEvent(event) || clipDrag.laneId;
      const rawStart = time - clipDrag.offsetSec;
      const snapped = snapEnabled ? Math.round(rawStart / snapGrid) * snapGrid : rawStart;
      const nextStart = Math.max(0, snapped);
      setDragPreview({
        clipId: clipDrag.clipId,
        timelineStartSec: nextStart,
        laneId,
      });
    };
    const handleUp = () => {
      if (dragPreview) {
        onMoveClip?.(dragPreview.clipId, dragPreview.timelineStartSec, dragPreview.laneId);
      }
      setClipDrag(null);
      setDragPreview(null);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [clipDrag, dragPreview, onMoveClip, snapEnabled, snapGrid]);

  React.useEffect(() => {
    if (typeof scrollTopSync !== "number") return;
    if (!bodyRef.current) return;
    if (Math.abs(bodyRef.current.scrollTop - scrollTopSync) < 1) return;
    suppressBodyScrollRef.current = true;
    bodyRef.current.scrollTop = scrollTopSync;
    const reset = window.requestAnimationFrame(() => {
      suppressBodyScrollRef.current = false;
    });
    return () => window.cancelAnimationFrame(reset);
  }, [scrollTopSync]);

  React.useEffect(() => {
    if (!trimDrag) return undefined;
    const minLen = 0.05;
    const handleMove = (event) => {
      const time = getTimeFromEvent(event);
      const clip = trimDrag.clip;
      const clipStart = clip.timelineStartSec ?? 0;
      const clipLen = Math.max(0.01, (clip.srcEndSec ?? 0) - (clip.srcStartSec ?? 0));
      const clipEnd = clipStart + clipLen;
      const rawTime = snapEnabled ? Math.round(time / snapGrid) * snapGrid : time;
      if (trimDrag.side === "left") {
        const nextStart = Math.max(clipStart, Math.min(rawTime, clipEnd - minLen));
        const delta = nextStart - clipStart;
        setTrimPreview({
          clipId: trimDrag.clipId,
          timelineStartSec: nextStart,
          srcStartSec: (clip.srcStartSec ?? 0) + delta,
          srcEndSec: clip.srcEndSec ?? clipLen,
        });
      } else {
        const nextEnd = Math.max(clipStart + minLen, Math.min(rawTime, clipEnd));
        const newLen = nextEnd - clipStart;
        setTrimPreview({
          clipId: trimDrag.clipId,
          timelineStartSec: clipStart,
          srcStartSec: clip.srcStartSec ?? 0,
          srcEndSec: (clip.srcStartSec ?? 0) + newLen,
        });
      }
    };
    const handleUp = () => {
      if (trimPreview) {
        if (trimDrag.side === "left") {
          onTrimClip?.(trimDrag.clipId, trimPreview.timelineStartSec);
        } else {
          const clip = trimDrag.clip;
          const clipStart = clip.timelineStartSec ?? 0;
          const length = Math.max(
            0.01,
            (trimPreview.srcEndSec ?? 0) - (trimPreview.srcStartSec ?? 0)
          );
          onTrimClipRight?.(trimDrag.clipId, clipStart + length);
        }
      }
      setTrimDrag(null);
      setTrimPreview(null);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [trimDrag, trimPreview, onTrimClip, onTrimClipRight, snapEnabled, snapGrid]);

  return (
    <div className="studio-timeline">
      <div className="studio-timeline-ruler" ref={rulerRef}>
        <div
          className="studio-ruler-inner"
          style={{ width: timelineWidth }}
          // Pressing the ruler seeks, and keeps seeking while the button is
          // held — scrubbing. Before, only the small handle could be dragged
          // and a press anywhere else on the ruler was a one-shot jump, so the
          // same strip behaved two different ways depending on a few pixels.
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            const time = getTimeFromRulerEvent(event);
            onSeek?.(Math.max(0, time));
            setDragPlayhead(true);
          }}
        >
          <div
            className="studio-ruler-playhead"
            style={{ left: currentTime * pxPerSec }}
          />
          <div
            className="studio-playhead-handle"
            style={{ left: currentTime * pxPerSec }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              setDragPlayhead(true);
            }}
          />
          {timeMarks.map((mark) => (
            <div
              key={mark.t}
              className={`studio-ruler-mark ${mark.isBar ? "bar" : "beat"}`}
              style={{ left: mark.t * pxPerSec }}
            >
              {mark.labelled && <span>{mark.bar}</span>}
            </div>
          ))}
        </div>
      </div>

      <div
        className="studio-timeline-body"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDragOver={(event) => {
          event.preventDefault();
          setDropLaneId(getLaneFromEvent(event));
        }}
        onDragLeave={() => setDropLaneId(null)}
        onDrop={handleExternalDrop}
        onScroll={() => {
          if (rulerRef.current && bodyRef.current) {
            rulerRef.current.scrollLeft = bodyRef.current.scrollLeft;
          }
          if (suppressBodyScrollRef.current) return;
          onScrollY?.(bodyRef.current?.scrollTop || 0);
        }}
        ref={bodyRef}
      >
        <div
          className="studio-timeline-inner"
          style={{
            width: timelineWidth,
            height: lanes.length * LANE_HEIGHT,
            "--studio-bar-px": `${barPx}px`,
          }}
        >
          <SelectionOverlay
            range={selection?.range}
            pxPerSec={pxPerSec}
            lanes={lanes}
            laneIds={selection?.laneIds}
          />
          {selectionBox && selectionMenuOpen && canTranscribeSelection && (
            <div
              className="studio-selection-menu"
              style={{
                left: selectionBox.left + selectionBox.width - 6,
                top: selectionBox.top + 6,
              }}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              <button
                type="button"
                className="studio-selection-btn"
                onClick={() => onTranscribeSelection?.()}
                disabled={!canTranscribeSelection || selectionIsTranscribing}
                title={canTranscribeSelection ? "Transcribe lyrics from selection" : "Select a vocal range to transcribe"}
              >
                {selectionIsTranscribing ? "Transcribing..." : "Transcribe lyrics"}
                {selectionIsTranscribing && <span className="studio-spinner" />}
              </button>
              <button
                type="button"
                className="studio-selection-btn ghost"
                onClick={() => {
                  onDuplicateSelection?.(selection?.range, selection?.laneIds, Math.max(selection?.range?.start ?? 0, selection?.range?.end ?? 0));
                  setSelectionMenuOpen(false);
                }}
              >
                Duplicate
              </button>
              <button
                type="button"
                className="studio-selection-btn ghost"
                onClick={() => {
                  onDeleteSelection?.(selection?.range, selection?.laneIds, selection?.clipIds);
                  setSelectionMenuOpen(false);
                }}
              >
                Delete
              </button>
              <button
                type="button"
                className="studio-selection-btn ghost"
                onClick={() => {
                  onClearSelection?.();
                  setSelectionMenuOpen(false);
                }}
              >
                Clear
              </button>
            </div>
          )}
          <div className="studio-playhead" style={{ left: currentTime * pxPerSec }} />
          {lanes.map((lane, laneIndex) => {
            const laneClips = clips.filter((clip) => {
              const effectiveLane = dragPreview?.clipId === clip.id ? dragPreview?.laneId : clip.laneId;
              return effectiveLane === lane.id;
            });
            const isDropTarget = dragPreview?.laneId === lane.id || dropLaneId === lane.id;
            const fxActive = laneHasFx(lane);
            const laneColor = lane.color || "#2b3a45";
            return (
              <div
                key={lane.id}
                className={`studio-lane ${isDropTarget ? "drop-target" : ""} ${lane.mute ? "muted" : ""}`}
                style={{
                  top: laneIndex * LANE_HEIGHT,
                  height: LANE_HEIGHT - LANE_GUTTER,
                  // The lane row stays neutral; the colour is carried by a 3px
                  // spine (.studio-lane::before) and by the clips themselves.
                  "--lane-color": laneColor || undefined,
                }}
              >
                {laneClips.map((clip) => {
                  const preview =
                    trimPreview?.clipId === clip.id
                      ? trimPreview
                      : dragPreview?.clipId === clip.id
                        ? { ...clip, timelineStartSec: dragPreview.timelineStartSec }
                        : null;
                  return (
                    <ClipView
                      key={clip.id}
                      clip={clip}
                      asset={assets[clip.sourceAssetId]}
                      isSelected={selection?.clipIds?.includes(clip.id)}
                      pxPerSec={pxPerSec}
                      bpm={bpm}
                      currentTime={currentTime}
                      lyricsEntries={lyricsMap ? lyricsMap[clip.id] : null}
                      selectionRange={selection?.range || null}
                      selectionLaneIds={selection?.laneIds || null}
                      onUpdateLyricsText={onUpdateLyricsText}
                      onDeleteLyricsEntry={onDeleteLyricsEntry}
                      onRestoreLyricsEntry={onRestoreLyricsEntry}
                      onResynthesizeSelection={onResynthesizeSelection}
                      previewClip={preview}
                      isDragging={dragPreview?.clipId === clip.id}
                      laneFxActive={fxActive}
                      laneColor={laneColor}
                      onSelect={onSelectClip}
                      onSelectRange={onSelectRange}
                      onDragStart={handleClipDragStart}
                      onTrimStart={handleTrimStart}
                      onSplit={(clipId) => onSplitClip?.(clipId, currentTime)}
                      onDelete={(clipId) => onDeleteClip?.(null, null, [clipId])}
                      onUpdateClip={onUpdateClip}
                      snapEnabled={snapEnabled}
                      gridSec={snapGrid}
                      onPreviewMidiNote={onPreviewMidiNote}
                      onStopPreviewMidiNote={onStopPreviewMidiNote}
                      onPlayMidiClipPreview={onPlayMidiClipPreview}
                      onStopMidiClipPreview={onStopMidiClipPreview}
                      onSetMidiEditorOpen={onSetMidiEditorOpen}
                      onUndo={onUndo}
                      onRedo={onRedo}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Timeline;
