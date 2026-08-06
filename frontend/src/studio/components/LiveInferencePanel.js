import React, { useEffect, useMemo, useState } from "react";
import Select from "../../components/common/Select";
import { useStudioLiveInferenceWs } from "../hooks/useStudioLiveInferenceWs";

const F0_METHODS = [
  { value: "rmvpe", label: "RMVPE" },
  { value: "crepe", label: "CREPE" },
  { value: "fcpe", label: "FCPE" },
  { value: "pm", label: "PM" },
];

const FORMANT_PRESETS = {
  none: { enabled: false, qfrency: 1.0, timbre: 1.0, label: "Off" },
  f2m: { enabled: true, qfrency: 1.0, timbre: 0.8, label: "Female to Male" },
  m2f: { enabled: true, qfrency: 1.0, timbre: 1.2, label: "Male to Female" },
};

const formatCheckpointLabel = (checkpoint) => {
  if (!checkpoint) return "";
  const parts = [];
  if (Number.isFinite(Number(checkpoint.epochs))) {
    parts.push(`${Number(checkpoint.epochs)}e`);
  }
  if (checkpoint.rate) {
    parts.push(`${checkpoint.rate}`);
  }
  if (checkpoint.isBest) {
    parts.push("best");
  }
  return parts.length ? `${parts.join(" · ")} · ${checkpoint.filename}` : checkpoint.filename;
};

const LiveInferencePanel = ({ project, lanes, selection, transport, onRefreshProject }) => {
  const [models, setModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [modelsError, setModelsError] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedCheckpointPath, setSelectedCheckpointPath] = useState("");
  const [targetLaneId, setTargetLaneId] = useState("new");
  const [startMode, setStartMode] = useState("playhead");
  const [pitch, setPitch] = useState(0);
  const [indexRate, setIndexRate] = useState(0.5);
  const [protect, setProtect] = useState(0.33);
  const [volumeEnvelope, setVolumeEnvelope] = useState(1);
  const [f0Method, setF0Method] = useState("rmvpe");
  const [formantPreset, setFormantPreset] = useState("none");
  const [inputGain, setInputGain] = useState(1);
  const [monitorGain, setMonitorGain] = useState(1);
  const [rawMicMonitor, setRawMicMonitor] = useState(false);
  const [monitorEnabled, setMonitorEnabled] = useState(true);

  const availableLanes = useMemo(
    () => (Array.isArray(lanes) ? lanes.filter((lane) => lane.type !== "midi") : []),
    [lanes]
  );

  const selectedModel = useMemo(
    () => models.find((model) => (model.modelId || model.name) === selectedModelId) || null,
    [models, selectedModelId]
  );

  const selectedCheckpoint = useMemo(() => {
    const checkpoints = selectedModel?.checkpoints || [];
    return checkpoints.find((item) => item.path === selectedCheckpointPath) || checkpoints[0] || null;
  }, [selectedCheckpointPath, selectedModel]);

  const insertAtSec = useMemo(() => {
    if (startMode === "selection" && selection?.range) {
      return Math.min(selection.range.start ?? 0, selection.range.end ?? 0);
    }
    return Math.max(0, transport?.currentTime || 0);
  }, [selection, startMode, transport]);

  const {
    status,
    progress,
    error,
    latencyMs,
    inputLevel,
    inputDb,
    inputClip,
    start,
    stop,
    cancel,
    setInputGain: applyInputGain,
    setMonitorGain: applyMonitorGain,
    toggleMicMonitor: applyMicMonitor,
  } = useStudioLiveInferenceWs({
    onCommitted: (commit) => {
      const projectId = commit?.projectId || project?.id || null;
      if (projectId) {
        onRefreshProject?.(projectId);
      }
      if (commit?.laneId) {
        setTargetLaneId(commit.laneId);
      }
    },
  });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const loadModels = async () => {
      setLoadingModels(true);
      setModelsError("");
      try {
        const response = await fetch("/api/available-models", { signal: controller.signal });
        if (!response.ok) {
          throw new Error("Failed to load owned models");
        }
        const data = await response.json();
        if (cancelled) return;
        const nextModels = Array.isArray(data?.models) ? data.models : [];
        setModels(nextModels);
      } catch (err) {
        if (cancelled || err?.name === "AbortError") return;
        setModels([]);
        setModelsError(err?.message || "Failed to load owned models");
      } finally {
        if (!cancelled) {
          setLoadingModels(false);
        }
      }
    };
    loadModels();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!models.length) {
      setSelectedModelId("");
      setSelectedCheckpointPath("");
      return;
    }
    setSelectedModelId((current) => {
      if (current && models.some((model) => (model.modelId || model.name) === current)) {
        return current;
      }
      return models[0].modelId || models[0].name || "";
    });
  }, [models]);

  useEffect(() => {
    const checkpoints = selectedModel?.checkpoints || [];
    if (!checkpoints.length) {
      setSelectedCheckpointPath("");
      return;
    }
    setSelectedCheckpointPath((current) => {
      if (current && checkpoints.some((item) => item.path === current)) {
        return current;
      }
      const preferred = checkpoints.find((item) => item.isBest) || checkpoints[0];
      return preferred?.path || "";
    });
  }, [selectedModel]);

  useEffect(() => {
    applyInputGain(inputGain);
  }, [applyInputGain, inputGain]);

  useEffect(() => {
    applyMonitorGain(monitorEnabled ? monitorGain : 0);
  }, [applyMonitorGain, monitorEnabled, monitorGain]);

  useEffect(() => {
    applyMicMonitor(rawMicMonitor, inputGain);
  }, [applyMicMonitor, rawMicMonitor, inputGain]);

  const formantConfig = FORMANT_PRESETS[formantPreset] || FORMANT_PRESETS.none;

  const isRecording = status === "recording" || status === "connecting";
  const isBusy = isRecording || status === "processing";
  const canStart = Boolean(project?.id && selectedModel && selectedCheckpoint && !isBusy);

  const handleStart = async () => {
    if (!canStart) return;
    await start({
      projectId: project.id,
      laneId: targetLaneId === "new" ? null : targetLaneId,
      insertAtSec,
      frameSize: 1024,
      lowLatencyMonitor: true,
      maxQueueChunks: 6,
      monitorChunkSamples: 1024,
      crossFadeOverlapSec: 0.035,
      extraConvertSec: 0.14,
      model: selectedModel,
      selectedCheckpoint,
      pitch,
      indexRate,
      useIndex: indexRate > 0.001,
      useOfflineIndex: indexRate > 0.001,
      protect,
      volumeEnvelope,
      f0Method,
      formantShifting: formantConfig.enabled,
      formantQfrency: formantConfig.qfrency,
      formantTimbre: formantConfig.timbre,
      monitor: monitorEnabled,
    });
  };

  return (
    <div className="studio-panel-content studio-voice-midi">
      <div className="studio-meta-block">
        <div className="studio-panel-title">Realtime RVC</div>
        <div className="studio-subtext">
          Record through one of your trained RVC models and commit the converted take directly into Studio.
        </div>
      </div>

      <div className="studio-field">
        <label>Owned Model</label>
        <Select
          value={selectedModelId}
          onChange={setSelectedModelId}
          disabled={loadingModels || isBusy || !models.length}
          options={models.map((model) => ({
            value: model.modelId || model.name,
            label: model.name || model.modelId,
          }))}
          placeholder={loadingModels ? "Loading…" : "No models found"}
          ariaLabel="Voice model"
        />
        {selectedModel && (
          <div className="studio-subtext">
            {selectedModel.checkpoints?.length || 0} checkpoints · {selectedModel.sampleRate || 48000} Hz
          </div>
        )}
        {modelsError && <div className="studio-empty">Model error: {modelsError}</div>}
      </div>

      <div className="studio-field">
        <label>Checkpoint</label>
        <Select
          value={selectedCheckpointPath}
          onChange={setSelectedCheckpointPath}
          disabled={!selectedModel || isBusy}
          options={(selectedModel?.checkpoints || []).map((checkpoint) => ({
            value: checkpoint.path,
            label: formatCheckpointLabel(checkpoint),
          }))}
          placeholder="No checkpoints"
          ariaLabel="Checkpoint"
        />
      </div>

      <div className="studio-inline">
        <div className="studio-field">
          <label>Target Lane</label>
          <Select
            value={targetLaneId}
            onChange={setTargetLaneId}
            disabled={isBusy}
            options={[
              { value: "new", label: "Create new lane" },
              ...availableLanes.map((lane) => ({ value: lane.id, label: lane.name })),
            ]}
            ariaLabel="Target lane"
          />
        </div>
        <div className="studio-field">
          <label>Insert At</label>
          <Select
            value={startMode}
            onChange={setStartMode}
            options={[{ value: "playhead", label: "Playhead" }]}
            disabled={isBusy}
          />
        </div>
      </div>

      <div className="studio-inline">
        <div className="studio-field">
          <label>Pitch ({pitch >= 0 ? `+${pitch}` : pitch})</label>
          <input
            type="range"
            min="-24"
            max="24"
            step="1"
            value={pitch}
            onChange={(e) => setPitch(Number(e.target.value))}
            disabled={isBusy}
          />
        </div>
        <div className="studio-field">
          <label>F0 Method</label>
          <Select
            value={f0Method}
            onChange={setF0Method}
            options={F0_METHODS.map((item) => ({ value: item.value, label: item.label }))}
            disabled={isBusy}
          />
        </div>
      </div>

      <div className="studio-field">
        <label>Index Rate ({indexRate.toFixed(2)})</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={indexRate}
          onChange={(e) => setIndexRate(Number(e.target.value))}
          disabled={isBusy}
        />
        <div className="studio-subtext">
          Applied where supported. Windows live rendering still bypasses index lookup for stability.
        </div>
      </div>

      <div className="studio-field">
        <label>Protect ({protect.toFixed(2)})</label>
        <input
          type="range"
          min="0"
          max="0.8"
          step="0.01"
          value={protect}
          onChange={(e) => setProtect(Number(e.target.value))}
          disabled={isBusy}
        />
      </div>

      <div className="studio-field">
        <label>Volume Envelope ({volumeEnvelope.toFixed(2)})</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volumeEnvelope}
          onChange={(e) => setVolumeEnvelope(Number(e.target.value))}
          disabled={isBusy}
        />
      </div>

      <div className="studio-field">
        <label>Formant Shift</label>
        <Select
          value={formantPreset}
          onChange={setFormantPreset}
          disabled={isBusy}
          options={Object.entries(FORMANT_PRESETS).map(([value, preset]) => ({
            value,
            label: preset.label,
          }))}
          ariaLabel="Formant preset"
        />
        <div className="studio-subtext">
          Applied to the final offline render. Live monitor keeps the faster realtime path.
        </div>
      </div>

      <div className="studio-field">
        <label>Mic Gain</label>
        <input
          type="range"
          min="0"
          max="3"
          step="0.05"
          value={inputGain}
          onChange={(e) => setInputGain(Number(e.target.value))}
          disabled={isBusy}
        />
        <div className="studio-meter">
          <div className="studio-meter-fill" style={{ width: `${Math.round(inputLevel * 100)}%` }} />
          {inputClip && <div className="studio-meter-clip">CLIP</div>}
        </div>
        <div className="studio-subtext">
          Gain x{inputGain.toFixed(2)} · {inputDb.toFixed(1)} dB
        </div>
      </div>

      <label className="studio-toggle">
        <input
          type="checkbox"
          checked={rawMicMonitor}
          onChange={(e) => setRawMicMonitor(e.target.checked)}
          disabled={isBusy}
        />
        Hear raw microphone (direct loopback)
      </label>

      <label className="studio-toggle">
        <input
          type="checkbox"
          checked={monitorEnabled}
          onChange={(e) => setMonitorEnabled(e.target.checked)}
          disabled={isBusy}
        />
        Monitor converted voice
      </label>

      <div className="studio-field">
        <label>Monitor Gain</label>
        <input
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={monitorGain}
          onChange={(e) => setMonitorGain(Number(e.target.value))}
          disabled={isBusy || !monitorEnabled}
        />
      </div>

      <div className="studio-actions-row">
        <button className="studio-btn" disabled={!canStart} onClick={handleStart}>
          Record Live
        </button>
        <button className="studio-btn ghost" disabled={!isRecording} onClick={stop}>
          Stop
        </button>
        <button className="studio-btn ghost" disabled={!isBusy} onClick={cancel}>
          Cancel
        </button>
      </div>

      <div className="studio-meta-block">
        <div>Status: {status}</div>
        <div>Insert: {insertAtSec.toFixed(2)}s</div>
        <div>Latency: {latencyMs.toFixed(1)} ms</div>
        <div className="studio-progress">
          <div className="studio-progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      </div>

      {!models.length && !loadingModels && !modelsError && (
        <div className="studio-empty">No owned RVC models were found in the local model library.</div>
      )}

      {error && <div className="studio-empty">Error: {error}</div>}
    </div>
  );
};

export default LiveInferencePanel;
