import React, { useEffect, useRef, useState } from "react";
import {
  Box,
  IconButton,
  Typography,
  Button,
  Tooltip,
  FormControl,
  Select,
  MenuItem,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import DownloadIcon from "@mui/icons-material/Download";
import ContentCutIcon from "@mui/icons-material/ContentCut";
import CloseIcon from "@mui/icons-material/Close";
import DoneIcon from "@mui/icons-material/Done";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.js";

const SegmentSplitWaveform = (
  {
    url,
    isPlaying,
    onPlayPause,
    onDownload,
    segment,
    height = 70,
    progressColor = "#1976d2",
    waveColor = "#9e9e9e",
    backgroundColor = "#2a2a2a",
    selectionColor = "rgba(255, 165, 0, 0.3)",
    isPrimary = false,
    badgeText = null,
    onReady = () => {},
    onTimeUpdate = () => {},
    onSeek = () => {},
    onSplitSegment = () => {},
    availableSpeakers = [],
    speakerColors = {},
    speakersList = [],
    getDisplayName = (name) => name,
  },
  ref
) => {
  const containerRef = useRef();
  const waveSurferRef = useRef();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState(null);
  const [splitMode, setSplitMode] = useState(false);
  const [targetSpeaker, setTargetSpeaker] = useState("");
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const regionsRef = useRef(null);

  // Create wavesurfer function with regions plugin
  const createWaveSurfer = (audioUrl) => {
    if (containerRef.current) {
      const wavesurfer = WaveSurfer.create({
        container: containerRef.current,
        waveColor: waveColor,
        progressColor: progressColor,
        backgroundColor: backgroundColor,
        height: height,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        cursorWidth: 1,
        cursorColor: "#fff",
        responsive: true,
        normalize: true,
        partialRender: true,
        hideScrollbar: true,
        plugins: [
          RegionsPlugin.create({
            regions: [],
            dragSelection: true,
          }),
        ],
      });

      // Load audio file
      wavesurfer.load(audioUrl);

      // Event handlers
      wavesurfer.on("ready", () => {
        setReady(true);
        setLoading(false);
        setDuration(wavesurfer.getDuration());
        onReady(wavesurfer);
      });

      wavesurfer.on("audioprocess", () => {
        setCurrentTime(wavesurfer.getCurrentTime());
      });

      // Region created by user
      wavesurfer.on("region-created", (region) => {
        // Remove any existing regions first (only allow one selection)
        if (regionsRef.current) {
          regionsRef.current.remove();
        }

        // Store reference to new region
        regionsRef.current = region;

        // Set the selection state
        setSelection({
          start: region.start,
          end: region.end,
        });
      });

      // Region updated by user (drag edges)
      wavesurfer.on("region-updated", (region) => {
        setSelection({
          start: region.start,
          end: region.end,
        });
      });

      // Add seek event handler for when user clicks in the waveform
      wavesurfer.on("seek", function (position) {
        // position is a normalized value between 0 and 1
        const seekTime = position * wavesurfer.getDuration();

        // Set internal time for component state
        setCurrentTime(seekTime);

        // Notify parent component about seek
        if (typeof onSeek === "function") {
          onSeek(seekTime);
        }
      });

      waveSurferRef.current = wavesurfer;
      return wavesurfer;
    }
    return null;
  };

  // Initialize wavesurfer when component mounts
  useEffect(() => {
    if (url && containerRef.current) {
      // Clear any existing wavesurfer instance
      if (waveSurferRef.current) {
        try {
          // Stop playback first
          if (waveSurferRef.current.isPlaying && waveSurferRef.current.isPlaying()) {
            waveSurferRef.current.pause();
          }
          // Clear regions before destroying
          if (waveSurferRef.current.clearRegions) {
            waveSurferRef.current.clearRegions();
          }
          waveSurferRef.current.destroy();
        } catch (err) {
          console.warn("Error destroying existing wavesurfer instance:", err);
        }
        waveSurferRef.current = null;
      }

      // Create a new instance
      const wavesurfer = createWaveSurfer(url);

      // Important: The URL should contain the start/end parameters that WaveSurfer respects
      // The backend should handle streaming just the segment portion

      return () => {
        if (wavesurfer) {
          try {
            // Stop playback first
            if (wavesurfer.isPlaying && wavesurfer.isPlaying()) {
              wavesurfer.pause();
            }
            // Clear regions before destroying
            if (wavesurfer.clearRegions) {
              wavesurfer.clearRegions();
            }
            // Destroy with error handling
            wavesurfer.destroy();
          } catch (err) {
            // Silently handle cleanup errors
            console.warn("Error during wavesurfer cleanup:", err);
          }
        }
      };
    }
  }, [url, segment?.id]); // Re-initialize when segment changes

  // Handle play/pause state
  useEffect(() => {
    if (waveSurferRef.current && ready) {
      if (isPlaying) {
        waveSurferRef.current.play();
      } else {
        waveSurferRef.current.pause();
      }
    }
  }, [isPlaying, ready]);

  // Add time update event handler
  useEffect(() => {
    if (waveSurferRef.current && ready) {
      const updateTimeHandler = (currentTime) => {
        setCurrentTime(currentTime);
        onTimeUpdate(currentTime); // Forward time updates to parent component
      };

      waveSurferRef.current.on("audioprocess", updateTimeHandler);

      return () => {
        if (waveSurferRef.current) {
          waveSurferRef.current.un("audioprocess", updateTimeHandler);
        }
      };
    }
  }, [waveSurferRef.current, ready, onTimeUpdate]);

  // Format time for display (MM:SS.MS)
  const formatTime = (timeInSeconds) => {
    if (!timeInSeconds && timeInSeconds !== 0) return "--:--";

    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    const milliseconds = Math.floor((timeInSeconds % 1) * 100);

    return `${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}.${milliseconds.toString().padStart(2, "0")}`;
  };

  // Clear selection and exit split mode
  const cancelSplit = () => {
    if (regionsRef.current) {
      regionsRef.current.remove();
      regionsRef.current = null;
    }
    setSelection(null);
    setSplitMode(false);
    setTargetSpeaker("");
  };

  // Handle splitting the segment
  const handleSplit = () => {
    if (!selection || !targetSpeaker) return;

    // Call the parent handler with the split information
    onSplitSegment({
      segmentId: segment.id,
      originalSpeaker: segment.speaker,
      newSpeaker: targetSpeaker,
      splitPoints: {
        start: selection.start,
        end: selection.end,
      },
    });

    // Clear selection and exit split mode
    cancelSplit();
  };

  // Toggle split mode
  const toggleSplitMode = () => {
    if (splitMode) {
      cancelSplit();
    } else {
      setSplitMode(true);
    }
  };

  // Add the imperativeHandle for position control
  React.useImperativeHandle(ref, () => ({
    setCurrentTime: (time) => {
      if (waveSurferRef.current && ready) {
        try {
          waveSurferRef.current.setCurrentTime(time);
        } catch (err) {
          console.error("Error setting current time in segment waveform:", err);
        }
      }
    },
    getCurrentTime: () => {
      if (waveSurferRef.current && ready) {
        try {
          return waveSurferRef.current.getCurrentTime();
        } catch (err) {
          console.error(
            "Error getting current time from segment waveform:",
            err
          );
          return 0;
        }
      }
      return 0;
    },
    getDuration: () => {
      if (waveSurferRef.current && ready) {
        try {
          return waveSurferRef.current.getDuration();
        } catch (err) {
          console.error("Error getting duration from segment waveform:", err);
          return 0;
        }
      }
      return 0;
    },
    isReady: () => ready,
  }));

  return (
    <Box sx={{ position: "relative", width: "100%" }}>
      {/* Main waveform */}
      <Box
        ref={containerRef}
        sx={{
          width: "100%",
          height: `${height}px`,
          borderRadius: "4px",
          overflow: "hidden",
          backgroundColor: backgroundColor,
          cursor: splitMode ? "crosshair" : "pointer",
        }}
      />

      {/* Controls */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mt: 1,
        }}
      >
        {/* Left section: Time display */}
        <Typography variant="caption" color="text.secondary">
          {formatTime(currentTime)} / {formatTime(duration)}
        </Typography>
        {/* Middle section: Play/pause and download buttons */}
        <Box sx={{ display: "flex", gap: 1 }}>
          <IconButton
            size="small"
            onClick={onPlayPause}
            disabled={loading}
            sx={{
              backgroundColor: "rgba(20,20,30,0.85)",
              color: "white",
              width: 32,
              height: 32,
              "&:hover": {
                backgroundColor: "rgba(40,40,60,0.95)",
              },
            }}
          >
            {isPlaying ? (
              <PauseIcon fontSize="small" />
            ) : (
              <PlayArrowIcon fontSize="small" />
            )}
          </IconButton>

          <IconButton
            size="small"
            onClick={onDownload}
            disabled={loading}
            sx={{
              backgroundColor: "rgba(20,20,30,0.85)",
              color: "white",
              width: 32,
              height: 32,
              "&:hover": {
                backgroundColor: "rgba(40,40,60,0.95)",
              },
            }}
          >
            <DownloadIcon fontSize="small" />
          </IconButton>

          <Tooltip title={splitMode ? "Cancel split" : "Split segment"}>
            <IconButton
              size="small"
              onClick={toggleSplitMode}
              disabled={loading}
              color={splitMode ? "error" : "default"}
              sx={{
                backgroundColor: splitMode
                  ? "rgba(211,47,47,0.15)"
                  : "rgba(20,20,30,0.85)",
                color: splitMode ? "#f44336" : "white",
                width: 32,
                height: 32,
                "&:hover": {
                  backgroundColor: splitMode
                    ? "rgba(211,47,47,0.25)"
                    : "rgba(40,40,60,0.95)",
                },
              }}
            >
              {splitMode ? (
                <CloseIcon fontSize="small" />
              ) : (
                <ContentCutIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
        </Box>
        {/* Right section: Selection info */}
        {selection && (
          <Typography variant="caption" color="text.secondary">
            Selection: {formatTime(selection.start)} -{" "}
            {formatTime(selection.end)}
          </Typography>
        )}
        {!selection && <Box sx={{ width: 120 }} />}{" "}
        {/* Spacer when no selection */}
      </Box>

      {/* Split controls - only visible when in split mode and has selection */}
      {splitMode && selection && (
        <Box
          sx={{
            mt: 2,
            p: 1.5,
            borderRadius: 2,
            backgroundColor: "rgba(30,30,40,0.7)",
            display: "flex",
            flexDirection: "column",
            gap: 1,
          }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
            Reassign selection {formatTime(selection.start)} -{" "}
            {formatTime(selection.end)} to:
          </Typography>

          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <FormControl
              variant="outlined"
              size="small"
              sx={{
                flexGrow: 1,
                "& .MuiOutlinedInput-root": {
                  backgroundColor: "rgba(20,20,30,0.85)",
                  borderRadius: 1.5,
                  "& .MuiSelect-select": {
                    paddingY: 0.75,
                    color: "white",
                    fontSize: "0.85rem",
                  },
                },
                "& .MuiOutlinedInput-notchedOutline": {
                  borderColor: "transparent",
                },
                "&:hover .MuiOutlinedInput-notchedOutline": {
                  borderColor: "rgba(255,255,255,0.15)",
                },
              }}
            >
              <Select
                value={targetSpeaker}
                onChange={(e) => setTargetSpeaker(e.target.value)}
                displayEmpty
                renderValue={(selected) => {
                  if (!selected) {
                    return (
                      <Typography
                        sx={{
                          color: "rgba(255,255,255,0.5)",
                          fontSize: "0.85rem",
                        }}
                      >
                        Select Speaker
                      </Typography>
                    );
                  }
                  return (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Box
                        sx={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          backgroundColor:
                            selected === "Unknown"
                              ? "#666666"
                              : speakerColors[
                                  speakersList.findIndex(
                                    (s) => s.name === selected
                                  ) % Object.keys(speakerColors).length
                                ],
                        }}
                      />
                      <Typography sx={{ fontSize: "0.85rem" }}>
                        {selected === "Unknown"
                          ? "No Speech"
                          : getDisplayName(selected)}
                      </Typography>
                    </Box>
                  );
                }}
              >
                {availableSpeakers
                  .filter((speaker) => speaker !== segment.speaker)
                  .map((speaker) => (
                    <MenuItem
                      key={speaker}
                      value={speaker}
                      sx={{
                        fontSize: "0.85rem",
                        "&:hover": {
                          backgroundColor: "rgba(30,144,255,0.1)",
                        },
                      }}
                    >
                      <Box
                        sx={{ display: "flex", alignItems: "center", gap: 1 }}
                      >
                        <Box
                          sx={{
                            width: 12,
                            height: 12,
                            borderRadius: "50%",
                            backgroundColor:
                              speaker === "Unknown"
                                ? "#666666"
                                : speakerColors[
                                    speakersList.findIndex(
                                      (s) => s.name === speaker
                                    ) % Object.keys(speakerColors).length
                                  ],
                          }}
                        />
                        <Typography>
                          {speaker === "Unknown"
                            ? "No Speech"
                            : getDisplayName(speaker)}
                        </Typography>
                      </Box>
                    </MenuItem>
                  ))}
              </Select>
            </FormControl>

            <Button
              variant="contained"
              size="small"
              startIcon={<SwapHorizIcon />}
              disabled={!targetSpeaker}
              onClick={handleSplit}
              sx={{
                backgroundColor: "rgba(30,144,255,0.8)",
                "&:hover": {
                  backgroundColor: "rgba(30,144,255,1)",
                },
                "&.Mui-disabled": {
                  backgroundColor: "rgba(30,144,255,0.3)",
                },
              }}
            >
              Reassign
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default React.forwardRef(SegmentSplitWaveform);
