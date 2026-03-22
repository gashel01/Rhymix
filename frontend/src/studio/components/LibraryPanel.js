import React from "react";

const LibraryPanel = ({
  libraryQuery,
  setLibraryQuery,
  filteredAssets,
  lanes,
  actions,
  currentTime,
  onOpenProjectManager,
}) => {
  return (
    <div className="studio-panel studio-library-panel">
      <div className="studio-panel-title">Library & Workspace</div>
      <div className="studio-field">
        <input
          placeholder="Search assets..."
          value={libraryQuery}
          onChange={(e) => setLibraryQuery(e.target.value)}
        />
      </div>
      <div className="studio-library-list">
        {filteredAssets.length ? (
          filteredAssets.map((asset) => (
            <div
              key={asset.id}
              className="studio-library-item"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData("application/x-rhymix-asset", asset.id);
                event.dataTransfer.effectAllowed = "copy";
              }}
              onDoubleClick={() => {
                const laneId = lanes[0]?.id;
                if (!laneId) return;
                actions.addClip(laneId, asset.id, currentTime || 0, asset.durationSec);
              }}
            >
              <div className="studio-library-title">{asset.label || asset.id}</div>
              <div className="studio-library-meta">
                {asset.durationSec != null
                  ? `${Number(asset.durationSec).toFixed(2)}s`
                  : "Unknown"}
              </div>
              <button
                className="studio-mini"
                onClick={() => {
                  const laneId = lanes[0]?.id;
                  if (!laneId) return;
                  actions.addClip(laneId, asset.id, currentTime || 0, asset.durationSec);
                }}
              >
                Add
              </button>
            </div>
          ))
        ) : (
          <div className="studio-empty">No assets yet.</div>
        )}
      </div>
      <div className="studio-actions-row">
        <button className="studio-btn ghost" onClick={onOpenProjectManager}>Project Switcher</button>
      </div>
    </div>
  );
};

export default LibraryPanel;
