import React, { useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ClipView, { OWN_GESTURE } from "./ClipView";
import SelectionOverlay from "./SelectionOverlay";
import { LANE_HEIGHT, LANE_GUTTER, BASE_PX_PER_SEC, zoomToSlider, sliderToZoom } from "../timelineMetrics";
import { secToTicks } from "../audioMath";
import { MicIcon, PianoIcon, DrumIcon, TrashIcon } from "./StudioIcons";

const laneHasFx = (lane) => Object.values(lane?.fx || {}).some((fx) => fx?.enabled);

// Must match backend/features/studio/jobs.py's AIRGEN_REGEN_SPAN_SEC — the drums.pth
// checkpoint's own trained regen span, not a choice made here.
const AIRGEN_REGEN_SPAN_SEC = 7.5;

/* "2 bars" reads at a glance; a raw second count doesn't tell you where you
   are rhythmically. Falls back to seconds for a selection too short to be a
   full bar, where "0.1 bars" would be meaningless. */
const formatSelectionSpan = (durationSec, bpm) => {
  const barSec = bpm ? (60 / bpm) * 4 : 2;
  const bars = durationSec / barSec;
  if (bars >= 0.5) {
    const rounded = Math.round(bars * 10) / 10;
    return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} bar${rounded === 1 ? "" : "s"}`;
  }
  return `${durationSec.toFixed(1)}s`;
};

const Timeline = ({
  active = true,
  project,
  lanes,
  clips,
  assets,
  selection,
  currentTime,
  lyricsMap,
  canTranscribeSelection,
  selectionLyricsText,
  onResynthesizeSelection,
  onGenerate,
  onExtractStems,
  onExtractStem,
  onRenderMidiClip,
  onMatchDroppedAsset,
  onOpenTool,
  onClearSelection,
  onUpdateLyricsText,
  onDeleteLyricsEntry,
  onRestoreLyricsEntry,
  zoom,
  onZoomChange,
  snap,
  gridSec,
  bpm,
  onAddClip,
  onAddMidiClip,
  onAddLane,
  onScrollY,
  scrollTopSync,
  onSelectClip,
  onToggleSelectClip,
  onSelectRange,
  onSeek,
  onMoveClip,
  onMoveClips,
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
  onRegisterAsset,
  onAirgenRegen,
}) => {
  const bodyRef = useRef(null);
  const rulerRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragLaneId, setDragLaneId] = useState(null);
  const [clipDrag, setClipDrag] = useState(null);
  const [dragPreview, setDragPreview] = useState(null);
  // Set only when a plain (non-modifier) drag starts on a clip that's
  // already part of a multi-clip selection — moves every selected clip by
  // the same delta, on its own lane, in one committed history step. Kept
  // separate from clipDrag/dragPreview above (the single-clip path) rather
  // than folded in, so the existing single-clip drag stays untouched.
  const [groupDrag, setGroupDrag] = useState(null);
  const [groupDragPreview, setGroupDragPreview] = useState(null);
  const [trimDrag, setTrimDrag] = useState(null);
  const [trimPreview, setTrimPreview] = useState(null);
  const [dragPlayhead, setDragPlayhead] = useState(false);
  const [dropLaneId, setDropLaneId] = useState(null);
  const [selectionMenuOpen, setSelectionMenuOpen] = useState(false);
  const [selectionPrompt, setSelectionPrompt] = useState("");
  const [selectionBarPos, setSelectionBarPos] = useState(null);
  const [generateMode, setGenerateMode] = useState("song");
  const selectionDragRef = useRef(false);
  const suppressBodyScrollRef = useRef(false);

  const pxPerSec = BASE_PX_PER_SEC * zoom;
  const snapEnabled = Boolean(snap);
  const snapGrid = gridSec || 0.5;

  /* Ctrl/Cmd+scroll zooms the timeline, centred on the cursor — every real
     DAW does this; before, zoom was slider-only. A scrollLeft adjustment has
     to land in the same tick the new width from the zoom change actually
     applies, or the frame in between flashes the old scroll position at the
     new zoom; a ref carries it from the wheel handler into the effect below
     that fires once `zoom` (and therefore timelineWidth) has updated.
     Read via a ref rather than closed over directly so the native listener
     (needed because React's onWheel is passive — preventDefault inside it
     silently no-ops) can be attached once instead of re-subscribing on every
     zoom tick. */
  const wheelStateRef = useRef({ pxPerSec, zoom });
  wheelStateRef.current = { pxPerSec, zoom };
  const pendingZoomScrollRef = useRef(null);

  React.useEffect(() => {
    if (pendingZoomScrollRef.current == null) return;
    if (bodyRef.current) {
      bodyRef.current.scrollLeft = pendingZoomScrollRef.current;
    }
    pendingZoomScrollRef.current = null;
  }, [zoom]);

  React.useEffect(() => {
    const el = bodyRef.current;
    if (!el || !onZoomChange) return undefined;
    const handleWheel = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const { pxPerSec: currentPxPerSec, zoom: currentZoom } = wheelStateRef.current;
      const bodyRect = el.getBoundingClientRect();
      const cursorContentPx = event.clientX - bodyRect.left + el.scrollLeft;
      const timeAtCursor = cursorContentPx / currentPxPerSec;
      const nextSlider = Math.min(1, Math.max(0, zoomToSlider(currentZoom) - event.deltaY * 0.0015));
      const nextZoom = sliderToZoom(nextSlider);
      if (nextZoom === currentZoom) return;
      const nextPxPerSec = BASE_PX_PER_SEC * nextZoom;
      pendingZoomScrollRef.current = Math.max(0, timeAtCursor * nextPxPerSec - (event.clientX - bodyRect.left));
      onZoomChange(nextZoom);
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [onZoomChange]);

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

  /* The three below turn a pointer position into timeline coordinates. They
     are wrapped because the drag effects below need them in their dependency
     lists: unwrapped they were a new function every render, which is why they
     had to be left out — and a handler left out is one bound to a stale
     pxPerSec, so a drag started after a zoom moved by the wrong amount. */
  const getTimeFromEvent = useCallback((event) => {
    const rect = bodyRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return (event.clientX - rect.left + (bodyRef.current?.scrollLeft || 0)) / pxPerSec;
  }, [pxPerSec]);

  const getTimeFromRulerEvent = useCallback((event) => {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return (event.clientX - rect.left + (rulerRef.current?.scrollLeft || 0)) / pxPerSec;
  }, [pxPerSec]);

  const getLaneFromEvent = useCallback((event) => {
    const rect = bodyRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const y = event.clientY - rect.top + (bodyRef.current?.scrollTop || 0);
    const index = Math.floor(y / LANE_HEIGHT);
    if (index < 0 || index >= lanes.length) return null;
    return lanes[index]?.id || null;
  }, [lanes]);

  /* A MIDI lane with no clips on it had no way to start one except Voice to
     MIDI transcribing something first — double-clicking empty lane space is
     the same gesture every piano-roll editor uses to drop a blank clip down
     to start drawing notes into. */
  const handleLaneDoubleClick = (event, lane) => {
    if (lane.type !== "midi") return;
    if (event.target.closest(OWN_GESTURE)) return;
    const time = getTimeFromEvent(event);
    const rawStart = Math.max(0, time);
    const snapped = snapEnabled ? Math.round(rawStart / snapGrid) * snapGrid : rawStart;
    const ppq = 480;
    onAddMidiClip?.(lane.id, { notes: [], instrument: lane.instrument || null, ppq, bpm }, secToTicks(snapped, bpm, ppq), bpm, ppq);
  };

  /* The floating bar's Generate mode only ever produced audio (song/
     instrumental) — a MIDI lane had to already exist and be selected before
     a clip could land on it. This is the same "make new material here" ask
     for MIDI: reuse the selection's own lane if it's already a MIDI one,
     fall back to any MIDI lane already in the project, and only create a
     fresh one if neither exists — never a second MIDI lane where one would
     do. Generating the new lane's id up front (rather than letting the
     reducer make one) is what lets the clip land on it in the same click;
     ADD_LANE already accepts a caller-supplied id for exactly this. */
  const handleAddMidiClipFromBar = (startSec, endSec, laneIdHint) => {
    let laneId = laneIdHint && lanes.find((lane) => lane.id === laneIdHint && lane.type === "midi") ? laneIdHint : null;
    if (!laneId) {
      const existing = lanes.find((lane) => lane.type === "midi");
      laneId = existing?.id || null;
    }
    if (!laneId) {
      laneId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `lane-${Math.random().toString(16).slice(2)}`;
      onAddLane?.({ id: laneId, type: "midi", name: "MIDI" });
    }
    const ppq = 480;
    const rawStart = Math.max(0, startSec);
    const snapped = snapEnabled ? Math.round(rawStart / snapGrid) * snapGrid : rawStart;
    const spanSec = Math.max(0, (endSec ?? startSec) - startSec);
    onAddMidiClip?.(laneId, { notes: [], instrument: null, ppq, bpm }, secToTicks(snapped, bpm, ppq), bpm, ppq, spanSec);
  };

  // A dropped loop's own BPM (probed once at upload time on the backend, see
  // backend/features/studio/assets.py's _estimate_bpm) vs. the project's — placing it at its
  // native speed regardless is fine for a one-off vocal/stem, but silently wrong for a beatmaking
  // loop the user expects to lock to the groove. Asked about (not auto-applied) only when both
  // BPMs are actually known and meaningfully different — an unknown asset BPM (most non-loop
  // assets: nothing detectable, or beat_track came back outside a plausible range) falls back to
  // today's plain-drop behavior exactly as before, no prompt.
  const [pendingBpmDrop, setPendingBpmDrop] = useState(null);

  const commitDrop = (laneId, assetId, startSec, durationSec, tempoRate) => {
    onAddClip?.(laneId, assetId, startSec, durationSec, tempoRate);
    setDropLaneId(null);
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
    const asset = assets?.[assetId];
    const durationSec = asset?.durationSec;
    if (onMatchDroppedAsset) {
      // Match is on: the loop is fitted to the project first, so there is no tempo question to ask.
      onMatchDroppedAsset(assetId).then((placed) =>
        commitDrop(laneId, placed.assetId, startSec, placed.durationSec ?? durationSec, 1)
      );
      return;
    }
    const assetBpm = Number(asset?.bpm) || 0;
    const projectBpm = Number(bpm) || 0;
    if (assetBpm > 0 && projectBpm > 0 && Math.abs(assetBpm - projectBpm) > 3) {
      setPendingBpmDrop({ laneId, assetId, startSec, durationSec, assetBpm, projectBpm });
      return;
    }
    commitDrop(laneId, assetId, startSec, durationSec, 1);
  };

  const handleClipDragStart = (event, clip) => {
    if (event.button !== 0) return;
    event.stopPropagation();

    // Shift/Ctrl/Cmd-press: add or remove this clip from the selection and
    // stop there — no drag starts on this same gesture. A plain drag
    // afterward is what moves the group; this keeps "extend the selection"
    // and "move what's selected" as two separate, unambiguous gestures
    // instead of trying to read intent out of one.
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      onToggleSelectClip?.(clip.id);
      openSelectionBar();
      return;
    }

    const currentIds = selection?.clipIds || [];
    if (currentIds.length > 1 && currentIds.includes(clip.id)) {
      const time = getTimeFromEvent(event);
      const offset = time - (clip.timelineStartSec ?? 0);
      const originClips = {};
      currentIds.forEach((id) => {
        const member = clips.find((item) => item.id === id);
        if (member) {
          originClips[id] = { timelineStartSec: member.timelineStartSec ?? 0, laneId: member.laneId };
        }
      });
      setGroupDrag({ anchorClipId: clip.id, offsetSec: offset, originClips });
      setGroupDragPreview(
        Object.fromEntries(Object.entries(originClips).map(([id, origin]) => [id, { ...origin }]))
      );
      return;
    }

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
    if (event.target.closest(OWN_GESTURE)) return;
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
  /* Anchored to the timeline viewport itself — bottom edge, horizontally
     centred — rather than to wherever the selection happens to sit. Suno's
     own version does the same: the bar is a fixed dock for acting on a
     selection, not a tooltip that chases it, so it doesn't jump around as
     the selection moves, the timeline scrolls, or (now) a click swaps which
     clip is selected. Shared by the range-drag and the plain-click-a-clip
     paths — both just need "open the dock", not two different geometries. */
  const openSelectionBar = () => {
    if (!bodyRef.current) return;
    const bodyRect = bodyRef.current.getBoundingClientRect();
    const barWidth = 320;
    // Generate mode adds a Song/Instrumental row the resynthesize-only bar
    // doesn't have, so this has to fit the taller of the two or the bottom
    // anchor undershoots by that row's height.
    const barHeightEstimate = 130;
    let left = bodyRect.left + (bodyRect.width - barWidth) / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - barWidth - 8));
    let top = bodyRect.top + bodyRect.height - barHeightEstimate - 16;
    top = Math.max(8, top);
    setSelectionBarPos({ left, top });
    setSelectionMenuOpen(true);
  };

  const handleSelectClip = (clipId) => {
    // A plain click (no modifier) on a clip that's already part of a
    // multi-clip selection — most often the click half of the pointerdown/
    // click pair that just finished a group drag — opens the bar without
    // collapsing the group back down to this one clip. Any other click
    // (a fresh clip, or the only one selected) replaces the selection as
    // before.
    const currentIds = selection?.clipIds || [];
    if (clipId && currentIds.length > 1 && currentIds.includes(clipId)) {
      openSelectionBar();
      return;
    }
    onSelectClip?.(clipId);
    if (clipId) openSelectionBar();
  };

  const handlePointerUp = (event) => {
    if (!dragging) return;
    const wasDrag = selectionDragRef.current;
    if (wasDrag) {
      if (selection?.range && selectionBox && bodyRef.current) {
        openSelectionBar();
      }
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

  /* The prompt field is seeded from the selection's own lyrics exactly once,
     on the closed→open transition — not on every render while it's open,
     which would stomp whatever the user is mid-typing if canTranscribeSelection
     or selectionLyricsText happened to recompute for an unrelated reason. A
     plain clip click can't seed this synchronously the way the drag path
     could (selection is still the previous click's value in this same
     handler), so this is the one place both paths actually get it right. */
  const wasSelectionMenuOpenRef = useRef(false);
  React.useEffect(() => {
    if (selectionMenuOpen && !wasSelectionMenuOpenRef.current) {
      setSelectionPrompt(canTranscribeSelection ? (selectionLyricsText || "") : "");
    }
    wasSelectionMenuOpenRef.current = selectionMenuOpen;
  }, [selectionMenuOpen, canTranscribeSelection, selectionLyricsText]);

  React.useEffect(() => {
    if (!selection?.range) {
      setSelectionMenuOpen(false);
    }
  }, [selection?.range]);

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
  }, [dragPlayhead, onSeek, getTimeFromRulerEvent]);

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
  }, [clipDrag, dragPreview, onMoveClip, snapEnabled, snapGrid, getLaneFromEvent, getTimeFromEvent]);

  /* Group drag stays on each clip's own lane — only the horizontal offset
     moves, applied identically to every member relative to where the
     anchor (the clip actually grabbed) lands. Letting the group also
     change lanes together would need a lane-index delta on top of this,
     which is real DAW behaviour but a bigger, riskier change; horizontal-
     only already covers the common case (nudging a group in time) without
     it. */
  React.useEffect(() => {
    if (!groupDrag) return undefined;
    const handleMove = (event) => {
      const time = getTimeFromEvent(event);
      const rawAnchorStart = time - groupDrag.offsetSec;
      const anchorOrigin = groupDrag.originClips[groupDrag.anchorClipId];
      const snappedAnchorStart = snapEnabled
        ? Math.round(rawAnchorStart / snapGrid) * snapGrid
        : rawAnchorStart;
      let minOrigin = Infinity;
      Object.values(groupDrag.originClips).forEach((origin) => {
        minOrigin = Math.min(minOrigin, origin.timelineStartSec);
      });
      const rawDelta = snappedAnchorStart - (anchorOrigin?.timelineStartSec ?? 0);
      // Clamp the whole group's delta so the earliest clip in it never goes
      // negative, rather than clamping each clip separately — separately
      // would compress the group's own spacing instead of just stopping it.
      const delta = Math.max(rawDelta, -minOrigin);
      const next = {};
      Object.entries(groupDrag.originClips).forEach(([id, origin]) => {
        next[id] = { timelineStartSec: origin.timelineStartSec + delta, laneId: origin.laneId };
      });
      setGroupDragPreview(next);
    };
    const handleUp = () => {
      if (groupDragPreview) {
        const moves = Object.entries(groupDragPreview).map(([id, preview]) => ({
          clipId: id,
          newTimelineStartSec: preview.timelineStartSec,
          laneId: preview.laneId,
        }));
        onMoveClips?.(moves);
      }
      setGroupDrag(null);
      setGroupDragPreview(null);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [groupDrag, groupDragPreview, onMoveClips, snapEnabled, snapGrid, getTimeFromEvent]);

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
        const assetDurationSec = clip.clipType === "midi" ? null : assets?.[clip.sourceAssetId]?.durationSec;
        const maxEnd =
          clip.clipType === "midi" || !assetDurationSec
            ? Infinity
            : clipStart + Math.max(clipLen, assetDurationSec - (clip.srcStartSec ?? 0));
        const nextEnd = Math.max(clipStart + minLen, Math.min(rawTime, maxEnd));
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
  }, [trimDrag, trimPreview, onTrimClip, onTrimClipRight, snapEnabled, snapGrid, getTimeFromEvent, assets]);

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
            minWidth: timelineWidth,
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
          {/* Portals straight to document.body (below), which a display:none
              on some ancestor — how Studio stays mounted but hidden once
              another view is active — does nothing to hide. Gating on
              `active` here is what actually keeps this off screen once
              you've navigated away. */}
          {active && selectionBox && selectionMenuOpen && selectionBarPos && (() => {
            const spanSec = Math.abs((selection?.range?.end ?? 0) - (selection?.range?.start ?? 0));
            const canSubmit = selectionPrompt.trim().length > 0;
            const rangeStart = Math.min(selection?.range?.start ?? 0, selection?.range?.end ?? 0);
            const rangeEnd = Math.max(selection?.range?.start ?? 0, selection?.range?.end ?? 0);
            const clipsInSelection = clips.filter((clip) => {
              if (Array.isArray(selection?.laneIds) && selection.laneIds.length && !selection.laneIds.includes(clip.laneId)) {
                return false;
              }
              const clipStart = clip.timelineStartSec ?? 0;
              const clipEnd = clipStart + (clip.srcEndSec ?? 0) - (clip.srcStartSec ?? 0);
              return clipEnd > rangeStart && clipStart < rangeEnd;
            });
            const splittableClips = clipsInSelection.filter((clip) => {
              const clipStart = clip.timelineStartSec ?? 0;
              const clipEnd = clipStart + (clip.srcEndSec ?? 0) - (clip.srcStartSec ?? 0);
              return currentTime > clipStart && currentTime < clipEnd;
            });
            const stemSourceClip = clipsInSelection.find((clip) => clip.sourceAssetId);
            // Generate ("make new material here") only makes sense over a
            // genuinely empty span — an existing, non-vocal clip gets the
            // icon row only (split/extract/duplicate/delete), not a prompt
            // offering to fill a spot that's already filled.
            const showGenerate = !canTranscribeSelection && !clipsInSelection.length;
            const showPrompt = canTranscribeSelection || (showGenerate && generateMode !== "midi");
            const submit = () => {
              if (!canSubmit) return;
              if (canTranscribeSelection) {
                onResynthesizeSelection?.({ text: selectionPrompt.trim() });
              } else {
                onGenerate?.({
                  prompt: selectionPrompt.trim(),
                  mode: generateMode,
                  startSec: Math.min(selection?.range?.start ?? 0, selection?.range?.end ?? 0),
                  durationSec: spanSec,
                  laneId: selection?.laneIds?.[0] || null,
                });
              }
              setSelectionMenuOpen(false);
            };
            return createPortal(
              <div
                className="studio-ai-bar"
                style={{
                  position: "fixed",
                  left: selectionBarPos.left,
                  top: selectionBarPos.top,
                }}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <div className="studio-ai-bar-row">
                  <span className="studio-ai-bar-chip">
                    {formatSelectionSpan(spanSec, bpm)}
                    {clipsInSelection.length ? " selected" : " · New material"}
                  </span>
                  <button
                    type="button"
                    className="studio-ai-bar-icon"
                    title="Clear selection"
                    onClick={() => {
                      onClearSelection?.();
                      setSelectionMenuOpen(false);
                    }}
                  >
                    ×
                  </button>
                </div>
                {/* Grouped and labelled: a row of bare icons (scissors, headphones...) asked you to
                    guess what each one did. Edit tools act on the selection, Stems only appear when
                    there is audio to split, Voice tools record into the timeline at the playhead. */}
                <div className="studio-ai-bar-group">
                  <span className="studio-ai-bar-label">Edit</span>
                  <button
                    type="button"
                    className="studio-ai-bar-btn"
                    title={splittableClips.length ? "Split at playhead" : "Move the playhead inside a clip in this selection to split it"}
                    disabled={!splittableClips.length}
                    onClick={() => {
                      splittableClips.forEach((clip) => onSplitClip?.(clip.id, currentTime));
                      setSelectionMenuOpen(false);
                    }}
                  >
                    ✂ Split
                  </button>
                  <button
                    type="button"
                    className="studio-ai-bar-btn"
                    title="Duplicate selection"
                    onClick={() => {
                      onDuplicateSelection?.(selection?.range, selection?.laneIds, Math.max(selection?.range?.start ?? 0, selection?.range?.end ?? 0));
                      setSelectionMenuOpen(false);
                    }}
                  >
                    ⧉ Duplicate
                  </button>
                  <button
                    type="button"
                    className="studio-ai-bar-btn"
                    title="Delete selection"
                    onClick={() => {
                      onDeleteSelection?.(selection?.range, selection?.laneIds, selection?.clipIds);
                      setSelectionMenuOpen(false);
                    }}
                  >
                    <TrashIcon size={13} /> Delete
                  </button>
                </div>
                {stemSourceClip && (
                  <div className="studio-ai-bar-group">
                    <span className="studio-ai-bar-label">Stems</span>
                    {[
                      { id: "vocals", label: "Vocals" },
                      { id: "drums", label: "Drums" },
                      { id: "bass", label: "Bass" },
                      // Everything except the voice — the backing track, not Demucs' "other".
                      { id: "instrumental", label: "Music" },
                    ].map((stem) => (
                      <button
                        key={stem.id}
                        type="button"
                        className="studio-ai-bar-btn"
                        title={`Extract only the ${stem.label.toLowerCase()} from this audio`}
                        onClick={() => {
                          onExtractStem?.(stem.id, stemSourceClip.sourceAssetId);
                          setSelectionMenuOpen(false);
                        }}
                      >
                        {stem.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="studio-ai-bar-btn"
                      title="Split into vocals, drums, bass and the rest"
                      onClick={() => {
                        onExtractStems?.(stemSourceClip.sourceAssetId);
                        setSelectionMenuOpen(false);
                      }}
                    >
                      All
                    </button>
                  </div>
                )}
                <div className="studio-ai-bar-group">
                  <span className="studio-ai-bar-label">Voice</span>
                  <button
                    type="button"
                    className="studio-ai-bar-btn"
                    title="Record through a trained voice model, live"
                    onClick={() => onOpenTool?.("live")}
                  >
                    <MicIcon size={13} /> Live VC
                  </button>
                  <button
                    type="button"
                    className="studio-ai-bar-btn"
                    title="Hum, sing or beatbox into a MIDI clip"
                    onClick={() => onOpenTool?.("voice")}
                  >
                    <PianoIcon size={13} /> Voice → MIDI
                  </button>
                  <button
                    type="button"
                    className="studio-ai-bar-btn"
                    disabled={!spanSec || spanSec > AIRGEN_REGEN_SPAN_SEC}
                    title={
                      !spanSec
                        ? "Select a range to regenerate its drums (AIRGen)"
                        : spanSec > AIRGEN_REGEN_SPAN_SEC
                        ? `Selection is ${spanSec.toFixed(1)}s — AIRGen only regenerates up to ${AIRGEN_REGEN_SPAN_SEC}s at a time`
                        : "Regenerate the drums under the selection (AIRGen) - uses the mix just before and after it as context"
                    }
                    onClick={() => {
                      onAirgenRegen?.(rangeStart, rangeEnd);
                      setSelectionMenuOpen(false);
                    }}
                  >
                    <DrumIcon size={13} /> AI Regen
                  </button>
                </div>
                {showGenerate && (
                  <div className="studio-ai-bar-row">
                    <button
                      type="button"
                      className={`studio-ai-bar-mode ${generateMode === "song" ? "active" : ""}`}
                      onClick={() => setGenerateMode("song")}
                    >
                      Song
                    </button>
                    <button
                      type="button"
                      className={`studio-ai-bar-mode ${generateMode === "instrumental" ? "active" : ""}`}
                      onClick={() => setGenerateMode("instrumental")}
                    >
                      Instrumental
                    </button>
                    <button
                      type="button"
                      className={`studio-ai-bar-mode ${generateMode === "midi" ? "active" : ""}`}
                      onClick={() => setGenerateMode("midi")}
                    >
                      MIDI
                    </button>
                  </div>
                )}
                {showGenerate && generateMode === "midi" && (
                  <div className="studio-ai-bar-row">
                    <button
                      type="button"
                      className="studio-ai-bar-submit studio-ai-bar-submit-wide"
                      onClick={() => {
                        handleAddMidiClipFromBar(
                          Math.min(selection?.range?.start ?? 0, selection?.range?.end ?? 0),
                          Math.max(selection?.range?.start ?? 0, selection?.range?.end ?? 0),
                          selection?.laneIds?.[0]
                        );
                        setSelectionMenuOpen(false);
                      }}
                    >
                      Add MIDI clip
                    </button>
                  </div>
                )}
                {showPrompt && (
                  <div className="studio-ai-bar-row">
                    <input
                      type="text"
                      className="studio-ai-bar-input"
                      value={selectionPrompt}
                      placeholder={
                        canTranscribeSelection
                          ? "Type the vocal line for this section…"
                          : generateMode === "instrumental"
                            ? "Describe the instrumental — mood, genre, instruments…"
                            : "Describe the song, or type its lyrics…"
                      }
                      onChange={(event) => setSelectionPrompt(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") submit();
                        if (event.key === "Escape") setSelectionMenuOpen(false);
                      }}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="studio-ai-bar-submit"
                      disabled={!canSubmit}
                      title={canTranscribeSelection ? "Resynthesize this section" : "Generate"}
                      onClick={submit}
                    >
                      ↑
                    </button>
                  </div>
                )}
              </div>,
              document.body
            );
          })()}
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
                onDoubleClick={(event) => handleLaneDoubleClick(event, lane)}
              >
                {laneClips.map((clip) => {
                  const groupPreview = groupDragPreview?.[clip.id];
                  const preview =
                    trimPreview?.clipId === clip.id
                      ? trimPreview
                      : dragPreview?.clipId === clip.id
                        ? { ...clip, timelineStartSec: dragPreview.timelineStartSec }
                        : groupPreview
                          ? { ...clip, timelineStartSec: groupPreview.timelineStartSec }
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
                      isDragging={dragPreview?.clipId === clip.id || Boolean(groupPreview)}
                      laneFxActive={fxActive}
                      laneColor={laneColor}
                      onSelect={handleSelectClip}
                      onSelectRange={onSelectRange}
                      onDragStart={handleClipDragStart}
                      onTrimStart={handleTrimStart}
                      onSplit={(clipId) => onSplitClip?.(clipId, currentTime)}
                      onDelete={(clipId) => onDeleteClip?.(null, null, [clipId])}
                      onUpdateClip={onUpdateClip}
                      onRenderMidiClip={onRenderMidiClip}
                      onRegisterAsset={onRegisterAsset}
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
      {pendingBpmDrop && (
        <div
          className="studio-modal-backdrop"
          onClick={() => {
            const { laneId, assetId, startSec, durationSec } = pendingBpmDrop;
            setPendingBpmDrop(null);
            commitDrop(laneId, assetId, startSec, durationSec, 1);
          }}
        >
          <div
            className="studio-modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label="BPM mismatch"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="studio-modal-head">
              <div>BPM mismatch</div>
            </div>
            <div className="studio-modal-body">
              <p>
                This loop is {pendingBpmDrop.assetBpm} BPM, the project is {pendingBpmDrop.projectBpm} BPM.
                Stretching it to match changes its playback speed (and pitch along with it) — it
                isn't a pitch-preserving time-stretch.
              </p>
            </div>
            <div className="studio-modal-foot">
              <button
                type="button"
                className="studio-btn ghost"
                onClick={() => {
                  const { laneId, assetId, startSec, durationSec } = pendingBpmDrop;
                  setPendingBpmDrop(null);
                  commitDrop(laneId, assetId, startSec, durationSec, 1);
                }}
              >
                Keep original
              </button>
              <button
                type="button"
                className="studio-btn"
                onClick={() => {
                  const { laneId, assetId, startSec, durationSec, assetBpm, projectBpm } = pendingBpmDrop;
                  setPendingBpmDrop(null);
                  commitDrop(laneId, assetId, startSec, durationSec, assetBpm / projectBpm);
                }}
              >
                Stretch to match
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Timeline;
