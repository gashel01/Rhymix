import React, { useState, useCallback, memo, useEffect, useRef, useMemo } from "react";
import { useVolume } from "../contexts/VolumeContext";
import AudioFileIcon from "@mui/icons-material/AudioFile";
import PsychologyIcon from "@mui/icons-material/Psychology";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import DeleteIcon from "@mui/icons-material/Delete";
import AudioTrackTable from "./AudioTrackTable/AudioTrackTable";
import DeleteDialog from "./AudioTrackTable/InferenceResult/DeleteDialog";
import ErrorBoundary from "./ErrorBoundary";
import { useAudioPlayback } from "./InferenceView/useAudioPlayback";
import { useTableActions } from "./InferenceView/useTableActions";
import { Spinner } from './Homeview/Spinner.js';
import { Alert } from './Homeview/Alert.js';
import { Theme } from './Homeview/Theme.js';
import Panel from './Homeview/Panel.js';
import Btn from './Homeview/Btn.js';
import IconBtn from './Homeview/IconBtn.js';
import { deleteInferenceRuns } from "../utils/apiService";

function InferenceView({ onNavigate, darkMode, liveInferenceData, onSelectionToParams, onSelectionToModelSelection, onCoverWithTracks }) {
  const { volumeRef } = useVolume();
  const t = Theme({ darkMode }).t;

  const [serverRuns, setServerRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [optimisticRuns, setOptimisticRuns] = useState([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [reactionPendingByRunId, setReactionPendingByRunId] = useState({});
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteState, setDeleteState] = useState({ loading: false, result: null });
  const pollingJobsRef = useRef(null);
  const liveStartedRef = useRef(false);
  const [pollingCount, setPollingCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [groupVocalModeByKey, setGroupVocalModeByKey] = useState({});

  const {
    trackPairs,
    fetchInferenceResults,
    handleDownload,
  } = useAudioPlayback({
    inferenceResults: serverRuns,
    setLoading,
    setError,
    setInferenceResults: setServerRuns,
    liveResults: optimisticRuns,
  });

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

  const filteredTrackPairs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return trackPairs;
    return trackPairs.filter((pair) => {
      const fields = [
        pair?.displayName,
        pair?.name,
        pair?.originalName,
        pair?.modelName,
        pair?.paramsSummary,
      ];
      return fields.some((field) => String(field || "").toLowerCase().includes(query));
    });
  }, [searchQuery, trackPairs]);

  const {
    handleRowSelect,
    handleSelectAllRows,
    handleDeselectAllRows,
    selectedRows,
  } = useTableActions({ inferenceResults: serverRuns, trackPairs: filteredTrackPairs });

  const selectedPairs = useMemo(() => {
    if (!selectedRows.length) return [];
    return trackPairs.filter((pair) => selectedRows.includes(pair.id));
  }, [selectedRows, trackPairs]);

  const selectedRunIds = useMemo(() => {
    if (!selectedRows.length) return [];
    const byId = new Map(trackPairs.map((pair) => [pair.id, pair]));
    const runIds = [];
    selectedRows.forEach((id) => {
      const pair = byId.get(id);
      const runId = pair?.runId || pair?.result?.runId || pair?.result?.id || null;
      if (runId) runIds.push(runId);
    });
    return [...new Set(runIds)];
  }, [selectedRows, trackPairs]);

  const handleGroupVocalModeChange = useCallback((groupKey, nextSource) => {
    if (!groupKey || !nextSource) return;
    setGroupVocalModeByKey((prev) => ({ ...prev, [groupKey]: nextSource }));
  }, []);

  useEffect(() => {
    const validKeys = new Set(trackPairs.map((pair) => pair?.groupKey || pair?.runId || pair?.id).filter(Boolean));
    setGroupVocalModeByKey((prev) => {
      const next = {};
      let changed = false;
      Object.entries(prev).forEach(([key, value]) => {
        if (validKeys.has(key)) next[key] = value;
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [trackPairs]);

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

  const pairToTrack = useCallback((pair) => {
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
  }, []);

  const selectedTracks = useMemo(() => {
    return selectedPairs.map(pairToTrack).filter(Boolean);
  }, [pairToTrack, selectedPairs]);

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

  const handleReturnToInferenceParams = useCallback((sourcePair = null) => {
    if (!onSelectionToParams) return;
    const navigationPairs = sourcePair ? [sourcePair] : selectedPairs;
    if (!navigationPairs.length) return;
    const navigationTracks = navigationPairs.map(pairToTrack).filter(Boolean);
    if (!navigationTracks.length) return;

    const modelCandidate = sourcePair
      ? {
        modelId: sourcePair?.modelId || null,
        modelName: sourcePair?.modelName || null,
      }
      : selectionModel;

    if (!modelCandidate && !sourcePair) return;

    const latestPair = navigationPairs.reduce((latest, pair) => {
      if (!latest) return pair;
      return getPairTimestamp(pair) >= getPairTimestamp(latest) ? pair : latest;
    }, null);
    const checkpointCandidate = getPairCheckpoint(latestPair);
    const modelPayload = {
      id: modelCandidate?.modelId || null,
      name: modelCandidate?.modelName || null,
      modelId: modelCandidate?.modelId || null,
      modelName: modelCandidate?.modelName || null,
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
      selectedTracks: navigationTracks,
      selectedModel: modelPayload,
    });
  }, [
    getPairCheckpoint,
    getPairTimestamp,
    normalizeModelCheckpoint,
    onSelectionToParams,
    pairToTrack,
    selectedPairs,
    selectionModel,
  ]);

  const showSelectionButton = Boolean(selectionModel);

  const hasAnyRows = trackPairs.length > 0;
  const hasRows = filteredTrackPairs.length > 0;
  const showSpinner = loading && !hasAnyRows;

  const handleOpenDelete = useCallback(() => {
    if (!selectedRows.length) return;
    if (!selectedRunIds.length) {
      setError("No deletable inference results selected.");
      return;
    }
    setDeleteDialogOpen(true);
  }, [selectedRows.length, selectedRunIds.length, setError]);

  const handleClearDeleteResult = useCallback(() => {
    setDeleteState((prev) => ({ ...prev, result: null }));
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!selectedRunIds.length) {
      setDeleteDialogOpen(false);
      return;
    }
    setDeleteState({ loading: true, result: null });
    try {
      const res = await deleteInferenceRuns(selectedRunIds);
      const runIdSet = new Set(selectedRunIds);
      setServerRuns((prev) => prev.filter((run) => !runIdSet.has(run.runId || run.id)));
      setOptimisticRuns((prev) => prev.filter((run) => !runIdSet.has(run.runId || run.id)));
      setDeleteState({ loading: false, result: res });
      setDeleteDialogOpen(false);
      handleDeselectAllRows();
      fetchInferenceResults();
    } catch (err) {
      setDeleteState({
        loading: false,
        result: { error: err?.message || "Failed to delete inference results" },
      });
    }
  }, [fetchInferenceResults, handleDeselectAllRows, selectedRunIds, setOptimisticRuns, setServerRuns]);

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

        {!hasAnyRows ? (
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
        ) : !hasRows ? (
          <Panel style={{ padding: 28 }} t={t}>
            <div style={{ textAlign: "center", padding: "18px 0" }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: t.text }}>No Matching Inference Results</div>
              <div style={{ marginTop: 8, fontSize: 13, fontWeight: 650, color: t.subtext }}>
                No result matches “{searchQuery.trim()}”.
              </div>
            </div>
          </Panel>
        ) : (
          <ErrorBoundary>
            <AudioTrackTable
              darkMode={darkMode}
              trackPairs={filteredTrackPairs}
              vocalModeType="inference"
              vocalMode="converted"
              handleDownload={handleDownload}
              showVocalToggle={false}
              enablePerFileVocalToggle
              vocalsFileType="inference"
              showDatasetButton={false}
              showInferenceButton={false}
              showInferenceResultsActions={true}
              showHeaderWorkflowActions={false}
              hideActionBar
              handleCoverWithTracks={onCoverWithTracks}
              onReturnToModelSelection={handleReturnToModelSelection}
              onReturnToInferenceParams={showSelectionButton ? handleReturnToInferenceParams : null}
              onRowInferenceParams={handleReturnToInferenceParams}
              externalSelectedRows={selectedRows} // important
              onRowSelect={handleRowSelect} // important
              onSelectAll={handleSelectAllRows} // important
              onDeselectAll={handleDeselectAllRows} // important
              onDeleteSelected={handleOpenDelete}
              externalDeleteResult={deleteState.result}
              onClearDeleteResult={handleClearDeleteResult}
              enableGrouping
              onSetReaction={handleSetReaction}
              reactionPendingByRunId={reactionPendingByRunId}
              defaultLabel=" "
              vocalModeByGroupKey={groupVocalModeByKey}
              onGroupVocalModeChange={handleGroupVocalModeChange}
              volume={volumeRef.current}
              header={<div style={{ padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>


                  <div style={{ flex: "1 1 340px", minWidth: 240 }}>
                    <div style={{
                      fontSize: "28px",
                      fontWeight: 900,
                      letterSpacing: "-0.02em",
                      margin: "0px",
                      textTransform: "uppercase", color: t.text, lineHeight: 1.1
                    }}>
                      Past Inference Results
                    </div>

                  </div>

                  <div style={{ width: "100%", marginTop: 12 }}>
                    <div
                      style={{
                        padding: 8,
                        borderRadius: 16,
                        border: `1px solid ${t.hairline}`,
                        background: t.isDark ? "rgba(28,28,33,0.8)" : "rgba(255,255,255,0.9)",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
                          <div style={{ position: "relative", flex: "1 1 280px", minWidth: 0 }}>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "10px 12px",
                                borderRadius: 12,
                                border: `1px solid ${isSearchFocused ? (t.isDark ? "rgba(255,255,255,0.2)" : t.primaryWash) : t.hairline}`,
                                background: isSearchFocused ? (t.isDark ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.04)") : (t.isDark ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.03)"),
                                transition: "border-color 180ms, background 180ms",
                              }}
                            >
                              <SearchIcon style={{ fontSize: 18, color: t.subtext }} />
                              <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onFocus={() => setIsSearchFocused(true)}
                                onBlur={() => setTimeout(() => setIsSearchFocused(false), 180)}
                                placeholder="Search your library or the community..."
                                style={{
                                  flex: 1,
                                  background: "transparent",
                                  border: "none",
                                  outline: "none",
                                  color: t.text,
                                  fontSize: 14,
                                  fontWeight: 600,
                                  minWidth: 0,
                                }}
                              />
                              {searchQuery && (
                                <button
                                  type="button"
                                  onClick={() => setSearchQuery("")}
                                  onMouseDown={(e) => e.preventDefault()}
                                  style={{ padding: 4, border: "none", background: "transparent", cursor: "pointer", color: t.subtext, display: "flex" }}
                                >
                                  <CloseIcon style={{ fontSize: 16 }} />
                                </button>
                              )}
                            </div>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <Btn t={t} variant="outline" onClick={handleSelectAllRows} style={{ height: 40, padding: "0 16px", fontSize: 12, fontWeight: 700 }}>
                              Select All
                            </Btn>
                            <div style={{ maxWidth: selectedRows.length > 0 ? 120 : 0, opacity: selectedRows.length > 0 ? 1 : 0, overflow: "hidden", transition: "all 180ms ease" }}>
                              <Btn t={t} variant="outline" onClick={handleDeselectAllRows} style={{ height: 40, padding: "0 14px" }}>
                                Clear
                              </Btn>
                            </div>
                            <div style={{ width: 1, height: 20, background: t.hairline }} />
                            <div style={{ position: "relative" }}>
                              <IconBtn
                                t={t}
                                title="Delete selected"
                                onClick={handleOpenDelete}
                                disabled={selectedRows.length === 0}
                                style={{
                                  borderColor: selectedRows.length > 0 ? "rgba(255,59,48,0.45)" : t.hairline,
                                  background:
                                    selectedRows.length > 0
                                      ? "linear-gradient(180deg, rgba(255,59,48,0.95), rgba(255,59,48,0.78))"
                                      : `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
                                  color: selectedRows.length > 0 ? "white" : t.subtext,
                                }}
                              >
                                <DeleteIcon style={{ fontSize: 20 }} />
                              </IconBtn>

                              {selectedRows.length > 0 && (
                                <div
                                  style={{
                                    position: "absolute",
                                    top: -6,
                                    right: -6,
                                    width: 22,
                                    height: 22,
                                    borderRadius: 999,
                                    background: "red",
                                    color: "white",
                                    display: "grid",
                                    placeItems: "center",
                                    fontSize: 12,
                                    fontWeight: 950,
                                    border: `2px solid ${t.isDark ? "rgba(18,18,20,0.8)" : "rgba(255,255,255,0.85)"}`,
                                    boxShadow: t.shadowSoft,
                                  }}
                                >
                                  {selectedRows.length}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
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

      <DeleteDialog
        deleteDialogOpen={deleteDialogOpen}
        setDeleteDialogOpen={setDeleteDialogOpen}
        selectedRows={selectedRows}
        isDeleting={deleteState.loading}
        confirmDelete={confirmDelete}
      />

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
