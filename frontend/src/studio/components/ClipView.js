import React, { useEffect, useRef, useState } from "react";
import { INSTRUMENT_CHOICES, ticksToSec } from "../audioMath";
import { hexToRgba, readableInk, inkShade } from "../../utils/color";
import { createPortal } from "react-dom";
import StudioWaveform from "./StudioWaveform";
import MidiOverlay from "./MidiOverlay";
import PianoRoll from "./PianoRoll";
import PianoKeyboard from "./PianoKeyboard";
import DrumPads from "./DrumPads";
import Arpeggiator, { DEFAULT_ARP_SETTINGS } from "./Arpeggiator";
import { useMidiMacros } from "../hooks/useMidiMacros";
import { filterUsableVstPlugins } from "../vst3Utils";
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
   are full interactive surfaces. Everything else is draggable clip body.
   Exported: Timeline.js's own pointerdown handler (playhead scrub / range
   selection on the lane body a clip sits in) needs the same exclusions — a
   press on the clip's own menu button correctly skipped starting a clip
   drag here, but the same pointerdown still bubbled up to the timeline body
   underneath, which had no idea a clip control had already claimed it, and
   read the press as the start of a selection drag or a seek instead. One
   list, so the two can't drift apart the way they just did. */
export const OWN_GESTURE = [
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
/* A stable empty list for clips with no MIDI. The literal `[]` that used to
   sit in this fallback was a new array every render, so every hook depending
   on midiNotes re-ran on every render of a plain audio clip. */
const NO_MIDI_NOTES = [];

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
  onRenderMidiClip,
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
  onRegisterAsset,
}) => {
  const effectiveClip = previewClip || clip;
  const lengthSec = Math.max(0.01, (effectiveClip.srcEndSec ?? 0) - (effectiveClip.srcStartSec ?? 0));
  /* The box is the duration, full stop — an 80px floor here used to widen
     every short clip well past what its length/zoom actually call for, wider
     than the label truncation above was ever meant to paper over. Only a
     technical floor stays, so a near-zero-length clip is still a sliver you
     can find and click. */
  const width = Math.max(3, lengthSec * pxPerSec);
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
  const midiNotes = Array.isArray(midi?.notes) ? midi.notes : NO_MIDI_NOTES;
  const midiBpm = Number(midi?.bpm) || Number(bpm) || 120;
  const midiPpq = Number(midi?.ppq) || 480;
  const showMidiOverlay = midiNotes.length > 0;
  const editorPxPerSec = Math.max(pxPerSec, 120);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const hasNativeVst3 = typeof window !== "undefined" && !!window.rhymixNative?.vst3;
  const [vstPickerOpen, setVstPickerOpen] = useState(false);
  const [vstPlugins, setVstPlugins] = useState([]);
  const [vstScanning, setVstScanning] = useState(false);
  const [vstRendering, setVstRendering] = useState(false);
  const [vstError, setVstError] = useState(null);

  const scanVstPlugins = async () => {
    if (!hasNativeVst3 || vstScanning) return;
    setVstScanning(true);
    setVstError(null);
    try {
      const found = await window.rhymixNative.vst3.scan(["C:\\Program Files\\Common Files\\VST3"]);
      setVstPlugins(filterUsableVstPlugins(found));
    } catch (err) {
      setVstError(err?.message || "Scan failed.");
    } finally {
      setVstScanning(false);
    }
  };

  /* Offline render, not a live insert: the plugin processes the clip's whole source audio once
     (native/shell's vst3:renderClip — fetch, run through the plugin, upload back) and the result
     lands in the library as a brand new asset, exactly like any other upload. Nothing about the
     clip on the timeline changes; the user drags the new rendered asset in themselves if they
     want it in the arrangement, same as any library asset. */
  const renderClipThroughPlugin = async (plugin) => {
    if (!hasNativeVst3 || !asset?.url || vstRendering) return;
    setVstRendering(true);
    setVstError(null);
    try {
      const result = await window.rhymixNative.vst3.renderClip(asset.url, plugin.path);
      if (result?.fileId) {
        onRegisterAsset?.({
          id: `vst3-render:${result.fileId}`,
          kind: "upload",
          label: result.safeDisplayName || result.originalName || `${plugin.name} render`,
          url: `/api/download/input/${encodeURIComponent(result.storedName)}`,
          durationSec: result.durationSec,
        });
        setVstPickerOpen(false);
        setMenuOpen(false);
      }
    } catch (err) {
      setVstError(err?.message || "Render failed.");
    } finally {
      setVstRendering(false);
    }
  };
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorPlaying, setEditorPlaying] = useState(false);
  const [editorLoop, setEditorLoop] = useState(false);
  const [editorPlayheadSec, setEditorPlayheadSec] = useState(0);
  const [editorSelection, setEditorSelection] = useState(null);
  const [selectedNoteIndices, setSelectedNoteIndices] = useState(new Set());
  const [editorSelectionBox, setEditorSelectionBox] = useState(null);
  const [editorInputMode, setEditorInputMode] = useState("piano");
  const [arpSettings, setArpSettings] = useState(DEFAULT_ARP_SETTINGS);
  const midiMacros = useMidiMacros();
  const [heldNotes, setHeldNotes] = useState(() => new Set());
  const menuRef = useRef(null);
  const menuPanelRef = useRef(null);
  const editorTimerRef = useRef(null);
  const editorPlayRef = useRef({ raf: null, startMs: 0, startSec: 0, loopStart: 0, loopEnd: 0, loop: false });
  const editorPlaybackApiRef = useRef({ start: null, stop: null });
  const editorClipboardRef = useRef(null);
  /* The arpeggiator's own timer reads these every tick rather than closing
     over props/state — its setTimeout loop is created once per settings
     change (mode/rate/octaves/gate/swing), not once per render, so a
     closure over `clip` or `editorPlayheadSec` would go stale the moment
     either changed from a tick the loop itself just caused. */
  const clipRef = useRef(clip);
  const editorPlayheadSecRef = useRef(0);
  const activeArpNotesRef = useRef([]);
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
  /* The waveform peaks are "the signal cut out of" the lane colour (see
     above) — a flat black-or-white ink threw the hue away entirely, so a
     purple lane and a yellow lane drew identical-looking peaks. A shade of
     the lane's own colour keeps that promise while staying legible. */
  const waveInk = inkShade(laneColorSafe);

  useEffect(() => {
    if (!menuOpen) return;
    // The panel itself is portaled to document.body (see below) so it can't
    // be clipped by .studio-clip's own overflow:hidden — which also means
    // it's no longer a DOM descendant of menuRef (the trigger button), so a
    // click inside the panel has to be recognised as "inside" separately or
    // every menu item click would read as an outside click and close the
    // menu before its own onClick ever ran.
    const handleClick = (event) => {
      if (menuRef.current?.contains(event.target)) return;
      if (menuPanelRef.current?.contains(event.target)) return;
      setMenuOpen(false);
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
        const toSec = (ticks) => ticksToSec(ticks, midiBpm, midiPpq);
        const selected = Array.from(selectedNoteIndices)
          .map((idx) => {
            const note = midiNotes[idx];
            if (!note) return null;
            const startSecRaw = Number.isFinite(note.startSec)
              ? Number(note.startSec)
              : toSec(note.startTick);
            const durationSecRaw = Number.isFinite(note.durationSec)
              ? Number(note.durationSec)
              : toSec(note.durationTick);
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

  /* Step input: a key/pad press writes a note at the playhead and advances
     it by that note's own length, the same rhythm a step sequencer or
     GarageBand's typing keyboard uses — the alternative (record how long a
     key was actually held) needs key-up timing this component doesn't
     track anywhere yet, and would still want a step-input fallback for the
     mouse/pad-click case. This is what makes a just-created, note-less clip
     (Timeline.js's double-click-empty-space gesture) actually editable: its
     "No MIDI notes" placeholder has no canvas to draw into until a note
     exists at all. */
  const insertMidiNoteAtPlayhead = (noteNumber) => {
    if (!onUpdateClip) return;
    const ticksPerSec = (midiBpm * midiPpq) / 60;
    const durationSec = Math.max(0.05, gridSec || 0.25);
    const startRaw = clamp(editorPlayheadSec, 0, Math.max(0, lengthSec - durationSec));
    const startTick = Math.max(0, Math.round(startRaw * ticksPerSec));
    const durationTick = Math.max(1, Math.round(durationSec * ticksPerSec));
    const newNote = {
      note: noteNumber,
      velocity: 100,
      startTick,
      durationTick,
      startSec: startRaw,
      durationSec,
    };
    onUpdateClip(clip.id, { midi: { ...(clip.midi || {}), notes: [...midiNotes, newNote] } });
    onPreviewMidiNote?.({
      laneId: clip.laneId,
      noteNumber,
      velocity: 100,
      durationSec: Math.min(0.3, durationSec),
      clipGainDb: clip.gainDb,
      soundfontName: clip.midi?.soundfont,
    });
    setEditorPlayheadSec((prev) => Math.min(lengthSec, prev + durationSec));
  };

  useEffect(() => {
    if (!editorOpen) {
      setHeldNotes(new Set());
      activeArpNotesRef.current = [];
    }
  }, [editorOpen]);

  useEffect(() => {
    clipRef.current = clip;
  }, [clip]);

  useEffect(() => {
    editorPlayheadSecRef.current = editorPlayheadSec;
  }, [editorPlayheadSec]);

  /* What the arpeggiator is actually playing — not just "whatever is held
     right now". With Latch on, releasing every key must not cut the
     pattern; the ref only clears when a fresh chord replaces it or Latch
     itself goes off, same as reading `heldNotes` directly would have done
     wrong the moment the last key came up. */
  useEffect(() => {
    if (heldNotes.size > 0) {
      activeArpNotesRef.current = Array.from(heldNotes);
    } else if (!arpSettings.latch) {
      activeArpNotesRef.current = [];
    }
  }, [heldNotes, arpSettings.latch]);

  const insertArpNote = (noteNumber, durationSec, stepSec) => {
    if (!onUpdateClip) return;
    const currentClip = clipRef.current;
    const ticksPerSec = (midiBpm * midiPpq) / 60;
    const startRaw = clamp(editorPlayheadSecRef.current, 0, Math.max(0, lengthSec - durationSec));
    const startTick = Math.max(0, Math.round(startRaw * ticksPerSec));
    const durationTick = Math.max(1, Math.round(durationSec * ticksPerSec));
    const newNote = {
      note: noteNumber,
      velocity: 100,
      startTick,
      durationTick,
      startSec: startRaw,
      durationSec,
    };
    const nextNotes = [...(currentClip.midi?.notes || []), newNote];
    onUpdateClip(currentClip.id, { midi: { ...(currentClip.midi || {}), notes: nextNotes } });
    onPreviewMidiNote?.({
      laneId: currentClip.laneId,
      noteNumber,
      velocity: 100,
      durationSec: Math.min(0.3, durationSec),
      clipGainDb: currentClip.gainDb,
      soundfontName: currentClip.midi?.soundfont,
    });
    const nextPlayhead = Math.min(lengthSec, editorPlayheadSecRef.current + stepSec);
    editorPlayheadSecRef.current = nextPlayhead;
    setEditorPlayheadSec(nextPlayhead);
  };

  /* The arpeggiator's own clock. Runs continuously once armed — not
     restarted by which notes are held, only by settings that change its
     actual timing/shape — and reads activeArpNotesRef fresh on every tick,
     so a chord change mid-pattern is picked up without a hiccup. */
  useEffect(() => {
    if (!editorOpen || !arpSettings.enabled) return undefined;
    const stepBeats = { "1/4": 1, "1/8": 0.5, "1/16": 0.25, "1/32": 0.125 }[arpSettings.rate] || 0.25;
    const beatSec = 60 / (Number(midiBpm) || 120);
    const baseStepSec = Math.max(0.03, stepBeats * beatSec);
    let stepIndex = 0;
    let cancelled = false;
    let timeoutId = null;

    const buildSequence = () => {
      const base = [...activeArpNotesRef.current].sort((a, b) => a - b);
      if (!base.length) return [];
      let seq = Array.from({ length: arpSettings.octaves }).flatMap((_, oct) =>
        base.map((note) => Math.min(127, note + oct * 12))
      );
      if (arpSettings.mode === "down") {
        seq = seq.slice().reverse();
      } else if (arpSettings.mode === "updown" && seq.length > 2) {
        seq = [...seq, ...seq.slice(1, -1).reverse()];
      } else if (arpSettings.mode === "random") {
        seq = seq
          .map((value) => ({ value, sortKey: Math.random() }))
          .sort((a, b) => a.sortKey - b.sortKey)
          .map((entry) => entry.value);
      }
      return seq;
    };

    const tick = () => {
      if (cancelled) return;
      const sequence = buildSequence();
      let waitSec = baseStepSec;
      if (sequence.length) {
        const note = sequence[stepIndex % sequence.length];
        const swingOffset = stepIndex % 2 === 1 ? baseStepSec * (arpSettings.swing / 100) * 0.5 : 0;
        const noteDurationSec = Math.max(0.02, baseStepSec * (arpSettings.gate / 100));
        insertArpNote(note, noteDurationSec, baseStepSec);
        stepIndex += 1;
        waitSec = baseStepSec + swingOffset;
      }
      timeoutId = window.setTimeout(tick, waitSec * 1000);
    };
    tick();
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorOpen, arpSettings.enabled, arpSettings.mode, arpSettings.rate, arpSettings.octaves, arpSettings.gate, arpSettings.swing, midiBpm]);

  const handlePianoNoteOn = (noteNumber) => {
    if (arpSettings.enabled) {
      setHeldNotes((prev) => new Set(prev).add(noteNumber));
    } else {
      insertMidiNoteAtPlayhead(noteNumber);
    }
  };

  const handlePianoNoteOff = (noteNumber) => {
    if (!arpSettings.enabled) return;
    setHeldNotes((prev) => {
      if (!prev.has(noteNumber)) return prev;
      const next = new Set(prev);
      next.delete(noteNumber);
      return next;
    });
  };

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
    const toSec = (ticks) => ticksToSec(ticks, midiBpm, midiPpq);
    const clipStart = Number(effectiveClip.srcStartSec || 0);
    const next = new Set();
    midiNotes.forEach((note, idx) => {
      const noteNum = Number(note.note ?? note.midi ?? 60);
      if (noteNum < minNote || noteNum > maxNote) return;
      const startSecRaw = Number.isFinite(note.startSec)
        ? Number(note.startSec)
        : toSec(note.startTick);
      const durationSecRaw = Number.isFinite(note.durationSec)
        ? Number(note.durationSec)
        : toSec(note.durationTick);
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

  /* No dependency array on purpose. This is the "keep the latest closure in a
     ref" pattern: it wants to run after every render, so that whoever calls
     through the ref gets the current playhead, selection and loop settings.
     Listing the two functions asked for them to be wrapped in useCallback —
     which would have meant naming every value they read, to arrive back at an
     effect that runs every render anyway. */
  useEffect(() => {
    editorPlaybackApiRef.current.start = startEditorPlayback;
    editorPlaybackApiRef.current.stop = stopEditorPlayback;
  });

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
        // Shift/Ctrl/Cmd-click was already handled on pointerdown (toggling
        // this clip in or out of the selection); acting on it again here
        // would immediately collapse that multi-selection back down to one.
        if (e.shiftKey || e.ctrlKey || e.metaKey) return;
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
          <span title={label}>{label}</span>
          {laneFxActive && <span className="studio-tag">FX</span>}
        </div>
        {clip.clipType === "midi" && onUpdateClip && (
          /* The sound belongs to the clip, not the lane: two MIDI clips on the same lane can be a
             kick pattern and a piano riff. "Lane default" keeps the old behaviour. */
          <select
            className="studio-clip-instrument"
            title="Instrument for this clip"
            value={clip.midi?.soundfont || ""}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              onUpdateClip(clip.id, { midi: { ...(clip.midi || {}), soundfont: e.target.value || null } })
            }
          >
            <option value="">Lane default</option>
            {INSTRUMENT_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        )}
        <div className="studio-clip-actions" ref={menuRef}>
          <button
            className="studio-clip-menu-btn"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              if (menuOpen) {
                setMenuOpen(false);
                return;
              }
              // .studio-clip clips its own overflow (the rounded, Suno-style
              // corners) — a menu positioned relative to the button, as this
              // used to be, was clipped the instant it grew past the clip's
              // own small box, which is most of the time. Portaled to
              // document.body instead (see below) and positioned from the
              // button's own screen coordinates, the same way the MIDI
              // editor already escapes the same clip.
              const rect = e.currentTarget.getBoundingClientRect();
              const menuWidth = 170;
              const menuHeightEstimate = 190;
              let left = rect.right - menuWidth;
              left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));
              let top = rect.bottom + 6;
              if (top + menuHeightEstimate > window.innerHeight - 8) {
                top = Math.max(8, rect.top - menuHeightEstimate - 6);
              }
              setMenuPos({ left, top });
              setMenuOpen(true);
            }}
          >
            ⋯
          </button>
          {menuOpen && menuPos
            ? createPortal(
                <div
                  className="studio-clip-menu"
                  ref={menuPanelRef}
                  style={{ position: "fixed", left: menuPos.left, top: menuPos.top, right: "auto" }}
                  onClick={(e) => e.stopPropagation()}
                >
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
                  {clip.clipType === "midi" && (
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
                  {clip.clipType === "midi" && onRenderMidiClip && (
                    <button
                      className="studio-clip-menu-item"
                      title="Turn this MIDI clip into an audio clip, with its instrument"
                      onClick={() => {
                        onRenderMidiClip(clip.id, clip.midi?.soundfont || null);
                        setMenuOpen(false);
                      }}
                    >
                      Render to Audio
                    </button>
                  )}
                  {hasNativeVst3 && clip.clipType !== "midi" && asset?.url && (
                    <>
                      <button
                        className="studio-clip-menu-item"
                        onClick={() => {
                          const next = !vstPickerOpen;
                          setVstPickerOpen(next);
                          if (next && !vstPlugins.length) scanVstPlugins();
                        }}
                      >
                        Process through VST3 Plugin
                      </button>
                      {vstPickerOpen && (
                        <div className="studio-clip-menu-vst3">
                          <div className="studio-track-menu-vst3-head">
                            <span className="studio-track-menu-label">
                              {vstRendering ? "Rendering…" : "Choose a plugin"}
                            </span>
                            <button
                              type="button"
                              className="studio-mini"
                              onClick={scanVstPlugins}
                              disabled={vstScanning || vstRendering}
                            >
                              {vstScanning ? "Scanning…" : "Rescan"}
                            </button>
                          </div>
                          {vstError && <div className="studio-track-menu-vst3-error">{vstError}</div>}
                          {vstPlugins.length > 0 && (
                            <div className="studio-track-menu-vst3-list">
                              {vstPlugins.map((plugin) => (
                                <button
                                  type="button"
                                  key={plugin.path}
                                  className="studio-track-menu-vst3-item"
                                  disabled={vstRendering}
                                  onClick={() => renderClipThroughPlugin(plugin)}
                                  title={plugin.vendor ? `${plugin.name} — ${plugin.vendor}` : plugin.name}
                                >
                                  <span className="studio-track-menu-vst3-name">{plugin.name || plugin.path}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
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
                </div>,
                document.body
              )
            : null}
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
            color={waveInk}
            inkAlpha={0.72}
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
            /* Read-only here on purpose — this is the clip's collapsed,
               inline preview on the timeline, not the editor. editable
               (MidiOverlay.js) also switches its container to
               pointer-events: auto, which sat on top of the clip's own "⋯"
               menu button and ate the click before the button ever saw it.
               Moving/drawing notes is what the expanded MIDI editor is for. */
            snapEnabled={false}
            gridSec={gridSec}
            /* The clip's own surface is already the lane's colour (the same
               gradient a waveform sits on) — notes tinted with that same
               colour landed almost exactly on top of their own background,
               visually near-invisible. The waveform next door solved this
               with clipInk, a guaranteed-contrast ink instead of the lane
               hue; notes get the same treatment here. The expanded editor
               below keeps the raw lane colour on purpose — its background
               is a neutral dark grid, not the lane's own colour, so there's
               no clash to fix. */
            noteColor={clipInk}
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
                <PianoRoll
                  notes={midiNotes}
                  bpm={midiBpm}
                  ppq={midiPpq}
                  clipStartSec={effectiveClip.srcStartSec ?? 0}
                  clipDurationSec={lengthSec}
                  noteColor={laneColorSafe}
                  playheadSec={editorPlayheadSec}
                  selectedIndices={Array.from(selectedNoteIndices)}
                  onSelectionChange={(nextIndices) => setSelectedNoteIndices(new Set(nextIndices))}
                  onSeek={setEditorPlayheadSec}
                  onUpdateNotes={(nextNotes) => {
                    if (!onUpdateClip) return;
                    onUpdateClip(clip.id, { midi: { ...(clip.midi || {}), notes: nextNotes } });
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
              <div className="studio-midi-editor-input">
                <div className="studio-midi-editor-input-toggle">
                  <button
                    type="button"
                    className={`studio-mini ${editorInputMode === "piano" ? "active" : ""}`}
                    onClick={() => setEditorInputMode("piano")}
                  >
                    Piano
                  </button>
                  <button
                    type="button"
                    className={`studio-mini ${editorInputMode === "drums" ? "active" : ""}`}
                    onClick={() => setEditorInputMode("drums")}
                  >
                    Drums
                  </button>
                </div>
                {editorInputMode === "piano" ? (
                  <>
                    <PianoKeyboard active={editorOpen} onNoteOn={handlePianoNoteOn} onNoteOff={handlePianoNoteOff} />
                    <Arpeggiator settings={arpSettings} onChange={setArpSettings} midiMacros={midiMacros} />
                  </>
                ) : (
                  <DrumPads active={editorOpen} onPlayNote={insertMidiNoteAtPlayhead} />
                )}
              </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default ClipView;
