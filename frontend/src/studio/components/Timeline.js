import React, { useMemo, useRef, useState } from "react";
import ClipView from "./ClipView";
import SelectionOverlay from "./SelectionOverlay";

const LANE_HEIGHT = 110;
const laneHasFx = (lane) => Object.values(lane?.fx || {}).some((fx) => fx?.enabled);
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

  const pxPerSec = 80 * zoom;
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

  const timeMarks = useMemo(() => {
    const marks = [];
    const beatsPerBar = 4;
    const beatSec = bpm ? 60 / bpm : 1;
    const beatStep = zoom < 0.8 ? 4 : zoom < 1.2 ? 2 : 1;
    const stepSec = beatSec * beatStep;
    for (let t = 0; t <= durationSec; t += stepSec) {
      const beatIndex = Math.round(t / beatSec);
      const isBar = beatIndex % beatsPerBar === 0;
      marks.push({ t, isBar, beat: beatIndex + 1, bar: Math.floor(beatIndex / beatsPerBar) + 1 });
    }
    return marks;
  }, [durationSec, zoom, bpm]);

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

  const handleMouseDown = (event) => {
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
    onSelectRange?.(null);
    onSelectClip?.(null);
  };

  const handleMouseMove = (event) => {
    if (clipDrag) return;
    if (!dragging || dragStart == null) return;
    const time = getTimeFromEvent(event);
    const dist = Math.abs(event.clientX - dragStartX);
    if (dist < 4) return;
    selectionDragRef.current = true;
    const selection = { range: { start: dragStart, end: time }, laneIds: dragLaneId ? [dragLaneId] : null };
    onSelectRange?.(selection);
  };

  const handleMouseUp = () => {
    const shouldOpenMenu = dragging && selectionDragRef.current && selection?.range && canTranscribeSelection;
    setDragging(false);
    setDragStart(null);
    setDragStartX(0);
    setDragLaneId(null);
    selectionDragRef.current = false;
    if (shouldOpenMenu) {
      setSelectionMenuOpen(true);
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
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
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
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [clipDrag, dragPreview, onMoveClip, snapEnabled, snapGrid]);

  React.useEffect(() => {
    if (typeof scrollTopSync !== "number") return;
    if (!bodyRef.current) return;
    if (Math.abs(bodyRef.current.scrollTop - scrollTopSync) < 1) return;
    bodyRef.current.scrollTop = scrollTopSync;
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
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [trimDrag, trimPreview, onTrimClip, onTrimClipRight, snapEnabled, snapGrid]);

  return (
    <div className="studio-timeline">
      <div className="studio-timeline-ruler" ref={rulerRef}>
        <div
          className="studio-ruler-inner"
          style={{ width: timelineWidth }}
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            const time = getTimeFromRulerEvent(event);
            onSeek?.(Math.max(0, time));
          }}
        >
          <div
            className="studio-ruler-playhead"
            style={{ left: currentTime * pxPerSec }}
          />
          <div
            className="studio-playhead-handle"
            style={{ left: currentTime * pxPerSec }}
            onMouseDown={(event) => {
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
              {mark.isBar && <span>{mark.bar}</span>}
            </div>
          ))}
        </div>
      </div>

      <div
        className="studio-timeline-body"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDragOver={(event) => {
          event.preventDefault();
          setDropLaneId(getLaneFromEvent(event));
        }}
        onDragLeave={() => setDropLaneId(null)}
        onDrop={handleExternalDrop}
        onClick={(event) => {
          if (dragging) return;
          if (clipDrag) return;
          if (event.button !== 0) return;
          const time = getTimeFromEvent(event);
          onSeek?.(time);
        }}
        onScroll={() => {
          if (rulerRef.current && bodyRef.current) {
            rulerRef.current.scrollLeft = bodyRef.current.scrollLeft;
          }
          onScrollY?.(bodyRef.current?.scrollTop || 0);
        }}
        ref={bodyRef}
      >
        <div className="studio-timeline-inner" style={{ width: timelineWidth, height: lanes.length * LANE_HEIGHT }}>
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
              onMouseDown={(event) => {
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
            const laneBg = hexToRgba(laneColor, 0.08);
            return (
              <div
                key={lane.id}
                className={`studio-lane ${isDropTarget ? "drop-target" : ""}`}
                style={{
                  top: laneIndex * LANE_HEIGHT,
                  height: LANE_HEIGHT - 10,
                  borderLeft: laneColor ? `4px solid ${laneColor}` : undefined,
                  "--lane-bg": laneBg || undefined,
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
