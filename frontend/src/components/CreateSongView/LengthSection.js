import React from "react";
import { fmt } from "./constants";

export function LengthSection({ ui, t, duration, durationInput, autoDuration, onDurationChange, onDurationInputChange, onAutoDurationChange }) {
  const { Input, Slider, CheckRow } = ui;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontWeight: 950, letterSpacing: -0.2, color: t.text }}>Length</div>
        <div style={{ fontSize: 12, fontWeight: 900, color: t.subtext }}>
          {autoDuration ? "Auto" : `${fmt(duration)} (max 4:00)`}
        </div>
      </div>
      <div className="cs-len">
        <div style={{ paddingTop: 6 }}>
          <Slider
            value={duration}
            min={30}
            max={240}
            step={5}
            onChange={onDurationChange}
            disabled={autoDuration}
          />
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <Input
            value={durationInput}
            onChange={(v) => onDurationInputChange(String(v).replace(/[^\d]/g, ""))}
            placeholder="Seconds"
            disabled={autoDuration}
          />
          <div style={{ fontSize: 12, fontWeight: 650, color: t.subtext }}>Seconds (30–240)</div>
        </div>
      </div>
      <CheckRow
        label="Let model choose length"
        value={autoDuration}
        onChange={onAutoDurationChange}
        hint="When enabled, duration is inferred by the model."
      />
    </div>
  );
}
