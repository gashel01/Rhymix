import React from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  TableContainer,
  Table,
  TableHead,
  TableBody,
  TableCell,
  TableRow,
  Paper,
  IconButton,
} from "@mui/material";
import { DownloadOutlined as DownloadIcon } from "@mui/icons-material";
import AudioWaveform from "../../components/AudioWaveform";

const SpeakerPreviewDialog = ({
  open,
  onClose,
  selectedSpeaker,
  currentSamples,
  playing,
  setPlaying,
  getDisplayName,
  handleDownloadSegment,
  handleWaveformReady,
  handleDownloadSpeaker,
  formatDuration,
}) => {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {selectedSpeaker?.name ? getDisplayName(selectedSpeaker.name) : ""} -{" "}
        {selectedSpeaker?.segmentCount} Segments
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="textSecondary" paragraph>
          Preview and play individual segments for this speaker
        </Typography>

        <TableContainer
          component={Paper}
          variant="outlined"
          sx={{ maxHeight: "60vh", overflow: "auto" }}
        >
          <Table stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell
                  sx={{
                    fontWeight: "bold",
                    bgcolor: "#121212",
                    position: "sticky",
                    top: 0,
                    zIndex: 100,
                  }}
                >
                  Segment
                </TableCell>
                <TableCell
                  sx={{
                    width: "70%",
                    bgcolor: "#121212",
                    position: "sticky",
                    top: 0,
                    zIndex: 100,
                  }}
                >
                  Waveform
                </TableCell>
                <TableCell
                  sx={{
                    width: "15%",
                    bgcolor: "#121212",
                    position: "sticky",
                    top: 0,
                    zIndex: 100,
                  }}
                >
                  Duration
                </TableCell>
                <TableCell
                  sx={{
                    width: "15%",
                    bgcolor: "#121212",
                    position: "sticky",
                    top: 0,
                    zIndex: 100,
                  }}
                >
                  Actions
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {currentSamples.length > 0 ? (
                currentSamples.map((sample) => (
                  <TableRow key={sample.id}>
                    <TableCell>{sample.name}</TableCell>
                    <TableCell>
                      <AudioWaveform
                        url={sample.url}
                        isPlaying={playing === `sample-${sample.id}`}
                        onPlayPause={() => {
                          if (playing === `sample-${sample.id}`) {
                            setPlaying(null);
                          } else {
                            if (playing) {
                              setPlaying(null);
                            }
                            setPlaying(`sample-${sample.id}`);
                          }
                        }}
                        onDownload={() => handleDownloadSegment(sample)}
                        progressColor="#ff9800"
                        waveColor="#9e9e9e"
                        backgroundColor="#2a2a2a"
                        onReady={(waveform) =>
                          handleWaveformReady(`sample-${sample.id}`, waveform)
                        }
                      />
                    </TableCell>
                    <TableCell>{formatDuration(sample.duration)}</TableCell>
                    <TableCell>
                      <IconButton
                        edge="end"
                        aria-label="download"
                        onClick={() => handleDownloadSegment(sample)}
                      >
                        <DownloadIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} align="center">
                    <Typography variant="body2" color="textSecondary">
                      No segments available for preview
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>

        {selectedSpeaker?.segmentCount > currentSamples.length && (
          <Typography
            variant="body2"
            color="textSecondary"
            align="center"
            sx={{ mt: 2 }}
          >
            Showing {currentSamples.length} of {selectedSpeaker.segmentCount}{" "}
            segments. Download to access all.
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button
          variant="contained"
          color="primary"
          startIcon={<DownloadIcon />}
          onClick={() => handleDownloadSpeaker(selectedSpeaker?.name)}
        >
          Download All{" "}
          {selectedSpeaker ? getDisplayName(selectedSpeaker.name) : ""} Segments
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SpeakerPreviewDialog;
