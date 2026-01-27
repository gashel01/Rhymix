import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";

// keep your existing icon set (NOT changing icons)
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import LyricsIcon from "@mui/icons-material/Lyrics";
import DownloadIcon from "@mui/icons-material/Download";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import DeleteIcon from "@mui/icons-material/Delete";
import MicIcon from "@mui/icons-material/Mic";
import PersonIcon from "@mui/icons-material/Person";
import CloseIcon from "@mui/icons-material/Close";

// API base URL
const API_BASE = "";

const GENRE_RECS = [
  "Electro-pop",
  "Synthwave",
  "Alt-pop",
  "Indie rock",
  "Trap",
  "Lo-fi",
  "Ambient",
  "Cinematic",
];

const fmt = (s) => {
  const m = Math.floor(s / 60);
  const sec = String(s % 60).padStart(2, "0");
  return `${m}:${sec}`;
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const normalize = (s) => s.trim().replace(/\s+/g, " ");
const toKey = (s) => normalize(s).toLowerCase();

function CreateSongView({ onBack, onGenerate, darkMode }) {
  // ---------- Theme tokens ----------
  const isDark = useMemo(() => {
    if (typeof darkMode === "boolean") return darkMode;
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false;
  }, [darkMode]);

  const t = useMemo(() => {
    // ✅ NEW STYLE: clean neutral backgrounds (NO galaxy/radial backplates)
    const pageBg = isDark ? "#0B0B0F" : "#F4F5F7";
    const surfaceA = isDark ? "rgba(22,22,26,0.72)" : "rgba(255,255,255,0.74)";
    const surfaceB = isDark ? "rgba(28,28,34,0.62)" : "rgba(250,250,252,0.78)";
    const cardA = isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.86)";
    const cardB = isDark ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.72)";

    return {
      isDark,
      pageBg,

      text: isDark ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.90)",
      subtext: isDark ? "rgba(255,255,255,0.62)" : "rgba(0,0,0,0.55)",
      hairline: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)",

      glassA: surfaceA,
      glassB: surfaceB,

      cardA,
      cardB,

      shadow: isDark ? "0 18px 44px rgba(0,0,0,0.60)" : "0 18px 46px rgba(0,0,0,0.12)",
      shadowSoft: isDark ? "0 10px 24px rgba(0,0,0,0.45)" : "0 12px 26px rgba(0,0,0,0.10)",

      primary: isDark ? "rgba(10,132,255,1)" : "rgba(0,122,255,1)",
      primaryWash: isDark ? "rgba(10,132,255,0.20)" : "rgba(0,122,255,0.16)",
      primaryWash2: isDark ? "rgba(10,132,255,0.10)" : "rgba(0,122,255,0.08)",

      success: "rgba(52,199,89,1)",
      successWash: isDark ? "rgba(52,199,89,0.18)" : "rgba(52,199,89,0.14)",
      warning: "rgba(255,149,0,1)",
      danger: "rgba(255,59,48,1)",
      dangerWash: isDark ? "rgba(255,59,48,0.20)" : "rgba(255,59,48,0.14)",

      radiusLg: 22,
      radiusMd: 16,
      radiusSm: 12,

      maxW: 1400,
      stickyTop: 12, // a little breathing room
    };
  }, [isDark]);

  // ---------- Core inputs ----------
  const [mode, setMode] = useState("prompt"); // prompt | lyrics
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [lyrics, setLyrics] = useState("");

  // Style helpers
  const [genreText, setGenreText] = useState("");
  const [instrumentalOnly, setInstrumentalOnly] = useState(false);

  // Persona/Model selection
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState(null);
  const [loadingModels, setLoadingModels] = useState(true);

  // Length
  const [duration, setDuration] = useState(180);
  const [durationInput, setDurationInput] = useState("180");

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [currentJobId, setCurrentJobId] = useState(null);
  const [error, setError] = useState(null);

  // Results
  const [songs, setSongs] = useState([]);
  const [playingId, setPlayingId] = useState(null);
  const [loadingSongs, setLoadingSongs] = useState(true);

  const timerRef = useRef(null);
  const pollRef = useRef(null);
  const audioRef = useRef(null);

  // ---------- UI primitives ----------
  const Glass = ({ children, style }) => (
    <div
      style={{
        borderRadius: t.radiusLg,
        border: `1px solid ${t.hairline}`,
        background: `linear-gradient(180deg, ${t.glassA}, ${t.glassB})`,
        backdropFilter: "blur(22px) saturate(140%)",
        WebkitBackdropFilter: "blur(22px) saturate(140%)",
        boxShadow: t.shadow,
        ...style,
      }}
    >
      {children}
    </div>
  );

  const Panel = ({ children, style }) => (
    <div
      style={{
        borderRadius: t.radiusLg,
        border: `1px solid ${t.hairline}`,
        background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
        backdropFilter: "blur(18px) saturate(140%)",
        WebkitBackdropFilter: "blur(18px) saturate(140%)",
        boxShadow: t.shadowSoft,
        padding: 18,
        ...style,
      }}
    >
      {children}
    </div>
  );

  const Hairline = ({ style }) => <div style={{ height: 1, background: t.hairline, ...style }} />;

  const Pill = ({ children, tone = "neutral", onClick, onDelete, title: tt, style }) => {
    const toneMap = {
      neutral: { bg: t.isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)", fg: t.text, bd: t.hairline },
      primary: { bg: t.primaryWash, fg: t.primary, bd: "rgba(10,132,255,0.28)" },
      success: { bg: t.successWash, fg: t.success, bd: "rgba(52,199,89,0.28)" },
      danger: { bg: t.dangerWash, fg: t.danger, bd: "rgba(255,59,48,0.28)" },
      warning: { bg: "rgba(255,149,0,0.14)", fg: t.warning, bd: "rgba(255,149,0,0.28)" },
    }[tone];

    const clickable = !!onClick;
    return (
      <span
        title={tt}
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={onClick}
        onKeyDown={(e) => clickable && e.key === "Enter" && onClick()}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 10px",
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 850,
          letterSpacing: 0.2,
          background: toneMap.bg,
          color: toneMap.fg,
          border: `1px solid ${toneMap.bd}`,
          whiteSpace: "nowrap",
          userSelect: "none",
          cursor: clickable ? "pointer" : "default",
          ...style,
        }}
      >
        {children}
        {onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            style={{
              width: 18,
              height: 18,
              borderRadius: 999,
              border: `1px solid ${t.hairline}`,
              background: "transparent",
              color: t.subtext,
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
            }}
            title="Remove"
            aria-label="Remove"
          >
            ×
          </button>
        )}
      </span>
    );
  };

  const Btn = ({ children, onClick, variant = "secondary", disabled, style, type = "button", title: tt }) => {
    const v = {
      primary: { bg: `linear-gradient(180deg, rgba(10,132,255,0.95), rgba(10,132,255,0.78))`, fg: "white", bd: "rgba(10,132,255,0.45)" },
      secondary: { bg: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`, fg: t.text, bd: t.hairline },
      outline: { bg: "transparent", fg: t.text, bd: t.hairline },
      danger: { bg: `linear-gradient(180deg, rgba(255,59,48,0.95), rgba(255,59,48,0.78))`, fg: "white", bd: "rgba(255,59,48,0.45)" },
    }[variant];

    return (
      <button
        type={type}
        title={tt}
        onClick={onClick}
        disabled={disabled}
        style={{
          borderRadius: 14,
          border: `1px solid ${v.bd}`,
          background: v.bg,
          color: v.fg,
          padding: "10px 12px",
          fontWeight: 900,
          letterSpacing: -0.1,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.55 : 1,
          boxShadow: disabled ? "none" : t.shadowSoft,
          transition: "transform 120ms ease, opacity 160ms ease",
          ...style,
        }}
        onMouseDown={(e) => {
          if (disabled) return;
          e.currentTarget.style.transform = "scale(0.985)";
        }}
        onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      >
        {children}
      </button>
    );
  };

  const IconBtn = ({ onClick, title: tt, children, disabled, style }) => (
    <button
      type="button"
      onClick={onClick}
      title={tt}
      disabled={disabled}
      style={{
        width: 40,
        height: 40,
        borderRadius: 14,
        border: `1px solid ${t.hairline}`,
        background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
        color: t.text,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        boxShadow: t.shadowSoft,
        ...style,
      }}
    >
      {children}
    </button>
  );

  const Input = ({ value, onChange, placeholder, multiline, rows = 4, mono, disabled, rightNode }) => (
    <div
      style={{
        borderRadius: 16,
        border: `1px solid ${t.hairline}`,
        background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
        boxShadow: t.shadowSoft,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: multiline ? "stretch" : "center" }}>
        {multiline ? (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            rows={rows}
            style={{
              width: "100%",
              resize: "vertical",
              border: "none",
              outline: "none",
              background: "transparent",
              color: t.text,
              padding: 12,
              fontSize: 14,
              fontWeight: 650,
              lineHeight: 1.35,
              fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" : "inherit",
              opacity: disabled ? 0.55 : 1,
            }}
          />
        ) : (
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            style={{
              width: "100%",
              border: "none",
              outline: "none",
              background: "transparent",
              color: t.text,
              padding: "12px 12px",
              fontSize: 14,
              fontWeight: 650,
              opacity: disabled ? 0.55 : 1,
            }}
          />
        )}

        {rightNode && <div style={{ padding: 8, display: "grid", placeItems: "center" }}>{rightNode}</div>}
      </div>
    </div>
  );

  const Segmented = ({ value, onChange, options }) => (
    <div
      style={{
        display: "inline-flex",
        padding: 4,
        borderRadius: 16,
        border: `1px solid ${t.hairline}`,
        background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
        boxShadow: t.shadowSoft,
        gap: 6,
      }}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              border: `1px solid ${active ? "rgba(10,132,255,0.45)" : "transparent"}`,
              background: active ? `linear-gradient(135deg, ${t.primaryWash}, ${t.primaryWash2})` : "transparent",
              color: t.text,
              borderRadius: 12,
              padding: "10px 12px",
              fontWeight: 850,
              letterSpacing: -0.1,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
            }}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );

  const Slider = ({ value, min, max, step, onChange }) => (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ width: "100%", accentColor: t.primary }}
    />
  );

  const ProgressBar = ({ value }) => (
    <div
      style={{
        height: 6,
        borderRadius: 999,
        background: t.isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.08)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${Math.max(0, Math.min(100, value || 0))}%`,
          background: t.primary,
          borderRadius: 999,
          transition: "width 220ms ease",
        }}
      />
    </div>
  );

  const Alert = ({ kind = "error", children, onClose }) => {
    const tone = kind === "error" ? "danger" : kind === "success" ? "success" : "warning";
    return (
      <div
        style={{
          borderRadius: 16,
          border: `1px solid ${t.hairline}`,
          background: tone === "danger" ? t.dangerWash : tone === "success" ? t.successWash : "rgba(255,149,0,0.14)",
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          color: t.text,
          fontWeight: 750,
        }}
      >
        <div style={{ color: tone === "danger" ? t.danger : tone === "success" ? t.success : t.warning }}>{children}</div>
        {onClose && (
          <IconBtn onClick={onClose} title="Dismiss" style={{ width: 34, height: 34, boxShadow: "none" }}>
            <span style={{ fontWeight: 950 }}>×</span>
          </IconBtn>
        )}
      </div>
    );
  };

  const Spinner = ({ size = 16 }) => (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        border: `2px solid ${t.isDark ? "rgba(255,255,255,0.20)" : "rgba(0,0,0,0.18)"}`,
        borderTopColor: t.primary,
        display: "inline-block",
        animation: "spin 0.9s linear infinite",
      }}
    />
  );

  const Wave = ({ active }) => {
    const bars = useMemo(() => Array.from({ length: 44 }, () => Math.random() * 0.65 + 0.25), []);
    return (
      <div
        style={{
          marginTop: 12,
          height: 44,
          borderRadius: 14,
          border: `1px solid ${t.hairline}`,
          background: t.isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)",
          display: "flex",
          alignItems: "center",
          padding: "0 10px",
          gap: 6,
          overflow: "hidden",
        }}
      >
        {bars.map((h, i) => (
          <div
            key={i}
            style={{
              width: 3,
              height: `${Math.round(h * 100)}%`,
              borderRadius: 6,
              background: active ? "rgba(10,132,255,0.90)" : t.isDark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.16)",
              transition: "background .2s ease",
            }}
          />
        ))}
      </div>
    );
  };

  const Modal = ({ open, onClose, title, children, footer }) => {
    if (!open) return null;
    return (
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 2000,
          background: t.isDark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.30)",
          display: "grid",
          placeItems: "center",
          padding: 16,
        }}
      >
        <Glass style={{ width: "100%", maxWidth: 520, padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontWeight: 950, letterSpacing: -0.3, color: t.text }}>{title}</div>
            <IconBtn onClick={onClose} title="Close" style={{ width: 36, height: 36, boxShadow: "none" }}>
              <CloseIcon style={{ fontSize: 18 }} />
            </IconBtn>
          </div>
          <Hairline style={{ margin: "10px 0 12px 0" }} />
          <div style={{ color: t.text }}>{children}</div>
          {footer && (
            <>
              <Hairline style={{ margin: "12px 0 10px 0" }} />
              <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>{footer}</div>
            </>
          )}
        </Glass>
      </div>
    );
  };

  // ---------- Load existing songs + models on mount ----------
  useEffect(() => {
    loadExistingSongs();
    loadAvailableModels();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAvailableModels = async () => {
    try {
      setLoadingModels(true);
      const res = await fetch(`${API_BASE}/api/available-models`);
      if (res.ok) {
        const data = await res.json();
        setAvailableModels(data.models || []);
      }
    } catch (e) {
      console.error("Failed to load models:", e);
    } finally {
      setLoadingModels(false);
    }
  };

  const loadExistingSongs = async () => {
    try {
      setLoadingSongs(true);
      const res = await fetch(`${API_BASE}/api/song-generation/jobs`);
      if (res.ok) {
        const data = await res.json();
        const loadedSongs = (data.jobs || []).map((job) => ({
          id: job.id,
          title: job.title || "Untitled",
          duration: 0,
          genres: [],
          createdAt: job.created_at,
          audioUrl: job.audio_url,
          vocalsUrl: job.vocals_url,
          instrumentalUrl: job.instrumental_url,
          processed: job.processed,
          inferenceCompleted: job.inference_completed,
          modelName: job.model_name,
          status: job.status,
          progress: job.progress,
        }));
        setSongs(loadedSongs);

        const runningJob = loadedSongs.find((s) => s.status && !["completed", "failed"].includes(s.status));
        if (runningJob) {
          setCurrentJobId(runningJob.id);
          setGenerating(true);
          setProgress(runningJob.progress || 0);
          startPolling(runningJob.id);
        }
      }
    } catch (e) {
      console.error("Failed to load songs:", e);
    } finally {
      setLoadingSongs(false);
    }
  };

  const startPolling = useCallback((jobId) => {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/song-generation/status/${jobId}`);
        if (!res.ok) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setGenerating(false);
          setError("Failed to get job status");
          return;
        }

        const data = await res.json();
        setProgress(data.progress || 0);
        setStatusMessage(data.status_message || "");

        if (data.status === "completed") {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setGenerating(false);
          setCurrentJobId(null);
          setProgress(100);

          setSongs((prev) =>
            prev.map((s) =>
              s.id === jobId
                ? {
                    ...s,
                    status: "completed",
                    audioUrl: data.audio_url,
                    vocalsUrl: data.vocals_url,
                    instrumentalUrl: data.instrumental_url,
                    processed: data.processed,
                    inferenceCompleted: data.inference_completed,
                    modelName: data.model_name,
                    progress: 100,
                  }
                : s
            )
          );

          setTimeout(() => setProgress(0), 500);
        } else if (data.status === "failed") {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setGenerating(false);
          setCurrentJobId(null);
          setError(data.error || "Generation failed");
          setProgress(0);
          setSongs((prev) => prev.map((s) => (s.id === jobId ? { ...s, status: "failed" } : s)));
        }
      } catch (e) {
        console.error("Polling error:", e);
      }
    }, 1500);
  }, []);

  // ---------- Genre helpers ----------
  const genreTokens = useMemo(() => genreText.split(",").map((s) => s.trim()).filter(Boolean), [genreText]);
  const usedGenreKeys = useMemo(() => new Set(genreTokens.map(toKey)), [genreTokens]);

  const addGenreToken = (token) => {
    const tt = normalize(token);
    if (!tt) return;
    const current = genreText.split(",").map(normalize).filter(Boolean);
    const exists = current.some((x) => toKey(x) === toKey(tt));
    const next = exists ? current : [...current, tt];
    setGenreText(next.join(", "));
  };

  const removeGenreToken = (token) => {
    const key = toKey(token);
    const next = genreText
      .split(",")
      .map(normalize)
      .filter(Boolean)
      .filter((x) => toKey(x) !== key);

    setGenreText(next.join(", "));
  };

  const buildPrompt = () => {
    const bits = [];
    if (prompt.trim()) bits.push(prompt.trim());
    if (genreTokens.length) bits.push(`Genres: ${genreTokens.join(", ")}`);
    if (instrumentalOnly) bits.push("Instrumental only, no vocals");
    return bits.join("\n");
  };

  const buildInferParams = () => {
    let modelForInference = null;
    if (selectedModel && selectedCheckpoint) {
      modelForInference = {
        name: selectedModel.name,
        selectedCheckpoint,
        indexPath: selectedModel.indexPath,
        checkpoints: selectedModel.checkpoints,
      };
    }

    return {
      title: title.trim(),
      audio_duration: duration,
      prompt: buildPrompt(),
      lyrics: instrumentalOnly ? "" : lyrics,
      model_name: selectedModel?.name || null,
      model: modelForInference,
    };
  };

  const syncDuration = (val) => {
    const v = clamp(Math.round(val), 30, 240);
    setDuration(v);
    setDurationInput(String(v));
  };

  const canGenerate =
    !generating &&
    title.trim().length > 0 &&
    (mode === "prompt" ? prompt.trim().length > 0 : instrumentalOnly ? true : lyrics.trim().length > 0);

  const generate = async () => {
    if (!canGenerate) return;

    const params = buildInferParams();
    setError(null);
    setGenerating(true);
    setProgress(0);
    setStatusMessage("Starting generation...");

    try {
      const res = await fetch(`${API_BASE}/api/song-generation/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to start generation");
      }

      const data = await res.json();
      const jobId = data.job_id;
      setCurrentJobId(jobId);

      const newSong = {
        id: jobId,
        title: title.trim(),
        duration,
        genres: [...genreTokens],
        createdAt: new Date().toISOString(),
        audioUrl: null,
        modelName: selectedModel?.name || null,
        modelEpoch: selectedCheckpoint?.epochs || null,
        status: "generating",
        progress: 0,
        request: params,
      };

      setSongs((prev) => [newSong, ...prev]);
      startPolling(jobId);
      onGenerate?.(newSong);
    } catch (e) {
      console.error("Generation error:", e);
      setError(e.message || "Failed to start generation");
      setGenerating(false);
      setProgress(0);
      setStatusMessage("");
    }
  };

  const deleteSong = async (songId) => {
    try {
      const res = await fetch(`${API_BASE}/api/song-generation/delete/${songId}`, { method: "DELETE" });
      if (res.ok) {
        setSongs((prev) => prev.filter((s) => s.id !== songId));
        if (playingId === songId) {
          setPlayingId(null);
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
          }
        }
      }
    } catch (e) {
      console.error("Delete error:", e);
    }
  };

  const playPause = (song) => {
    if (playingId === song.id) {
      if (audioRef.current) audioRef.current.pause();
      setPlayingId(null);
      return;
    }

    if (audioRef.current) audioRef.current.pause();
    const playUrl = song.vocalsUrl || song.instrumentalUrl || song.audioUrl;
    if (playUrl) {
      audioRef.current = new Audio(`${API_BASE}${playUrl}`);
      audioRef.current.play().catch((e) => console.error("Play error:", e));
      audioRef.current.onended = () => setPlayingId(null);
      setPlayingId(song.id);
    }
  };

  return (
    <div style={{ minHeight: "100vh", padding: "18px 0 32px 0" }}>
      <div style={{ padding: "0 16px", maxWidth: t.maxW, margin: "0 auto" }}>
        {/* Sticky header */}
        <div style={{ position: "sticky", top: t.stickyTop, zIndex: 50 }}>
          <Glass style={{ padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 16,
                  display: "grid",
                  placeItems: "center",
                  border: `1px solid ${t.hairline}`,
                  background: t.isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)",
                  flexShrink: 0,
                }}
              >
                <AutoAwesomeIcon style={{ color: t.text }} />
              </div>

              <div style={{ flex: "1 1 320px", minWidth: 240 }}>
                <div style={{ fontSize: 26, fontWeight: 950, letterSpacing: -0.6, color: t.text, lineHeight: 1.1 }}>
                  Create Song
                </div>
                <div style={{ marginTop: 4, fontSize: 13, fontWeight: 650, color: t.subtext }}>
                  Title + style hints + prompt/lyrics. Max length 4:00.
                </div>
              </div>

            
            </div>
          </Glass>
        </div>

        <div className="cs-grid" style={{ marginTop: 16 }}>
          {/* LEFT */}
          <div>
            <Panel style={{ marginBottom: 14 }}>
              <div style={{ display: "grid", gap: 12 }}>
                <Input value={title} onChange={setTitle} placeholder="Song title (used as output name)" />

                {/* Length */}
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontWeight: 950, letterSpacing: -0.2, color: t.text }}>Length</div>
                    <div style={{ fontSize: 12, fontWeight: 900, color: t.subtext }}>
                      {fmt(duration)} (max 4:00)
                    </div>
                  </div>

                  <div className="cs-len">
                    <div style={{ paddingTop: 6 }}>
                      <Slider value={duration} min={30} max={240} step={5} onChange={syncDuration} />
                    </div>

                    <div style={{ display: "grid", gap: 6 }}>
                      <Input
                        value={durationInput}
                        onChange={(v) => setDurationInput(String(v).replace(/[^\d]/g, ""))}
                        placeholder="Seconds"
                      />
                      <div style={{ fontSize: 12, fontWeight: 650, color: t.subtext }}>Seconds (30–240)</div>
                    </div>
                  </div>
                </div>

                <Segmented
                  value={mode}
                  onChange={(v) => v && setMode(v)}
                  options={[
                    { value: "prompt", label: "Describe", icon: <MusicNoteIcon style={{ fontSize: 18 }} /> },
                    { value: "lyrics", label: "Lyrics", icon: <LyricsIcon style={{ fontSize: 18 }} /> },
                  ]}
                />

                {mode === "prompt" ? (
                  <Input
                    multiline
                    rows={4}
                    value={prompt}
                    onChange={setPrompt}
                    placeholder="Describe the track… e.g., crisp electro-pop, cinematic drums, euphoric hook."
                  />
                ) : (
                  <Input
                    multiline
                    rows={8}
                    mono
                    value={lyrics}
                    onChange={setLyrics}
                    disabled={instrumentalOnly}
                    placeholder={`[Verse]\n...\n\n[Chorus]\n...`}
                  />
                )}

                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <Pill
                    tone={instrumentalOnly ? "primary" : "neutral"}
                    onClick={() => setInstrumentalOnly((v) => !v)}
                    title="Toggle instrumental only"
                  >
                    {instrumentalOnly ? "Instrumental ✓" : "Instrumental"}
                  </Pill>
                  <div style={{ fontSize: 12, fontWeight: 650, color: t.subtext }}>Disables lyrics input.</div>
                </div>
              </div>
            </Panel>

            {/* Genre */}
            <Panel style={{ marginBottom: 14 }}>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontWeight: 950, letterSpacing: -0.2, color: t.text }}>Genre</div>

                {genreTokens.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {genreTokens.map((g) => (
                      <Pill key={g} tone="neutral" onDelete={() => removeGenreToken(g)}>
                        {g}
                      </Pill>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {GENRE_RECS.filter((r) => !usedGenreKeys.has(toKey(r))).map((r) => (
                    <Pill key={r} tone="primary" onClick={() => addGenreToken(r)} title="Add genre">
                      {r}
                    </Pill>
                  ))}
                </div>

                <Input value={genreText} onChange={setGenreText} placeholder="Type genres/styles… e.g., Synthwave, Electro-pop" />
              </div>
            </Panel>

            {/* Persona */}
            {!instrumentalOnly && (
              <Panel style={{ marginBottom: 14 }}>
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <PersonIcon style={{ fontSize: 18, opacity: 0.9, color: t.text }} />
                      <div style={{ fontWeight: 950, letterSpacing: -0.2, color: t.text }}>Persona</div>
                      {loadingModels && <Spinner size={14} />}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 650, color: t.subtext }}>Optional: Apply a voice model to the generated vocals.</div>
                  </div>

                  <div className="cs-selectWrap">
                    <select
                      value={selectedModel?.name || ""}
                      onChange={(e) => {
                        if (e.target.value === "") {
                          setSelectedModel(null);
                          setSelectedCheckpoint(null);
                        } else {
                          const model = availableModels.find((m) => m.name === e.target.value);
                          setSelectedModel(model || null);
                          if (model?.checkpoints?.length) {
                            const best = model.checkpoints.find((c) => c.isBest) || model.checkpoints[0];
                            setSelectedCheckpoint(best);
                          } else {
                            setSelectedCheckpoint(null);
                          }
                        }
                      }}
                      style={{
                        width: "100%",
                        height: 44,
                        borderRadius: 16,
                        border: `1px solid ${t.hairline}`,
                        background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
                        color: t.text,
                        padding: "0 12px",
                        fontWeight: 700,
                        boxShadow: t.shadowSoft,
                        outline: "none",
                        appearance: "none",
                      }}
                    >
                      <option value="">None (Original Voice)</option>
                      {availableModels.map((m) => (
                        <option key={m.name} value={m.name}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <div className="cs-selectChevron">▾</div>
                  </div>

                  {selectedModel && selectedModel.checkpoints?.length > 0 && (
                    <div className="cs-selectWrap">
                      <select
                        value={selectedCheckpoint?.filename || ""}
                        onChange={(e) => {
                          const cp = selectedModel.checkpoints.find((c) => c.filename === e.target.value);
                          setSelectedCheckpoint(cp || null);
                        }}
                        style={{
                          width: "100%",
                          height: 44,
                          borderRadius: 16,
                          border: `1px solid ${t.hairline}`,
                          background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
                          color: t.text,
                          padding: "0 12px",
                          fontWeight: 700,
                          boxShadow: t.shadowSoft,
                          outline: "none",
                          appearance: "none",
                        }}
                      >
                        {selectedModel.checkpoints.map((cp) => (
                          <option key={cp.filename} value={cp.filename}>
                            {cp.epochs}e {cp.isBest ? "(Best)" : ""} - {cp.size_mb}MB
                          </option>
                        ))}
                      </select>
                      <div className="cs-selectChevron">▾</div>
                    </div>
                  )}

                  {selectedModel && selectedCheckpoint && (
                    <Pill
                      tone="primary"
                      onDelete={() => {
                        setSelectedModel(null);
                        setSelectedCheckpoint(null);
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <PersonIcon style={{ fontSize: 16 }} />
                        {selectedModel.name} @ {selectedCheckpoint.epochs}e
                      </span>
                    </Pill>
                  )}
                </div>
              </Panel>
            )}

            <Btn
              variant="secondary"
              onClick={generate}
              disabled={!canGenerate}
              style={{
                width: "100%",
                height: generating ? 74 : 56,
                borderRadius: 18,
                textTransform: "none",
              }}
            >
              {generating ? (
                <div style={{ width: "100%" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 900,
                        color: t.subtext,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {statusMessage || "Generating..."}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 900, color: t.subtext }}>{progress}%</div>
                  </div>
                  <ProgressBar value={progress} />
                </div>
              ) : (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                  <AutoAwesomeIcon style={{ fontSize: 18 }} />
                  Generate Song
                </span>
              )}
            </Btn>
          </div>

          {/* RIGHT */}
          <div>
            <Panel style={{ minHeight: 420 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <MusicNoteIcon style={{ fontSize: 18, opacity: 0.9, color: t.text }} />
                <div style={{ fontWeight: 950, letterSpacing: -0.2, color: t.text }}>Generated</div>
                {loadingSongs && <Spinner size={16} />}
              </div>

              {error && (
                <Alert kind="error" onClose={() => setError(null)}>
                  {error}
                </Alert>
              )}

              {songs.length === 0 && !loadingSongs ? (
                <div style={{ padding: "42px 0", textAlign: "center", color: t.subtext }}>
                  <div
                    style={{
                      width: 74,
                      height: 74,
                      borderRadius: 999,
                      margin: "0 auto 12px auto",
                      display: "grid",
                      placeItems: "center",
                      border: `1px solid ${t.hairline}`,
                      background: t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.03)",
                    }}
                  >
                    <MusicNoteIcon style={{ fontSize: 34, opacity: 0.6, color: t.text }} />
                  </div>
                  <div style={{ fontWeight: 950, color: t.text }}>No songs yet</div>
                  <div style={{ marginTop: 6, fontSize: 13, fontWeight: 650 }}>Add a title, then describe or paste lyrics and generate.</div>
                </div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {songs.map((s) => {
                    const active = playingId === s.id;
                    const isGenerating = s.status && !["completed", "failed"].includes(s.status);
                    const isFailed = s.status === "failed";
                    const isReady = s.status === "completed" && (s.vocalsUrl || s.instrumentalUrl || s.audioUrl);

                    return (
                      <div
                        key={s.id}
                        style={{
                          borderRadius: t.radiusLg,
                          border: `1px solid ${isFailed ? "rgba(255,59,48,0.45)" : t.hairline}`,
                          background: `linear-gradient(180deg, ${t.isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)"}, ${
                            t.isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)"
                          })`,
                          padding: 14,
                          boxShadow: "none",
                          opacity: isFailed ? 0.72 : 1,
                        }}
                      >
                        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                          {isGenerating ? (
                            <div
                              style={{
                                width: 44,
                                height: 44,
                                borderRadius: 14,
                                display: "grid",
                                placeItems: "center",
                                border: `1px solid ${t.hairline}`,
                                background: t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.03)",
                              }}
                            >
                              <Spinner size={18} />
                            </div>
                          ) : (
                            <IconBtn
                              onClick={() => playPause(s)}
                              disabled={!isReady}
                              title={isReady ? (active ? "Pause" : "Play") : "Not ready yet"}
                              style={{
                                width: 44,
                                height: 44,
                                borderRadius: 14,
                                background: t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.03)",
                                boxShadow: "none",
                              }}
                            >
                              {active ? <PauseIcon /> : <PlayArrowIcon />}
                            </IconBtn>
                          )}

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 950, letterSpacing: -0.2, color: t.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {s.title}
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: t.subtext, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {isGenerating ? (
                                `Generating... ${s.progress || 0}%`
                              ) : isFailed ? (
                                <span style={{ color: t.danger }}>Generation failed</span>
                              ) : (
                                <>
                                  {s.modelName ? (
                                    <span style={{ color: t.primary, fontWeight: 900 }}>
                                      {s.modelName}
                                      {s.modelEpoch ? ` @${s.modelEpoch}e` : ""}
                                    </span>
                                  ) : (
                                    <span>Original voice</span>
                                  )}
                                  {(s.duration || s.genres?.length) && " • "}
                                  {s.duration ? fmt(s.duration) : ""}
                                  {s.genres?.length ? ` • ${s.genres.slice(0, 2).join(", ")}` : ""}
                                </>
                              )}
                            </div>
                          </div>

                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            {s.vocalsUrl && (
                              <IconBtn
                                title="Download Vocals"
                                disabled={!isReady}
                                onClick={() => {
                                  const a = document.createElement("a");
                                  a.href = `${API_BASE}${s.vocalsUrl}`;
                                  a.download = `${s.title || "song"}_vocals.wav`;
                                  a.click();
                                }}
                                style={{ width: 36, height: 36, borderRadius: 12, boxShadow: "none" }}
                              >
                                <MicIcon fontSize="small" />
                              </IconBtn>
                            )}

                            {s.instrumentalUrl && (
                              <IconBtn
                                title="Download Instrumental"
                                disabled={!isReady}
                                onClick={() => {
                                  const a = document.createElement("a");
                                  a.href = `${API_BASE}${s.instrumentalUrl}`;
                                  a.download = `${s.title || "song"}_instrumental.wav`;
                                  a.click();
                                }}
                                style={{ width: 36, height: 36, borderRadius: 12, boxShadow: "none" }}
                              >
                                <MusicNoteIcon fontSize="small" />
                              </IconBtn>
                            )}

                            {!s.vocalsUrl && !s.instrumentalUrl && s.audioUrl && (
                              <IconBtn
                                title="Download"
                                disabled={!isReady}
                                onClick={() => {
                                  const a = document.createElement("a");
                                  a.href = `${API_BASE}${s.audioUrl}`;
                                  a.download = `${s.title || "song"}.wav`;
                                  a.click();
                                }}
                                style={{ width: 36, height: 36, borderRadius: 12, boxShadow: "none" }}
                              >
                                <DownloadIcon fontSize="small" />
                              </IconBtn>
                            )}

                            <IconBtn
                              title="Delete"
                              disabled={isGenerating}
                              onClick={() => deleteSong(s.id)}
                              style={{
                                width: 36,
                                height: 36,
                                borderRadius: 12,
                                boxShadow: "none",
                                borderColor: isGenerating ? t.hairline : "rgba(255,59,48,0.35)",
                                color: isGenerating ? t.subtext : t.danger,
                              }}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconBtn>
                          </div>
                        </div>

                        {isGenerating && (
                          <div style={{ marginTop: 12 }}>
                            <ProgressBar value={s.progress || 0} />
                          </div>
                        )}

                        {!isGenerating && <Wave active={active} />}
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          </div>
        </div>

        <style>{`
          @keyframes spin{to{transform:rotate(360deg)}}

          .cs-grid{
            display:grid;
            grid-template-columns: 1fr;
            gap:14px;
            align-items:start;
          }
          @media (min-width: 1100px){
            .cs-grid{
              grid-template-columns: 1.35fr 0.95fr;
              gap:16px;
            }
          }

          .cs-len{
            display:grid;
            grid-template-columns: 1fr;
            gap:12px;
          }
          @media (min-width: 820px){
            .cs-len{
              grid-template-columns: 1.2fr 0.8fr;
              align-items:center;
            }
          }

          .cs-selectWrap{
            position:relative;
          }
          .cs-selectChevron{
            position:absolute;
            right:12px;
            top:50%;
            transform:translateY(-50%);
            pointer-events:none;
            color:${t.subtext};
            font-weight:900;
          }
        `}</style>
      </div>
    </div>
  );
}

export default CreateSongView;
