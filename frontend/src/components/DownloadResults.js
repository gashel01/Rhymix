import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Box,
  Typography,
  Grid,
  Button,
  Chip,
} from "@mui/material";
import ReplayIcon from "@mui/icons-material/Replay";
import AudioTrackTable from "./AudioTrackTable";
import ErrorBoundary from "./ErrorBoundary";
import { useAudioPlayback } from "../hooks/useAudioPlayback";
import { useVocalMode } from "../hooks/useVocalMode";
import { useVolume } from "../contexts/VolumeContext";
import { downloadFile } from "../utils/audioUtils";

function DownloadResults({ jobStatus, handleReset, volume: volumeProp }) {
  const { volumeRef } = useVolume();
  const volume = volumeProp !== undefined ? volumeProp : (volumeRef?.current ?? 1);
  const jobStatusRef = useRef(jobStatus);
  useEffect(() => {
    jobStatusRef.current = jobStatus;
  }, [jobStatus]);

  const outputFiles = jobStatus?.output_files;
  const raw_vocals = outputFiles?.raw_vocals ?? [];
  const processed_vocals = outputFiles?.processed_vocals ?? [];
  const exportsList = outputFiles?.exports ?? [];

  const {
    vocalMode,
    handleVocalModeChange,
    vocalsFileType,
  } = useVocalMode("processed");

  const {
    playingFile,
    playingBoth,
    instrumentalWaveforms,
    rawVocalWaveforms,
    processedVocalWaveforms,
    handlePlayPause,
    handlePlayBoth,
    handleInstrumentalWaveformReady,
    handleRawVocalWaveformReady,
    handleProcessedVocalWaveformReady,
    stopAllAudio,
  } = useAudioPlayback();

  const vocalWaveforms = vocalMode === "processed" ? processedVocalWaveforms : rawVocalWaveforms;
  const handleVocalWaveformReady = vocalMode === "processed" ? handleProcessedVocalWaveformReady : handleRawVocalWaveformReady;

  useEffect(() => {
    if (jobStatus?.output_files) {
      console.log("Raw vocals:", raw_vocals);
      console.log("Processed vocals:", processed_vocals);
      console.log("Current mode:", vocalMode);
    }
  }, [jobStatus, vocalMode, raw_vocals, processed_vocals]);

  const handleVocalModeChangeWithCleanup = useCallback(
    (event, newMode) => {
      if (newMode !== null) {
        stopAllAudio();
        handleVocalModeChange(event, newMode);
      }
    },
    [handleVocalModeChange, stopAllAudio]
  );

  const handleDownload = useCallback(
    async (fileType, filename) => {
      if (!filename) return;
      const actualFileType = filename.includes("instrumental")
        ? "instrumental"
        : fileType;
      await downloadFile(actualFileType, filename, vocalMode);
    },
    [vocalMode]
  );

  const handleDownloadDataset = useCallback(() => {
    const list = jobStatusRef.current?.output_files?.exports ?? [];
    if (list.length > 0) handleDownload("exports", list[0]);
  }, [handleDownload]);

  const rawKey = JSON.stringify(raw_vocals);
  const processedKey = JSON.stringify(processed_vocals);

  const instrumentals = useMemo(
    () =>
      (raw_vocals || [])
        .filter((file) => file.includes("_vocals"))
        .map((file) => file.replace("_vocals", "_instrumental")),
    [rawKey]
  );

  const vocalsToShow = useMemo(
    () => [...(vocalMode === "processed" ? processed_vocals : raw_vocals)],
    [processedKey, rawKey, vocalMode]
  );

  const trackPairs = useMemo(() => {
    const pairs = [];
    const maxLength = Math.max(instrumentals.length, vocalsToShow.length);
    for (let i = 0; i < maxLength; i += 1) {
      pairs.push({
        instrumental: instrumentals[i] || null,
        vocal: vocalsToShow[i] || null,
      });
    }
    return pairs;
  }, [instrumentals, vocalsToShow]);

  if (!jobStatus || !outputFiles) {
    return (
      <Box sx={{ textAlign: "center", py: 4 }}>
        <Typography variant="h6" gutterBottom>
          No results available
        </Typography>
        <Button
          variant="contained"
          color="primary"
          onClick={handleReset}
          startIcon={<ReplayIcon />}
        >
          Start New Process
        </Button>
      </Box>
    );
  }

  const totalTime = Math.floor(jobStatus.completed_at - jobStatus.started_at);
  const minutes = Math.floor(totalTime / 60);
  const seconds = totalTime % 60;



  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mt: 3,
          textAlign: "center",
        }}
      >
        <Typography variant="h5" gutterBottom>
          Processing Complete!
        </Typography>

        <Box sx={{ textAlign: "center" }}>
          <Chip
            label={`Completed in ${minutes}m ${seconds}s`}
            color="success"
            variant="outlined"
          />
        </Box>
      </Box>

      {/* Use the reusable AudioTrackTable component */}
      <Grid container spacing={2}>
        <Grid item xs={12}>
          <ErrorBoundary>
            <AudioTrackTable
              trackPairs={trackPairs}
              vocalMode={vocalMode}
              handleVocalModeChange={handleVocalModeChangeWithCleanup}
              handlePlayPause={handlePlayPause}
              handleDownload={handleDownload}
              handlePlayBoth={handlePlayBoth}
              handleInstrumentalWaveformReady={handleInstrumentalWaveformReady}
              handleVocalWaveformReady={handleVocalWaveformReady}
              playingFile={playingFile}
              playingBoth={playingBoth}
              instrumentalWaveforms={instrumentalWaveforms}
              vocalWaveforms={vocalWaveforms}
              showVocalToggle={true}
              enablePlayBoth={true}
              vocalsFileType={vocalsFileType}
              showDatasetButton={true}
              handleDownloadDataset={handleDownloadDataset}
              hasExports={exportsList.length > 0}
              volume={volume}
            />
          </ErrorBoundary>
        </Grid>
      </Grid>

      <Box sx={{ mt: 4, textAlign: "center" }}>
        <Button
          variant="contained"
          color="primary"
          onClick={handleReset}
          size="large"
          startIcon={<ReplayIcon />}
        >
          Process New Files
        </Button>
      </Box>
    </Box>
  );
}

export default DownloadResults;
