import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Box,
  Typography,
  Button,
  Paper,
  Container,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Card,
  CardContent,
  IconButton,
  Chip,
  Alert,
  CircularProgress,
  LinearProgress,
  Switch,
  FormControlLabel,
  Fade,
  Tooltip,
  Checkbox,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  DialogContentText,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import DownloadIcon from "@mui/icons-material/Download";
import AudiotrackIcon from "@mui/icons-material/Audiotrack";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import DeleteIcon from "@mui/icons-material/Delete";
import PsychologyIcon from "@mui/icons-material/Psychology";
import { useTheme } from "@mui/material/styles";
import PageHeader from "./common/PageHeader";
import Section from "./common/Section";
import VocalModeToggle from "./common/VocalModeToggle";
import WaveformCell from "./AudioTrackTable/WaveformCell";
import TrackControls from "./AudioTrackTable/TrackControls";
import AudioTrackTable from "./AudioTrackTable";
import ErrorBoundary from "./ErrorBoundary";
import { safePlay, safePause, safeSetMuted, getFileNameFromPath } from "./AudioTrackTable/utils";
import { downloadFullSong } from "../utils/audioUtils";

function InferenceResults({ inferenceData, onBack, volume }) {
  const theme = useTheme();

  // Store original tracks
  useEffect(() => {
    if (inferenceData?.tracks) {
      originalTracksRef.current = inferenceData.tracks;
    }
  }, [inferenceData]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [playingStates, setPlayingStates] = useState({});
  const [showOriginal, setShowOriginal] = useState(false);
  const [inferenceStarted, setInferenceStarted] = useState(false);
  const [overallProgress, setOverallProgress] = useState(0);
  const [expandedLogs, setExpandedLogs] = useState({});
  const [instrumentalWaveforms, setInstrumentalWaveforms] = useState({});
  const [convertedWaveforms, setConvertedWaveforms] = useState({});
  const [originalWaveforms, setOriginalWaveforms] = useState({});
  const [pollingJobs, setPollingJobs] = useState(null);
  const [internalMutedInstrumentals, setInternalMutedInstrumentals] = useState({});
  const [internalMutedConverted, setInternalMutedConverted] = useState({});
  const [internalMutedOriginal, setInternalMutedOriginal] = useState({});
  const [playingFile, setPlayingFile] = useState(null);
  const [internalPlayingBoth, setInternalPlayingBoth] = useState({});
  const logContainerRefs = useRef({});

  // Store original tracks in a ref to avoid stale closures
  const originalTracksRef = useRef([]);

  // Row selection state
  const [selectedRows, setSelectedRows] = useState([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState(null);

  // Waveform synchronization effect
  useEffect(() => {
    const syncInterval = setInterval(() => {
      results.forEach((result) => {
        const trackId = result.track.id;
        const isPlayingBoth = internalPlayingBoth[trackId];

        if (!isPlayingBoth) return;

        // Get waveforms for this track
        const instrumentalWaveform = instrumentalWaveforms[result.track.instrumental] ||
                                   instrumentalWaveforms[getFileNameFromPath(result.track.instrumental)];

        let vocalWaveform = null;
        if (showOriginal) {
          vocalWaveform = originalWaveforms[result.track.vocal] ||
                         originalWaveforms[getFileNameFromPath(result.track.vocal)];
        } else if (result.status === "completed") {
          vocalWaveform = convertedWaveforms[result.outputFile];
        }

        if (!instrumentalWaveform || !vocalWaveform) return;

        const instrumentalTime = instrumentalWaveform.getCurrentTime?.() || 0;
        const vocalTime = vocalWaveform.getCurrentTime?.() || 0;
        const timeDiff = Math.abs(instrumentalTime - vocalTime);

        // Sync if there's any significant difference
        if (timeDiff > 0.05) {
          // Default: sync vocal to instrumental
          if (instrumentalTime > 0) {
            vocalWaveform.setCurrentTime?.(instrumentalTime);
          }
        }

        // Check if both tracks have finished playing
        const instrumentalDuration = instrumentalWaveform.getDuration?.() || 0;
        const vocalDuration = vocalWaveform.getDuration?.() || 0;

        if (instrumentalTime >= instrumentalDuration - 0.1 ||
            vocalTime >= vocalDuration - 0.1) {
          // Stop both tracks
          handlePlayBoth(trackId, result.track);
        }
      });
    }, 50); // Check every 50ms for smooth sync

    return () => clearInterval(syncInterval);
  }, [results, internalPlayingBoth, instrumentalWaveforms, convertedWaveforms, originalWaveforms, showOriginal]);

  useEffect(() => {
    if (!inferenceStarted && inferenceData?.tracks?.length > 0) {
      console.log("InferenceResults component mounted, starting inference...");
      setInferenceStarted(true);
      startInference();
    }
  }, [inferenceStarted, inferenceData]); // Add dependencies to prevent double execution

  // Poll for inference status updates
  useEffect(() => {
    if (!pollingJobs || pollingJobs.length === 0) return;

    const abortController = new AbortController();

    const intervalId = setInterval(async () => {
      try {
        const statusPromises = pollingJobs.map(async (job) => {
          const response = await fetch(`/api/inference-status/${job.jobId}`, {
            signal: abortController.signal
          });
          if (response.ok) {
            const data = await response.json();
            return { ...job, ...data };
          }
          return job;
        });

        const updatedJobs = await Promise.all(statusPromises);
        setResults(updatedJobs);

        // Auto-scroll logs to bottom for each job that has new logs
        updatedJobs.forEach(job => {
          if (job.logs && job.logs.length > 0) {
            const logContainer = logContainerRefs.current[job.jobId];
            if (logContainer) {
              setTimeout(() => {
                logContainer.scrollTop = logContainer.scrollHeight;
              }, 100);
            }
          }
        });

        setOverallProgress(
          updatedJobs.reduce((sum, job) => sum + (job.progress || 0), 0) / updatedJobs.length
        );

        // Check if all jobs are completed
        const allCompleted = updatedJobs.every(job => job.status === "completed");
        const anyFailed = updatedJobs.some(job => job.status === "failed");

        if (allCompleted || anyFailed) {
          clearInterval(intervalId);
          setLoading(false);
          setOverallProgress(100);
          setPollingJobs(null);
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          // Silently ignore - this is expected when component unmounts
          return;
        }
        console.error("Error polling inference status:", error);
      }
    }, 1000);

    return () => {
      abortController.abort();
      clearInterval(intervalId);
    };
  }, [pollingJobs]);

  const startInference = async () => {
    if (inferenceStarted) {
      console.log("Inference already started, skipping...");
      return;
    }

    try {
      setLoading(true);

      console.log("Starting inference with data:", inferenceData);
      console.log("Tracks to process:", inferenceData.tracks);

      console.log(`Starting inference for ${inferenceData.tracks.length} tracks`);

      // Start inference for all selected tracks
      const inferencePromises = inferenceData.tracks.map(async (track, index) => {
        console.log(`Processing track ${index + 1}/${inferenceData.tracks.length}:`, track);
        const response = await fetch("/api/start-inference", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: inferenceData.model,
            track: track,
            params: inferenceData.params,
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to start inference for track ${track.id}`);
        }

        const result = await response.json();
        return {
          track: track,
          jobId: result.jobId,
          status: "processing",
        };
      });

      const inferenceJobs = await Promise.all(inferencePromises);
      setResults(inferenceJobs);

      // Start polling for completion
      setPollingJobs(inferenceJobs);
    } catch (err) {
      console.error("Error starting inference:", err);
      setError(err.message);
      setLoading(false);
    }
  };

  const pollInferenceStatus = async (jobs) => {
    const intervalId = setInterval(async () => {
      try {
        const statusPromises = jobs.map(async (job) => {
          const response = await fetch(`/api/inference-status/${job.jobId}`);
          if (response.ok) {
            const data = await response.json();
            return { ...job, ...data };
          }
          return job;
        });

        const updatedJobs = await Promise.all(statusPromises);
        setResults(updatedJobs);

        // Auto-scroll logs to bottom for each job that has new logs
        updatedJobs.forEach(job => {
          if (job.logs && job.logs.length > 0) {
            const logContainer = logContainerRefs.current[job.jobId];
            if (logContainer) {
              setTimeout(() => {
                logContainer.scrollTop = logContainer.scrollHeight;
              }, 100);
            }
          }
        });

        // Calculate overall progress
        const totalProgress = updatedJobs.reduce((sum, job) => {
          return sum + (job.progress || 0);
        }, 0);
        const avgProgress = updatedJobs.length > 0 ? Math.round(totalProgress / updatedJobs.length) : 0;
        setOverallProgress(avgProgress);

        // Check if all jobs are completed
        const allCompleted = updatedJobs.every(job => job.status === "completed");
        const anyFailed = updatedJobs.some(job => job.status === "failed");

        if (allCompleted || anyFailed) {
          clearInterval(intervalId);
          setLoading(false);
          setOverallProgress(100);
        }
      } catch (error) {
        console.error("Error polling inference status:", error);
      }
    }, 1000);

    return () => clearInterval(intervalId);
  };

  const handleDownload = async (result) => {
    try {
      const response = await fetch(`/api/download/inference/${result.outputFile}`);
      if (!response.ok) {
        throw new Error("Failed to download file");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.outputFile.split('/').pop();
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Error downloading file:", error);
      // Show error notification
    }
  };

  const handleDownloadMerged = async (result) => {
    try {
      const instrumentalFileName = result.track.instrumental;
      const vocalFileName = showOriginal ? result.track.vocal : result.outputFile;
      await downloadFullSong(instrumentalFileName, vocalFileName);
    } catch (error) {
      console.error("Error downloading merged song:", error);
      // Show error notification
    }
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
    const allResultIds = results.map(result => result.track.id);
    setSelectedRows(allResultIds);
  };

  const handleDeselectAllRows = () => {
    setSelectedRows([]);
  };

  const handleDeleteSelected = () => {
    if (selectedRows.length > 0) {
      setDeleteDialogOpen(true);
    }
  };

  const confirmDelete = async () => {
    if (selectedRows.length === 0) return;

    setIsDeleting(true);
    setDeleteResult(null);

    try {
      // Stop all audio playback before deletion
      Object.values(instrumentalWaveforms).forEach(waveform => safePause(waveform));
      Object.values(convertedWaveforms).forEach(waveform => safePause(waveform));
      Object.values(originalWaveforms).forEach(waveform => safePause(waveform));

      // Get all result files to delete
      const filesToDelete = [];
      selectedRows.forEach(resultId => {
        const result = results.find(r => r.track.id === resultId);
        if (result && result.outputFile) {
          // Extract just the filename from the path
          const filename = result.outputFile.split('/').pop() || result.outputFile;
          filesToDelete.push(filename);
        }
      });

      if (filesToDelete.length > 0) {
        const response = await fetch('/api/delete-files', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ filenames: filesToDelete }),
        });

        if (!response.ok) {
          throw new Error('Failed to delete files');
        }

        const result = await response.json();
        setDeleteResult(result);
      }

      // Clear selection and close dialog
      setSelectedRows([]);
      setDeleteDialogOpen(false);

      // Refresh the results
      // You might want to call a refresh function or navigate back

    } catch (error) {
      console.error('Error deleting results:', error);
      setDeleteResult({
        error: error.message || 'Failed to delete results'
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleReturnToModelSelection = () => {
    // Get the original tracks that were selected for inference
    const selectedTracks = selectedRows.length > 0
      ? selectedRows.map(resultId => {
          // First try to find by ID
          let foundTrack = originalTracksRef.current.find(track => track.id === resultId);

          // If not found by ID, try to find by name (the resultId might be the track name)
          if (!foundTrack) {
            foundTrack = originalTracksRef.current.find(track => {
              const trackName = getTrackName(track);
              return trackName === resultId;
            });
          }

          return foundTrack;
        }).filter(Boolean)
      : originalTracksRef.current; // If no specific selection, return all original tracks

    // Navigate back to model selection with the selected tracks
    if (onBack) {
      onBack({ action: 'model_selection', tracks: selectedTracks });
    }
  };

  const handleReturnToInferenceParams = () => {
    // Get the original tracks that were selected for inference
    const selectedTracks = selectedRows.length > 0
      ? selectedRows.map(resultId => {
          // First try to find by ID
          let foundTrack = originalTracksRef.current.find(track => track.id === resultId);

          // If not found by ID, try to find by name
          if (!foundTrack) {
            foundTrack = originalTracksRef.current.find(track => {
              const trackName = getTrackName(track);
              return trackName === resultId;
            });
          }

          return foundTrack;
        }).filter(Boolean)
      : originalTracksRef.current; // If no specific selection, return all original tracks

    // Navigate back to inference parameters with the selected tracks
    if (onBack) {
      onBack({ action: 'inference_params', tracks: selectedTracks });
    }
  };

  const toggleLogs = (jobId) => {
    setExpandedLogs(prev => ({
      ...prev,
      [jobId]: !prev[jobId]
    }));
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircleIcon sx={{ color: 'success.main' }} />;
      case 'failed':
        return <ErrorIcon sx={{ color: 'error.main' }} />;
      case 'processing':
        return <HourglassEmptyIcon sx={{ color: 'warning.main' }} />;
      default:
        return null;
    }
  };

  const getTrackName = (track) => {
    return track.instrumental.split('/').pop().split('\\').pop().replace('_instrumental.wav', '') ||
           track.vocal.split('/').pop().split('\\').pop().replace('_vocals.wav', '');
  };

  // Transform inference results into trackPairs format for AudioTrackTable
  const inferenceTrackPairs = useMemo(
    () =>
      results
        .filter((result) => result && result.track && result.track.instrumental)
        .map((result) => ({
          instrumental: result.track.instrumental,
          vocal: showOriginal ? result.track.vocal : result.outputFile,
          name: getTrackName(result.track),
          instrumentalUrl: result.track.instrumentalUrl,
          vocalUrl: showOriginal ? result.track.vocalUrl : `/api/download/inference/${result.outputFile}`,
          status: result.status || 'unknown',
          id: result.track.id,
          result,
        })),
    [results, showOriginal]
  );

  // Waveform handling functions
  const handleInstrumentalWaveformReady = (trackPath, waveform) => {
    setInstrumentalWaveforms(prev => ({ ...prev, [trackPath]: waveform }));
  };

  const handleConvertedWaveformReady = (trackPath, waveform) => {
    setConvertedWaveforms(prev => ({ ...prev, [trackPath]: waveform }));
  };

  const handleOriginalWaveformReady = (trackPath, waveform) => {
    setOriginalWaveforms(prev => ({ ...prev, [trackPath]: waveform }));
  };

  const handlePlayPause = (trackId, type, track) => {
    const key = `${trackId}-${type}`;

    if (playingStates[key]) {
      // Pause current playback
      safePause(playingFile);
      setPlayingFile(null);
      setPlayingStates(prev => ({ ...prev, [key]: false }));
      setInternalPlayingBoth(prev => ({ ...prev, [trackId]: false }));
    } else {
      // Stop any currently playing file
      if (playingFile) {
        safePause(playingFile);
      }

      let waveformToPlay = null;
      let url = null;

      if (type === 'instrumental') {
        const fileName = getFileNameFromPath(track.instrumental);
        waveformToPlay = instrumentalWaveforms[track.instrumental] || instrumentalWaveforms[fileName];
        url = track.instrumentalUrl || `/api/download/instrumental/${track.instrumental}`;
      } else if (type === 'converted') {
        const result = results.find(r => r.track.id === trackId);
        if (result && result.outputFile) {
          waveformToPlay = convertedWaveforms[result.outputFile];
          url = `/api/download/inference/${result.outputFile}`;
        }
      } else if (type === 'original') {
        const fileName = getFileNameFromPath(track.vocal);
        waveformToPlay = originalWaveforms[track.vocal] || originalWaveforms[fileName];
        url = track.vocalUrl || `/api/download/${inferenceData.params.vocalsFileType || 'processed_vocals'}/${track.vocal}`;
      }

      if (waveformToPlay) {
        safePlay(waveformToPlay, url);
        setPlayingFile(waveformToPlay);
        setPlayingStates(prev => ({ ...prev, [key]: true }));
      }
    }
  };

  const handlePlayBoth = (trackId, track) => {
    const isPlayingBoth = internalPlayingBoth[trackId];

    if (isPlayingBoth) {
      // Stop both
      if (playingFile) {
        safePause(playingFile);
        setPlayingFile(null);
      }
      setInternalPlayingBoth(prev => ({ ...prev, [trackId]: false }));
      setPlayingStates(prev => ({
        ...prev,
        [`${trackId}-instrumental`]: false,
        [`${trackId}-converted`]: false,
        [`${trackId}-original`]: false,
      }));
    } else {
      // Start sync playback - waveforms will be synchronized by the useEffect
      setInternalPlayingBoth(prev => ({ ...prev, [trackId]: true }));

      // Start playing both tracks - the useEffect will handle synchronization
      const instrumentalKey = `${trackId}-instrumental`;
      const vocalKey = showOriginal ? `${trackId}-original` : `${trackId}-converted`;

      setPlayingStates(prev => ({
        ...prev,
        [instrumentalKey]: true,
        [vocalKey]: true,
      }));

      // Trigger play for both tracks
      handlePlayPause(trackId, 'instrumental', track);
      setTimeout(() => {
        handlePlayPause(trackId, showOriginal ? 'original' : 'converted', track);
      }, 10);
    }
  };

  const stopAllAudio = () => {
    // Stop currently playing file
    if (playingFile) {
      safePause(playingFile);
      setPlayingFile(null);
    }

    // Stop all waveforms
    Object.values(instrumentalWaveforms).forEach(waveform => safePause(waveform));
    Object.values(convertedWaveforms).forEach(waveform => safePause(waveform));
    Object.values(originalWaveforms).forEach(waveform => safePause(waveform));

    // Reset playing states
    setPlayingStates({});
    setInternalPlayingBoth({});
  };

  if (loading && results.length === 0) {
    return (
      <Box>
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          mb: 4,
          p: 3,
          background: 'transparent',
          borderRadius: 4,
          border: theme => `1px solid ${theme.palette.divider}`,
        }}>
          <IconButton onClick={() => onBack({ action: 'inference_params', tracks: originalTracksRef.current })} sx={{ mr: 1 }}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            Voice Inference in Progress
          </Typography>
        </Box>

        <Box sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          py: 8,
          px: 4
        }}>
          <Box sx={{
            width: 120,
            height: 120,
            borderRadius: '50%',
            background: theme => theme.palette.mode === 'dark'
              ? 'linear-gradient(135deg, #007AFF 0%, #FF3B30 100%)'
              : 'linear-gradient(135deg, #007AFF 0%, #FF9500 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            mb: 4,
            boxShadow: 4,
          }}>
            <AudiotrackIcon sx={{ fontSize: 60, color: 'white' }} />
          </Box>

          <Typography variant="h4" sx={{ mb: 3, fontWeight: 700 }}>
            Converting Voices...
          </Typography>

          <Typography variant="h6" sx={{ mb: 2, color: 'text.secondary' }}>
            Processing {inferenceData.tracks.length} track{inferenceData.tracks.length > 1 ? 's' : ''}
          </Typography>

          <Typography variant="body1" color="text.secondary" sx={{ mb: 4, textAlign: 'center', maxWidth: 400 }}>
            Our AI is transforming your audio using advanced voice conversion technology.
            This may take a few minutes depending on the track length.
          </Typography>

          <Box sx={{
            width: '100%',
            maxWidth: 400,
            bgcolor: 'background.paper',
            borderRadius: 3,
            p: 3,
            boxShadow: 2
          }}>
            <Typography variant="body2" sx={{ mb: 2, textAlign: 'center' }}>
              Initializing voice conversion engine...
            </Typography>
            <Box sx={{
              width: '100%',
              bgcolor: 'grey.300',
              borderRadius: 2,
              height: 12,
              overflow: 'hidden'
            }}>
              <Box
                sx={{
                  width: '15%',
                  bgcolor: 'primary.main',
                  borderRadius: 2,
                  height: 12,
                  transition: 'width 0.5s ease-in-out',
                  background: theme => theme.palette.mode === 'dark'
                    ? 'linear-gradient(90deg, #007AFF 0%, #FF3B30 100%)'
                    : 'linear-gradient(90deg, #007AFF 0%, #FF9500 100%)',
                }}
              />
            </Box>
          </Box>
        </Box>
      </Box>
    );
  }

  return (
   
    <Box>
      <Grid container spacing={4}>
        {/* Configuration Summary */}
        <Grid item xs={12}>
          <Card sx={{
           
            cursor: 'default',
          }}>
            <CardContent sx={{ p: 2 }}>
              <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
                Inference Configuration
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} md={6} lg={3}>
                  <Box sx={{
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: 'background.paper',
                    border: theme => `1px solid ${theme.palette.divider}`,
                  }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      AI Model
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 600, color: 'primary.main' }}>
                      {inferenceData.model.name}
                    </Typography>
                  </Box>
                </Grid>
                <Grid item xs={12} md={6} lg={3}>
                  <Box sx={{
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: 'background.paper',
                    border: theme => `1px solid ${theme.palette.divider}`,
                  }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      Pitch Adjustment
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 600 }}>
                      {inferenceData.params.pitch > 0 ? '+' : ''}{inferenceData.params.pitch} semitones
                    </Typography>
                  </Box>
                </Grid>
                <Grid item xs={12} md={6} lg={3}>
                  <Box sx={{
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: 'background.paper',
                    border: theme => `1px solid ${theme.palette.divider}`,
                  }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      Voice Detection
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 600 }}>
                      {inferenceData.params.f0Method.toUpperCase()}
                    </Typography>
                  </Box>
                </Grid>
                <Grid item xs={12} md={6} lg={3}>
                  <Box sx={{
                    p: 1.5,
                    borderRadius: 2,
                    bgcolor: 'background.paper',
                    border: theme => `1px solid ${theme.palette.divider}`,
                  }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      Voice Similarity
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 600 }}>
                      {Math.round(inferenceData.params.indexRate * 100)}%
                    </Typography>
                  </Box>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

     

        {/* Results Table */}
        <Grid item xs={12}>
          {results.length > 0 ? (
            <ErrorBoundary>
              <AudioTrackTable
            trackPairs={inferenceTrackPairs}
            vocalMode={showOriginal ? 'original' : 'converted'}
            handleVocalModeChange={(event, newMode) => {
              if (newMode) {
                setShowOriginal(newMode === 'original');
              }
            }}
            vocalModeType="inference"
            handlePlayPause={handlePlayPause}
            handleDownload={handleDownload}
            handlePlayBoth={handlePlayBoth}
            handleInstrumentalWaveformReady={handleInstrumentalWaveformReady}
            handleVocalWaveformReady={showOriginal ? handleOriginalWaveformReady : handleConvertedWaveformReady}
            playingFile={playingFile}
            playingBoth={internalPlayingBoth}
            instrumentalWaveforms={instrumentalWaveforms}
            vocalWaveforms={showOriginal ? originalWaveforms : convertedWaveforms}
            showVocalToggle={true}
            enablePlayBoth={true}
            vocalsFileType={showOriginal ? (inferenceData.params.vocalsFileType || 'processed_vocals') : 'inference'}
            showDatasetButton={false}
            showInferenceButton={false}
            stopAllAudio={stopAllAudio}
            mutedInstrumentals={internalMutedInstrumentals}
            mutedVocals={showOriginal ? internalMutedOriginal : internalMutedConverted}
            showInferenceResultsActions={true}
            onReturnToModelSelection={handleReturnToModelSelection}
            onReturnToInferenceParams={handleReturnToInferenceParams}
            externalSelectedRows={selectedRows}
            onRowSelect={handleRowSelect}
            onSelectAll={handleSelectAllRows}
            onDeselectAll={handleDeselectAllRows}
            onDeleteSelected={handleDeleteSelected}
            externalDeleteResult={deleteResult}
            onClearDeleteResult={() => setDeleteResult(null)}
            defaultLabel="Inference Results"
            volume={volume}
          />
            </ErrorBoundary>
          ) : (
            <Paper sx={{
              borderRadius: 3,
              p: 4,
              textAlign: 'center',
              background: 'transparent',
            }}>
              <Typography variant="h6" color="text.secondary">
                No inference results available
              </Typography>
            </Paper>
          )}
        </Grid>

      </Grid>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
      >
        <DialogTitle id="delete-dialog-title">
          Delete Selected Results
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-dialog-description">
            Are you sure you want to delete {selectedRows.length} inference result{selectedRows.length !== 1 ? 's' : ''}?
            This will permanently remove the converted audio files.
            This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setDeleteDialogOpen(false)}
            color="primary"
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            onClick={confirmDelete}
            color="error"
            variant="contained"
            disabled={isDeleting}
            startIcon={isDeleting ? null : <DeleteIcon />}
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  );
}

export default InferenceResults;
