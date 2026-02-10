import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";
import {
  API_BASE,
  clamp,
  normalize,
  toKey,
  getBestAssetKey,
  resolveAssetUrl,
} from "./constants";
import { getTheme } from "./theme";
import { useThemedUI } from "./useThemedUI";
import { GeneratedPanel } from "./GeneratedPanel";
import { CreateSongHeader } from "./CreateSongHeader";
import { MissingDepsModal } from "./MissingDepsModal";
import { CreateSongFormPanel } from "./CreateSongFormPanel";
import { SourceSongPanel } from "./SourceSongPanel";
import { CoverFormPanel } from "./CoverFormPanel";
import {
  getCoverGenerationStatus,
  getCoverSourceSong,
  startCoverGeneration,
  transcribeCoverSource,
} from "../../utils/apiService";

function CreateSongView({
  onBack,
  onGenerate,
  darkMode,
  initialMode = "create",
  sourceSongId = null,
  initialSourceSong = null,
}) {
  const isDark = useMemo(() => {
    if (typeof darkMode === "boolean") return darkMode;
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false;
  }, [darkMode]);

  const t = useMemo(() => getTheme(isDark), [isDark]);
  const ui = useThemedUI(t);

  const [flowMode, setFlowMode] = useState(initialMode === "cover" ? "cover" : "create");
  const [mode, setMode] = useState("prompt");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [genreText, setGenreText] = useState("");
  const [instrumentalOnly, setInstrumentalOnly] = useState(false);
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState(null);
  const [loadingModels, setLoadingModels] = useState(true);
  const [duration, setDuration] = useState(180);
  const [durationInput, setDurationInput] = useState("180");
  const [autoDuration, setAutoDuration] = useState(false);
  const [enhanceVocals, setEnhanceVocals] = useState(true);
  const [mainModelPath, setMainModelPath] = useState("acestep-v15-turbo");
  const [lmModelPath, setLmModelPath] = useState("acestep-5Hz-lm-0.6B");
  const [lmBackend, setLmBackend] = useState("vllm");
  const [device, setDevice] = useState("auto");
  const [promptEngine, setPromptEngine] = useState("llm");
  const [useLmCodes, setUseLmCodes] = useState(true);
  const [lmCodesTouched, setLmCodesTouched] = useState(false);
  const [useFlashAttention, setUseFlashAttention] = useState(true);
  const [offloadToCpu, setOffloadToCpu] = useState(true);
  const [offloadDitToCpu, setOffloadDitToCpu] = useState(true);
  const [compileModel, setCompileModel] = useState(true);
  const [int8Quantization, setInt8Quantization] = useState(true);
  const [showAceStepAdvanced, setShowAceStepAdvanced] = useState(false);
  const [bpm, setBpm] = useState("");
  const [keyscale, setKeyscale] = useState("");
  const [timeSignature, setTimeSignature] = useState("");
  const [ditInferenceSteps, setDitInferenceSteps] = useState("");
  const [shift, setShift] = useState("");
  const [captionOverride, setCaptionOverride] = useState("");
  const [mergeMetaIntoCaption, setMergeMetaIntoCaption] = useState(false);
  const [constraintRapOnly, setConstraintRapOnly] = useState(false);
  const [constraintNoSinging, setConstraintNoSinging] = useState(false);
  const [constraintNoHook, setConstraintNoHook] = useState(false);
  const [negativePrompt, setNegativePrompt] = useState("");
  const [useNegativePrompt, setUseNegativePrompt] = useState(false);

  const [coverSelectedModel, setCoverSelectedModel] = useState(null);
  const [coverSelectedCheckpoint, setCoverSelectedCheckpoint] = useState(null);
  const [coverPitchShift, setCoverPitchShift] = useState("0");
  const [coverStylePrompt, setCoverStylePrompt] = useState("");
  const [coverPreserveTempo, setCoverPreserveTempo] = useState(true);
  const [coverOutputFormat, setCoverOutputFormat] = useState("wav");
  const [coverStrength, setCoverStrength] = useState(1.0);
  const [coverStrengthInput, setCoverStrengthInput] = useState("1");
  const [coverStrongAudio, setCoverStrongAudio] = useState(false);
  const [coverLyrics, setCoverLyrics] = useState("");
  const [coverTranscribing, setCoverTranscribing] = useState(false);
  const [coverTranscribeError, setCoverTranscribeError] = useState(null);
  const [coverTranscribeEngine, setCoverTranscribeEngine] = useState("whisperx");
  const [coverMode, setCoverMode] = useState("full");
  const [sourceSong, setSourceSong] = useState(initialSourceSong || null);
  const [loadingSourceSong, setLoadingSourceSong] = useState(false);
  const [sourceSongError, setSourceSongError] = useState(null);

  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [currentJobId, setCurrentJobId] = useState(null);
  const [error, setError] = useState(null);
  const [missingDeps, setMissingDeps] = useState(null);
  const [songs, setSongs] = useState([]);
  const [playingId, setPlayingId] = useState(null);
  const [loadingSongs, setLoadingSongs] = useState(true);

  const timerRef = useRef(null);
  const pollRef = useRef(null);
  const pollAbortRef = useRef(null);
  const pollInFlightRef = useRef(false);
  const progressRef = useRef({});
  const audioRef = useRef(null);
  const sentinelRef = useRef(null);
  const [isStuck, setIsStuck] = useState(false);

  const hashSourceSongId = useMemo(() => {
    if (typeof window === "undefined") return null;
    const hash = window.location.hash || "";
    const query = hash.includes("?") ? hash.split("?")[1] : "";
    if (!query) return null;
    const sp = new URLSearchParams(query);
    return sp.get("sourceSongId");
  }, []);

  const effectiveSourceSongId =
    sourceSongId || initialSourceSong?.sourceSongId || hashSourceSongId;
  const isCaptionEngine = ["caption", "assist", "expand"].includes(promptEngine);
  const initializeLm = useLmCodes || promptEngine === "assist" || promptEngine === "expand";

  useEffect(() => {
    setFlowMode(initialMode === "cover" ? "cover" : "create");
  }, [initialMode]);

  useEffect(() => {
    if (initialSourceSong) setSourceSong(initialSourceSong);
  }, [initialSourceSong]);

  useEffect(() => {
    loadExistingSongs();
    loadAvailableModels();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (pollAbortRef.current) pollAbortRef.current.abort();
    };
  }, []);

  useEffect(() => {
    if (lmCodesTouched) return;
    setUseLmCodes(promptEngine === "llm");
  }, [promptEngine, lmCodesTouched]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => setIsStuck(!entry.isIntersecting), {
      threshold: 1,
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (flowMode !== "cover") {
      setSourceSongError(null);
      return;
    }
    if (!effectiveSourceSongId && !sourceSong?.sourceSongId) {
      setSourceSongError("Missing source song. Select a song and click Cover.");
      return;
    }

    let cancelled = false;
    const loadSource = async () => {
      try {
        setLoadingSourceSong(true);
        setSourceSongError(null);
        const sourceId = effectiveSourceSongId || sourceSong?.sourceSongId;
        if (!sourceId) return;
        const data = await getCoverSourceSong(sourceId);
        if (cancelled) return;
        setSourceSong(data?.source_song || null);
      } catch (e) {
        if (cancelled) return;
        setSourceSongError(e?.message || "Failed to load source song.");
      } finally {
        if (!cancelled) setLoadingSourceSong(false);
      }
    };

    loadSource();
    return () => {
      cancelled = true;
    };
  }, [effectiveSourceSongId, flowMode, sourceSong?.sourceSongId]);

  useEffect(() => {
    if (flowMode !== "cover") return;
    if (!sourceSong?.title) return;
    if (title.trim()) return;
    setTitle(`${sourceSong.title} (Cover)`);
  }, [flowMode, sourceSong?.title, title]);

  const extractMissingDeps = useCallback((msg) => {
    if (!msg) return null;
    const missingMatch = msg.match(/Missing packages:\s*([^\n.]+)/i);
    const pipMatch = msg.match(/pip install [^\n]+/i);
    if (!missingMatch && !pipMatch) return null;
    const packages = missingMatch
      ? missingMatch[1].split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    return { packages, pip: pipMatch ? pipMatch[0] : "" };
  }, []);

  const applyError = useCallback(
    (msg) => {
      if (!msg) return;
      setError(msg);
      const parsed = extractMissingDeps(msg);
      if (parsed) setMissingDeps(parsed);
    },
    [extractMissingDeps]
  );

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

  const mapJobToSong = (job) => {
    const hasAssets = job && typeof job.assets === "object" && job.assets !== null;
    return {
      id: job.id,
      title: job.title || "Untitled",
      duration: 0,
      genres: [],
      createdAt: job.created_at || job.createdAt,
      audioUrl: job.audio_url,
      vocalsUrl: job.vocals_url,
      instrumentalUrl: job.instrumental_url,
      processed: job.processed,
      inferenceCompleted: job.inference_completed,
      modelName: job.model_name,
      status: job.status,
      progress: job.progress,
      assets: hasAssets ? job.assets : undefined,
      hasAssets,
      selectedAssetKey: hasAssets ? getBestAssetKey(job.assets) : null,
      request: job.params || null,
      derivationType: job.derivation_type || job.derivationType || null,
      sourceSongId: job.source_song_id || job.sourceSongId || null,
      sourceTitle: job.source_title || job.sourceTitle || null,
      autoFull: true,
    };
  };

  const loadExistingSongs = async () => {
    try {
      setLoadingSongs(true);
      const res = await fetch(`${API_BASE}/api/song-generation/jobs`);
      if (res.ok) {
        const data = await res.json();
        const loadedSongs = (data.jobs || []).map(mapJobToSong);
        setSongs(loadedSongs);
        const runningJob = loadedSongs.find(
          (s) => s.status && !["completed", "failed"].includes(s.status)
        );
        if (runningJob) {
          setCurrentJobId(runningJob.id);
          setGenerating(true);
          setProgress(runningJob.progress || 0);
          const pollType = runningJob.derivationType === "cover" ? "cover" : "create";
          startPolling(runningJob.id, pollType);
        }
      }
    } catch (e) {
      console.error("Failed to load songs:", e);
    } finally {
      setLoadingSongs(false);
    }
  };

  const applyProgress = useCallback(
    (jobId, next) => {
      const prev = progressRef.current[jobId] ?? 0;
      const safe = Math.max(prev, next || 0);
      progressRef.current[jobId] = safe;
      if (currentJobId === jobId) setProgress(safe);
      return safe;
    },
    [currentJobId]
  );

  const handleJobUpdate = useCallback(
    (jobId, data) => {
      const nextProgress = applyProgress(jobId, data.progress ?? 0);
      if (currentJobId === jobId) {
        setStatusMessage(data.status_message || data.stage || data.status || "");
      }
      setSongs((prev) =>
        prev.map((s) => {
          if (s.id !== jobId) return s;
          const hasAssets = s.hasAssets || (data && typeof data.assets === "object" && data.assets !== null);
          const mergedAssets = hasAssets ? { ...(s.assets || {}), ...(data.assets || {}) } : s.assets;
          return {
            ...s,
            status: data.status || s.status,
            progress: nextProgress,
            audioUrl: data.audio_url ?? s.audioUrl,
            vocalsUrl: data.vocals_url ?? s.vocalsUrl,
            instrumentalUrl: data.instrumental_url ?? s.instrumentalUrl,
            processed: data.processed ?? s.processed,
            inferenceCompleted: data.inference_completed ?? s.inferenceCompleted,
            modelName: data.model_name ?? s.modelName,
            derivationType: data.derivation_type ?? s.derivationType,
            sourceSongId: data.source_song_id ?? s.sourceSongId,
            sourceTitle: data.source_title ?? s.sourceTitle,
            assets: mergedAssets,
            hasAssets,
            selectedAssetKey: s.selectedAssetKey || (mergedAssets ? getBestAssetKey(mergedAssets) : null),
          };
        })
      );
    },
    [applyProgress, currentJobId]
  );

  const startPolling = useCallback(
    (jobId, pollType = "create") => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        if (pollInFlightRef.current) return;
        try {
          pollInFlightRef.current = true;
          if (pollAbortRef.current) pollAbortRef.current.abort();
          const controller = new AbortController();
          pollAbortRef.current = controller;

          let data = null;
          if (pollType === "cover") {
            try {
              data = await getCoverGenerationStatus(jobId, controller.signal);
            } catch (_) {
              const fallback = await fetch(`${API_BASE}/api/song-generation/${jobId}`, {
                signal: controller.signal,
              });
              if (!fallback.ok) throw new Error("Failed to get cover status");
              data = await fallback.json();
            }
          } else {
            let res = await fetch(`${API_BASE}/api/song-generation/${jobId}`, {
              signal: controller.signal,
            });
            if (!res.ok) {
              res = await fetch(`${API_BASE}/api/song-generation/status/${jobId}`, {
                signal: controller.signal,
              });
            }
            if (!res.ok) throw new Error("Failed to get job status");
            data = await res.json();
          }

          handleJobUpdate(jobId, data);
          if (data.status === "completed") {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setGenerating(false);
            setCurrentJobId(null);
            applyProgress(jobId, 100);
            setTimeout(() => setProgress(0), 500);
          } else if (data.status === "failed") {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setGenerating(false);
            setCurrentJobId(null);
            applyError(data.error || "Generation failed");
            setProgress(0);
            setSongs((prev) => prev.map((s) => (s.id === jobId ? { ...s, status: "failed" } : s)));
          }
        } catch (e) {
          console.error("Polling error:", e);
        } finally {
          pollInFlightRef.current = false;
        }
      }, 1000);
    },
    [applyError, applyProgress, handleJobUpdate]
  );

  const genreTokens = useMemo(
    () => genreText.split(",").map((s) => s.trim()).filter(Boolean),
    [genreText]
  );
  const usedGenreKeys = useMemo(() => new Set(genreTokens.map(toKey)), [genreTokens]);

  const addGenreToken = (token) => {
    const tt = normalize(token);
    if (!tt) return;
    const current = genreText.split(",").map(normalize).filter(Boolean);
    const exists = current.some((x) => toKey(x) === toKey(tt));
    setGenreText((exists ? current : [...current, tt]).join(", "));
  };

  const removeGenreToken = (token) => {
    const key = toKey(token);
    setGenreText(
      genreText
        .split(",")
        .map(normalize)
        .filter(Boolean)
        .filter((x) => toKey(x) !== key)
        .join(", ")
    );
  };

  const buildPrompt = () => {
    const bits = [];
    if (prompt.trim()) bits.push(prompt.trim());
    if (genreTokens.length) bits.push(`Genres: ${genreTokens.join(", ")}`);
    if (instrumentalOnly) bits.push("Instrumental only, no vocals");
    return bits.join("\n");
  };

  const buildCaptionInput = () => {
    const base = isCaptionEngine ? captionOverride.trim() : buildPrompt();
    if (!mergeMetaIntoCaption && !constraintRapOnly && !constraintNoSinging && !constraintNoHook) {
      return base;
    }
    const extras = [];
    if (mergeMetaIntoCaption) {
      if (genreTokens.length) extras.push(`Genres: ${genreTokens.join(", ")}`);
      if (String(bpm).trim()) extras.push(`BPM: ${bpm}`);
      if (keyscale.trim()) extras.push(`Key: ${keyscale.trim()}`);
      if (timeSignature.trim()) extras.push(`Time signature: ${timeSignature.trim()}`);
    }
    const constraints = [];
    if (constraintRapOnly) constraints.push("Rap vocals only");
    if (constraintNoSinging) constraints.push("No singing or melodic chorus");
    if (constraintNoHook) constraints.push("No hooks or sung chorus");
    if (constraints.length) extras.push(`Constraints: ${constraints.join("; ")}`);
    if (!extras.length) return base;
    if (!base) return extras.join("\n");
    return `${base}\n${extras.join("\n")}`;
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
    const captionInput = buildCaptionInput();
    const durationValue = autoDuration ? null : duration;
    const out = {
      title: title.trim(),
      audio_duration: durationValue,
      duration: durationValue,
      auto_duration: autoDuration,
      enhance_vocals: enhanceVocals,
      prompt: buildPrompt(),
      lyrics: instrumentalOnly ? "" : lyrics,
      caption_override: isCaptionEngine ? (captionInput || null) : null,
      prompt_engine: promptEngine,
      thinking: useLmCodes,
      lm_negative_prompt: useNegativePrompt ? (negativePrompt.trim() || "NO USER INPUT") : "NO USER INPUT",
      model_name: selectedModel?.name || null,
      model: modelForInference,
      main_model_path: mainModelPath,
      lm_model_path: lmModelPath,
      device,
      lm_backend: lmBackend,
      initialize_lm: initializeLm,
      use_flash_attention: useFlashAttention,
      offload_to_cpu: offloadToCpu,
      offload_dit_to_cpu: offloadDitToCpu,
      compile_model: compileModel,
      int8_quantization: int8Quantization,
    };
    if (String(bpm).trim()) out.bpm = Number(bpm);
    if (keyscale.trim()) out.keyscale = keyscale.trim();
    if (timeSignature.trim()) out.timesignature = timeSignature.trim();
    if (String(ditInferenceSteps).trim()) out.dit_inference_steps = Number(ditInferenceSteps);
    if (String(shift).trim()) out.shift = Number(shift);
    return out;
  };

  const syncDuration = (val) => {
    const v = clamp(Math.round(val), 30, 240);
    setDuration(v);
    setDurationInput(String(v));
  };

  const formatCoverStrength = (val) => String(Number(val.toFixed(2)));
  const syncCoverStrength = (val) => {
    const v = clamp(Number(val), 0.1, 1.0);
    const normalized = Number(v.toFixed(2));
    setCoverStrength(normalized);
    setCoverStrengthInput(formatCoverStrength(normalized));
  };

  const onCoverStrengthInputChange = (val) => {
    const cleaned = String(val).replace(/[^\d.]/g, "");
    setCoverStrengthInput(cleaned);
    if (!cleaned || cleaned === ".") return;
    const parsed = Number(cleaned);
    if (Number.isNaN(parsed)) return;
    syncCoverStrength(parsed);
  };

  useEffect(() => {
    if (coverStrongAudio) syncCoverStrength(1.0);
  }, [coverStrongAudio]);

  const hasStylePrompt = prompt.trim().length > 0;
  const hasCaptionInput = captionOverride.trim().length > 0 || buildCaptionInput().trim().length > 0;
  const hasPromptOrCaption = isCaptionEngine ? hasCaptionInput : hasStylePrompt;
  const hasLyricsInput = instrumentalOnly || lyrics.trim().length > 0;
  const hasCoverSourceAudio = Boolean(
    sourceSong?.audioUrl || sourceSong?.instrumentalUrl || sourceSong?.vocalsUrl
  );

  const canGenerateCreate =
    !generating &&
    title.trim().length > 0 &&
    (mode === "prompt" ? hasPromptOrCaption : hasStylePrompt && hasLyricsInput);

  const canGenerateCover =
    !generating &&
    title.trim().length > 0 &&
    !!effectiveSourceSongId &&
    hasCoverSourceAudio &&
    !loadingSourceSong &&
    !sourceSongError;

  const canGenerate = flowMode === "cover" ? canGenerateCover : canGenerateCreate;

  const generateCreate = async () => {
    const params = buildInferParams();
    let res = await fetch(`${API_BASE}/api/song-generation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      res = await fetch(`${API_BASE}/api/song-generation/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
    }
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
      duration: autoDuration ? null : duration,
      genres: [...genreTokens],
      createdAt: new Date().toISOString(),
      audioUrl: null,
      modelName: selectedModel?.name || null,
      modelEpoch: selectedCheckpoint?.epochs || null,
      status: "queued",
      progress: 0,
      request: params,
      assets: {},
      hasAssets: true,
      selectedAssetKey: null,
    };
    setSongs((prev) => [newSong, ...prev]);
    startPolling(jobId, "create");
    onGenerate?.(newSong);
  };

  const generateCover = async () => {
    const params = {
      title: title.trim(),
      source_song_id: effectiveSourceSongId,
      target_voice: coverSelectedModel?.name || null,
      pitch_shift: Number.isFinite(Number(coverPitchShift)) ? Number(coverPitchShift) : 0,
      style_prompt: coverStylePrompt.trim() || null,
      lyrics: coverLyrics.trim() || null,
      cover_mode: coverMode,
      preserve_tempo: !!coverPreserveTempo,
      output_format: coverOutputFormat || "wav",
      audio_cover_strength: coverStrength,
      strong_audio_conditioning: !!coverStrongAudio,
    };
    const data = await startCoverGeneration(params);
    const jobId = data.job_id;
    if (!jobId) throw new Error("Cover job did not return a job id");
    setCurrentJobId(jobId);
    const newSong = {
      id: jobId,
      title: title.trim(),
      createdAt: new Date().toISOString(),
      status: "queued",
      progress: 0,
      request: params,
      assets: {},
      hasAssets: true,
      selectedAssetKey: null,
      derivationType: "cover",
      sourceSongId: effectiveSourceSongId,
      sourceTitle: sourceSong?.title || null,
    };
    setSongs((prev) => [newSong, ...prev]);
    startPolling(jobId, "cover");
    onGenerate?.(newSong);
  };

  const generate = async () => {
    if (!canGenerate) return;
    setError(null);
    setMissingDeps(null);
    setGenerating(true);
    setProgress(0);
    setStatusMessage(flowMode === "cover" ? "Starting cover generation..." : "Starting generation...");
    try {
      if (flowMode === "cover") await generateCover();
      else await generateCreate();
    } catch (e) {
      console.error("Generation error:", e);
      applyError(e?.message || "Failed to start generation");
      setGenerating(false);
      setProgress(0);
      setStatusMessage("");
    }
  };

  const transcribeCoverLyrics = async () => {
    if (!effectiveSourceSongId) return;
    setCoverTranscribeError(null);
    setCoverTranscribing(true);
    try {
      const data = await transcribeCoverSource(effectiveSourceSongId, coverTranscribeEngine);
      setCoverLyrics(String(data?.lyrics || ""));
    } catch (e) {
      setCoverTranscribeError(e?.message || "Failed to transcribe source song");
    } finally {
      setCoverTranscribing(false);
    }
  };

  const deleteSong = useCallback(
    async (songId) => {
      try {
        const res = await fetch(`${API_BASE}/api/song-generation/delete/${songId}`, {
          method: "DELETE",
        });
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
    },
    [playingId]
  );

  const playPause = useCallback(
    (song) => {
      if (playingId === song.id) {
        if (audioRef.current) audioRef.current.pause();
        setPlayingId(null);
        return;
      }
      if (audioRef.current) audioRef.current.pause();
      let playUrl = null;
      if (song.hasAssets && song.assets) {
        const key = song.selectedAssetKey || getBestAssetKey(song.assets);
        playUrl = key ? resolveAssetUrl(song, key) : null;
      }
      if (!playUrl) playUrl = song.vocalsUrl || song.instrumentalUrl || song.audioUrl;
      if (playUrl) {
        audioRef.current = new Audio(`${API_BASE}${playUrl}`);
        audioRef.current.play().catch((e) => console.error("Play error:", e));
        audioRef.current.onended = () => setPlayingId(null);
        setPlayingId(song.id);
      }
    },
    [playingId]
  );

  const handleSelectAsset = useCallback((songId, assetKey) => {
    setSongs((prev) => prev.map((sx) => (sx.id === songId ? { ...sx, selectedAssetKey: assetKey } : sx)));
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const aceStepProps = {
    showAceStepAdvanced,
    setShowAceStepAdvanced,
    promptEngine,
    setPromptEngine,
    useLmCodes,
    setUseLmCodes,
    setLmCodesTouched,
    mergeMetaIntoCaption,
    setMergeMetaIntoCaption,
    constraintRapOnly,
    setConstraintRapOnly,
    constraintNoSinging,
    setConstraintNoSinging,
    constraintNoHook,
    setConstraintNoHook,
    useNegativePrompt,
    setUseNegativePrompt,
    negativePrompt,
    setNegativePrompt,
    initializeLm,
    mainModelPath,
    setMainModelPath,
    lmModelPath,
    setLmModelPath,
    lmBackend,
    setLmBackend,
    device,
    setDevice,
    bpm,
    setBpm,
    keyscale,
    setKeyscale,
    timeSignature,
    setTimeSignature,
    ditInferenceSteps,
    setDitInferenceSteps,
    shift,
    setShift,
    useFlashAttention,
    setUseFlashAttention,
    offloadToCpu,
    setOffloadToCpu,
    offloadDitToCpu,
    setOffloadDitToCpu,
    compileModel,
    setCompileModel,
    int8Quantization,
    setInt8Quantization,
  };

  return (
    <>
      <MissingDepsModal
        open={!!missingDeps}
        onClose={() => setMissingDeps(null)}
        missingDeps={missingDeps}
        ui={ui}
      />
      <div style={{ maxWidth: t.maxW, margin: "0 auto" }}>
        <div ref={sentinelRef} />
        <CreateSongHeader ui={ui} t={t} isStuck={isStuck} mode={flowMode} />
        <div className="cs-grid" style={{ margin: "20px 20px 0 20px" }}>
          <div style={{ display: "grid", gap: 14 }}>
            {flowMode === "cover" ? (
              <>
                <SourceSongPanel
                  ui={ui}
                  t={t}
                  sourceSong={sourceSong}
                  loading={loadingSourceSong}
                  error={sourceSongError}
                />
                <CoverFormPanel
                  ui={ui}
                  t={t}
                  title={title}
                  setTitle={setTitle}
                  pitchShift={coverPitchShift}
                  setPitchShift={setCoverPitchShift}
                  coverStrength={coverStrength}
                  coverStrengthInput={coverStrengthInput}
                  onCoverStrengthChange={syncCoverStrength}
                  onCoverStrengthInputChange={onCoverStrengthInputChange}
                  strongAudioConditioning={coverStrongAudio}
                  setStrongAudioConditioning={setCoverStrongAudio}
                  lyrics={coverLyrics}
                  setLyrics={setCoverLyrics}
                  onTranscribe={transcribeCoverLyrics}
                  transcribing={coverTranscribing}
                  transcribeError={coverTranscribeError}
                  canTranscribe={!!effectiveSourceSongId && hasCoverSourceAudio && !loadingSourceSong}
                  transcribeEngine={coverTranscribeEngine}
                  setTranscribeEngine={setCoverTranscribeEngine}
                  coverMode={coverMode}
                  setCoverMode={setCoverMode}
                  stylePrompt={coverStylePrompt}
                  setStylePrompt={setCoverStylePrompt}
                  preserveTempo={coverPreserveTempo}
                  setPreserveTempo={setCoverPreserveTempo}
                  loadingModels={loadingModels}
                  availableModels={availableModels}
                  selectedModel={coverSelectedModel}
                  selectedCheckpoint={coverSelectedCheckpoint}
                  onSelectModel={setCoverSelectedModel}
                  onSelectCheckpoint={setCoverSelectedCheckpoint}
                  onClearPersona={() => {
                    setCoverSelectedModel(null);
                    setCoverSelectedCheckpoint(null);
                  }}
                  generating={generating}
                  progress={progress}
                  statusMessage={statusMessage}
                  canGenerate={canGenerate}
                  onGenerate={generate}
                />
              </>
            ) : (
              <CreateSongFormPanel
                ui={ui}
                t={t}
                title={title}
                setTitle={setTitle}
                duration={duration}
                durationInput={durationInput}
                autoDuration={autoDuration}
                syncDuration={syncDuration}
                setDurationInput={setDurationInput}
                setAutoDuration={setAutoDuration}
                promptEngine={promptEngine}
                captionOverride={captionOverride}
                setCaptionOverride={setCaptionOverride}
                enhanceVocals={enhanceVocals}
                setEnhanceVocals={setEnhanceVocals}
                instrumentalOnly={instrumentalOnly}
                setInstrumentalOnly={setInstrumentalOnly}
                mode={mode}
                setMode={setMode}
                prompt={prompt}
                setPrompt={setPrompt}
                lyrics={lyrics}
                setLyrics={setLyrics}
                aceStepProps={aceStepProps}
                genreText={genreText}
                setGenreText={setGenreText}
                genreTokens={genreTokens}
                usedGenreKeys={usedGenreKeys}
                addGenreToken={addGenreToken}
                removeGenreToken={removeGenreToken}
                loadingModels={loadingModels}
                availableModels={availableModels}
                selectedModel={selectedModel}
                selectedCheckpoint={selectedCheckpoint}
                setSelectedModel={setSelectedModel}
                setSelectedCheckpoint={setSelectedCheckpoint}
                generating={generating}
                progress={progress}
                statusMessage={statusMessage}
                canGenerate={canGenerate}
                onGenerate={generate}
              />
            )}
          </div>
          <div>
            <GeneratedPanel
              ui={ui}
              t={t}
              songs={songs}
              loadingSongs={loadingSongs}
              error={error}
              playingId={playingId}
              onPlayPause={playPause}
              onDeleteSong={deleteSong}
              onSelectAsset={handleSelectAsset}
              onClearError={clearError}
            />
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
    </>
  );
}

export default CreateSongView;
