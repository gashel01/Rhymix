import React, { useEffect } from "react";
import { useMidiHardware } from "../hooks/useMidiHardware";

/* General MIDI's standard drum-kit note assignments (channel 10) — picking
   these rather than inventing our own mapping means a clip built here
   still means the same thing to any GM-compatible drum soundfont. */
const PADS = [
  { key: "1", note: 36, label: "Kick" },
  { key: "2", note: 38, label: "Snare" },
  { key: "3", note: 42, label: "Closed HH" },
  { key: "4", note: 46, label: "Open HH" },
  { key: "5", note: 39, label: "Clap" },
  { key: "6", note: 37, label: "Rim" },
  { key: "7", note: 45, label: "Tom" },
  { key: "8", note: 49, label: "Crash" },
];

/** A clickable drum kit, also playable from the number row 1-8. */
const DrumPads = ({ active, onPlayNote }) => {
  useEffect(() => {
    if (!active) return undefined;
    const handleKeyDown = (event) => {
      if (event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || event.target?.isContentEditable) return;
      const pad = PADS.find((p) => p.key === event.key);
      if (!pad) return;
      event.preventDefault();
      onPlayNote(pad.note);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, onPlayNote]);

  useMidiHardware(active, onPlayNote);

  return (
    <div className="studio-drum-pads">
      {PADS.map((pad) => (
        <button
          type="button"
          key={pad.note}
          className="studio-drum-pad"
          onPointerDown={(event) => {
            event.preventDefault();
            onPlayNote(pad.note);
          }}
          title={`${pad.label} (${pad.key})`}
        >
          <span className="studio-drum-pad-key">{pad.key}</span>
          <span className="studio-drum-pad-label">{pad.label}</span>
        </button>
      ))}
    </div>
  );
};

export default DrumPads;
