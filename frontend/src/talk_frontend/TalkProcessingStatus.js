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
  Button,
} from "@mui/material";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import RecordVoiceOverIcon from "@mui/icons-material/RecordVoiceOver";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import WarningIcon from "@mui/icons-material/Warning";

function TalkProcessingStatus({ jobStatus, forceNextStep }) {
  if (!jobStatus) {
    return (
      <Box sx={{ textAlign: "center", py: 4 }}>
        <Typography variant="h6" gutterBottom>
          Starting diarization...
        </Typography>
        <LinearProgress />
      </Box>
    );
  }

  // Calculate elapsed time
  const elapsedTime = Math.floor(Date.now() / 1000 - jobStatus.started_at);
  const minutes = Math.floor(elapsedTime / 60);
  const seconds = elapsedTime % 60;

  // Get log entries for display
  const logEntries = jobStatus.detailed_logs || [];
  const recentLogs = logEntries.slice(-5).reverse();

  // Helper to get icon based on log level
  const getStatusIcon = (level) => {
    switch (level.toUpperCase()) {
      case "ERROR":
        return <ErrorIcon color="error" />;
      case "WARNING":
        return <WarningIcon color="warning" />;
      case "SUCCESS":
        return <CheckCircleIcon color="success" />;
      default:
        return <RecordVoiceOverIcon color="primary" />;
    }
  };

  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        Processing Audio
      </Typography>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={6}>
            <Typography variant="h6">
              Status:{" "}
              {jobStatus.status.charAt(0).toUpperCase() +
                jobStatus.status.slice(1)}
            </Typography>
            {jobStatus.message && (
              <Typography variant="body2" color="textSecondary">
                {jobStatus.message}
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
                Diarization Progress
              </Typography>
            </Grid>
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

        {/* Recent log messages */}
        {recentLogs.length > 0 && (
          <Box sx={{ mt: 3 }}>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              Recent Activity
            </Typography>
            <List dense sx={{ bgcolor: "background.paper", borderRadius: 1 }}>
              {recentLogs.map((log, index) => (
                <React.Fragment key={index}>
                  {index > 0 && <Divider component="li" />}
                  <ListItem>
                    {getStatusIcon(log.level)}
                    <ListItemText
                      primary={log.message}
                      secondary={`${log.time} (${log.elapsed})`}
                      primaryTypographyProps={{
                        color:
                          log.level.toUpperCase() === "ERROR"
                            ? "error"
                            : "textPrimary",
                        fontWeight: index === 0 ? "bold" : "regular",
                      }}
                    />
                  </ListItem>
                </React.Fragment>
              ))}
            </List>
          </Box>
        )}

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
          ? "Processing complete! You can now download your speaker segments."
          : "Please wait while your audio is being analyzed. This may take several minutes depending on file size and number of speakers."}
      </Typography>

      {process.env.NODE_ENV === "development" && (
        <Box sx={{ mt: 2 }}>
          <Button
            variant="outlined"
            color="secondary"
            onClick={() => {
              console.log(
                "Force proceeding to results with jobStatus:",
                jobStatus
              );
              if (forceNextStep) forceNextStep();
            }}
          >
            Debug: Force Proceed to Results
          </Button>
        </Box>
      )}

      {process.env.NODE_ENV === "development" && (
        <Box sx={{ mt: 2 }}>
          <Button
            variant="outlined"
            color="warning"
            onClick={() => {
              window.open(`/api/debug-job/${jobStatus.job_id}`, "_blank");
            }}
          >
            Debug: View Full Job Data
          </Button>
        </Box>
      )}
    </Box>
  );
}

export default TalkProcessingStatus;
