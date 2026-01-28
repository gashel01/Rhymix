import React, { useCallback, useEffect, useMemo } from "react";
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
import { downloadFile } from "../utils/audioUtils";

function DownloadResults({ jobStatus, handleReset, volume }) {
  const {
    vocalMode,
    handleVocalModeChange,
    vocalsFileType,
  } = useVocalMode("processed");

  const {
    playingFile,
    playingBoth,
    instrumentalWaveforms,
    vocalWaveforms,
    handlePlayPause,
    handlePlayBoth,
    handleInstrumentalWaveformReady,
    handleVocalWaveformReady,
    stopAllAudio,
  } = useAudioPlayback();

  useEffect(() => {
    if (jobStatus && jobStatus.output_files) {
      const { raw_vocals = [], processed_vocals = [] } = jobStatus.output_files;
      console.log("Raw vocals:", raw_vocals);
      console.log("Processed vocals:", processed_vocals);
      console.log("Current mode:", vocalMode);
    }
  }, [jobStatus, vocalMode]);

  if (!jobStatus || !jobStatus.output_files) {
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

  // Calculate elapsed time for the entire process
  const totalTime = Math.floor(jobStatus.completed_at - jobStatus.started_at);
  const minutes = Math.floor(totalTime / 60);
  const seconds = totalTime % 60;

  const { raw_vocals = [], processed_vocals = [], exports = [] } = jobStatus.output_files;

  const instrumentals = useMemo(
    () =>
      raw_vocals
        .filter((file) => file.includes("_vocals"))
        .map((file) => file.replace("_vocals", "_instrumental")),
    [raw_vocals]
  );

  const vocalsToShow = useMemo(
    () => (vocalMode === "processed" ? processed_vocals : raw_vocals),
    [processed_vocals, raw_vocals, vocalMode]
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
    if (exports.length > 0) {
      handleDownload("exports", exports[0]);
    }
  }, [exports, handleDownload]);

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
            hasExports={exports.length > 0}
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
