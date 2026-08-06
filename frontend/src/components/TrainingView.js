import React, { useState, useEffect, useRef } from "react";
import {
  Box,
  Typography,
  Button,
  Container,
  Grid,
  Slider,
  FormControlLabel,
  Switch,
  Chip,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Paper,
  Divider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from "@mui/material";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import TuneIcon from "@mui/icons-material/Tune";
import SettingsIcon from "@mui/icons-material/Settings";
import AudioFileIcon from "@mui/icons-material/AudioFile";
import GraphicEqIcon from "@mui/icons-material/GraphicEq";
import SchoolIcon from "@mui/icons-material/School";
import MemoryIcon from "@mui/icons-material/Memory";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ScheduleIcon from "@mui/icons-material/Schedule";
import { useTheme } from "@mui/material/styles";
import PageHeader from "./common/PageHeader";
import Section from "./common/Section";

function TrainingView({ selectedVocals, onBack, resumeJobId = null }) {
  const theme = useTheme();

  // Transform the selected tracks array into the expected structure
  const processedVocals = selectedVocals?.filter(track => track.vocal)?.map(track => track.vocal) || [];
  const rawVocals = selectedVocals?.filter(track => track.vocal)?.map(track => track.vocal) || [];
  const [config, setConfig] = useState({
    // Basic settings
    modelName: "",
    epochs: 100,
    batchSize: 8,
    saveEvery: 20,
    learningRate: 0.0001,

    // Voice features
    modelType: "standard", // standard, light, tiny
    useF0: true,
    usePitch: true,
    customPitch: 0, // -12 to +12
    useEnhancer: false,
    useEmotional: false,

    // Applio specific settings
    saveOnlyLatest: false,
    saveEveryWeights: true,
    sampleRate: 48000,
    gpu: 0,
    rvcVersion: "v2",
    pitchGuidance: true,
    overtrainingDetector: true,
    overtrainingThreshold: 5,
    pretrained: true,
    cleanup: true,
    indexAlgorithm: "Auto",
    cacheDataInGpu: false,
    customPretrained: false,
    gPretrainedPath: null,
    dPretrainedPath: null,
  });

  const [isTraining, setIsTraining] = useState(false);
  const [trainingLogs, setTrainingLogs] = useState([]);
  const [trainingProgress, setTrainingProgress] = useState(0);
  const [trainingCompleted, setTrainingCompleted] = useState(false);
  const [completionDialogOpen, setCompletionDialogOpen] = useState(false);
  const [fileDetailsModalOpen, setFileDetailsModalOpen] = useState(false);
  const [currentJobId, setCurrentJobId] = useState(null);
  // How many backend log lines we've already shown. The status endpoint returns
  // the whole log every poll, so without this the box fills with duplicates.
  const consumedLogsRef = useRef(0);

  const [cancelling, setCancelling] = useState(false);

  const handleCancelTraining = async () => {
    if (!currentJobId || cancelling) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/training-jobs/${encodeURIComponent(currentJobId)}/cancel`, {
        method: "POST",
      });
      if (res.ok) {
        setIsTraining(false);
        setCurrentJobId(null);
        setTrainingLogs((prev) => [...prev, "Cancelled by user"]);
      } else {
        const data = await res.json().catch(() => ({}));
        setTrainingLogs((prev) => [...prev, `Could not cancel: ${data.error || res.status}`]);
      }
    } catch (err) {
      setTrainingLogs((prev) => [...prev, `Could not reach the backend to cancel: ${err}`]);
    } finally {
      setCancelling(false);
    }
  };

  // Reattach to a run started elsewhere: the job outlives this view, so opening
  // it from the Models list should pick the run up where it is, not start over.
  useEffect(() => {
    if (!resumeJobId) return;
    consumedLogsRef.current = 0;
    setCurrentJobId(resumeJobId);
    setIsTraining(true);
    setTrainingLogs([`Reattached to training job ${resumeJobId}`]);
  }, [resumeJobId]);

  // Poll training status when job starts
  useEffect(() => {
    if (!currentJobId) return;

    const abortController = new AbortController();

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/training-status/${currentJobId}`, {
          signal: abortController.signal
        });

        if (response.ok) {
          const data = await response.json();

          // Update progress
          if (data.progress !== undefined) {
            setTrainingProgress(data.progress);
          }

          // Append only the lines we haven't shown yet — the endpoint returns
          // the full log each time.
          if (data.logs && data.logs.length > consumedLogsRef.current) {
            const fresh = data.logs.slice(consumedLogsRef.current);
            consumedLogsRef.current = data.logs.length;
            setTrainingLogs((prev) => [...prev, ...fresh]);
          }

          // Check if training is complete
          if (data.status === "completed") {
            clearInterval(pollInterval);
            setIsTraining(false);
            setTrainingCompleted(true);
            setCompletionDialogOpen(true);
            setCurrentJobId(null);
            setTrainingLogs((prev) => [
              ...prev,
              "Training completed successfully!",
            ]);
          } else if (data.status === "failed") {
            clearInterval(pollInterval);
            setIsTraining(false);
            setCurrentJobId(null);
            setTrainingLogs((prev) => [
              ...prev,
              `Training failed: ${data.error || "Unknown error"}`,
            ]);
          }
        } else {
          console.error("Failed to fetch training status");
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          // Silently ignore - this is expected when component unmounts
          return;
        }
        console.error("Error polling training status:", error);
      }
    }, 3000);

    return () => {
      abortController.abort();
      clearInterval(pollInterval);
    };
  }, [currentJobId]);

  const handleChange = (field) => (event) => {
    const value =
      event.target.type === "checkbox"
        ? event.target.checked
        : event.target.value;
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  const startTraining = async () => {
    const totalVocals = selectedVocals?.length || 0;
    if (!config.modelName || totalVocals === 0) {
      alert("Please enter a model name and select vocals for training");
      return;
    }

    setIsTraining(true);

    try {
      // First prepare the dataset
      await prepareDataset();

      // Start the training
      const response = await fetch("/api/start-training", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          modelName: config.modelName,
          rvcVersion: config.rvcVersion,
          saveEveryEpoch: config.saveEvery,
          saveOnlyLatest: config.saveOnlyLatest,
          saveEveryWeights: config.saveEveryWeights,
          totalEpoch: config.epochs,
          sampleRate: config.sampleRate,
          batchSize: config.batchSize,
          gpu: config.gpu,
          pitchGuidance: config.pitchGuidance || config.useF0,
          overtrainingDetector: config.overtrainingDetector,
          overtrainingThreshold: config.overtrainingThreshold,
          pretrained: config.pretrained,
          cleanup: config.cleanup,
          indexAlgorithm: config.indexAlgorithm,
          cacheDataInGpu: config.cacheDataInGpu,
          customPretrained: config.customPretrained,
          gPretrainedPath: config.gPretrainedPath,
          dPretrainedPath: config.dPretrainedPath,
        }),
      });

      if (response.ok) {
        const data = await response.json();

        if (data.jobId) {
          // Start polling for updates
          consumedLogsRef.current = 0;
          setCurrentJobId(data.jobId);
        } else {
          setTrainingLogs((prev) => [
            ...prev,
            "Failed to start training: No job ID returned",
          ]);
          setIsTraining(false);
        }
      } else {
        const errorData = await response.json();
        setTrainingLogs((prev) => [
          ...prev,
          `Training error: ${errorData.error || "Unknown error"}`,
        ]);
        setIsTraining(false);
      }
    } catch (error) {
      console.error("Training error:", error);
      setTrainingLogs((prev) => [
        ...prev,
        `Error starting training: ${error.message}`,
      ]);
      setIsTraining(false);
    }
  };

  const prepareDataset = async () => {
    setTrainingLogs((prev) => [...prev, "Preparing dataset..."]);

    try {
      // Create formData with the selected vocal files
      const formData = new FormData();

      // First, we need to download the audio files from the URLs
      setTrainingLogs((prev) => [...prev, "Downloading audio files..."]);

      // Extract vocal files from selected tracks
      const toSafeName = (name) =>
        (name || "track")
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
          .replace(/\s+/g, "_")
          .slice(0, 80);

      const allVocalFiles = selectedVocals.map(track => {
        const baseFilename = track.displayName || track.originalName || track.vocal;
        return {
          filename: baseFilename,
          url: track.vocalUrl,
          type: 'vocal'
        };
      });

      setTrainingLogs((prev) => [
        ...prev,
        `Found ${allVocalFiles.length} vocal files to download`
      ]);

      // Fetch all files in parallel
      const filePromises = allVocalFiles.map(
        async (vocalFile, index) => {
          try {
            setTrainingLogs((prev) => [
              ...prev,
              `Downloading ${vocalFile.type} vocal ${index + 1}: ${vocalFile.filename}`
            ]);

            const response = await fetch(vocalFile.url);
            if (!response.ok) {
              throw new Error(`Failed to fetch ${vocalFile.filename}: ${response.status} ${response.statusText}`);
            }

            const blob = await response.blob();

            // Create a unique filename with speaker prefix
            const baseFilename = toSafeName(vocalFile.filename);
            const filename = `speaker01_${index + 1}_${baseFilename}_${vocalFile.type}.wav`;

            return new File([blob], filename, { type: "audio/wav" });
          } catch (error) {
            console.error(`Error downloading file ${index + 1}:`, error);
            setTrainingLogs((prev) => [
              ...prev,
              `Error downloading file ${index + 1}: ${error.message}`,
            ]);
            throw error;
          }
        }
      );

      try {
        const files = await Promise.all(filePromises);

        // Add the downloaded files to the formData
        files.forEach((file, index) => {
          formData.append("vocals", file);
          setTrainingLogs((prev) => [
            ...prev,
            `Prepared file ${index + 1}: ${file.name}`,
          ]);
        });

        // Add metadata (model name and other config)
        formData.append("modelName", config.modelName);
        formData.append("sampleRate", config.sampleRate.toString());

        setTrainingLogs((prev) => [
          ...prev,
          `Uploading ${files.length} audio files...`,
        ]);

        // Log the composition of files
        setTrainingLogs((prev) => [
          ...prev,
          `Dataset composition: ${files.length} vocal tracks selected for training`,
        ]);

        // Upload the dataset
        const response = await fetch("/api/prepare-training-dataset", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(
            `Failed to prepare dataset: ${error.error || "Unknown error"}`
          );
        }

        setTrainingLogs((prev) => [...prev, "Dataset preparation complete"]);
        return true;
      } catch (error) {
        console.error("Error processing files:", error);
        setTrainingLogs((prev) => [...prev, `Error: ${error.message}`]);
        throw error;
      }
    } catch (error) {
      console.error("Dataset preparation error:", error);
      setTrainingLogs((prev) => [
        ...prev,
        `Dataset preparation failed: ${error.message}`,
      ]);
      throw error;
    }
  };


  return (
    <Container maxWidth="xl" sx={{ py: 6 }}>
      <PageHeader
        title="Train Voice Model"
        subtitle="Configure and train your custom voice conversion model"
        onBack={onBack}
      />

      {/* Dataset & Training Overview - Clean Header */}
      <Paper
        elevation={0}
        sx={{
          p: 4,
          mb: 6,
          backgroundColor: theme.palette.mode === 'dark'
            ? 'rgba(255, 255, 255, 0.02)'
            : 'rgba(0, 0, 0, 0.02)',
          border: theme => `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)'}`,
          borderRadius: 3,
        }}
      >
        <Grid container spacing={4} alignItems="center">
          <Grid item xs={12} md={6}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, mb: 2 }}>
              <Box sx={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: theme => theme.palette.mode === 'dark'
                  ? 'linear-gradient(135deg, #0A84FF 0%, #0060DF 100%)'
                  : 'linear-gradient(135deg, #4DA6FF 0%, #0A84FF 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: theme => theme.palette.mode === 'dark'
                  ? '0 4px 16px rgba(10, 132, 255, 0.3)'
                  : '0 4px 16px rgba(10, 132, 255, 0.2)',
              }}>
                <SchoolIcon sx={{ fontSize: 28, color: 'white' }} />
              </Box>
              <Box>
                <Typography variant="h5" sx={{
                  fontWeight: 600,
                  color: theme.palette.text.primary,
                  mb: 1,
                }}>
                  Voice Model Training
                </Typography>
                <Typography variant="body2" sx={{
                  color: theme.palette.text.secondary,
                }}>
                  Train a custom voice conversion model from your vocal dataset
                </Typography>
              </Box>
            </Box>
          </Grid>

          <Grid item xs={12} md={6}>
            <Box sx={{
              p: 2.5,
              backgroundColor: theme.palette.mode === 'dark'
                ? 'rgba(10, 132, 255, 0.08)'
                : 'rgba(10, 132, 255, 0.06)',
              borderRadius: 2,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
            }}>
              <Typography variant="h6" sx={{
                fontWeight: 600,
                color: theme.palette.primary.main,
                mb: 1.5,
              }}>
                Training Overview
              </Typography>

              <Box sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 2,
                mb: 0.5,
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  {/* A reattached run has no selection to count — the dataset was
                      fixed when it started. Report the run instead of "0 tracks". */}
                  {resumeJobId ? (
                    <Typography variant="body2" sx={{
                      color: theme.palette.text.secondary,
                      fontWeight: 500,
                    }}>
                      Watching a run already in progress
                    </Typography>
                  ) : (
                    <>
                      <Typography variant="h4" sx={{
                        fontWeight: 700,
                        color: theme.palette.primary.main,
                      }}>
                        {selectedVocals?.length || 0}
                      </Typography>
                      <Typography variant="body2" sx={{
                        color: theme.palette.text.secondary,
                        fontWeight: 500,
                      }}>
                        vocal tracks selected
                      </Typography>
                    </>
                  )}
                </Box>

                {/* See Details Button */}
                {selectedVocals && selectedVocals.length > 0 && (
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => setFileDetailsModalOpen(true)}
                    sx={{
                      borderColor: theme.palette.primary.main,
                      color: theme.palette.primary.main,
                      '&:hover': {
                        borderColor: theme.palette.primary.dark,
                        backgroundColor: theme.palette.mode === 'dark'
                          ? 'rgba(10, 132, 255, 0.08)'
                          : 'rgba(10, 132, 255, 0.04)',
                      },
                    }}
                  >
                    See Details
                  </Button>
                )}
              </Box>

              <Box sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
              }}>
                <ScheduleIcon sx={{
                  fontSize: '1rem',
                  color: theme.palette.text.secondary,
                }} />
                <Typography variant="body2" sx={{
                  color: theme.palette.text.secondary,
                }}>
                  {resumeJobId
                    ? "Started from another view — progress below is live"
                    : `Estimated training time: ~${Math.round((selectedVocals?.length || 0) * 3.5)} minutes`}
                </Typography>
              </Box>
            </Box>
          </Grid>
        </Grid>
      </Paper>

      {/* Training Progress - Only show when training */}
      {isTraining && (
        <Box sx={{
          p: 3,
          backgroundColor: theme.palette.mode === 'dark'
            ? 'rgba(255, 255, 255, 0.02)'
            : 'rgba(0, 0, 0, 0.02)',
          borderRadius: 2,
          border: theme => `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'}`,
          mb: 3,
        }}>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
            Training Progress
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
            <CircularProgress size={24} sx={{ mr: 2 }} />
            <Typography variant="body2">{trainingProgress}% Complete</Typography>
            {/* This is the screen you sit on while it runs, so the way out
                belongs here too — not only on the card in the Models list. */}
            <Button
              variant="outlined"
              color="error"
              size="small"
              onClick={handleCancelTraining}
              disabled={!currentJobId || cancelling}
              sx={{ ml: "auto", textTransform: "none" }}
            >
              {cancelling ? "Cancelling…" : "Cancel training"}
            </Button>
          </Box>

          <Box
            sx={{
              maxHeight: 200,
              overflowY: "auto",
              bgcolor: theme.palette.mode === 'dark'
                ? 'rgba(0,0,0,0.3)'
                : 'rgba(0,0,0,0.05)',
              p: 2,
              borderRadius: 2,
              fontFamily: "monospace",
              fontSize: "0.8rem",
            }}
          >
            {trainingLogs.map((log, index) => (
              <div key={index} style={{ marginBottom: '4px' }}>
                {log}
              </div>
            ))}
          </Box>
        </Box>
      )}

      {/* Training Configuration Accordion */}
      <Accordion
        defaultExpanded
        sx={{
          backgroundColor: theme.palette.mode === 'dark'
            ? 'rgba(255, 255, 255, 0.02)'
            : 'rgba(255, 255, 255, 0.8)',
          border: theme => `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)'}`,
          borderRadius: '12px !important',
          mb: 3,
          boxShadow: 'none',
          '&:before': { display: 'none' },
        }}
      >
        <AccordionSummary
          expandIcon={<ArrowBackIcon />}
          sx={{
            px: 4,
            py: 3,
            '& .MuiAccordionSummary-content': { alignItems: 'center', gap: 2 },
          }}
        >
          <Box sx={{
            width: 48,
            height: 48,
            borderRadius: 2,
            background: theme => theme.palette.mode === 'dark'
              ? 'linear-gradient(135deg, #0A84FF 0%, #0060DF 100%)'
              : 'linear-gradient(135deg, #4DA6FF 0%, #0A84FF 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <SettingsIcon sx={{ fontSize: 24, color: 'white' }} />
          </Box>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
              Training Configuration
            </Typography>
            <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
              Configure model architecture and training parameters
            </Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails sx={{ px: 4, pb: 4 }}>
          <Grid container spacing={4}>
            {/* Basic Settings */}
            <Grid item xs={12} md={6}>
              <Box sx={{
                p: 3,
                backgroundColor: theme.palette.mode === 'dark'
                  ? 'rgba(255, 255, 255, 0.02)'
                  : 'rgba(0, 0, 0, 0.02)',
                borderRadius: 2,
                border: theme => `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'}`,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    Basic Settings
                  </Typography>
                  <Tooltip title="Core model configuration and naming">
                    <HelpOutlineIcon fontSize="small" sx={{ color: theme.palette.text.secondary }} />
                  </Tooltip>
                </Box>

                <Box sx={{ mb: 3 }}>
                  <Typography variant="body2" sx={{ fontWeight: 500, mb: 1 }}>
                    Model Name
                  </Typography>
                  <TextField
                    fullWidth
                    placeholder="Enter model name"
                    value={config.modelName}
                    onChange={handleChange("modelName")}
                    size="small"
                    required
                    disabled={isTraining}
                  />
                </Box>

                <Box sx={{ mb: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      RVC Version
                    </Typography>
                    <Tooltip title="RVC v2 offers better quality but requires more resources">
                      <HelpOutlineIcon fontSize="small" sx={{ color: theme.palette.text.secondary }} />
                    </Tooltip>
                  </Box>
                  <FormControl fullWidth size="small">
                    <Select
                      value={config.rvcVersion}
                      onChange={handleChange("rvcVersion")}
                      disabled={isTraining}
                    >
                      <MenuItem value="v2">RVC v2 (Recommended)</MenuItem>
                      <MenuItem value="v1">RVC v1 (Legacy)</MenuItem>
                    </Select>
                  </FormControl>
                </Box>
              </Box>
            </Grid>

            {/* Hardware & Performance */}
            <Grid item xs={12} md={6}>
              <Box sx={{
                p: 3,
                backgroundColor: theme.palette.mode === 'dark'
                  ? 'rgba(255, 255, 255, 0.02)'
                  : 'rgba(0, 0, 0, 0.02)',
                borderRadius: 2,
                border: theme => `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'}`,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    Hardware & Performance
                  </Typography>
                  <Tooltip title="GPU and memory configuration for training">
                    <HelpOutlineIcon fontSize="small" sx={{ color: theme.palette.text.secondary }} />
                  </Tooltip>
                </Box>

                <Box sx={{ mb: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      GPU Device
                    </Typography>
                    <Tooltip title="Select which GPU to use for training">
                      <HelpOutlineIcon fontSize="small" sx={{ color: theme.palette.text.secondary }} />
                    </Tooltip>
                  </Box>
                  <FormControl fullWidth size="small">
                    <Select
                      value={config.gpu}
                      onChange={handleChange("gpu")}
                      disabled={isTraining}
                    >
                      <MenuItem value={0}>GPU 0 (Primary)</MenuItem>
                      <MenuItem value={1}>GPU 1</MenuItem>
                      <MenuItem value={2}>GPU 2</MenuItem>
                      <MenuItem value={-1}>CPU (Not Recommended)</MenuItem>
                    </Select>
                  </FormControl>
                </Box>

                <Box sx={{ mb: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      Sample Rate
                    </Typography>
                    <Tooltip title="Audio quality - higher rates produce better results but slower training">
                      <HelpOutlineIcon fontSize="small" sx={{ color: theme.palette.text.secondary }} />
                    </Tooltip>
                  </Box>
                  <FormControl fullWidth size="small">
                    <Select
                      value={config.sampleRate}
                      onChange={handleChange("sampleRate")}
                      disabled={isTraining}
                    >
                      <MenuItem value={32000}>32kHz</MenuItem>
                      <MenuItem value={40000}>40kHz</MenuItem>
                      <MenuItem value={48000}>48kHz (Best Quality)</MenuItem>
                    </Select>
                  </FormControl>
                </Box>

                <Box sx={{ mb: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      Batch Size
                    </Typography>
                    <Tooltip title="How many audio samples to process simultaneously - higher values use more VRAM">
                      <HelpOutlineIcon fontSize="small" sx={{ color: theme.palette.text.secondary }} />
                    </Tooltip>
                  </Box>
                  <TextField
                    fullWidth
                    type="number"
                    value={config.batchSize}
                    onChange={handleChange("batchSize")}
                    InputProps={{ inputProps: { min: 1, max: 32 } }}
                    size="small"
                    disabled={isTraining}
                  />
                </Box>
              </Box>
            </Grid>

            {/* Training Parameters */}
            <Grid item xs={12} md={6}>
              <Box sx={{
                p: 3,
                backgroundColor: theme.palette.mode === 'dark'
                  ? 'rgba(255, 255, 255, 0.02)'
                  : 'rgba(0, 0, 0, 0.02)',
                borderRadius: 2,
                border: theme => `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'}`,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    Training Parameters
                  </Typography>
                  <Tooltip title="Core training hyperparameters">
                    <HelpOutlineIcon fontSize="small" sx={{ color: theme.palette.text.secondary }} />
                  </Tooltip>
                </Box>

                <Box sx={{ mb: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      Epochs
                    </Typography>
                    <Tooltip title="How many times to train on the entire dataset - more epochs = better results but longer training">
                      <HelpOutlineIcon fontSize="small" sx={{ color: theme.palette.text.secondary }} />
                    </Tooltip>
                  </Box>
                  <TextField
                    fullWidth
                    type="number"
                    value={config.epochs}
                    onChange={handleChange("epochs")}
                    InputProps={{ inputProps: { min: 1, max: 1000 } }}
                    size="small"
                    disabled={isTraining}
                  />
                </Box>

                <Box sx={{ mb: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      Save Every N Epochs
                    </Typography>
                    <Tooltip title="How often to save model checkpoints during training">
                      <HelpOutlineIcon fontSize="small" sx={{ color: theme.palette.text.secondary }} />
                    </Tooltip>
                  </Box>
                  <TextField
                    fullWidth
                    type="number"
                    value={config.saveEvery}
                    onChange={handleChange("saveEvery")}
                    InputProps={{ inputProps: { min: 1 } }}
                    size="small"
                    disabled={isTraining}
                  />
                </Box>

                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      Index Algorithm
                    </Typography>
                    <Tooltip title="Algorithm used for creating the voice index - affects inference speed vs quality">
                      <HelpOutlineIcon fontSize="small" sx={{ color: theme.palette.text.secondary }} />
                    </Tooltip>
                  </Box>
                  <FormControl fullWidth size="small">
                    <Select
                      value={config.indexAlgorithm}
                      onChange={handleChange("indexAlgorithm")}
                      disabled={isTraining}
                    >
                      <MenuItem value="Auto">Auto (Recommended)</MenuItem>
                      <MenuItem value="Flat">Flat (Fast)</MenuItem>
                      <MenuItem value="HNS">HNS (High Quality)</MenuItem>
                    </Select>
                  </FormControl>
                </Box>
              </Box>
            </Grid>

            {/* Voice Features & Optimization */}
            <Grid item xs={12} md={6}>
              <Box sx={{
                p: 3,
                backgroundColor: theme.palette.mode === 'dark'
                  ? 'rgba(255, 255, 255, 0.02)'
                  : 'rgba(0, 0, 0, 0.02)',
                borderRadius: 2,
                border: theme => `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'}`,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    Voice Features & Optimization
                  </Typography>
                  <Tooltip title="Advanced features for voice quality and training optimization">
                    <HelpOutlineIcon fontSize="small" sx={{ color: theme.palette.text.secondary }} />
                  </Tooltip>
                </Box>

                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', gap: 2 }}>
                  <Tooltip title="Enable for better pitch accuracy in singing">
                    <FormControlLabel
                      control={
                        <Switch
                          checked={config.pitchGuidance}
                          onChange={handleChange("pitchGuidance")}
                          size="small"
                          disabled={isTraining}
                        />
                      }
                      label="Use F0 (Pitch Detection)"
                      sx={{ m: 0 }}
                    />
                  </Tooltip>

                  <Tooltip title="Start from a pretrained model for faster convergence">
                    <FormControlLabel
                      control={
                        <Switch
                          checked={config.pretrained}
                          onChange={handleChange("pretrained")}
                          size="small"
                          disabled={isTraining}
                        />
                      }
                      label="Use Pretrained Model"
                      sx={{ m: 0 }}
                    />
                  </Tooltip>

                  <Tooltip title="Automatically stop training if model starts to overfit">
                    <FormControlLabel
                      control={
                        <Switch
                          checked={config.overtrainingDetector}
                          onChange={handleChange("overtrainingDetector")}
                          size="small"
                          disabled={isTraining}
                        />
                      }
                      label="Overtraining Detection"
                      sx={{ m: 0 }}
                    />
                  </Tooltip>

                  <Tooltip title="Faster training but requires more VRAM">
                    <FormControlLabel
                      control={
                        <Switch
                          checked={config.cacheDataInGpu}
                          onChange={handleChange("cacheDataInGpu")}
                          size="small"
                          disabled={isTraining}
                        />
                      }
                      label="Cache Data in GPU"
                      sx={{ m: 0 }}
                    />
                  </Tooltip>
                </Box>
              </Box>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Training Actions */}
      <Box sx={{
        display: 'flex',
        gap: 3,
        justifyContent: 'center',
        alignItems: 'center',
        mt: 4,
        p: 4,
        backgroundColor: theme.palette.mode === 'dark'
        ? 'rgba(10, 132, 255, 0.08)'
        : 'rgba(10, 132, 255, 0.06)',
      border: theme => `1px solid ${theme.palette.mode === 'dark' ? 'rgba(10, 132, 255, 0.2)' : 'rgba(10, 132, 255, 0.15)'}`,
        borderRadius: 3,
      }}>
        <Button
          variant="outlined"
          onClick={onBack}
          size="large"
          disabled={isTraining}
          sx={{
            px: 4,
            py: 1.5,
            borderRadius: 2,
            fontWeight: 600,
            borderColor: theme.palette.mode === 'dark'
              ? 'rgba(255, 255, 255, 0.3)'
              : 'rgba(0, 0, 0, 0.23)',
            '&:hover': {
              borderColor: theme.palette.primary.main,
              backgroundColor: theme.palette.mode === 'dark'
                ? 'rgba(255, 255, 255, 0.08)'
                : 'rgba(0, 0, 0, 0.04)',
            },
          }}
        >
          Back
        </Button>
        <Button
          variant="contained"
          color="primary"
          onClick={startTraining}
          disabled={
            !config.modelName ||
            isTraining ||
            (selectedVocals?.length || 0) === 0
          }
          size="large"
          startIcon={isTraining ? <CircularProgress size={20} /> : <SchoolIcon />}
          sx={{
            px: 6,
            py: 1.5,
            borderRadius: 2,
            fontWeight: 600,
            fontSize: '1.1rem',
           
            boxShadow: theme.palette.mode === 'dark'
            ? '0 6px 20px rgba(10, 132, 255, 0.4)'
            : '0 6px 20px rgba(10, 132, 255, 0.3)',
          '&:hover': {
            boxShadow: theme.palette.mode === 'dark'
              ? '0 8px 25px rgba(10, 132, 255, 0.5)'
              : '0 8px 25px rgba(10, 132, 255, 0.4)',
            transform: 'translateY(-1px)',
          },
            '&:disabled': {
              boxShadow: 'none',
              transform: 'none',
            },
            transition: 'all 0.2s ease',
          }}
        >
          {isTraining ? "Training in Progress..." : "Start Training"}
        </Button>
      </Box>

      {/* Training Completion Dialog */}
      <Dialog
        open={completionDialogOpen}
        onClose={() => setCompletionDialogOpen(false)}
        maxWidth="sm"
        PaperProps={{
          sx: {
            borderRadius: 3,
          },
        }}
        fullWidth
      >
        <DialogTitle sx={{ textAlign: 'center' }}>
           Training Completed Successfully
        </DialogTitle>
        <DialogContent>
          <Box sx={{ textAlign: 'center', py: 2 }}>
            <Typography variant="h6" color="primary" sx={{ mb: 2 }}>
              Model: {config.modelName}
            </Typography>
            <Typography variant="body1" sx={{ mb: 2 }}>
              Your voice model has been trained and is ready for inference!
            </Typography>
            <Alert severity="success" sx={{ mb: 2 }}>
              Model saved to: assets/weights/{config.modelName}.pth
            </Alert>
            <Typography variant="body2" color="text.secondary">
              You can now use this model for voice conversion and inference.
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'center', pb: 3 }}>
          <Button
            variant="outlined"
            onClick={() => setCompletionDialogOpen(false)}
            sx={{ mr: 2, borderRadius: 2 }}
          >
            Stay Here
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={onBack}
            sx={{ borderRadius: 2 }}
          >
            Return to Main Page
          </Button>
        </DialogActions>
      </Dialog>

      {/* File Details Modal */}
      <Dialog
        open={fileDetailsModalOpen}
        onClose={() => setFileDetailsModalOpen(false)}
        maxWidth="md"
        fullWidth
        sx={{
          '& .MuiDialog-paper': {
            backgroundColor: theme.palette.background.paper,
            backgroundImage: 'none',
            borderRadius: 3,
          },
        }}
      >
        <DialogTitle sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          pb: 1,
        }}>
          <AudioFileIcon sx={{ color: theme.palette.primary.main }} />
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            Selected Vocal Files ({selectedVocals?.length || 0})
          </Typography>
        </DialogTitle>
        <DialogContent sx={{ pb: 1 }}>
          <Typography variant="body2" sx={{
            color: theme.palette.text.secondary,
            mb: 3,
          }}>
            These vocal files will be used to train your custom voice model.
          </Typography>

          <Box sx={{
            maxHeight: 400,
            overflowY: 'auto',
            border: theme => `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'}`,
            borderRadius: 2,
            p: 2,
            backgroundColor: theme.palette.mode === 'dark'
              ? 'rgba(255, 255, 255, 0.02)'
              : 'rgba(0, 0, 0, 0.02)',
            '&::-webkit-scrollbar': {
              width: '8px',
            },
            '&::-webkit-scrollbar-track': {
              backgroundColor: theme.palette.mode === 'dark'
                ? 'rgba(255, 255, 255, 0.05)'
                : 'rgba(0, 0, 0, 0.05)',
              borderRadius: '4px',
            },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: theme.palette.mode === 'dark'
                ? 'rgba(255, 255, 255, 0.2)'
                : 'rgba(0, 0, 0, 0.2)',
              borderRadius: '4px',
              '&:hover': {
                backgroundColor: theme.palette.mode === 'dark'
                  ? 'rgba(255, 255, 255, 0.3)'
                  : 'rgba(0, 0, 0, 0.3)',
              },
            },
          }}>
            {selectedVocals && selectedVocals.length > 0 ? (
              <Box sx={{ display: 'grid', gap: 1 }}>
                {selectedVocals.map((track, index) => (
                  <Box
                    key={index}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 2,
                      p: 2,
                      backgroundColor: theme.palette.mode === 'dark'
                        ? 'rgba(255, 255, 255, 0.03)'
                        : 'rgba(0, 0, 0, 0.03)',
                      borderRadius: 1,
                      border: theme => `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)'}`,
                    }}
                  >
                    <Box sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: theme.palette.primary.main,
                      flexShrink: 0,
                    }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography
                        variant="body2"
                        sx={{
                          fontFamily: 'monospace',
                          fontSize: '0.875rem',
                          fontWeight: 500,
                          wordBreak: 'break-all',
                          color: theme.palette.text.primary,
                        }}
                      >
                        {track.vocal}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{
                          color: theme.palette.text.secondary,
                          mt: 0.5,
                        }}
                      >
                        Track: {track.name}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            ) : (
              <Box sx={{
                textAlign: 'center',
                py: 4,
                color: theme.palette.text.secondary,
              }}>
                <AudioFileIcon sx={{ fontSize: 48, opacity: 0.5, mb: 2 }} />
                <Typography variant="body2">
                  No vocal files selected
                </Typography>
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button
            onClick={() => setFileDetailsModalOpen(false)}
            variant="contained"
            color="primary"
            sx={{ borderRadius: 2 }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

export default TrainingView;
