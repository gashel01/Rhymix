import { useState, useRef, useCallback, useEffect } from 'react';
import { useMemo } from 'react';
import { safePlay, safePause } from "../AudioTrackTable/utils";
/**
 * Hook to manage audio playback state (InferenceView-style: instrumental + raw vocals + processed vocals).
 * @returns {Object} - Playback state and handlers
 */
export const useAudioPlayback = ({inferenceResults, setLoading, setError, setInferenceResults}) => {
    const resultsRef = useRef([]);
    const [vocalMode, setVocalMode] = useState("converted");

    const [playingFile, setPlayingFile] = useState(null);

    const [instrumentalWaveforms, setInstrumentalWaveforms] = useState({});
    const [convertedWaveforms, setConvertedWaveforms] = useState({});
    const [originalWaveforms, setOriginalWaveforms] = useState({});


    const handlePlayPause = useCallback((trackId, type) => {
        const key = `${trackId}-${type}`;

        if (playingFile?.id === key) {
            safePause(playingFile.waveform);
            setPlayingFile(null);
            return;
        }

        if (playingFile) safePause(playingFile.waveform);

        let waveformToPlay = null;
        let url = null;

        const result = resultsRef.current.find((r) => r.id === trackId);

        if (type === "converted") {
            if (result?.outputFile) {
                waveformToPlay = convertedWaveforms[result.outputFile];
                url = `/api/download/inference/${result.outputFile}`;
            }
        } else if (type === "original") {
            if (result?.outputFile) {
                waveformToPlay = originalWaveforms[result.outputFile];
                url = `/api/download/${result.params?.vocalsFileType || "processed_vocals"}/${result.outputFile
                    .split("_")
                    .slice(1)
                    .join("_")
                    .split("-")[1]}`;
            }
        }

        if (waveformToPlay && url) {
            safePlay(waveformToPlay, url);
            setPlayingFile({ id: key, waveform: waveformToPlay });
        }
    }, [playingFile, convertedWaveforms, originalWaveforms, resultsRef]);

   


    const stopAllAudio = useCallback(() => {
        if (playingFile) {
            safePause(playingFile.waveform);
            setPlayingFile(null);
        }
        Object.values(instrumentalWaveforms).forEach((w) => safePause(w));
        Object.values(convertedWaveforms).forEach((w) => safePause(w));
        Object.values(originalWaveforms).forEach((w) => safePause(w));
    }, [convertedWaveforms, instrumentalWaveforms, originalWaveforms, playingFile]);

    const handleConvertedWaveformReady = useCallback((trackPath, waveform) => {
        setConvertedWaveforms((prev) => ({ ...prev, [trackPath]: waveform }));
    }, []);

    const handleOriginalWaveformReady = useCallback((trackPath, waveform) => {
        setOriginalWaveforms((prev) => ({ ...prev, [trackPath]: waveform }));
    }, []);


    const handleVocalModeChange = useCallback((event, newMode) => {
        // AudioTrackTable may pass (event, value)
        if (!newMode) return;
        setVocalMode(newMode);
      }, []);
    
      const handleDownload = useCallback(async (result) => {
        try {
          const response = await fetch(`/api/download/inference/${result.outputFile}`);
          if (!response.ok) throw new Error("Failed to download file");
    
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = result.outputFile.split("/").pop();
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        } catch (e) {
          if (e.name !== "AbortError") console.error("Error downloading file:", e);
        }
      }, []);
    
      const handleDownloadFullSong = useCallback(async (instrumental, vocal) => {
        try {
          const response = await fetch(`/api/download/inference/${instrumental}`);
          if (!response.ok) throw new Error("Failed to download file");
    
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = instrumental.split("/").pop();
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        } catch (e) {
          if (e.name !== "AbortError") console.error("Error downloading full song:", e);
        }
      }, []);


      const pastInferenceTrackPairs = useMemo(
        () =>
          inferenceResults.map((result) => ({
            instrumental: result.outputFile, // same file (result)
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
          })),
        [inferenceResults, vocalMode]
      );

   
      useEffect(() => {
        resultsRef.current = inferenceResults;
      }, [inferenceResults]);
    
      const hasFetchedRef = useRef(false);
      useEffect(() => {
        // Only fetch once, even if component re-renders
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
        pastInferenceTrackPairs,
  
    fetchInferenceResults,
  
    handleVocalModeChange,
    handleDownload,
    handleDownloadFullSong,
    handleConvertedWaveformReady,
    handleOriginalWaveformReady,
    instrumentalWaveforms,
    convertedWaveforms,
    originalWaveforms,
    

    vocalMode,
    handlePlayPause,
    playingFile,
    stopAllAudio,
    };
};
