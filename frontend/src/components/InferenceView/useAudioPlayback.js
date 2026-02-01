import { useState, useRef, useCallback, useEffect } from 'react';
import { useMemo } from 'react';

const basename = (p) => {
  if (!p) return "";
  return p.split("/").pop()?.split("\\").pop() || "";
};

const getTrackName = (track) => {
  const inst = track?.instrumental;
  const voc = track?.vocal;
  const instName = inst ? basename(inst) : "";
  const vocName = voc ? basename(voc) : "";
  const cleanedInst = instName.replace("_instrumental.wav", "").replace("_instrumental", "");
  const cleanedVoc = vocName.replace("_vocals.wav", "").replace("_vocals", "");
  return cleanedInst || cleanedVoc || instName || vocName || "Unknown";
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

  const handleDownload = useCallback(async (type, path) => {
    try {
      if (!path) return;
      const param = encodeURIComponent(basename(path) || path);
      const response = await fetch(`/api/download/${type}/${param}`);
      if (!response.ok) throw new Error("Failed to download file");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = basename(path) || "download.wav";
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
        instrumental: result.outputFile,
        vocal: result.outputFile,
        name: result.trackName?.split("_instrumental")[0] || "Unknown Track",
        modelName: result.modelName,
        instrumentalUrl: `/api/download/instrumental/${result.outputFile.split("_").slice(1).join("_").split("-")[0]}`,
        originalVocalUrl: `/api/download/${result.params?.vocalsFileType || "processed_vocals"}/${result.outputFile
          .split("_")
          .slice(1)
          .join("_")
          .split("-")[1]}`,
        vocalUrl:
          vocalMode === "converted"
            ? `/api/download/inference/${result.outputFile}`
            : `/api/download/${result.params?.vocalsFileType || "raw_vocals"}/${result.outputFile
              .split("-")
              .slice(1)
              .join("_")
              .split("_inferred")[0]}`,
        status: "completed",
        id: result.id,
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
        const instrumental = r.track.instrumental;
        const instrumentalUrl = r.track.instrumentalUrl || `/api/download/instrumental/${basename(instrumental)}`;
        const originalVocalFile = basename(r.track.vocal);
        const originalVocalUrl = r.track.vocalUrl || `/api/download/${vocalsFileType}/${originalVocalFile}`;
        const outputFileName = r.outputFile ? basename(r.outputFile) : null;
        const convertedVocalUrl = outputFileName
          ? `/api/download/inference/${encodeURIComponent(outputFileName)}`
          : null;
        const isOriginal = vocalMode === "original";
        return {
          id: r.jobId,
          name: getTrackName(r.track),
          instrumental,
          instrumentalUrl,
          vocal: isOriginal ? originalVocalFile : outputFileName || originalVocalFile,
          vocalUrl: isOriginal ? originalVocalUrl : convertedVocalUrl || originalVocalUrl,
          status: r.status || "processing",
          result: r,
          isNew: true,
          paramsSummary,
          modelName,
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
