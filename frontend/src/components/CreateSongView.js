import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import {
  Box,
  Typography,
  TextField,
  Button,
  Paper,
  Grid,
  Chip,
  IconButton,
  Tooltip,
  LinearProgress,
  Card,
  CardContent,
  ToggleButton,
  ToggleButtonGroup,
  Stack,
  Slider,
  CircularProgress,
  Alert,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
} from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import LyricsIcon from "@mui/icons-material/Lyrics";
import RefreshIcon from "@mui/icons-material/Refresh";
import DownloadIcon from "@mui/icons-material/Download";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import DeleteIcon from "@mui/icons-material/Delete";
import MicIcon from "@mui/icons-material/Mic";
import PersonIcon from "@mui/icons-material/Person";

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

const GlassPaper = ({ children, sx }) => {
  const theme = useTheme();
  return (
    <Paper
      elevation={0}
      sx={{
        p: 3,
        borderRadius: 3,
        border: `1px solid ${alpha(
          theme.palette.divider,
          theme.palette.mode === "dark" ? 0.6 : 0.9
        )}`,
        background:
          theme.palette.mode === "dark"
            ? `linear-gradient(180deg, ${alpha("#fff", 0.04)}, ${alpha(
                "#fff",
                0.015
              )})`
            : `linear-gradient(180deg, ${alpha("#fff", 0.9)}, ${alpha(
                "#fff",
                0.72
              )})`,
        backdropFilter: "blur(10px)",
        ...sx,
      }}
    >
      {children}
    </Paper>
  );
};

const Wave = ({ active }) => {
  const theme = useTheme();
  const bars = useMemo(
    () => Array.from({ length: 44 }, () => Math.random() * 0.65 + 0.25),
    []
  );
  return (
    <Box
      sx={{
        mt: 2,
        height: 44,
        borderRadius: 2,
        border: `1px solid ${alpha(theme.palette.divider, 0.7)}`,
        bgcolor: alpha(
          theme.palette.text.primary,
          theme.palette.mode === "dark" ? 0.05 : 0.03
        ),
        display: "flex",
        alignItems: "center",
        px: 1,
        gap: 0.5,
        overflow: "hidden",
      }}
    >
      {bars.map((h, i) => (
        <Box
          key={i}
          sx={{
            width: 3,
            height: `${Math.round(h * 100)}%`,
            borderRadius: 1,
            bgcolor: active
              ? alpha(theme.palette.primary.main, 0.9)
              : alpha(
                  theme.palette.text.primary,
                  theme.palette.mode === "dark" ? 0.25 : 0.18
                ),
            transition: "background .2s ease",
          }}
        />
      ))}
    </Box>
  );
};

const normalize = (s) => s.trim().replace(/\s+/g, " ");
const toKey = (s) => normalize(s).toLowerCase();

// API base URL
const API_BASE = "";

function CreateSongView({ onBack, onGenerate, volume = 1 }) {
  const theme = useTheme();

  // Core inputs
  const [mode, setMode] = useState("prompt"); // prompt | lyrics
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [lyrics, setLyrics] = useState("");

  // Style helpers
  const [genreText, setGenreText] = useState("");
  const [instrumentalOnly, setInstrumentalOnly] = useState(false);

  // Persona/Model selection
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null); // null = no persona
  const [selectedCheckpoint, setSelectedCheckpoint] = useState(null); // selected epoch/checkpoint
  const [loadingModels, setLoadingModels] = useState(true);

  // Length (max 4:00)
  const [duration, setDuration] = useState(180); // seconds
  const [durationInput, setDurationInput] = useState("180"); // text input

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

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // Load existing songs and models on mount
  useEffect(() => {
    loadExistingSongs();
    loadAvailableModels();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
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
        const loadedSongs = (data.jobs || []).map(job => ({
          id: job.id,
          title: job.title || 'Untitled',
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
        
        // Check if any jobs are still running
        const runningJob = loadedSongs.find(s => 
          s.status && !['completed', 'failed'].includes(s.status)
        );
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
        setStatusMessage(data.status_message || '');
        
        if (data.status === 'completed') {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setGenerating(false);
          setCurrentJobId(null);
          setProgress(100);
          
          // Update the song in the list with all URLs
          setSongs(prev => prev.map(s => 
            s.id === jobId 
              ? { 
                  ...s, 
                  status: 'completed', 
                  audioUrl: data.audio_url,
                  vocalsUrl: data.vocals_url,
                  instrumentalUrl: data.instrumental_url,
                  processed: data.processed,
                  inferenceCompleted: data.inference_completed,
                  modelName: data.model_name,
                  progress: 100 
                }
              : s
          ));
          
          // Clear progress after a moment
          setTimeout(() => setProgress(0), 500);
        } else if (data.status === 'failed') {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setGenerating(false);
          setCurrentJobId(null);
          setError(data.error || 'Generation failed');
          setProgress(0);
          
          // Update song status
          setSongs(prev => prev.map(s => 
            s.id === jobId ? { ...s, status: 'failed' } : s
          ));
        }
      } catch (e) {
        console.error("Polling error:", e);
      }
    }, 1500);
  }, []);

  const genreTokens = useMemo(
    () => genreText.split(",").map((s) => s.trim()).filter(Boolean),
    [genreText]
  );

  const usedGenreKeys = useMemo(
    () => new Set(genreTokens.map(toKey)),
    [genreTokens]
  );

  const canGenerate =
    !generating &&
    title.trim().length > 0 &&
    (mode === "prompt"
      ? prompt.trim().length > 0
      : instrumentalOnly
      ? true
      : lyrics.trim().length > 0);

  const addGenreToken = (token) => {
    const t = normalize(token);
    if (!t) return;

    const current = genreText.split(",").map(normalize).filter(Boolean);
    const exists = current.some((x) => toKey(x) === toKey(t));
    const next = exists ? current : [...current, t];
    setGenreText(next.join(", "));
  };

  const removeGenreToken = (token) => {
    const t = toKey(token);
    const next = genreText
      .split(",")
      .map(normalize)
      .filter(Boolean)
      .filter((x) => toKey(x) !== t);

    setGenreText(next.join(", "));
  };

  const buildPrompt = () => {
    const bits = [];
    if (prompt.trim()) bits.push(prompt.trim());
    if (genreTokens.length) bits.push(`Genres: ${genreTokens.join(", ")}`);
    if (instrumentalOnly) bits.push("Instrumental only, no vocals");
    return bits.join("\n");
  };

  // Minimal, user-friendly params
  const buildInferParams = () => {
    // If a model is selected, prepare the full model object for inference
    let modelForInference = null;
    if (selectedModel && selectedCheckpoint) {
      modelForInference = {
        name: selectedModel.name,
        selectedCheckpoint: selectedCheckpoint,
        indexPath: selectedModel.indexPath,
        checkpoints: selectedModel.checkpoints,
      };
    }
    
    return {
      title: title.trim(), // used as output name server-side
      audio_duration: duration,
      prompt: buildPrompt(),
      lyrics: instrumentalOnly ? "" : lyrics,
      // Persona/model for voice conversion (optional)
      model_name: selectedModel?.name || null,
      model: modelForInference, // Full model object for inference
    };
  };

  const syncDuration = (val) => {
    const v = clamp(Math.round(val), 30, 240);
    setDuration(v);
    setDurationInput(String(v));
  };

  const generate = async () => {
    if (!canGenerate) return;

    const params = buildInferParams();
    setError(null);
    setGenerating(true);
    setProgress(0);
    setStatusMessage("Starting generation...");

    try {
      // Start the generation job
      const res = await fetch(`${API_BASE}/api/song-generation/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to start generation');
      }

      const data = await res.json();
      const jobId = data.job_id;
      setCurrentJobId(jobId);

      // Add placeholder song to the list
      const newSong = {
        id: jobId,
        title: title.trim(),
        duration,
        genres: [...genreTokens],
        createdAt: new Date().toISOString(),
        audioUrl: null,
        modelName: selectedModel?.name || null,
        modelEpoch: selectedCheckpoint?.epochs || null,
        status: 'generating',
        progress: 0,
        request: params,
      };

      setSongs((prev) => [newSong, ...prev]);

      // Start polling for status
      startPolling(jobId);

    } catch (e) {
      console.error("Generation error:", e);
      setError(e.message || 'Failed to start generation');
      setGenerating(false);
      setProgress(0);
      setStatusMessage("");
    }
  };

  const deleteSong = async (songId) => {
    try {
      const res = await fetch(`${API_BASE}/api/song-generation/delete/${songId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setSongs(prev => prev.filter(s => s.id !== songId));
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
      // Pause
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setPlayingId(null);
    } else {
      // Play - prefer vocals, fallback to instrumental, then audioUrl
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const playUrl = song.vocalsUrl || song.instrumentalUrl || song.audioUrl;
      if (playUrl) {
        audioRef.current = new Audio(`${API_BASE}${playUrl}`);
        audioRef.current.volume = volume;
        audioRef.current.play().catch(e => console.error("Play error:", e));
        audioRef.current.onended = () => setPlayingId(null);
        setPlayingId(song.id);
      }
    }
  };

  const shellBg =
    theme.palette.mode === "dark"
      ? `radial-gradient(1200px 600px at 20% -10%, ${alpha(
          "#6b7cff",
          0.18
        )}, transparent 60%),
         radial-gradient(900px 500px at 90% 0%, ${alpha(
           "#ffffff",
           0.06
         )}, transparent 55%),
         linear-gradient(180deg, ${alpha("#0b0f19", 0.92)}, ${alpha(
           "#070a12",
           0.98
         )})`
      : `radial-gradient(900px 500px at 20% -10%, ${alpha(
          "#6b7cff",
          0.22
        )}, transparent 60%),
         linear-gradient(180deg, ${alpha("#f6f7fb", 0.9)}, ${alpha(
           "#ffffff",
           0.92
         )})`;

  return (
    <Box sx={{ minHeight: "100%",  py: 4 }}>
      <Box sx={{ px: { xs: 2, md: 3 }, maxWidth: 1400, mx: "auto" }}>
        {/* Header */}
        <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 3 }}>
          <Box
            sx={{
              width: 52,
              height: 52,
              borderRadius: 3,
              display: "grid",
              placeItems: "center",
              border: `1px solid ${alpha(theme.palette.divider, 0.7)}`,
              bgcolor: alpha(
                theme.palette.text.primary,
                theme.palette.mode === "dark" ? 0.06 : 0.04
              ),
            }}
          >
            <AutoAwesomeIcon sx={{ color: "text.primary" }} />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography
              variant="h4"
              sx={{ fontWeight: 800, letterSpacing: -0.5, lineHeight: 1.1 }}
            >
              Create Song
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
              Title + style hints + prompt/lyrics. Max length 4:00.
            </Typography>
          </Box>
          {onBack && (
            <Button
              variant="outlined"
              onClick={onBack}
              sx={{ borderRadius: 2, height: 40 }}
            >
              Back
            </Button>
          )}
        </Stack>

        <Grid container spacing={3}>
          {/* Left */}
          <Grid item xs={12} lg={7}>
            {/* Core */}
            <GlassPaper sx={{ mb: 3 }}>
              <Stack spacing={2}>
                <TextField
                  fullWidth
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Song title (used as output name)"
                  size="small"
                  sx={{
                    "& .MuiOutlinedInput-root": {
                      borderRadius: 2,
                      bgcolor: alpha(
                        theme.palette.text.primary,
                        theme.palette.mode === "dark" ? 0.04 : 0.02
                      ),
                    },
                  }}
                />

                {/* Length controls */}
                <Stack spacing={1}>
                  <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                    <Typography sx={{ fontWeight: 800, letterSpacing: -0.2 }}>
                      Length
                    </Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 800 }}>
                      {fmt(duration)} (max 4:00)
                    </Typography>
                  </Stack>

                  <Grid container spacing={2} alignItems="center">
                    <Grid item xs={12} md={8}>
                      <Slider
                        value={duration}
                        min={30}
                        max={240}
                        step={5}
                        onChange={(e, v) => syncDuration(v)}
                      />
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <TextField
                        value={durationInput}
                        onChange={(e) => setDurationInput(e.target.value.replace(/[^\d]/g, ""))}
                        onBlur={() => {
                          const n = Number(durationInput || duration);
                          syncDuration(Number.isFinite(n) ? n : duration);
                        }}
                        size="small"
                        inputProps={{ inputMode: "numeric" }}
                        placeholder="Seconds"
                        sx={{
                          "& .MuiOutlinedInput-root": {
                            borderRadius: 2,
                            bgcolor: alpha(
                              theme.palette.text.primary,
                              theme.palette.mode === "dark" ? 0.04 : 0.02
                            ),
                          },
                        }}
                        helperText="Seconds (30–240)"
                      />
                    </Grid>
                  </Grid>
                </Stack>

                <ToggleButtonGroup
                  value={mode}
                  exclusive
                  onChange={(e, v) => v && setMode(v)}
                  sx={{
                    "& .MuiToggleButton-root": {
                      px: 2.5,
                      py: 1,
                      borderRadius: "12px !important",
                      border: `1px solid ${alpha(theme.palette.divider, 0.75)} !important`,
                      textTransform: "none",
                      fontWeight: 700,
                      letterSpacing: 0.2,
                    },
                    "& .Mui-selected": {
                      bgcolor: alpha(
                        theme.palette.primary.main,
                        theme.palette.mode === "dark" ? 0.22 : 0.12
                      ),
                      color: "text.primary",
                    },
                  }}
                >
                  <ToggleButton value="prompt">
                    <MusicNoteIcon sx={{ mr: 1, fontSize: 18 }} />
                    Describe
                  </ToggleButton>
                  <ToggleButton value="lyrics">
                    <LyricsIcon sx={{ mr: 1, fontSize: 18 }} />
                    Lyrics
                  </ToggleButton>
                </ToggleButtonGroup>

                {mode === "prompt" ? (
                  <TextField
                    fullWidth
                    multiline
                    rows={4}
                    placeholder="Describe the track… e.g., crisp electro-pop, cinematic drums, euphoric hook."
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    sx={{
                      "& .MuiOutlinedInput-root": {
                        borderRadius: 2,
                        bgcolor: alpha(
                          theme.palette.text.primary,
                          theme.palette.mode === "dark" ? 0.04 : 0.02
                        ),
                      },
                    }}
                  />
                ) : (
                  <TextField
                    fullWidth
                    multiline
                    rows={8}
                    placeholder={`[Verse]\n...\n\n[Chorus]\n...`}
                    value={lyrics}
                    onChange={(e) => setLyrics(e.target.value)}
                    disabled={instrumentalOnly}
                    sx={{
                      "& .MuiOutlinedInput-root": {
                        borderRadius: 2,
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                        bgcolor: alpha(
                          theme.palette.text.primary,
                          theme.palette.mode === "dark" ? 0.04 : 0.02
                        ),
                      },
                    }}
                  />
                )}

                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip
                    label={instrumentalOnly ? "Instrumental ✓" : "Instrumental"}
                    onClick={() => setInstrumentalOnly((v) => !v)}
                    sx={{
                      borderRadius: 999,
                      fontWeight: 900,
                      height: 28,
                      bgcolor: instrumentalOnly
                        ? alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.22 : 0.12)
                        : alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.08 : 0.06),
                      border: `1px solid ${
                        instrumentalOnly
                          ? alpha(theme.palette.primary.main, 0.55)
                          : alpha(theme.palette.divider, 0.65)
                      }`,
                    }}
                  />
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    Disables lyrics input.
                  </Typography>
                </Stack>
              </Stack>
            </GlassPaper>

            {/* Genre */}
            <GlassPaper sx={{ mb: 3 }}>
              <Stack spacing={1.5}>
                <Typography sx={{ fontWeight: 800, letterSpacing: -0.2 }}>
                  Genre
                </Typography>

                {genreTokens.length > 0 && (
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                    {genreTokens.map((g) => (
                      <Chip
                        key={g}
                        label={g}
                        onDelete={() => removeGenreToken(g)}
                        sx={{
                          borderRadius: 2,
                          fontWeight: 800,
                          bgcolor: (t) =>
                            alpha(
                              t.palette.text.primary,
                              t.palette.mode === "dark" ? 0.08 : 0.05
                            ),
                          border: (t) =>
                            `1px solid ${alpha(t.palette.divider, 0.75)}`,
                        }}
                      />
                    ))}
                  </Box>
                )}

                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                  {GENRE_RECS.filter((r) => !usedGenreKeys.has(toKey(r))).map((r) => (
                    <Chip
                      key={r}
                      label={r}
                      onClick={() => addGenreToken(r)}
                      sx={{
                        borderRadius: 999,
                        fontWeight: 800,
                        letterSpacing: 0.2,
                        height: 28,
                        bgcolor: (t) =>
                          alpha(
                            t.palette.primary.main,
                            t.palette.mode === "dark" ? 0.14 : 0.09
                          ),
                        color: (t) => t.palette.text.primary,
                        border: (t) =>
                          `1px solid ${alpha(t.palette.primary.main, 0.35)}`,
                        "&:hover": {
                          bgcolor: (t) =>
                            alpha(
                              t.palette.primary.main,
                              t.palette.mode === "dark" ? 0.18 : 0.12
                            ),
                        },
                      }}
                    />
                  ))}
                </Box>

                <TextField
                  fullWidth
                  value={genreText}
                  onChange={(e) => setGenreText(e.target.value)}
                  placeholder="Type genres/styles… e.g., Synthwave, Electro-pop"
                  size="small"
                  sx={{
                    "& .MuiOutlinedInput-root": {
                      borderRadius: 2,
                      bgcolor: (t) =>
                        alpha(
                          t.palette.text.primary,
                          t.palette.mode === "dark" ? 0.04 : 0.02
                        ),
                    },
                  }}
                />
              </Stack>
            </GlassPaper>

            {/* Persona / Voice Model */}
            {!instrumentalOnly && (
              <GlassPaper sx={{ mb: 3 }}>
                <Stack spacing={1.5}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <PersonIcon sx={{ fontSize: 18, opacity: 0.9 }} />
                    <Typography sx={{ fontWeight: 800, letterSpacing: -0.2 }}>
                      Persona
                    </Typography>
                    {loadingModels && <CircularProgress size={14} sx={{ ml: 1 }} />}
                  </Stack>
                  
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    Optional: Apply a voice model to the generated vocals.
                  </Typography>

                  <FormControl fullWidth size="small">
                    <InputLabel>Select Voice Model</InputLabel>
                    <Select
                      value={selectedModel?.name || ""}
                      onChange={(e) => {
                        if (e.target.value === "") {
                          setSelectedModel(null);
                          setSelectedCheckpoint(null);
                        } else {
                          const model = availableModels.find(m => m.name === e.target.value);
                          setSelectedModel(model || null);
                          // Auto-select best or first checkpoint
                          if (model?.checkpoints?.length) {
                            const best = model.checkpoints.find(c => c.isBest) || model.checkpoints[0];
                            setSelectedCheckpoint(best);
                          } else {
                            setSelectedCheckpoint(null);
                          }
                        }
                      }}
                      label="Select Voice Model"
                      sx={{
                        borderRadius: 2,
                        bgcolor: alpha(
                          theme.palette.text.primary,
                          theme.palette.mode === "dark" ? 0.04 : 0.02
                        ),
                      }}
                    >
                      <MenuItem value="">
                        <em>None (Original Voice)</em>
                      </MenuItem>
                      {availableModels.map((model) => (
                        <MenuItem key={model.name} value={model.name}>
                          {model.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  {/* Checkpoint/Epoch selector */}
                  {selectedModel && selectedModel.checkpoints?.length > 0 && (
                    <FormControl fullWidth size="small">
                      <InputLabel>Select Epoch</InputLabel>
                      <Select
                        value={selectedCheckpoint?.filename || ""}
                        onChange={(e) => {
                          const cp = selectedModel.checkpoints.find(c => c.filename === e.target.value);
                          setSelectedCheckpoint(cp || null);
                        }}
                        label="Select Epoch"
                        sx={{
                          borderRadius: 2,
                          bgcolor: alpha(
                            theme.palette.text.primary,
                            theme.palette.mode === "dark" ? 0.04 : 0.02
                          ),
                        }}
                      >
                        {selectedModel.checkpoints.map((cp) => (
                          <MenuItem key={cp.filename} value={cp.filename}>
                            {cp.epochs}e {cp.isBest && "(Best)"} - {cp.size_mb}MB
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}

                  {selectedModel && selectedCheckpoint && (
                    <Chip
                      icon={<PersonIcon />}
                      label={`${selectedModel.name} @ ${selectedCheckpoint.epochs}e`}
                      onDelete={() => {
                        setSelectedModel(null);
                        setSelectedCheckpoint(null);
                      }}
                      sx={{
                        borderRadius: 2,
                        fontWeight: 700,
                        bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.18 : 0.1),
                        border: `1px solid ${alpha(theme.palette.primary.main, 0.4)}`,
                      }}
                    />
                  )}
                </Stack>
              </GlassPaper>
            )}

            {/* Generate */}
            <Button
              fullWidth
              size="large"
              onClick={generate}
              disabled={!canGenerate}
              startIcon={!generating ? <AutoAwesomeIcon /> : null}
              sx={{
                py: 1.8,
                borderRadius: 3,
                fontWeight: 900,
                letterSpacing: 0.3,
                textTransform: "none",
                border: `1px solid ${alpha(theme.palette.divider, 0.8)}`,
                bgcolor: alpha(
                  theme.palette.text.primary,
                  theme.palette.mode === "dark" ? 0.08 : 0.04
                ),
                "&:hover": {
                  bgcolor: alpha(
                    theme.palette.text.primary,
                    theme.palette.mode === "dark" ? 0.12 : 0.06
                  ),
                },
              }}
            >
              {generating ? (
                <Box sx={{ width: "100%" }}>
                  <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}>
                    <Typography
                      variant="caption"
                      sx={{ fontWeight: 800, color: "text.secondary" }}
                      noWrap
                    >
                      {statusMessage || "Generating..."}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{ fontWeight: 800, color: "text.secondary", ml: 1 }}
                    >
                      {progress}%
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={progress}
                    sx={{
                      height: 6,
                      borderRadius: 999,
                      bgcolor: alpha(
                        theme.palette.text.primary,
                        theme.palette.mode === "dark" ? 0.14 : 0.08
                      ),
                      "& .MuiLinearProgress-bar": { borderRadius: 999 },
                    }}
                  />
                </Box>
              ) : (
                "Generate Song"
              )}
            </Button>
          </Grid>

          {/* Right */}
          <Grid item xs={12} lg={5}>
            <GlassPaper sx={{ minHeight: 420 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                <MusicNoteIcon sx={{ fontSize: 18, opacity: 0.9 }} />
                <Typography sx={{ fontWeight: 900, letterSpacing: -0.2 }}>
                  Generated
                </Typography>
                {loadingSongs && <CircularProgress size={16} sx={{ ml: 1 }} />}
              </Stack>

              {error && (
                <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setError(null)}>
                  {error}
                </Alert>
              )}

              {songs.length === 0 && !loadingSongs ? (
                <Box sx={{ py: 8, textAlign: "center", color: "text.secondary" }}>
                  <Box
                    sx={{
                      width: 74,
                      height: 74,
                      borderRadius: 999,
                      mx: "auto",
                      mb: 2,
                      display: "grid",
                      placeItems: "center",
                      border: `1px solid ${alpha(theme.palette.divider, 0.7)}`,
                      bgcolor: alpha(
                        theme.palette.text.primary,
                        theme.palette.mode === "dark" ? 0.06 : 0.03
                      ),
                    }}
                  >
                    <MusicNoteIcon sx={{ fontSize: 34, opacity: 0.6 }} />
                  </Box>
                  <Typography sx={{ fontWeight: 800 }}>No songs yet</Typography>
                  <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.85 }}>
                    Add a title, then describe or paste lyrics and generate.
                  </Typography>
                </Box>
              ) : (
                <Stack spacing={2}>
                  {songs.map((s) => {
                    const active = playingId === s.id;
                    const isGenerating = s.status && !['completed', 'failed'].includes(s.status);
                    const isFailed = s.status === 'failed';
                    const isReady = s.status === 'completed' && (s.vocalsUrl || s.instrumentalUrl || s.audioUrl);
                    
                    return (
                      <Card
                        key={s.id}
                        sx={{
                          borderRadius: 3,
                          border: `1px solid ${alpha(
                            isFailed ? theme.palette.error.main : theme.palette.divider, 
                            isFailed ? 0.5 : 0.7
                          )}`,
                          bgcolor: alpha(
                            theme.palette.text.primary,
                            theme.palette.mode === "dark" ? 0.045 : 0.03
                          ),
                          boxShadow: "none",
                          transition: "transform .18s ease, background .18s ease",
                          opacity: isFailed ? 0.7 : 1,
                          "&:hover": {
                            transform: isGenerating ? "none" : "translateY(-2px)",
                            bgcolor: alpha(
                              theme.palette.text.primary,
                              theme.palette.mode === "dark" ? 0.06 : 0.04
                            ),
                          },
                        }}
                      >
                        <CardContent sx={{ pb: 2 }}>
                          <Stack direction="row" spacing={1.5} alignItems="center">
                            {isGenerating ? (
                              <Box
                                sx={{
                                  width: 44,
                                  height: 44,
                                  borderRadius: 2.5,
                                  display: "grid",
                                  placeItems: "center",
                                  border: `1px solid ${alpha(theme.palette.divider, 0.8)}`,
                                  bgcolor: alpha(
                                    theme.palette.text.primary,
                                    theme.palette.mode === "dark" ? 0.08 : 0.04
                                  ),
                                }}
                              >
                                <CircularProgress size={20} />
                              </Box>
                            ) : (
                              <IconButton
                                onClick={() => playPause(s)}
                                disabled={!isReady}
                                sx={{
                                  width: 44,
                                  height: 44,
                                  borderRadius: 2.5,
                                  border: `1px solid ${alpha(theme.palette.divider, 0.8)}`,
                                  bgcolor: alpha(
                                    theme.palette.text.primary,
                                    theme.palette.mode === "dark" ? 0.08 : 0.04
                                  ),
                                }}
                              >
                                {active ? <PauseIcon /> : <PlayArrowIcon />}
                              </IconButton>
                            )}

                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Typography sx={{ fontWeight: 900, letterSpacing: -0.2 }} noWrap>
                                {s.title}
                              </Typography>
                              <Typography variant="caption" sx={{ color: "text.secondary" }} noWrap>
                                {isGenerating ? (
                                  `Generating... ${s.progress || 0}%`
                                ) : isFailed ? (
                                  <span style={{ color: theme.palette.error.main }}>Generation failed</span>
                                ) : (
                                  <>
                                    {s.modelName && (
                                      <span style={{ color: theme.palette.primary.main, fontWeight: 700 }}>
                                        {s.modelName}{s.modelEpoch ? ` @${s.modelEpoch}e` : ''}
                                      </span>
                                    )}
                                    {s.modelName && (s.duration || s.genres?.length) ? ' • ' : ''}
                                    {s.duration ? fmt(s.duration) : ''}
                                    {s.genres?.length ? ` • ${s.genres.slice(0, 2).join(", ")}` : ""}
                                    {!s.modelName && !s.duration && !s.genres?.length && 'Original voice'}
                                  </>
                                )}
                              </Typography>
                            </Box>

                            <Stack direction="row" spacing={0.5}>
                              {s.vocalsUrl && (
                                <Tooltip title="Download Vocals">
                                  <span>
                                    <IconButton
                                      size="small"
                                      sx={{ borderRadius: 2 }}
                                      disabled={!isReady}
                                      onClick={() => {
                                        const a = document.createElement("a");
                                        a.href = `${API_BASE}${s.vocalsUrl}`;
                                        a.download = `${s.title || "song"}_vocals.wav`;
                                        a.click();
                                      }}
                                    >
                                      <MicIcon fontSize="small" />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                              )}
                              {s.instrumentalUrl && (
                                <Tooltip title="Download Instrumental">
                                  <span>
                                    <IconButton
                                      size="small"
                                      sx={{ borderRadius: 2 }}
                                      disabled={!isReady}
                                      onClick={() => {
                                        const a = document.createElement("a");
                                        a.href = `${API_BASE}${s.instrumentalUrl}`;
                                        a.download = `${s.title || "song"}_instrumental.wav`;
                                        a.click();
                                      }}
                                    >
                                      <MusicNoteIcon fontSize="small" />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                              )}
                              {!s.vocalsUrl && !s.instrumentalUrl && s.audioUrl && (
                                <Tooltip title="Download">
                                  <span>
                                    <IconButton
                                      size="small"
                                      sx={{ borderRadius: 2 }}
                                      disabled={!isReady}
                                      onClick={() => {
                                        const a = document.createElement("a");
                                        a.href = `${API_BASE}${s.audioUrl}`;
                                        a.download = `${s.title || "song"}.wav`;
                                        a.click();
                                      }}
                                    >
                                      <DownloadIcon fontSize="small" />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                              )}
                              <Tooltip title="Delete">
                                <IconButton 
                                  size="small" 
                                  sx={{ borderRadius: 2 }} 
                                  onClick={() => deleteSong(s.id)}
                                  disabled={isGenerating}
                                >
                                  <DeleteIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </Stack>
                          </Stack>

                          {isGenerating && (
                            <LinearProgress
                              variant="determinate"
                              value={s.progress || 0}
                              sx={{
                                mt: 2,
                                height: 4,
                                borderRadius: 999,
                                bgcolor: alpha(
                                  theme.palette.text.primary,
                                  theme.palette.mode === "dark" ? 0.1 : 0.06
                                ),
                              }}
                            />
                          )}

                          {!isGenerating && <Wave active={active} />}
                        </CardContent>
                      </Card>
                    );
                  })}
                </Stack>
              )}
            </GlassPaper>
          </Grid>
        </Grid>
      </Box>
    </Box>
  );
}

export default CreateSongView;
