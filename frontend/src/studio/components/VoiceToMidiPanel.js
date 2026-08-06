import React, { useEffect, useMemo, useRef, useState } from "react";
import Select from "../../components/common/Select";
import { createPortal } from "react-dom";
import { useVoiceToMidiWs } from "../hooks/useVoiceToMidiWs";
import { insertMidiClip } from "../insertMidiClip";
import BeatboxCalibrationWizard from "../../beatboxWizard/BeatboxCalibrationWizard";

const INSTRUMENTS = [
  "Piano",
  "Guitar",
  "Bass",
  "Strings",
  "Synth",
  "Drums",
];

const SCALE_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const SCALE_OPTIONS = [
  { value: "", label: "None" },
  ...SCALE_NOTES.map((note) => ({ value: `${note} major`, label: `${note} Major` })),
  ...SCALE_NOTES.map((note) => ({ value: `${note} minor`, label: `${note} Minor` })),
];

const DRUM_CALIBRATION_LABELS = [
  { value: "kick", label: "Kick" },
  { value: "snare", label: "Snare" },
  { value: "hat", label: "Hat" },
  { value: "clap", label: "Clap" },
];

const quantizeOptions = [
  { value: "1/16", label: "1/16" },
  { value: "1/8", label: "1/8" },
  { value: "off", label: "Off" },
];

const VoiceToMidiPanel = ({ lanes, project, transport, selection, actions, onRefreshProject }) => {
  const [mode, setMode] = useState("melody");
  const [instrument, setInstrument] = useState("Piano");
  const [targetLaneId, setTargetLaneId] = useState("new");
  const [quantize, setQuantize] = useState("1/16");
  const [applyDetectedBpm, setApplyDetectedBpm] = useState(true);
  const [snapToKey, setSnapToKey] = useState(true);
  const [engineOverride, setEngineOverride] = useState(null);
  const [ddspStrict, setDdspStrict] = useState(true);
  const [startMode, setStartMode] = useState("playhead");
  const [calibratingLabel, setCalibratingLabel] = useState(null);
  const [calibrationInfo, setCalibrationInfo] = useState(null);
  const [drumTraining, setDrumTraining] = useState(false);
  const [drumTrainingInfo, setDrumTrainingInfo] = useState(null);
  const [beatboxWizardOpen, setBeatboxWizardOpen] = useState(false);
  const [enableFormants, setEnableFormants] = useState(true);
  const [dublerDecodeMode, setDublerDecodeMode] = useState("wand_sing");
  const [scaleOverride, setScaleOverride] = useState("");
  const [inputGain, setInputGain] = useState(1);
  const [tuneConf, setTuneConf] = useState(0.35);
  const [tuneStable, setTuneStable] = useState(4);
  const [tuneHangover, setTuneHangover] = useState(4);
  const [tuneMinNote, setTuneMinNote] = useState(0.08);
  const [tuneMinVelocity, setTuneMinVelocity] = useState(40);
  const [tuneGap, setTuneGap] = useState(0.06);
  const [useCustomTuning, setUseCustomTuning] = useState(false);
  const [sampleStatus, setSampleStatus] = useState("idle");
  const [sampleBlob, setSampleBlob] = useState(null);
  const [sampleUrl, setSampleUrl] = useState("");
  const [processedSampleUrl, setProcessedSampleUrl] = useState("");
  const previewInFlightRef = useRef(false);
  const [sampleError, setSampleError] = useState(null);
  const startTickRef = useRef(0);
  const recordLaneRef = useRef({ id: null, created: false, name: null });
  const sampleRef = useRef({ recorder: null, stream: null, chunks: [] });
  const sampleAudioRef = useRef(null);
  const calibrationWaitRef = useRef(null);
  const calibrationTimeoutRef = useRef(null);

  const bpm = project?.bpm || null;
  const key = project?.key || "";
  const ppq = project?.ppq || 480;
  const ticksPerSecond = useMemo(() => (bpm ? (bpm * ppq) / 60 : null), [bpm, ppq]);

  const startTick = useMemo(() => {
    const baseSec =
      startMode === "selection" && selection?.range
        ? Math.min(selection.range.start, selection.range.end)
        : transport?.currentTime || 0;
    if (!ticksPerSecond) return 0;
    return Math.max(0, Math.round(baseSec * ticksPerSecond));
  }, [selection, transport, startMode, ticksPerSecond]);

  useEffect(() => {
    if (mode !== "melody" && engineOverride) {
      setEngineOverride(null);
    }
  }, [mode, engineOverride]);

  useEffect(() => {
    if (mode !== "dubler_drums") {
      setCalibratingLabel(null);
      setCalibrationInfo(null);
      setDrumTrainingInfo(null);
      setBeatboxWizardOpen(false);
    }
  }, [mode]);

  useEffect(() => {
    if (!beatboxWizardOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setBeatboxWizardOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [beatboxWizardOpen]);

  const {
    status,
    progress,
    error,
    inputLevel,
    inputDb,
    inputClip,
    start,
    stop,
    cancel,
    resetCalibration,
    trainDrumModel,
    setInputGain: updateInputGain,
  } = useVoiceToMidiWs({
    onFinal: (data) => {
      if (data?.processedAudioBase64) {
        const mime = data.processedAudioMime || "audio/wav";
        const nextUrl = `data:${mime};base64,${data.processedAudioBase64}`;
        if (processedSampleUrl && processedSampleUrl.startsWith("blob:")) {
          URL.revokeObjectURL(processedSampleUrl);
        }
        setProcessedSampleUrl(nextUrl);
      }
      if (!data?.clip) {
        if (data?.stats?.calibration) {
          setCalibrationInfo(data.stats.calibration);
        }
        if (calibrationWaitRef.current) {
          const waiter = calibrationWaitRef.current;
          calibrationWaitRef.current = null;
          if (calibrationTimeoutRef.current) {
            clearTimeout(calibrationTimeoutRef.current);
            calibrationTimeoutRef.current = null;
          }
          waiter.resolve(data?.stats?.calibration || null);
        }
        setCalibratingLabel(null);
        return;
      }
      const clip = {
        ...data.clip,
        midiFileBase64: data.midiFileBase64 || null,
      };
      const resolvedLaneId =
        recordLaneRef.current.id || (targetLaneId === "new" ? null : targetLaneId);
      insertMidiClip({
        actions,
        lanes,
        project,
        transport,
        targetLaneId: resolvedLaneId,
        createNewLane: !resolvedLaneId,
        instrument,
        clip,
        startTick: startTickRef.current || startTick,
        applyDetectedBpm,
      });
      if (data?.synthAsset && onRefreshProject && data.projectId) {
        onRefreshProject(data.projectId);
      }
      recordLaneRef.current = { id: null, created: false, name: null };
      setCalibratingLabel(null);
    },
  });

  useEffect(() => {
    updateInputGain(inputGain);
  }, [inputGain, updateInputGain]);

  useEffect(() => {
    return () => {
      if (calibrationTimeoutRef.current) {
        clearTimeout(calibrationTimeoutRef.current);
        calibrationTimeoutRef.current = null;
      }
      if (calibrationWaitRef.current) {
        calibrationWaitRef.current.reject?.(new Error("Calibration cancelled"));
        calibrationWaitRef.current = null;
      }
      if (sampleUrl) {
        URL.revokeObjectURL(sampleUrl);
      }
      if (processedSampleUrl && processedSampleUrl.startsWith("blob:")) {
        URL.revokeObjectURL(processedSampleUrl);
      }
    };
  }, [sampleUrl, processedSampleUrl]);

  useEffect(() => {
    if (status !== "error" || !calibrationWaitRef.current) return;
    const waiter = calibrationWaitRef.current;
    calibrationWaitRef.current = null;
    if (calibrationTimeoutRef.current) {
      clearTimeout(calibrationTimeoutRef.current);
      calibrationTimeoutRef.current = null;
    }
    waiter.reject(new Error(error || "Calibration failed"));
  }, [status, error]);

  if (!actions) {
    return <div className="studio-empty">Studio actions unavailable.</div>;
  }

  const isRecording = status === "recording" || status === "connecting";
  const isBusy = isRecording || sampleStatus === "recording" || drumTraining;

  const beginRecording = async ({ calibrateLabel, calibrateOnly, audioBlob } = {}) => {
    setCalibrationInfo(null);
    if (calibrateOnly && calibrateLabel) {
      setCalibratingLabel(calibrateLabel);
    } else {
      setCalibratingLabel(null);
    }

    const effectiveKey =
      mode === "dubler_melody"
        ? scaleOverride || (snapToKey ? key : null)
        : snapToKey
          ? key
          : null;

    let resolvedLaneId = targetLaneId === "new" ? null : targetLaneId;
    let laneName = null;
    if (!calibrateOnly) {
      if (!resolvedLaneId) {
        const timestamp = new Date().toLocaleTimeString();
        resolvedLaneId =
          (crypto && crypto.randomUUID && crypto.randomUUID()) ||
          `lane-${Math.random().toString(16).slice(2)}`;
        laneName = `${instrument} ${timestamp}`;
        actions.addLane({
          id: resolvedLaneId,
          type: "midi",
          name: laneName,
          instrument,
        });
        recordLaneRef.current = { id: resolvedLaneId, created: true, name: laneName };
      } else {
        recordLaneRef.current = { id: resolvedLaneId, created: false, name: null };
      }
    } else {
      recordLaneRef.current = { id: null, created: false, name: null };
    }

    startTickRef.current = startTick;
    const baseSec =
      startMode === "selection" && selection?.range
        ? Math.min(selection.range.start, selection.range.end)
        : transport?.currentTime || 0;
      await start({
        mode,
        frameSize: 2048,
      instrument,
      targetBpm: bpm,
      targetPPQ: ppq,
      quantize,
      swing: 0,
      key: effectiveKey,
      engine: mode === "melody" ? engineOverride : null,
      engineStrict: mode === "melody" && engineOverride === "ddsp" ? ddspStrict : null,
      projectId: project?.id || null,
      laneId: resolvedLaneId,
      laneName,
      insertAtSec: baseSec,
      ddspSynth: mode === "melody" && engineOverride === "ddsp",
      calibrateLabel: calibrateLabel || null,
      calibrateOnly: calibrateOnly ?? null,
      enableFormants: mode === "dubler_melody" ? enableFormants : null,
      decodeMode: mode === "dubler_melody" ? dublerDecodeMode : null,
      audioBlob: audioBlob || null,
      crepeConf: useCustomTuning && (mode === "melody" || mode === "dubler_melody") ? tuneConf : null,
      crepeStableFrames:
        useCustomTuning && (mode === "melody" || mode === "dubler_melody") ? tuneStable : null,
      crepeHangoverFrames:
        useCustomTuning && (mode === "melody" || mode === "dubler_melody") ? tuneHangover : null,
      crepeMinNoteMs:
        useCustomTuning && (mode === "melody" || mode === "dubler_melody") ? tuneMinNote : null,
      noteMinMs:
        useCustomTuning && (mode === "melody" || mode === "dubler_melody") ? tuneMinNote : null,
      noteGapSec:
        useCustomTuning && (mode === "melody" || mode === "dubler_melody") ? tuneGap : null,
      noteMinVelocity:
        useCustomTuning && (mode === "melody" || mode === "dubler_melody")
          ? tuneMinVelocity
          : null,
      returnProcessedAudio: Boolean(audioBlob),
      previewOnly: false,
    });
  };

  const runSamplePreview = async (blob) => {
    if (!blob || previewInFlightRef.current) return;
    previewInFlightRef.current = true;
    try {
      await start({
        mode: "melody",
        frameSize: 2048,
        instrument,
        targetBpm: null,
        targetPPQ: ppq,
        quantize: "off",
        swing: 0,
        key: null,
        engine: engineOverride || null,
        engineStrict: engineOverride === "ddsp" ? ddspStrict : null,
        projectId: null,
        laneId: null,
        laneName: null,
        insertAtSec: null,
        ddspSynth: false,
        calibrateLabel: null,
        calibrateOnly: true,
        enableFormants: null,
        audioBlob: blob,
        crepeConf: null,
        crepeStableFrames: null,
        crepeHangoverFrames: null,
        crepeMinNoteMs: null,
        noteMinMs: null,
        noteGapSec: null,
        noteMinVelocity: null,
        returnProcessedAudio: true,
        previewOnly: true,
      });
    } finally {
      previewInFlightRef.current = false;
    }
  };

  const startSampleRecording = async () => {
    setSampleError(null);
    if (processedSampleUrl) {
      URL.revokeObjectURL(processedSampleUrl);
      setProcessedSampleUrl("");
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setSampleError("Microphone access not available in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const options = {};
      if (window.MediaRecorder?.isTypeSupported?.("audio/webm;codecs=opus")) {
        options.mimeType = "audio/webm;codecs=opus";
      }
      const recorder = new MediaRecorder(stream, options);
      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder.onerror = (event) => {
        setSampleError(event?.error?.message || "Failed to record sample.");
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        setSampleBlob(blob);
        if (sampleUrl) {
          URL.revokeObjectURL(sampleUrl);
        }
        setSampleUrl(URL.createObjectURL(blob));
        setSampleStatus("ready");
        stream.getTracks().forEach((track) => track.stop());
        sampleRef.current = { recorder: null, stream: null, chunks: [] };
        runSamplePreview(blob);
      };
      recorder.start();
      sampleRef.current = { recorder, stream, chunks };
      setSampleStatus("recording");
    } catch (err) {
      setSampleError(err?.message || "Failed to start sample recording.");
    }
  };

  const stopSampleRecording = () => {
    const recorder = sampleRef.current.recorder;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  };

  const clearSample = () => {
    if (sampleUrl) {
      URL.revokeObjectURL(sampleUrl);
    }
    if (processedSampleUrl && processedSampleUrl.startsWith("blob:")) {
      URL.revokeObjectURL(processedSampleUrl);
    }
    setSampleUrl("");
    setProcessedSampleUrl("");
    setSampleBlob(null);
    setSampleStatus("idle");
    setSampleError(null);
  };

  return (
    <div className="studio-panel-content studio-voice-midi">
      <div className="studio-field">
        <label>Mode</label>
        <div className="studio-actions-row">
          <button
            className={`studio-mini ${mode === "melody" ? "active" : ""}`}
            onClick={() => setMode("melody")}
            disabled={isBusy}
          >
            Melody
          </button>
          <button
            className={`studio-mini ${mode === "rhythm" ? "active" : ""}`}
            onClick={() => {
              setMode("rhythm");
              setInstrument("Drums");
            }}
            disabled={isBusy}
          >
            Rhythm
          </button>
          <button
            className={`studio-mini ${mode === "dubler_melody" ? "active" : ""}`}
            onClick={() => setMode("dubler_melody")}
            disabled={isBusy}
            title="Offline: CREPE + onset/velocity + formant CC"
          >
            Offline Melody
          </button>
          <button
            className={`studio-mini ${mode === "dubler_drums" ? "active" : ""}`}
            onClick={() => {
              setMode("dubler_drums");
              setInstrument("Drums");
            }}
            disabled={isBusy}
            title="Offline: onset + MFCC classifier"
          >
            Offline Drums
          </button>
          <button
            className={`studio-mini ${engineOverride === "crepe" ? "active" : ""}`}
            onClick={() =>
              setEngineOverride((prev) => (prev === "crepe" ? null : "crepe"))
            }
            disabled={isBusy || mode !== "melody"}
            title="Use CREPE only for pitch tracking (pro mode)"
          >
            Pro (CREPE)
          </button>
          <button
            className={`studio-mini ${engineOverride === "ddsp" ? "active" : ""}`}
            onClick={() =>
              setEngineOverride((prev) => (prev === "ddsp" ? null : "ddsp"))
            }
            disabled={isBusy || mode !== "melody"}
            title="Use DDSP f0 extraction (experimental)"
          >
            Pro (DDSP)
          </button>
        </div>
      </div>

      <div className="studio-field">
        <label>Instrument</label>
        <Select
          value={instrument}
          onChange={setInstrument}
          options={INSTRUMENTS.map((inst) => ({ value: String(inst), label: String(inst) }))}
          disabled={isBusy}
        />
      </div>

      <div className="studio-field">
        <label>Mic Gain</label>
        <input
          type="range"
          min="0"
          max="3"
          step="0.05"
          value={inputGain}
          onChange={(e) => setInputGain(Number(e.target.value))}
          disabled={isBusy}
        />
        <div className="studio-meter">
          <div className="studio-meter-fill" style={{ width: `${Math.round(inputLevel * 100)}%` }} />
          {inputClip && <div className="studio-meter-clip">CLIP</div>}
        </div>
        <div className="studio-subtext">
          Gain x{inputGain.toFixed(2)} · {inputDb.toFixed(1)} dB
        </div>
      </div>

      <div className="studio-field">
        <label>Test Recording</label>
        <div className="studio-actions-row">
          <button
            className="studio-mini"
            disabled={isBusy || sampleStatus === "recording"}
            onClick={startSampleRecording}
          >
            Record Sample
          </button>
          <button
            className="studio-mini"
            disabled={sampleStatus !== "recording"}
            onClick={stopSampleRecording}
          >
            Stop Sample
          </button>
          <button
            className="studio-mini"
            disabled={!sampleUrl}
            onClick={() => {
              if (sampleAudioRef.current) {
                sampleAudioRef.current.currentTime = 0;
                sampleAudioRef.current.play();
              }
            }}
          >
            Play Sample
          </button>
          <button className="studio-mini" disabled={!sampleUrl} onClick={clearSample}>
            Clear
          </button>
          <button
            className="studio-mini"
            disabled={!sampleBlob || isBusy || sampleStatus === "recording"}
            onClick={() => beginRecording({ audioBlob: sampleBlob })}
          >
            Run on Sample
          </button>
        </div>
        {sampleUrl && (
          <div>
            <div className="studio-subtext">Original</div>
            <audio ref={sampleAudioRef} controls src={sampleUrl} className="studio-audio-preview" />
            {processedSampleUrl && (
              <>
                <div className="studio-subtext">Processed</div>
                <audio controls src={processedSampleUrl} className="studio-audio-preview" />
              </>
            )}
          </div>
        )}
        {sampleError && <div className="studio-subtext">Sample error: {sampleError}</div>}
        <div className="studio-subtext">Record once, then run any mode on it for testing.</div>
      </div>

      <div className="studio-field">
        <label>Target Lane</label>
        <Select
          value={targetLaneId}
          onChange={setTargetLaneId}
          disabled={isBusy}
          options={[
            { value: "new", label: "Create new lane" },
            ...lanes.map((lane) => ({ value: lane.id, label: lane.name })),
          ]}
          ariaLabel="Target lane"
        />
      </div>

      <div className="studio-field">
        <label>Insert At</label>
        <Select
          value={startMode}
          onChange={setStartMode}
          options={[{ value: "playhead", label: "Playhead" }]}
          disabled={isBusy}
        />
      </div>

      <div className="studio-field">
        <label>Quantize</label>
        <Select
          value={quantize}
          onChange={setQuantize}
          options={quantizeOptions.map((opt) => ({ value: opt.value, label: opt.label }))}
          disabled={isBusy}
        />
      </div>

      <label className="studio-toggle">
        <input
          type="checkbox"
          checked={applyDetectedBpm}
          onChange={(e) => setApplyDetectedBpm(e.target.checked)}
          disabled={isBusy}
        />
        Apply detected BPM if project BPM is empty
      </label>

      <label className="studio-toggle">
        <input
          type="checkbox"
          checked={snapToKey}
          onChange={(e) => setSnapToKey(e.target.checked)}
          disabled={isBusy || !key}
        />
        Snap to project key ({key || "set key in Details"})
      </label>

      {mode === "dubler_melody" && (
        <div className="studio-field">
          <label>Scale (optional)</label>
          <Select
            value={scaleOverride}
            onChange={(next) => setScaleOverride(next)}
            options={SCALE_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
            disabled={isBusy}
          />
          <div className="studio-subtext">If set, notes snap to this scale.</div>
        </div>
      )}

      {mode === "dubler_melody" && (
        <div className="studio-field">
          <label>Decoder / Preset</label>
          <Select
            value={dublerDecodeMode}
            onChange={setDublerDecodeMode}
            options={[{ value: "wand_sing", label: "Magic Wand (sing)" }, { value: "wand_whistle", label: "Magic Wand (whistle)" }, { value: "wand_noisy_room", label: "Magic Wand (noisy room)" }, { value: "rules", label: "Rules (classic)" }, { value: "viterbi", label: "Viterbi (global)" }]}
            disabled={isBusy}
          />
          <div className="studio-subtext">
            Magic Wand uses tuned presets with a soft key prior. Viterbi uses a global decoder to
            stabilize slides and near-semitone wobble.
          </div>
        </div>
      )}

      {(mode === "melody" || mode === "dubler_melody") && (
        <div className="studio-field">
          <label>Detection Tuning</label>
          <label className="studio-toggle">
            <input
              type="checkbox"
              checked={useCustomTuning}
              onChange={(e) => setUseCustomTuning(e.target.checked)}
              disabled={isBusy}
            />
            Use custom tuning (override .env defaults)
          </label>
          <div className="studio-slider-block">
            <div className="studio-slider-label">
              Confidence: {tuneConf.toFixed(2)}
            </div>
            <input
              type="range"
              min="0.1"
              max="0.6"
              step="0.01"
              value={tuneConf}
              onChange={(e) => setTuneConf(Number(e.target.value))}
              disabled={isBusy || !useCustomTuning}
            />
          </div>
          <div className="studio-slider-block">
            <div className="studio-slider-label">Stable Frames: {tuneStable}</div>
            <input
              type="range"
              min="2"
              max="8"
              step="1"
              value={tuneStable}
              onChange={(e) => setTuneStable(Number(e.target.value))}
              disabled={isBusy || !useCustomTuning}
            />
          </div>
          <div className="studio-slider-block">
            <div className="studio-slider-label">Hangover Frames: {tuneHangover}</div>
            <input
              type="range"
              min="2"
              max="8"
              step="1"
              value={tuneHangover}
              onChange={(e) => setTuneHangover(Number(e.target.value))}
              disabled={isBusy || !useCustomTuning}
            />
          </div>
          <div className="studio-slider-block">
            <div className="studio-slider-label">
              Min Note (s): {tuneMinNote.toFixed(2)}
            </div>
            <input
              type="range"
              min="0.04"
              max="0.2"
              step="0.01"
              value={tuneMinNote}
              onChange={(e) => setTuneMinNote(Number(e.target.value))}
              disabled={isBusy || !useCustomTuning}
            />
          </div>
          <div className="studio-slider-block">
            <div className="studio-slider-label">
              Min Velocity: {tuneMinVelocity}
            </div>
            <input
              type="range"
              min="1"
              max="90"
              step="1"
              value={tuneMinVelocity}
              onChange={(e) => setTuneMinVelocity(Number(e.target.value))}
              disabled={isBusy || !useCustomTuning}
            />
          </div>
          <div className="studio-slider-block">
            <div className="studio-slider-label">Merge Gap (s): {tuneGap.toFixed(2)}</div>
            <input
              type="range"
              min="0.02"
              max="0.12"
              step="0.01"
              value={tuneGap}
              onChange={(e) => setTuneGap(Number(e.target.value))}
              disabled={isBusy || !useCustomTuning}
            />
          </div>
          <div className="studio-actions-row">
            <button
              className="studio-mini"
              disabled={isBusy || !useCustomTuning}
              onClick={() => {
                setTuneConf(0.35);
                setTuneStable(4);
                setTuneHangover(4);
                setTuneMinNote(0.08);
                setTuneMinVelocity(40);
                setTuneGap(0.06);
              }}
            >
              Reset Defaults
            </button>
          </div>
          {!useCustomTuning && (
            <div className="studio-subtext">Using built-in defaults from `.env`.</div>
          )}
        </div>
      )}

      {mode === "melody" && engineOverride === "ddsp" && (
        <label className="studio-toggle">
          <input
            type="checkbox"
            checked={ddspStrict}
            onChange={(e) => setDdspStrict(e.target.checked)}
            disabled={isBusy}
          />
          DDSP only (no fallback)
        </label>
      )}

      {mode === "dubler_melody" && (
        <label className="studio-toggle">
          <input
            type="checkbox"
            checked={enableFormants}
            onChange={(e) => setEnableFormants(e.target.checked)}
            disabled={isBusy}
          />
          Enable formant CC (expression)
        </label>
      )}

      {mode === "dubler_drums" && (
        <div className="studio-field">
          <label>Drum Calibration (optional)</label>
          <div className="studio-actions-row">
            {DRUM_CALIBRATION_LABELS.map((item) => (
              <button
                key={item.value}
                className={`studio-mini ${calibratingLabel === item.value ? "active" : ""}`}
                disabled={isBusy}
                onClick={() => beginRecording({ calibrateLabel: item.value, calibrateOnly: true })}
                title={`Record a ${item.label} sample for calibration`}
              >
                Calibrate {item.label}
              </button>
            ))}
          </div>
          <div className="studio-actions-row">
            <button
              className="studio-mini active"
              disabled={isBusy}
              onClick={() => setBeatboxWizardOpen(true)}
              title="Open guided Beatbox calibration wizard"
            >
              Open Calibration Wizard
            </button>
            <button
              className="studio-mini"
              disabled={isBusy}
              onClick={async () => {
                try {
                  await resetCalibration();
                  setCalibrationInfo({ reset: true });
                  setDrumTrainingInfo(null);
                } catch (err) {
                  setCalibrationInfo({ error: err?.message || "Failed to reset calibration" });
                }
              }}
              title="Clear saved drum calibration"
            >
              Reset Calibration
            </button>
            <button
              className="studio-mini"
              disabled={isBusy}
              onClick={async () => {
                setDrumTraining(true);
                setDrumTrainingInfo(null);
                try {
                  const result = await trainDrumModel();
                  setDrumTrainingInfo(result?.report || { error: "No training report returned" });
                } catch (err) {
                  setDrumTrainingInfo({
                    error: err?.message || "Failed to train drum model",
                  });
                } finally {
                  setDrumTraining(false);
                }
              }}
              title="Train drum model from currently saved calibration samples"
            >
              {drumTraining ? "Training..." : "Train Saved Samples"}
            </button>
          </div>
          <div className="studio-subtext">
            Guided wizard gives per-take quality feedback, retake prompts, and training readiness.
          </div>
          {calibratingLabel && (
            <div className="studio-subtext">
              Recording calibration: {calibratingLabel}. Press Stop when finished.
            </div>
          )}
          {calibrationInfo && (
            <div className="studio-subtext">
              {calibrationInfo.reset
                ? "Calibration cleared."
                  : calibrationInfo.error
                    ? `Calibration error: ${calibrationInfo.error}`
                    : `Saved ${calibrationInfo.label || "sample"} (total: ${calibrationInfo.total || 0})`}
            </div>
          )}
          {drumTrainingInfo && (
            <div className="studio-subtext">
              {drumTrainingInfo.error
                ? `Training error: ${drumTrainingInfo.error}`
                : drumTrainingInfo.status === "trained"
                  ? `Model trained (total: ${drumTrainingInfo.total || 0}).`
                  : drumTrainingInfo.status === "insufficient_samples"
                    ? `Need more samples to train (total: ${drumTrainingInfo.total || 0}).`
                    : drumTrainingInfo.status === "insufficient_labels"
                      ? "Need at least two labels to train."
                      : drumTrainingInfo.status === "training_failed"
                        ? "Training failed."
                        : `Training status: ${drumTrainingInfo.status || "unknown"}`}
            </div>
          )}
        </div>
      )}

      <div className="studio-actions-row">
        <button
          className="studio-btn"
          disabled={isBusy}
          onClick={() => beginRecording()}
        >
          Record
        </button>
        <button className="studio-btn ghost" disabled={!isRecording} onClick={stop}>
          Stop
        </button>
        <button
          className="studio-btn ghost"
          disabled={!isRecording}
          onClick={() => {
            const laneInfo = recordLaneRef.current;
            cancel();
            if (laneInfo.created && laneInfo.id) {
              actions.removeLane(laneInfo.id);
            }
            recordLaneRef.current = { id: null, created: false, name: null };
            setCalibratingLabel(null);
          }}
        >
          Cancel
        </button>
      </div>

      <div className="studio-meta-block">
        <div>Status: {status}</div>
        <div className="studio-progress">
          <div className="studio-progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      </div>

      {error && <div className="studio-empty">Error: {error}</div>}

      {beatboxWizardOpen &&
        createPortal(
          <div
            className="studio-midi-editor-backdrop"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (event.target === event.currentTarget) {
                setBeatboxWizardOpen(false);
              }
            }}
          >
            <div className="studio-beatbox-wizard-shell" onMouseDown={(event) => event.stopPropagation()}>
              <BeatboxCalibrationWizard
                embedded
                onClose={() => setBeatboxWizardOpen(false)}
                onTrained={(report) => {
                  setDrumTrainingInfo(report || null);
                }}
              />
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default VoiceToMidiPanel;
