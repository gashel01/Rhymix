import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./StudioPage.css";
import { StudioProvider, useStudioStore } from "./store";
import {
  getOrCreateProjectByAsset,
  getProjectById,
  resetProject,
  startAiJob,
  startRender,
  startStemsRender,
  startMidiExport,
  subscribeJobEvents,
  updateProject,
} from "./api";
import Transport from "./components/Transport";
import TrackList from "./components/TrackList";
import Timeline from "./components/Timeline";
import Inspector from "./components/Inspector";
import JobToasts from "./components/JobToasts";
import LibraryPanel from "./components/LibraryPanel";
import OrchestratorModal from "./components/OrchestratorModal";
import ProjectManagerModal from "./components/ProjectManagerModal";

import { useStudioPlayback } from './hooks/useStudioPlayback';
import { useLyricsActions } from './hooks/useLyricsActions';
import { useStudioKeyboardShortcuts } from './hooks/useStudioKeyboardShortcuts';

const JOB_TYPE_LABELS = {
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

const summarizeJob = (job) => {
  if (!job) return "Idle";
  const label = JOB_TYPE_LABELS[job.type] || String(job.type || "job").replace(/_/g, " ");
  return `${label} · ${job.statusMessage || job.error || job.status || "idle"}`;
};

const getUiStorageKey = (projectId) => `rhymix:studio-ui:${projectId}`;

const readUiPrefs = (projectId) => {
  if (!projectId || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(getUiStorageKey(projectId));
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
};

const writeUiPrefs = (projectId, prefs) => {
  if (!projectId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getUiStorageKey(projectId), JSON.stringify(prefs));
  } catch (error) {
    // Ignore storage failures.
  }
};
const StudioPageInner = ({ assetId, projectId }) => {
  const { state, actions } = useStudioStore();
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [showOrchestrator, setShowOrchestrator] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [jobs, setJobs] = useState([]);
  const jobSubscriptionsRef = useRef(new Map());
  const [createMode, setCreateMode] = useState("custom");
  const [lyrics, setLyrics] = useState("");
  const [style, setStyle] = useState("");
  const [model, setModel] = useState("v4");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [timelineScrollTop, setTimelineScrollTop] = useState(0);
  const trackScrollRef = useRef(null);
  const suppressTrackHeaderScrollRef = useRef(false);
  const focusMode = Boolean(state.ui.focusMode);

  const playback = useStudioPlayback(state, actions);
  const isDirectStudioEntry = !assetId;

  const handleBack = useCallback(() => {
    if (typeof window === "undefined") return;
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.history.replaceState(null, "", "/");
    try {
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (error) {
      window.dispatchEvent(new Event("popstate"));
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadProject = async () => {
      setLoading(true);
      setError(null);
      try {
        let data = null;
        if (projectId) {
          data = await getProjectById(projectId);
        } else if (assetId) {
          data = await getOrCreateProjectByAsset(assetId);
        }
        if (!data) {
          if (mounted) {
            setLoading(false);
            setShowProjectManager(true);
          }
          return;
        }
        if (!mounted) return;
        actions.setProject(data);
      } catch (err) {
        if (!mounted) return;
        setError(err.message || "Failed to load project");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    loadProject();
    return () => {
      mounted = false;
    };
  }, [assetId, projectId, actions]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById("root");
    const prev = {
      htmlOverflow: html.style.overflow,
      htmlHeight: html.style.height,
      bodyOverflow: body.style.overflow,
      bodyHeight: body.style.height,
      rootOverflow: root?.style.overflow ?? "",
      rootHeight: root?.style.height ?? "",
    };
    html.style.overflow = "hidden";
    html.style.height = "100%";
    body.style.overflow = "hidden";
    body.style.height = "100%";
    if (root) {
      root.style.overflow = "hidden";
      root.style.height = "100%";
    }
    return () => {
      html.style.overflow = prev.htmlOverflow;
      html.style.height = prev.htmlHeight;
      body.style.overflow = prev.bodyOverflow;
      body.style.height = prev.bodyHeight;
      if (root) {
        root.style.overflow = prev.rootOverflow;
        root.style.height = prev.rootHeight;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      jobSubscriptionsRef.current.forEach((unsubscribe) => unsubscribe());
      jobSubscriptionsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!state.project?.id) return;
    const prefs = readUiPrefs(state.project.id);
    if (!prefs) return;
    actions.setUi({
      railCollapsed: prefs.railCollapsed ?? state.ui.railCollapsed,
      workspaceSection: "edit",
      inspectorSection: prefs.inspectorSection ?? state.ui.inspectorSection,
      focusMode: prefs.focusMode ?? state.ui.focusMode,
      expandedAiCard: prefs.expandedAiCard ?? state.ui.expandedAiCard,
      drawerTool: prefs.drawerTool ?? state.ui.drawerTool,
      activityFilter: prefs.activityFilter ?? state.ui.activityFilter,
      showCreatePanel: false,
      showLibraryPanel: false,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.project?.id]);

  useEffect(() => {
    if (!state.project?.id) return;
    writeUiPrefs(state.project.id, {
      railCollapsed: state.ui.railCollapsed,
      workspaceSection: "edit",
      inspectorSection: state.ui.inspectorSection,
      focusMode: Boolean(state.ui.focusMode),
      expandedAiCard: state.ui.expandedAiCard,
      drawerTool: state.ui.drawerTool,
      activityFilter: state.ui.activityFilter,
    });
  }, [
    state.project?.id,
    state.ui.railCollapsed,
    state.ui.inspectorSection,
    state.ui.focusMode,
    state.ui.expandedAiCard,
    state.ui.drawerTool,
    state.ui.activityFilter,
  ]);

  useEffect(() => {
    if (!trackScrollRef.current) return;
    if (Math.abs(trackScrollRef.current.scrollTop - timelineScrollTop) < 1) return;
    suppressTrackHeaderScrollRef.current = true;
    trackScrollRef.current.scrollTop = timelineScrollTop;
    const reset = window.requestAnimationFrame(() => {
      suppressTrackHeaderScrollRef.current = false;
    });
    return () => window.cancelAnimationFrame(reset);
  }, [timelineScrollTop]);

  useEffect(() => {
    if (!state.project?.id) return;
    const timeout = setTimeout(() => {
      updateProject(state.project.id, {
        project: state.project,
        lanes: state.lanes,
        clips: state.clips,
        assets: state.assets,
        metadata: state.metadata,
      }).catch((err) => console.error("Failed to save project", err));
    }, 800);
    return () => clearTimeout(timeout);
  }, [state.project, state.lanes, state.clips, state.assets, state.metadata]);

  useStudioKeyboardShortcuts(playback);

  const createPrompt = useMemo(
    () => [style, lyrics].filter(Boolean).join("\n").trim(),
    [style, lyrics]
  );

  const assetList = useMemo(
    () =>
      Object.entries(state.assets || {}).map(([id, asset]) => ({
        id: asset.id || id,
        ...asset,
      })),
    [state.assets]
  );

  const filteredAssets = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    if (!query) return assetList;
    return assetList.filter((asset) => {
      const label = `${asset.label || ""} ${asset.id || ""}`.toLowerCase();
      return label.includes(query);
    });
  }, [assetList, libraryQuery]);

  const selectedClip = useMemo(
    () => state.clips.find((clip) => state.selection?.clipIds?.[0] === clip.id),
    [state.clips, state.selection]
  );

  const selectionSourceClip = useMemo(() => {
    const range = state.selection?.range;
    if (!range) return null;
    const start = Math.min(range.start ?? 0, range.end ?? 0);
    const end = Math.max(range.start ?? 0, range.end ?? 0);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const laneIds = Array.isArray(state.selection?.laneIds) ? state.selection.laneIds : null;
    const candidates = state.clips.filter((clip) => {
      if (clip.clipType === "midi") return false;
      if (laneIds?.length && !laneIds.includes(clip.laneId)) return false;
      const clipStart = clip.timelineStartSec ?? 0;
      const clipEnd = clipStart + Math.max(0.01, (clip.srcEndSec ?? 0) - (clip.srcStartSec ?? 0));
      return end > clipStart && start < clipEnd;
    });
    return candidates[0] || null;
  }, [state.clips, state.selection]);

  const defaultSourceClip = useMemo(() => {
    const mixLane = state.lanes.find((lane) => lane.type === "mix");
    const mixClip = state.clips.find((clip) => clip.laneId === mixLane?.id && clip.clipType !== "midi");
    if (mixClip) return mixClip;
    return state.clips.find((clip) => clip.clipType !== "midi" && clip.sourceAssetId) || null;
  }, [state.clips, state.lanes]);

  const selectedLane = useMemo(() => {
    const selectedLaneId = state.selection?.laneIds?.[0] || selectedClip?.laneId;
    return state.lanes.find((lane) => lane.id === selectedLaneId) || null;
  }, [state.lanes, state.selection?.laneIds, selectedClip]);

  const activeJobs = useMemo(
    () => jobs.filter((job) => !["completed", "failed", "cancelled"].includes(job.status)),
    [jobs]
  );

  const currentJob = useMemo(() => activeJobs[activeJobs.length - 1] || jobs[jobs.length - 1] || null, [activeJobs, jobs]);

  const selectionSummary = useMemo(() => {
    if (selectedClip) {
      const clipLen = Math.max(0, (selectedClip.srcEndSec ?? 0) - (selectedClip.srcStartSec ?? 0));
      return `Clip · ${selectedClip.label || selectedClip.name || selectedClip.id} · ${clipLen.toFixed(2)}s`;
    }
    if (state.selection?.range) {
      const start = Math.min(state.selection.range.start ?? 0, state.selection.range.end ?? 0);
      const end = Math.max(state.selection.range.start ?? 0, state.selection.range.end ?? 0);
      const laneCount = Array.isArray(state.selection?.laneIds) ? state.selection.laneIds.length : state.lanes.length;
      return `Range · ${start.toFixed(2)}s to ${end.toFixed(2)}s · ${laneCount} lane${laneCount === 1 ? "" : "s"}`;
    }
    if (selectedLane) {
      return `Lane · ${selectedLane.name}`;
    }
    if (!state.clips.length) {
      return "No clips yet. Use the create tools in the right panel or add clips to begin.";
    }
    return "No active selection";
  }, [selectedClip, selectedLane, state.selection, state.lanes.length, state.clips.length]);

  const currentWorkspaceLabel = "Studio";
  const shortcutHints = useMemo(
    () => [
      "Space Play/Pause",
      "Del Delete",
      "S Split",
      "Drag Trim/Move",
    ],
    []
  );

  const syncStudioRoute = useCallback(
    (nextProjectData) => {
      if (typeof window === "undefined") return;
      const nextProjectId = nextProjectData?.project?.id || null;
      let nextUrl = "/studio";
      if (!isDirectStudioEntry && assetId) {
        nextUrl = `/studio/${encodeURIComponent(assetId)}`;
      }
      if (nextProjectId) {
        const joiner = nextUrl.includes("?") ? "&" : "?";
        nextUrl = `${nextUrl}${joiner}projectId=${encodeURIComponent(nextProjectId)}`;
      }
      window.history.replaceState({}, "", nextUrl);
      try {
        window.dispatchEvent(new PopStateEvent("popstate"));
      } catch (error) {
        window.dispatchEvent(new Event("popstate"));
      }
    },
    [assetId, isDirectStudioEntry]
  );


  const subscribeJob = (jobId) => {
    if (jobSubscriptionsRef.current.has(jobId)) return;
    const projectId = state.project?.id;
    const unsubscribe = subscribeJobEvents(jobId, (event) => {
      setJobs((prev) => {
        const existing = prev.find((job) => job.id === jobId);
        const next = existing
          ? prev.map((job) =>
              job.id === jobId ? { ...job, ...event, status: event.status || job.status } : job
            )
          : [...prev, { id: jobId, ...event }];
        return next;
      });
      if (event?.type === "project_updated" && projectId) {
        getProjectById(projectId)
          .then((data) => actions.setProject(data))
          .catch((err) => console.error("Failed to refresh project", err));
        return;
      }
      if (["completed", "failed"].includes(event?.status) && projectId) {
        getProjectById(projectId)
          .then((data) => actions.setProject(data))
          .catch((err) => console.error("Failed to refresh project", err));
      }
    });
    jobSubscriptionsRef.current.set(jobId, unsubscribe);
  };

  const refreshProject = async (projectId) => {
    if (!projectId) return;
    try {
      const data = await getProjectById(projectId);
      actions.setProject(data);
    } catch (err) {
      console.error("Failed to refresh project", err);
    }
  };

  const handleStartJob = async (jobType, payload) => {
    if (!state.project?.id) return;
    const sourceRequiredJobs = new Set([
      "understand",
      "stem_extract",
      "stem_extract_uvr",
      "foundation_restyle",
      "foundation_extend",
    ]);
    const explicitClip = payload?.clipId
      ? state.clips.find((clip) => clip.id === payload.clipId)
      : null;
    let sourceClip = explicitClip || (sourceRequiredJobs.has(jobType) ? selectedClip || selectionSourceClip : null);
    if (!sourceClip && jobType === "understand") {
      sourceClip = defaultSourceClip;
    }
    let sourceAssetId = payload?.sourceAssetId || sourceClip?.sourceAssetId;
    if (!sourceAssetId && (jobType === "stem_extract" || jobType === "stem_extract_uvr")) {
      const instrumentalLane = state.lanes.find((lane) => lane.type === "instrumental");
      const instrumentalClip = state.clips.find((clip) => clip.laneId === instrumentalLane?.id);
      sourceClip = sourceClip || instrumentalClip || null;
      sourceAssetId = instrumentalClip?.sourceAssetId;
    }
    let nextPayload = { ...(payload || {}) };
    if (
      jobType === "understand"
      && sourceClip
      && Number.isFinite(Number(nextPayload.startSec))
      && Number.isFinite(Number(nextPayload.endSec))
    ) {
      const clipStart = sourceClip.timelineStartSec ?? 0;
      const clipSrcStart = sourceClip.srcStartSec ?? 0;
      const clipLen = Math.max(0.01, (sourceClip.srcEndSec ?? 0) - (sourceClip.srcStartSec ?? 0));
      const timelineStart = Math.min(Number(nextPayload.startSec), Number(nextPayload.endSec));
      const timelineEnd = Math.max(Number(nextPayload.startSec), Number(nextPayload.endSec));
      const overlapStart = Math.max(timelineStart, clipStart);
      const overlapEnd = Math.min(timelineEnd, clipStart + clipLen);
      if (overlapEnd > overlapStart) {
        nextPayload = {
          ...nextPayload,
          startSec: clipSrcStart + (overlapStart - clipStart),
          endSec: clipSrcStart + (overlapEnd - clipStart),
        };
      }
    }
    if (jobType === "foundation_restyle" || jobType === "foundation_extend") {
      const hasExplicitSourceRange =
        Boolean(nextPayload?.useExplicitSourceRange)
        && Boolean(nextPayload?.sourceAssetId || sourceAssetId)
        && Number.isFinite(Number(nextPayload?.startSec))
        && Number.isFinite(Number(nextPayload?.endSec))
        && Number(nextPayload.endSec) > Number(nextPayload.startSec);
      if (hasExplicitSourceRange) {
        sourceAssetId = nextPayload.sourceAssetId || sourceAssetId;
      } else {
        if (!sourceClip?.sourceAssetId) {
          throw new Error("Select an audio clip or range before running Foundation restyle.");
        }
        const clipStart = sourceClip.timelineStartSec ?? 0;
        const clipSrcStart = sourceClip.srcStartSec ?? 0;
        const clipLen = Math.max(0.01, (sourceClip.srcEndSec ?? 0) - (sourceClip.srcStartSec ?? 0));
        let timelineStart = Number(nextPayload.startSec);
        let timelineEnd = Number(nextPayload.endSec);
        if (!Number.isFinite(timelineStart) || !Number.isFinite(timelineEnd) || timelineEnd <= timelineStart) {
          timelineStart = clipStart;
          timelineEnd = clipStart + clipLen;
        }
        const overlapStart = Math.max(Math.min(timelineStart, timelineEnd), clipStart);
        const overlapEnd = Math.min(Math.max(timelineStart, timelineEnd), clipStart + clipLen);
        if (overlapEnd <= overlapStart) {
          throw new Error("Selected range does not overlap the source clip.");
        }
        nextPayload = {
          ...nextPayload,
          timelineStartSec: overlapStart,
          insertSec: nextPayload.insertSec ?? overlapStart,
          startSec: clipSrcStart + (overlapStart - clipStart),
          endSec: clipSrcStart + (overlapEnd - clipStart),
        };
        sourceAssetId = sourceClip.sourceAssetId;
      }
    }
    const response = await startAiJob(state.project.id, jobType, {
      sourceAssetId,
      ...nextPayload,
    });
    setJobs((prev) => [...prev, { id: response.jobId, type: jobType, status: "queued", progress: 0 }]);
    subscribeJob(response.jobId);
    return response.jobId;
  };

  const {
    lyricsMap,
    lyricsSelection,
    selectionLyricsEntry,
    updateLyricsText,
    removeLyricsEntry,
    restoreLyricsEntry,
    handleTranscribeSelection,
    handleResynthesizeSelection,
  } = useLyricsActions({ handleStartJob });

  const handleRender = async () => {
    if (!state.project?.id) return;
    const response = await startRender(state.project.id);
    setJobs((prev) => [...prev, { id: response.jobId, type: "render", status: "queued", progress: 0 }]);
    subscribeJob(response.jobId);
  };

  const handleRenderStems = async () => {
    if (!state.project?.id) return;
    try {
      const response = await startStemsRender(state.project.id);
      setJobs((prev) => [...prev, { id: response.jobId, type: "render_stems", status: "queued", progress: 0 }]);
      subscribeJob(response.jobId);
    } catch (err) {
      console.error("Failed to start stems render", err);
      window.alert(err?.response?.data?.error || "Could not start the stems export.");
    }
  };

  const handleExportMidi = async () => {
    if (!state.project?.id) return;
    try {
      const response = await startMidiExport(state.project.id);
      setJobs((prev) => [...prev, { id: response.jobId, type: "export_midi", status: "queued", progress: 0 }]);
      subscribeJob(response.jobId);
    } catch (err) {
      console.error("Failed to start MIDI export", err);
      window.alert(err?.response?.data?.error || "Could not start the MIDI export.");
    }
  };

  const handleResetProject = async () => {
    if (!state.project?.id) return;
    const confirmed = window.confirm("Reset this project to the original assets and lanes?");
    if (!confirmed) return;
    try {
      const data = await resetProject(state.project.id);
      actions.setProject(data);
      setJobs([]);
    } catch (err) {
      console.error("Failed to reset project", err);
    }
  };

  const handleSetMidiEditorOpen = React.useCallback(
    (open) => {
      actions.setUi({ midiEditorOpen: Boolean(open) });
    },
    [actions]
  );

  const handleProjectUpdate = (patch) => {
    actions.updateProject(patch);
    if (patch?.bpm != null) {
      const bpm = Math.max(40, Math.min(240, Number(patch.bpm) || 120));
      const gridDiv = state.ui.gridDiv || 1;
      actions.setUi({ gridSec: 60 / bpm / gridDiv });
    }
  };

  const transportActions = useMemo(() => {
    const list = [];
    if (selectedClip?.sourceAssetId) {
      list.push({
        id: "extract-stems",
        label: "Extract Stems",
        variant: "ghost",
        onClick: () =>
          handleStartJob("stem_extract_uvr", {
            sourceAssetId: selectedClip.sourceAssetId,
          }),
      });
    }
    if (state.selection?.range) {
      list.push({
        id: "duplicate-range",
        label: "Duplicate",
        variant: "ghost",
        onClick: () =>
          actions.duplicateSelection(
            state.selection.range,
            state.selection.laneIds,
            state.selection.range.end
          ),
      });
    }
    return list;
  }, [state.selection, selectedClip, actions, handleStartJob]);

  const lyricsEntry = selectionLyricsEntry;

  const jobStatus = summarizeJob(currentJob);

  if (loading) {
    return <div className="studio-page">Loading Studio...</div>;
  }

  if (error) {
    return <div className="studio-page">Error: {error}</div>;
  }

  if (!state.project) {
    return (
      <div className="studio-page">
        <div className="studio-shell">
          <div className="studio-workspace">
            <div className="studio-center-column">
              <div className="studio-panel studio-empty-shell">
                <div className="studio-context-heading">
                  <button className="studio-mini studio-back-button" onClick={handleBack}>
                    Back
                  </button>
                  <div className="studio-context-eyebrow">{currentWorkspaceLabel}</div>
                </div>
                <div className="studio-panel-title">Open or Create a Studio Project</div>
                <div className="studio-subtext">
                  Pick an existing project, start a new one from a track, or create a blank project.
                </div>
                <div className="studio-actions-row" style={{ marginTop: 16 }}>
                  <button className="studio-btn" onClick={() => setShowProjectManager(true)}>
                    Open Project Switcher
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <ProjectManagerModal
          open={showProjectManager}
          onClose={() => setShowProjectManager(false)}
          assetId={assetId}
          currentProjectId={state.project?.id}
          scope={isDirectStudioEntry ? "all" : "asset"}
          onSwitchProject={(newProjectData) => {
            actions.setProject(newProjectData);
            syncStudioRoute(newProjectData);
          }}
        />
      </div>
    );
  }

  return (
    <div className="studio-page">
      <div className="studio-shell">
        <div className={`studio-workspace ${focusMode ? "focus-mode" : ""}`}>
          <div className="studio-left-column">
                  <LibraryPanel
                    libraryQuery={libraryQuery}
                    setLibraryQuery={setLibraryQuery}
                    filteredAssets={filteredAssets}
                    clips={state.clips}
                    lanes={state.lanes}
                    actions={actions}
                    currentTime={state.transport.currentTime}
              onOpenProjectManager={() => setShowProjectManager(true)}
            />
          </div>

          <div className="studio-center-column">
            <div className="studio-panel studio-context-strip">
              <div className="studio-context-main">
                <div className="studio-context-heading">
                  <button className="studio-mini studio-back-button" onClick={handleBack}>
                    Back
                  </button>
                  <div className="studio-context-eyebrow">{currentWorkspaceLabel}</div>
                </div>
                <div className="studio-panel-title">Current Context</div>
                <div className="studio-subtext">{selectionSummary}</div>
              </div>
              <div className="studio-context-meta">
                <button className="studio-mini" onClick={() => setShowOrchestrator(true)}>
                  AI Orchestrator
                </button>
                <div className="studio-context-chip">
                  {activeJobs.length ? `${activeJobs.length} active job${activeJobs.length === 1 ? "" : "s"}` : "No active jobs"}
                </div>
                <button
                  className={`studio-mini ${focusMode ? "active" : ""}`}
                  onClick={() => actions.setUi({ focusMode: !focusMode })}
                >
                  {focusMode ? "Exit Focus" : "Focus Mode"}
                </button>
              </div>
              {/* <div className="studio-shortcut-row">
                {shortcutHints.map((hint) => (
                  <span key={hint} className="studio-context-chip subtle">
                    {hint}
                  </span>
                ))}
              </div> */}
            </div>

            <div className="studio-panel studio-timeline-panel">
              <div className="studio-timeline-toolbar">
                <div className="studio-toolbar-left">
                  <div className="studio-panel-title">Multitrack Timeline</div>
                  <div className="studio-subtext">
                    {state.project?.bpm || 120} BPM · {state.project?.key || "Key unset"} · {state.project?.timeSignature || "4/4"}
                  </div>
                </div>
                <div className="studio-toolbar-right">
                  <div className="studio-field-inline">
                    <label>Grid</label>
                    <select
                      value={state.ui.gridDiv || 1}
                      onChange={(e) => {
                        const gridDiv = Math.max(1, Number(e.target.value) || 1);
                        const bpm = state.project?.bpm || 120;
                        actions.setUi({ gridDiv, gridSec: 60 / bpm / gridDiv });
                      }}
                    >
                      <option value={1}>1/4</option>
                      <option value={2}>1/8</option>
                      <option value={4}>1/16</option>
                      <option value={8}>1/32</option>
                    </select>
                  </div>
                  <button
                    className={`studio-mini ${state.ui.snap ? "active" : ""}`}
                    onClick={() => actions.setUi({ snap: !state.ui.snap })}
                  >
                    Snap
                  </button>
                  <button
                    className={`studio-mini ${state.ui.metronome ? "active" : ""}`}
                    onClick={() => actions.setUi({ metronome: !state.ui.metronome })}
                  >
                    Metronome
                  </button>
                  <button
                    className={`studio-mini ${state.ui.loop ? "active" : ""}`}
                    onClick={() => actions.setUi({ loop: !state.ui.loop })}
                  >
                    Loop
                  </button>
                  <div className="studio-zoom">
                    <span>Zoom</span>
                    <input
                      type="range"
                      min="0.5"
                      max="2.5"
                      step="0.1"
                      value={state.ui.zoom}
                      onChange={(e) => actions.setUi({ zoom: Number(e.target.value) })}
                    />
                  </div>
                </div>
              </div>

              <div className="studio-timeline-shell">
                <div
                  className="studio-track-headers"
                  ref={trackScrollRef}
                  onScroll={() => {
                    if (suppressTrackHeaderScrollRef.current) return;
                    setTimelineScrollTop(trackScrollRef.current?.scrollTop || 0);
                  }}
                >
                  <TrackList
                    lanes={state.lanes}
                    onUpdateLane={actions.updateLane}
                    onAddLane={actions.addLane}
                    onRemoveLane={actions.removeLane}
                    onDuplicateLane={actions.duplicateLane}
                    onReorderLanes={actions.reorderLanes}
                    onDeleteAllLanes={actions.deleteAllLanes}
                    compact
                    onSelectLane={(laneId) => {
                      const laneClips = state.clips.filter((clip) => clip.laneId === laneId);
                      if (!laneClips.length) {
                        actions.setSelection({ range: null, laneIds: [laneId], clipIds: [] });
                        return;
                      }
                      let start = Infinity;
                      let end = 0;
                      laneClips.forEach((clip) => {
                        const clipStart = clip.timelineStartSec ?? 0;
                        const clipEnd =
                          (clip.timelineStartSec ?? 0) + (clip.srcEndSec ?? 0) - (clip.srcStartSec ?? 0);
                        start = Math.min(start, clipStart);
                        end = Math.max(end, clipEnd);
                      });
                      actions.setSelection({ range: { start, end }, laneIds: [laneId], clipIds: [] });
                    }}
                  />
                </div>

                <div className="studio-timeline-canvas">
                  <Timeline
                    project={state.project}
                    lanes={state.lanes}
                    clips={state.clips}
                    assets={state.assets}
                    selection={state.selection}
                    currentTime={state.transport.currentTime}
                    lyricsMap={lyricsMap}
                    canTranscribeSelection={Boolean(lyricsSelection)}
                    onTranscribeSelection={handleTranscribeSelection}
                    onResynthesizeSelection={handleResynthesizeSelection}
                  onClearSelection={() => actions.setSelection({ range: null, laneIds: null, clipIds: [] })}
                  selectionLyricsEntry={selectionLyricsEntry}
                  onUpdateLyricsText={updateLyricsText}
                  onDeleteLyricsEntry={removeLyricsEntry}
                  onRestoreLyricsEntry={restoreLyricsEntry}
                  zoom={state.ui.zoom}
                    snap={state.ui.snap}
                    gridSec={state.ui.gridSec}
                    bpm={state.project?.bpm || 120}
                    onAddClip={actions.addClip}
                    onScrollY={setTimelineScrollTop}
                    scrollTopSync={timelineScrollTop}
                    onSelectClip={(clipId) =>
                      actions.setSelection({ clipIds: clipId ? [clipId] : [], range: null, laneIds: null })
                    }
                    onSelectRange={(payload) => {
                      if (!payload) {
                        actions.setSelection({ range: null, laneIds: null, clipIds: [] });
                        return;
                      }
                      const range = payload.range ?? payload;
                      const laneIds = payload.laneIds ?? null;
                      actions.setSelection({ range, laneIds, clipIds: [] });
                    }}
                    onSeek={(time) => playback.seek(time)}
                    onMoveClip={actions.moveClipToLane}
                    onUpdateClip={actions.updateClip}
                    onSplitClip={actions.splitClip}
                    onPreviewMidiNote={playback.previewMidiNote}
                    onStopPreviewMidiNote={playback.stopPreviewMidiNote}
                    onPlayMidiClipPreview={playback.previewMidiClip}
                    onStopMidiClipPreview={playback.stopPreviewMidiClip}
                    onSetMidiEditorOpen={handleSetMidiEditorOpen}
                    onUndo={actions.undo}
                    onRedo={actions.redo}
                    onDeleteClip={actions.deleteSelection}
                    onTrimClip={actions.trimClipLeft}
                    onTrimClipRight={actions.trimClipRight}
                    onDeleteSelection={actions.deleteSelection}
                    onDuplicateSelection={actions.duplicateSelection}
                  />
                </div>
              </div>
            </div>
          </div>

          {state.ui.showDetailsPanel && (
            <div className="studio-right-column">
              <div className="studio-panel studio-details-panel">
                <Inspector
                  project={state.project}
                  lanes={state.lanes}
                  clips={state.clips}
                  selection={state.selection}
                  metadata={state.metadata}
                  lyricsSelection={lyricsSelection}
                  lyricsEntry={lyricsEntry}
                  playheadTime={state.transport.currentTime}
                  transport={state.transport}
                  onSplit={actions.splitClip}
                  onTrimLeft={actions.trimClipLeft}
                  onTrimRight={actions.trimClipRight}
                  onMoveClip={actions.moveClip}
                  onDeleteSelection={actions.deleteSelection}
                  onDuplicateSelection={actions.duplicateSelection}
                  onStartAiJob={handleStartJob}
                  onUpdateLane={actions.updateLane}
                  onUpdateClip={actions.updateClip}
                  onUpdateProject={handleProjectUpdate}
                  onUpdateLyricsText={updateLyricsText}
                  studioActions={actions}
                onRefreshProject={refreshProject}
                activeWorkspaceLabel={currentWorkspaceLabel}
                jobs={jobs}
                uiState={state.ui}
                createDashboard={{
                  createMode,
                  setCreateMode,
                  lyrics,
                  setLyrics,
                  style,
                  setStyle,
                  model,
                  setModel,
                  createPrompt,
                  handleStartJob,
                  onOpenOrchestrator: () => setShowOrchestrator(true),
                }}
              />
            </div>
          </div>
          )}
        </div>
      </div>

      <Transport
        isPlaying={state.transport.isPlaying}
        currentTime={state.transport.currentTime}
        onPlay={playback.play}
        onPause={playback.pause}
        onStop={playback.stop}
        onUndo={actions.undo}
        onRedo={actions.redo}
        onRender={handleRender}
        onRenderStems={handleRenderStems}
        onExportMidi={handleExportMidi}
        onReset={handleResetProject}
        jobStatus={jobStatus}
        contextActions={transportActions}
        jobCount={activeJobs.length}
        bpm={state.project?.bpm || 120}
        snap={state.ui.snap}
        loop={state.ui.loop}
        zoom={state.ui.zoom}
        workspaceLabel={currentWorkspaceLabel}
        selectionSummary={selectionSummary}
      />


      <ProjectManagerModal
        open={showProjectManager}
        onClose={() => setShowProjectManager(false)}
        assetId={assetId}
        currentProjectId={state.project?.id}
        scope={isDirectStudioEntry ? "all" : "asset"}
        onSwitchProject={(newProjectData) => {
          actions.setProject(newProjectData);
          syncStudioRoute(newProjectData);
        }}
      />

      <OrchestratorModal
        open={showOrchestrator}
        onClose={() => setShowOrchestrator(false)}
        transport={state.transport}
        jobs={jobs}
        onStartAiJob={handleStartJob}
        onFocusResult={(result) => {
          const laneIds = [
            ...(Array.isArray(result?.audioLaneIds) ? result.audioLaneIds : []),
            ...(Array.isArray(result?.midiLaneIds) ? result.midiLaneIds : []),
          ];
          if (laneIds.length) {
            actions.setSelection({ range: null, laneIds, clipIds: [] });
          }
          if (result?.insertSec != null) {
            playback.seek(Number(result.insertSec) || 0);
          }
          setShowOrchestrator(false);
        }}
      />

      <JobToasts
        jobs={jobs}
        onDismiss={(jobId) => {
          const unsubscribe = jobSubscriptionsRef.current.get(jobId);
          if (unsubscribe) unsubscribe();
          jobSubscriptionsRef.current.delete(jobId);
          setJobs((prev) => prev.filter((job) => job.id !== jobId));
        }}
      />
    </div>
  );
};

const StudioPage = ({ assetId, projectId }) => (
  <StudioProvider>
    <StudioPageInner assetId={assetId} projectId={projectId} />
  </StudioProvider>
);

export default StudioPage;
