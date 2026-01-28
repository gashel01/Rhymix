import React, { useEffect, useRef, useState } from "react";
import { Box, IconButton, Typography } from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import WaveSurfer from "wavesurfer.js";
import { useVolume } from "../contexts/VolumeContext";

/**
 * AudioWaveform (fixed mute)
 * - Mute works in BOTH controlled and uncontrolled modes:
 *   - Controlled: pass isMuted + onToggleMute(nextMuted)
 *   - Uncontrolled: omit onToggleMute => internal mute state is used
 * - Also calls wavesurfer.setMuted / setVolume / gainNode fallback
 */

const AudioWaveform = (
  {
    url: initialUrl,
    isPlaying,
    onDownload,

    // mute props
    isMuted, // optional controlled
    onToggleMute, // optional controlled: (nextMuted:boolean)=>void

    // visuals
    height = 70,
    progressColor = "#1976d2",
    waveColor =  "#9e9e9e",
    backgroundColor,
    badgeText = null,
    isDark: isDarkProp,
    volume: volumeProp = 1, // Keep prop for backward compatibility

    // callbacks
    onReady = () => {},
    onPositionChange = () => {},
    onSeek = () => {},
    onTimeUpdate = () => {},
    otherWaveform = null,

    // playback state hygiene
    onRequestStop = () => {}, // optional
  },
  ref
) => {
  const containerRef = useRef(null);
  const waveSurferRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [url, setUrl] = useState(initialUrl);

  // uncontrolled fallback mute state
  const [localMuted, setLocalMuted] = useState(false);

  const isMountedRef = useRef(true);
  const abortControllerRef = useRef(null);
  const isSyncingRef = useRef(false);

  const audioContext = useRef(null);
  const gainNode = useRef(null);
  
  // Use volume from context if available, otherwise use prop
  const volumeContext = useVolume();
  const volumeRef = useRef(volumeContext?.volumeRef?.current ?? volumeProp ?? 1);

  const isDark =
    typeof isDarkProp === "boolean"
      ? isDarkProp
      : typeof window !== "undefined"
      ? window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false
      : false;

  const t = {
    text: isDark ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.90)",
    subtext: isDark ? "rgba(255,255,255,0.62)" : "rgba(0,0,0,0.55)",
    hairline: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)",
    glass: isDark ? "rgba(18,18,20,0.50)" : "rgba(255,255,255,0.60)",
    glass2: isDark ? "rgba(18,18,20,0.30)" : "rgba(255,255,255,0.35)",
    shadow: isDark ? "0 10px 24px rgba(0,0,0,0.35)" : "0 12px 26px rgba(0,0,0,0.10)",
    radius: 14,
    bg: backgroundColor ?? (isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.03)"),
  };

  // decide which mute state to display/use
  const mutedValue = typeof isMuted === "boolean" ? isMuted : localMuted;

  const destroyWaveSurfer = () => {
    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort();
      } catch {}
      abortControllerRef.current = null;
    }

    const ws = waveSurferRef.current;
    if (!ws) return;

    try {
      ws.un?.("ready");
      ws.un?.("seek");
      ws.un?.("interaction");
      ws.un?.("audioprocess");
      ws.un?.("finish");
      ws.un?.("error");
    } catch {}

    try {
      if (ws.isPlaying?.()) ws.pause?.();
    } catch {}
    try {
      ws.stop?.();
    } catch {}

    try {
      ws.destroy?.();
    } catch {}

    waveSurferRef.current = null;
    audioContext.current = null;
    gainNode.current = null;
    setReady(false);
  };

  const clampVolume = (value) => {
    if (typeof value !== "number" || Number.isNaN(value)) return 1;
    return Math.max(0, Math.min(1, value));
  };

  const applyPlaybackVolume = (muted, value) => {
    const ws = waveSurferRef.current;
    if (!ws) return;

    const targetMuted = !!muted;
    const targetVolume = targetMuted ? 0 : clampVolume(value);

    if (typeof ws.setVolume === "function") {
      try {
        ws.setVolume(targetVolume);
        return;
      } catch {}
    }
    if (typeof ws.setMuted === "function") {
      try {
        ws.setMuted(targetMuted);
        return;
      } catch {}
    }

    // GainNode fallback
    if (gainNode.current && audioContext.current) {
      const ac = audioContext.current;
      const gn = gainNode.current;
      try {
        const val = targetVolume;
        gn.gain.setValueAtTime(gn.gain.value, ac.currentTime);
        gn.gain.linearRampToValueAtTime(val, ac.currentTime + 0.08);
      } catch {}
    }
  };

  const createWaveSurfer = (audioUrl) => {
    if (!containerRef.current) return null;

    setReady(false);

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor,
      progressColor,
      backgroundColor: t.bg,
      height,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      cursorWidth: 1,
      cursorColor: isDark ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.6)",
      responsive: true,
      normalize: true,
      partialRender: true,
      minPxPerSec: 50,
      hideScrollbar: true,
      fetchParams: {
        signal: abortControllerRef.current?.signal,
      },
    });

    ws.on("error", (err) => {
      if (
        err?.name === "AbortError" ||
        err?.message?.includes("aborted") ||
        err?.message?.includes("signal is aborted") ||
        err?.message?.includes("BodyStreamBuffer was aborted")
      ) {
        return;
      }
      console.error("WaveSurfer error:", err);
    });

    const handleSeek = () => {
      if (isSyncingRef.current) return;
      try {
        const cur = waveSurferRef.current;
        if (!cur) return;
        const time = cur.getCurrentTime?.() ?? 0;
        onSeek?.(time);
      } catch (e) {
        console.error("Error during seek:", e);
      }
    };

    ws.on("ready", () => {
      setReady(true);

      // Setup gain node if possible
      try {
        if (ws.backend?.ac) {
          audioContext.current = ws.backend.ac;
          gainNode.current = audioContext.current.createGain();
          ws.backend.setFilters?.([gainNode.current]);
        }
      } catch {}

      // ✅ Apply volume + mute immediately on ready (critical)
      applyPlaybackVolume(mutedValue, volumeRef.current);

      ws.on("seek", handleSeek);
      ws.on("interaction", handleSeek);

      ws.on("audioprocess", () => {
        if (isSyncingRef.current) return;
        try {
          const curT = ws.getCurrentTime?.() ?? 0;
          onPositionChange?.(curT);
          onTimeUpdate?.(curT);
        } catch {}
      });

      ws.on("finish", () => {
        try {
          if (otherWaveform?.isPlaying?.()) otherWaveform.pause?.();
        } catch {}
      });

      const wrapper = {
        setCurrentTime: (time) => {
          const cur = waveSurferRef.current;
          if (!cur || typeof time !== "number") return;

          isSyncingRef.current = true;
          try {
            const d = cur.getDuration?.() ?? 0;
            if (d > 0 && d !== Infinity && !Number.isNaN(d)) {
              const norm = Math.max(0, Math.min(1, time / d));
              cur.seekTo?.(norm);
            }
          } finally {
            setTimeout(() => (isSyncingRef.current = false), 40);
          }
        },
        getCurrentTime: () => waveSurferRef.current?.getCurrentTime?.() ?? 0,
        getDuration: () => waveSurferRef.current?.getDuration?.() ?? 0,
        isPlaying: () => waveSurferRef.current?.isPlaying?.() ?? false,
        play: () => waveSurferRef.current?.play?.(),
        pause: () => waveSurferRef.current?.pause?.(),
        setMuted: (muted) => applyPlaybackVolume(!!muted, volumeRef.current),
        getWavesurfer: () => waveSurferRef.current,
      };

      onReady(wrapper);

      // respect external playing state
      if (isPlaying) {
        try {
          ws.play?.();
        } catch {}
      }
    });

    ws.load(audioUrl).catch((err) => {
      if (
        err?.name === "AbortError" ||
        err?.message?.includes("aborted") ||
        err?.message?.includes("signal is aborted") ||
        err?.message?.includes("BodyStreamBuffer was aborted")
      ) {
        return;
      }
      console.error("WaveSurfer load error:", err);
    });

    waveSurferRef.current = ws;
    return ws;
  };

  // prop -> internal url
  useEffect(() => {
    if (initialUrl !== url) setUrl(initialUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl]);

  // create/destroy on url change
  useEffect(() => {
    isMountedRef.current = true;

    // If parent thinks it's playing, request global stop (prevents “carryover”)
    if (isPlaying) {
      try {
        onRequestStop?.();
      } catch {}
    }

    destroyWaveSurfer();

    if (!containerRef.current || !url) return;

    abortControllerRef.current = new AbortController();

    const id = setTimeout(() => {
      if (!isMountedRef.current) return;
      createWaveSurfer(url);
    }, 30);

    return () => {
      isMountedRef.current = false;
      clearTimeout(id);
      destroyWaveSurfer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // play/pause sync
  useEffect(() => {
    const ws = waveSurferRef.current;
    if (!ws || !ready) return;
    try {
      if (isPlaying) ws.play?.();
      else ws.pause?.();
    } catch {}
  }, [isPlaying, ready]);

  // Update volume from context ref (doesn't cause re-renders)
  useEffect(() => {
    if (volumeContext?.volumeRef) {
      // Subscribe to volume changes from context
      const checkVolume = () => {
        const newVolume = volumeContext.volumeRef.current;
        if (volumeRef.current !== newVolume && ready) {
          volumeRef.current = newVolume;
          applyPlaybackVolume(mutedValue, newVolume);
        }
      };
      // Check periodically for volume changes (context ref doesn't trigger re-renders)
      const interval = setInterval(checkVolume, 50);
      return () => clearInterval(interval);
    } else {
      // Fallback to prop-based volume
      volumeRef.current = volumeProp ?? 1;
      if (ready) {
        applyPlaybackVolume(mutedValue, volumeProp ?? 1);
      }
    }
  }, [volumeContext?.volumeRef, ready, mutedValue, volumeProp, applyPlaybackVolume]);

  // Update volume from context ref (doesn't cause re-renders)
  useEffect(() => {
    if (volumeContext?.volumeRef) {
      // Subscribe to volume changes from context
      const checkVolume = () => {
        const newVolume = volumeContext.volumeRef.current;
        if (volumeRef.current !== newVolume && ready) {
          volumeRef.current = newVolume;
          applyPlaybackVolume(mutedValue, newVolume);
        }
      };
      // Check periodically for volume changes (context ref doesn't trigger re-renders)
      const interval = setInterval(checkVolume, 50);
      return () => clearInterval(interval);
    } else {
      // Fallback to prop-based volume
      volumeRef.current = volumeProp ?? 1;
      if (ready) {
        applyPlaybackVolume(mutedValue, volumeProp ?? 1);
      }
    }
  }, [volumeContext?.volumeRef, ready, mutedValue, volumeProp, applyPlaybackVolume]);

  // ✅ mute + volume sync (works for both controlled and uncontrolled)
  useEffect(() => {
    if (!ready) return;
    applyPlaybackVolume(mutedValue, volumeRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutedValue, ready]);

  // expose imperative API
  React.useImperativeHandle(ref, () => ({
    setCurrentTime: (time) => {
      const ws = waveSurferRef.current;
      if (!ws || !ready || typeof time !== "number") return;
      isSyncingRef.current = true;
      try {
        if (typeof ws.setTime === "function") ws.setTime(time);
        else if (typeof ws.setCurrentTime === "function") ws.setCurrentTime(time);
        else {
          const d = ws.getDuration?.() ?? 0;
          if (d > 0) ws.seekTo?.(Math.max(0, Math.min(1, time / d)));
        }
      } catch (e) {
        console.error("Error setting time:", e);
      } finally {
        setTimeout(() => (isSyncingRef.current = false), 40);
      }
    },
    getCurrentTime: () => waveSurferRef.current?.getCurrentTime?.() ?? 0,
    getDuration: () => waveSurferRef.current?.getDuration?.() ?? 0,
    isPlaying: () => waveSurferRef.current?.isPlaying?.() ?? false,
    play: () => waveSurferRef.current?.play?.(),
    pause: () => waveSurferRef.current?.pause?.(),
    setMuted: (muted) => applyPlaybackVolume(!!muted, volumeRef.current),
    getWavesurfer: () => waveSurferRef.current,
  }));

  // ✅ click handler for mute button
  const handleMuteClick = () => {
    const next = !mutedValue;

    // Controlled: tell parent what to set
    if (typeof onToggleMute === "function") {
      onToggleMute(next);
      return;
    }

    // Uncontrolled fallback: update local + apply immediately
    setLocalMuted(next);
    applyPlaybackVolume(next, volumeRef.current);
  };

  return (
    <Box sx={{ position: "relative", width: "100%", overflow: "hidden" }}>
      <Box
        ref={containerRef}
        sx={{
          width: "100%",
          height: `${height}px`,
         
          overflow: "hidden",
          backgroundColor: 'transparent',
          opacity: url ? (mutedValue ? 0.55 : 1) : 0.35,
       borderRadius: '12px',
        }}
      />

      {badgeText && (
        <Typography
          variant="caption"
          sx={{
            position: "absolute",
            top: 0,
            right: 2,
            zIndex: 5,
            px: "8px",
            py: "2px",
            borderRadius: 999,
            fontSize: "0.70rem",
            fontWeight: 800,
            letterSpacing: -0.1,
            color: t.text,
             border: `1px solid ${t.hairline}`,
            background: `linear-gradient(180deg, ${t.glass}, ${t.glass2})`,
            backdropFilter: "blur(70px)",
            WebkitBackdropFilter: "blur(10px)",
          }}
        >
          {badgeText}
        </Typography>
      )}

      <Box
        sx={{
          position: "absolute",
          right:2,
          bottom: 0,
          zIndex: 5,
          display: "flex",
          gap: 0.75,
          alignItems: "center",
        }}
      >
        <IconButton
          size="small"
          disabled={!url || !ready}
          onClick={handleMuteClick}
          sx={{
            width: 30,
            height: 30,
            borderRadius: 2,
             border: `1px solid ${t.hairline}`,
            background: `linear-gradient(180deg, ${t.glass}, ${t.glass2})`,
            backdropFilter: "blur(70px)",
            WebkitBackdropFilter: "blur(70px)",
            boxShadow: t.shadow,
            color: t.text,
            "&:hover": { background: `linear-gradient(180deg, ${t.glass}, ${t.glass})` },
          }}
        >
          {mutedValue ? (
            <VolumeOffIcon sx={{ width: 18, height: 18 }} />
          ) : (
            <VolumeUpIcon sx={{ width: 18, height: 18 }} />
          )}
        </IconButton>

        <IconButton
          size="small"
          disabled={!url}
          onClick={onDownload}
          sx={{
            width: 30,
            height: 30,
            borderRadius: 2,
             border: `1px solid ${t.hairline}`,
            background: `linear-gradient(180deg, ${t.glass}, ${t.glass2})`,
            backdropFilter: "blur(70px)",
            WebkitBackdropFilter: "blur(70px)",
            boxShadow: t.shadow,
            color: t.text,
            "&:hover": { background: `linear-gradient(180deg, ${t.glass}, ${t.glass})` },
          }}
        >
          <DownloadIcon sx={{ width: 18, height: 18 }} />
        </IconButton>
      </Box>
    </Box>
  );
};

export default React.forwardRef(AudioWaveform);
