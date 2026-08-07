import React, { useState, useEffect } from "react";
import {
  Box,
  Stepper,
  Step,
  StepLabel,
  Button,
  Typography,
  Paper,
  Container,
  CircularProgress,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import TalkFileUpload from "./TalkFileUpload";
import TalkProcessingStatus from "./TalkProcessingStatus";
import TalkDownloadResults from "./TalkDownloadResults";
import { devLog } from "../utils/logger";

const steps = ["Upload Audio", "Process", "Results"];

const StyledPaper = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(4),
  marginBottom: theme.spacing(4),
}));

function TalkWorkflowPage({ onBack, handleTrainWithDataset }) {
  const [activeStep, setActiveStep] = useState(0);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [pollingInterval, setPollingInterval] = useState(null);
  const [pollingCount, setPollingCount] = useState(0);
  const MAX_POLLING_ATTEMPTS = 300; // Stop polling after ~10 minutes (300 * 2 seconds)

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [pollingInterval]);

  // Poll for job status
  useEffect(() => {
    let intervalId = null;

    if (jobId && processing) {
      devLog(`Setting up polling for job ${jobId}...`);

      const checkStatus = () => {
        devLog(`Checking status for job ${jobId}...`);

        // Increment polling count
        setPollingCount((prev) => {
          const newCount = prev + 1;
          // Stop polling after max attempts
          if (newCount >= MAX_POLLING_ATTEMPTS) {
            devLog(
              `Reached max polling attempts (${MAX_POLLING_ATTEMPTS}), stopping poll`
            );
            if (intervalId) {
              clearInterval(intervalId);
              intervalId = null;
            }
            setProcessing(false);
            setError(
              "Polling timed out. The process may still be running in the background."
            );
            return newCount;
          }
          return newCount;
        });

        fetch(`/api/talking-status/${jobId}`)
          .then((res) => {
            devLog("Status response:", res.status, res.statusText);
            if (!res.ok) {
              throw new Error(
                `Status response error: ${res.status} ${res.statusText}`
              );
            }
            return res.json();
          })
          .then((data) => {
            devLog("Job status data:", data);
            setJobStatus(data);

            // Check if job is complete and move to results step
            if (data.status === "completed" || data.status === "failed") {
              devLog("Job complete, moving to results step");
              setProcessing(false);
              setActiveStep(2); // Move to results step

              // Clear polling
              if (intervalId) {
                devLog("Clearing polling interval");
                clearInterval(intervalId);
                intervalId = null;
              }
            }
          })
          .catch((err) => {
            // Don't log AbortError as it's expected when component unmounts
            if (err.name !== 'AbortError') {
              console.error("Error checking job status:", err);
              setError(`Failed to get processing status: ${err.message}`);

              // Also stop polling on error
              if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
              }
            }
          });
      };

      // Check immediately
      checkStatus();

      // Set up polling
      intervalId = setInterval(checkStatus, 2000);

      // Store interval ID for cleanup in other functions
      setPollingInterval(intervalId);
    }

    // Cleanup function
    return () => {
      if (intervalId) {
        devLog("Cleaning up polling interval on component unmount");
        clearInterval(intervalId);
      }
    };
  }, [jobId, processing]);

  useEffect(() => {
    devLog("TalkWorkflowPage - currentStep:", activeStep);
    devLog("TalkWorkflowPage - jobStatus:", jobStatus);
  }, [activeStep, jobStatus]);

  const handleStartProcessing = () => {
    if (files.length === 0) {
      setError("Please upload a file first");
      return;
    }

    setLoading(true);
    setError(null);

    // Create form data with the file
    const formData = new FormData();
    formData.append("audio", files[0]);

    // Submit the file for processing - use the correct endpoint
    fetch("/api/upload-talking", {
      // Changed from "/api/start-talking"
      method: "POST",
      body: formData,
    })
      .then((res) => res.json())
      .then((data) => {
        devLog("Processing started:", data);
        if (data.job_id) {
          setJobId(data.job_id);
          setProcessing(true);
          setActiveStep(1); // Move to processing step
        } else {
          setError(data.error || "Failed to start processing");
        }
      })
      .catch((err) => {
        console.error("Error starting processing:", err);
        setError("Failed to start processing: " + err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const handleNext = () => {
    if (activeStep === 0) {
      // Handle upload step
      handleStartProcessing();
    } else if (activeStep === 1) {
      // Only proceed to results if processing is complete
      if (
        jobStatus &&
        (jobStatus.status === "completed" || jobStatus.status === "failed")
      ) {
        setActiveStep((prevActiveStep) => prevActiveStep + 1);
      }
    } else {
      // Reset for other steps
      setActiveStep((prevActiveStep) => prevActiveStep + 1);
    }
  };

  const handleBack = () => {
    if (activeStep > 0) {
      setActiveStep((prevActiveStep) => prevActiveStep - 1);
    } else if (onBack) {
      // Only call onBack if we're at the first step
      onBack();
    }
  };

  const handleReset = () => {
    setActiveStep(0);
    setFiles([]);
    setError(null);
    setLoading(false);
    setProcessing(false);
    setJobId(null);
    setJobStatus(null);

    if (pollingInterval) {
      clearInterval(pollingInterval);
      setPollingInterval(null);
    }
  };

  // Get content for current step
  const getStepContent = (step) => {
    switch (step) {
      case 0:
        return (
          <TalkFileUpload
            onUpload={handleNext}
            files={files}
            setFiles={setFiles}
          />
        );
      case 1:
        return (
          <TalkProcessingStatus
            jobId={jobId}
            jobStatus={jobStatus}
            forceNextStep={() => setActiveStep(2)}
          />
        );
      case 2:
        devLog("Rendering TalkDownloadResults with jobStatus:", jobStatus);
        return (
          
          <TalkDownloadResults
            jobStatus={jobStatus}
            handleReset={handleReset}
            onTrainWithSpeaker={handleTrainWithDataset}
          />
          
        );
      default:
        return "Unknown step";
    }
  };

  return (
    <Container maxWidth="lg">
      <Box sx={{ width: "100%", mt: 4 }}>
        <Typography variant="h4" gutterBottom align="center">
          Speaker Diarization
        </Typography>

        <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {error && (
          <Typography color="error" sx={{ mt: 2, mb: 2, textAlign: "center" }}>
            {error}
          </Typography>
        )}

        <StyledPaper>{getStepContent(activeStep)}</StyledPaper>

        <Box sx={{ display: "flex", justifyContent: "space-between" }}>
          <Button
            variant="outlined"
            disabled={
              (activeStep === 0 && !onBack) || (activeStep === 1 && processing)
            }
            onClick={handleBack}
          >
            {activeStep === 0 ? "Back to Home" : "Back"}
          </Button>
          <Box sx={{ flexGrow: 1 }} />
          <Button
            variant="contained"
            color="primary"
            onClick={handleNext}
            disabled={
              (activeStep === 0 && files.length === 0) ||
              loading ||
              (activeStep === 1 && processing)
            }
            startIcon={
              loading || (activeStep === 1 && processing) ? (
                <CircularProgress size={20} color="inherit" />
              ) : null
            }
          >
            {activeStep === steps.length - 1
              ? "Process New Audio"
              : activeStep === 1 && processing
              ? "Processing..."
              : "Next"}
          </Button>
        </Box>
      </Box>
    </Container>
  );
}

export default TalkWorkflowPage;
