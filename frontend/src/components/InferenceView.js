import React, { useState, useEffect, useRef } from "react";
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Alert,
  IconButton,
  Chip,
  Tooltip,
  Grid,
} from "@mui/material";
import AudioFileIcon from "@mui/icons-material/AudioFile";
import PsychologyIcon from "@mui/icons-material/Psychology";
import { useTheme } from "@mui/material/styles";
import AudioTrackTable from "./AudioTrackTable/AudioTrackTable";
import { safePlay, safePause, safeSetMuted, getFileNameFromPath } from "./AudioTrackTable/utils";
import ErrorBoundary from "./ErrorBoundary";

function InferenceView({ onNavigate }) {
  const theme = useTheme();
  const [inferenceResults, setInferenceResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [selectedRows, setSelectedRows] = useState([]);
  const [vocalMode, setVocalMode] = useState('converted');

  // Audio playback state
  const [playingFile, setPlayingFile] = useState(null);
  const [internalPlayingBoth, setInternalPlayingBoth] = useState({});
  const [instrumentalWaveforms, setInstrumentalWaveforms] = useState({});
  const [convertedWaveforms, setConvertedWaveforms] = useState({});
  const [originalWaveforms, setOriginalWaveforms] = useState({});
  const [internalMutedInstrumentals, setInternalMutedInstrumentals] = useState({});
  const [internalMutedConverted, setInternalMutedConverted] = useState({});
  const [internalMutedOriginal, setInternalMutedOriginal] = useState({});

  useEffect(() => {
    fetchInferenceResults();
  }, []);

  const fetchInferenceResults = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/past-inference-results');
      if (!response.ok) {
        throw new Error('Failed to fetch inference results');
      }
        const data = await response.json();
      setInferenceResults(data.results || []);
    } catch (err) {
      console.error('Error fetching inference results:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Transform past inference results into trackPairs format for AudioTrackTable
  const getPastInferenceTrackPairs = () => {



    console.log("inference result !!!!!!!!!!!!!", inferenceResults);
    return inferenceResults.map((result) => ({
      instrumental: result.outputFile, // Use result file for both instrumental and vocal
      vocal: result.outputFile, // Same file - represents the final converted result
      name: result.trackName.split('_instrumental')[0] || 'Unknown Track',
      modelName: result.modelName,
      instrumentalUrl: `/api/download/instrumental/${result.outputFile.split('_').slice(1).join('_').split('-')[0]}`,
      originalVocalUrl: `/api/download/${result.params.vocalsFileType || 'processed_vocals'}/${result.outputFile.split('_').slice(1).join('_').split('-')[1]}`,
      vocalUrl: vocalMode === 'converted'
        ? `/api/download/inference/${result.outputFile}`
        : `/api/download/${result.params.vocalsFileType || 'raw_vocals'}/${result.outputFile.split('-').slice(1).join('_').split('_inferred')[0]}`,
      status: 'completed', // Past results are always completed
      id: result.id,
      result: result, // Keep reference to original result
    }));
  };

  const handleVocalModeChange = (event, newMode) => {
    setVocalMode(newMode);
  };

  const handleDownload = async (result) => {
    try {
      const response = await fetch(`/api/download/inference/${result.outputFile}`);
      if (!response.ok) {
        throw new Error('Failed to download file');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.outputFile.split('/').pop();
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      // Don't log AbortError as it's expected when component unmounts
      if (error.name !== 'AbortError') {
        console.error("Error downloading file:", error);
      }
      // Silently ignore AbortError - this is expected when navigating away
    }
  };

  const handleDownloadFullSong = async (instrumental, vocal) => {
    // For past results, both instrumental and vocal are the same file (the result)
    // So downloading the "full song" is the same as downloading the result
    try {
      const response = await fetch(`/api/download/inference/${instrumental}`);
      if (!response.ok) {
        throw new Error('Failed to download file');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = instrumental.split('/').pop();
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      // Don't log AbortError as it's expected when component unmounts
      if (error.name !== 'AbortError') {
        console.error("Error downloading full song:", error);
      }
      // Silently ignore AbortError - this is expected when navigating away
    }
  };

  // Audio playback functions
  const handlePlayPause = (trackId, type, track) => {
    const key = `${trackId}-${type}`;

    if (playingFile?.id === key) {
      // Pause current playback
      safePause(playingFile.waveform);
      setPlayingFile(null);
    } else {
      // Stop any currently playing file
      if (playingFile) {
        safePause(playingFile.waveform);
      }

      let waveformToPlay = null;
      let url = null;

      if (type === 'converted') {
        const result = inferenceResults.find(r => r.id === trackId);
        if (result && result.outputFile) {
          waveformToPlay = convertedWaveforms[result.outputFile];
          url = `/api/download/inference/${result.outputFile}`;
        }
      } else if (type === 'original') {
        const result = inferenceResults.find(r => r.id === trackId);
        if (result && result.outputFile) {
          waveformToPlay = originalWaveforms[result.outputFile];
          url = `/api/download/${result.params.vocalsFileType || 'processed_vocals'}/${result.outputFile.split('_').slice(1).join('_').split('-')[1]}`;
        }
      }

      if (waveformToPlay) {
        safePlay(waveformToPlay, url);
        setPlayingFile({ id: key, waveform: waveformToPlay });
      }
    }
  };

  const handlePlayBoth = (trackId, track) => {
    // For past results, we only have the converted vocal, so play both doesn't make sense
    // We could implement playing just the vocal, but for now, let's skip this
    console.log('Play both not available for past inference results');
  };

  const stopAllAudio = () => {
    // Stop currently playing file
    if (playingFile) {
      safePause(playingFile.waveform);
      setPlayingFile(null);
    }

    // Stop all waveforms
    Object.values(instrumentalWaveforms).forEach(waveform => safePause(waveform));
    Object.values(convertedWaveforms).forEach(waveform => safePause(waveform));
    Object.values(originalWaveforms).forEach(waveform => safePause(waveform));
  };

  // Waveform handling functions
  const handleConvertedWaveformReady = (trackPath, waveform) => {
    setConvertedWaveforms(prev => ({ ...prev, [trackPath]: waveform }));
  };

  const handleOriginalWaveformReady = (trackPath, waveform) => {
    setOriginalWaveforms(prev => ({ ...prev, [trackPath]: waveform }));
  };

  // Row selection handlers
  const handleRowSelect = (resultId, isSelected) => {
    if (isSelected) {
      setSelectedRows(prev => [...prev, resultId]);
    } else {
      setSelectedRows(prev => prev.filter(id => id !== resultId));
    }
  };

  const handleSelectAllRows = () => {
    const allResultIds = inferenceResults.map(result => result.id);
    setSelectedRows(allResultIds);
  };

  const handleDeselectAllRows = () => {
    setSelectedRows([]);
  };

  // Navigation actions for selected past results
  const handleReturnToModelSelection = () => {
    // For past results, we don't have the original track data
    // Navigate to model selection without pre-selected tracks
    if (onNavigate) {
      onNavigate('inference-model-selection');
    }
  };

  const handleReturnToInferenceParams = () => {
    // For past results, we don't have the original track data
    // Navigate to inference params without pre-selected tracks
    if (onNavigate) {
      onNavigate('inference-params');
    }
  };

  // Model reselection functionality
  const handleReselectModel = (result) => {
    // For past results, we don't have the original track data
    // We could navigate to model selection, but without tracks
    if (onNavigate) {
      onNavigate('inference-model-selection');
    }
  };

  if (loading) {
    return (
      <Box sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        py: 8
      }}>
        <CircularProgress size={64} sx={{ mb: 3 }} />
        <Typography variant="h6">Loading inference results...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{
        mb: 4,
        p: 3,
       
      }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
              Past Inference Results
            </Typography>
            <Typography variant="body1" color="text.secondary">
              View, play, and download your previous voice inference results
            </Typography>
          </Box>
       
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 4 }}>
          {error}
        </Alert>
      )}

      {/* Results Table */}
      {inferenceResults.length === 0 ? (
        <Box sx={{
          textAlign: 'center',
          py: 8,
          px: 4
        }}>
          <AudioFileIcon sx={{
            fontSize: 80,
            color: 'text.secondary',
            mb: 3,
            opacity: 0.5
          }} />
          <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>
            No Inference Results Yet
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 4, maxWidth: 400, mx: 'auto' }}>
            Run your first voice inference using the models from the Models page.
            Your inference results will appear here.
          </Typography>
          <Button
            variant="contained"
            startIcon={<PsychologyIcon />}
            onClick={() => onNavigate && onNavigate('inference-model-selection')}
            sx={{ mt: 2 }}
          >
            Start Your First Inference
          </Button>
        </Box>
      ) : (
        <Grid container spacing={4}>
          <Grid item xs={12}>
            <ErrorBoundary>
              <AudioTrackTable
              trackPairs={getPastInferenceTrackPairs()}
              vocalMode={vocalMode}
              vocalModeType="inference" // Use "converted/original" labels instead of "raw/processed"
              handleVocalModeChange={handleVocalModeChange}
              handlePlayPause={handlePlayPause}
              handleDownload={handleDownload}
              handlePlayBoth={handlePlayBoth}
              handleInstrumentalWaveformReady={() => {}} // No instrumental for past results
              handleVocalWaveformReady={vocalMode === 'converted' ? handleConvertedWaveformReady : handleOriginalWaveformReady}
              playingFile={playingFile}
              playingBoth={internalPlayingBoth}
              instrumentalWaveforms={instrumentalWaveforms}
              vocalWaveforms={vocalMode === 'converted' ? convertedWaveforms : originalWaveforms}
              showVocalToggle={true} // Enable vocal toggle for past results
              enablePlayBoth={true} // Enable center controls for download functionality
              vocalsFileType="inference"
              showDatasetButton={false}
              showInferenceButton={false}
              stopAllAudio={stopAllAudio}
              mutedInstrumentals={internalMutedInstrumentals}
              mutedVocals={vocalMode === 'converted' ? internalMutedConverted : internalMutedOriginal}
              showInferenceResultsActions={true} // Enable row selection and actions
              onReturnToModelSelection={handleReturnToModelSelection}
              onReturnToInferenceParams={handleReturnToInferenceParams}
              externalSelectedRows={selectedRows}
              onRowSelect={handleRowSelect}
              onSelectAll={handleSelectAllRows}
              onDeselectAll={handleDeselectAllRows}
              handleDownloadFullSong={handleDownloadFullSong}
              defaultLabel=" "
            />
            </ErrorBoundary>
          </Grid>
        </Grid>
      )}
    </Box>
  );
}

export default InferenceView;
