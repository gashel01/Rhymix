import React, { useMemo } from "react";
import {
  Box,
  Typography,
  Grid,
  Paper,
  Card,
  CardContent,
  CardActions,
  Button,
  IconButton,
} from "@mui/material";
import {
  PlayArrow as PlayIcon,
  DownloadOutlined as DownloadIcon,
  Edit as EditIcon,
  School as SchoolIcon,
} from "@mui/icons-material";
import { styled } from "@mui/material/styles";
import { formatDuration } from "../utils/audioUtils";

// Styled components
const SpeakerCard = styled(Card)(({ theme, color }) => ({
  position: "relative",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  transition: "transform 0.2s ease-in-out",
  "&:hover": {
    transform: "translateY(-5px)",
    boxShadow: theme.shadows[8],
  },
  "&::before": {
    content: '""',
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "6px",
    backgroundColor: color || theme.palette.primary.main,
    borderTopLeftRadius: theme.shape.borderRadius,
    borderTopRightRadius: theme.shape.borderRadius,
  },
}));

const SpeakerAnalysisSection = ({
  speakersList,
  timelineData,
  totalDuration,
  filteredSpeakers,
  getDisplayName,
  handleSpeakerFilter,
  handleOpenRenameDialog,
  handlePlaySample,
  handleDownloadSpeaker,
  handleTrainWithSpeaker,
  playing,
}) => {
  // Calculate unknown segments data
  const unknownData = useMemo(() => {
    const unknownSegments = timelineData.filter(
      (segment) => segment.speaker === "Unknown"
    );

    // Calculate total unknown time
    const totalUnknownDuration = unknownSegments.reduce(
      (total, segment) => total + (segment.end - segment.start),
      0
    );

    // Calculate unknown percentage
    const unknownPercentage = totalDuration
      ? (totalUnknownDuration / totalDuration) * 100
      : 0;

    return {
      segments: unknownSegments,
      duration: totalUnknownDuration,
      percentage: unknownPercentage,
    };
  }, [timelineData, totalDuration]);

  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Typography variant="h6" sx={{ mb: 3 }}>
        Speaker Analysis
      </Typography>

      <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
        {speakersList.filter((s) => s.name !== "Unknown").length} speakers
        identified with {timelineData.length} total segments over{" "}
        {formatDuration(totalDuration)}
      </Typography>

      <Grid container spacing={3}>
        {/* Regular Speaker Cards */}
        {speakersList
          .filter((speaker) => speaker.name !== "Unknown")
          .map((speaker) => {
            // Calculate speaker's percentage of total audio
            const speakerSegments = timelineData.filter(
              (segment) => segment.speaker === speaker.name
            );
            const speakerDuration = speakerSegments.reduce(
              (total, segment) => total + (segment.end - segment.start),
              0
            );
            const percentage = totalDuration
              ? (speakerDuration / totalDuration) * 100
              : 0;

            return (
              <Grid item xs={12} sm={6} md={4} key={speaker.name}>
                <SpeakerCard
                  color={speaker.color}
                  sx={{
                    cursor: "pointer",
                    border: filteredSpeakers.includes(speaker.name)
                      ? "2px solid #fff"
                      : "none",
                    boxShadow: filteredSpeakers.includes(speaker.name)
                      ? "0 0 15px rgba(255,255,255,0.3)"
                      : "none",
                  }}
                  onClick={() => handleSpeakerFilter(speaker.name)}
                >
                  <CardContent>
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        mb: 1,
                      }}
                    >
                      <Typography
                        variant="h6"
                        component="div"
                        sx={{ fontWeight: "bold" }}
                      >
                        {getDisplayName(speaker.name)}
                      </Typography>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation(); // Prevent card click from triggering
                          handleOpenRenameDialog(speaker.name);
                        }}
                        sx={{ ml: 1 }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Box>
                    <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
                      <Box
                        sx={{
                          width: "100%",
                          mr: 1,
                          backgroundColor: "rgba(255,255,255,0.1)",
                          borderRadius: 1,
                        }}
                      >
                        <Box
                          sx={{
                            width: `${percentage}%`,
                            height: 8,
                            backgroundColor: speaker.color,
                            borderRadius: 1,
                          }}
                        />
                      </Box>
                      <Typography
                        variant="body2"
                        color="textSecondary"
                        sx={{ minWidth: 35 }}
                      >
                        {percentage.toFixed(1)}%
                      </Typography>
                    </Box>
                    <Typography variant="body2" sx={{ mb: 0.5 }}>
                      {speakerSegments.length} segments ·{" "}
                      {formatDuration(speakerDuration)}
                    </Typography>
                  </CardContent>
                  <CardActions sx={{ mt: "auto", flexWrap: "wrap", gap: 1 }}>
                    <Button
                      size="small"
                      startIcon={<PlayIcon />}
                      onClick={(e) => {
                        e.stopPropagation(); // Prevent card click from triggering
                        handlePlaySample(speaker.name);
                      }}
                    >
                      Preview
                    </Button>
                    <Button
                      size="small"
                      startIcon={<DownloadIcon />}
                      onClick={(e) => {
                        e.stopPropagation(); // Prevent card click from triggering
                        handleDownloadSpeaker(speaker.name);
                      }}
                    >
                      Download
                    </Button>
                    {handleTrainWithSpeaker && (
                      <Button
                        size="small"
                        startIcon={<SchoolIcon />}
                        onClick={(e) => {
                          e.stopPropagation(); // Prevent card click from triggering
                         
                          handleTrainWithSpeaker(speaker.name, speakerSegments);
                        }}
                        color="secondary"
                        variant="outlined"
                        fullWidth
                        sx={{ mt: 1 }}
                      >
                      
                        Train with Speaker
                      </Button>
                    )}
                  </CardActions>
                </SpeakerCard>
              </Grid>
            );
          })}

        {/* "No Speech" Card - Always show it */}
        <Grid item xs={12} sm={6} md={4}>
          <SpeakerCard
            color="#666666"
            sx={{
              cursor: "pointer",
              border: filteredSpeakers.includes("Unknown")
                ? "2px solid #fff"
                : "none",
              boxShadow: filteredSpeakers.includes("Unknown")
                ? "0 0 15px rgba(255,255,255,0.3)"
                : "none",
            }}
            onClick={() => handleSpeakerFilter("Unknown")}
          >
            <CardContent>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  mb: 1,
                }}
              >
                <Typography
                  variant="h6"
                  component="div"
                  sx={{ fontWeight: "bold" }}
                >
                  {getDisplayName("Unknown")}
                </Typography>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation(); // Prevent card click from triggering
                    handleOpenRenameDialog("Unknown");
                  }}
                  sx={{ ml: 1 }}
                >
                  <EditIcon fontSize="small" />
                </IconButton>
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
                <Box
                  sx={{
                    width: "100%",
                    mr: 1,
                    backgroundColor: "rgba(255,255,255,0.1)",
                    borderRadius: 1,
                  }}
                >
                  <Box
                    sx={{
                      width: `${unknownData.percentage}%`,
                      height: 8,
                      backgroundColor: "#666666",
                      borderRadius: 1,
                    }}
                  />
                </Box>
                <Typography
                  variant="body2"
                  color="textSecondary"
                  sx={{ minWidth: 35 }}
                >
                  {unknownData.percentage.toFixed(1)}%
                </Typography>
              </Box>
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                {unknownData.segments.length} segments ·{" "}
                {formatDuration(unknownData.duration)}
              </Typography>
            </CardContent>
          </SpeakerCard>
        </Grid>
      </Grid>
    </Paper>
  );
};

export default SpeakerAnalysisSection;
