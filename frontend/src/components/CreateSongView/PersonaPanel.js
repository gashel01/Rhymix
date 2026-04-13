import React from "react";
import PersonIcon from "@mui/icons-material/Person";

export function PersonaPanel({ ui, t, loadingModels, availableModels, selectedModel, selectedCheckpoint, onSelectModel, onSelectCheckpoint, onClearPersona }) {
  const { Panel, Pill, Spinner } = ui;
  return (
    <Panel style={{ marginBottom: 14 }}>
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <PersonIcon style={{ fontSize: 18, opacity: 0.9, color: t.text }} />
            <div style={{ fontWeight: 950, letterSpacing: -0.2, color: t.text }}>Persona</div>
            {loadingModels && <Spinner size={14} />}
          </div>
          <div style={{ fontSize: 12, fontWeight: 650, color: t.subtext }}>Optional: Apply a voice model to the generated vocals.</div>
        </div>
        <div className="cs-selectWrap">
          <select
            value={selectedModel?.name || ""}
            onChange={(e) => {
              if (e.target.value === "") {
                onClearPersona();
              } else {
                const model = availableModels.find((m) => m.name === e.target.value);
                onSelectModel(model || null);
                if (model?.checkpoints?.length) {
                  const best = model.checkpoints.find((c) => c.isBest) || model.checkpoints[0];
                  onSelectCheckpoint(best);
                } else {
                  onSelectCheckpoint(null);
                }
              }
            }}
            style={{
              width: "100%",
              height: 44,
              borderRadius: 16,
              border: `1px solid ${t.hairline}`,
              background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
              color: t.text,
              padding: "0 12px",
              fontWeight: 700,
              boxShadow: t.shadowSoft,
              outline: "none",
              appearance: "none",
            }}
          >
            <option value="">None (Original Voice)</option>
            {availableModels.map((m) => (
              <option key={m.name} value={m.name}>{m.name}</option>
            ))}
          </select>
          <div className="cs-selectChevron">▾</div>
        </div>
        {selectedModel && selectedModel.checkpoints?.length > 0 && (
          <div className="cs-selectWrap">
            <select
              value={selectedCheckpoint?.filename || ""}
              onChange={(e) => {
                const cp = selectedModel.checkpoints.find((c) => c.filename === e.target.value);
                onSelectCheckpoint(cp || null);
              }}
              style={{
                width: "100%",
                height: 44,
                borderRadius: 16,
                border: `1px solid ${t.hairline}`,
                background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
                color: t.text,
                padding: "0 12px",
                fontWeight: 700,
                boxShadow: t.shadowSoft,
                outline: "none",
                appearance: "none",
              }}
            >
              {selectedModel.checkpoints.map((cp) => (
                <option key={cp.filename} value={cp.filename}>
                  {cp.epochs}e {cp.isBest ? "(Best)" : ""} - {cp.size_mb}MB
                </option>
              ))}
            </select>
            <div className="cs-selectChevron">▾</div>
          </div>
        )}
        {selectedModel && selectedCheckpoint && (
          <Pill tone="primary" onDelete={onClearPersona}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <PersonIcon style={{ fontSize: 16 }} />
              {selectedModel.name} @ {selectedCheckpoint.epochs}e
            </span>
          </Pill>
        )}
      </div>
    </Panel>
  );
}
