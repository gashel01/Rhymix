import { useState, useRef, useCallback, useEffect, useMemo } from 'react';

import { downloadFile } from "../../utils/audioUtils";

export const formatParamsSummary = (params) => {
  if (!params) return "";
  const parts = [];
  const p = params.pitch ?? params.transpose;
  if (typeof p === "number") {
    parts.push(`Pitch ${p > 0 ? "+" : ""}${p}`);
  }
  const f0 = params.f0Method ? String(params.f0Method).toUpperCase() : null;
  if (f0) parts.push(`F0 ${f0}`);
  const rateRaw = params.indexRate ?? params.index_rate;
  if (typeof rateRaw === "number") parts.push(`${Math.round(rateRaw * 100)}%`);
  if (typeof params.seed === "number") parts.push(`Seed ${params.seed}`);
  if (typeof params.sid === "number") parts.push(`SID ${params.sid}`);
  return parts.join(", ");
};

const normalizeStatus = (status) => {
  if (!status) return "completed";
  return String(status).toLowerCase();
};

const isLoadingStatus = (status) => {
  const normalized = normalizeStatus(status);
  return !["completed", "failed", "done"].includes(normalized);
};

const getTrackName = (run) => {
  return (
    run?.inputDisplayName ||
    run?.inputOriginalName ||
    run?.track?.displayName ||
    run?.track?.name ||
    "Unknown Track"
  );
};

const getFileId = (run) => {
  return run?.inputFileId || run?.fileId || run?.track?.fileId || run?.track?.id || null;
};

const getRunId = (run) => {
  return run?.runId || run?.id || null;
};

const buildGroupKey = (run, fileId) => {
  const modelId = run?.modelId || run?.model?.id;
  const modelName = run?.modelName || run?.model?.name;
  if (modelId && fileId) return `${modelId}:${fileId}`;
  if (modelName && fileId) return `${modelName}:${fileId}`;
  return run?.runId || run?.id || fileId || "unknown";
};

const buildTrackPairFromRun = (run, vocalMode) => {
  const runId = getRunId(run);
  const tempId = run?.tempId || run?.jobId || null;
  const fileId = getFileId(run);
  const displayName = getTrackName(run);
  const originalName = run?.inputOriginalName || run?.track?.originalName || null;
  const modelName = run?.modelName || run?.model?.name || "Unknown";
  const vocalFileType =
    run?.vocalFileType ||
    run?.params?.vocalsFileType ||
    run?.track?.vocalFileType ||
    run?.track?.vocalsFileType ||
    "processed_vocals";

  const convertedUrl =
    run?.outputUrl || (runId ? `/api/download/inference/${encodeURIComponent(runId)}` : null);
  const originalVocalUrl = fileId ? `/api/download/${vocalFileType}/${fileId}` : null;
  const useConverted = vocalMode === "converted";
  const vocalUrl = useConverted ? convertedUrl || originalVocalUrl : originalVocalUrl || convertedUrl;
  const vocalPath = useConverted ? (runId || fileId) : fileId || runId;

  const displayId = runId || tempId || fileId || displayName;
  const createdAt = run?.createdAt || null;

  return {
    id: displayId,
    runId,
    fileId,
    displayName,
    originalName,
    name: displayName,
    modelName,
    modelId: run?.modelId || run?.model?.id,
    vocalFileType,
    instrumental: fileId,
    vocal: vocalPath,
    instrumentalKey: `${displayId}-instrumental`,
    vocalKey: `${displayId}-vocal`,
    instrumentalUrl: fileId ? `/api/download/instrumental/${fileId}` : null,
    originalVocalUrl,
    vocalUrl,
    status: normalizeStatus(run?.status || "completed"),
    result: run,
    isNew: !!run?.isNew,
    paramsSummary: run?.params && Object.keys(run.params).length ? formatParamsSummary(run.params) : "",
    params: run?.params || null,
    createdAt,
    groupKey: buildGroupKey(run, fileId),
    isFavorite: !!run?.isFavorite,
  };
};

/**
 * Hook to manage audio playback state (InferenceView-style: instrumental + raw vocals + processed vocals).
 * Merges past inference results with optional live job results (isNew + paramsSummary).
 */
export const useAudioPlayback = ({
  inferenceResults,
  setLoading,
  setError,
  setInferenceResults,
  liveResults = [], 
}) => {
  const resultsRef = useRef([]);
  const [vocalMode, setVocalMode] = useState("converted");

  const handleVocalModeChange = useCallback((event, newMode) => {
    if (!newMode) return;
    setVocalMode(newMode);
  }, []);

  const handleDownload = useCallback(async (type, path, downloadName) => {
    try {
      if (!path) return;
      await downloadFile(type, path, "processed", downloadName);
    } catch (e) {
      if (e.name !== "AbortError") console.error("Error downloading file:", e);
    }
  }, []);

  const mergedRuns = useMemo(() => {
    const serverRuns = Array.isArray(inferenceResults) ? inferenceResults : [];
    const optimisticRuns = Array.isArray(liveResults) ? liveResults : [];

    const serverByRunId = new Map(
      serverRuns
        .map((run) => ({ runId: getRunId(run), run }))
        .filter(({ runId }) => runId)
        .map(({ runId, run }) => [runId, run])
    );
    const merged = [];
    const seen = new Set();

    optimisticRuns.forEach((opt) => {
      const optRunId = getRunId(opt);
      if (optRunId && serverByRunId.has(optRunId)) {
        const server = serverByRunId.get(optRunId);
        const keepOptimistic = isLoadingStatus(opt?.status);
        const mergedRun = keepOptimistic
          ? { ...server, ...opt, status: opt.status, isNew: !!opt.isNew }
          : { ...opt, ...server, isNew: !!opt.isNew };
        merged.push(mergedRun);
        seen.add(optRunId);
        return;
      }
      merged.push(opt);
      if (optRunId) seen.add(optRunId);
    });

    serverRuns.forEach((run) => {
      const runId = getRunId(run);
      if (runId && seen.has(runId)) return;
      merged.push(run);
    });

    return merged.sort((a, b) => {
      const aTime = a?.createdAt ? Date.parse(a.createdAt) : 0;
      const bTime = b?.createdAt ? Date.parse(b.createdAt) : 0;
      return bTime - aTime;
    });
  }, [inferenceResults, liveResults]);

  const trackPairs = useMemo(
    () => mergedRuns.map((run) => buildTrackPairFromRun(run, vocalMode)),
    [mergedRuns, vocalMode]
  );

  useEffect(() => {
    resultsRef.current = inferenceResults;
  }, [inferenceResults]);

  const hasFetchedRef = useRef(false);
  useEffect(() => {
    if (!hasFetchedRef.current) {
      hasFetchedRef.current = true;
      fetchInferenceResults();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchInferenceResults = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/past-inference-results");
      if (!response.ok) throw new Error("Failed to fetch inference results");
      const data = await response.json();
      setInferenceResults(data.results || []);
    } catch (err) {
      console.error("Error fetching inference results:", err);
      setError(err.message || "Failed to fetch inference results");
    } finally {
      setLoading(false);
    }
  };

  return {
    trackPairs,
    handleVocalModeChange,
    handleDownload,
    vocalMode,
    fetchInferenceResults,
  };
};
