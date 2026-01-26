import React, { useEffect } from "react";
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

function DownloadResults({ jobStatus, handleReset, volume = 1 }) {
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

  const {
    raw_vocals = [],
    processed_vocals = [],
    exports = [],
  } = jobStatus.output_files;

  // Get all instrumentals (matching pattern from vocals)
  const instrumentals = raw_vocals
    .filter((file) => file.includes("_vocals"))
    .map((file) => file.replace("_vocals", "_instrumental"));

  // Determine which vocals to show based on mode
  const vocalsToShow =
    vocalMode === "processed" ? processed_vocals : raw_vocals;

  // Calculate pairs of instrumentals and vocals
  const trackPairs = [];
  const maxLength = Math.max(instrumentals.length, vocalsToShow.length);

  for (let i = 0; i < maxLength; i++) {
    trackPairs.push({
      instrumental: instrumentals[i] || null,
      vocal: vocalsToShow[i] || null,
    });
  }

  const handleVocalModeChangeWithCleanup = (event, newMode) => {
    if (newMode !== null) {
      stopAllAudio();
      handleVocalModeChange(event, newMode);
    }
  };

  const handleDownload = async (fileType, filename) => {
    if (!filename) return;
    const actualFileType = filename.includes("instrumental")
      ? "instrumental"
      : fileType;
    await downloadFile(actualFileType, filename, vocalMode);
  };

  const handleDownloadDataset = () => {
    if (exports.length > 0) {
      handleDownload("exports", exports[0]);
    }
  };

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
            volume={volume}
            showDatasetButton={true}
            handleDownloadDataset={handleDownloadDataset}
            hasExports={exports.length > 0}
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
