import React, { useEffect, useRef, useState } from "react";
import { midiNoteToName } from "../audioMath";
import { useMidiHardware } from "../hooks/useMidiHardware";

/* Same typing-keyboard-as-piano convention Ableton's own virtual keyboard
   uses: the home row is the white keys (a full octave and a half — enough
   for a simple line or chord without constantly re-octaving), the row
   above fills in the black keys between them. Semitone offset from
   whatever the current octave's root note is. */
const WHITE_KEYS = [
  { key: "a", offset: 0 },
  { key: "s", offset: 2 },
  { key: "d", offset: 4 },
  { key: "f", offset: 5 },
  { key: "g", offset: 7 },
  { key: "h", offset: 9 },
  { key: "j", offset: 11 },
  { key: "k", offset: 12 },
  { key: "l", offset: 14 },
  { key: ";", offset: 16 },
];

const BLACK_KEYS = [
  { key: "w", offset: 1, afterWhite: 0 },
  { key: "e", offset: 3, afterWhite: 1 },
  { key: "t", offset: 6, afterWhite: 3 },
  { key: "y", offset: 8, afterWhite: 4 },
  { key: "u", offset: 10, afterWhite: 5 },
  { key: "o", offset: 13, afterWhite: 7 },
];

const DEFAULT_OCTAVE = 4;
const MIN_OCTAVE = 0;
const MAX_OCTAVE = 8;

/**
 * A clickable piano, also playable from the physical keyboard while it's
 * the MIDI editor's active input mode. onNoteOn/onNoteOff (not a single
 * fire-and-forget callback) because the arpeggiator needs to know which
 * notes are currently held down, the same way a real keyboard's chord is
 * "whatever keys haven't come back up yet".
 */
const PianoKeyboard = ({ active, onNoteOn, onNoteOff }) => {
  const [octave, setOctave] = useState(DEFAULT_OCTAVE);
  const heldPhysicalKeys = useRef(new Map());

  useEffect(() => {
    if (!active) return undefined;
    const heldKeys = heldPhysicalKeys.current;
    const resolveNote = (key) => {
      const hit = WHITE_KEYS.find((k) => k.key === key) || BLACK_KEYS.find((k) => k.key === key);
      if (!hit) return null;
      return Math.min(127, Math.max(0, (octave + 1) * 12 + hit.offset));
    };
    const handleKeyDown = (event) => {
      if (event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || event.target?.isContentEditable) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        setOctave((prev) => Math.max(MIN_OCTAVE, prev - 1));
        return;
      }
      if (key === "x") {
        setOctave((prev) => Math.min(MAX_OCTAVE, prev + 1));
        return;
      }
      const note = resolveNote(key);
      if (note == null) return;
      event.preventDefault();
      heldKeys.set(key, note);
      onNoteOn(note);
    };
    const handleKeyUp = (event) => {
      const key = event.key.toLowerCase();
      const note = heldKeys.get(key);
      if (note == null) return;
      heldKeys.delete(key);
      onNoteOff(note);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      heldKeys.forEach((note) => onNoteOff(note));
      heldKeys.clear();
    };
  }, [active, octave, onNoteOn, onNoteOff]);

  useMidiHardware(active, onNoteOn, onNoteOff);

  const root = (octave + 1) * 12;

  return (
    <div className="studio-piano">
      <button
        type="button"
        className="studio-piano-nav"
        onClick={() => setOctave((prev) => Math.max(MIN_OCTAVE, prev - 1))}
        title="Shift down an octave"
      >
        ←
      </button>
      <div className="studio-piano-keys" style={{ "--white-count": WHITE_KEYS.length }}>
        {WHITE_KEYS.map(({ key, offset }) => {
          const noteNumber = Math.min(127, root + offset);
          return (
            <button
              type="button"
              key={key}
              className="studio-piano-key white"
              onPointerDown={(event) => {
                event.preventDefault();
                onNoteOn(noteNumber);
              }}
              onPointerUp={() => onNoteOff(noteNumber)}
              onPointerLeave={() => onNoteOff(noteNumber)}
              title={`${midiNoteToName(noteNumber)} (${key})`}
            >
              <span className="studio-piano-key-label">{key}</span>
            </button>
          );
        })}
        {BLACK_KEYS.map(({ key, offset, afterWhite }) => {
          const noteNumber = Math.min(127, root + offset);
          return (
            <button
              type="button"
              key={key}
              className="studio-piano-key black"
              style={{ "--after": afterWhite }}
              onPointerDown={(event) => {
                event.preventDefault();
                onNoteOn(noteNumber);
              }}
              onPointerUp={() => onNoteOff(noteNumber)}
              onPointerLeave={() => onNoteOff(noteNumber)}
              title={`${midiNoteToName(noteNumber)} (${key})`}
            >
              <span className="studio-piano-key-label">{key}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="studio-piano-nav"
        onClick={() => setOctave((prev) => Math.min(MAX_OCTAVE, prev + 1))}
        title="Shift up an octave"
      >
        →
      </button>
      <div className="studio-piano-octave">
        <button type="button" className="studio-mini" onClick={() => setOctave((prev) => Math.max(MIN_OCTAVE, prev - 1))} title="Octave down (Z)">
          −
        </button>
        <span>Octave {octave}</span>
        <button type="button" className="studio-mini" onClick={() => setOctave((prev) => Math.min(MAX_OCTAVE, prev + 1))} title="Octave up (X)">
          +
        </button>
      </div>
    </div>
  );
};

export default PianoKeyboard;
