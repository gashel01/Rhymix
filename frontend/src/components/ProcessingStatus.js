import React from "react";
import {
  Box,
  Typography,
  LinearProgress,
  Paper,
  Chip,
  Grid,
  List,
  ListItem,
  ListItemText,
  Divider,
} from "@mui/material";
import AccessTimeIcon from "@mui/icons-material/AccessTimeOutlined";
import MusicNoteIcon from "@mui/icons-material/MusicNoteOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircleOutlined";
import ErrorIcon from "@mui/icons-material/ErrorOutlined";
import WarningIcon from "@mui/icons-material/WarningOutlined";

function ProcessingStatus({ jobStatus }) {
  if (!jobStatus) {
    return (
      <Box sx={{ textAlign: "center", py: 4 }}>
        <Typography variant="h6" gutterBottom>
          Starting processing...
        </Typography>
        <LinearProgress />
      </Box>
    );
  }

  // Calculate elapsed time
  const elapsedTime = Math.floor(Date.now() / 1000 - jobStatus.started_at);
  const minutes = Math.floor(elapsedTime / 60);
  const seconds = elapsedTime % 60;

  // Helper to get icon based on message
  const getStatusIcon = (message) => {
    if (message.includes("✅")) return <CheckCircleIcon color="success" />;
    if (message.includes("❌")) return <ErrorIcon color="error" />;
    if (message.includes("Processing"))
      return <MusicNoteIcon color="primary" />;
    return message.includes("Warning") ? <WarningIcon color="warning" /> : null;
  };

  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        Processing Files
      </Typography>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={6}>
            <Typography variant="h6">
              Status:{" "}
              {jobStatus.status.charAt(0).toUpperCase() +
                jobStatus.status.slice(1)}
            </Typography>
            {jobStatus.status_message && (
              <Typography variant="body2" color="textSecondary">
                {jobStatus.status_message}
              </Typography>
            )}
          </Grid>
          <Grid item xs={12} sm={6} sx={{ textAlign: "right" }}>
            <Chip
              icon={<AccessTimeIcon />}
              label={`${minutes}m ${seconds}s`}
              color="primary"
              variant="outlined"
            />
          </Grid>
        </Grid>

        <Box sx={{ mt: 3 }}>
          <Grid container spacing={2} sx={{ mb: 1 }} alignItems="center">
            <Grid item xs>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                Overall Progress
              </Typography>
            </Grid>
            {jobStatus.current_file && jobStatus.total_files && (
              <Grid item>
                <Chip
                  size="small"
                  label={`File ${jobStatus.current_file} of ${jobStatus.total_files}`}
                  color="primary"
                />
              </Grid>
            )}
          </Grid>
          <LinearProgress
            variant="determinate"
            value={jobStatus.progress || 0}
            sx={{ height: 10, borderRadius: 5 }}
          />
          <Typography variant="body2" align="right" sx={{ mt: 0.5 }}>
            {jobStatus.progress || 0}%
          </Typography>
        </Box>

        {/* File-specific progress if available */}
        {jobStatus.file_progress &&
          jobStatus.current_file > 0 &&
          jobStatus.total_files > 0 && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                Current File Progress
              </Typography>
              <LinearProgress
                variant="determinate"
                value={jobStatus.file_progress}
                sx={{ height: 8, borderRadius: 5 }}
              />
              <Typography
                variant="caption"
                color="textSecondary"
                sx={{ mt: 0.5 }}
              >
                {jobStatus.current_file} of {jobStatus.total_files} files (
                {jobStatus.file_progress}%)
              </Typography>
            </Box>
          )}

        {/* Processing steps history */}
        {jobStatus.steps && jobStatus.steps.length > 0 && (
          <Box sx={{ mt: 3 }}>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              Processing Steps
            </Typography>
            <List dense sx={{ bgcolor: "background.paper", borderRadius: 1 }}>
              {jobStatus.steps.map((step, index) => (
                <React.Fragment key={index}>
                  {index > 0 && <Divider component="li" />}
                  <ListItem>
                    {getStatusIcon(step.message)}
                    <ListItemText
                      primary={step.message}
                      primaryTypographyProps={{
                        color: step.message.includes("❌")
                          ? "error"
                          : "textPrimary",
                        fontWeight:
                          index === jobStatus.steps.length - 1
                            ? "bold"
                            : "regular",
                      }}
                    />
                  </ListItem>
                </React.Fragment>
              ))}
            </List>
          </Box>
        )}

        <Box sx={{ mt: 3 }}>
          <Typography variant="body2" color="textSecondary" gutterBottom>
            Configuration
          </Typography>
          <Grid container spacing={1}>
            <Grid item>
              <Chip
                label={
                  jobStatus.config?.process
                    ? "Processing: On"
                    : "Processing: Off"
                }
                variant="outlined"
                size="small"
              />
            </Grid>
            <Grid item>
              <Chip
                label={jobStatus.config?.export ? "Export: On" : "Export: Off"}
                variant="outlined"
                size="small"
              />
            </Grid>
            <Grid item>
              <Chip
                label={jobStatus.config?.clean ? "Clean: On" : "Clean: Off"}
                variant="outlined"
                size="small"
              />
            </Grid>
          </Grid>
        </Box>

        {jobStatus.error && (
          <Box sx={{ mt: 3, p: 2, bgcolor: "#ff000022", borderRadius: 1 }}>
            <Typography color="error" variant="subtitle2">
              Error:
            </Typography>
            <Typography color="error" variant="body2">
              {jobStatus.error}
            </Typography>
          </Box>
        )}
      </Paper>

      <Typography variant="body1" color="textSecondary" align="center">
        {jobStatus.status === "completed"
          ? "Processing complete! You can now download your results."
          : "Please wait while your audio files are being processed. This may take several minutes depending on file size and selected options."}
      </Typography>
    </Box>
  );
}

export default ProcessingStatus;
