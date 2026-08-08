import React, { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  IconButton,
  Alert
} from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUploadOutlined";
import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import WarningIcon from "@mui/icons-material/WarningOutlined";

function TalkFileUpload({ files, setFiles, setError, loading }) {
  const onDrop = useCallback(
    (acceptedFiles) => {
      // Store files in state
      setFiles((prevFiles) => [...prevFiles, ...acceptedFiles]);
    },
    [setFiles]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "audio/*": [".mp3", ".wav", ".flac", ".m4a"],
    },
  });

  const handleRemoveFile = (index) => {
    setFiles((prevFiles) => prevFiles.filter((_, i) => i !== index));
  };

  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        Upload Audio for Diarization
      </Typography>

      {/* Cleanup Warning Alert */}
      <Alert severity="info" icon={<WarningIcon />} sx={{ mb: 3 }}>
        Upload an audio file with multiple speakers to separate each voice into
        individual clips
      </Alert>

      <Box
        {...getRootProps()}
        sx={{
          border: "2px dashed #90caf9",
          borderRadius: 2,
          p: 3,
          textAlign: "center",
          mb: 3,
          backgroundColor: isDragActive
            ? "rgba(144, 202, 249, 0.1)"
            : "transparent",
          cursor: "pointer",
        }}
      >
        <input {...getInputProps()} />
        <CloudUploadIcon sx={{ fontSize: 48, color: "#90caf9", mb: 1 }} />
        {isDragActive ? (
          <Typography>Drop the audio file here...</Typography>
        ) : (
          <Typography>
            Drag & drop an audio file here, or click to select a file
          </Typography>
        )}
        <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
          Supported formats: MP3, WAV, FLAC, M4A
        </Typography>
      </Box>

      {files.length > 0 && (
        <>
          <Typography variant="h6" gutterBottom>
            Selected File
          </Typography>
          <List>
            {files.map((file, index) => (
              <ListItem
                key={`${file.name}-${index}`}
                secondaryAction={
                  <IconButton
                    edge="end"
                    onClick={() => handleRemoveFile(index)}
                    disabled={loading}
                  >
                    <DeleteIcon />
                  </IconButton>
                }
              >
                <ListItemText
                  primary={file.name}
                  secondary={`${(file.size / 1024 / 1024).toFixed(2)} MB`}
                />
              </ListItem>
            ))}
          </List>

          <Alert severity="success" sx={{ mt: 2 }}>
            Click "Next" to upload this file and begin speaker diarization
          </Alert>
        </>
      )}
    </Box>
  );
}

export default TalkFileUpload;
