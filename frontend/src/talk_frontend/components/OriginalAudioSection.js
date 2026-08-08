import React, { useRef } from "react";
import {
  Box,
  Typography,
  Paper,
  Chip,
  Button,
  FormControl,
  Select,
  MenuItem,
  Alert
} from "@mui/material";
import {
  PlayArrow as PlayIcon,
  Pause as PauseIcon,
  DownloadOutlined as DownloadIcon,
  SwapHoriz as SwapHorizIcon
} from "@mui/icons-material";
import ColoredAudioWaveform from "../../components/ColoredAudioWaveform";
import { formatDuration } from "../utils/audioUtils";

const OriginalAudioSection = ({
  originalAudioUrl,
  playing,
  setPlaying,
  timelineData,
  speakerColors,
  filteredSpeakers,
  setFilteredSpeakers,
  handleTimelineSegmentClick,
  handleSegmentWaveformReady,
  handleMainWaveformTimeUpdate,
  speakerNameMap,
  getDisplayName,
  highlightedSegment,
  speakersList,
  getHighlightedSegmentColor,
  availableSpeakers,
  handleChangeSpeaker,
  segmentPlayerUrl,
  segmentPlayerRef,
  handleSegmentTimeUpdate,
  handleSegmentSeek,
  handleDownloadSegment,
  segmentPlaybackTimer,
  setSegmentPlaybackTimer,
}) => {
  const mainWaveformRef = useRef(null);
  const isHandlingSeekRef = useRef(false);

  // Function to sync segment position
  const syncSegmentPosition = () => {
    if (
      highlightedSegment &&
      segmentPlayerRef.current &&
      mainWaveformRef.current
    ) {
      const mainCurrentTime = mainWaveformRef.current.getCurrentTime();

      // Check if current main position is within this segment
      if (
        mainCurrentTime >= highlightedSegment.start &&
        mainCurrentTime <= highlightedSegment.end
      ) {
        // Calculate relative position within segment
        const segmentTime = mainCurrentTime - highlightedSegment.start;

        // Use the flag to prevent circular updates
        isHandlingSeekRef.current = true;
        try {
          segmentPlayerRef.current.setCurrentTime(segmentTime);
        } finally {
          isHandlingSeekRef.current = false;
        }
      }
    }
  };

  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>
        Original Audio with Speaker Recognition
      </Typography>

      {/* Filter Speakers */}
      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Speaker Filter:
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
          <Chip
            label="Show All"
            onClick={() => setFilteredSpeakers([])}
            color={filteredSpeakers.length === 0 ? "primary" : "default"}
            sx={{
              backgroundColor:
                filteredSpeakers.length === 0 ? "#666666" : "transparent",
              borderColor: "#666666",
              borderWidth: "2px",
              borderStyle: "solid",
              margin: "0 4px",
              color: filteredSpeakers.length === 0 ? "#fff" : "inherit",
            }}
          />
        </Box>
        {filteredSpeakers.length > 0 && (
          <Typography
            variant="caption"
            sx={{ mt: 1, display: "block", color: "text.secondary" }}
          >
            Filtering:{" "}
            {filteredSpeakers.map((s) => getDisplayName(s)).join(", ")}
          </Typography>
        )}
      </Box>

      {/* Original Audio Waveform */}
      {originalAudioUrl ? (
        <>
          <ColoredAudioWaveform
            ref={mainWaveformRef}
            url={originalAudioUrl}
            isPlaying={playing === "original-audio"}
            onPlayPause={() => {
              if (playing === "original-audio") {
                setPlaying(null);
              } else {
                setPlaying("original-audio");
              }
            }}
            segments={timelineData}
            speakerColors={speakerColors}
            filteredSpeakers={filteredSpeakers}
            onSegmentClick={handleTimelineSegmentClick}
            onTimeUpdate={handleMainWaveformTimeUpdate}
            onSeek={(time) => {
              // Prevent circular updates
              if (isHandlingSeekRef.current) return;

              // When seeking in main waveform, update segment waveform if needed
              if (highlightedSegment && segmentPlayerRef.current) {
                // Only update if we're within the segment boundaries
                if (
                  time >= highlightedSegment.start &&
                  time <= highlightedSegment.end
                ) {
                  try {
                    isHandlingSeekRef.current = true;
                    const segmentTime = time - highlightedSegment.start;
                    segmentPlayerRef.current.setCurrentTime(segmentTime);
                  } finally {
                    // Always reset the flag
                    isHandlingSeekRef.current = false;
                  }
                }
              }
            }}
            speakerDisplayNameMap={speakerNameMap}
            getDisplayName={getDisplayName}
          />

          {/* Selected Segment Panel */}
          {highlightedSegment && (
            <SegmentDetailsPanel
              highlightedSegment={highlightedSegment}
              speakersList={speakersList}
              speakerColors={speakerColors}
              getDisplayName={getDisplayName}
              getHighlightedSegmentColor={getHighlightedSegmentColor}
              availableSpeakers={availableSpeakers}
              handleChangeSpeaker={handleChangeSpeaker}
              segmentPlayerUrl={segmentPlayerUrl}
              playing={playing}
              setPlaying={setPlaying}
              segmentPlayerRef={segmentPlayerRef}
              handleSegmentWaveformReady={(waveform) => {
                // First call the original ready handler
                handleSegmentWaveformReady(waveform);
                // Then sync the position
                syncSegmentPosition();
              }}
              handleSegmentTimeUpdate={handleSegmentTimeUpdate}
              handleSegmentSeek={(time) => {
                // Prevent circular updates
                if (isHandlingSeekRef.current) return;

                // When seeking in segment waveform, update main waveform
                if (highlightedSegment && mainWaveformRef.current) {
                  try {
                    isHandlingSeekRef.current = true;
                    const mainTime = highlightedSegment.start + time;
                    const boundedTime = Math.min(
                      Math.max(mainTime, highlightedSegment.start),
                      highlightedSegment.end
                    );
                    mainWaveformRef.current.setCurrentTime(boundedTime);
                  } finally {
                    // Always reset the flag
                    isHandlingSeekRef.current = false;
                  }
                }
              }}
              handleDownloadSegment={handleDownloadSegment}
            />
          )}

          {/* Playback Controls */}
          <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
            <Button
              variant="contained"
              color="primary"
              startIcon={
                playing === "original-audio" ? <PauseIcon /> : <PlayIcon />
              }
              onClick={() => {
                if (playing === "original-audio") {
                  setPlaying(null);
                } else {
                  setPlaying("original-audio");

                  // Clear any existing timer
                  if (segmentPlaybackTimer) {
                    clearTimeout(segmentPlaybackTimer);
                    setSegmentPlaybackTimer(null);
                  }
                }
              }}
              sx={{ mr: 2 }}
            >
              {playing === "original-audio" ? "Pause Audio" : "Play Audio"}
            </Button>
            <Button
              variant="outlined"
              color="primary"
              startIcon={<DownloadIcon />}
              component="a"
              href={originalAudioUrl}
              download
            >
              Download Audio
            </Button>
          </Box>
        </>
      ) : (
        <Alert severity="warning">
          Original audio not available. The file may have been deleted or moved.
        </Alert>
      )}
    </Paper>
  );
};

// Nested component for segment details
const SegmentDetailsPanel = ({
  highlightedSegment,
  speakersList,
  speakerColors,
  getDisplayName,
  getHighlightedSegmentColor,
  availableSpeakers,
  handleChangeSpeaker,
  segmentPlayerUrl,
  playing,
  setPlaying,
  segmentPlayerRef,
  handleSegmentWaveformReady,
  handleSegmentTimeUpdate,
  handleSegmentSeek,
  handleDownloadSegment,
}) => {
  return (
    <Paper
      sx={{
        p: 2,
        mt: 2,
        mb: 2,
        borderLeft: `6px solid ${
          highlightedSegment.speaker === "Unknown"
            ? "#666666"
            : speakerColors[
                speakersList.findIndex(
                  (s) => s.name === highlightedSegment.speaker
                ) % speakerColors.length
              ]
        }`,
        backgroundColor: "rgba(32,32,32,0.8)",
      }}
    >
      <Typography variant="subtitle1" sx={{ fontWeight: "bold" }}>
        Selected Segment
      </Typography>

      <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", flexGrow: 1 }}>
          <Typography variant="body1" fontWeight="medium" sx={{ mr: 1 }}>
            Speaker:
          </Typography>
          <Chip
            label={getDisplayName(highlightedSegment.speaker)}
            sx={{
              backgroundColor: getHighlightedSegmentColor(),
              color: "#fff",
              fontWeight: "bold",
            }}
          />
        </Box>

        <FormControl
          variant="outlined"
          size="small"
          sx={{
            mt: 1,
            width: "auto",
            minWidth: "160px",
            ml: "auto",
            "& .MuiOutlinedInput-root": {
              backgroundColor: "rgba(20,20,30,0.85)",
              borderRadius: 1.5,
              transition: "all 0.2s",
              "&:hover": {
                backgroundColor: "rgba(40,40,60,0.95)",
              },
              "& .MuiSelect-select": {
                paddingY: 0.75,
                paddingX: 1.5,
                color: "white",
                fontSize: "0.85rem",
              },
              "& .MuiSvgIcon-root": {
                color: "rgba(255,255,255,0.7)",
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
            value=""
            onChange={(e) => {
              if (e.target.value) {
                handleChangeSpeaker(e.target.value);
              }
            }}
            displayEmpty
            renderValue={() => (
              <Typography
                sx={{
                  color: "rgba(255,255,255,0.9)",
                  fontSize: "0.85rem",
                  display: "flex",
                  alignItems: "center",
                  gap: 0.8,
                  whiteSpace: "nowrap",
                }}
              >
                <SwapHorizIcon sx={{ fontSize: "0.9rem" }} />
                Change Speaker
              </Typography>
            )}
          >
            {availableSpeakers
              .filter((speaker) => speaker !== highlightedSegment.speaker)
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
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      width: "100%",
                    }}
                  >
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        mr: 1,
                        flexShrink: 0,
                        backgroundColor:
                          speaker === "Unknown"
                            ? "#666666"
                            : speakerColors[
                                speakersList.findIndex(
                                  (s) => s.name === speaker
                                ) % speakerColors.length
                              ],
                      }}
                    />
                    <Typography
                      noWrap
                      sx={{
                        color: "inherit",
                        fontSize: "inherit",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {speaker === "Unknown"
                        ? "No Speech"
                        : getDisplayName(speaker)}
                    </Typography>
                  </Box>
                </MenuItem>
              ))}
          </Select>
        </FormControl>
      </Box>

      <Typography variant="body2">
        <strong>Time:</strong> {formatDuration(highlightedSegment.start)} -{" "}
        {formatDuration(highlightedSegment.end)}
      </Typography>

      {highlightedSegment.text && (
        <Typography variant="body2">
          <strong>Text:</strong> "{highlightedSegment.text}"
        </Typography>
      )}

      {/* Segment-specific AudioWaveform player */}
      <Box sx={{ mt: 2, mb: 2 }}>
        <ColoredAudioWaveform
          url={segmentPlayerUrl}
          isPlaying={playing === "segment"}
          onPlayPause={() => {
            if (playing === "segment") {
              setPlaying(null);
            } else {
              setPlaying("segment");
            }
          }}
          onDownload={() => handleDownloadSegment(highlightedSegment)}
          progressColor={getHighlightedSegmentColor()}
          waveColor={getHighlightedSegmentColor()}
          backgroundColor="#2a2a2a"
          height={80}
          ref={segmentPlayerRef}
          onReady={handleSegmentWaveformReady}
          onTimeUpdate={handleSegmentTimeUpdate}
          onSeek={handleSegmentSeek}
        />
      </Box>
    </Paper>
  );
};

export default OriginalAudioSection;
