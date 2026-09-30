import React, { useEffect, useMemo, useState } from "react";
import Select from "../../components/common/Select";
import { useStudioLiveInferenceWs } from "../hooks/useStudioLiveInferenceWs";

const F0_METHODS = [
  { value: "rmvpe", label: "RMVPE", hint: "Best all-round pitch tracking — the usual choice" },
  { value: "crepe", label: "CREPE", hint: "Very accurate, a bit heavier on the CPU" },
  { value: "fcpe", label: "FCPE", hint: "Fast and light, good on modest hardware" },
  { value: "pm", label: "PM", hint: "Fastest, least accurate — for quick tests" },
];

const FORMANT_PRESETS = {
  none: { enabled: false, qfrency: 1.0, timbre: 1.0, label: "Off" },
  f2m: { enabled: true, qfrency: 1.0, timbre: 0.8, label: "Female → Male" },
  m2f: { enabled: true, qfrency: 1.0, timbre: 1.2, label: "Male → Female" },
};

// Readable units instead of a bare 0–1/0–3 decimal, same idea as EffectsRack.js.
const pct = (v) => `${Math.round(v * 100)}%`;
const mult = (v) => `×${v.toFixed(2)}`;
const semitones = (v) => `${v > 0 ? "+" : ""}${v} st`;

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
  const [tuningOpen, setTuningOpen] = useState(false);
  const [f0Autotune, setF0Autotune] = useState(false);
  const [autotuneStrength, setAutotuneStrength] = useState(1);
  const [proposedPitch, setProposedPitch] = useState(false);
  const [maxQueueChunks, setMaxQueueChunks] = useState(6);

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
    estimatedLatencyMs,
    inputLevel,
    inputDb,
    inputClip,
    outputLevel,
    outputDb,
    outputClip,
    droppedChunks,
    stageTimings,
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
      maxQueueChunks,
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
      f0Autotune,
      f0AutotuneStrength: autotuneStrength,
      proposedPitch,
    });
  };

  const statusLabel =
    { idle: "Ready", connecting: "Connecting…", recording: "Recording", processing: "Converting…", committed: "Done", error: "Error" }[
      status
    ] || status;

  return (
    <div className="studio-panel-content studio-livevc">
      <div className="studio-livevc-intro">
        <div className="studio-panel-title">Live VC</div>
        <div className="studio-subtext">
          Sing or speak through a trained voice model, live — the converted take lands as a new clip when you stop.
        </div>
      </div>

      {/* --- Voice: the one choice that actually matters, so it gets the most visual weight. --- */}
      <div className="studio-livevc-card">
        <div className="studio-livevc-card-label">Voice</div>
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
        {modelsError && <div className="studio-livevc-error">Couldn't load your models: {modelsError}</div>}
        {selectedModel && (
          <>
            <div className="studio-livevc-chips">
              <span className="studio-livevc-chip">{selectedModel.sampleRate || 48000} Hz</span>
              <span className="studio-livevc-chip">
                {selectedModel.checkpoints?.length || 0} checkpoint{(selectedModel.checkpoints?.length || 0) === 1 ? "" : "s"}
              </span>
            </div>
            <Select
              value={selectedCheckpointPath}
              onChange={setSelectedCheckpointPath}
              disabled={isBusy}
              options={(selectedModel?.checkpoints || []).map((checkpoint) => ({
                value: checkpoint.path,
                label: formatCheckpointLabel(checkpoint),
              }))}
              placeholder="No checkpoints"
              ariaLabel="Checkpoint"
            />
          </>
        )}
        {!models.length && !loadingModels && !modelsError && (
          <div className="studio-livevc-error">
            No trained models found. Train one first (see Train in the sidebar), then come back here.
          </div>
        )}
      </div>

      {/* --- Destination: where the take ends up. --- */}
      <div className="studio-livevc-row">
        <label className="studio-livevc-mini-field">
          <span>Lane</span>
          <Select
            value={targetLaneId}
            onChange={setTargetLaneId}
            disabled={isBusy}
            options={[
              { value: "new", label: "New lane" },
              ...availableLanes.map((lane) => ({ value: lane.id, label: lane.name })),
            ]}
            ariaLabel="Target lane"
          />
        </label>
        <label className="studio-livevc-mini-field">
          <span>Starts at</span>
          <Select
            value={startMode}
            onChange={setStartMode}
            options={[{ value: "playhead", label: `Playhead (${insertAtSec.toFixed(1)}s)` }]}
            disabled={isBusy}
          />
        </label>
      </div>

      {/* --- Pitch: the one tuning knob worth surfacing by default. --- */}
      <div className="studio-fx-row studio-livevc-pitch">
        <span className="studio-fx-row-top">
          <span>Pitch</span>
          <span className="studio-fx-value">{semitones(pitch)}</span>
        </span>
        <input
          type="range"
          min="-24"
          max="24"
          step="1"
          value={pitch}
          onChange={(e) => setPitch(Number(e.target.value))}
          onDoubleClick={() => setPitch(0)}
          disabled={isBusy}
          title="Double-click to reset"
        />
      </div>

      {/* --- Everything else: tuning most people never touch, tucked away like an effect card. --- */}
      <button
        type="button"
        className="studio-livevc-tuning-toggle"
        onClick={() => setTuningOpen((v) => !v)}
        aria-expanded={tuningOpen}
      >
        <span>Voice tuning</span>
        <span className={`studio-fx-chevron ${tuningOpen ? "open" : ""}`} aria-hidden="true">
          ›
        </span>
      </button>
      {tuningOpen && (
        <div className="studio-livevc-tuning">
          <label className="studio-livevc-mini-field">
            <span>Pitch detection</span>
            <Select
              value={f0Method}
              onChange={setF0Method}
              options={F0_METHODS.map((item) => ({ value: item.value, label: item.label }))}
              disabled={isBusy}
            />
          </label>
          <div className="studio-subtext studio-livevc-hint">{F0_METHODS.find((m) => m.value === f0Method)?.hint}</div>

          <div className="studio-fx-row">
            <span className="studio-fx-row-top">
              <span>Index rate</span>
              <span className="studio-fx-value">{pct(indexRate)}</span>
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={indexRate}
              onChange={(e) => setIndexRate(Number(e.target.value))}
              onDoubleClick={() => setIndexRate(0.5)}
              disabled={isBusy}
              title="Double-click to reset"
            />
            <div className="studio-subtext">How closely the voice sticks to the trained model's own texture.</div>
          </div>

          <div className="studio-fx-row">
            <span className="studio-fx-row-top">
              <span>Protect</span>
              <span className="studio-fx-value">{pct(protect)}</span>
            </span>
            <input
              type="range"
              min="0"
              max="0.8"
              step="0.01"
              value={protect}
              onChange={(e) => setProtect(Number(e.target.value))}
              onDoubleClick={() => setProtect(0.33)}
              disabled={isBusy}
              title="Double-click to reset"
            />
            <div className="studio-subtext">Keeps consonants and breaths clear instead of slurred.</div>
          </div>

          <div className="studio-fx-row">
            <span className="studio-fx-row-top">
              <span>Volume envelope</span>
              <span className="studio-fx-value">{pct(volumeEnvelope)}</span>
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volumeEnvelope}
              onChange={(e) => setVolumeEnvelope(Number(e.target.value))}
              onDoubleClick={() => setVolumeEnvelope(1)}
              disabled={isBusy}
              title="Double-click to reset"
            />
            <div className="studio-subtext">1 follows your own dynamics, 0 follows the trained voice's.</div>
          </div>

          <div className="studio-fx-row">
            <span className="studio-fx-row-top">
              <span>Buffer depth</span>
              <span className="studio-fx-value">{maxQueueChunks} blocks</span>
            </span>
            <input
              type="range"
              min="4"
              max="20"
              step="1"
              value={maxQueueChunks}
              onChange={(e) => setMaxQueueChunks(Number(e.target.value))}
              onDoubleClick={() => setMaxQueueChunks(6)}
              disabled={isBusy}
              title="Double-click to reset"
            />
            <div className="studio-subtext">
              How much audio can queue up before old blocks get dropped to catch up. Lower cuts latency but glitches
              sooner under load; higher rides out load spikes smoother at the cost of a longer delay.
            </div>
          </div>

          <label className="studio-livevc-mini-field">
            <span>Formant shift</span>
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
          </label>
          <div className="studio-subtext studio-livevc-hint">
            Adjusts vocal tract size — lighter or deeper — on the final render. The live monitor keeps its own, faster path.
          </div>

          <label className="studio-toggle studio-livevc-toggle">
            <input type="checkbox" checked={proposedPitch} onChange={(e) => setProposedPitch(e.target.checked)} disabled={isBusy} />
            Suggest my key
          </label>
          <div className="studio-subtext studio-livevc-hint">
            Snaps your pitch to the closest note in a key the engine guesses from what you're singing.
          </div>

          <label className="studio-toggle studio-livevc-toggle">
            <input type="checkbox" checked={f0Autotune} onChange={(e) => setF0Autotune(e.target.checked)} disabled={isBusy} />
            Autotune
          </label>
          {f0Autotune && (
            <div className="studio-fx-row">
              <span className="studio-fx-row-top">
                <span>Autotune strength</span>
                <span className="studio-fx-value">{pct(autotuneStrength)}</span>
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={autotuneStrength}
                onChange={(e) => setAutotuneStrength(Number(e.target.value))}
                onDoubleClick={() => setAutotuneStrength(1)}
                disabled={isBusy}
                title="Double-click to reset"
              />
            </div>
          )}
        </div>
      )}

      {/* --- Monitor: what you hear back while recording. --- */}
      <div className="studio-livevc-card">
        <div className="studio-livevc-card-label">Monitor</div>
        <div className="studio-livevc-meter-row">
          <span className="studio-livevc-meter-label">Mic</span>
          <div className={`studio-livevc-meter ${inputClip ? "clip" : ""}`}>
            <div className="studio-livevc-meter-fill" style={{ width: `${Math.min(100, Math.round(inputLevel * 100))}%` }} />
          </div>
          <span className="studio-livevc-meter-value">{inputClip ? "CLIP" : `${inputDb.toFixed(0)} dB`}</span>
        </div>
        <div className="studio-livevc-meter-row">
          <span className="studio-livevc-meter-label">Out</span>
          <div className={`studio-livevc-meter ${outputClip ? "clip" : ""}`}>
            <div className="studio-livevc-meter-fill" style={{ width: `${Math.min(100, Math.round(outputLevel * 100))}%` }} />
          </div>
          <span className="studio-livevc-meter-value">{outputClip ? "CLIP" : `${outputDb.toFixed(0)} dB`}</span>
        </div>
        <div className="studio-fx-row">
          <span className="studio-fx-row-top">
            <span>Mic gain</span>
            <span className="studio-fx-value">{mult(inputGain)}</span>
          </span>
          <input
            type="range"
            min="0"
            max="3"
            step="0.05"
            value={inputGain}
            onChange={(e) => setInputGain(Number(e.target.value))}
            onDoubleClick={() => setInputGain(1)}
            disabled={isBusy}
            title="Double-click to reset"
          />
        </div>

        {/* Mutually exclusive: both playing at once means hearing your own voice twice at two
            different latencies (near-zero for raw mic, the pipeline's real delay for converted) -
            that mismatch is what made this hard to sing/speak against, not just the latency alone. */}
        <label className="studio-toggle studio-livevc-toggle">
          <input
            type="checkbox"
            checked={rawMicMonitor}
            onChange={(e) => {
              const enabled = e.target.checked;
              setRawMicMonitor(enabled);
              if (enabled) setMonitorEnabled(false);
            }}
            disabled={isBusy}
          />
          Hear raw microphone
        </label>

        <label className="studio-toggle studio-livevc-toggle">
          <input
            type="checkbox"
            checked={monitorEnabled}
            onChange={(e) => {
              const enabled = e.target.checked;
              setMonitorEnabled(enabled);
              if (enabled) setRawMicMonitor(false);
            }}
            disabled={isBusy}
          />
          Hear converted voice
        </label>
        {monitorEnabled && (
          <div className="studio-fx-row">
            <span className="studio-fx-row-top">
              <span>Monitor gain</span>
              <span className="studio-fx-value">{mult(monitorGain)}</span>
            </span>
            <input
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={monitorGain}
              onChange={(e) => setMonitorGain(Number(e.target.value))}
              onDoubleClick={() => setMonitorGain(1)}
              disabled={isBusy}
              title="Double-click to reset"
            />
          </div>
        )}
      </div>

      {/* --- Transport: the big, obvious call to action. --- */}
      <div className="studio-livevc-transport">
        <button
          type="button"
          className={`studio-livevc-record ${isRecording ? "recording" : ""}`}
          disabled={!canStart && !isRecording}
          onClick={handleStart}
          title={!canStart && !isRecording ? "Pick a voice model first" : undefined}
        >
          <span className="studio-livevc-record-dot" />
          {isRecording ? "Recording…" : status === "processing" ? "Converting…" : "Record Live"}
        </button>
        <button className="studio-btn ghost" disabled={!isRecording} onClick={stop}>
          Stop
        </button>
        <button className="studio-btn ghost" disabled={!isBusy} onClick={cancel}>
          Cancel
        </button>
      </div>

      <div className="studio-livevc-status">
        <span className={`studio-livevc-status-pill ${status}`}>{statusLabel}</span>
        {isBusy && (
          <span
            className="studio-subtext"
            title={`~${estimatedLatencyMs.toFixed(0)} ms from your voice to what you hear back: ${latencyMs.toFixed(
              0
            )} ms GPU compute + buffering/lookahead the pipeline needs before it can output anything.`}
          >
            ~{estimatedLatencyMs.toFixed(0)} ms latency
          </span>
        )}
        {isBusy && stageTimings && (
          <span
            className="studio-subtext"
            title="How much of each block's processing time went to pitch detection, voice embedding, and the vocoder — whichever is largest is the actual bottleneck to fix first."
          >
            F0 {stageTimings.f0Ms?.toFixed(0)} · Embed {stageTimings.embedMs?.toFixed(0)} · Vocoder {stageTimings.vocoderMs?.toFixed(0)} ms
          </span>
        )}
        {isBusy && droppedChunks > 0 && (
          <span
            className="studio-livevc-glitch"
            title="Audio blocks skipped to keep up in real time — the GPU is falling behind. Try a faster pitch-detection method or a smaller frame size."
          >
            ⚠ {droppedChunks} glitch{droppedChunks === 1 ? "" : "es"}
          </span>
        )}
        {status === "processing" && (
          <div className="studio-progress">
            <div className="studio-progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>

      {error && <div className="studio-livevc-error">{error}</div>}
    </div>
  );
};

export default LiveInferencePanel;
