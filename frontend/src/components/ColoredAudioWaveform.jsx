import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  Box,
  Tooltip,
  Typography,
  IconButton,
  CircularProgress,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.js";

/* Default prop values, hoisted out of the parameter list.

   Written inline as `= []`, `= {}` and `= () => {}`, a default is evaluated on
   every render, so a caller that omits the prop handed this component a fresh
   identity each time. Every hook depending on one of them then re-ran on every
   render — which is why so many of the effects below had to omit their real
   dependencies to stay quiet. Hoisted, an omitted prop is genuinely constant. */
/* Pure, so it belongs outside the component: defined inside, it was a new
   function every render and made everything closing over it unstable too. */
const segmentMatchesFilter = (segment, filters) => {
  // If no filters are applied, all segments match
  if (!filters || filters.length === 0) return true;
  // Check if this segment's speaker is in the filter list using exact match
  return filters.includes(segment.speaker);
};

const NO_SPEAKER_FILTER = [];
const NO_DISPLAY_NAME_MAP = {};
const identityName = (name) => name;
const noop = () => {};

const ColoredAudioWaveform = forwardRef(
  (
    {
      url,
      segments,
      speakerColors,
      isPlaying,
      onPlayPause,
      onSegmentClick,
      filteredSpeakers = NO_SPEAKER_FILTER, // Empty array means show all speakers
      height = 140,
      waveColor = "#8e8e8e",
      progressColor = "#ffffff",
      backgroundColor = "#2a2a2a",
      onReady = noop,
      onTimeUpdate = noop, // Add onTimeUpdate prop
      onSeek = noop, // Add onSeek prop
      speakerDisplayNameMap = NO_DISPLAY_NAME_MAP, // Add this prop
      getDisplayName = identityName, // Add this prop with a default implementation
    },
    ref
  ) => {
    const containerRef = useRef(null);
    const wavesurferRef = useRef(null);
    const regionsRef = useRef({});
    const [ready, setReady] = useState(false);
    const [loading, setLoading] = useState(true);
    const [hoveredSegment, setHoveredSegment] = useState(null);
    const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
    const [currentTimeDisplay, setCurrentTimeDisplay] = useState(0);
    const [error, setError] = useState(null);
    const [zoom, setZoom] = useState(1); // Track zoom level

    // At the beginning of the component, add a function to create a consistent speaker-to-color mapping
    const getSpeakerColorMap = (speakers, colorPalette) => {
      const colorMap = {};

      if (!speakers || !speakers.length) return colorMap;

      // Sort speakers to ensure consistent assignment across renders
      const sortedSpeakers = [
        ...new Set(speakers.map((segment) => segment.speaker)),
      ].sort();

      sortedSpeakers.forEach((speaker, index) => {
        // Handle Unknown speaker with a dedicated gray
        if (speaker === "Unknown") {
          colorMap[speaker] = "#666666"; // Dedicated gray for Unknown segments
          return;
        }

        // Assign a color from the palette for other speakers
        colorMap[speaker] = colorPalette[index % colorPalette.length];
      });

      return colorMap;
    };

    // Create a stable color mapping when segments change
    const [speakerColorMap, setSpeakerColorMap] = useState({});

    useEffect(() => {
      if (segments && segments.length) {
        // Create a stable color mapping
        const colorMap = getSpeakerColorMap(
          segments,
          Object.values(speakerColors)
        );
        setSpeakerColorMap(colorMap);
      }
      // speakerColors is a module constant imported from utils/audioUtils, so
      // listing it cannot make this effect re-run — it just stops the palette
      // being read from a closure that predates it.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [segments, speakerColors]);

    // Replace both existing wheel event handling mechanisms with a single solution
    useEffect(() => {
      if (!containerRef.current) return;

      // Single wheel event handler for both vertical (zoom) and horizontal (pan) scrolling
      const wheelHandler = (e) => {
        if (!wavesurferRef.current || !ready) return;

        // Always prevent default scroll behavior when over our component
        e.preventDefault();
        e.stopPropagation();

        try {
          // Horizontal scroll detection
          if (
            Math.abs(e.deltaX) > Math.abs(e.deltaY) &&
            Math.abs(e.deltaX) > 0
          ) {
            // Handle horizontal panning
            const scrollDirection = e.deltaX > 0 ? 1 : -1;
            const scrollStep = 50;

            if (
              wavesurferRef.current.drawer &&
              wavesurferRef.current.drawer.wrapper
            ) {
              const wrapper = wavesurferRef.current.drawer.wrapper;
              wrapper.scrollLeft += scrollDirection * scrollStep;
            }
          } else if (Math.abs(e.deltaY) > 0) {
            // Handle vertical zooming

            // Get cursor position and waveform container position
            const waveformRect = containerRef.current.getBoundingClientRect();
            const mouseX = e.clientX - waveformRect.left;

            // Get the wrapper element
            const wrapper = wavesurferRef.current.drawer.wrapper;

            // Calculate the exact position in the audio where the cursor is pointing
            const scrollLeft = wrapper.scrollLeft;
            const pixelsPerSecond =
              wavesurferRef.current.drawer.width /
              wavesurferRef.current.getDuration();
            const mouseAudioPosition = (scrollLeft + mouseX) / pixelsPerSecond;

            // Determine zoom direction and get current zoom from direct DOM query
            const direction = e.deltaY < 0 ? 1 : -1; // Up = zoom in

            // Get current zoom directly from wavesurfer if possible
            let currentZoom = wavesurferRef.current.params.minPxPerSec || zoom;

            // MORE GRANULAR zoom changes with adaptive factors
            let newZoom;

            // Calculate zoom factor based on current zoom level
            // Lower zoom = larger percentage change, higher zoom = smaller percentage
            const baseIncreaseFactor = 1.15; // 15% increase (down from 40%)
            const baseDecreaseFactor = 0.85; // 15% decrease (up from 30%)

            // For very high zoom levels, use even more granular factors
            const zoomFactor =
              currentZoom > 100
                ? direction > 0
                  ? 1.05
                  : 0.95 // 5% change at high zoom
                : direction > 0
                ? baseIncreaseFactor
                : baseDecreaseFactor; // 15% otherwise

            // Apply the zoom factor with a minimum step to ensure visible change
            if (direction > 0) {
              // Zoom in - more gradual
              const minStep = currentZoom < 10 ? 1 : 2; // Smaller step for low zoom
              newZoom = Math.max(
                currentZoom * zoomFactor,
                currentZoom + minStep
              );
            } else {
              // Zoom out - ensure significant but not dramatic decrement
              const minStep = currentZoom < 10 ? 1 : 2; // Smaller step for low zoom
              newZoom = Math.max(
                1,
                Math.min(currentZoom * zoomFactor, currentZoom - minStep)
              );
            }

            // Enforce zoom limits with higher max zoom for fine detail
            newZoom = Math.max(1, Math.min(50, newZoom));

            // Only apply zoom if it's different enough from current
            if (Math.abs(newZoom - currentZoom) > 0.2) {
              // Apply zoom
              wavesurferRef.current.zoom(newZoom);
              setZoom(newZoom);

              // After zooming, calculate where that audio position should now be
              const newPixelsPerSecond =
                wavesurferRef.current.drawer.width /
                wavesurferRef.current.getDuration();
              const newPixelPosition = mouseAudioPosition * newPixelsPerSecond;

              // Calculate what the new scrollLeft should be to keep the cursor over the same audio position
              const newScrollLeft = newPixelPosition - mouseX;

              // Apply the new scroll position
              wrapper.scrollLeft = newScrollLeft;
            }
          }
        } catch (err) {
          console.error("Error during wheel interaction:", err);
        }
      };

      // Add the wheel event listener with the correct options
      const container = containerRef.current;
      container.addEventListener("wheel", wheelHandler, { passive: false });

      // Cleanup function
      return () => {
        if (container) {
          container.removeEventListener("wheel", wheelHandler, {
            passive: false,
          });
        }
      };
    }, [ready, zoom]); // Only re-attach when ready state changes or zoom changes

    // Initialize wavesurfer
    useEffect(() => {
      if (!containerRef.current || !url) {
        return;
      }

      // Create wavesurfer instance with additional configuration
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
        scrollParent: true, // Enable scrolling
        xhr: {
          // Add authorization header if needed
          // headers: [
          //   { key: 'Authorization', value: 'Bearer your-token-here' }
          // ],
          cache: "default",
          mode: "cors",
          method: "GET",
          credentials: "same-origin",
        },
        backend: "WebAudio", // Specify WebAudio backend explicitly
        plugins: [
          RegionsPlugin.create({
            dragSelection: false,
            slop: 5,
          }),
        ],
      });

      // Set loading state and listen for events
      setLoading(true);

      // Add more detailed error handling
      wavesurfer.on("error", (err) => {
        console.error("WaveSurfer error:", err);
        setError(`Error loading audio: ${err.message || "Unknown error"}`);
        setLoading(false);
        setReady(false);
      });

      // Try to load the audio with better error handling
      try {
        wavesurfer.load(url);
      } catch (e) {
        console.error("Exception loading audio:", e);
        setError(`Exception loading audio: ${e.message}`);
        setLoading(false);
      }

      // Event handlers
      wavesurfer.on("ready", () => {
        setReady(true);
        setLoading(false);
        addRegions(wavesurfer);

        // Set initial current time
        setCurrentTimeDisplay(wavesurfer.getCurrentTime());

        // Fit to width by default
        wavesurfer.zoom(1);

        // Complete the ready callbacks
        onReady(wavesurfer);
      });

      wavesurfer.on("audioprocess", () => {
        setCurrentTimeDisplay(wavesurfer.getCurrentTime());
      });

      // Add seek event handler to update the timer when seeked
      wavesurfer.on("seek", () => {
        setCurrentTimeDisplay(wavesurfer.getCurrentTime());
      });

      // Update timer when interaction ends
      wavesurfer.on("interaction", () => {
        setCurrentTimeDisplay(wavesurfer.getCurrentTime());
      });

      wavesurfer.on("duration-changed", () => {
        // Reapply regions with the new duration
        addRegions(wavesurfer);
      });

      // Store reference
      wavesurferRef.current = wavesurfer;

      // Cleanup
      return () => {
        if (wavesurfer) {
          try {
            // Stop playback first
            if (wavesurfer.isPlaying()) {
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
      /* Keyed on the audio, deliberately. Listing the style props would tear
         down and rebuild the wavesurfer instance whenever a colour or the
         height changed, and listing addRegions would rebuild it on every
         change of segments — both visible as the waveform flashing and
         reloading. The instance should outlive all of that. */
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [url]);

    /* Memoised so the two effects that call it can list it. It reads the
       segments, the filters and the palette; every one of those is either
       state or a stable prop, so this changes identity only when the regions
       it would draw actually differ. */
    const addRegions = useCallback((wavesurfer) => {
      if (!segments || segments.length === 0) {
        return;
      }

      // First, check if we have gaps between segments
      const sortedSegments = [...segments].sort((a, b) => a.start - b.start);

      // Note: Unknown segments are positioned based on their actual timestamps
      // which are extracted from the filename (format: part{number}_{start}-{end}.wav)
      // and are represented as gray, striped segments in the timeline.
      // They represent silence or non-speech portions of the audio.
      const completeSegments = sortedSegments;

      // Clear any existing regions
      wavesurfer.clearRegions();
      regionsRef.current = {};

      // Create regions from all segments (no longer including gaps)
      completeSegments.forEach((segment, index) => {
        // Determine if this segment should be shown:
        // 1. When no filtering is applied (show all speakers)
        // 2. When this is an Unknown/gap segment (always show these)
        // 3. When this speaker is in the filtered list
        const isSelected = segmentMatchesFilter(segment, filteredSpeakers);

        // Skip creating regions for non-selected speakers
        if (!isSelected) {
          return;
        }

        // Determine the region color
        let regionColor;

        if (segment.speaker === "Unknown") {
          // Use the standard gray for unknown regions
          regionColor = "#666666"; // Dedicated gray for Unknown segments
        } else {
          // Use the consistent speaker color mapping
          regionColor =
            speakerColorMap[segment.speaker] ||
            speakerColors[
              Object.keys(speakerColors)[
                index % Object.keys(speakerColors).length
              ]
            ];
        }

        // Create the region
        const region = wavesurfer.addRegion({
          id: segment.id || `segment-${index}`,
          start: segment.start,
          end: segment.end,
          color: adjustColorOpacity(regionColor, 0.5),
          drag: false,
          resize: false,
          data: {
            isUnknown: segment.speaker === "Unknown",
            type: segment.speaker,
          },
        });

        // Store the segment data with the region
        region.segment = segment;
        regionsRef.current[region.id] = region;

        // Add a special CSS class for unknown segments to make them more visible
        if (segment.speaker === "Unknown" && region.element) {
          // Make the region more transparent but keep the pattern visible
          // Use a semi-transparent background with the striped pattern
          region.element.style.backgroundImage =
            "repeating-linear-gradient(45deg, rgba(102, 102, 102, 0.4), rgba(102, 102, 102, 0.4) 10px, rgba(85, 85, 85, 0.4) 10px, rgba(85, 85, 85, 0.4) 20px)";
          // Reduce the region's overall opacity to make waveform more visible
          region.element.style.opacity = "0.6";
          // Add a debug attribute to the DOM element for easier identification
          region.element.setAttribute("data-segment-type", "unknown");
          region.element.setAttribute(
            "data-segment-start",
            segment.start.toFixed(3)
          );
          region.element.setAttribute(
            "data-segment-end",
            segment.end.toFixed(3)
          );
        }

        // Make sure region has an element before adding event listeners
        if (region.element) {
          // Add event handlers
          region.element.addEventListener("mouseenter", (e) => {
            setHoveredSegment(segment);
            // Set tooltip position near mouse
            const rect = e.target.getBoundingClientRect();
            setTooltipPosition({
              x: rect.left + rect.width / 2,
              y: rect.top,
            });
          });

          region.element.addEventListener("mouseleave", () => {
            setHoveredSegment(null);
          });

          // Make regions clickable (including Unknown regions now)
          region.element.style.cursor = "pointer";
          region.element.addEventListener("click", () => {
            if (onSegmentClick && segment) {
              onSegmentClick(segment);
            }
          });
        }

        // Apply visual fading effect for filtered segments
        if (filteredSpeakers.length > 0) {
          // If we're in filtered mode, make waveform less prominent
          wavesurfer.container.style.opacity = "0.4";

          // Make this region fully visible if it's selected
          if (isSelected) {
            region.element.style.opacity = "1";
          }
        }
      });
    }, [segments, filteredSpeakers, speakerColors, speakerColorMap, onSegmentClick]);

    // Helper to adjust color opacity
    const adjustColorOpacity = (color, opacity) => {
      // For hex colors
      if (color.startsWith("#")) {
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${opacity})`;
      }
      // For rgb colors
      if (color.startsWith("rgb")) {
        // Extract rgb values
        const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (rgbMatch) {
          return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${opacity})`;
        }
      }
      // Default fallback
      return color;
    };

    // Update playback state
    useEffect(() => {
      if (wavesurferRef.current && ready) {
        if (isPlaying) {
          wavesurferRef.current.play();
        } else {
          wavesurferRef.current.pause();
        }
      }
    }, [isPlaying, ready]);

    // Update regions when filtered speakers change
    useEffect(() => {
      if (wavesurferRef.current && ready) {
        addRegions(wavesurferRef.current);
      }
    }, [filteredSpeakers, segments, addRegions, ready]);

    // Add this effect to apply fading to non-selected parts of the waveform
    useEffect(() => {
      if (!wavesurferRef.current || !ready) return;

      const wavesurfer = wavesurferRef.current;

      // Add a semi-transparent overlay to the entire waveform container
      // when filtering is active
      if (filteredSpeakers.length > 0) {
        // Create a semi-transparent overlay for the waveform
        wavesurfer.container.style.opacity = "0.4"; // Reduce opacity of base waveform

        // Make selected regions fully visible
        Object.values(regionsRef.current).forEach((region) => {
          if (region.element) {
            region.element.style.opacity = "1"; // Full opacity for selected regions
          }
        });
      } else {
        // Reset opacity when showing all speakers
        wavesurfer.container.style.opacity = "1";

        Object.values(regionsRef.current).forEach((region) => {
          if (region.element) {
            region.element.style.opacity = "1";
          }
        });
      }
    }, [filteredSpeakers, ready]);

    // Add this useEffect to ensure proper initialization
    useEffect(() => {
      // When the component mounts, ensure the filteredSpeakers state is properly handled
      if (ready && wavesurferRef.current) {
        // Clear and re-add all regions to ensure proper rendering
        wavesurferRef.current.clearRegions();
        regionsRef.current = {};
        addRegions(wavesurferRef.current);

        // Reset the waveform container opacity
        wavesurferRef.current.container.style.opacity = "1";

        // Set all regions to full opacity
        Object.values(regionsRef.current).forEach((region) => {
          if (region.element) {
            region.element.style.opacity = "1";
          }
        });
      }
      // Resetting every region to full opacity is idempotent, so re-running it
      // when the regions themselves change is right rather than merely safe.
    }, [ready, addRegions]);

    // Format time display
    const formatTime = (time) => {
      if (!time) return "00:00";
      const minutes = Math.floor(time / 60);
      const seconds = Math.floor(time % 60);
      return `${minutes.toString().padStart(2, "0")}:${seconds
        .toString()
        .padStart(2, "0")}`;
    };

    // Fix the time update event listener to prevent null reference errors
    useEffect(() => {
      if (!wavesurferRef.current || !ready) return;

      const updateTimeHandler = (currentTime) => {
        // Add safety check to prevent calling methods on null
        if (!wavesurferRef.current) return;

        try {
          // Use the provided time parameter instead of calling getCurrentTime
          // This avoids the null reference issue
          onTimeUpdate(currentTime);
        } catch (err) {
          console.error("Error in time update handler:", err);
        }
      };

      // Also add safety check for seek event
      const seekHandler = () => {
        if (!wavesurferRef.current) return;

        try {
          const newTime = wavesurferRef.current.getCurrentTime();
          setCurrentTimeDisplay(newTime);
          onTimeUpdate(newTime);
          onSeek(newTime); // Call onSeek when user seeks
        } catch (err) {
          console.error("Error in seek handler:", err);
        }
      };

      // Attach event handlers with proper error handling
      wavesurferRef.current.on("audioprocess", updateTimeHandler);
      wavesurferRef.current.on("seek", seekHandler);
      wavesurferRef.current.on("interaction", seekHandler); // Also handle mouse interactions

      return () => {
        // Safely remove event listeners with null check
        if (wavesurferRef.current) {
          try {
            wavesurferRef.current.un("audioprocess", updateTimeHandler);
            wavesurferRef.current.un("seek", seekHandler);
            wavesurferRef.current.un("interaction", seekHandler);
          } catch (err) {
            console.error("Error removing event listeners:", err);
          }
        }
      };
      // `wavesurferRef.current` was listed here but mutating a ref does not
      // re-render, so it could never trigger this effect. `ready` is the real
      // signal — it flips once the instance exists.
    }, [ready, onTimeUpdate, onSeek]);

    // Add method to set current time programmatically
    const setCurrentTime = (time) => {
      if (wavesurferRef.current && ready) {
        wavesurferRef.current.setCurrentTime(time);
      }
    };

    // Expose setCurrentTime method through ref
    useImperativeHandle(ref, () => ({
      setCurrentTime,
      getCurrentTime: () => {
        if (wavesurferRef.current && ready) {
          return wavesurferRef.current.getCurrentTime();
        }
        return 0;
      },
    }));

    // Add effect to update waveform colors when they change
    useEffect(() => {
      if (wavesurferRef.current && ready) {
        wavesurferRef.current.setWaveColor(waveColor);
        wavesurferRef.current.setProgressColor(progressColor);
      }
    }, [waveColor, progressColor, ready]);

    return (
      <Box sx={{ position: "relative", width: "100%" }}>
        {/* Loading indicator */}
        {loading && (
          <Box
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(0,0,0,0.3)",
              zIndex: 10,
            }}
          >
            <CircularProgress size={40} />
          </Box>
        )}

        {/* Waveform container */}
        <Box
          ref={containerRef}
          sx={{
            position: "relative",
            width: "100%",
            height: `${height}px`,
            borderRadius: "4px",
            backgroundColor: backgroundColor,
            cursor: "pointer",
            overflowX: "auto",
          }}
        />

        {/* Move the Play/Pause button to bottom left */}
        <Box
          sx={{
            position: "absolute",
            bottom: height + 10, // Position at the bottom edge of the waveform
            left: 10,
            zIndex: 5,
            opacity: loading ? 0 : 0.8,
            transition: "opacity 0.2s",
            "&:hover": {
              opacity: 1,
            },
          }}
        >
          <IconButton
            onClick={(e) => {
              e.stopPropagation(); // Prevent bubbling
              if (wavesurferRef.current && ready) {
                onPlayPause();
              }
            }}
            disabled={loading || !ready}
            size="small"
            sx={{
              backgroundColor: "rgba(0,0,0,0.7)",
              color: "white",
              "&:hover": {
                backgroundColor: "rgba(0,0,0,0.9)",
              },
            }}
          >
            {isPlaying ? (
              <PauseIcon fontSize="small" />
            ) : (
              <PlayArrowIcon fontSize="small" />
            )}
          </IconButton>
        </Box>

        {/* Improved zoom controls - scaled down version */}
        <Box
          sx={{
            position: "absolute",
            top: 5,
            right: 10,
            display: "flex",
            alignItems: "center",
            gap: 0.5, // Reduced gap
            zIndex: 5,
            backdropFilter: "blur(4px)",
            borderRadius: 1.5, // Slightly smaller radius
            padding: "1px", // Reduced padding
            backgroundColor: "rgba(0,0,0,0.3)",
          }}
        >
          {/* Zoom level indicator - scaled down */}
          {zoom > 1 && (
            <Box
              sx={{
                backgroundColor: "rgba(20,20,30,0.8)",
                color: "#fff",
                padding: "2px 6px", // Reduced padding
                borderRadius: "8px", // Smaller radius
                fontSize: "0.7rem", // Smaller font
                fontWeight: "bold",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: "32px", // Smaller width
                height: "20px", // Fixed height
              }}
            >
              {Math.round(zoom)}x
            </Box>
          )}

          {/* Zoom out button - scaled down */}
          <Tooltip title="Zoom out">
            <IconButton
              size="small"
              onClick={() => {
                if (wavesurferRef.current && ready) {
                  const newZoom = Math.max(1, zoom - 1);
                  wavesurferRef.current.zoom(newZoom);
                  setZoom(newZoom);
                }
              }}
              sx={{
                backgroundColor: "rgba(20,20,30,0.85)",
                color: "white",
                width: 24, // Reduced size
                height: 24, // Reduced size
                "&:hover": {
                  backgroundColor: "rgba(40,40,60,0.95)",
                },
              }}
            >
              <Box
                component="span"
                sx={{ fontSize: "0.9rem", fontWeight: "bold" }} // Smaller font
              >
                -
              </Box>
            </IconButton>
          </Tooltip>

          {/* Reset zoom button - scaled down */}
          <Tooltip title="Reset zoom">
            <IconButton
              size="small"
              onClick={() => {
                if (wavesurferRef.current && ready) {
                  wavesurferRef.current.zoom(1);
                  setZoom(1);
                }
              }}
              sx={{
                backgroundColor: "rgba(20,20,30,0.85)",
                color: "white",
                width: 24, // Reduced size
                height: 24, // Reduced size
                "&:hover": {
                  backgroundColor: "rgba(40,40,60,0.95)",
                },
              }}
            >
              <Box
                component="span"
                sx={{ fontSize: "0.6rem", fontWeight: "bold" }} // Smaller font
              >
                1:1
              </Box>
            </IconButton>
          </Tooltip>

          {/* Zoom in button - scaled down */}
          <Tooltip title="Zoom in">
            <IconButton
              size="small"
              onClick={() => {
                if (wavesurferRef.current && ready) {
                  const newZoom = Math.min(50, zoom + 1);
                  wavesurferRef.current.zoom(newZoom);
                  setZoom(newZoom);
                }
              }}
              sx={{
                backgroundColor: "rgba(20,20,30,0.85)",
                color: "white",
                width: 24, // Reduced size
                height: 24, // Reduced size
                "&:hover": {
                  backgroundColor: "rgba(40,40,60,0.95)",
                },
              }}
            >
              <Box
                component="span"
                sx={{ fontSize: "0.9rem", fontWeight: "bold" }} // Smaller font
              >
                +
              </Box>
            </IconButton>
          </Tooltip>
        </Box>

        {/* Time display */}
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            mt: 1,
            color: "text.secondary",
            fontSize: "0.75rem",
          }}
        >
          <Typography variant="caption">
            {formatTime(currentTimeDisplay)}
          </Typography>
          <Typography variant="caption">
            {ready && wavesurferRef.current
              ? formatTime(wavesurferRef.current.getDuration())
              : "00:00"}
          </Typography>
        </Box>

        {/* Keep the zoom instructions */}
        <Typography
          variant="caption"
          sx={{
            color: "text.secondary",
            display: "block",
            textAlign: "center",
            mt: 0.5,
          }}
        >
          Scroll up/down to zoom, left/right to pan
        </Typography>

        {/* Tooltip for hovered segment */}
        {hoveredSegment && (
          <Tooltip
            open={Boolean(hoveredSegment)}
            title={
              <Box>
                <Typography variant="subtitle2">
                  {getDisplayName(hoveredSegment.speaker)}
                </Typography>
                <Typography variant="caption">
                  {formatTime(hoveredSegment.start)} -{" "}
                  {formatTime(hoveredSegment.end)}
                </Typography>
                {hoveredSegment.text && (
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    "{hoveredSegment.text}"
                  </Typography>
                )}
              </Box>
            }
            placement="top"
            arrow
            PopperProps={{
              sx: {
                "& .MuiTooltip-tooltip": {
                  backgroundColor: "rgba(0,0,0,0.9)",
                  maxWidth: 300,
                },
              },
              style: {
                // Position tooltip near mouse
                top: `${tooltipPosition.y}px`,
                left: `${tooltipPosition.x}px`,
              },
            }}
          >
            <Box
              sx={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
              }}
            />
          </Tooltip>
        )}
      </Box>
    );
  }
);

export default ColoredAudioWaveform;
