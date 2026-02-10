import React from "react";
import { fmt, GENRE_RECS, toKey } from "./constants";
import PersonIcon from "@mui/icons-material/Person";

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
  genreText,
  genreTokens,
  usedGenreKeys,
  onGenreTextChange,
  addGenreToken,
  removeGenreToken,
  enhanceVocals,
  setEnhanceVocals,
  instrumentalOnly,
  loadingModels,
  availableModels,
  selectedModel,
  selectedCheckpoint,
  onSelectModel,
  onSelectCheckpoint,
  onClearPersona,
}) {
  const { Input, Slider, CheckRow, Pill } = ui;

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
        <div style={{ fontSize: 13, fontWeight: 600, color: t.subtext, marginBottom: 8 }}>Genre & style</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {genreTokens.map((g) => (
            <Pill key={g} tone="neutral" onDelete={() => removeGenreToken(g)}>{g}</Pill>
          ))}
          {GENRE_RECS.filter((r) => !usedGenreKeys.has(toKey(r))).map((r) => (
            <Pill key={r} tone="primary" onClick={() => addGenreToken(r)} title="Add">{r}</Pill>
          ))}
        </div>
        <Input value={genreText} onChange={onGenreTextChange} placeholder="Or type your own…" />
      </div>

      {!instrumentalOnly && (
        <CheckRow
          label="Enhance vocals (recommended)"
          value={enhanceVocals}
          onChange={setEnhanceVocals}
        />
      )}

      {!instrumentalOnly && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: t.subtext, marginBottom: 8 }}>Voice</div>
          <div className="cs-selectWrap">
            <select
              value={selectedModel?.name || ""}
              onChange={(e) => {
                if (e.target.value === "") onClearPersona();
                else {
                  const model = availableModels.find((m) => m.name === e.target.value);
                  onSelectModel(model || null);
                  if (model?.checkpoints?.length) {
                    const best = model.checkpoints.find((c) => c.isBest) || model.checkpoints[0];
                    onSelectCheckpoint(best);
                  } else onSelectCheckpoint(null);
                }
              }}
              style={{
                width: "100%",
                height: 44,
                borderRadius: t.radiusSm,
                border: `1px solid ${t.hairline}`,
                background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
                color: t.text,
                padding: "0 12px",
                fontWeight: 600,
                fontSize: 14,
                outline: "none",
                appearance: "none",
              }}
            >
              <option value="">Original (no voice change)</option>
              {availableModels.map((m) => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
            </select>
            <div className="cs-selectChevron">▾</div>
          </div>
          {selectedModel && selectedModel.checkpoints?.length > 0 && (
            <div className="cs-selectWrap" style={{ marginTop: 8 }}>
              <select
                value={selectedCheckpoint?.filename || ""}
                onChange={(e) => {
                  const cp = selectedModel.checkpoints.find((c) => c.filename === e.target.value);
                  onSelectCheckpoint(cp || null);
                }}
                style={{
                  width: "100%",
                  height: 44,
                  borderRadius: t.radiusSm,
                  border: `1px solid ${t.hairline}`,
                  background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
                  color: t.text,
                  padding: "0 12px",
                  fontWeight: 600,
                  fontSize: 14,
                  outline: "none",
                  appearance: "none",
                }}
              >
                {selectedModel.checkpoints.map((cp) => (
                  <option key={cp.filename} value={cp.filename}>
                    {cp.epochs}e {cp.isBest ? "(best)" : ""}
                  </option>
                ))}
              </select>
              <div className="cs-selectChevron">▾</div>
            </div>
          )}
          {selectedModel && selectedCheckpoint && (
            <Pill tone="primary" onDelete={onClearPersona} style={{ marginTop: 8 }}>
              <PersonIcon style={{ fontSize: 14, opacity: 0.9 }} /> {selectedModel.name}
            </Pill>
          )}
        </div>
      )}
    </div>
  );
}
