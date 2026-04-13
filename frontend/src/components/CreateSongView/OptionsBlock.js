import React from "react";
import { fmt } from "./constants";

export function OptionsBlock({
  ui,
  t,
  open,
  onToggle,
  label,
  children,
}) {
  return (
    <div
      style={{
        borderRadius: t.radiusMd,
        border: `1px solid ${t.hairline}`,
        background: t.isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "14px 18px",
          border: "none",
          background: "transparent",
          color: t.text,
          fontSize: 15,
          fontWeight: 600,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span>{label}</span>
        <span style={{ color: t.subtext, fontSize: 12, transition: "transform 0.2s ease", transform: open ? "rotate(180deg)" : "none" }}>▼</span>
      </button>
      {open && (
        <div style={{ padding: "0 18px 18px 18px", borderTop: `1px solid ${t.hairline}` }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function CustomizeContent({
  ui,
  t,
  duration,
  durationInput,
  autoDuration,
  onDurationChange,
  onDurationInputChange,
  onAutoDurationChange,
  bpm,
  setBpm,
  keyscale,
  setKeyscale,
  timeSignature,
  setTimeSignature,
}) {
  const { Input, Slider, Pill } = ui;

  return (
    <div style={{ display: "grid", gap: 20, paddingTop: 18 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: t.subtext, marginBottom: 8 }}>Length</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 200px", minWidth: 0 }}>
            <Slider value={duration} min={30} max={240} step={5} onChange={onDurationChange} disabled={autoDuration} />
          </div>
          <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{autoDuration ? "Auto" : fmt(duration)}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 12, alignItems: "center", marginTop: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, color: t.text, cursor: "pointer" }}>
            <input type="checkbox" checked={!!autoDuration} onChange={(e) => onAutoDurationChange(e.target.checked)} style={{ accentColor: t.primary }} />
            Let AI choose length
          </label>
          <Input
            value={durationInput}
            onChange={(v) => onDurationInputChange(String(v).replace(/[^\d]/g, ""))}
            placeholder="Seconds (30–240)"
            disabled={autoDuration}
          />
        </div>
      </div>

      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: t.subtext, marginBottom: 8 }}>BPM / Key / Time</div>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <Input value={bpm} onChange={(v) => setBpm(String(v).replace(/[^\d.]/g, ""))} placeholder="BPM (optional)" />
          <Input value={keyscale} onChange={setKeyscale} placeholder="Key scale (optional) e.g. C Major" />
          <Input value={timeSignature} onChange={setTimeSignature} placeholder="Time signature (optional) e.g. 4" />
        </div>
      </div>

    </div>
  );
}
