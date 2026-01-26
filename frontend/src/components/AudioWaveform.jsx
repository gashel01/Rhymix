import React, { useEffect, useRef, useState } from "react";
import { Box, IconButton, Typography } from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import DownloadIcon from "@mui/icons-material/Download";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import WaveSurfer from "wavesurfer.js";

const AudioWaveform = (
  {
    url: initialUrl,
    isPlaying,
    onPlayPause,
    onDownload,
    height = 70,
    progressColor = "#1976d2",
    waveColor = "#9e9e9e",
    backgroundColor = "#2a2a2a",
    isPrimary = false,
    badgeText = null,
    onReady = () => {},
    onPositionChange = () => {},
    onSeek = () => {},
    otherWaveform = null,
    isMuted = false,
    volume = 1,
    onTimeUpdate = () => {},
  },
  ref
) => {
  const containerRef = useRef();
  const waveSurferRef = useRef();
  const [ready, setReady] = useState(false);
  const isSyncingRef = useRef(false); // Flag to prevent infinite loops
  const [rawMode, setRawMode] = useState(false);
  const [url, setUrl] = useState(initialUrl);
  const audioContext = useRef(null);
  const gainNode = useRef(null);
  const volumeRef = useRef(volume);
  const isMountedRef = useRef(true);
  const abortControllerRef = useRef(null);
  const isReadyRef = useRef(false); // Track if wavesurfer has finished loading

  const clampVolume = (value) => {
    if (Number.isFinite(value)) {
      return Math.max(0, Math.min(1, value));
    }
    return 1;
  };

  const applyVolume = (nextVolume, mutedOverride = false) => {
    const targetVolume = mutedOverride ? 0 : clampVolume(nextVolume);
    const currentWavesurfer = waveSurferRef.current;

    if (currentWavesurfer && typeof currentWavesurfer.setVolume === "function") {
      currentWavesurfer.setVolume(targetVolume);
      return;
    }

    if (gainNode.current && audioContext.current) {
      try {
        gainNode.current.gain.setValueAtTime(
          gainNode.current.gain.value,
          audioContext.current.currentTime
        );
        gainNode.current.gain.linearRampToValueAtTime(
          targetVolume,
          audioContext.current.currentTime + 0.1
        );
      } catch (err) {
        console.error("Error updating gain for volume:", err);
      }
      return;
    }

    if (currentWavesurfer && currentWavesurfer.backend && currentWavesurfer.backend.gainNode) {
      currentWavesurfer.backend.gainNode.gain.value = targetVolume;
    }
  };

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  // Create wavesurfer function
  const createWaveSurfer = (audioUrl) => {
    if (containerRef.current) {
      // Reset ready state for new instance
      isReadyRef.current = false;
      setReady(false);
      
      // Note: abortControllerRef.current should already be set by the caller

      // Create wavesurfer instance
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
        minPxPerSec: 50,
        hideScrollbar: true,
        fetchParams: {
          signal: abortControllerRef.current.signal,
        },
      });

      // Load audio file - catch promise rejection to prevent unhandled rejection errors
      wavesurfer.load(audioUrl).catch((err) => {
        if (err.name === 'AbortError' || 
            err.message?.includes('aborted') || 
            err.message?.includes('signal is aborted') ||
            err.message?.includes('BodyStreamBuffer was aborted')) {
          // Silently ignore: this is expected during cleanup/re-renders
          return;
        }
        console.error("WaveSurfer load error:", err);
      });

      // Handle user-initiated seeks only, not programmatic ones
      // Note: "backend" here refers to wavesurfer's internal audio engine (Web Audio API), not the server
      const handleSeek = () => {
        // Skip if we're currently synchronizing
        if (!isSyncingRef.current) {
          try {
            // Use the ref to get the current instance (closure variable might be stale)
            const currentWaveform = waveSurferRef.current;
            
            // Make sure wavesurfer's audio engine is initialized (needed to get current time)
            // The audio engine (backend) is initialized when the "ready" event fires
            if (currentWaveform ) {
              const time = currentWaveform.getCurrentTime();
             
              // Notify parent component, which will handle syncing the other waveform
              if (onSeek && typeof onSeek === 'function') {;
                onSeek(time);
              }
            }
            // If audio engine not ready yet, ignore the seek - it will work once ready
          } catch (err) {
            console.error("Error during seek event:", err);
          }
        }
      };

      // Event handlers
      wavesurfer.on("ready", () => {
        setReady(true);
        isReadyRef.current = true; // Mark as ready - no need to abort anymore

        // Set up gain node for muting/unmuting
        // Check if backend is available before accessing
        if (wavesurfer.backend && wavesurfer.backend.ac) {
          audioContext.current = wavesurfer.backend.ac;
          gainNode.current = audioContext.current.createGain();
          wavesurfer.backend.setFilters([gainNode.current]);

          // Verify gainNode was created and added to filters
          const filters = wavesurfer.backend.filters || [];
          const gainNodeInFilters = filters.find(f => f === gainNode.current);
          if (!gainNodeInFilters) {
            console.warn('gainNode created but not found in filters array');
          }

        // Initialize volume/mute state
        applyVolume(volumeRef.current, isMuted);
        }

        // Attach seek handlers only after waveform is ready (backend is initialized)
        wavesurfer.on("seek", handleSeek);
        wavesurfer.on("interaction", handleSeek);

        // Handle errors (especially AbortError during hot reload)
        wavesurfer.on("error", (err) => {
          // Suppress AbortError - it's expected when component unmounts or URL changes
          if (err.name === 'AbortError' || 
              err.message?.includes('aborted') || 
              err.message?.includes('signal is aborted')) {
            // This is expected during cleanup or hot module reload - silently ignore
            return;
          }
          // Log other errors
          console.error("WaveSurfer error:", err);
        });

        // Create a wrapper object that exposes the methods we need
        // This matches the interface expected by the parent components
        // Use waveSurferRef.current to always get the current instance (closure variable might be stale)
        const waveformWrapper = {
          setCurrentTime: (time) => {
            try {
              const currentWavesurfer = waveSurferRef.current;
              if (currentWavesurfer && typeof time === "number") {
                // Don't check backend - seekTo might work even if backend isn't fully initialized
                isSyncingRef.current = true;
                const duration = currentWavesurfer.getDuration();
                if (duration > 0 && duration !== Infinity && !isNaN(duration)) {
                  // Use seekTo with normalized position (0-1) - this is the correct method for wavesurfer
                  const normalizedPosition = Math.max(0, Math.min(1, time / duration));
                  currentWavesurfer.seekTo(normalizedPosition);
                }
                setTimeout(() => {
                  isSyncingRef.current = false;
                }, 50);
              } else {
                console.warn('waveformWrapper.setCurrentTime: wavesurfer not available', {
                  hasWavesurfer: !!currentWavesurfer,
                  timeType: typeof time
                });
              }
            } catch (err) {
              console.error("Error in waveformWrapper.setCurrentTime:", err);
              isSyncingRef.current = false;
            }
          },
          getCurrentTime: () => {
            const currentWavesurfer = waveSurferRef.current;
            return currentWavesurfer ? currentWavesurfer.getCurrentTime() : 0;
          },
          getDuration: () => {
            const currentWavesurfer = waveSurferRef.current;
            return currentWavesurfer ? currentWavesurfer.getDuration() : 0;
          },
          isPlaying: () => {
            const currentWavesurfer = waveSurferRef.current;
            return currentWavesurfer ? currentWavesurfer.isPlaying() : false;
          },
          play: () => {
            const currentWavesurfer = waveSurferRef.current;
            if (currentWavesurfer) currentWavesurfer.play();
          },
          pause: () => {
            const currentWavesurfer = waveSurferRef.current;
            if (currentWavesurfer) currentWavesurfer.pause();
          },
          setMuted: (muted) => {
            const targetMuted = !!muted;
            applyVolume(volumeRef.current, targetMuted);
          },
          getWavesurfer: () => waveSurferRef.current,
        };
        
        onReady(waveformWrapper);
      });

      // Only emit progress updates periodically
      wavesurfer.on("audioprocess", () => {
        // Skip if we're currently synchronizing
        if (!isSyncingRef.current) {
          onPositionChange(wavesurfer.getCurrentTime());
        }
      });

      // Handle playback completion
      wavesurfer.on("finish", () => {
        // If we're linked to another waveform and it's not already paused, pause it
        if (otherWaveform && otherWaveform.isPlaying()) {
          otherWaveform?.pause();
        }
      });

      waveSurferRef.current = wavesurfer;
      return wavesurfer;
    }
    return null;
  };

  // Initialize wavesurfer when component mounts or URL changes
  useEffect(() => {
    isMountedRef.current = true;
    let timeoutId = null;
    
    if (containerRef.current && url) {
      // 1. Cleanup previous instance
      if (waveSurferRef.current) {
        // Abort any ongoing fetch first
        if (abortControllerRef.current) {
          try {
            abortControllerRef.current.abort();
          } catch (err) {
            // Ignore abort errors
          }
          abortControllerRef.current = null;
        }
        
        // Then destroy the instance
        try {
          if (waveSurferRef.current.isPlaying && waveSurferRef.current.isPlaying()) {
            waveSurferRef.current.pause();
          }
          waveSurferRef.current.destroy();
        } catch (e) {
          // destroy() sometimes throws if called mid-loading; ignore it
        }
        waveSurferRef.current = null;
        isReadyRef.current = false; // Reset ready state
      }

      // 2. Initialize new instance
      // Small delay to prevent React Strict Mode double-mount from cancelling requests
      timeoutId = setTimeout(() => {
        if (!isMountedRef.current || !containerRef.current) return;
        
        // Create fresh abort controller for new instance
        abortControllerRef.current = new AbortController();
        
        // Create the wavesurfer instance
        const wavesurfer = createWaveSurfer(url);
        if (wavesurfer) {
          waveSurferRef.current = wavesurfer;
        }
      }, 50); // Small delay to let React Strict Mode settle
    }

    // Cleanup on unmount
    return () => {
      isMountedRef.current = false;
      
      // Clear timeout if component unmounts before delay completes
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      
      // Abort the fetch first
      if (abortControllerRef.current) {
        try {
          abortControllerRef.current.abort();
        } catch (err) {
          // Silently ignore abort errors
        }
        abortControllerRef.current = null;
      }
      
      // Then destroy the instance
      if (waveSurferRef.current) {
        try {
          // Stop playback first
          if (waveSurferRef.current.isPlaying && typeof waveSurferRef.current.isPlaying === "function") {
            try {
              if (waveSurferRef.current.isPlaying()) {
                waveSurferRef.current.pause();
              }
            } catch (e) {
              // Ignore pause errors
            }
          }

          // Unregister events if possible
          try {
            waveSurferRef.current.un("ready");
            waveSurferRef.current.un("seek");
            waveSurferRef.current.un("interaction");
            waveSurferRef.current.un("audioprocess");
            waveSurferRef.current.un("finish");
          } catch (e) {
            // Ignore unregister errors
          }

          // Destroy with error handling
          // destroy() sometimes throws if called mid-loading; ignore it
          if (typeof waveSurferRef.current.destroy === "function") {
            try {
              waveSurferRef.current.destroy();
            } catch (err) {
              // Silently ignore synchronous errors
            }
          }
        } catch (err) {
          // Silently ignore all cleanup errors
        }
        waveSurferRef.current = null;
      }
      
      isReadyRef.current = false; // Reset ready state
    };
  }, [url]); // Only dependency is url now

  // Update our url state if the prop changes
  useEffect(() => {
    if (initialUrl !== url) {
      setUrl(initialUrl);
    }
  }, [initialUrl]);

  // Handle play/pause state
  useEffect(() => {
    if (waveSurferRef.current && ready) {
      if (isPlaying) {
        waveSurferRef?.current?.play();
      } else {
        waveSurferRef?.current?.pause();
      }
    }
  }, [isPlaying, ready]);

  // Handle mute/unmute state and volume
  useEffect(() => {
    if (!ready) return;
    applyVolume(volume, isMuted);
  }, [isMuted, volume, ready]);

  // Handle direct user interactions with the waveform
  useEffect(() => {
    if (containerRef.current && waveSurferRef.current && ready) {
      const handleClick = (event) => {
        // Only handle direct user clicks
        if (event.isTrusted && !isSyncingRef.current) {
          // Small timeout to allow wavesurfer to update its time first
          setTimeout(() => {
            try {
              if (waveSurferRef.current && waveSurferRef.current.backend) {
                const time = waveSurferRef.current.getCurrentTime();
                onSeek(time);
              }
            } catch (err) {
              console.error("Error in click handler:", err);
            }
          }, 10);
        }
      };

      containerRef?.current?.addEventListener("click", handleClick);

      return () => {
        containerRef?.current?.removeEventListener("click", handleClick);
      };
    }
  }, [ready, onSeek]);

  // This function safely updates the current time without triggering an infinite loop
  const safeSetCurrentTime = (time) => {
    if (waveSurferRef.current && ready) {
      try {
        // Check if wavesurfer is still valid and has backend initialized
        if (waveSurferRef.current.backend && typeof time === "number") {
          // Set the flag to prevent event handlers from firing
          isSyncingRef.current = true;

          // Set the time
          waveSurferRef.current.setCurrentTime(time);

          // Reset the flag after a short delay
          setTimeout(() => {
            isSyncingRef.current = false;
          }, 50);
        }
      } catch (err) {
        console.error("Error setting current time:", err);
        // Reset the flag in case of error
        isSyncingRef.current = false;
      }
    }
  };

  // Method to get the current playback state
  const isWaveformPlaying = () => {
    return waveSurferRef.current?.isPlaying() || false;
  };

  // Method to mute/unmute the audio without stopping playback
  const setMuted = (muted) => {
    applyVolume(volumeRef.current, muted);
  };

  // Expose the waveform control methods to parent component
  React.useImperativeHandle(ref, () => ({
    setCurrentTime: safeSetCurrentTime,
    getCurrentTime: () => {
      try {
        if (waveSurferRef.current && waveSurferRef.current.getCurrentTime) {
          return waveSurferRef.current.getCurrentTime();
        }
        return 0;
      } catch (err) {
        console.error("Error getting current time:", err);
        return 0;
      }
    },
    getDuration: () => {
      try {
        if (waveSurferRef.current && waveSurferRef.current.getDuration) {
          return waveSurferRef.current.getDuration();
        }
        return 0;
      } catch (err) {
        console.error("Error getting duration:", err);
        return 0;
      }
    },
    isPlaying: () => {
      try {
        return (
          (waveSurferRef.current && waveSurferRef.current.isPlaying()) || false
        );
      } catch (err) {
        console.error("Error checking if playing:", err);
        return false;
      }
    },
    play: () => {
      try {
        if (waveSurferRef.current && waveSurferRef.current.backend) {
          waveSurferRef.current.play();
        }
      } catch (err) {
        console.error("Error during play:", err);
      }
    },
    pause: () => {
      try {
        if (waveSurferRef.current && waveSurferRef.current.backend) {
          waveSurferRef.current.pause();
        }
      } catch (err) {
        console.error("Error during pause:", err);
      }
    },
    setMuted,
    getWavesurfer: () => waveSurferRef.current,
  }));

  const toggleVocalType = () => {
    if (!url || !url.includes("vocals")) return;

    // Toggle the raw mode state
    setRawMode(!rawMode);

    // Construct the new URL based on the toggle state
    let newUrl;
    if (rawMode) {
      // Switching from raw to processed
      newUrl = url.replace("/raw_vocals/", "/processed_vocals/");
    } else {
      // Switching from processed to raw
      newUrl = url.replace("/processed_vocals/", "/raw_vocals/");
    }

    // Update the URL
    setUrl(newUrl);

    // If audio is already loaded, recreate it with the new URL
    if (waveSurferRef.current) {
      const wasPlaying = waveSurferRef.current.isPlaying();
      waveSurferRef.current.destroy();
      createWaveSurfer(newUrl);
      if (wasPlaying) {
        // Small delay to ensure the new wavesurfer is ready
        setTimeout(() => {
          if (waveSurferRef.current) {
            waveSurferRef.current.play();
          }
        }, 100);
      }
    }
  };

  // Add time update event listener
  useEffect(() => {
    if (waveSurferRef.current) {
      // Set up timeupdate event listener
      const updateTimeHandler = (currentTime) => {
        onTimeUpdate(currentTime);
      };

      waveSurferRef.current.on("audioprocess", updateTimeHandler);

      return () => {
        if (waveSurferRef.current) {
          waveSurferRef.current.un("audioprocess", updateTimeHandler);
        }
      };
    }
  }, [waveSurferRef.current, onTimeUpdate]);

  return (
    <Box
      sx={{
        position: "relative",
        width: "100%",
        overflow: "hidden",
      }}
    >
      {/* Waveform container */}
      <Box
        ref={containerRef}
        sx={{
          width: "100%",
          height: `${height}px`,
          borderRadius: "4px",
          overflow: "hidden",
          backgroundColor: backgroundColor,
          opacity: url ? (isMuted ? 0.5 : 1) : 0.3, // Reduced opacity when muted
          pointerEvents: "auto",
          overscrollBehaviorY: "none",
          touchAction: "pan-x",
        }}
      />

      {/* Badge for raw/processed */}
      {badgeText && (
        <Typography
          variant="caption"
          sx={{
            position: "absolute",
            top: 4,
            right: 8,
            backgroundColor: "rgba(0,0,0,0.5)",
            color: "white",
            padding: "2px 8px",
            backdropFilter: "blur(5px)",
            zIndex: 1000,
            alignSelf: "flex-end",
            borderRadius: 8,
            fontSize: "0.7rem",
          }}
        >
          {badgeText}
        </Typography>
      )}

      {/* Controls */}
      <Box
        sx={{
          position: "absolute",
          right: 8,
          bottom: 4,
          display: "flex",
          zIndex: 1000,
          gap: 1,
        }}
      >
        {/* Mute/Unmute button with container */}
        <Box
          sx={{
            backgroundColor: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(3px)",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "28px",
            width: "28px",
            "&:hover": { backgroundColor: "rgba(0,0,0,0.8)" },
          }}
        >
          <IconButton
            disabled={!url || !ready}
            onClick={onPlayPause}
            sx={{
              color: "white",
              padding: 0,
              height: "24px",
              width: "24px",
            }}
          >
            {isMuted ? (
              <VolumeOffIcon sx={{ height: "18px", width: "18px" }} />
            ) : (
              <VolumeUpIcon sx={{ height: "18px", width: "18px" }} />
            )}
          </IconButton>
        </Box>

        {/* Download button with container */}
        <Box
          sx={{
            backgroundColor: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(3px)",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "28px",
            width: "28px",
            "&:hover": { backgroundColor: "rgba(0,0,0,0.8)" },
          }}
        >
          <IconButton
            disabled={!url}
            onClick={onDownload}
            sx={{
              color: "white",
              padding: 0,
              height: "24px",
              width: "24px",
            }}
          >
            <DownloadIcon sx={{ height: "18px", width: "18px" }} />
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
};

export default React.forwardRef(AudioWaveform);
