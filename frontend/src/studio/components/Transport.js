import React from "react";

const formatTime = (seconds) => {
  if (seconds == null || Number.isNaN(seconds)) return "0:00.000";
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(3).padStart(6, "0");
  return `${mins}:${secs}`;
};

const Transport = ({
  isPlaying,
  currentTime,
  onPlay,
  onPause,
  onStop,
  onUndo,
  onRedo,
  onRender,
  onReset,
  jobStatus,
  contextActions = [],
}) => {
  return (
    <div className="studio-bottom-bar">
      <div className="studio-bottom-left">
        <button className="studio-btn" onClick={isPlaying ? onPause : onPlay}>
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button className="studio-btn ghost" onClick={onStop}>
          Stop
        </button>
        <button className="studio-btn ghost" disabled>
          Record
        </button>
        <div className="studio-time">{formatTime(currentTime)}</div>
      </div>

      <div className="studio-bottom-center">
        {contextActions.length ? (
          contextActions.map((action) => (
            <button
              key={action.id}
              className={`studio-btn ${action.variant || "ghost"}`}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))
        ) : (
          <div className="studio-context-hint">Drop clips or open the library to begin.</div>
        )}
      </div>

      <div className="studio-bottom-right">
        <button className="studio-btn ghost" onClick={onUndo}>
          Undo
        </button>
        <button className="studio-btn ghost" onClick={onRedo}>
          Redo
        </button>
        {onReset ? (
          <button className="studio-btn ghost" onClick={onReset}>
            Reset
          </button>
        ) : null}
        <button className="studio-btn accent" onClick={onRender}>
          Export
        </button>
        <div className="studio-credits">Credits: --</div>
        <div className="studio-job-status">{jobStatus || "Idle"}</div>
      </div>
    </div>
  );
};

export default Transport;
