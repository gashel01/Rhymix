import React, { useState, useEffect } from "react";
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
import ProcessingStatus from "./components/ProcessingStatus";
import DownloadResults from "./components/DownloadResults";
import HomeView from "./components/HomeView";
import TrainingView from "./components/TrainingView";
import TalkingDatasetUpload from "./components/TalkingDatasetUpload";
import TalkWorkflowPage from "./talk_frontend/TalkWorkflowPage";
import InferenceView from "./components/InferenceView";
import InferenceParams from "./components/InferenceParams";
import InferenceResults from "./components/InferenceResults";
import ModelsView from "./components/ModelsView";
import CreateSongView from "./components/CreateSongView";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import NavigationBar from "./components/NavigationBar";
import { uploadFiles, startProcessing, getJobStatus, cleanDirectories } from "./utils/apiService";

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
            paper: '#1C1C1E', // iOS dark gray
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
          backgroundColor: mode === 'dark' ? '#1C1C1E' : '#FFFFFF',
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

const steps = ["Upload Files", "Process Files", "Download Results"];

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
  const [activeStep, setActiveStep] = useState(0);
  const [files, setFiles] = useState([]);
  const config = {
    process: true,
    export: true,
    clean: true,
  };
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showHomeView, setShowHomeView] = useState(true);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
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

  const theme = createAppTheme(darkMode ? 'dark' : 'light');

  const [open, setOpen] = React.useState(!sidebarCollapsed);
  React.useEffect(() => { if (!sidebarCollapsed) setOpen(true); }, [sidebarCollapsed]);;


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

  const handleNavigation = (view) => {
    setCurrentView(view);
    setShowHomeView(view === "home");
    setSelectedVocalsForTraining(null);
    setSelectedTracksForInference(null);
    setSelectedModelForInference(null);
    setInferenceParams(null);
    setInferenceData(null);
    setDrawerOpen(false);
    // Update URL hash for navigation persistence
    if (view !== "home") {
      window.history.replaceState(null, '', `#${view}`);
    } else {
      window.history.replaceState(null, '', window.location.pathname);
    }
  };

  // Handle URL hash routing for navigation persistence
  useEffect(() => {
    const hash = window.location.hash.substring(1); // Remove the '#'
    if (hash && hash !== 'home') {
      // Only set the view if it's a valid navigation hash
      const validViews = ['datasets', 'training', 'talking-workflow', 'inference-model-selection', 'inference-params', 'inference-results'];
      if (validViews.includes(hash)) {
        setCurrentView(hash);
        setShowHomeView(false);
      }
    }
  }, []);

  useEffect(() => {
    let interval;
    if (jobId && activeStep === 1) {
      interval = setInterval(async () => {
        try {
          const data = await getJobStatus(jobId);
          setJobStatus(data);

          if (data.status === "completed") {
            clearInterval(interval);
            setActiveStep(2);
          } else if (data.status === "failed") {
            clearInterval(interval);
            setError(
              `Processing failed: ${data.error || "Unknown error"}`
            );
          }
        } catch (err) {
          setError(`Failed to check job status: ${err.message}`);
          clearInterval(interval);
        }
      }, 2000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [jobId, activeStep]);

  const handleProcessFiles = async () => {
    setLoading(true);
    try {
      // Step 1: Upload files
      await uploadFiles(files);

      // Step 2: Start processing
      const response = await startProcessing(config);
      setJobId(response.job_id);
      setActiveStep(activeStep + 1);
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

    if (activeStep === 1) {
      return;
    }

    if (activeStep === 0) {
      setConfirmDialogOpen(true);
    } else {
      setActiveStep(activeStep + 1);
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
  };

  const handleTrainWithDataset = (selectedVocals) => {
    console.log("Training with selected vocals:", selectedVocals);

    // If metadata is available, this is coming from diarization
    if (selectedVocals.metadata) {
      console.log("Training with diarization data:", selectedVocals.metadata);
    }

    setSelectedVocalsForTraining(selectedVocals);
    setCurrentView("training");
    setShowHomeView(false);
    setShowVoiceConversion(false);
  };

  const handleBackToHome = () => {
    setCurrentView("home");
    setShowHomeView(true);
    setSelectedVocalsForTraining(null);
    setSelectedTracksForInference(null);
    setSelectedModelForInference(null);
    setInferenceParams(null);
    setInferenceData(null);
  };

  // Global function for components to trigger view changes
  const handleInferenceWithTracks = (tracks) => {
    setSelectedTracksForInference(tracks);
    setCurrentView("inference-model-selection");
  };

  // Make function available globally
  window.appSetView = (view, data) => {
    setCurrentView(view);
    if (view === "inference-model-selection" && data) {
      setSelectedTracksForInference(data);
    }
  };

  const handleCreateTalkingDataset = () => {
    setCurrentView("talking-workflow");
  };

  const handleVoiceConversionClick = () => {
    setShowVoiceConversion(true);
    setShowHomeView(false);
    setSelectedVocalsForTraining(null);
  };

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
            onCreateSingingDataset={() => handleNavigation("datasets")}
            handleTrainWithDataset={handleTrainWithDataset}
            onCreateTalkingDataset={handleCreateTalkingDataset}
            onInferenceWithTracks={handleInferenceWithTracks}
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

              {activeStep === 1 && (
                <ProcessingStatus jobStatus={jobStatus} />
              )}

              {activeStep === 2 && (
                <DownloadResults
                  jobStatus={jobStatus}
                  handleReset={handleReset}
                />
              )}
            </Box>

            <Box sx={{
              display: "flex",
              flexDirection: "row",
              pt: 4,
              gap: 2,
              justifyContent: 'center'
            }}>
              <Button
                disabled={activeStep === 0 || loading || activeStep === 1}
                onClick={handleBack}
                variant="outlined"
                sx={{ minWidth: 120, borderRadius: 2 }}
              >
                Back
              </Button>
              <Box sx={{ flex: "1 1 auto" }} />
              {activeStep === steps.length - 1 ? (
                <Button
                  onClick={handleReset}
                  disabled={loading}
                  variant="contained"
                  sx={{ minWidth: 140, borderRadius: 2 }}
                >
                  Start New Process
                </Button>
              ) : (
                <Button
                  onClick={handleNext}
                  disabled={
                    loading ||
                    (activeStep === 0 && files.length === 0) ||
                    (activeStep === 1 &&
                      (!jobStatus || jobStatus.status !== "completed"))
                  }
                  variant="contained"
                  sx={{ minWidth: 120, borderRadius: 2 }}
                >
                  {loading ? <CircularProgress size={20} /> : "Next"}
                </Button>
              )}
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
          <CreateSongView onBack={() => handleNavigation("home")} />
        );

      case "models":
        return <ModelsView />;

      case "inference":
        return <InferenceView onNavigate={handleNavigation} volume={volume} />;

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
            onBack={() => handleNavigation("home")} 
            onModelSelected={(model, tracks) => {
              setSelectedModelForInference(model);
              setSelectedTracksForInference(tracks);
              setCurrentView("inference-params");
            }} 
          />
        );

      case "inference-params":
        return (
          <InferenceParams
            selectedModel={selectedModelForInference}
            selectedTracks={selectedTracksForInference}
            onBack={() => setCurrentView("inference-model-selection")}
            onStartInference={(data) => {
              setInferenceData(data);
              setCurrentView("inference-results");
            }}
          />
        );

      case "inference-results":
        return (
          <InferenceResults
            inferenceData={inferenceData}
            volume={volume}
            onBack={(actionData) => {
              console.log('App received onBack actionData:', actionData);
              if (actionData && typeof actionData === 'object') {
                // Handle specific navigation actions from InferenceResults
                if (actionData.action === 'model_selection' && actionData.tracks) {
                  console.log('Setting selectedTracksForInference for model_selection:', actionData.tracks);
                  // Return to model selection with selected tracks
                  setSelectedTracksForInference(actionData.tracks);
                  setCurrentView("inference-model-selection");
                  setShowHomeView(false);
                  window.history.replaceState(null, '', '#inference-model-selection');
                } else if (actionData.action === 'inference_params' && actionData.tracks) {
                  console.log('Setting selectedTracksForInference for inference_params:', actionData.tracks);
                  // Return to inference parameters with selected tracks
                  setSelectedTracksForInference(actionData.tracks);
                  setCurrentView("inference-params");
                  setShowHomeView(false);
                  window.history.replaceState(null, '', '#inference-params');
                } else {
                  console.log('Action data missing tracks or unrecognized action:', actionData);
                }
              } else {
                console.log('Default back behavior triggered');
                // Default back behavior
                handleNavigation("home");
              }
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

      <Box sx={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        backgroundColor: 'background.default'
      }}>
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

        {/* Main Content */}
        <Box
          component="main"
          sx={{
            flexGrow: 1,
            p: 3,
            ml: {
              sm: sidebarCollapsed ? '72px' : '280px', // Adjust for collapsed sidebar
              xs: 0
            }, // Account for sidebar
            backgroundColor: 'background.default',
            minHeight: '100vh',
            transition: 'margin-left 0.3s ease-in-out',
          }}
        >
          <Container maxWidth="xl" sx={{ py: 2 }}>
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
          </Container>

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
        </Box>
      </Box>
    </ThemeProvider>
  );
}

export default App;
