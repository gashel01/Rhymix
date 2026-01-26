import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import {
  Box,
  Typography,
  Grid,
  Button,
  Paper,
  Chip,
  Tab,
  Tabs,
  Card,
  CardContent,
  CardActions,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Table,
  TableHead,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  TextField,
  FormControl,
  Select,
  MenuItem,
} from "@mui/material";
import {
  DownloadOutlined as DownloadIcon,
  PlayArrow as PlayIcon,
  Pause as PauseIcon,
  Replay as ReplayIcon,
  CloudDownload as CloudDownloadIcon,
  FolderZip as ZipIcon,
  Person as PersonIcon,
  Stop as StopIcon,
  Refresh as RefreshIcon,
  Timeline as TimelineIcon,
  Audiotrack as AudiotrackIcon,
  Textsms as TextsmsIcon,
  FilterNone as FilterNoneIcon,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon,
  Fullscreen as FullscreenIcon,
  NavigateBefore as NavigateBeforeIcon,
  NavigateNext as NavigateNextIcon,
  Edit as EditIcon,
  SwapHoriz as SwapHorizIcon,
  School as SchoolIcon,
} from "@mui/icons-material";
import AudioWaveform from "../components/AudioWaveform";
import ColoredAudioWaveform from "../components/ColoredAudioWaveform";
import { styled } from "@mui/material/styles";

// Component imports
import SpeakerAnalysisSection from "./components/SpeakerAnalysisSection";
import OriginalAudioSection from "./components/OriginalAudioSection";
import SpeakerPreviewDialog from "./components/SpeakerPreviewDialog";
import SpeakerRenameDialog from "./components/SpeakerRenameDialog";

// Utils
import {
  formatDuration,
  getSpeakerColor,
  speakerColors,
} from "./utils/audioUtils";

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

function TalkDownloadResults({
  jobStatus,
  handleReset,
  showHeader = true,
  onTrainWithSpeaker,
}) {
  // Core state
  const [playing, setPlaying] = useState(null);
  const [error, setError] = useState(null);
  const [currentTab, setCurrentTab] = useState(0);
  const [timelineData, setTimelineData] = useState([]);
  const [originalAudioUrl, setOriginalAudioUrl] = useState(null);
  const [totalDuration, setTotalDuration] = useState(0);

  // Audio playback state
  const [waveforms, setWaveforms] = useState({});
  const [audioWavesurfer, setAudioWavesurfer] = useState(null);
  const [segmentPlaybackTimer, setSegmentPlaybackTimer] = useState(null);
  const segmentPlayerRef = useRef(null);

  // Speaker data state
  const [speakersList, setSpeakersList] = useState([]);
  const [filteredSpeakers, setFilteredSpeakers] = useState([]);
  const [speakerNameMap, setSpeakerNameMap] = useState({});

  // UI state
  const [audioPreviewOpen, setAudioPreviewOpen] = useState(false);
  const [selectedSpeaker, setSelectedSpeaker] = useState(null);
  const [currentSamples, setCurrentSamples] = useState([]);
  const [highlightedSegment, setHighlightedSegment] = useState(null);
  const [playingSegment, setPlayingSegment] = useState(null);
  const [segmentPlayerVisible, setSegmentPlayerVisible] = useState(false);
  const [segmentPlayerUrl, setSegmentPlayerUrl] = useState(null);
  const [segmentPlayerWaveform, setSegmentPlayerWaveform] = useState(null);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [speakerToRename, setSpeakerToRename] = useState(null);
  const [newSpeakerName, setNewSpeakerName] = useState("");
  const [snackbarMessage, setSnackbarMessage] = useState("");
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [refreshWaveform, setRefreshWaveform] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [notification, setNotification] = useState({
    message: "",
    severity: "",
  });

  // Clear playback timer on unmount
  useEffect(() => {
    return () => {
      if (segmentPlaybackTimer) {
        clearTimeout(segmentPlaybackTimer);
      }
    };
  }, [segmentPlaybackTimer]);

  // Fetch timeline data on component mount
  useEffect(() => {
    if (jobStatus?.job_id) {
      fetchTimelineData();
      setupOriginalAudio();
    }
  }, [jobStatus]);

  // Cleanup audio on unmount
  useEffect(() => {
    console.log("TalkDownloadResults jobStatus:", jobStatus);

    return () => {
      // Stop any playing audio
      Object.values(waveforms).forEach((waveform) => {
        if (waveform && typeof waveform.pause === "function") {
          waveform.pause();
        }
      });
    };
  }, [jobStatus, waveforms]);

  // Update speakers list when timeline data changes
  useEffect(() => {
    if (timelineData?.length > 0) {
      updateSpeakersList();
    }
  }, [timelineData]);

  // Fetch and set up original audio
  const setupOriginalAudio = useCallback(() => {
    if (jobStatus?.input_audio_path) {
      const filename =
        jobStatus.original_filename ||
        jobStatus.input_audio_path.split("/").pop();

      const audioUrl = `/api/play-original-audio/${
        jobStatus.job_id
      }?filename=${encodeURIComponent(filename)}`;
      console.log("Setting original audio URL:", audioUrl);
      setOriginalAudioUrl(audioUrl);

      // Verify the audio URL is accessible
      fetch(audioUrl, { method: "HEAD" })
        .then((response) => {
          if (!response.ok) {
            console.error("Audio file not accessible:", response.status);
            setError(
              `Original audio file not accessible (${response.status}). Please check server logs.`
            );
          }
        })
        .catch((err) => {
          // Don't log AbortError as it's expected when component unmounts
          if (err.name !== 'AbortError') {
            console.error("Error checking audio file:", err);
          }
        });
    }
  }, [jobStatus]);

  // Extract and initialize speakers list
  const updateSpeakersList = useCallback(() => {
    // Extract unique speakers from timeline data
    const uniqueSpeakers = [
      ...new Set(timelineData.map((segment) => segment.speaker)),
    ].sort();

    // Ensure "Unknown" is included (if it exists in the data)
    if (
      !uniqueSpeakers.includes("Unknown") &&
      timelineData.some((segment) => segment.speaker === "Unknown")
    ) {
      uniqueSpeakers.push("Unknown");
    }

    // Update speakers state with consistent colors
    setSpeakersList(
      uniqueSpeakers.map((speaker, index) => ({
        name: speaker,
        color: getSpeakerColor(speaker, index),
      }))
    );
  }, [timelineData]);

  // Fetch timeline data from the server
  const fetchTimelineData = async () => {
    const jobId = jobStatus?.job_id;
    if (!jobId) return;

    try {
      const timelineResponse = await fetch(
        `/api/diarization-timeline/${jobId}`
      );
      if (!timelineResponse.ok) {
        throw new Error(
          `Failed to fetch timeline data: ${timelineResponse.status}`
        );
      }

      const timelineData = await timelineResponse.json();
      if (
        !timelineData ||
        !timelineData.timeline ||
        timelineData.timeline.length === 0
      ) {
        setTimelineData([]);
        setTotalDuration(0);
        return;
      }

      console.log("Timeline data fetched:", timelineData);

      // Set timeline data directly from API response (which now includes Unknown segments)
      const sortedTimeline = timelineData.timeline.sort(
        (a, b) => a.start - b.start
      );
      setTimelineData(sortedTimeline);

      // Get total duration from last segment
      const lastSegment = sortedTimeline[sortedTimeline.length - 1];
      setTotalDuration(lastSegment.end);

      // Extract unique speakers from the timeline
      const uniqueSpeakers = [
        ...new Set(sortedTimeline.map((segment) => segment.speaker)),
      ];
      console.log("Unique speakers from timeline:", uniqueSpeakers);
    } catch (error) {
      // Don't log AbortError as it's expected when component unmounts
      if (error.name !== 'AbortError') {
        console.error("Error fetching timeline data:", error);
      }
    }
  };

  // Play sample handling
  const handlePlaySample = useCallback(
    (speakerName) => {
      if (!jobStatus?.job_id) {
        console.error("No job ID available");
        return;
      }

      setPlaying((prevPlaying) =>
        prevPlaying === speakerName ? null : speakerName
      );
    },
    [jobStatus]
  );

  // Download speaker data
  const handleDownloadSpeaker = useCallback(
    (speakerName) => {
      if (!jobStatus?.job_id) {
        console.error("No job ID available");
        return;
      }

      const downloadUrl = `/api/download-speaker/${jobStatus.job_id}/${speakerName}`;
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `${speakerName}_segments.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    },
    [jobStatus]
  );

  // Download all speaker data
  const handleDownloadAll = useCallback(() => {
    if (!jobStatus?.job_id) {
      console.error("No job ID available");
      return;
    }

    const downloadUrl = `/api/download-talking-dataset/${jobStatus.job_id}`;
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = `diarization_dataset_${jobStatus.job_id}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [jobStatus]);

  // Handle segment selection in timeline
  const handleTimelineSegmentClick = useCallback(
    (segment) => {
      console.log("Timeline segment clicked:", segment);
      setHighlightedSegment(segment);

      if (!segment) return;

      const segmentUrl = getSegmentUrl(segment);
      if (segmentUrl) {
        setSegmentPlayerUrl(segmentUrl);
        setSegmentPlayerVisible(true);
        updateWaveformPosition(segment);
      }
    },
    [jobStatus, timelineData, audioWavesurfer, totalDuration]
  );

  // Get URL for a segment based on type (known speaker vs unknown)
  const getSegmentUrl = (segment) => {
    // For unknown/gap segments
    const isUnknown =
      segment.speaker === "Unknown" || segment.id?.startsWith("gap-");
    const isGap = segment.id && segment.id.startsWith("gap-");
    const isNoSpeech =
      segment.text && segment.text.includes("No speech detected");

    if (isUnknown || isGap || isNoSpeech) {
      // Extract part number from the segment ID for gap segments
      let partNum = "1";
      if (segment.id && segment.id.startsWith("gap-")) {
        // Extract part number from "gap-N-xyz"
        const match = segment.id.match(/gap-(\d+)/);
        if (match && match[1]) {
          partNum = match[1];
        }
      }

      // For unknown segments, use the gap/unknown segment API endpoint
      const segmentId = segment.id
        ? segment.id.replace("segment-", "").replace("gap-", "")
        : "unknown";
      return `/api/extract-segment?job_id=${jobStatus.job_id}&start=${
        segment.start
      }&end=${segment.end}&segment_id=${segmentId}&is_gap=${
        isGap || isNoSpeech
      }&debug=true`;
    } else {
      // For known speaker segments
      try {
        // Try to find matching segments in speakerSegments for this speaker
        const speakerSegments = timelineData.filter(
          (s) => s.speaker === segment.speaker
        );
        console.log(
          `Looking for segment ${segment.id} for speaker ${segment.speaker}`,
          segment
        );

        // First attempt to find by segment ID
        let matchedSegment = null;

        // Check if we have a numeric segment ID
        if (segment.id && segment.id.startsWith("segment-")) {
          const segmentIndex = parseInt(segment.id.replace("segment-", ""), 10);
          console.log(`Looking for segment index ${segmentIndex}`);

          // Attempt to find segment by index
          if (!isNaN(segmentIndex) && segmentIndex < speakerSegments.length) {
            matchedSegment = speakerSegments[segmentIndex];
            console.log(`Found by index: ${matchedSegment}`);
          }
        }

        // If not found by ID, try to match by timestamp
        if (!matchedSegment) {
          console.log(
            `Trying to match by timestamp: ${segment.start}-${segment.end}`
          );

          // Find segment that best matches the start/end times
          matchedSegment = speakerSegments.find((seg) => {
            const startDiff = Math.abs(seg.start - segment.start);
            const endDiff = Math.abs(seg.end - segment.end);
            return startDiff < 0.5 && endDiff < 0.5; // Match within 0.5 seconds
          });

          if (matchedSegment) {
            console.log(`Found by timestamp match:`, matchedSegment);
          }
        }

        // If still no match, use the first segment as fallback
        if (!matchedSegment && speakerSegments.length > 0) {
          console.log(`No exact match found, using first segment as fallback`);
          matchedSegment = speakerSegments[0];
        }

        if (matchedSegment) {
          // Format the timestamps for constructing a filename
          // This matches the new timestamp-based filename pattern
          const speakerName = segment.speaker.replace("Speaker ", "SPEAKER_");
          const segmentId = segment.id.replace("segment-", "");
          const startSeconds = segment.start;
          const endSeconds = segment.end;

          // Format timestamps for building the filename pattern
          const startMins = Math.floor(startSeconds / 60);
          const startSecs = Math.floor(startSeconds % 60);
          const endMins = Math.floor(endSeconds / 60);
          const endSecs = Math.floor(endSeconds % 60);

          // Create a search pattern that will help the backend match the right file
          const timePattern = `${startMins
            .toString()
            .padStart(2, "0")}m${startSecs
            .toString()
            .padStart(2, "0")}s-${endMins.toString().padStart(2, "0")}m${endSecs
            .toString()
            .padStart(2, "0")}s`;

          // Build the URL with all necessary parameters to help the backend find the file
          return `/api/play-segment/part*${timePattern}*.wav?speaker=${encodeURIComponent(
            segment.speaker
          )}&job_id=${jobStatus.job_id}&segment_id=${segment.id}&start=${
            segment.start
          }&end=${segment.end}&timePattern=${timePattern}`;
        } else {
          console.error(`No segment found for speaker ${segment.speaker}`);
          // Fallback to a generic pattern approach
          return `/api/play-segment/part*.wav?speaker=${encodeURIComponent(
            segment.speaker
          )}&job_id=${jobStatus.job_id}&segment_id=${segment.id}&start=${
            segment.start
          }&end=${segment.end}`;
        }
      } catch (error) {
        console.error("Error generating segment URL:", error);
        // Fallback URL if there's an error
        return `/api/play-segment/part1.wav?speaker=${encodeURIComponent(
          segment.speaker
        )}&job_id=${jobStatus.job_id}`;
      }
    }
  };

  // Update waveform position when segment is selected
  const updateWaveformPosition = useCallback(
    (segment) => {
      if (audioWavesurfer && totalDuration) {
        try {
          const normalizedPosition = segment.start / totalDuration;
          audioWavesurfer.seekTo(normalizedPosition);
        } catch (err) {
          console.error("Error seeking to segment:", err);
        }
      }
    },
    [audioWavesurfer, totalDuration]
  );

  // Tab change handler
  const handleTabChange = useCallback((event, newValue) => {
    setCurrentTab(newValue);
  }, []);

  // Waveform ready callback
  const handleWaveformReady = useCallback((sampleId, waveform) => {
    setWaveforms((prev) => ({
      ...prev,
      [sampleId]: waveform,
    }));
  }, []);

  // Download segment handler
  const handleDownloadSegment = useCallback((sample) => {
    if (!sample?.url) return;

    const a = document.createElement("a");
    a.href = sample.url;
    a.download = `${sample.name}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  // Segment waveform handlers
  const handleSegmentWaveformReady = useCallback((waveform) => {
    console.log("Segment waveform ready");
    setSegmentPlayerWaveform(waveform);
  }, []);

  const handleSegmentTimeUpdate = useCallback(
    (time) => {
      if (playing !== "segment" || !highlightedSegment || !audioWavesurfer)
        return;

      const segmentStart = highlightedSegment.start;
      const actualMainPosition = segmentStart + time;
      const boundedPosition = Math.min(
        Math.max(actualMainPosition, highlightedSegment.start),
        highlightedSegment.end
      );

      try {
        const currentMainTime = audioWavesurfer.getCurrentTime();
        const threshold = 0.05; // 50ms threshold

        if (Math.abs(currentMainTime - boundedPosition) > threshold) {
          if (totalDuration) {
            const normalizedPosition = boundedPosition / totalDuration;
            audioWavesurfer.seekTo(normalizedPosition);
          }
        }
      } catch (err) {
        console.error("Error updating main waveform position:", err);
      }
    },
    [playing, highlightedSegment, audioWavesurfer, totalDuration]
  );

  const handleMainWaveformTimeUpdate = useCallback(
    (time) => {
      if (
        playing !== "original-audio" ||
        !highlightedSegment ||
        !segmentPlayerRef.current
      )
        return;

      if (time >= highlightedSegment.start && time <= highlightedSegment.end) {
        const localSegmentTime = time - highlightedSegment.start;

        try {
          const currentSegmentTime = segmentPlayerRef.current.getCurrentTime();
          const threshold = 0.05; // 50ms threshold

          if (Math.abs(currentSegmentTime - localSegmentTime) > threshold) {
            segmentPlayerRef.current.setCurrentTime(localSegmentTime);
          }
        } catch (err) {
          console.error("Error updating segment player position:", err);
        }
      }
    },
    [playing, highlightedSegment]
  );

  // Get color for highlighted segment
  const getHighlightedSegmentColor = useCallback(() => {
    if (!highlightedSegment) return "#9e9e9e"; // Default gray

    if (highlightedSegment.speaker === "Unknown") {
      return "#666666"; // Gray for Unknown segments
    }

    const speakerIndex = speakersList.findIndex(
      (s) => s.name === highlightedSegment.speaker
    );

    if (speakerIndex !== -1) {
      return speakerColors[speakerIndex % speakerColors.length];
    }

    return "#9e9e9e"; // Default if speaker not found
  }, [highlightedSegment, speakersList]);

  // Speaker filter handler
  const handleSpeakerFilter = useCallback((speakerName) => {
    setFilteredSpeakers((prev) =>
      prev.includes(speakerName)
        ? prev.filter((s) => s !== speakerName)
        : [...prev, speakerName]
    );
  }, []);

  // Speaker name handlers
  const getDisplayName = useCallback(
    (speakerName) => {
      return speakerNameMap[speakerName] || speakerName;
    },
    [speakerNameMap]
  );

  const handleOpenRenameDialog = useCallback(
    (speakerName) => {
      setSpeakerToRename(speakerName);
      setNewSpeakerName(speakerNameMap[speakerName] || speakerName);
      setRenameDialogOpen(true);
    },
    [speakerNameMap]
  );

  const handleSaveNewName = useCallback(() => {
    if (speakerToRename && newSpeakerName.trim()) {
      setSpeakerNameMap((prev) => ({
        ...prev,
        [speakerToRename]: newSpeakerName.trim(),
      }));
    }
    setRenameDialogOpen(false);
  }, [speakerToRename, newSpeakerName]);

  // Segment reassignment
  const handleReassignSegment = useCallback(
    async (segment, targetSpeaker) => {
      if (!segment || !targetSpeaker || !jobStatus?.job_id) {
        console.error("Missing data for reassignment");
        return;
      }

      if (segment.start === undefined || segment.end === undefined) {
        setNotification({
          message: "Cannot reassign segment: Missing time information",
          severity: "error",
        });
        return;
      }

      try {
        setIsProcessing(true);

        const isUnknown =
          segment.speaker === "Unknown" ||
          segment.id?.startsWith("gap-") ||
          (segment.text && segment.text.includes("No speech detected"));

        let speakerSegmentIndex = null;

        if (!isUnknown) {
          const speakerSegments = timelineData.filter(
            (s) => s.speaker === segment.speaker
          );
          speakerSegmentIndex = speakerSegments.findIndex(
            (s) => s.id === segment.id
          );
        }

        const response = await fetch("/api/reassign-segment", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            job_id: jobStatus.job_id,
            segment_id: segment.id,
            start: segment.start,
            end: segment.end,
            original_speaker: segment.speaker,
            target_speaker: targetSpeaker,
            is_unknown: isUnknown,
            speaker_segment_index: speakerSegmentIndex,
            maintain_playback: true,
          }),
        });

        const data = await response.json();

        if (response.ok) {
          // Update timeline data
          setTimelineData((prev) =>
            prev.map((s) =>
              s.id === segment.id ? { ...s, speaker: targetSpeaker } : s
            )
          );

          // Update highlighted segment if needed
          if (highlightedSegment?.id === segment.id) {
            setHighlightedSegment({
              ...highlightedSegment,
              speaker: targetSpeaker,
            });

            // Don't update the player URL or reload the player
            // This keeps the current playback state
          }

          setNotification({
            message: `Segment reassigned to ${targetSpeaker}`,
            severity: "success",
          });

          // After UI update is complete, tell backend to move the file
          // This happens after we've already updated the UI
          const moveResponse = await fetch("/api/move-segment", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              job_id: jobStatus.job_id,
              segment_id: segment.id,
              original_speaker: segment.speaker,
              target_speaker: targetSpeaker,
              part_number: data.part_number,
            }),
          });

          if (!moveResponse.ok) {
            console.error("Error moving segment file");
            // Don't show error to user since UI update was successful
          }
        } else {
          setNotification({
            message: `Error: ${data.error}`,
            severity: "error",
          });
        }
      } catch (error) {
        // Don't log AbortError as it's expected when component unmounts
        if (error.name !== 'AbortError') {
          console.error("Error reassigning segment:", error);
          setNotification({
            message: "An unexpected error occurred",
            severity: "error",
          });
        }
      } finally {
        setIsProcessing(false);
      }
    },
    [jobStatus, timelineData, highlightedSegment]
  );

  // Segment seeking handler
  const handleSegmentSeek = useCallback(
    (time) => {
      if (!highlightedSegment || !audioWavesurfer) return;

      const mainPosition = highlightedSegment.start + time;
      const boundedPosition = Math.min(
        Math.max(mainPosition, highlightedSegment.start),
        highlightedSegment.end
      );

      if (totalDuration) {
        try {
          const normalizedPosition = boundedPosition / totalDuration;
          audioWavesurfer.seekTo(normalizedPosition);
        } catch (err) {
          console.error(
            "Error updating main waveform after segment seek:",
            err
          );
        }
      }
    },
    [highlightedSegment, audioWavesurfer, totalDuration]
  );

  // Speaker change handler
  const handleChangeSpeaker = useCallback(
    (newSpeaker) => {
      if (!highlightedSegment) {
        console.error("No segment selected for reassignment");
        return;
      }

      if (newSpeaker !== highlightedSegment.speaker) {
        handleReassignSegment(highlightedSegment, newSpeaker);
      }
    },
    [highlightedSegment, handleReassignSegment]
  );

  // Available speakers for dropdown
  const availableSpeakers = useMemo(
    () => [...speakersList.map((s) => s.name), "Unknown"],
    [speakersList]
  );

  // Add handleTrainWithSpeaker function
  const handleTrainWithSpeaker = useCallback(
    (speakerName, speakerSegments) => {
      // if (!jobStatus?.job_id) {
      //   console.error("No job ID available");
      //   return;
      // }
      // alert("Training with spddddeaker");

      // Format the segments data for training
      const segmentsData = speakerSegments.map((segment) => ({
        start: segment.start,
        end: segment.end,
        speaker: segment.speaker,
        id: segment.id,
      }));

      // Get the segment URLs that can be used as audio files
      const segmentUrls = speakerSegments.map((segment) =>
        getSegmentUrl(segment)
      );

      // Call the parent handler with the speaker data in the format expected by TrainingView
      if (onTrainWithSpeaker) {
        onTrainWithSpeaker({
          processed: segmentUrls, // Add segments as processed vocals
          raw: [], // No raw vocals from diarization
          // Include additional metadata that might be useful
          metadata: {
            jobId: jobStatus.job_id,
            speakerName,
            segments: segmentsData,
            originalFilename: jobStatus.original_filename,
          },
        });
      }
    },
    [jobStatus, onTrainWithSpeaker, getSegmentUrl]
  );

  const handleTrainClick = () => {
    if (selectedSpeaker) {
      // Find segments for the selected speaker
      const speakerSegments = timelineData.filter(
        (segment) => segment.speaker === selectedSpeaker
      );

      // Call handleTrainWithSpeaker with the selected speaker segments
      handleTrainWithSpeaker(selectedSpeaker, speakerSegments);
    }
  };

  // No results state
  if (!jobStatus?.speakers || Object.keys(jobStatus.speakers).length === 0) {
    return (
      <Box sx={{ textAlign: "center", py: 4 }}>
        <Typography variant="h6" gutterBottom>
          No results available
        </Typography>
        <Button
          variant="contained"
          color="primary"
          onClick={handleReset}
          startIcon={<ReplayIcon />}
        >
          Start New Process
        </Button>
      </Box>
    );
  }

  // Calculate elapsed time
  const totalTime = Math.floor(jobStatus.completed_at - jobStatus.started_at);
  const minutes = Math.floor(totalTime / 60);
  const seconds = totalTime % 60;
  const speakers = jobStatus.speakers || {};

  return (
    <Box>
      {showHeader && (
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            mb: 3,
          }}
        >
          <Typography variant="h5" gutterBottom>
            Diarization Complete!
          </Typography>

          <Box>
            <Chip
              label={`Completed in ${minutes}m ${seconds}s`}
              color="success"
              variant="outlined"
            />
          </Box>
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Box sx={{ mb: 3 }}>
        <Button
          variant="contained"
          color="primary"
          startIcon={<ZipIcon />}
          onClick={handleDownloadAll}
          sx={{ mr: 2 }}
        >
          Download All Speakers
        </Button>
        <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
          {Object.keys(speakers).length} speakers identified with{" "}
          {Object.values(speakers).reduce(
            (sum, data) =>
              sum + (typeof data === "object" ? data.count || 0 : data),
            0
          )}{" "}
          total segments
        </Typography>
      </Box>

      {/* Tab navigation */}
      <Paper sx={{ mb: 3 }}>
        <Tabs
          value={currentTab}
          onChange={handleTabChange}
          variant="fullWidth"
          indicatorColor="primary"
          textColor="primary"
          aria-label="diarization result tabs"
        >
          <Tab icon={<PersonIcon />} label="Speakers & Audio" />
        </Tabs>
      </Paper>

      {/* Tab content */}
      <Box role="tabpanel" hidden={currentTab !== 0}>
        {currentTab === 0 && (
          <>
            <SpeakerAnalysisSection
              speakersList={speakersList}
              timelineData={timelineData}
              totalDuration={totalDuration}
              filteredSpeakers={filteredSpeakers}
              getDisplayName={getDisplayName}
              handleSpeakerFilter={handleSpeakerFilter}
              handleOpenRenameDialog={handleOpenRenameDialog}
              handlePlaySample={handlePlaySample}
              handleDownloadSpeaker={handleDownloadSpeaker}
              handleTrainWithSpeaker={handleTrainWithSpeaker}
              // handleTrainClick={handleTrainClick}
              playing={playing}
            />

            <OriginalAudioSection
              originalAudioUrl={originalAudioUrl}
              playing={playing}
              setPlaying={setPlaying}
              timelineData={timelineData}
              speakerColors={speakerColors}
              filteredSpeakers={filteredSpeakers}
              setFilteredSpeakers={setFilteredSpeakers}
              handleTimelineSegmentClick={handleTimelineSegmentClick}
              handleSegmentWaveformReady={handleSegmentWaveformReady}
              handleMainWaveformTimeUpdate={handleMainWaveformTimeUpdate}
              speakerNameMap={speakerNameMap}
              getDisplayName={getDisplayName}
              highlightedSegment={highlightedSegment}
              speakersList={speakersList}
              getHighlightedSegmentColor={getHighlightedSegmentColor}
              availableSpeakers={availableSpeakers}
              handleChangeSpeaker={handleChangeSpeaker}
              segmentPlayerUrl={segmentPlayerUrl}
              segmentPlayerRef={segmentPlayerRef}
              handleSegmentTimeUpdate={handleSegmentTimeUpdate}
              handleSegmentSeek={handleSegmentSeek}
              handleDownloadSegment={handleDownloadSegment}
              segmentPlaybackTimer={segmentPlaybackTimer}
              setSegmentPlaybackTimer={setSegmentPlaybackTimer}
              setPlayingSegment={setPlayingSegment}
            />
          </>
        )}
      </Box>

      <Box sx={{ mt: 4, textAlign: "center" }}>
        <Button
          variant="contained"
          color="primary"
          onClick={handleReset}
          size="large"
          startIcon={<ReplayIcon />}
        >
          Process New Audio
        </Button>
      </Box>

      {/* Dialogs */}
      <SpeakerPreviewDialog
        open={audioPreviewOpen}
        onClose={() => setAudioPreviewOpen(false)}
        selectedSpeaker={selectedSpeaker}
        currentSamples={currentSamples}
        playing={playing}
        setPlaying={setPlaying}
        getDisplayName={getDisplayName}
        handleDownloadSegment={handleDownloadSegment}
        handleWaveformReady={handleWaveformReady}
        handleDownloadSpeaker={handleDownloadSpeaker}
        formatDuration={formatDuration}
      />

      <SpeakerRenameDialog
        open={renameDialogOpen}
        onClose={() => setRenameDialogOpen(false)}
        speakerToRename={speakerToRename}
        newSpeakerName={newSpeakerName}
        setNewSpeakerName={setNewSpeakerName}
        handleSaveNewName={handleSaveNewName}
      />
    </Box>
  );
}

export default TalkDownloadResults;
