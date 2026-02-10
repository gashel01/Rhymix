import React, { useState, useCallback, memo, useEffect, useRef, useMemo } from "react";
import { useVolume } from "../contexts/VolumeContext";
import AudioFileIcon from "@mui/icons-material/AudioFile";
import PsychologyIcon from "@mui/icons-material/Psychology";
import AudioTrackTable from "./AudioTrackTable/AudioTrackTable";
import ErrorBoundary from "./ErrorBoundary";
import { useAudioPlayback } from "./InferenceView/useAudioPlayback";
import { useTableActions } from "./InferenceView/useTableActions";
import { Spinner } from './Homeview/Spinner.js';
import { Alert } from './Homeview/Alert.js';
import { Theme } from './Homeview/Theme.js';
import Panel from './Homeview/Panel.js';
import Btn from './Homeview/Btn.js';

function InferenceView({ onNavigate, darkMode, liveInferenceData, onSelectionToParams, onSelectionToModelSelection, onCoverWithTracks }) {
  const { volumeRef } = useVolume();
  const t = Theme({ darkMode }).t;

  const [serverRuns, setServerRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [optimisticRuns, setOptimisticRuns] = useState([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [reactionPendingByRunId, setReactionPendingByRunId] = useState({});
  const pollingJobsRef = useRef(null);
  const liveStartedRef = useRef(false);
  const [pollingCount, setPollingCount] = useState(0);

  const {
    trackPairs,
    fetchInferenceResults,
    handleVocalModeChange,
    handleDownload,
    vocalMode,
  } = useAudioPlayback({
    inferenceResults: serverRuns,
    setLoading,
    setError,
    setInferenceResults: setServerRuns,
    liveResults: optimisticRuns,
  });

  const {
    handleRowSelect,
    handleSelectAllRows,
    handleDeselectAllRows,
    selectedRows,
  } = useTableActions({ inferenceResults: serverRuns, trackPairs });

  const updateReactionLocal = useCallback((runId, reaction) => {
    if (!runId) return;
    setServerRuns((prev) =>
      prev.map((run) => (run.runId === runId ? { ...run, reaction } : run))
    );
    setOptimisticRuns((prev) =>
      prev.map((run) => (run.runId === runId ? { ...run, reaction } : run))
    );
  }, []);

  const handleSetReaction = useCallback(
    async (runId, nextReaction, previousReaction = "none") => {
      if (!runId) return;
      updateReactionLocal(runId, nextReaction);
      setReactionPendingByRunId((prev) => ({ ...prev, [runId]: true }));
      try {
        const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/reaction`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reaction: nextReaction }),
        });
        if (!response.ok) throw new Error("Failed to update reaction");
        const data = await response.json();
        updateReactionLocal(runId, data?.reaction ?? nextReaction);
      } catch (err) {
        updateReactionLocal(runId, previousReaction);
        setError(err?.message || "Failed to update reaction");
      } finally {
        setReactionPendingByRunId((prev) => {
          if (!prev[runId]) return prev;
          const next = { ...prev };
          delete next[runId];
          return next;
        });
      }
    },
    [updateReactionLocal]
  );

  // Start live inference when liveInferenceData is set
  useEffect(() => {
    if (!liveInferenceData?.tracks?.length || liveStartedRef.current) return;
    if (pollingJobsRef.current?.length) return;
    liveStartedRef.current = true;

    const startLiveInference = async () => {
      try {
        setLiveLoading(true);
        setError(null);
        const tracks = liveInferenceData.tracks;
        const startedAt = new Date().toISOString();
        const jobs = await Promise.all(
          tracks.map(async (track) => {
            const response = await fetch("/api/start-inference", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                model: liveInferenceData.model,
                track,
                params: liveInferenceData.params,
              }),
            });
            if (!response.ok) throw new Error(`Failed to start inference for track ${track?.id ?? "unknown"}`);
            const result = await response.json();
            const fileId = track?.fileId || track?.id || null;
            return {
              jobId: result.jobId,
              tempId: result.jobId,
              runId: result.runId,
              status: "processing",
              track,
              model: liveInferenceData.model,
              modelId: liveInferenceData.model?.id,
              modelName: liveInferenceData.model?.name,
              params: liveInferenceData.params || {},
              inputFileId: fileId,
              inputDisplayName: track?.displayName || track?.name || null,
              inputOriginalName: track?.originalName || null,
              vocalFileType: track?.vocalFileType || track?.vocalsFileType || liveInferenceData.params?.vocalsFileType,
              createdAt: startedAt,
              isNew: true,
              reaction: "none",
            };
          })
        );
        setOptimisticRuns(jobs);
        pollingJobsRef.current = jobs;
        setPollingCount(jobs.length);
      } catch (err) {
        console.error("Error starting inference:", err);
        setError(err?.message || "Failed to start inference");
        setLiveLoading(false);
      }
    };
    startLiveInference();
  }, [liveInferenceData]);

  // Poll for live inference status (runs when pollingCount > 0)
  useEffect(() => {
    const pollingJobs = pollingJobsRef.current;
    if (!pollingCount || !pollingJobs?.length) return;

    const abortController = new AbortController();
    const intervalId = setInterval(async () => {
      try {
        const updated = await Promise.all(
          pollingJobs.map(async (job) => {
            const response = await fetch(`/api/inference-status/${job.jobId}`, { signal: abortController.signal });
            if (!response.ok) return job;
            const data = await response.json();
            return {
              ...job,
              ...data,
              runId: data.runId || job.runId,
              status: data.status || job.status,
              outputUrl: data.outputUrl || job.outputUrl,
              track: data.track || job.track,
            };
          })
        );
        setOptimisticRuns((prev) => {
          const byId = new Map(prev.map((p) => [p.jobId, p]));
          return updated.map((n) => {
            const p = byId.get(n.jobId);
            if (!p) return n;
            const same = p.status === n.status && p.outputFile === n.outputFile && p.outputUrl === n.outputUrl;
            if (same) return p;
            return {
              ...p,
              ...n,
              runId: n.runId || p.runId,
              modelName: p.modelName || n.model_name || n.modelName,
              modelId: p.modelId || n.modelId,
            };
          });
        });
        const allDone = updated.every((j) => {
          const status = String(j.status || "").toLowerCase();
          return status === "completed" || status === "failed" || status === "done";
        });
        if (allDone) {
          clearInterval(intervalId);
          pollingJobsRef.current = null;
          setPollingCount(0);
          setLiveLoading(false);
          fetchInferenceResults();
        }
      } catch (e) {
        if (e?.name === "AbortError") return;
        console.error("Error polling inference status:", e);
      }
    }, 1000);
    return () => {
      abortController.abort();
      clearInterval(intervalId);
    };
  }, [pollingCount]);

  const selectedPairs = useMemo(() => {
    if (!selectedRows.length) return [];
    return trackPairs.filter((pair) => selectedRows.includes(pair.id));
  }, [selectedRows, trackPairs]);

  const uniqueModels = useMemo(() => {
    const models = new Map();
    selectedPairs.forEach((pair) => {
      const key = pair.modelId || pair.modelName;
      if (!key) return;
      if (!models.has(key)) {
        models.set(key, {
          modelId: pair.modelId || null,
          modelName: pair.modelName || null,
        });
      }
    });
    return models;
  }, [selectedPairs]);

  const selectionModel = useMemo(() => {
    if (uniqueModels.size !== 1) return null;
    return Array.from(uniqueModels.values())[0];
  }, [uniqueModels]);

  const selectedTracks = useMemo(() => {
    return selectedPairs
      .map((pair) => {
        if (pair?.result?.track) return pair.result.track;
        if (pair?.track) return pair.track;
        const fileId = pair?.fileId || null;
        if (!fileId) return null;
        return {
          fileId,
          id: fileId,
          displayName: pair?.displayName || pair?.name || null,
          originalName: pair?.originalName || null,
          vocalFileType: pair?.vocalFileType || pair?.result?.vocalFileType || pair?.result?.params?.vocalsFileType,
        };
      })
      .filter(Boolean);
  }, [selectedPairs]);

  const getPairTimestamp = useCallback((pair) => {
    const stamp = pair?.createdAt || pair?.result?.createdAt;
    if (!stamp) return 0;
    const parsed = Date.parse(stamp);
    return Number.isNaN(parsed) ? 0 : parsed;
  }, []);

  const getPairCheckpoint = useCallback((pair) => {
    return (
      pair?.modelCheckpoint ||
      pair?.result?.modelCheckpoint ||
      pair?.result?.model?.selectedCheckpoint ||
      pair?.result?.model?.modelCheckpoint ||
      null
    );
  }, []);

  const normalizeModelCheckpoint = useCallback((checkpoint) => {
    if (!checkpoint) return null;
    const epochRaw = checkpoint.epoch ?? checkpoint.epochs;
    const epoch = typeof epochRaw === "number" ? epochRaw : Number(epochRaw);
    const pthFile = checkpoint.pthFile || checkpoint.filename || null;
    const checkpointId =
      checkpoint.checkpointId ||
      checkpoint.id ||
      (pthFile ? pthFile.replace(/\.[^/.]+$/, "") : null);
    const indexFile = checkpoint.indexFile || null;
    return {
      epoch: Number.isFinite(epoch) ? epoch : null,
      checkpointId,
      pthFile,
      indexFile,
    };
  }, []);

  const handleReturnToModelSelection = useCallback(() => {
    if (!onSelectionToModelSelection) {
      onNavigate?.("inference-model-selection");
      return;
    }
    onSelectionToModelSelection({
      source: "inference",
      selectedTracks,
    });
  }, [onNavigate, onSelectionToModelSelection, selectedTracks]);

  const handleReturnToInferenceParams = useCallback(() => {
    if (!selectionModel || !onSelectionToParams) return;
    const latestPair = selectedPairs.reduce((latest, pair) => {
      if (!latest) return pair;
      return getPairTimestamp(pair) >= getPairTimestamp(latest) ? pair : latest;
    }, null);
    const checkpointCandidate = getPairCheckpoint(latestPair);
    const modelPayload = {
      id: selectionModel.modelId || null,
      name: selectionModel.modelName || null,
      modelId: selectionModel.modelId || null,
      modelName: selectionModel.modelName || null,
    };
    if (checkpointCandidate) {
      if (checkpointCandidate.path) {
        modelPayload.selectedCheckpoint = checkpointCandidate;
      } else {
        modelPayload.modelCheckpoint = normalizeModelCheckpoint(checkpointCandidate);
      }
    }
    onSelectionToParams({
      source: "inference",
      selectedTracks,
      selectedModel: modelPayload,
    });
  }, [
    getPairCheckpoint,
    getPairTimestamp,
    normalizeModelCheckpoint,
    onSelectionToParams,
    selectedPairs,
    selectionModel,
    selectedTracks,
  ]);

  const showSelectionButton = Boolean(selectionModel);

  const hasRows = trackPairs.length > 0;
  const showSpinner = loading && !hasRows;

  if (showSpinner) {
    return (
      <div style={{ minHeight: "100vh", background: t.pageBg, padding: "18px 0 32px 0" }}>
        <div style={{ padding: "0 16px", maxWidth: t.maxW, margin: "0 auto" }}>
          <Panel style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 28 }} t={t}>
            <Spinner size={34} t={t} />
            <div style={{ marginTop: 12, fontSize: 14, fontWeight: 850, color: t.text }}>
              Loading inference results…
            </div>
            <div style={{ marginTop: 6, fontSize: 13, fontWeight: 650, color: t.subtext }}>
              This may take a few seconds.
            </div>
          </Panel>
        </div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  return (
  <>
      <div style={{ marginTop: 16 }}>
        {error && (
          <div style={{ marginBottom: 12 }}>
            <Alert kind="error" onClose={() => setError(null)} t={t}>
              {error}
            </Alert>
          </div>
        )}

        {!hasRows ? (
          <Panel style={{ padding: 28 }} t={t}>
            <div style={{ textAlign: "center", padding: "26px 0" }}>
              <div
                style={{
                  width: 84,
                  height: 84,
                  borderRadius: 999,
                  margin: "0 auto 14px auto",
                  display: "grid",
                  placeItems: "center",
                  border: `1px solid ${t.hairline}`,
                  background: t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.03)",
                }}
              >
                <AudioFileIcon style={{ fontSize: 40, opacity: 0.75, color: t.text }} />
              </div>

              <div style={{ fontSize: 18, fontWeight: 950, color: t.text }}>No Inference Results Yet</div>
              <div style={{ marginTop: 8, fontSize: 13, fontWeight: 650, color: t.subtext, maxWidth: 520, marginInline: "auto" }}>
                Run your first voice inference using the models from the Models page. Your inference results will appear here.
              </div>

              <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
                <Btn
                  variant="primary"
                  onClick={() => onNavigate?.("inference-model-selection")}
                  style={{ height: 44, padding: "0 16px" }}
                  t={t}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                    <PsychologyIcon style={{ fontSize: 18 }} />
                    Start Your First Inference
                  </span>
                </Btn>
              </div>
            </div>
          </Panel>
        ) : (
          <ErrorBoundary>
            <AudioTrackTable
              darkMode={darkMode}
              trackPairs={trackPairs}
              vocalModeType="inference"
              vocalMode={vocalMode}
              handleVocalModeChange={handleVocalModeChange}
              handleDownload={handleDownload}
              showVocalToggle={true}
              vocalsFileType="inference"
              showDatasetButton={false}
              showInferenceButton={false}
              showInferenceResultsActions={true}
              handleCoverWithTracks={onCoverWithTracks}
              onReturnToModelSelection={handleReturnToModelSelection}
              onReturnToInferenceParams={showSelectionButton ? handleReturnToInferenceParams : null}
              externalSelectedRows={selectedRows} // important
              onRowSelect={handleRowSelect} // important
              onSelectAll={handleSelectAllRows} // important
              onDeselectAll={handleDeselectAllRows} // important
              enableGrouping
              onSetReaction={handleSetReaction}
              reactionPendingByRunId={reactionPendingByRunId}
              defaultLabel=" "
              volume={volumeRef.current}
              header={<div style={{ padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 16,
                      display: "grid",
                      placeItems: "center",
                      border: `1px solid ${t.hairline}`,
                      background: t.isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)",
                      flexShrink: 0,
                    }}
                  >
                    <AudioFileIcon style={{ color: t.text }} />
                  </div>

                  <div style={{ flex: "1 1 340px", minWidth: 240 }}>
                    <div style={{ fontSize: 26, fontWeight: 950, letterSpacing: -0.6, color: t.text, lineHeight: 1.1 }}>
                      Past Inference Results
                    </div>
                    <div style={{ marginTop: 4, fontSize: 13, fontWeight: 650, color: t.subtext }}>
                      View, play, and download your previous voice inference results.
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <Btn
                      variant="outline"
                      onClick={fetchInferenceResults}
                      style={{ height: 40, padding: "0 14px" }}
                      title="Refresh"
                      t={t}
                    >
                      Refresh
                    </Btn>

                  </div>
                </div>
              </div>}
            />
          </ErrorBoundary>

        )}
      </div>

      <style>{`
          @keyframes spin{to{transform:rotate(360deg)}}
        `}</style>

</>
  );
}

// Memoize with custom comparison to ignore volume changes
// Volume is accessed via context ref, so it doesn't cause re-renders
export default memo(InferenceView, (prevProps, nextProps) => {
  return (
    prevProps.onNavigate === nextProps.onNavigate &&
    prevProps.darkMode === nextProps.darkMode &&
    prevProps.liveInferenceData === nextProps.liveInferenceData &&
    prevProps.onSelectionToParams === nextProps.onSelectionToParams &&
    prevProps.onSelectionToModelSelection === nextProps.onSelectionToModelSelection &&
    prevProps.onCoverWithTracks === nextProps.onCoverWithTracks
  );
});
