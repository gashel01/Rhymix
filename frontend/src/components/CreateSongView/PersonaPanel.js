import React from "react";
import Select from "../common/Select";
import PersonIcon from "@mui/icons-material/PersonOutlined";

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
          <Select
            value={selectedModel?.name || ""}
            onChange={(next) => {
              if (next === "") {
                onClearPersona();
                return;
              }
              const model = availableModels.find((m) => m.name === next);
              onSelectModel(model || null);
              if (model?.checkpoints?.length) {
                const best = model.checkpoints.find((c) => c.isBest) || model.checkpoints[0];
                onSelectCheckpoint(best);
              } else {
                onSelectCheckpoint(null);
              }
            }}
            options={[
              { value: "", label: "None (Original Voice)" },
              ...availableModels.map((m) => ({ value: m.name, label: m.name })),
            ]}
            ariaLabel="Persona voice model"
          />
          <div className="cs-selectChevron">▾</div>
        </div>
        {selectedModel && selectedModel.checkpoints?.length > 0 && (
          <div className="cs-selectWrap">
            <Select
              value={selectedCheckpoint?.filename || ""}
              onChange={(next) => { const cp = selectedModel.checkpoints.find((c) => c.filename === next); onSelectCheckpoint(cp || null); }}
              options={selectedModel.checkpoints.map((cp) => ({ value: cp.filename, label: `${cp.epochs}e ${cp.isBest ? "(Best)" : ""} - ${cp.size_mb}MB` }))}
            />
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
