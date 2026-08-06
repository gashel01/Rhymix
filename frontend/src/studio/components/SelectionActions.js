import React, { useState } from "react";
import Select from "../../components/common/Select";

const formatRange = (start, end) => {
  const length = Math.max(0, end - start);
  return `${start.toFixed(2)}s → ${end.toFixed(2)}s · ${length.toFixed(2)}s`;
};

/**
 * Everything the AI can do to a selected stretch of timeline.
 *
 * These jobs all existed in the backend but had no way in. They share one
 * requirement — a source asset and a range inside it — so they share one
 * control rather than scattering four buttons around the editor.
 */
const ACTIONS = [
  {
    id: "repaint",
    label: "Regenerate",
    hint: "Generate this stretch again",
    promptPlaceholder: "Describe what this section should become (optional)",
  },
  {
    id: "extend",
    label: "Extend",
    hint: "Continue the music past the selection",
    promptPlaceholder: "Describe how it should continue (optional)",
  },
  {
    id: "vocal2bgm",
    label: "Vocals → Backing",
    hint: "Rebuild this stretch as an instrumental",
    promptPlaceholder: "Describe the backing track (optional)",
  },
  {
    id: "cover",
    label: "Cover",
    hint: "Reinterpret this stretch in another style",
    promptPlaceholder: "Describe the style to cover it in",
  },
];

const SelectionActions = ({ range, sourceClip, busyAction = null, onRun }) => {
  const [actionId, setActionId] = useState("repaint");
  const [prompt, setPrompt] = useState("");

  if (!range) return null;

  const start = Math.min(range.start ?? 0, range.end ?? 0);
  const end = Math.max(range.start ?? 0, range.end ?? 0);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

  const action = ACTIONS.find((entry) => entry.id === actionId) || ACTIONS[0];
  const busy = Boolean(busyAction);
  const hasSource = Boolean(sourceClip?.sourceAssetId);

  return (
    <div className="studio-selection-actions">
      <div className="studio-selection-actions__info">
        <span className="studio-transport-pill">Selection</span>
        <span className="studio-selection-actions__range">{formatRange(start, end)}</span>
      </div>

      <Select
        value={actionId}
        onChange={setActionId}
        options={ACTIONS.map((entry) => ({ value: entry.id, label: entry.label }))}
        disabled={busy}
        className="studio-selection-actions__action"
      />

      <input
        className="studio-selection-actions__prompt"
        type="text"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder={action.promptPlaceholder}
        disabled={busy}
      />

      <button
        className="studio-btn accent"
        onClick={() => onRun?.(action.id, { prompt: prompt.trim(), startSec: start, endSec: end })}
        disabled={!hasSource || busy}
        title={hasSource ? action.hint : "Select a range over an audio clip first"}
      >
        {busyAction === action.id ? "Running…" : action.label}
      </button>
    </div>
  );
};

export default SelectionActions;
