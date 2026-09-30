import { useEffect } from "react";

/* Web MIDI hardware input — lets a real USB MIDI keyboard/pad play notes into whatever surface
   is active (piano keyboard, drum pads), the same way the typing-keyboard fallback already
   does. Also surfaces Control Change messages (onControlChange) for knob/fader macro mapping
   (see useMidiMacros.js) — same connection, same message stream, just a different status byte.
   Feature-detects: silently does nothing if the browser has no navigator.requestMIDIAccess
   or the user denies/has no device, so the mouse/typing-keyboard path is never the only option
   but is also never broken by this. */
export const useMidiHardware = (active, onNoteOn, onNoteOff, onControlChange) => {
  useEffect(() => {
    if (!active) return undefined;
    if (typeof navigator === "undefined" || !navigator.requestMIDIAccess) return undefined;

    let midiAccess = null;
    let cancelled = false;
    const heldNotes = new Set();

    const handleMessage = (event) => {
      const [status, data1, data2] = event.data;
      const command = status & 0xf0;
      if (command === 0x90 && data2 > 0) {
        heldNotes.add(data1);
        onNoteOn(data1, data2);
      } else if (command === 0x80 || (command === 0x90 && data2 === 0)) {
        heldNotes.delete(data1);
        onNoteOff?.(data1);
      } else if (command === 0xb0) {
        onControlChange?.(data1, data2);
      }
    };

    const attachInput = (input) => input.addEventListener("midimessage", handleMessage);

    navigator
      .requestMIDIAccess()
      .then((access) => {
        if (cancelled) return;
        midiAccess = access;
        access.inputs.forEach(attachInput);
        access.onstatechange = (event) => {
          if (event.port.type === "input" && event.port.state === "connected") {
            attachInput(event.port);
          }
        };
      })
      .catch(() => {
        /* no permission / unsupported — mouse and typing-keyboard input still work */
      });

    return () => {
      cancelled = true;
      heldNotes.forEach((note) => onNoteOff?.(note));
      heldNotes.clear();
      if (midiAccess) {
        midiAccess.inputs.forEach((input) => input.removeEventListener("midimessage", handleMessage));
        midiAccess.onstatechange = null;
      }
    };
  }, [active, onNoteOn, onNoteOff, onControlChange]);
};
