import React, { useEffect, useRef, useState } from "react";
import {
  ExportIcon,
  PauseIcon,
  PlayIcon,
  RedoIcon,
  StopIcon,
  UndoIcon,
} from "./StudioIcons";

const formatTime = (seconds) => {
  if (seconds == null || Number.isNaN(seconds)) return "0:00.000";
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(3).padStart(6, "0");
  return `${mins}:${secs}`;
};

/**
 * Bottom bar.
 *
 * It used to lay sixteen controls in a row at equal weight, including Snap,
 * Loop and Zoom — which the timeline toolbar already owns, and which are state
 * rather than actions. What's left reads as three groups: transport on the
 * left, selection context in the middle, and one primary action on the right.
 */
const Transport = ({
  isPlaying,
  currentTime,
  onPlay,
  onPause,
  onStop,
  onUndo,
  onRedo,
  onRender,
  onRenderStems,
  onExportMidi,
  onReset,
  jobStatus,
  contextActions = [],
  jobCount = 0,
  bpm = 120,
  selectionSummary = "No active selection",
}) => {
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef(null);

  useEffect(() => {
    if (!exportOpen) return undefined;
    const onDocumentClick = (event) => {
      if (!exportRef.current?.contains(event.target)) setExportOpen(false);
    };
    document.addEventListener("mousedown", onDocumentClick);
    return () => document.removeEventListener("mousedown", onDocumentClick);
  }, [exportOpen]);

  const runExport = (action) => {
    setExportOpen(false);
    action?.();
  };

  return (
    <div className="studio-bottom-bar">
      <div className="studio-bottom-left">
        {/* Transport is the one place a shape beats a word: these are the
            controls you reach for without reading. Play is a filled disc, the
            only round control in the Studio, so it is findable by silhouette. */}
        <button
          className="studio-transport-play"
          onClick={isPlaying ? onPause : onPlay}
          aria-label={isPlaying ? "Pause" : "Play"}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <PauseIcon size={17} /> : <PlayIcon size={17} />}
        </button>
        <button
          className="studio-icon-btn"
          onClick={onStop}
          aria-label="Stop"
          title="Stop"
        >
          <StopIcon size={15} />
        </button>
        <div className="studio-time">{formatTime(currentTime)}</div>
        {/* The workspace pill was a constant "Studio" — the third copy of that
            word on the screen. BPM is the one number worth keeping here. */}
        <div className="studio-transport-pill">
          <span>BPM</span>
          {bpm}
        </div>
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
          <div className="studio-context-hint">{selectionSummary}</div>
        )}
      </div>

      <div className="studio-bottom-right">
        <div className="studio-job-status">
          {jobCount ? `${jobCount} active · ` : ""}
          {jobStatus || "Idle"}
        </div>

        <button
          className="studio-icon-btn"
          onClick={onUndo}
          aria-label="Undo"
          title="Undo"
        >
          <UndoIcon size={16} />
        </button>
        <button
          className="studio-icon-btn"
          onClick={onRedo}
          aria-label="Redo"
          title="Redo"
        >
          <RedoIcon size={16} />
        </button>

        <div className="studio-export-wrap" ref={exportRef}>
          <button
            className="studio-btn accent"
            onClick={() => setExportOpen((open) => !open)}
            aria-expanded={exportOpen}
            aria-haspopup="menu"
          >
            <ExportIcon size={15} />
            Export
          </button>
          {exportOpen ? (
            <div className="studio-export-menu" role="menu">
              <button className="studio-export-item" onClick={() => runExport(onRender)}>
                Mixdown
                <span>One file, lanes mixed</span>
              </button>
              <button className="studio-export-item" onClick={() => runExport(onRenderStems)}>
                Stems
                <span>One file per lane</span>
              </button>
              <button className="studio-export-item" onClick={() => runExport(onExportMidi)}>
                MIDI
                <span>All MIDI clips as .mid</span>
              </button>
              {onReset ? (
                <button
                  className="studio-export-item danger"
                  onClick={() => runExport(onReset)}
                >
                  Reset project
                  <span>Back to the original assets</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default Transport;
