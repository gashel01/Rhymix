import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { importFoundationVoiceInput } from "../api";
import { requestGroqAutofill } from "../../utils/groqAutofill";
import { StudioAssistButton, StudioAssistSuggestion } from "./GroqAssist";

const BARS_OPTIONS = [4, 8];
const VARIANT_OPTIONS = [1, 2, 3, 4];
const SAMPLER_OPTIONS = ["dpmpp-3m-sde", "k-heun", "k-euler", "k-euler-ancestral"];
const INSTRUMENT_OPTIONS = [
  "Keys",
  "Synth",
  "Strings",
  "Guitar",
  "Bass",
  "Brass",
  "Woodwinds",
  "Choir",
  "Pluck",
  "Pad",
  "FX",
];

const normalizeRange = (range) => {
  if (!range) return null;
  const start = Math.min(Number(range.start ?? 0), Number(range.end ?? 0));
  const end = Math.max(Number(range.start ?? 0), Number(range.end ?? 0));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end };
};

const formatSeconds = (value) => {
  const seconds = Number(value) || 0;
  if (seconds <= 0) return "0.0s";
  return `${seconds.toFixed(1)}s`;
};

const parseNumberOr = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const makeRandomSeed = () => Math.floor(Math.random() * 1000000000);

const FoundationPanel = ({ lanes, clips, selection, project, transport, onStartAiJob, onRefreshProject, initialMode = "generate" }) => {
  const [mode, setMode] = useState(initialMode);
  const [prompt, setPrompt] = useState("");
  const [bars, setBars] = useState(4);
  const [bpm, setBpm] = useState(project?.bpm || 120);
  const [keySignature, setKeySignature] = useState(project?.key || "");
  const [instrumentFamily, setInstrumentFamily] = useState("Synth");
  const [styleTags, setStyleTags] = useState("");
  const [fxTags, setFxTags] = useState("");
  const [variantCount, setVariantCount] = useState(1);
  const [seed, setSeed] = useState(12345);
  const [steps, setSteps] = useState(250);
  const [cfgScale, setCfgScale] = useState(6.0);
  const [cfgRescale, setCfgRescale] = useState(0.0);
  const [samplerType, setSamplerType] = useState("dpmpp-3m-sde");
  const [initNoiseLevel, setInitNoiseLevel] = useState(0.55);
  const [voiceBlob, setVoiceBlob] = useState(null);
  const [voiceUrl, setVoiceUrl] = useState("");
  const [voiceDurationSec, setVoiceDurationSec] = useState(0);
  const [voiceStatus, setVoiceStatus] = useState("idle");
  const [voiceError, setVoiceError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [assistLoading, setAssistLoading] = useState({
    prompt: false,
    styleTags: false,
    fxTags: false,
  });
  const [assistError, setAssistError] = useState({
    prompt: "",
    styleTags: "",
    fxTags: "",
  });
  const [assistSuggestion, setAssistSuggestion] = useState({
    prompt: "",
    styleTags: "",
    fxTags: "",
  });

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const importedVoiceRef = useRef(null);

  const selectedClip = useMemo(
    () => clips?.find((clip) => selection?.clipIds?.[0] === clip.id) || null,
    [clips, selection]
  );

  const sourceClip = useMemo(() => {
    if (selectedClip?.clipType !== "midi" && selectedClip?.sourceAssetId) return selectedClip;
    const range = normalizeRange(selection?.range);
    if (!range) return null;
    const laneIds = Array.isArray(selection?.laneIds) ? selection.laneIds : null;
    return (
      clips?.find((clip) => {
        if (clip.clipType === "midi" || !clip.sourceAssetId) return false;
        if (laneIds?.length && !laneIds.includes(clip.laneId)) return false;
        const clipStart = Number(clip.timelineStartSec ?? 0);
        const clipEnd =
          clipStart + Math.max(0.01, Number(clip.srcEndSec ?? 0) - Number(clip.srcStartSec ?? 0));
        return range.end > clipStart && range.start < clipEnd;
      }) || null
    );
  }, [clips, selectedClip, selection]);

  const sourceRange = useMemo(() => {
    const selectedRange = normalizeRange(selection?.range);
    if (selectedRange) return selectedRange;
    if (!sourceClip) return null;
    const clipStart = Number(sourceClip.timelineStartSec ?? 0);
    const clipEnd =
      clipStart + Math.max(0.01, Number(sourceClip.srcEndSec ?? 0) - Number(sourceClip.srcStartSec ?? 0));
    return { start: clipStart, end: clipEnd };
  }, [selection, sourceClip]);

  const canRestyle = Boolean(sourceClip?.sourceAssetId && sourceRange);
  const canRunVoiceRestyle = Boolean(voiceBlob || importedVoiceRef.current);

  const sourceSummary = useMemo(() => {
    if (mode === "voice_to_midi") {
      return canRunVoiceRestyle
        ? `Recorded voice idea, ${formatSeconds(voiceDurationSec || importedVoiceRef.current?.durationSec)}`
        : "Recorded voice input";
    }
    if (canRestyle && sourceRange) {
      return `${sourceClip?.sourceAssetId || "Selected clip"} from ${sourceRange.start.toFixed(2)}s to ${sourceRange.end.toFixed(2)}s`;
    }
    return "No active source";
  }, [canRestyle, canRunVoiceRestyle, mode, sourceClip?.sourceAssetId, sourceRange, voiceDurationSec]);

  useEffect(() => {
    setBpm(project?.bpm || 120);
  }, [project?.bpm]);

  useEffect(() => {
    setKeySignature(project?.key || "");
  }, [project?.key]);

  useEffect(() => {
    if (!initialMode) return;
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    return () => {
      if (voiceUrl) {
        URL.revokeObjectURL(voiceUrl);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [voiceUrl]);

  const clearVoiceRecording = () => {
    if (voiceUrl) {
      URL.revokeObjectURL(voiceUrl);
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
    startedAtRef.current = 0;
    importedVoiceRef.current = null;
    setVoiceBlob(null);
    setVoiceUrl("");
    setVoiceDurationSec(0);
    setVoiceStatus("idle");
    setVoiceError("");
  };

  const stopVoiceRecording = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  };

  const startVoiceRecording = async () => {
    clearVoiceRecording();
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceError("Microphone access is not available in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const options = {};
      if (window.MediaRecorder?.isTypeSupported?.("audio/webm;codecs=opus")) {
        options.mimeType = "audio/webm;codecs=opus";
      }
      const recorder = new MediaRecorder(stream, options);
      chunksRef.current = [];
      startedAtRef.current = performance.now();
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onerror = (event) => {
        setVoiceError(event?.error?.message || "Failed to record voice input.");
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const nextUrl = URL.createObjectURL(blob);
        setVoiceBlob(blob);
        setVoiceUrl(nextUrl);
        setVoiceDurationSec(Math.max(0, (performance.now() - startedAtRef.current) / 1000));
        setVoiceStatus("ready");
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        chunksRef.current = [];
      };
      recorder.start();
      setVoiceStatus("recording");
    } catch (err) {
      setVoiceError(err?.message || "Failed to start voice recording.");
      setVoiceStatus("idle");
    }
  };

  const ensureImportedVoiceSource = async (insertSec) => {
    if (importedVoiceRef.current?.assetId && importedVoiceRef.current?.durationSec > 0) {
      return importedVoiceRef.current;
    }
    if (!project?.id || !voiceBlob) {
      throw new Error("Record a voice input first.");
    }
    const response = await importFoundationVoiceInput(project.id, {
      blob: voiceBlob,
      filename: voiceBlob.type?.includes("webm") ? "foundation-voice-input.webm" : "foundation-voice-input.wav",
      insertSec,
      label: "Foundation Voice Input",
      laneName: "Foundation Voice Input",
    });
    const durationSec = Number(response?.clip?.srcEndSec ?? response?.asset?.durationSec ?? voiceDurationSec ?? 0);
    importedVoiceRef.current = {
      assetId: response?.asset?.id,
      durationSec: Math.max(0.01, durationSec || 0),
    };
    await onRefreshProject?.(project.id);
    return importedVoiceRef.current;
  };

  const runAssist = useCallback(async (slot, task, context) => {
    setAssistLoading((prev) => ({ ...prev, [slot]: true }));
    setAssistError((prev) => ({ ...prev, [slot]: "" }));
    setAssistSuggestion((prev) => ({ ...prev, [slot]: "" }));
    try {
      const data = await requestGroqAutofill(task, context);
      const suggestion =
        data?.suggestion?.prompt
        || data?.suggestion?.styleTags
        || data?.suggestion?.fxTags
        || "";
      if (!String(suggestion).trim()) {
        throw new Error("Groq returned an empty suggestion.");
      }
      setAssistSuggestion((prev) => ({ ...prev, [slot]: String(suggestion).trim() }));
    } catch (error) {
      setAssistError((prev) => ({ ...prev, [slot]: error?.message || "Autofill failed." }));
    } finally {
      setAssistLoading((prev) => ({ ...prev, [slot]: false }));
    }
  }, []);

  const clearAssist = useCallback((slot) => {
    setAssistError((prev) => ({ ...prev, [slot]: "" }));
    setAssistSuggestion((prev) => ({ ...prev, [slot]: "" }));
  }, []);

  const buildAssistContext = useCallback(() => ({
    mode,
    prompt,
    bars,
    bpm,
    key: keySignature,
    instrumentFamily,
    styleTags,
    fxTags,
    sourceSummary,
  }), [bars, bpm, fxTags, instrumentFamily, keySignature, mode, prompt, sourceSummary, styleTags]);

  const requestPromptAssist = useCallback(() => {
    runAssist(
      "prompt",
      mode === "generate" ? "studio_foundation_generate_prompt" : "studio_foundation_restyle_prompt",
      buildAssistContext()
    );
  }, [buildAssistContext, mode, runAssist]);

  const requestStyleTagsAssist = useCallback(() => {
    runAssist("styleTags", "studio_foundation_style_tags", buildAssistContext());
  }, [buildAssistContext, runAssist]);

  const requestFxTagsAssist = useCallback(() => {
    runAssist("fxTags", "studio_foundation_fx_tags", buildAssistContext());
  }, [buildAssistContext, runAssist]);

  const handleSubmit = async () => {
    const playheadSec = Number(transport?.currentTime ?? 0);
    const payload = {
      prompt: prompt.trim(),
      bars,
      bpm: Number(bpm) || 120,
      key: keySignature.trim(),
      instrumentFamily: instrumentFamily.trim(),
      styleTags: styleTags
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      fxTags: fxTags
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      variantCount,
      seed: parseNumberOr(seed, 12345),
      steps: Math.max(1, parseNumberOr(steps, 250)),
      cfgScale: parseNumberOr(cfgScale, 6.0),
      cfgRescale: parseNumberOr(cfgRescale, 0.0),
      samplerType,
      commitMode: "both",
      insertSec: playheadSec,
      timelineStartSec: playheadSec,
      applyProjectTempo: !project?.bpm,
    };

    if (mode === "voice_to_midi") {
      if (!canRunVoiceRestyle || submitting) return;
      setSubmitting(true);
      setVoiceError("");
      try {
        const imported = await ensureImportedVoiceSource(playheadSec);
        onStartAiJob?.("foundation_restyle", {
          ...payload,
          sourceAssetId: imported.assetId,
          startSec: 0,
          endSec: imported.durationSec,
          timelineStartSec: playheadSec,
          insertSec: playheadSec,
          initNoiseLevel: parseNumberOr(initNoiseLevel, 0.55),
          useExplicitSourceRange: true,
        });
      } catch (err) {
        setVoiceError(err?.message || "Failed to import voice input.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (mode === "restyle") {
      if (!canRestyle) return;
      onStartAiJob?.("foundation_restyle", {
        ...payload,
        clipId: sourceClip.id,
        sourceAssetId: sourceClip.sourceAssetId,
        startSec: sourceRange.start,
        endSec: sourceRange.end,
        timelineStartSec: sourceRange.start,
        insertSec: sourceRange.start,
        initNoiseLevel: parseNumberOr(initNoiseLevel, 0.55),
      });
      return;
    }

    onStartAiJob?.("foundation_generate", payload);
  };

  return (
    <div className="studio-panel-content studio-voice-midi">
      <div className="studio-meta-block">
        <div className="studio-panel-title">Foundation-1</div>
        <div className="studio-subtext">
          Structured loop generation and restyle for Studio. Results are placed on fresh audio and MIDI lanes at the current playhead.
        </div>
      </div>

      <div className="studio-field">
        <label>Mode</label>
        <select value={mode} onChange={(event) => setMode(event.target.value)}>
          <option value="generate">Generate Loop</option>
          <option value="restyle">Restyle Selection</option>
          <option value="voice_to_midi">Voice to MIDI</option>
        </select>
      </div>

      {mode === "restyle" && (
        <div className="studio-meta-block">
          {canRestyle ? (
            <>
              <div className="studio-subtext">
                Source: {sourceClip?.sourceAssetId || "Selected clip"} · {sourceRange.start.toFixed(2)}s to{" "}
                {sourceRange.end.toFixed(2)}s
              </div>
              <div className="studio-subtext" style={{ marginTop: 4 }}>
                Restyled output lands on new audio and MIDI lanes. The MIDI lane starts muted so the user can choose later whether to keep the audio or the MIDI.
              </div>
            </>
          ) : (
            <div className="studio-empty">Select an audio clip or range to use Restyle.</div>
          )}
        </div>
      )}

      {mode === "voice_to_midi" && (
        <div className="studio-meta-block">
          <div className="studio-subtext">
            Record a vocal idea, then Foundation will use that take as the source for its restyle flow with the same parameters as the normal restyle mode.
          </div>
          <div className="studio-subtext" style={{ marginTop: 4 }}>
            The recorded voice is imported once as a Studio clip, and the generated audio plus MIDI still land on fresh lanes at the current playhead.
          </div>
          <div className="studio-actions-row" style={{ marginTop: 12 }}>
            <button
              className="studio-btn"
              type="button"
              onClick={startVoiceRecording}
              disabled={voiceStatus === "recording" || submitting}
            >
              Record Voice
            </button>
            <button
              className="studio-btn"
              type="button"
              onClick={stopVoiceRecording}
              disabled={voiceStatus !== "recording"}
            >
              Stop
            </button>
            <button
              className="studio-btn ghost"
              type="button"
              onClick={clearVoiceRecording}
              disabled={voiceStatus === "recording" || (!voiceBlob && !importedVoiceRef.current)}
            >
              Clear
            </button>
          </div>
          <div className="studio-subtext" style={{ marginTop: 8 }}>
            {voiceStatus === "recording"
              ? "Recording voice input..."
              : canRunVoiceRestyle
                ? `Voice source ready · ${formatSeconds(voiceDurationSec || importedVoiceRef.current?.durationSec)}`
                : "No voice source recorded yet."}
          </div>
          {voiceUrl && (
            <audio controls src={voiceUrl} style={{ width: "100%", marginTop: 10 }} />
          )}
          {voiceError ? (
            <div className="studio-empty" style={{ marginTop: 8 }}>
              {voiceError}
            </div>
          ) : null}
        </div>
      )}

      <div className="studio-field">
        <div className="studio-field-head">
          <label>Prompt</label>
          <StudioAssistButton
            onRequest={requestPromptAssist}
            loading={assistLoading.prompt}
          />
        </div>
        <textarea
          rows={4}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Warm analog synth loop, sidechained, dreamy, late-night city texture"
        />
        <StudioAssistSuggestion
          value={assistSuggestion.prompt}
          error={assistError.prompt}
          onUse={() => {
            if (!assistSuggestion.prompt) return;
            setPrompt(assistSuggestion.prompt);
            clearAssist("prompt");
          }}
          onCancel={() => clearAssist("prompt")}
        />
      </div>

      <div className="studio-inline">
        <div className="studio-field">
          <label>Bars</label>
          <select value={bars} onChange={(event) => setBars(Number(event.target.value) || 4)}>
            {BARS_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        <div className="studio-field">
          <label>BPM</label>
          <input
            type="number"
            min="60"
            max="200"
            step="1"
            value={bpm}
            onChange={(event) => setBpm(Number(event.target.value) || 120)}
          />
        </div>

        <div className="studio-field">
          <label>Key</label>
          <input
            type="text"
            value={keySignature}
            onChange={(event) => setKeySignature(event.target.value)}
            placeholder="C minor"
          />
        </div>
      </div>

      <div className="studio-field">
        <label>Instrument Family</label>
        <select value={instrumentFamily} onChange={(event) => setInstrumentFamily(event.target.value)}>
          {INSTRUMENT_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>

      <div className="studio-field">
        <div className="studio-field-head">
          <label>Style Tags</label>
          <StudioAssistButton
            onRequest={requestStyleTagsAssist}
            loading={assistLoading.styleTags}
          />
        </div>
        <input
          type="text"
          value={styleTags}
          onChange={(event) => setStyleTags(event.target.value)}
          placeholder="lo-fi, dusty, cinematic, pulsing"
        />
        <StudioAssistSuggestion
          value={assistSuggestion.styleTags}
          error={assistError.styleTags}
          onUse={() => {
            if (!assistSuggestion.styleTags) return;
            setStyleTags(assistSuggestion.styleTags);
            clearAssist("styleTags");
          }}
          onCancel={() => clearAssist("styleTags")}
        />
      </div>

      <div className="studio-field">
        <div className="studio-field-head">
          <label>FX Tags</label>
          <StudioAssistButton
            onRequest={requestFxTagsAssist}
            loading={assistLoading.fxTags}
          />
        </div>
        <input
          type="text"
          value={fxTags}
          onChange={(event) => setFxTags(event.target.value)}
          placeholder="tape, chorus, shimmer, sidechain"
        />
        <StudioAssistSuggestion
          value={assistSuggestion.fxTags}
          error={assistError.fxTags}
          onUse={() => {
            if (!assistSuggestion.fxTags) return;
            setFxTags(assistSuggestion.fxTags);
            clearAssist("fxTags");
          }}
          onCancel={() => clearAssist("fxTags")}
        />
      </div>

      <div className="studio-inline">
        <div className="studio-field">
          <label>Variants</label>
          <select value={variantCount} onChange={(event) => setVariantCount(Number(event.target.value) || 1)}>
            {VARIANT_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="studio-meta-block">
        <div className="studio-panel-title">Generation Settings</div>
        <div className="studio-inline">
          <div className="studio-field">
            <div className="studio-field-head">
              <label>Seed</label>
              <button className="studio-mini" type="button" onClick={() => setSeed(makeRandomSeed())}>
                Randomize
              </button>
            </div>
            <input
              type="number"
              step="1"
              value={seed}
              onChange={(event) => setSeed(parseNumberOr(event.target.value, 12345))}
            />
          </div>
          <div className="studio-field">
            <label>Steps</label>
            <input
              type="number"
              min="1"
              max="1000"
              step="1"
              value={steps}
              onChange={(event) => setSteps(Math.max(1, parseNumberOr(event.target.value, 250)))}
            />
          </div>
        </div>

        <div className="studio-inline">
          <div className="studio-field">
            <label>CFG Scale</label>
            <input
              type="number"
              min="0"
              max="20"
              step="0.1"
              value={cfgScale}
              onChange={(event) => setCfgScale(parseNumberOr(event.target.value, 6.0))}
            />
          </div>
          <div className="studio-field">
            <label>CFG Rescale</label>
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={cfgRescale}
              onChange={(event) => setCfgRescale(parseNumberOr(event.target.value, 0.0))}
            />
          </div>
        </div>

        <div className="studio-field">
          <label>Sampler</label>
          <select value={samplerType} onChange={(event) => setSamplerType(event.target.value)}>
            {SAMPLER_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        {mode !== "generate" && (
          <div className="studio-field">
            <label>Restyle Noise</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={initNoiseLevel}
              onChange={(event) => setInitNoiseLevel(parseNumberOr(event.target.value, 0))}
            />
            <div className="studio-subtext">Noise level: {Number(initNoiseLevel).toFixed(2)}</div>
          </div>
        )}
      </div>

      <div className="studio-actions-row">
        <button
          className="studio-btn accent"
          disabled={
            submitting
            || (mode === "restyle" && !canRestyle)
            || (mode === "voice_to_midi" && !canRunVoiceRestyle)
          }
          onClick={handleSubmit}
        >
          {mode === "generate"
            ? "Generate Loop"
            : mode === "voice_to_midi"
              ? (submitting ? "Importing Voice..." : "Voice to MIDI")
              : "Restyle Selection"}
        </button>
      </div>
    </div>
  );
};

export default FoundationPanel;
