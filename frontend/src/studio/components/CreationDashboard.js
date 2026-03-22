import React from "react";

const CreationDashboard = ({
  createMode,
  setCreateMode,
  lyrics,
  setLyrics,
  style,
  setStyle,
  model,
  setModel,
  createPrompt,
  handleStartJob,
}) => {
  return (
    <div className="studio-panel studio-create-panel">
      <div className="studio-panel-title">Creation Dashboard</div>
      <div className="studio-toggle-group">
        <button
          className={`studio-mini ${createMode === "custom" ? "active" : ""}`}
          onClick={() => setCreateMode("custom")}
        >
          Custom Mode
        </button>
        <button
          className={`studio-mini ${createMode === "simple" ? "active" : ""}`}
          onClick={() => setCreateMode("simple")}
        >
          Simple Mode
        </button>
      </div>
      {createMode === "custom" && (
        <div className="studio-field">
          <label>Lyrics</label>
          <textarea value={lyrics} onChange={(e) => setLyrics(e.target.value)} rows={4} />
        </div>
      )}
      <div className="studio-field">
        <label>Style of Music</label>
        <input value={style} onChange={(e) => setStyle(e.target.value)} />
      </div>
      <div className="studio-field">
        <label>Model</label>
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="v3.5">v3.5</option>
          <option value="v4">v4</option>
          <option value="v5">v5</option>
        </select>
      </div>
      <div className="studio-actions-row">
        <button
          className="studio-btn accent"
          disabled={!createPrompt}
          onClick={() =>
            handleStartJob("add_layer", {
              prompt: createPrompt,
              durationSec: 30,
              model,
            })
          }
        >
          Generate
        </button>
      </div>
      <div className="studio-actions-grid">
        <button className="studio-btn ghost" disabled>
          Upload Audio
        </button>
        <button className="studio-btn ghost" disabled>
          Record
        </button>
        <button className="studio-btn ghost" disabled>
          Add Persona
        </button>
      </div>
    </div>
  );
};

export default CreationDashboard;
