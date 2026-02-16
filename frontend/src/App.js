import React, { useState, useEffect, useCallback } from "react";
import { VolumeProvider } from "./contexts/VolumeContext";
import {
  Box,
  Container,
  Typography,
  Stepper,
  Step,
  StepLabel,
  Button,
  Paper,
  CircularProgress,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from "@mui/material";

import { createTheme, ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { GlobalStyles } from "@mui/material";
import HomeIcon from "@mui/icons-material/Home";
import AudioFileIcon from "@mui/icons-material/AudioFile";
import ModelTrainingIcon from "@mui/icons-material/ModelTraining";
import FileUpload from "./components/FileUpload";
// import DownloadResults from "./components/DownloadResults";
import HomeView from "./components/HomeView";
import TrainingView from "./components/TrainingView";
import TalkingDatasetUpload from "./components/TalkingDatasetUpload";
import TalkWorkflowPage from "./talk_frontend/TalkWorkflowPage";
import InferenceView from "./components/InferenceView";
import InferenceParams from "./components/InferenceParams";
import ModelsView from "./components/ModelsView";
import CreateSongView from "./components/CreateSongView";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import NavigationBar from "./components/NavigationBar";
import { uploadFiles, startProcessing, getTrackStatuses, cleanDirectories } from "./utils/apiService";
import { mergeProcessingUpdate, processingEquals, isTerminalProcessingState } from "./utils/processingStatus";
import StudioPage from "./studio/StudioPage";
import BeatboxCalibrationWizard from "./beatboxWizard/BeatboxCalibrationWizard";

// Tesla/Apple-inspired theme system
const createAppTheme = (mode) => createTheme({
  palette: {
    mode,
    ...(mode === 'dark'
      ? {
          // Dark theme - Tesla inspired
          primary: {
            main: '#007AFF', // iOS blue
            light: '#4DA3FF',
            dark: '#0056CC',
          },
          secondary: {
            main: '#FF3B30', // iOS red
            light: '#FF6B66',
            dark: '#CC2F26',
          },
          background: {
            default: '#000000',
            paper: 'transparent', // iOS dark gray
            surface: '#2C2C2E', // iOS surface color
          },
          text: {
            primary: '#FFFFFF',
            secondary: '#EBEBF599',
          },
          divider: '#38383A',
          success: {
            main: '#34C759', // iOS green
          },
          warning: {
            main: '#FF9500', // iOS orange
          },
          error: {
            main: '#FF3B30',
          },
        }
      : {
          // Light theme - Clean Apple inspired
          primary: {
            main: '#007AFF',
            light: '#4DA3FF',
            dark: '#0056CC',
          },
          secondary: {
            main: '#FF3B30',
            light: '#FF6B66',
            dark: '#CC2F26',
          },
          background: {
            default: '#F2F2F7', // iOS light gray
            paper: '#FFFFFF',
            surface: '#F2F2F7',
          },
          text: {
            primary: '#1C1C1E',
            secondary: '#3C3C4399',
          },
          divider: '#C6C6C8',
          success: {
            main: '#34C759',
          },
          warning: {
            main: '#FF9500',
          },
          error: {
            main: '#FF3B30',
          },
        }),
  },
  typography: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif',
    h1: {
      fontSize: '2rem',
      fontWeight: 700,
      letterSpacing: '-0.025em',
    },
    h2: {
      fontSize: '1.5rem',
      fontWeight: 600,
      letterSpacing: '-0.025em',
    },
    h3: {
      fontSize: '1.25rem',
      fontWeight: 600,
      letterSpacing: '-0.025em',
    },
    h4: {
      fontSize: '1.125rem',
      fontWeight: 600,
      letterSpacing: '-0.025em',
    },
    h5: {
      fontSize: '1rem',
      fontWeight: 600,
      letterSpacing: '-0.01em',
    },
    h6: {
      fontSize: '0.875rem',
      fontWeight: 600,
      letterSpacing: '-0.005em',
    },
    body1: {
      fontSize: '1rem',
      lineHeight: 1.5,
    },
    body2: {
      fontSize: '0.875rem',
      lineHeight: 1.4,
    },
    button: {
      fontWeight: 600,
      textTransform: 'none',
      letterSpacing: '-0.005em',
    },
  },
  shape: {
    borderRadius: 12, // Apple-style rounded corners
  },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: mode === 'dark' ? '#1C1C1E' : '#FFFFFF',
          backdropFilter: 'blur(20px)',
          borderBottom: `1px solid ${mode === 'dark' ? '#38383A' : '#C6C6C8'}`,
          boxShadow: 'none',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: mode === 'dark' ? 'rgba(28,28,34,0.72)' : '  rgba(255,255,255,0.74)',
          border: `1px solid ${mode === 'dark' ? '#38383A' : '#C6C6C8'}`,
        },
        elevation1: {
          boxShadow: mode === 'dark'
            ? '0 1px 3px rgba(0,0,0,0.3)'
            : '0 1px 3px rgba(0,0,0,0.1)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          fontWeight: 600,
          padding: '8px 16px',
          minHeight: 44, // Apple touch target
          '&:hover': {
            transform: 'translateY(-1px)',
            boxShadow: mode === 'dark'
              ? '0 4px 12px rgba(0,0,0,0.4)'
              : '0 4px 12px rgba(0,0,0,0.15)',
          },
          transition: 'all 0.2s ease',
        },
        contained: {
          boxShadow: mode === 'dark'
            ? '0 2px 8px rgba(0,0,0,0.3)'
            : '0 2px 8px rgba(0,0,0,0.1)',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          backgroundColor: mode === 'dark' ? '#2C2C2E' : '#FFFFFF',
          border: `1px solid ${mode === 'dark' ? '#38383A' : '#E5E5EA'}`,
          transition: 'all 0.2s ease',
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: mode === 'dark'
              ? '0 8px 24px rgba(0,0,0,0.4)'
              : '0 8px 24px rgba(0,0,0,0.12)',
          },
        },
      },
    },
  },
});

const steps = ["Upload Files"];

const globalStylesInputProps = {
  styles: {
    ".wavesurfer-container, .wavesurfer-wrapper, .wavesurfer-canvas": {
      overflow: "hidden !important",
    },
    "*::-webkit-scrollbar": {
      display: "none !important",
    },
    "*": {
      scrollbarWidth: "none !important",
    },
    "*": {
      msOverflowStyle: "none !important",
    },
  },
};

function App() {
  const isBeatboxCalibrationRoute = window.location.pathname.startsWith("/beatbox-calibration");

  const [activeStep, setActiveStep] = useState(0);
  const [files, setFiles] = useState([]);
  const config = {
    process: true,
    export: false,
    clean: true,
  };
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [optimisticTracks, setOptimisticTracks] = useState([]);
  const [showHomeView, setShowHomeView] = useState(true);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [createDatasetModalOpen, setCreateDatasetModalOpen] = useState(false);
  const [currentView, setCurrentView] = useState("home");
  const [selectedVocalsForTraining, setSelectedVocalsForTraining] =
    useState(null);
  const [showVoiceConversion, setShowVoiceConversion] = useState(false);

  // Theme state
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved ? JSON.parse(saved) : true; // Default to dark mode
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [volume,setVolume]= useState(1);
  // Inference flow state
  const [selectedTracksForInference, setSelectedTracksForInference] = useState(null);
  const [selectedModelForInference, setSelectedModelForInference] = useState(null);
  const [inferenceParams, setInferenceParams] = useState(null);
  const [inferenceData, setInferenceData] = useState(null);
  const [liveInferenceData, setLiveInferenceData] = useState(null);
  const [navContext, setNavContext] = useState(null);
  const [inferenceParamsOrigin, setInferenceParamsOrigin] = useState(null);
  const [createSongNav, setCreateSongNav] = useState({
    mode: "create",
    sourceSongId: null,
    sourceSong: null,
  });

  const getStudioAssetId = useCallback(() => {
    const path = window.location.pathname || "";
    const match = path.match(/^\/studio\/(.+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  }, []);

  const [studioAssetId, setStudioAssetId] = useState(() => getStudioAssetId());

  const theme = createAppTheme(darkMode ? 'dark' : 'light');

  const [open, setOpen] = React.useState(!sidebarCollapsed);
  React.useEffect(() => { if (!sidebarCollapsed) setOpen(true); }, [sidebarCollapsed]);;

  useEffect(() => {
    const handlePopState = () => setStudioAssetId(getStudioAssetId());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [getStudioAssetId]);


  const onVolumeChange = (v01) => setVolume(Math.max(0, Math.min(1, v01)));
  const muted = volume <= 0.001;

  // Suppress harmless AbortError from wavesurfer.destroy() during component cleanup
  useEffect(() => {
    const handleUnhandledRejection = (event) => {
      const reason = event.reason;
      if (reason) {
        const errorName = reason.name || reason.constructor?.name || '';
        const errorMessage = reason.message || reason.toString() || '';
        const errorString = errorName + ' ' + errorMessage;

        // Suppress AbortError from wavesurfer and fetch operations - it's harmless when destroying during load/navigation
        if (
          errorName === 'AbortError' ||
          errorMessage.includes('aborted') ||
          errorMessage.includes('signal is aborted') ||
          errorMessage.includes('BodyStreamBuffer was aborted') ||
          errorString.includes('AbortError') ||
          errorString.includes('aborted')
        ) {
          event.preventDefault();
          event.stopPropagation();
          return false;
        }
      }
    };

    const handleError = (event) => {
      const error = event.error;
      if (error) {
        const errorName = error.name || error.constructor?.name || '';
        const errorMessage = error.message || error.toString() || '';

        // Suppress AbortError from synchronous errors as well
        if (
          errorName === 'AbortError' ||
          errorMessage.includes('aborted') ||
          errorMessage.includes('signal is aborted') ||
          errorMessage.includes('BodyStreamBuffer was aborted')
        ) {
          event.preventDefault();
          event.stopPropagation();
          return false;
        }
      }
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleError);

    // Override console.error to suppress AbortError messages
    const originalConsoleError = console.error;
    console.error = (...args) => {
      const message = args.join(' ');
      if (
        message.includes('AbortError') ||
        message.includes('aborted') ||
        message.includes('signal is aborted') ||
        message.includes('BodyStreamBuffer was aborted')
      ) {
        // Silently suppress AbortError console messages
        return;
      }
      // Call original console.error for other errors
      originalConsoleError.apply(console, args);
    };

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleError);
      console.error = originalConsoleError;
    };
  }, []);

  // Theme persistence
  useEffect(() => {
    localStorage.setItem('darkMode', JSON.stringify(darkMode));
  }, [darkMode]);

  const handleThemeToggle = () => {
    setDarkMode(!darkMode);
  };

  const handleDrawerToggle = () => {
    setDrawerOpen(!drawerOpen);
  };

  const handleSidebarToggle = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  const handleNavigation = useCallback((view) => {
    setCurrentView(view);
    setShowHomeView(view === "home");
    setSelectedVocalsForTraining(null);
    setSelectedTracksForInference(null);
    setSelectedModelForInference(null);
    setInferenceParams(null);
    setInferenceData(null);
    setNavContext(null);
    setInferenceParamsOrigin(null);
    if (view === "create-song") {
      setCreateSongNav({ mode: "create", sourceSongId: null, sourceSong: null });
    }
    if (view !== "create-song") {
      setCreateSongNav({ mode: "create", sourceSongId: null, sourceSong: null });
    }
    if (view !== "inference") setLiveInferenceData(null);
    setDrawerOpen(false);
    // Update URL hash for navigation persistence
    if (view !== "home") {
      window.history.replaceState(null, '', `#${view}`);
    } else {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  const toCoverSourceId = useCallback((track, source) => {
    if (!track || typeof track !== "object") return null;
    if (source === "inference" && track.runId) return `run:${track.runId}`;
    if (track.fileId) return `upload:${track.fileId}`;
    if (track.id && source === "inference") return `run:${track.id}`;
    if (track.id) return `upload:${track.id}`;
    return null;
  }, []);

  const openCreateCover = useCallback(
    ({ source, track }) => {
      const sourceSongId = toCoverSourceId(track, source);
      if (!sourceSongId) return;
      const sourceSong = {
        sourceSongId,
        title: track?.displayName || track?.name || track?.originalName || "Untitled source",
        artist: track?.artist || null,
        duration: track?.duration || null,
        audioUrl: track?.audioUrl || track?.vocalUrl || track?.instrumentalUrl || null,
        instrumentalUrl: track?.instrumentalUrl || null,
        vocalsUrl: track?.vocalUrl || track?.originalVocalUrl || null,
        source,
      };

      setCreateSongNav({
        mode: "cover",
        sourceSongId,
        sourceSong,
      });
      setCurrentView("create-song");
      setShowHomeView(false);
      setDrawerOpen(false);
      window.history.replaceState(
        null,
        "",
        `#create-song?mode=cover&sourceSongId=${encodeURIComponent(sourceSongId)}`
      );
    },
    [toCoverSourceId]
  );

  const handleHomeCoverTrack = useCallback(
    (track) => {
      openCreateCover({ source: "home", track });
    },
    [openCreateCover]
  );

  const handleInferenceCoverTrack = useCallback(
    (track) => {
      openCreateCover({ source: "inference", track });
    },
    [openCreateCover]
  );

  const handleHomeCoverTracks = useCallback(
    (tracks) => {
      if (!Array.isArray(tracks) || tracks.length === 0) return;
      handleHomeCoverTrack(tracks[0]);
    },
    [handleHomeCoverTrack]
  );

  const handleInferenceCoverTracks = useCallback(
    (tracks) => {
      if (!Array.isArray(tracks) || tracks.length === 0) return;
      handleInferenceCoverTrack(tracks[0]);
    },
    [handleInferenceCoverTrack]
  );

  const getTrackId = useCallback((track) => {
    return track?.fileId || track?.trackId || track?.id || track?.runId || track?.tempId || null;
  }, []);

  const buildNavContext = useCallback(
    ({ source, selectedTracks = [], selectedModel = null }) => {
      const ids = (selectedTracks || []).map(getTrackId).filter(Boolean);
      const uniqueIds = Array.from(new Set(ids));
      return {
        source,
        selectedTrackIds: uniqueIds,
        selectedModelId: selectedModel?.id || selectedModel?.modelId || null,
        selectedModelName: selectedModel?.name || selectedModel?.modelName || null,
      };
    },
    [getTrackId]
  );

  const updateInferenceContext = useCallback(
    ({ source, selectedTracks = [], selectedModel = null }) => {
      setSelectedTracksForInference(selectedTracks);
      setSelectedModelForInference(selectedModel);
      setNavContext(buildNavContext({ source, selectedTracks, selectedModel }));
    },
    [buildNavContext]
  );

  const openInferenceModelSelection = useCallback(
    ({ source, selectedTracks }) => {
      updateInferenceContext({ source, selectedTracks, selectedModel: null });
      setInferenceParamsOrigin(null);
      setCurrentView("inference-model-selection");
      setShowHomeView(false);
      window.history.replaceState(null, "", "#inference-model-selection");
    },
    [updateInferenceContext]
  );

  const openInferenceParams = useCallback(
    ({ source, selectedTracks, selectedModel, from }) => {
      updateInferenceContext({ source, selectedTracks, selectedModel });
      setInferenceParamsOrigin(from || null);
      setCurrentView("inference-params");
      setShowHomeView(false);
      window.history.replaceState(null, "", "#inference-params");
    },
    [updateInferenceContext]
  );

  // Handle URL hash routing for navigation persistence
  useEffect(() => {
    const hash = window.location.hash.substring(1); // Remove the '#'
    if (hash && hash !== 'home') {
      const [hashView, hashQuery] = hash.split("?");
      // Only set the view if it's a valid navigation hash
      const validViews = ['datasets', 'training', 'talking-workflow', 'inference-model-selection', 'inference-params', 'inference', 'create-song'];
      if (validViews.includes(hashView)) {
        setCurrentView(hashView);
        setShowHomeView(false);
        if (hashView === "create-song" && hashQuery) {
          const sp = new URLSearchParams(hashQuery);
          const mode = sp.get("mode") === "cover" ? "cover" : "create";
          const sourceSongId = sp.get("sourceSongId") || null;
          setCreateSongNav({ mode, sourceSongId, sourceSong: null });
        }
      }
    }
  }, []);

  useEffect(() => {
    const candidates = (optimisticTracks || []).filter((track) => {
      const state = track?.processing?.state;
      return state && !isTerminalProcessingState(state);
    });
    const ids = Array.from(
      new Set(
        candidates
          .map((track) => track.trackId || track.fileId)
          .filter(Boolean)
      )
    );

    if (!ids.length) return;

    let cancelled = false;
    let interval;

    const pollStatuses = async () => {
      try {
        const updates = await getTrackStatuses(ids);
        if (cancelled || !Array.isArray(updates)) return;
        const byId = new Map(
          updates
            .filter((u) => u && u.trackId)
            .map((u) => [u.trackId, u])
        );
        setOptimisticTracks((prev) => {
          if (!prev.length) return prev;
          let changed = false;
          const next = prev.map((track) => {
            const trackId = track.trackId || track.fileId;
            if (!trackId) return track;
            const update = byId.get(trackId);
            if (!update || !update.processing) return track;
            const mergedProcessing = mergeProcessingUpdate(
              track.processing || null,
              update.processing
            );
            if (processingEquals(track.processing, mergedProcessing)) return track;
            changed = true;
            return {
              ...track,
              processing: mergedProcessing,
            };
          });
          return changed ? next : prev;
        });
      } catch (err) {
        console.error("Failed to check track statuses:", err);
      }
    };

    pollStatuses();
    interval = setInterval(pollStatuses, 2000);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [optimisticTracks]);

  const handleProcessFiles = async () => {
    const filesToUpload = files;
    setFiles([]);
    setCreateDatasetModalOpen(false);
    setLoading(true);
    const nowIso = new Date().toISOString();
    const pendingUploads = filesToUpload.map((file, index) => ({
      tempId: `upload-${Date.now()}-${index}`,
      originalName: file.name,
      displayName: file.name,
      createdAt: nowIso,
      processing: {
        state: "uploading",
        step: "upload",
        message: "Uploading...",
        progress: 0,
        updatedAt: nowIso,
      },
    }));
    if (pendingUploads.length) {
      setOptimisticTracks((prev) => [...pendingUploads, ...prev]);
    }
    try {
      // Step 1: Upload files
      const uploadResponse = await uploadFiles(filesToUpload);
      const uploadedRecords = uploadResponse?.files || [];
      const processingStamp = new Date().toISOString();
      if (uploadedRecords.length) {
        setOptimisticTracks((prev) =>
          prev.map((track) => {
            const pendingIndex = pendingUploads.findIndex((p) => p.tempId === track.tempId);
            if (pendingIndex === -1) return track;
            const record = uploadedRecords[pendingIndex];
            if (!record) return track;
            return {
              ...track,
              trackId: record.fileId,
              fileId: record.fileId,
              originalName: record.originalName || track.originalName,
              displayName: record.safeDisplayName || record.originalName || track.displayName,
              createdAt: record.createdAt || track.createdAt,
              processing: {
                state: "processing",
                step: "processing",
                message: "Starting processing...",
                progress: 0,
                updatedAt: processingStamp,
              },
            };
          })
        );
      }

      // Step 2: Start processing only the files we just uploaded
      const response = await startProcessing({
        ...config,
        fileIds: uploadedRecords.map((r) => r.fileId),
      });
      setJobId(response.job_id);
      setActiveStep(0);
    } catch (err) {
      console.error("Error:", err);
      setError(`Failed to process: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleNext = async () => {
    if (activeStep === 0 && files.length === 0) {
      setError("Please select files to upload first");
      return;
    }

    if (activeStep === 0) {
      handleProcessFiles();
    }
  };

  const handleBack = () => {
    setActiveStep(activeStep - 1);
  };

  const handleCleanDirectories = async (includeInput = false) => {
    setLoading(true);
    try {
      await cleanDirectories({ includeInput, force: true });
      setFiles([]);
      setJobId(null);
      setJobStatus(null);
      setActiveStep(0);
    } catch (err) {
      setError(`Failed to clean directories: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setFiles([]);
    setJobId(null);
    setJobStatus(null);
    setActiveStep(0);
    setCurrentView("home");
    setShowHomeView(true);
    setCreateDatasetModalOpen(false);
    setOptimisticTracks([]);
  };

  const handleTrainWithDataset = useCallback((selectedVocals) => {
    console.log("Training with selected vocals:", selectedVocals);

    // If metadata is available, this is coming from diarization
    if (selectedVocals.metadata) {
      console.log("Training with diarization data:", selectedVocals.metadata);
    }

    setSelectedVocalsForTraining(selectedVocals);
    setCurrentView("training");
    setShowHomeView(false);
    setShowVoiceConversion(false);
  }, []);



  // Global function for components to trigger view changes
  const handleInferenceWithTracks = useCallback(
    (tracks) => {
      openInferenceModelSelection({ source: "home", selectedTracks: tracks || [] });
    },
    [openInferenceModelSelection]
  );

  // Make function available globally
  window.appSetView = (view, data) => {
    if (view === "inference-model-selection") {
      openInferenceModelSelection({ source: "home", selectedTracks: data || [] });
      return;
    }
    setCurrentView(view);
  };

  const handleCreateTalkingDataset = useCallback(() => {
    setCurrentView("talking-workflow");
  }, []);

  const onOpenCreateDataset = useCallback(() => setCreateDatasetModalOpen(true), []);

  
  const navigationItems = [
    {
      id: 'home',
      label: 'Home',
      icon: <HomeIcon />,
      description: 'View and manage your data files'
    },
    {
      id: 'create-song',
      label: 'Create Song',
      icon: <AutoAwesomeIcon />,
      description: 'Generate original music with AI'
    },
    {
      id: 'models',
      label: 'Models',
      icon: <ModelTrainingIcon />,
      description: 'View trained voice models'
    },
    {
      id: 'inference',
      label: 'Inference',
      icon: <AudioFileIcon />,
      description: 'View past inference results'
    },
  ];


  const renderView = () => {
    switch (currentView) {
      case "home":
        return (
          <HomeView
            onOpenCreateDataset={onOpenCreateDataset}
            handleTrainWithDataset={handleTrainWithDataset}
            onCreateTalkingDataset={handleCreateTalkingDataset}
            onInferenceWithTracks={handleInferenceWithTracks}
            onCoverWithTracks={handleHomeCoverTracks}
            optimisticTracks={optimisticTracks}
            onOptimisticTracksChange={setOptimisticTracks}
          />
        );

      case "datasets":
        return (
          <Paper sx={{ p: 4, borderRadius: 3 }}>
            <Typography variant="h4" sx={{ mb: 4, textAlign: 'center', fontWeight: 700 }}>
              Create Dataset
            </Typography>

            <Stepper activeStep={activeStep} sx={{ mb: 6 }}>
              {steps.map((label) => (
                <Step key={label}>
                  <StepLabel
                    sx={{
                      '& .MuiStepLabel-label': {
                        fontSize: '0.9rem',
                        fontWeight: 600,
                      }
                    }}
                  >
                    {label}
                  </StepLabel>
                </Step>
              ))}
            </Stepper>

            <Box sx={{ mt: 4, mb: 4 }}>
              {activeStep === 0 && (
                <FileUpload
                  files={files}
                  setFiles={setFiles}
                  setError={setError}
                  loading={loading}
                  setLoading={setLoading}
                />
              )}

              {/* {activeStep === 2 && (
                <DownloadResults
                  jobStatus={jobStatus}
                  handleReset={handleReset}
                  volume={volume}
                />
              )} */}
            </Box>

            <Box
              sx={{
                display: "flex",
                flexDirection: "row",
                pt: 4,
                gap: 2,
                justifyContent: "center",
              }}
            >
              <Button
                onClick={handleNext}
                disabled={loading || files.length === 0}
                variant="contained"
                sx={{ minWidth: 160, borderRadius: 2 }}
              >
                {loading ? <CircularProgress size={20} /> : "Upload & Start"}
              </Button>
            </Box>
          </Paper>
        );

      case "training":
        return (
          <TrainingView
            selectedVocals={selectedVocalsForTraining}
            onBack={() => handleNavigation("home")}
          />
        );

      case "create-song":
        return (
          <CreateSongView
            onBack={() => handleNavigation("home")}
            initialMode={createSongNav.mode}
            sourceSongId={createSongNav.sourceSongId}
            initialSourceSong={createSongNav.sourceSong}
          />
        );

      case "models":
        return <ModelsView />;

      case "inference":
        return (
          <InferenceView
            onNavigate={handleNavigation}
            onCoverWithTracks={handleInferenceCoverTracks}
            liveInferenceData={liveInferenceData}
            onSelectionToParams={({ source, selectedTracks, selectedModel }) => {
              openInferenceParams({
                source: source || "inference",
                selectedTracks: selectedTracks || [],
                selectedModel,
                from: "inference",
              });
            }}
            onSelectionToModelSelection={({ source, selectedTracks }) => {
              openInferenceModelSelection({
                source: source || "inference",
                selectedTracks: selectedTracks || [],
              });
            }}
          />
        );

      case "talking-workflow":
        return (
          <TalkWorkflowPage
            onBack={() => handleNavigation("home")}
            handleTrainWithDataset={handleTrainWithDataset}
          />
        );

      case "inference-model-selection":
        return (
          <ModelsView 
            isInferenceSelection={true} 
            selectedTracks={selectedTracksForInference}
            navContext={navContext}
            onNavigate={handleNavigation}
            onBack={() => {
              const source = navContext?.source;
              if (source === "inference") {
                handleNavigation("inference");
                return;
              }
              handleNavigation("home");
            }}
            onModelSelected={(model, tracks) => {
              openInferenceParams({
                source: navContext?.source || "home",
                selectedTracks: tracks || selectedTracksForInference || [],
                selectedModel: model,
                from: "model",
              });
            }} 
          />
        );

      case "inference-params":
        return (
          <InferenceParams
            selectedModel={selectedModelForInference}
            selectedTracks={selectedTracksForInference}
            navContext={navContext}
            onBack={() => {
              if (inferenceParamsOrigin === "model") {
                setCurrentView("inference-model-selection");
                window.history.replaceState(null, "", "#inference-model-selection");
                return;
              }
              const source = navContext?.source;
              if (source === "inference") {
                handleNavigation("inference");
                return;
              }
              handleNavigation("home");
            }}
            onGoToModelSelection={() => {
              openInferenceModelSelection({
                source: navContext?.source || "home",
                selectedTracks: selectedTracksForInference || [],
              });
            }}
            onStartInference={(data) => {
              setLiveInferenceData(data);
              setCurrentView("inference");
              setShowHomeView(false);
              window.history.replaceState(null, '', '#inference');
            }}
          />
        );

      default:
        return (
          <Box sx={{ textAlign: 'center', py: 8 }}>
            <Typography variant="h5">View not found</Typography>
            <Button
              variant="contained"
              onClick={() => handleNavigation("home")}
              sx={{ mt: 2 }}
            >
              Go Home
            </Button>
          </Box>
        );
    }
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles {...globalStylesInputProps} />
      <VolumeProvider volume={volume}>
      {isBeatboxCalibrationRoute ? (
        <BeatboxCalibrationWizard />
      ) : studioAssetId ? (
        <StudioPage assetId={studioAssetId} />
      ) : (

      <div style={{
        display: "flex",
        
        minHeight: "100vh",
        backgroundColor: '#1c1c1f99'// main back color 
      }}>
        <div style={{ position: 'relative', display: 'flex' }}>
          <NavigationBar
            theme={theme}
            darkMode={darkMode}
            open={open}
            setOpen={setOpen}
            handleThemeToggle={handleThemeToggle}
            handleDrawerToggle={handleDrawerToggle}
            drawerOpen={drawerOpen}
            navigationItems={navigationItems}
            currentView={currentView}
            handleNavigation={handleNavigation}
            sidebarCollapsed={sidebarCollapsed}
            handleSidebarToggle={handleSidebarToggle}
            handleCleanDirectories={handleCleanDirectories}
            loading={loading}
            onVolumeChange={onVolumeChange}
            muted={muted}
            volume={volume}
          />
        </div>
        {/* Main Content */}
        <div
          component="main"
          style={{
            flexGrow: 1,
            backgroundColor: 'transparent',
            minHeight: '100vh',
          }}
        >
          <div >
            {error && (
              <Alert
                severity="error"
                sx={{
                  mb: 3,
                  borderRadius: 3,
                  boxShadow: theme.shadows[2]
                }}
                onClose={() => setError(null)}
              >
                {error}
              </Alert>
            )}

            {renderView()}
          </div>

          {/* Confirmation Dialog */}
          <Dialog
            open={confirmDialogOpen}
            onClose={() => setConfirmDialogOpen(false)}
            PaperProps={{
              sx: {
                borderRadius: 3,
                maxWidth: 400,
              }
            }}
          >
            <DialogTitle sx={{ pb: 1 }}>
              Confirm Upload and Processing
            </DialogTitle>
            <DialogContent sx={{ pb: 1 }}>
              <DialogContentText>
                This will upload your files and remove all previously processed results.
                Any previous vocal extractions will be permanently deleted.
                <br />
                <br />
                Are you sure you want to continue?
              </DialogContentText>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
              <Button
                onClick={() => setConfirmDialogOpen(false)}
                sx={{ borderRadius: 2, px: 3 }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setConfirmDialogOpen(false);
                  handleProcessFiles();
                }}
                variant="contained"
                sx={{ borderRadius: 2, px: 3 }}
                autoFocus
              >
                Yes, Upload and Process
              </Button>
            </DialogActions>
          </Dialog>

          {/* Create Dataset Modal - rendered in App so HomeView doesn't re-render on jobStatus/polling */}
          <Dialog
            open={createDatasetModalOpen}
            onClose={() => {
              setCreateDatasetModalOpen(false);
              setFiles([]);
            }}
            maxWidth="md"
            fullWidth
            PaperProps={{ sx: { borderRadius: 3 } }}
          >
            <DialogTitle sx={{ textAlign: "center", fontWeight: 700 }}>
              Create Singing Dataset
            </DialogTitle>
            <DialogContent>
              <Paper sx={{ p: 4, borderRadius: 3 }}>
                <Stepper activeStep={activeStep} sx={{ mb: 6 }}>
                  {steps.map((label) => (
                    <Step key={label}>
                      <StepLabel sx={{ '& .MuiStepLabel-label': { fontSize: '0.9rem', fontWeight: 600 } }}>
                        {label}
                      </StepLabel>
                    </Step>
                  ))}
                </Stepper>
                <Box sx={{ mt: 4, mb: 4 }}>
                  {activeStep === 0 && (
                    <FileUpload
                      key={createDatasetModalOpen ? "open" : "closed"}
                      files={files}
                      setFiles={setFiles}
                      setError={setError}
                      loading={loading}
                      setLoading={setLoading}
                    />
                  )}
                  {/* {activeStep === 2 && (
                    <DownloadResults jobStatus={jobStatus} handleReset={handleReset} />
                  )} */}
                </Box>
                <Box sx={{ display: "flex", flexDirection: "row", pt: 4, gap: 2, justifyContent: "center" }}>
                  <Button
                    onClick={handleNext}
                    disabled={loading || files.length === 0}
                    variant="contained"
                    sx={{ minWidth: 160, borderRadius: 2 }}
                  >
                    {loading ? <CircularProgress size={20} /> : "Upload & Start"}
                  </Button>
                </Box>
              </Paper>
            </DialogContent>
          </Dialog>

          {/* Legacy Voice Conversion (if needed) */}
          {showVoiceConversion && (
            <InferenceView
              onNavigate={handleNavigation}
              onBack={() => {
                setShowVoiceConversion(false);
                setShowHomeView(true);
              }}
            />
          )}
        </div>


      </div>
      )}
      </VolumeProvider>
    </ThemeProvider>
  );
}

export default App;
