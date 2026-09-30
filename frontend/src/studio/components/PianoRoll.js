import React, { useEffect, useMemo, useRef, useState } from "react";
import { hexToRgba } from "../../utils/color";

/* A real piano roll: a key column that says which pitch is which, a beat/bar grid with snapping,
   click-to-add, drag to move / resize, and a velocity lane. It replaces MidiOverlay as the MIDI
   editor's main surface — that component only draws notes over a canvas, auto-scaled to the notes
   that already exist (128 keys squeezed into 440px when the full range is forced), with no key
   labels, no grid and no way to place a note with the mouse.

   Notes keep the exact shape the rest of Studio reads and writes: { note, velocity, startTick,
   durationTick, startSec, durationSec }, where startSec is in the source's own seconds (clip
   offset included) — same contract MidiOverlay's drags honoured. */

const ROW = 16;
const KEY_W = 64;
const RULER_H = 24;
const VEL_H = 72;
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BLACK = new Set([1, 3, 6, 8, 10]);
const SNAPS = [
  { label: "Snap off", beats: 0 },
  { label: "1/4", beats: 1 },
  { label: "1/8", beats: 0.5 },
  { label: "1/16", beats: 0.25 },
  { label: "1/32", beats: 0.125 },
];
const HANDLE_PX = 7;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const noteLabel = (n) => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

const PianoRoll = ({
  notes = [],
  bpm = 120,
  ppq = 480,
  clipStartSec = 0,
  clipDurationSec = 4,
  noteColor = "#4fd1c5",
  playheadSec = 0,
  selectedIndices = [],
  onSelectionChange,
  onSeek,
  onUpdateNotes,
  onPreviewNote,
  onPreviewEnd,
  height = 400,
}) => {
  const [snapBeats, setSnapBeats] = useState(0.25);
  const [pxPerBeat, setPxPerBeat] = useState(96);
  const [scroll, setScroll] = useState({ left: 0 });
  const scrollRef = useRef(null);
  const gridRef = useRef(null);
  const dragRef = useRef(null);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const selectedRef = useRef(selectedIndices);
  selectedRef.current = selectedIndices;

  const beatSec = 60 / (Number(bpm) || 120);
  const ticksPerSec = (Number(ppq) || 480) * ((Number(bpm) || 120) / 60);
  const pxPerSec = pxPerBeat / beatSec;
  const lengthSec = Math.max(0.5, Number(clipDurationSec) || 4);
  const gridW = Math.max(lengthSec * pxPerSec, pxPerBeat * 8, 1000);
  const gridH = 128 * ROW;
  const stepSec = snapBeats > 0 ? snapBeats * beatSec : 0;
  const selected = useMemo(() => new Set(selectedIndices), [selectedIndices]);

  const rows = useMemo(() => {
    const out = [];
    for (let n = 127; n >= 0; n -= 1) out.push(n);
    return out;
  }, []);

  // Open on the notes that exist (or middle C on an empty clip) rather than at pitch 127.
  const didCenterRef = useRef(false);
  useEffect(() => {
    if (didCenterRef.current || !scrollRef.current) return;
    didCenterRef.current = true;
    const pitches = notes.map((n) => Number(n.note ?? n.midi ?? 60));
    const mid = pitches.length ? (Math.min(...pitches) + Math.max(...pitches)) / 2 : 60;
    scrollRef.current.scrollTop = Math.max(0, (127 - mid) * ROW - height / 2 + RULER_H);
  }, [notes, height]);

  const readNote = (note) => {
    const startAbs = Number.isFinite(note.startSec) ? Number(note.startSec) : Number(note.startTick || 0) / ticksPerSec;
    const dur = Math.max(
      0.02,
      Number.isFinite(note.durationSec) ? Number(note.durationSec) : Number(note.durationTick || 0) / ticksPerSec
    );
    return {
      pitch: Number(note.note ?? note.midi ?? 60),
      velocity: Number(note.velocity ?? 90),
      start: startAbs - (Number(clipStartSec) || 0),
      dur,
    };
  };

  const writeNote = (base, { pitch, start, dur, velocity }) => {
    const abs = Math.max(0, start + (Number(clipStartSec) || 0));
    const next = { ...base, note: pitch, velocity, startSec: abs, durationSec: dur };
    if ("midi" in base) next.midi = pitch;
    next.startTick = Math.max(0, Math.round(abs * ticksPerSec));
    next.durationTick = Math.max(1, Math.round(dur * ticksPerSec));
    return next;
  };

  const snap = (sec) => (stepSec > 0 ? Math.round(sec / stepSec) * stepSec : sec);
  const localXY = (event) => {
    const rect = gridRef.current.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const pitchAt = (y) => clamp(127 - Math.floor(y / ROW), 0, 127);

  const preview = (pitch, velocity) =>
    onPreviewNote?.({ noteNumber: pitch, velocity, durationSec: 0.4 });

  const beginDrag = (drag) => {
    dragRef.current = drag;
    const move = (event) => {
      const d = dragRef.current;
      if (!d) return;
      const { x, y } = localXY(event);
      const list = notesRef.current;
      if (d.mode === "move") {
        const dSec = snap(d.orig[0].start + (x - d.startX) / pxPerSec) - d.orig[0].start;
        const dPitch = Math.round(-(y - d.startY) / ROW);
        const next = list.map((note, i) => {
          const o = d.orig.find((item) => item.idx === i);
          if (!o) return note;
          const start = clamp(o.start + dSec, 0, lengthSec - 0.02);
          const pitch = clamp(o.pitch + dPitch, 0, 127);
          return writeNote(note, { pitch, start, dur: o.dur, velocity: o.velocity });
        });
        const lead = next[d.idx] && readNote(next[d.idx]);
        if (lead && lead.pitch !== d.lastPitch) {
          d.lastPitch = lead.pitch;
          preview(lead.pitch, lead.velocity);
        }
        onUpdateNotes?.(next);
      } else if (d.mode === "resize" || d.mode === "draw") {
        const o = d.orig[0];
        const minDur = stepSec || 0.05;
        const end = snap(clamp(x / pxPerSec, o.start + minDur, lengthSec));
        const dur = Math.max(minDur, end - o.start);
        onUpdateNotes?.(
          list.map((note, i) => (i === d.idx ? writeNote(note, { pitch: o.pitch, start: o.start, dur, velocity: o.velocity }) : note))
        );
      } else if (d.mode === "velocity") {
        const rect = d.laneEl.getBoundingClientRect();
        const velocity = clamp(Math.round((1 - (event.clientY - rect.top) / VEL_H) * 127), 1, 127);
        onUpdateNotes?.(
          list.map((note, i) => (i === d.idx ? { ...note, velocity } : note))
        );
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragRef.current = null;
      onPreviewEnd?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const handleGridPointerDown = (event) => {
    if (event.button !== 0) return;
    const { x, y } = localXY(event);
    const pitch = pitchAt(y);
    const start = clamp(stepSec ? Math.floor(x / pxPerSec / stepSec) * stepSec : x / pxPerSec, 0, lengthSec - 0.05);
    const dur = stepSec || 0.25 * beatSec;
    const created = writeNote({}, { pitch, start, dur, velocity: 100 });
    const idx = notesRef.current.length;
    onUpdateNotes?.([...notesRef.current, created]);
    onSelectionChange?.([idx]);
    preview(pitch, 100);
    beginDrag({ mode: "draw", idx, startX: x, startY: y, orig: [{ idx, pitch, start, dur, velocity: 100 }] });
  };

  const handleNotePointerDown = (event, idx) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const info = readNote(notesRef.current[idx]);
    const { x, y } = localXY(event);
    const rect = event.currentTarget.getBoundingClientRect();
    const onHandle = event.clientX > rect.right - HANDLE_PX;
    let nextSel = selectedRef.current;
    if (event.shiftKey) {
      nextSel = nextSel.includes(idx) ? nextSel.filter((i) => i !== idx) : [...nextSel, idx];
    } else if (!nextSel.includes(idx)) {
      nextSel = [idx];
    }
    onSelectionChange?.(nextSel);
    if (onHandle) {
      beginDrag({ mode: "resize", idx, startX: x, startY: y, orig: [{ idx, ...info }] });
      return;
    }
    preview(info.pitch, info.velocity);
    const group = nextSel.includes(idx) ? nextSel : [idx];
    const orig = [idx, ...group.filter((i) => i !== idx)].map((i) => ({ idx: i, ...readNote(notesRef.current[i]) }));
    beginDrag({ mode: "move", idx, startX: x, startY: y, orig, lastPitch: info.pitch });
  };

  const deleteNote = (event, idx) => {
    event.preventDefault();
    event.stopPropagation();
    onUpdateNotes?.(notesRef.current.filter((_, i) => i !== idx));
    onSelectionChange?.([]);
  };

  // Delete / Backspace removes the selected notes — and only that. Studio also binds these keys to
  // "delete the selected timeline clip", which used to fire underneath the open editor and take
  // the clip (and the editor with it). Captured first and swallowed while the roll is mounted, so
  // nothing behind it ever sees the key.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const tag = event.target?.tagName;
      if (tag && ["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const sel = selectedRef.current;
      if (!sel.length) return;
      onUpdateNotes?.(notesRef.current.filter((_, i) => !sel.includes(i)));
      onSelectionChange?.([]);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onUpdateNotes, onSelectionChange]);

  const beatCount = Math.ceil(gridW / pxPerBeat);
  const bars = Array.from({ length: Math.ceil(beatCount / 4) }, (_, i) => i);
  const gridBg = {
    backgroundImage: [
      `linear-gradient(to right, rgba(255,255,255,0.22) 1px, transparent 1px)`,
      `linear-gradient(to right, rgba(255,255,255,0.10) 1px, transparent 1px)`,
      stepSec > 0 ? `linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px)` : null,
    ]
      .filter(Boolean)
      .join(","),
    backgroundSize: [
      `${pxPerBeat * 4}px 100%`,
      `${pxPerBeat}px 100%`,
      stepSec > 0 ? `${stepSec * pxPerSec}px 100%` : null,
    ]
      .filter(Boolean)
      .join(","),
  };

  return (
    <div className="pr-root">
      <div className="pr-toolbar">
        <label>
          Snap{" "}
          <select value={snapBeats} onChange={(e) => setSnapBeats(Number(e.target.value))}>
            {SNAPS.map((s) => (
              <option key={s.label} value={s.beats}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => setPxPerBeat((v) => clamp(v / 1.4, 24, 480))}>
          −
        </button>
        <span>Zoom</span>
        <button type="button" onClick={() => setPxPerBeat((v) => clamp(v * 1.4, 24, 480))}>
          +
        </button>
        <span className="pr-hint">
          Click to add a note · drag it to move · drag its right edge to resize · double-click to delete
        </span>
      </div>
      <div
        className="pr-scroll"
        ref={scrollRef}
        style={{ height }}
        onScroll={(e) => setScroll({ left: e.currentTarget.scrollLeft })}
      >
        <div className="pr-content" style={{ gridTemplateColumns: `${KEY_W}px ${gridW}px`, gridTemplateRows: `${RULER_H}px ${gridH}px` }}>
          <div className="pr-corner" />
          <div
            className="pr-ruler"
            onPointerDown={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              onSeek?.(clamp((event.clientX - rect.left) / pxPerSec, 0, lengthSec));
            }}
          >
            {bars.map((bar) => (
              <span key={bar} className="pr-bar-label" style={{ left: bar * 4 * pxPerBeat + 4 }}>
                {bar + 1}
              </span>
            ))}
            <div className="pr-playhead-head" style={{ left: playheadSec * pxPerSec }} />
          </div>
          <div className="pr-keys">
            {rows.map((n) => (
              <div
                key={n}
                className={`pr-key ${BLACK.has(n % 12) ? "black" : "white"} ${n % 12 === 0 ? "c" : ""}`}
                style={{ height: ROW }}
                onPointerDown={() => {
                  preview(n, 100);
                  const up = () => {
                    window.removeEventListener("pointerup", up);
                    onPreviewEnd?.();
                  };
                  window.addEventListener("pointerup", up);
                }}
              >
                {n % 12 === 0 ? noteLabel(n) : ""}
              </div>
            ))}
          </div>
          <div className="pr-grid" ref={gridRef} style={gridBg} onPointerDown={handleGridPointerDown}>
            {rows.map((n) => (
              <div
                key={n}
                className={`pr-row ${BLACK.has(n % 12) ? "black" : ""} ${n % 12 === 0 ? "c" : ""}`}
                style={{ top: (127 - n) * ROW, height: ROW }}
              />
            ))}
            {notes.map((note, idx) => {
              const info = readNote(note);
              if (info.start > lengthSec) return null;
              return (
                <div
                  key={idx}
                  className={`pr-note ${selected.has(idx) ? "selected" : ""}`}
                  style={{
                    left: info.start * pxPerSec,
                    top: (127 - info.pitch) * ROW + 1,
                    width: Math.max(6, info.dur * pxPerSec),
                    height: ROW - 2,
                    background: hexToRgba(noteColor, 0.45 + 0.55 * (info.velocity / 127)),
                  }}
                  title={`${noteLabel(info.pitch)} · velocity ${info.velocity}`}
                  onPointerDown={(e) => handleNotePointerDown(e, idx)}
                  onDoubleClick={(e) => deleteNote(e, idx)}
                  onContextMenu={(e) => deleteNote(e, idx)}
                />
              );
            })}
            <div className="pr-playhead" style={{ left: playheadSec * pxPerSec }} />
          </div>
        </div>
      </div>
      <div className="pr-velocity">
        <div className="pr-velocity-label" style={{ width: KEY_W }}>
          Velocity
        </div>
        <div className="pr-velocity-view">
          <div
            className="pr-velocity-lane"
            style={{ width: gridW, height: VEL_H, transform: `translateX(${-scroll.left}px)`, ...gridBg }}
          >
            {notes.map((note, idx) => {
              const info = readNote(note);
              if (info.start > lengthSec) return null;
              return (
                <div
                  key={idx}
                  className={`pr-vel-bar ${selected.has(idx) ? "selected" : ""}`}
                  style={{
                    left: info.start * pxPerSec,
                    height: Math.max(3, (info.velocity / 127) * VEL_H),
                    background: noteColor,
                  }}
                  title={`Velocity ${info.velocity}`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSelectionChange?.([idx]);
                    beginDrag({ mode: "velocity", idx, laneEl: e.currentTarget.parentElement });
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PianoRoll;
