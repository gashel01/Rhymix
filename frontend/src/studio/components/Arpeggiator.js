import React from "react";
import MidiMacroButton from "./MidiMacroButton";

export const ARP_RATES = ["1/4", "1/8", "1/16", "1/32"];
export const ARP_MODES = [
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
  { value: "updown", label: "Up Down" },
  { value: "random", label: "Random" },
];

export const DEFAULT_ARP_SETTINGS = {
  enabled: false,
  mode: "up",
  rate: "1/16",
  octaves: 1,
  gate: 70,
  swing: 0,
  latch: false,
};

/**
 * Controls only — the stepping engine (the thing that actually turns held
 * notes into a running pattern of note-insertions) lives in ClipView.js,
 * where the clip, the playhead and the project's own BPM already are. This
 * stays a plain controlled form so it has no idea whether anything is
 * actually playing.
 */
const Arpeggiator = ({ settings, onChange, midiMacros }) => {
  const set = (patch) => onChange({ ...settings, ...patch });

  return (
    <div className="studio-arp">
      <label className="studio-arp-toggle">
        <input type="checkbox" checked={settings.enabled} onChange={(event) => set({ enabled: event.target.checked })} />
        Arpeggiator
      </label>
      <div className="studio-arp-row">
        <select className="studio-arp-select" value={settings.mode} onChange={(event) => set({ mode: event.target.value })}>
          {ARP_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </select>
        <select className="studio-arp-select" value={settings.rate} onChange={(event) => set({ rate: event.target.value })}>
          {ARP_RATES.map((rate) => (
            <option key={rate} value={rate}>
              {rate}
            </option>
          ))}
        </select>
      </div>
      <div className="studio-arp-row">
        <div className="studio-arp-field">
          <label>Octaves ({settings.octaves})</label>
          <input
            type="range"
            min="1"
            max="4"
            step="1"
            value={settings.octaves}
            onChange={(event) => set({ octaves: Number(event.target.value) })}
          />
          <MidiMacroButton
            macros={midiMacros}
            paramId="arp.octaves"
            label="Arpeggiator Octaves"
            min={1}
            max={4}
            step={1}
            value={settings.octaves}
            onChange={(next) => set({ octaves: next })}
          />
        </div>
        <div className="studio-arp-field">
          <label>Gate ({settings.gate}%)</label>
          <input
            type="range"
            min="10"
            max="100"
            step="5"
            value={settings.gate}
            onChange={(event) => set({ gate: Number(event.target.value) })}
          />
          <MidiMacroButton
            macros={midiMacros}
            paramId="arp.gate"
            label="Arpeggiator Gate"
            min={10}
            max={100}
            step={5}
            value={settings.gate}
            onChange={(next) => set({ gate: next })}
          />
        </div>
        <div className="studio-arp-field">
          <label>Swing ({settings.swing}%)</label>
          <input
            type="range"
            min="0"
            max="75"
            step="5"
            value={settings.swing}
            onChange={(event) => set({ swing: Number(event.target.value) })}
          />
          <MidiMacroButton
            macros={midiMacros}
            paramId="arp.swing"
            label="Arpeggiator Swing"
            min={0}
            max={75}
            step={5}
            value={settings.swing}
            onChange={(next) => set({ swing: next })}
          />
        </div>
      </div>
      <button
        type="button"
        className={`studio-mini ${settings.latch ? "active" : ""}`}
        onClick={() => set({ latch: !settings.latch })}
        title="Keep the pattern going after the keys come back up"
      >
        Latch {settings.latch ? "On" : "Off"}
      </button>
    </div>
  );
};

export default Arpeggiator;
