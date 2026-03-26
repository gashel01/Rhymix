import React, { useCallback, useEffect, useMemo, useState } from "react";
import CreationDashboard from "./CreationDashboard";
import FoundationPanel from "./FoundationPanel";
import LiveInferencePanel from "./LiveInferencePanel";
import StageDrumsPanel from "./StageDrumsPanel";
import VoiceToMidiPanel from "./VoiceToMidiPanel";
import { requestGroqAutofill } from "../../utils/groqAutofill";
import { StudioAssistButton, StudioAssistSuggestion } from "./GroqAssist";

const SOUND_FONT_OPTIONS = [
  { value: "", label: "Use lane default" },
  { value: "acoustic_grand_piano", label: "Piano" },
  { value: "electric_guitar_clean", label: "Guitar (Clean)" },
  { value: "acoustic_bass", label: "Bass" },
  { value: "string_ensemble_1", label: "Strings" },
  { value: "synth_pad_1_new_age", label: "Synth Pad" },
  { value: "synth_drum", label: "Synth Drum" },
  { value: "choir_aahs", label: "Choir" },
  { value: "flute", label: "Flute" },
  { value: "alto_sax", label: "Sax" },
  { value: "trumpet", label: "Trumpet" },
];

const FOUNDATION_INSTRUMENT_OPTIONS = [
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

const FOUNDATION_KEY_NOTES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const FOUNDATION_KEY_SCALES = ["major", "minor"];

const JOB_LABELS = {
  understand: "Analyze",
  orchestrate_song: "AI Orchestrator",
  foundation_generate: "Foundation Generate",
  foundation_restyle: "Foundation Restyle",
  foundation_extend: "Foundation Extend",
  stage_drums_generate: "STAGE Drums",
  stem_extract: "Stem Extract",
  stem_extract_uvr: "UVR Stem Extract",
  render: "Export",
};

const JOB_TOOL_MAP = {
  understand: "analyze",
  foundation_generate: "foundation",
  foundation_restyle: "foundation",
  foundation_extend: "foundation",
  stage_drums_generate: "drums",
};

const DRAWER_TITLES = {
  clip: "More Clip Controls",
  lane: "Lane Controls & FX",
  project: "Project Settings",
  foundation: "Foundation",
  drums: "STAGE Drums",
  live: "Live Voice Conversion",
  voice: "Voice to MIDI",
};

const PANEL_CONTEXT = {
  RANGE: "range",
  MIDI: "midi",
  AUDIO: "audio",
  NOTHING: "nothing",
};

const resolveRightPanelContext = (selectedRange, selectedClip) => {
  if (selectedRange) return PANEL_CONTEXT.RANGE;
  if (selectedClip?.clipType === "midi") return PANEL_CONTEXT.MIDI;
  if (selectedClip) return PANEL_CONTEXT.AUDIO;
  return PANEL_CONTEXT.NOTHING;
};

const getVisibleAiCards = ({ resolvedRightPanelContext, canAnalyze, canGenerateDrums }) => {
  switch (resolvedRightPanelContext) {
    case PANEL_CONTEXT.RANGE:
      return [
        canAnalyze ? "analyze" : null,
        "foundation",
        canGenerateDrums ? "drums" : null,
      ].filter(Boolean);
    case PANEL_CONTEXT.MIDI:
      return [];
    case PANEL_CONTEXT.AUDIO:
      return [
        canAnalyze ? "analyze" : null,
        "foundation",
        canGenerateDrums ? "drums" : null,
      ].filter(Boolean);
    case PANEL_CONTEXT.NOTHING:
    default:
      return ["live", "foundation", "voice"];
  }
};

const normalizeRange = (range) => {
  if (!range) return null;
  const start = Math.min(Number(range.start ?? 0), Number(range.end ?? 0));
  const end = Math.max(Number(range.start ?? 0), Number(range.end ?? 0));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end };
};

const getClipBounds = (clip) => {
  const start = Number(clip?.timelineStartSec ?? 0);
  const duration = Math.max(0.01, Number(clip?.srcEndSec ?? 0) - Number(clip?.srcStartSec ?? 0));
  return { start, end: start + duration, duration };
};

const formatSeconds = (value) => `${(Number(value) || 0).toFixed(2)}s`;
const makeRandomSeed = () => Math.floor(Math.random() * 1000000000);
const parseKeyParts = (rawKey) => {
  const normalized = String(rawKey || "").trim().replace("-", " ").replace("_", " ");
  if (!normalized) return { note: "C", scale: "major" };
  const parts = normalized.split(/\s+/);
  const note = FOUNDATION_KEY_NOTES.includes(parts[0]) ? parts[0] : "C";
  const scale = parts.some((part) => part.toLowerCase().startsWith("min")) ? "minor" : "major";
  return { note, scale };
};
const formatKeyParts = (note, scale) => `${note || "C"} ${scale || "major"}`.trim();

const summarizeJob = (job) => {
  if (!job) return "No recent activity";
  const label = JOB_LABELS[job.type] || String(job.type || "job").replace(/_/g, " ");
  const detail = job.error || job.statusMessage || job.status || "idle";
  return `${label} · ${detail}`;
};

const nextStepForJob = (job) => {
  if (!job) return "";
  if (job.status === "failed") return "Open the tool, adjust the source or settings, then retry.";
  if (job.status === "completed") return "Review the new lane or refreshed timeline result.";
  if (job.status === "running") return "You can keep editing while this runs in the background.";
  if (job.status === "queued") return "The job is queued and will start automatically.";
  return "Check the activity list for details.";
};

const getActivityJobs = (jobs, filter) => {
  const list = [...(jobs || [])].reverse();
  if (filter === "active") {
    return list.filter((job) => !["completed", "failed", "cancelled"].includes(job.status));
  }
  if (filter === "errors") {
    return list.filter((job) => job.status === "failed");
  }
  return list;
};

const RightDrawer = ({ open, title, onClose, children }) => (
  <div className={`studio-right-drawer ${open ? "open" : ""}`}>
    <div className="studio-right-drawer-head">
      <div>
        <div className="studio-context-eyebrow">Advanced</div>
        <div className="studio-panel-title">{title}</div>
      </div>
      <button className="studio-btn ghost" onClick={onClose}>
        Close
      </button>
    </div>
    <div className="studio-right-drawer-body">{children}</div>
  </div>
);

const AiCard = ({
  id,
  title,
  summary,
  source,
  output,
  expanded,
  status,
  onToggle,
  children,
}) => (
  <div className={`studio-ai-card ${expanded ? "expanded" : ""}`}>
    <button className="studio-ai-card-head" onClick={() => onToggle(id)}>
      <div className="studio-ai-card-copy">
        <div className="studio-ai-card-title">{title}</div>
        <div className="studio-subtext">{summary}</div>
      </div>
      <div className="studio-ai-card-state">
        <span className="studio-context-chip subtle">{status}</span>
        <span className="studio-ai-card-chevron">{expanded ? "-" : "+"}</span>
      </div>
    </button>
    {expanded ? (
      <div className="studio-ai-card-body">
        <div className="studio-ai-card-meta">
          <div>
            <div className="studio-context-eyebrow">Source</div>
            <div className="studio-subtext">{source}</div>
          </div>
          <div>
            <div className="studio-context-eyebrow">Output</div>
            <div className="studio-subtext">{output}</div>
          </div>
        </div>
        {children}
      </div>
    ) : null}
  </div>
);

const StemActionsPanel = ({ sourceAssetId, compact = false, onStartAiJob }) => {
  if (!sourceAssetId) return null;
  const singleStemButtons = [
    { id: "vocal", label: "Extract Vocals" },
    { id: "drums", label: "Extract Drums" },
    { id: "bass", label: "Extract Bass" },
    { id: "other", label: "Extract Music" },
  ];

  return (
    <div className={compact ? "studio-meta-block studio-embedded-card" : "studio-meta-block"}>
      <div className="studio-panel-title">Stem Separation</div>
      <div className="studio-subtext" style={{ marginBottom: 8 }}>
        Pull out one part from the current audio, split the full mix into separate stems, or create an instrumental backing.
      </div>
      <div className="studio-subtext" style={{ marginBottom: 8 }}>
        Single stem: returns just the part you choose. Full split: creates vocals, drums, bass, and music as separate outputs.
      </div>
      <div className="studio-stems-row">
        {singleStemButtons.map((stem) => (
          <button
            key={stem.id}
            className="studio-mini"
            onClick={() =>
              onStartAiJob("stem_extract_uvr", {
                stem: stem.id,
                sourceAssetId,
              })
            }
          >
            {stem.label}
          </button>
        ))}
      </div>
      <div className="studio-actions-row">
        <button
          className="studio-btn accent"
          onClick={() => onStartAiJob("stem_extract_uvr", { sourceAssetId })}
        >
          Split Full Mix
        </button>
        <button
          className="studio-btn ghost"
          onClick={() => onStartAiJob("stem_extract", { sourceAssetId })}
        >
          Create Instrumental
        </button>
      </div>
    </div>
  );
};

const ClipAdvancedPanel = ({
  selectedClip,
  clipForm,
  setClipForm,
  selection,
  playheadTime,
  onMoveClip,
  onTrimLeft,
  onTrimRight,
  onSplit,
  onStartAiJob,
  onUpdateClip,
  foundationAudioClip,
  foundationMidiClip,
  onUpdateLane,
}) => {
  if (!selectedClip) {
    return <div className="studio-empty">Select a clip to reveal advanced clip controls.</div>;
  }
  return (
    <div className="studio-panel-content">
      <div className="studio-meta-block">
        <div className="studio-panel-title">Timing</div>
        <div className="studio-field">
          <label>Timeline Start (s)</label>
          <input
            type="number"
            step="0.1"
            value={clipForm.timelineStartSec}
            onChange={(e) => setClipForm((prev) => ({ ...prev, timelineStartSec: Number(e.target.value) }))}
          />
        </div>
        <div className="studio-actions-row">
          <button className="studio-btn ghost" onClick={() => onMoveClip(selectedClip.id, clipForm.timelineStartSec)}>
            Move
          </button>
          <button className="studio-btn ghost" onClick={() => onSplit(selectedClip.id, selection?.range?.start ?? playheadTime ?? 0)}>
            Split
          </button>
        </div>
      </div>

      <div className="studio-meta-block">
        <div className="studio-panel-title">Trim</div>
        <div className="studio-inline">
          <div className="studio-field">
            <label>Trim Left</label>
            <input
              type="number"
              step="0.1"
              value={clipForm.timelineStartSec}
              onChange={(e) => setClipForm((prev) => ({ ...prev, timelineStartSec: Number(e.target.value) }))}
            />
            <button className="studio-btn ghost" onClick={() => onTrimLeft(selectedClip.id, clipForm.timelineStartSec)}>
              Apply
            </button>
          </div>
          <div className="studio-field">
            <label>Trim Right</label>
            <input
              type="number"
              step="0.1"
              value={clipForm.srcEndSec}
              onChange={(e) => setClipForm((prev) => ({ ...prev, srcEndSec: Number(e.target.value) }))}
            />
            <button
              className="studio-btn ghost"
              onClick={() =>
                onTrimRight(
                  selectedClip.id,
                  (selectedClip.timelineStartSec ?? 0) + (clipForm.srcEndSec - (selectedClip.srcStartSec ?? 0))
                )
              }
            >
              Apply
            </button>
          </div>
        </div>
      </div>

      {selectedClip.clipType === "midi" ? (
        <div className="studio-meta-block">
          <div className="studio-panel-title">MIDI Sound</div>
          <div className="studio-field">
            <label>SoundFont</label>
            <select
              value={selectedClip.midi?.soundfont || ""}
              onChange={(e) => {
                const soundfont = e.target.value || null;
                onUpdateClip?.(selectedClip.id, { midi: { ...(selectedClip.midi || {}), soundfont } });
              }}
            >
              {SOUND_FONT_OPTIONS.map((opt) => (
                <option key={opt.value || "default"} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      <StemActionsPanel sourceAssetId={selectedClip.sourceAssetId} onStartAiJob={onStartAiJob} />

      {selectedClip.foundationPairId ? (
        <div className="studio-meta-block">
          <div className="studio-panel-title">Foundation Pair</div>
          <div className="studio-subtext" style={{ marginBottom: 8 }}>
            Audio and MIDI were generated together. Choose which lane stays active.
          </div>
          <div className="studio-actions-row">
            <button
              className="studio-btn ghost"
              disabled={!foundationAudioClip}
              onClick={() => {
                if (foundationAudioClip) onUpdateLane?.(foundationAudioClip.laneId, { mute: false, solo: false });
                if (foundationMidiClip) onUpdateLane?.(foundationMidiClip.laneId, { mute: true, solo: false });
              }}
            >
              Use Audio
            </button>
            <button
              className="studio-btn ghost"
              disabled={!foundationMidiClip}
              onClick={() => {
                if (foundationAudioClip) onUpdateLane?.(foundationAudioClip.laneId, { mute: true, solo: false });
                if (foundationMidiClip) onUpdateLane?.(foundationMidiClip.laneId, { mute: false, solo: false });
              }}
            >
              Use MIDI
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const LaneAdvancedPanel = ({ selectedLane, onUpdateLane }) => {
  if (!selectedLane) {
    return <div className="studio-empty">Select a lane to edit effects and routing.</div>;
  }
  const updateFx = (key, patch) => {
    const current = selectedLane.fx?.[key] || {};
    onUpdateLane?.(selectedLane.id, {
      fx: {
        ...(selectedLane.fx || {}),
        [key]: { ...current, ...patch },
      },
    });
  };
  const sections = [
    {
      key: "echo",
      title: "Echo",
      fields: [
        { key: "time", label: "Delay Time", min: 0.05, max: 1.5, step: 0.01, value: selectedLane.fx?.echo?.time ?? 0.25 },
        { key: "feedback", label: "Feedback", min: 0, max: 0.85, step: 0.01, value: selectedLane.fx?.echo?.feedback ?? 0.3 },
        { key: "mix", label: "Mix", min: 0, max: 1, step: 0.01, value: selectedLane.fx?.echo?.mix ?? 0.25 },
      ],
    },
    {
      key: "reverb",
      title: "Reverb",
      fields: [
        { key: "decay", label: "Decay", min: 0.5, max: 8, step: 0.1, value: selectedLane.fx?.reverb?.decay ?? 2.5 },
        { key: "mix", label: "Mix", min: 0, max: 1, step: 0.01, value: selectedLane.fx?.reverb?.mix ?? 0.25 },
      ],
    },
    {
      key: "distortion",
      title: "Distortion",
      fields: [
        { key: "drive", label: "Drive", min: 0, max: 100, step: 1, value: selectedLane.fx?.distortion?.drive ?? 20 },
      ],
    },
    {
      key: "chorus",
      title: "Chorus",
      fields: [
        { key: "rate", label: "Rate", min: 0.1, max: 5, step: 0.1, value: selectedLane.fx?.chorus?.rate ?? 0.8 },
        { key: "depth", label: "Depth", min: 0, max: 0.03, step: 0.001, value: selectedLane.fx?.chorus?.depth ?? 0.012 },
        { key: "mix", label: "Mix", min: 0, max: 1, step: 0.01, value: selectedLane.fx?.chorus?.mix ?? 0.3 },
      ],
    },
    {
      key: "lowpass",
      title: "Low-pass Filter",
      fields: [
        { key: "cutoff", label: "Cutoff (Hz)", min: 200, max: 20000, step: 10, value: selectedLane.fx?.lowpass?.cutoff ?? 12000 },
      ],
    },
  ];
  return (
    <div className="studio-panel-content">
      <div className="studio-meta-block">
        <div className="studio-panel-title">Lane Basics</div>
        <div className="studio-field">
          <label>Name</label>
          <input type="text" value={selectedLane.name || ""} onChange={(e) => onUpdateLane?.(selectedLane.id, { name: e.target.value })} />
        </div>
        <div className="studio-inline">
          <label className="studio-toggle">
            <input type="checkbox" checked={!!selectedLane.mute} onChange={(e) => onUpdateLane?.(selectedLane.id, { mute: e.target.checked })} />
            Mute
          </label>
          <label className="studio-toggle">
            <input type="checkbox" checked={!!selectedLane.solo} onChange={(e) => onUpdateLane?.(selectedLane.id, { solo: e.target.checked })} />
            Solo
          </label>
        </div>
        <div className="studio-field">
          <label>Gain ({selectedLane.gainDb ?? 0} dB)</label>
          <input type="range" min="-24" max="12" step="0.5" value={selectedLane.gainDb ?? 0} onChange={(e) => onUpdateLane?.(selectedLane.id, { gainDb: Number(e.target.value) })} />
        </div>
      </div>

      <div className="studio-meta-block">
        <div className="studio-panel-title">Pitch Shift</div>
        <div className="studio-field">
          <label>Semitones ({selectedLane.fx?.pitch?.semitones ?? 0})</label>
          <input type="range" min="-12" max="12" step="1" value={selectedLane.fx?.pitch?.semitones ?? 0} onChange={(e) => updateFx("pitch", { semitones: Number(e.target.value) })} />
        </div>
      </div>

      {sections.map((section) => (
        <div key={section.key} className="studio-meta-block">
          <div className="studio-panel-title">{section.title}</div>
          <label className="studio-toggle">
            <input
              type="checkbox"
              checked={!!selectedLane.fx?.[section.key]?.enabled}
              onChange={(e) => updateFx(section.key, { enabled: e.target.checked })}
            />
            Enable {section.title}
          </label>
          {section.fields.map((field) => (
            <div key={field.key} className="studio-field">
              <label>{field.label}</label>
              <input type="range" min={field.min} max={field.max} step={field.step} value={field.value} onChange={(e) => updateFx(section.key, { [field.key]: Number(e.target.value) })} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

const ProjectAdvancedPanel = ({ project, metadata, onUpdateProject }) => (
  <div className="studio-panel-content">
    <div className="studio-meta-block">
      <div className="studio-panel-title">Project Settings</div>
      <div className="studio-field">
        <label>Time Signature</label>
        <input type="text" value={project?.timeSignature || ""} placeholder="4/4" onChange={(e) => onUpdateProject?.({ timeSignature: e.target.value })} />
      </div>
      <div className="studio-field">
        <label>Transpose (semitones)</label>
        <input type="number" step="1" value={project?.transpose || 0} onChange={(e) => onUpdateProject?.({ transpose: Number(e.target.value) || 0 })} />
      </div>
    </div>

    <div className="studio-meta-block">
      <div className="studio-panel-title">Analysis Metadata</div>
      <div>BPM: {metadata?.understand?.bpm ?? "N/A"}</div>
      <div>Key: {metadata?.understand?.key ?? "N/A"}</div>
      <div>Time Signature: {metadata?.understand?.timeSignature ?? "N/A"}</div>
      <div>Caption: {metadata?.understand?.caption ?? "N/A"}</div>
    </div>

    <div className="studio-meta-block">
      <div className="studio-panel-title">Project Metadata</div>
      <div>LRC Segments: {metadata?.lrc?.segments?.length ?? 0}</div>
      <div>Quality Score: {metadata?.quality_score?.score ?? "N/A"}</div>
    </div>
  </div>
);

const Inspector = ({
  project,
  lanes,
  clips,
  selection,
  onSplit,
  onTrimLeft,
  onTrimRight,
  onMoveClip,
  onDeleteSelection,
  onDuplicateSelection,
  onStartAiJob,
  onUpdateLane,
  onUpdateClip,
  onUpdateProject,
  transport,
  studioActions,
  metadata,
  lyricsSelection,
  lyricsEntry,
  onUpdateLyricsText,
  playheadTime,
  onRefreshProject,
  activeWorkspaceLabel,
  jobs = [],
  uiState = {},
  createDashboard = null,
}) => {
  const selectedClip = useMemo(
    () => clips.find((clip) => selection?.clipIds?.[0] === clip.id) || null,
    [clips, selection]
  );
  const selectedLaneId = selection?.laneIds?.[0] || selectedClip?.laneId;
  const selectedLane = useMemo(
    () => lanes?.find((lane) => lane.id === selectedLaneId) || null,
    [lanes, selectedLaneId]
  );
  const selectedRange = useMemo(() => normalizeRange(selection?.range), [selection]);
  const selectedAudioClips = useMemo(() => {
    const explicitIds = Array.isArray(selection?.clipIds) ? selection.clipIds : [];
    const explicit = clips.filter((clip) => explicitIds.includes(clip.id) && clip.clipType !== "midi" && clip.sourceAssetId);
    if (explicit.length) return explicit;
    if (!selectedRange) return [];
    const laneIds = Array.isArray(selection?.laneIds) ? selection.laneIds : null;
    return clips.filter((clip) => {
      if (clip.clipType === "midi" || !clip.sourceAssetId) return false;
      if (laneIds?.length && !laneIds.includes(clip.laneId)) return false;
      const bounds = getClipBounds(clip);
      return selectedRange.end > bounds.start && selectedRange.start < bounds.end;
    });
  }, [clips, selection, selectedRange]);
  const analyzeClip = useMemo(() => {
    if (selectedClip?.sourceAssetId) return selectedClip;
    return selectedAudioClips[0] || clips.find((clip) => clip.clipType !== "midi" && clip.sourceAssetId) || null;
  }, [clips, selectedAudioClips, selectedClip]);
  const canAnalyze = Boolean(analyzeClip?.sourceAssetId);
  const analyzeRange = useMemo(() => {
    if (selectedRange) return selectedRange;
    if (analyzeClip) {
      const bounds = getClipBounds(analyzeClip);
      return { start: bounds.start, end: bounds.end };
    }
    return null;
  }, [analyzeClip, selectedRange]);
  const foundationPairClips = useMemo(() => {
    if (!selectedClip?.foundationPairId) return [];
    return clips.filter((clip) => clip.foundationPairId === selectedClip.foundationPairId);
  }, [clips, selectedClip]);
  const foundationAudioClip = useMemo(
    () => foundationPairClips.find((clip) => clip.clipType !== "midi") || null,
    [foundationPairClips]
  );
  const foundationMidiClip = useMemo(
    () => foundationPairClips.find((clip) => clip.clipType === "midi") || null,
    [foundationPairClips]
  );
  const drumRange = useMemo(() => {
    if (selectedRange) return selectedRange;
    if (!selectedAudioClips.length) return null;
    const starts = selectedAudioClips.map((clip) => getClipBounds(clip).start);
    const ends = selectedAudioClips.map((clip) => getClipBounds(clip).end);
    return { start: Math.min(...starts), end: Math.max(...ends) };
  }, [selectedAudioClips, selectedRange]);
  const canGenerateDrums = Boolean(selectedAudioClips.length && drumRange);
  const foundationRestyleClip = useMemo(() => {
    if (selectedClip?.clipType !== "midi" && selectedClip?.sourceAssetId) return selectedClip;
    return selectedAudioClips[0] || null;
  }, [selectedAudioClips, selectedClip]);
  const canFoundationRestyle = Boolean(foundationRestyleClip?.sourceAssetId && (selectedRange || foundationRestyleClip));

  const [clipForm, setClipForm] = useState({
    timelineStartSec: 0,
    srcEndSec: 0,
  });
  const [lyricsDraft, setLyricsDraft] = useState("");
  const [foundationPrompt, setFoundationPrompt] = useState("");
  const [foundationBars, setFoundationBars] = useState(4);
  const [foundationBpm, setFoundationBpm] = useState(project?.bpm || 120);
  const initialFoundationKey = parseKeyParts(project?.key || "");
  const [foundationKeyNote, setFoundationKeyNote] = useState(initialFoundationKey.note);
  const [foundationKeyScale, setFoundationKeyScale] = useState(initialFoundationKey.scale);
  const [foundationInstrumentFamily, setFoundationInstrumentFamily] = useState("Synth");
  const [foundationInitNoiseLevel, setFoundationInitNoiseLevel] = useState(0.55);
  const [drumPrompt, setDrumPrompt] = useState("");
  const [drumSeed, setDrumSeed] = useState(42);
  const [drumBpm, setDrumBpm] = useState(project?.bpm || 120);
  const [assistLoading, setAssistLoading] = useState({ foundationPrompt: false, drumPrompt: false });
  const [assistError, setAssistError] = useState({ foundationPrompt: "", drumPrompt: "" });
  const [assistSuggestion, setAssistSuggestion] = useState({ foundationPrompt: "", drumPrompt: "" });
  const [expandedAiCard, setExpandedAiCardState] = useState(uiState?.expandedAiCard || "analyze");
  const [drawerOpen, setDrawerOpenState] = useState(Boolean(uiState?.drawerOpen));
  const [drawerTool, setDrawerToolState] = useState(uiState?.drawerTool || "foundation");
  const [drawerMode, setDrawerMode] = useState("generate");
  const [activityFilter, setActivityFilterState] = useState(uiState?.activityFilter || "all");
  const [mountedDrawerTools, setMountedDrawerTools] = useState(() => [uiState?.drawerTool || "foundation"]);

  useEffect(() => {
    if (!selectedClip) return;
    setClipForm({
      timelineStartSec: selectedClip.timelineStartSec ?? 0,
      srcEndSec: selectedClip.srcEndSec ?? 0,
    });
  }, [selectedClip]);

  useEffect(() => {
    if (!lyricsSelection?.clip?.id) {
      setLyricsDraft("");
      return;
    }
    setLyricsDraft(lyricsEntry?.text || "");
  }, [
    lyricsSelection?.clip?.id,
    lyricsSelection?.range?.start,
    lyricsSelection?.range?.end,
    lyricsEntry?.text,
  ]);

  useEffect(() => {
    const nextKey = parseKeyParts(project?.key || "");
    setFoundationBpm(project?.bpm || 120);
    setFoundationKeyNote(nextKey.note);
    setFoundationKeyScale(nextKey.scale);
    setDrumBpm(project?.bpm || 120);
  }, [project?.bpm, project?.key]);

  const resolvedRightPanelContext = useMemo(
    () => resolveRightPanelContext(selectedRange, selectedClip),
    [selectedClip, selectedRange]
  );

  const visibleAiCards = useMemo(
    () =>
      getVisibleAiCards({
        resolvedRightPanelContext,
        canAnalyze,
        canGenerateDrums,
      }),
    [canAnalyze, canGenerateDrums, resolvedRightPanelContext]
  );

  const defaultExpandedAiCard = useMemo(() => {
    switch (resolvedRightPanelContext) {
      case PANEL_CONTEXT.RANGE:
        return canAnalyze ? "analyze" : "foundation";
      case PANEL_CONTEXT.MIDI:
        return "voice";
      case PANEL_CONTEXT.AUDIO: {
        const bounds = selectedClip ? getClipBounds(selectedClip) : null;
        if (bounds?.duration && bounds.duration <= 8 && canAnalyze) return "analyze";
        return "foundation";
      }
      case PANEL_CONTEXT.NOTHING:
      default:
        return "live";
    }
  }, [canAnalyze, resolvedRightPanelContext, selectedClip]);

  const visibleAiCardSet = useMemo(() => new Set(visibleAiCards), [visibleAiCards]);

  useEffect(() => {
    setExpandedAiCardState(defaultExpandedAiCard);
  }, [defaultExpandedAiCard]);

  useEffect(() => {
    if (uiState?.activityFilter) {
      setActivityFilterState(uiState.activityFilter);
    }
  }, [uiState?.activityFilter]);

  useEffect(() => {
    if (uiState?.drawerTool) {
      setDrawerToolState(uiState.drawerTool);
    }
  }, [uiState?.drawerTool]);

  const setInspectorUi = (patch) => studioActions?.setUi?.(patch);

  useEffect(() => {
    setInspectorUi({ rightPanelContext: resolvedRightPanelContext });
  }, [resolvedRightPanelContext]);

  useEffect(() => {
    setInspectorUi({
      expandedAiCard,
      drawerOpen,
      drawerTool,
      activityFilter,
    });
  }, [activityFilter, drawerOpen, drawerTool, expandedAiCard]);

  const openDrawer = (tool, nextMode = null) => {
    setDrawerToolState(tool);
    setDrawerOpenState(true);
    if (nextMode) setDrawerMode(nextMode);
    setMountedDrawerTools((prev) => (prev.includes(tool) ? prev : [...prev, tool]));
  };

  const closeDrawer = () => setDrawerOpenState(false);

  const selectionSummary = useMemo(() => {
    if (resolvedRightPanelContext === PANEL_CONTEXT.AUDIO && selectedClip) {
      const bounds = getClipBounds(selectedClip);
      return {
        title: selectedClip.label || selectedClip.name || selectedClip.id,
        subtitle: `Audio clip · ${formatSeconds(bounds.duration)} · lane ${selectedClip.laneId}`,
      };
    }
    if (resolvedRightPanelContext === PANEL_CONTEXT.MIDI && selectedClip) {
      const bounds = getClipBounds(selectedClip);
      return {
        title: selectedClip.label || selectedClip.name || selectedClip.id,
        subtitle: `MIDI clip · ${formatSeconds(bounds.duration)} · lane ${selectedClip.laneId}`,
      };
    }
    if (resolvedRightPanelContext === PANEL_CONTEXT.RANGE && selectedRange) {
      const laneCount = Array.isArray(selection?.laneIds) && selection.laneIds.length ? selection.laneIds.length : lanes.length;
      return {
        title: "Selected Range",
        subtitle: `${formatSeconds(selectedRange.start)} to ${formatSeconds(selectedRange.end)} across ${laneCount} lane(s) · ${selectedAudioClips.length} audio source(s) resolved`,
      };
    }
    return {
      title: project?.name || "Project",
      subtitle: `No active source · ${project?.bpm || 120} BPM · ${project?.key || "Key unset"} · ${project?.timeSignature || "4/4"}`,
    };
  }, [lanes.length, project, resolvedRightPanelContext, selectedAudioClips.length, selectedClip, selectedRange, selection?.laneIds]);

  const runAnalyzeQuick = () => {
    if (!canAnalyze || !analyzeRange) return;
    onStartAiJob("understand", {
      startSec: analyzeRange.start,
      endSec: analyzeRange.end,
    });
  };

  const quickActions = useMemo(() => {
    if ((resolvedRightPanelContext === PANEL_CONTEXT.AUDIO || resolvedRightPanelContext === PANEL_CONTEXT.MIDI) && selectedClip) {
      return [
        {
          id: "split",
          label: "Split",
          onClick: () => onSplit(selectedClip.id, selectedRange?.start ?? playheadTime ?? 0),
        },
        {
          id: "duplicate",
          label: "Duplicate",
          onClick: () => {
            const bounds = getClipBounds(selectedClip);
            onDuplicateSelection(
              selection?.range || { start: bounds.start, end: bounds.end },
              selection?.laneIds || [selectedClip.laneId],
              selection?.range?.end ?? bounds.end
            );
          },
        },
        {
          id: "delete",
          label: "Delete",
          variant: "ghost danger",
          onClick: () => onDeleteSelection(selection?.range, selection?.laneIds, [selectedClip.id]),
        },
      ];
    }
    if (resolvedRightPanelContext === PANEL_CONTEXT.RANGE && selectedRange) {
      return [
        {
          id: "analyze",
          label: "Analyze",
          onClick: () => {
            setExpandedAiCardState("analyze");
            runAnalyzeQuick();
          },
        },
        {
          id: "duplicate-range",
          label: "Duplicate",
          onClick: () => onDuplicateSelection(selection?.range, selection?.laneIds, selection?.range?.end ?? 0),
        },
        {
          id: "clear",
          label: "Clear",
          variant: "ghost",
          onClick: () => studioActions?.setSelection?.({ range: null, laneIds: null, clipIds: [] }),
        },
      ];
    }
    return [
      {
        id: "project-controls",
        label: "Project Settings",
        onClick: () => openDrawer("project"),
      },
      {
        id: "foundation",
        label: "Foundation",
        variant: "ghost",
        onClick: () => openDrawer("foundation", "generate"),
      },
      {
        id: "live",
        label: "Live VC",
        variant: "ghost",
        onClick: () => openDrawer("live"),
      },
    ];
  }, [
    onDeleteSelection,
    onDuplicateSelection,
    onSplit,
    playheadTime,
    resolvedRightPanelContext,
    runAnalyzeQuick,
    selectedClip,
    selectedRange,
    selection,
    studioActions,
  ]);

  const relevantJobs = useMemo(() => getActivityJobs(jobs, activityFilter).slice(0, 5), [activityFilter, jobs]);
  const latestAnalyzeJob = useMemo(() => [...jobs].reverse().find((job) => job.type === "understand") || null, [jobs]);
  const latestFoundationJob = useMemo(() => [...jobs].reverse().find((job) => String(job.type || "").startsWith("foundation_")) || null, [jobs]);
  const latestDrumsJob = useMemo(() => [...jobs].reverse().find((job) => job.type === "stage_drums_generate") || null, [jobs]);

  const runFoundationQuick = (mode) => {
    const prompt = foundationPrompt.trim();
    const bpm = Number(foundationBpm) || project?.bpm || 120;
    const key = formatKeyParts(foundationKeyNote, foundationKeyScale);
    const instrumentFamily = foundationInstrumentFamily.trim();
    if (mode === "generate") {
      onStartAiJob("foundation_generate", {
        prompt,
        bars: foundationBars,
        bpm,
        key,
        instrumentFamily,
        insertSec: Number(transport?.currentTime ?? 0),
        timelineStartSec: Number(transport?.currentTime ?? 0),
      });
      return;
    }
    if (!canFoundationRestyle || !foundationRestyleClip) return;
    const baseRange = selectedRange || {
      start: foundationRestyleClip.timelineStartSec ?? 0,
      end: (foundationRestyleClip.timelineStartSec ?? 0) + getClipBounds(foundationRestyleClip).duration,
    };
    onStartAiJob("foundation_restyle", {
      prompt,
      bars: foundationBars,
      bpm,
      key,
      instrumentFamily,
      initNoiseLevel: Math.max(0, Math.min(1, Number(foundationInitNoiseLevel) || 0.55)),
      clipId: foundationRestyleClip.id,
      startSec: baseRange.start,
      endSec: baseRange.end,
      insertSec: baseRange.start,
      timelineStartSec: baseRange.start,
    });
  };

  const runDrumQuick = () => {
    if (!canGenerateDrums || !drumRange) return;
    onStartAiJob("stage_drums_generate", {
      clipIds: selectedAudioClips.map((clip) => clip.id),
      laneIds: Array.isArray(selection?.laneIds) ? selection.laneIds : undefined,
      startSec: drumRange.start,
      endSec: drumRange.end,
      timelineStartSec: drumRange.start,
      insertSec: drumRange.start,
      durationSec: Math.max(0.5, drumRange.end - drumRange.start),
      prompt: drumPrompt.trim(),
      seed: Number.isFinite(Number(drumSeed)) ? Number(drumSeed) : 42,
      bpm: Number(drumBpm) || project?.bpm || 120,
      label: "STAGE Drums",
    });
  };

  const runAssist = useCallback(async (slot, task, context) => {
    setAssistLoading((prev) => ({ ...prev, [slot]: true }));
    setAssistError((prev) => ({ ...prev, [slot]: "" }));
    setAssistSuggestion((prev) => ({ ...prev, [slot]: "" }));
    try {
      const data = await requestGroqAutofill(task, context);
      const suggestion = data?.suggestion?.prompt || "";
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

  const requestFoundationPromptAssist = useCallback(() => {
    const isRestyleContext =
      resolvedRightPanelContext === PANEL_CONTEXT.RANGE || resolvedRightPanelContext === PANEL_CONTEXT.AUDIO;
    const sourceSummary = isRestyleContext
      ? (selectedRange
        ? `${formatSeconds(selectedRange.start)} to ${formatSeconds(selectedRange.end)} across ${selection?.laneIds?.length || lanes.length} lane(s)`
        : foundationRestyleClip?.sourceAssetId
          ? `${foundationRestyleClip.sourceAssetId} around ${formatSeconds(foundationRestyleClip.timelineStartSec ?? 0)}`
          : "Selected audio source")
      : "No active source";
    runAssist(
      "foundationPrompt",
      isRestyleContext ? "studio_foundation_restyle_prompt" : "studio_foundation_generate_prompt",
      {
        mode: isRestyleContext ? "restyle" : "generate",
        prompt: foundationPrompt,
        bars: foundationBars,
        bpm: foundationBpm,
        key: formatKeyParts(foundationKeyNote, foundationKeyScale),
        instrumentFamily: foundationInstrumentFamily,
        sourceSummary,
      }
    );
  }, [
    foundationBars,
    foundationBpm,
    foundationInstrumentFamily,
    foundationKeyNote,
    foundationKeyScale,
    foundationPrompt,
    foundationRestyleClip,
    lanes.length,
    resolvedRightPanelContext,
    runAssist,
    selectedRange,
    selection?.laneIds,
  ]);

  const requestDrumPromptAssist = useCallback(() => {
    const sourceSummary =
      canGenerateDrums && drumRange
        ? `${selectedAudioClips.length} source clip(s) from ${formatSeconds(drumRange.start)} to ${formatSeconds(drumRange.end)}`
        : "Selected melodic source";
    runAssist("drumPrompt", "studio_stage_drums_prompt", {
      prompt: drumPrompt,
      bpm: drumBpm,
      sourceSummary,
    });
  }, [canGenerateDrums, drumBpm, drumPrompt, drumRange, runAssist, selectedAudioClips.length]);

  return (
    <div className="studio-inspector-shell">
      <div className="studio-inspector studio-inspector-redesigned">
        <div className="studio-inspector-sticky">
          <div className="studio-context-eyebrow">{activeWorkspaceLabel || "Studio"}</div>
          <div className="studio-inspector-topline">
            <div>
              <div className="studio-panel-title">{selectionSummary.title}</div>
              <div className="studio-subtext">{selectionSummary.subtitle}</div>
            </div>
            <div className="studio-context-chip">{resolvedRightPanelContext}</div>
          </div>
          <div className="studio-actions-row">
            {quickActions.map((action) => (
              <button
                key={action.id}
                className={`studio-btn ${action.variant || "ghost"}`}
                onClick={action.onClick}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
        <div className="studio-panel-content studio-right-panel-scroll">
          <div className="studio-meta-block">
            <div className="studio-panel-title">Selection Summary</div>
            <div className="studio-subtext">{selectionSummary.subtitle}</div>
            {resolvedRightPanelContext === PANEL_CONTEXT.NOTHING ? (
              <div className="studio-empty" style={{ marginTop: 10 }}>
                No active source. Record with Live VC, capture Voice to MIDI, generate with Foundation, or select a clip to unlock source-based tools.
              </div>
            ) : null}
            {!selectedClip && !selectedRange && !clips.length ? (
              <div className="studio-empty" style={{ marginTop: 10 }}>
                No clips yet. Use the create tools below or add material to start shaping the session.
              </div>
            ) : null}
          </div>

          {resolvedRightPanelContext === PANEL_CONTEXT.NOTHING && createDashboard ? (
            <div className="studio-meta-block">
              <CreationDashboard
                createMode={createDashboard.createMode}
                setCreateMode={createDashboard.setCreateMode}
                lyrics={createDashboard.lyrics}
                setLyrics={createDashboard.setLyrics}
                style={createDashboard.style}
                setStyle={createDashboard.setStyle}
                model={createDashboard.model}
                setModel={createDashboard.setModel}
                createPrompt={createDashboard.createPrompt}
                handleStartJob={createDashboard.handleStartJob}
                onOpenOrchestrator={createDashboard.onOpenOrchestrator}
                embedded
              />
            </div>
          ) : null}

          <div className="studio-meta-block">
            <div className="studio-panel-title">Relevant Controls</div>
            {selectedLane ? (
              <div className="studio-meta-block studio-embedded-card">
                <div className="studio-panel-title">Lane Controls & FX</div>
                <div className="studio-subtext" style={{ marginBottom: 8 }}>
                  {selectedLane.name || "Selected lane"} · adjust gain, mute/solo, pitch, delay, reverb, filters, and other lane effects.
                </div>
                <div className="studio-actions-row">
                  <button className="studio-btn ghost" onClick={() => openDrawer("lane")}>
                    Open Lane FX
                  </button>
                </div>
              </div>
            ) : null}
            {resolvedRightPanelContext === PANEL_CONTEXT.AUDIO && selectedClip ? (
              <>
                {selectedClip.foundationPairId ? (
                  <div className="studio-meta-block studio-embedded-card">
                    <div className="studio-panel-title">Generated Pair</div>
                    <div className="studio-subtext" style={{ marginBottom: 8 }}>
                      Keep the audio version active, or switch to the linked MIDI version.
                    </div>
                    <div className="studio-actions-row">
                      <button
                        className="studio-btn ghost"
                        disabled={!foundationAudioClip}
                        onClick={() => {
                          if (foundationAudioClip) onUpdateLane?.(foundationAudioClip.laneId, { mute: false, solo: false });
                          if (foundationMidiClip) onUpdateLane?.(foundationMidiClip.laneId, { mute: true, solo: false });
                        }}
                      >
                        Use Audio
                      </button>
                      <button
                        className="studio-btn ghost"
                        disabled={!foundationMidiClip}
                        onClick={() => {
                          if (foundationAudioClip) onUpdateLane?.(foundationAudioClip.laneId, { mute: true, solo: false });
                          if (foundationMidiClip) onUpdateLane?.(foundationMidiClip.laneId, { mute: false, solo: false });
                        }}
                      >
                        Use MIDI
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="studio-actions-row">
                  <button className="studio-btn ghost" onClick={() => openDrawer("clip")}>
                    More Clip Controls
                  </button>
                </div>
                <StemActionsPanel compact sourceAssetId={selectedClip.sourceAssetId} onStartAiJob={onStartAiJob} />
              </>
            ) : resolvedRightPanelContext === PANEL_CONTEXT.MIDI && selectedClip ? (
              <>
                {selectedClip.foundationPairId ? (
                  <div className="studio-meta-block studio-embedded-card">
                    <div className="studio-panel-title">Generated Pair</div>
                    <div className="studio-subtext" style={{ marginBottom: 8 }}>
                      This MIDI clip is linked to a generated audio version. Choose which one stays active.
                    </div>
                    <div className="studio-actions-row">
                      <button
                        className="studio-btn ghost"
                        disabled={!foundationAudioClip}
                        onClick={() => {
                          if (foundationAudioClip) onUpdateLane?.(foundationAudioClip.laneId, { mute: false, solo: false });
                          if (foundationMidiClip) onUpdateLane?.(foundationMidiClip.laneId, { mute: true, solo: false });
                        }}
                      >
                        Use Audio
                      </button>
                      <button
                        className="studio-btn ghost"
                        disabled={!foundationMidiClip}
                        onClick={() => {
                          if (foundationAudioClip) onUpdateLane?.(foundationAudioClip.laneId, { mute: true, solo: false });
                          if (foundationMidiClip) onUpdateLane?.(foundationMidiClip.laneId, { mute: false, solo: false });
                        }}
                      >
                        Use MIDI
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="studio-field">
                  <label>Sound</label>
                  <select
                    value={selectedClip.midi?.soundfont || ""}
                    onChange={(e) => {
                      const soundfont = e.target.value || null;
                      onUpdateClip?.(selectedClip.id, { midi: { ...(selectedClip.midi || {}), soundfont } });
                    }}
                  >
                    {SOUND_FONT_OPTIONS.map((opt) => (
                      <option key={opt.value || "default"} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="studio-actions-row">
                  <button className="studio-btn ghost" onClick={() => openDrawer("clip")}>
                    More Clip Controls
                  </button>
                </div>
              </>
            ) : resolvedRightPanelContext === PANEL_CONTEXT.RANGE ? (
              <>
                <div className="studio-subtext">
                  Selected range: {formatSeconds(selectedRange?.start)} to {formatSeconds(selectedRange?.end)} across{" "}
                  {Array.isArray(selection?.laneIds) && selection.laneIds.length ? selection.laneIds.length : lanes.length} lane(s).
                </div>
                <div className="studio-subtext">
                  Resolved audio sources: {selectedAudioClips.length}. Use Analyze, Foundation Restyle, or Drums based on this range.
                </div>
                {!selectedAudioClips.length ? (
                  <div className="studio-empty" style={{ marginTop: 10 }}>
                    This range has no audio source to analyze or restyle yet. Generate material or pick a range over audio.
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className="studio-inline">
                  <div className="studio-field">
                    <label>BPM</label>
                    <input
                      type="number"
                      min="40"
                      max="240"
                      step="1"
                      value={project?.bpm ?? 120}
                      onChange={(e) => {
                        const bpm = Math.max(40, Math.min(240, Number(e.target.value) || 120));
                        onUpdateProject?.({ bpm });
                      }}
                    />
                  </div>
                  <div className="studio-field">
                    <label>Key</label>
                    <input
                      type="text"
                      value={project?.key || ""}
                      placeholder="C minor"
                      onChange={(e) => onUpdateProject?.({ key: e.target.value })}
                    />
                  </div>
                </div>
                <div className="studio-actions-row">
                  <button className="studio-btn ghost" onClick={() => openDrawer("project")}>
                    More Project Controls
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="studio-meta-block">
            <div className="studio-panel-title">AI Tools</div>
            <div className="studio-subtext" style={{ marginBottom: 10 }}>
              Start with the most likely tool for the current context. Open the drawer when you need deeper settings.
            </div>
            {!visibleAiCards.length ? (
              <div className="studio-empty">
                No AI tools are shown for this selection. Clear the selection or pick audio to unlock source-based workflows.
              </div>
            ) : null}

            {visibleAiCardSet.has("analyze") ? (
              <AiCard
                id="analyze"
                title="Analyze"
                summary="Detect BPM, key, and inspect the current selection."
                source={canAnalyze && analyzeRange ? `Using current selection · ${formatSeconds(analyzeRange.start)} to ${formatSeconds(analyzeRange.end)}` : "Select an audio clip or range first."}
                output="Project BPM, key, time signature metadata"
                expanded={expandedAiCard === "analyze"}
                status={summarizeJob(latestAnalyzeJob)}
                onToggle={setExpandedAiCardState}
              >
                <div className="studio-subtext">
                  Analyze always uses the current timeline selection. Select a range for targeted analysis, or select an audio clip to analyze its full bounds.
                </div>
                {lyricsSelection ? (
                  <div className="studio-field">
                    <label>Lyrics Replacement</label>
                    <textarea
                      value={lyricsDraft}
                      onChange={(e) => {
                        const next = e.target.value;
                        setLyricsDraft(next);
                        onUpdateLyricsText?.(lyricsSelection.clip.id, next, {
                          range: lyricsSelection.range,
                          rangeClip: lyricsEntry?.rangeClip || null,
                        });
                      }}
                      rows={4}
                      placeholder="Transcription appears here when you transcribe a vocal range."
                    />
                  </div>
                ) : null}
                <div className="studio-actions-row">
                  <button
                    className="studio-btn accent"
                    disabled={!canAnalyze}
                    onClick={runAnalyzeQuick}
                  >
                    Analyze
                  </button>
                </div>
              </AiCard>
            ) : null}

            {visibleAiCardSet.has("foundation") ? (
              <AiCard
                id="foundation"
                title="Foundation"
                summary="Generate a new loop or restyle the current selection into paired audio and MIDI."
                source={canFoundationRestyle ? `Selection ready · ${formatSeconds((selectedRange || { start: foundationRestyleClip?.timelineStartSec ?? 0 }).start)} onward` : "Generate works without a source. Restyle needs an audio clip or range."}
                output="Fresh audio lane plus paired MIDI lane"
                expanded={expandedAiCard === "foundation"}
                status={summarizeJob(latestFoundationJob)}
                onToggle={setExpandedAiCardState}
              >
                <div className="studio-field">
                  <div className="studio-field-head">
                    <label>Prompt</label>
                    <StudioAssistButton
                      onRequest={requestFoundationPromptAssist}
                      loading={assistLoading.foundationPrompt}
                    />
                  </div>
                  <textarea value={foundationPrompt} onChange={(e) => setFoundationPrompt(e.target.value)} rows={3} />
                  <StudioAssistSuggestion
                    value={assistSuggestion.foundationPrompt}
                    error={assistError.foundationPrompt}
                    onUse={() => {
                      if (!assistSuggestion.foundationPrompt) return;
                      setFoundationPrompt(assistSuggestion.foundationPrompt);
                      clearAssist("foundationPrompt");
                    }}
                    onCancel={() => clearAssist("foundationPrompt")}
                  />
                </div>
                <div className="studio-inline">
                  <div className="studio-field">
                    <label>Bars</label>
                    <select value={foundationBars} onChange={(e) => setFoundationBars(Number(e.target.value) || 4)}>
                      <option value={4}>4</option>
                      <option value={8}>8</option>
                    </select>
                  </div>
                  <div className="studio-field">
                    <label>BPM</label>
                    <input type="number" min="40" max="240" step="1" value={foundationBpm} onChange={(e) => setFoundationBpm(Number(e.target.value) || 120)} />
                  </div>
                </div>
                <div className="studio-field">
                  <label>Instrument Family</label>
                  <select value={foundationInstrumentFamily} onChange={(e) => setFoundationInstrumentFamily(e.target.value)}>
                    {FOUNDATION_INSTRUMENT_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="studio-inline">
                  <div className="studio-field">
                    <label>Key</label>
                    <select value={foundationKeyNote} onChange={(e) => setFoundationKeyNote(e.target.value)}>
                      {FOUNDATION_KEY_NOTES.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="studio-field">
                    <label>Scale</label>
                    <select value={foundationKeyScale} onChange={(e) => setFoundationKeyScale(e.target.value)}>
                      {FOUNDATION_KEY_SCALES.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {(resolvedRightPanelContext === PANEL_CONTEXT.RANGE || resolvedRightPanelContext === PANEL_CONTEXT.AUDIO) ? (
                  <div className="studio-field">
                    <label>Restyle Noise</label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={foundationInitNoiseLevel}
                      onChange={(e) => setFoundationInitNoiseLevel(Number(e.target.value) || 0)}
                    />
                    <div className="studio-subtext">Noise level: {Number(foundationInitNoiseLevel).toFixed(2)}</div>
                  </div>
                ) : null}
                <div className="studio-actions-row">
                  <button className="studio-btn accent" onClick={() => runFoundationQuick("generate")}>
                    Generate Loop
                  </button>
                  {(resolvedRightPanelContext === PANEL_CONTEXT.RANGE || resolvedRightPanelContext === PANEL_CONTEXT.AUDIO) && canFoundationRestyle ? (
                    <button className="studio-btn ghost" onClick={() => runFoundationQuick("restyle")}>
                      Restyle Selection
                    </button>
                  ) : null}
                  <button
                    className="studio-btn ghost"
                    onClick={() =>
                      openDrawer(
                        "foundation",
                        resolvedRightPanelContext === PANEL_CONTEXT.NOTHING || !canFoundationRestyle ? "generate" : "restyle"
                      )
                    }
                  >
                    Advanced
                  </button>
                </div>
              </AiCard>
            ) : null}

            {visibleAiCardSet.has("drums") ? (
              <AiCard
                id="drums"
                title="Drums"
                summary="Create a drum stem from one or more overlapping audio clips."
                source={canGenerateDrums && drumRange ? `${selectedAudioClips.length} source clip(s) · ${formatSeconds(drumRange.start)} to ${formatSeconds(drumRange.end)}` : "Select one or more audio clips or a range over audio."}
                output="New generated drum lane aligned to the source range"
                expanded={expandedAiCard === "drums"}
                status={summarizeJob(latestDrumsJob)}
                onToggle={setExpandedAiCardState}
              >
                <div className="studio-field">
                  <div className="studio-field-head">
                    <label>Description</label>
                    <StudioAssistButton
                      onRequest={requestDrumPromptAssist}
                      loading={assistLoading.drumPrompt}
                    />
                  </div>
                  <textarea
                    rows={3}
                    value={drumPrompt}
                    onChange={(e) => setDrumPrompt(e.target.value)}
                    placeholder="Punchy modern drums, tight kick, crisp snare, energetic hats"
                  />
                  <StudioAssistSuggestion
                    value={assistSuggestion.drumPrompt}
                    error={assistError.drumPrompt}
                    onUse={() => {
                      if (!assistSuggestion.drumPrompt) return;
                      setDrumPrompt(assistSuggestion.drumPrompt);
                      clearAssist("drumPrompt");
                    }}
                    onCancel={() => clearAssist("drumPrompt")}
                  />
                </div>
                <div className="studio-inline">
                  <div className="studio-field">
                    <label>BPM</label>
                    <input type="number" min="40" max="240" step="1" value={drumBpm} onChange={(e) => setDrumBpm(Number(e.target.value) || 120)} />
                  </div>
                  <div className="studio-field">
                    <div className="studio-field-head">
                      <label>Seed</label>
                      <button className="studio-mini" type="button" onClick={() => setDrumSeed(makeRandomSeed())}>
                        Randomize
                      </button>
                    </div>
                    <input type="number" step="1" value={drumSeed} onChange={(e) => setDrumSeed(Number(e.target.value) || 42)} />
                  </div>
                </div>
                <div className="studio-actions-row">
                  <button className="studio-btn accent" disabled={!canGenerateDrums} onClick={runDrumQuick}>
                    Generate Drums
                  </button>
                  <button className="studio-btn ghost" onClick={() => openDrawer("drums")}>
                    Advanced
                  </button>
                </div>
              </AiCard>
            ) : null}

            {visibleAiCardSet.has("live") ? (
              <AiCard
                id="live"
                title="Live VC"
                summary="Record through a trained model, monitor live, and commit the offline render."
                source={`Insert at playhead ${formatSeconds(transport?.currentTime ?? 0)}`}
                output="Converted take inserted into the timeline"
                expanded={expandedAiCard === "live"}
                status="Record-ready"
                onToggle={setExpandedAiCardState}
              >
                <div className="studio-subtext">
                  Use the drawer to choose the model, monitoring, and detailed live inference settings before recording.
                </div>
                <div className="studio-actions-row">
                  <button className="studio-btn accent" onClick={() => openDrawer("live")}>
                    Open Live VC
                  </button>
                  <button className="studio-btn ghost" onClick={() => openDrawer("live")}>
                    Advanced
                  </button>
                </div>
              </AiCard>
            ) : null}

            {visibleAiCardSet.has("voice") ? (
              <AiCard
                id="voice"
                title="Voice to MIDI"
                summary="Capture melody or beatbox input and insert an editable MIDI clip."
                source={`Start at playhead ${formatSeconds(transport?.currentTime ?? 0)}`}
                output="New MIDI clip on a target lane"
                expanded={expandedAiCard === "voice"}
                status="Ready"
                onToggle={setExpandedAiCardState}
              >
                <div className="studio-subtext">
                  Record and transcribe through the dedicated Voice to MIDI tool. Drum and beatbox capture stay there as well.
                </div>
                <div className="studio-actions-row">
                  <button className="studio-btn accent" onClick={() => openDrawer("voice")}>
                    Open Voice to MIDI
                  </button>
                  <button className="studio-btn ghost" onClick={() => openDrawer("voice")}>
                    Advanced
                  </button>
                </div>
              </AiCard>
            ) : null}
          </div>

          <div className="studio-meta-block">
            <div className="studio-panel-title">Activity / Recent Results</div>
            <div className="studio-actions-row">
              {[
                { id: "all", label: "All" },
                { id: "active", label: "Active" },
                { id: "errors", label: "Errors" },
              ].map((item) => (
                <button
                  key={item.id}
                  className={`studio-mini ${activityFilter === item.id ? "active" : ""}`}
                  onClick={() => setActivityFilterState(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {relevantJobs.length ? (
              <div className="studio-activity-list">
                {relevantJobs.map((job) => (
                  <div key={job.id} className={`studio-activity-item ${job.status || "idle"}`}>
                    <div className="studio-activity-copy">
                      <div className="studio-activity-title">{JOB_LABELS[job.type] || job.type}</div>
                      <div className="studio-subtext">{job.error || job.statusMessage || job.status}</div>
                      <div className="studio-subtext">{nextStepForJob(job)}</div>
                      <div className="studio-progress">
                        <div className="studio-progress-bar" style={{ width: `${Math.max(0, Math.min(100, job.progress ?? 0))}%` }} />
                      </div>
                    </div>
                    <div className="studio-activity-actions">
                      {JOB_TOOL_MAP[job.type] && visibleAiCardSet.has(JOB_TOOL_MAP[job.type]) ? (
                        <button className="studio-mini" onClick={() => setExpandedAiCardState(JOB_TOOL_MAP[job.type])}>
                          Open Tool
                        </button>
                      ) : null}
                      <button className="studio-mini" onClick={() => onRefreshProject?.(project?.id)}>
                        Refresh
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="studio-empty">No activity for this filter yet.</div>
            )}
          </div>
        </div>

        <RightDrawer
          open={drawerOpen}
          title={drawerTool === "foundation" ? `${DRAWER_TITLES[drawerTool]} · ${drawerMode === "restyle" ? "Restyle" : drawerMode === "voice_to_midi" ? "Voice to MIDI" : "Generate"}` : DRAWER_TITLES[drawerTool] || "Advanced"}
          onClose={closeDrawer}
        >
          {mountedDrawerTools.map((tool) => (
            <div key={tool} className={`studio-drawer-pane ${drawerTool === tool && drawerOpen ? "active" : ""}`}>
              {tool === "clip" ? (
                <ClipAdvancedPanel
                  selectedClip={selectedClip}
                  clipForm={clipForm}
                  setClipForm={setClipForm}
                  selection={selection}
                  playheadTime={playheadTime}
                  onMoveClip={onMoveClip}
                  onTrimLeft={onTrimLeft}
                  onTrimRight={onTrimRight}
                  onSplit={onSplit}
                  onStartAiJob={onStartAiJob}
                  onUpdateClip={onUpdateClip}
                  foundationAudioClip={foundationAudioClip}
                  foundationMidiClip={foundationMidiClip}
                  onUpdateLane={onUpdateLane}
                />
              ) : null}
              {tool === "lane" ? <LaneAdvancedPanel selectedLane={selectedLane} onUpdateLane={onUpdateLane} /> : null}
              {tool === "project" ? <ProjectAdvancedPanel project={project} metadata={metadata} onUpdateProject={onUpdateProject} /> : null}
              {tool === "foundation" ? (
                <FoundationPanel
                  lanes={lanes}
                  clips={clips}
                  selection={selection}
                  project={project}
                  transport={transport}
                  onStartAiJob={onStartAiJob}
                  onRefreshProject={onRefreshProject}
                  initialMode={drawerMode}
                />
              ) : null}
              {tool === "drums" ? <StageDrumsPanel clips={clips} selection={selection} project={project} onStartAiJob={onStartAiJob} /> : null}
              {tool === "live" ? (
                <LiveInferencePanel
                  lanes={lanes}
                  project={project}
                  selection={selection}
                  transport={transport}
                  onRefreshProject={onRefreshProject}
                />
              ) : null}
              {tool === "voice" ? (
                <VoiceToMidiPanel
                  lanes={lanes}
                  project={project}
                  transport={transport}
                  selection={selection}
                  actions={studioActions}
                  onRefreshProject={onRefreshProject}
                />
              ) : null}
            </div>
          ))}
        </RightDrawer>
      </div>
    </div>
  );
};

export default Inspector;
