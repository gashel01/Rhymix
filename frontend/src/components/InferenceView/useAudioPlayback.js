import { useState, useRef, useCallback, useEffect } from 'react';
import { useMemo } from 'react';

const basename = (p) => {
  if (!p) return "";
  return p.split("/").pop()?.split("\\").pop() || "";
};

const getTrackName = (track) => {
  return track?.displayName || track?.name || "Unknown";
};

export const formatParamsSummary = (params) => {
  if (!params) return "";
  const p = params.pitch ?? 0;
  const f0 = (params.f0Method || "").toUpperCase();
  const rate = Math.round((params.indexRate ?? 0) * 100);
  return `Pitch ${p > 0 ? "+" : ""}${p}, F0 ${f0}, ${rate}%`;
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
  liveInferenceData = null,
}) => {
  const resultsRef = useRef([]);
  const [vocalMode, setVocalMode] = useState("converted");

  const handleVocalModeChange = useCallback((event, newMode) => {
    if (!newMode) return;
    setVocalMode(newMode);
  }, []);

  const handleDownload = useCallback(async (type, path, displayName) => {
    try {
      if (!path) return;
      const param = encodeURIComponent(path);
      const response = await fetch(`/api/download/${type}/${param}`);
      if (!response.ok) throw new Error("Failed to download file");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const fallbackName = basename(path) || "download.wav";
      a.download = displayName ? `${displayName}.wav` : fallbackName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (e) {
      if (e.name !== "AbortError") console.error("Error downloading file:", e);
    }
  }, []);

  const pastInferenceTrackPairs = useMemo(
    () =>
      inferenceResults.map((result) => ({
        id: result.runId,
        fileId: result.inputFileId,
        displayName: result.inputDisplayName || result.inputOriginalName || "Unknown Track",
        name: result.inputDisplayName || result.inputOriginalName || "Unknown Track",
        modelName: result.modelName,
        instrumental: result.inputFileId,
        vocal: result.inputFileId,
        instrumentalKey: `${result.runId}-instrumental`,
        vocalKey: `${result.runId}-vocal`,
        instrumentalUrl: result.inputFileId ? `/api/download/instrumental/${result.inputFileId}` : null,
        originalVocalUrl: result.inputFileId
          ? `/api/download/${result.vocalFileType || "processed_vocals"}/${result.inputFileId}`
          : null,
        vocalUrl:
          vocalMode === "converted"
            ? result.outputUrl
            : result.inputFileId
              ? `/api/download/${result.vocalFileType || "raw_vocals"}/${result.inputFileId}`
              : null,
        status: "completed",
        result,
        isNew: false,
        paramsSummary: result.params && Object.keys(result.params).length ? formatParamsSummary(result.params) : "",
      })),
    [inferenceResults, vocalMode]
  );

  const liveTrackPairs = useMemo(() => {
    if (!liveResults.length || !liveInferenceData) return [];
    const params = liveInferenceData.params || {};
    const paramsSummary = formatParamsSummary(params);
    const modelName = liveInferenceData.model?.name || "Unknown";
    const vocalsFileType = params.vocalsFileType || "processed_vocals";
    return liveResults
      .filter((r) => r?.track?.instrumental)
      .map((r) => {
        const fileId = r.track.fileId || r.track.id;
        const instrumentalUrl = r.track.instrumentalUrl || (fileId ? `/api/download/instrumental/${fileId}` : null);
        const originalVocalUrl = r.track.vocalUrl || (fileId ? `/api/download/${vocalsFileType}/${fileId}` : null);
        const convertedVocalUrl = r.outputUrl || (r.runId ? `/api/download/inference/${encodeURIComponent(r.runId)}` : null);
        const isOriginal = vocalMode === "original";
        return {
          id: r.runId || r.jobId,
          fileId,
          displayName: getTrackName(r.track),
          name: getTrackName(r.track),
          instrumental: fileId,
          instrumentalUrl,
          vocal: fileId,
          vocalUrl: isOriginal ? originalVocalUrl : convertedVocalUrl || originalVocalUrl,
          status: r.status || "processing",
          result: r,
          isNew: true,
          paramsSummary,
          modelName,
          instrumentalKey: `${r.runId || r.jobId}-instrumental`,
          vocalKey: `${r.runId || r.jobId}-vocal`,
        };
      });
  }, [liveResults, liveInferenceData, vocalMode]);

  const trackPairs = useMemo(
    () => [...liveTrackPairs, ...pastInferenceTrackPairs],
    [liveTrackPairs, pastInferenceTrackPairs]
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
    pastInferenceTrackPairs,
    handleVocalModeChange,
    handleDownload,
    fetchInferenceResults,
  };
};
