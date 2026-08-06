import React, { useState, useRef } from "react";
import {
  Box,
  Typography,
  Button,
  Paper,
  CircularProgress,
  Alert,
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Divider,
} from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import AudioFileIcon from "@mui/icons-material/AudioFile";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import PeopleIcon from "@mui/icons-material/People";
import axios from "axios";

function TalkingDatasetUpload({ onBack }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [processingError, setProcessingError] = useState(null);
  const [processingComplete, setProcessingComplete] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [result, setResult] = useState(null);
  const fileInputRef = useRef(null);

  // For polling job status
  const statusCheckIntervalRef = useRef(null);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setFile(selectedFile);
    setUploadError(null);
    setUploadSuccess(false);
    setProcessing(false);
    setProcessingError(null);
    setProcessingComplete(false);
    setResult(null);
  };

  const handleUpload = async () => {
    if (!file) {
      setUploadError("Please select an audio file first");
      return;
    }

    setUploading(true);
    setUploadError(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await axios.post("/api/upload-talking", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      setUploadSuccess(true);
      console.log("Upload successful:", response.data);

      // Start processing automatically after successful upload
      handleProcess(response.data.filename);
    } catch (error) {
      console.error("Upload error:", error);
      setUploadError(
        error.response?.data?.error ||
          "Failed to upload file. Please try again."
      );
    } finally {
      setUploading(false);
    }
  };

  const handleProcess = async (filename) => {
    setProcessing(true);
    setProcessingError(null);
    setProgress(0);
    setStatusMessage("Starting processing...");

    try {
      const response = await axios.post("/api/process-talking", {
        filename: filename || file.name,
      });

      setJobId(response.data.job_id);
;
    } catch (error) {
      console.error("Processing error:", error);
      setProcessingError(
        error.response?.data?.error ||
          "Failed to process file. Please try again."
      );
      setProcessing(false);
    }
  };

 

  // Clean up interval on component unmount
  React.useEffect(() => {
    return () => {
      if (statusCheckIntervalRef.current) {
        clearInterval(statusCheckIntervalRef.current);
      }
    };
  }, []);

  const handleDownloadDataset = () => {
    if (result && result.output_dir) {
      const datasetName = result.output_dir.split("/").pop();
      window.open(`/api/download-talking-dataset/${datasetName}`, "_blank");
    }
  };

  // Update the formatErrorMessage function to handle more error cases
  const formatErrorMessage = (error) => {
    if (!error) return "Unknown error occurred";

    // Handle specific known errors
    if (
      error.includes("AttributeError: module 'torch.library'") ||
      error.includes("PyTorch version compatibility")
    ) {
      return "PyTorch version compatibility issue. The system is attempting to set up a compatible environment.";
    }

    if (error.includes("HUGGINGFACE_TOKEN")) {
      return "Missing Hugging Face token. Please add it to diarization/pyannote-diarization/config/.env file.";
    }

    if (error.includes("File not found")) {
      return "The uploaded audio file could not be processed. Please try a different format or file.";
    }

    if (error.includes("Diarization environment setup failed")) {
      return "Failed to set up the diarization environment. This may be due to network issues or missing dependencies.";
    }

    if (error.includes("import")) {
      return "Python dependency error. The system is trying to set up the correct environment.";
    }

    // Return the original message for other errors
    return error;
  };

  return (
    <Box>
      <Box sx={{ mb: 4, display: "flex", justifyContent: "space-between" }}>
        <Typography variant="h5">Create Talking Dataset</Typography>
        <Button variant="outlined" onClick={onBack}>
          Back to Home
        </Button>
      </Box>

      <Paper sx={{ p: 3, mb: 4 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Upload Audio File
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Upload an audio file (.wav, .mp3) containing speech. The system will
          identify and separate different speakers.
          <br />
          <br />
          <strong>Note:</strong> The first time you use this feature, the system
          will set up a specialized environment, which may take several minutes.
        </Typography>

        <Box
          sx={{
            border: "2px dashed #ccc",
            borderRadius: 2,
            p: 3,
            textAlign: "center",
            mb: 3,
            cursor: "pointer",
            "&:hover": {
              borderColor: "primary.main",
              backgroundColor: "rgba(0, 0, 0, 0.01)",
            },
          }}
          onClick={() => fileInputRef.current.click()}
        >
          <input
            type="file"
            accept=".wav,.mp3"
            onChange={handleFileChange}
            style={{ display: "none" }}
            ref={fileInputRef}
          />
          <CloudUploadIcon
            sx={{ fontSize: 48, color: "text.secondary", mb: 1 }}
          />
          <Typography variant="body1" sx={{ mb: 1 }}>
            {file ? file.name : "Click to select or drag and drop a file"}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Supported formats: WAV, MP3
          </Typography>
        </Box>

        {file && (
          <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
            <AudioFileIcon sx={{ mr: 1, color: "primary.main" }} />
            <Typography variant="body2">{file.name}</Typography>
          </Box>
        )}

        {uploadError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {uploadError}
          </Alert>
        )}

        <Button
          variant="contained"
          color="primary"
          onClick={handleUpload}
          disabled={!file || uploading || uploadSuccess || processing}
          sx={{ mt: 2 }}
        >
          {uploading ? <CircularProgress size={24} sx={{ mr: 1 }} /> : "Upload"}
          {uploading ? "Uploading..." : "Upload"}
        </Button>
      </Paper>

      {(processing || processingComplete || processingError) && (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Processing
          </Typography>

          {processing && (
            <Box sx={{ width: "100%", mb: 3 }}>
              <LinearProgress
                variant="determinate"
                value={progress}
                sx={{ height: 10, borderRadius: 5, mb: 1 }}
              />
              <Typography variant="body2" color="text.secondary">
                {statusMessage || "Processing audio file..."}
              </Typography>
            </Box>
          )}

          {processingError && (
            <Alert severity="error" sx={{ mb: 3 }}>
              <Typography variant="subtitle1" gutterBottom>
                Processing failed:
              </Typography>
              <Typography variant="body2">
                {formatErrorMessage(processingError)}
              </Typography>
              <Typography variant="body2" sx={{ mt: 2, fontStyle: "italic" }}>
                Try running the setup script: python
                diarization/setup_diarization.py
              </Typography>
            </Alert>
          )}

          {processingComplete && result && (
            <Box>
              <Alert severity="success" sx={{ mb: 3 }}>
                Processing complete! Speaker diarization finished successfully.
              </Alert>

              <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 500 }}>
                <PeopleIcon sx={{ verticalAlign: "middle", mr: 1 }} />
                Speakers Detected: {Object.keys(result.speakers || {}).length}
              </Typography>

              <List sx={{ mb: 3 }}>
                {Object.entries(result.speakers || {}).map(
                  ([speaker, count]) => (
                    <ListItem key={speaker}>
                      <ListItemIcon>
                        <CheckCircleIcon color="success" />
                      </ListItemIcon>
                      <ListItemText
                        primary={`${speaker}`}
                        secondary={`${count} audio segments`}
                      />
                    </ListItem>
                  )
                )}
              </List>

              <Divider sx={{ mb: 3 }} />

              <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                <Button variant="outlined" onClick={onBack}>
                  Back to Home
                </Button>
                <Button
                  variant="contained"
                  color="secondary"
                  onClick={handleDownloadDataset}
                >
                  Download Dataset
                </Button>
              </Box>
            </Box>
          )}
        </Paper>
      )}
    </Box>
  );
}

export default TalkingDatasetUpload;
