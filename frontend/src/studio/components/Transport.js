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
  timeSignature = "4/4",
  transpose = 0,
  musicalKey = "",
  onUpdateProject,
  selectionSummary = "No active selection",
}) => {
  const [exportOpen, setExportOpen] = useState(false);
  const [masterEnabled, setMasterEnabled] = useState(true);
  const [masterPreset, setMasterPreset] = useState("spotify");
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
            word on the screen. BPM, time signature and transpose are the
            project settings worth reaching for constantly, not the ones
            worth a drawer of their own two clicks away — they live right
            here, editable in place. */}
        <label className="studio-transport-pill studio-transport-field" title="BPM">
          <span>BPM</span>
          <input
            type="number"
            min="40"
            max="240"
            value={bpm}
            /* Clamping on every keystroke fights typing: entering "95" over
               "120" clamps the first "9" up to 40 before the "5" ever lands,
               and the digits that follow land on that snapped-back value
               instead of the one being typed. Pass whatever number is there
               while typing; clamp once, on blur, when the value is final. */
            onChange={(e) => {
              const next = Number(e.target.value);
              if (Number.isFinite(next)) onUpdateProject?.({ bpm: next });
            }}
            onBlur={(e) => {
              const next = Math.max(40, Math.min(240, Number(e.target.value) || 120));
              onUpdateProject?.({ bpm: next });
            }}
          />
        </label>
        <label className="studio-transport-pill studio-transport-field" title="Time signature">
          <span>Time</span>
          <input
            type="text"
            value={timeSignature}
            onChange={(e) => onUpdateProject?.({ timeSignature: e.target.value })}
          />
        </label>
        <label className="studio-transport-pill studio-transport-field" title="Key of the project (free text, e.g. C minor)">
          <span>Key</span>
          <input
            type="text"
            value={musicalKey}
            placeholder="C min"
            onChange={(e) => onUpdateProject?.({ key: e.target.value })}
          />
        </label>
        <label className="studio-transport-pill studio-transport-field" title="Transpose, in semitones">
          <span>Transpose</span>
          <input
            type="number"
            min="-12"
            max="12"
            value={transpose}
            onChange={(e) => onUpdateProject?.({ transpose: Number(e.target.value) || 0 })}
          />
        </label>
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
              <label className="studio-export-master">
                <input
                  type="checkbox"
                  checked={masterEnabled}
                  onChange={(e) => setMasterEnabled(e.target.checked)}
                  onClick={(e) => e.stopPropagation()}
                />
                Master for streaming
                <select
                  value={masterPreset}
                  disabled={!masterEnabled}
                  onChange={(e) => setMasterPreset(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                >
                  <option value="spotify">Spotify (-14 LUFS)</option>
                  <option value="apple_music">Apple Music (-16 LUFS)</option>
                  <option value="youtube">YouTube (-14 LUFS)</option>
                  <option value="loud">Loud (-9 LUFS)</option>
                </select>
              </label>
              <button
                className="studio-export-item"
                onClick={() => runExport(() => onRender({ enabled: masterEnabled, preset: masterPreset }))}
              >
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
