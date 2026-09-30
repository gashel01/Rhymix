import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../../studio/StudioPage.css";
import "./StudioView.css";
import { StudioProvider, useStudioStore } from "../../studio/store";
import {
  createProject,
  getOrCreateProjectByAsset,
  getProjectById,
  resetProject,
  startAiJob,
  startRender,
  startStemsRender,
  startMidiExport,
  cancelJob,
  subscribeJobEvents,
  updateProject,
  matchAsset,
} from "../../studio/api";
import Transport from "../../studio/components/Transport";
import TrackList from "../../studio/components/TrackList";
import Timeline from "../../studio/components/Timeline";
import SessionView from "../../studio/components/SessionView";
import Inspector from "../../studio/components/Inspector";
import JobToasts from "../../studio/components/JobToasts";
import LibraryPanel from "../../studio/components/LibraryPanel";
import ProjectManagerModal from "../../studio/components/ProjectManagerModal";

import { useStudioPlayback } from "../../studio/hooks/useStudioPlayback";
import { useLyricsActions } from "../../studio/hooks/useLyricsActions";
import { useStudioKeyboardShortcuts } from "../../studio/hooks/useStudioKeyboardShortcuts";
import { LANE_HEIGHT, fitZoom, sliderToZoom, zoomToSlider } from "../../studio/timelineMetrics";
import { secPerBar } from "../../studio/sessionViewMath";
import {
  describeSelection,
  filterAssets,
  findSelectedClip,
  findSelectedLane,
  findSelectionSourceClip,
  getActiveJobs,
  getCurrentJob,
  getProjectDurationSec,
  listAssets,
  readUiPrefs,
  summarizeJob,
  writeUiPrefs,
} from "../../studio/studioSelectors";
import Select from "../../components/common/Select";
import { useToasts } from "../toasts";
import {
  FitIcon,
  FocusIcon,
  LoopIcon,
  MagnetIcon,
  MetronomeIcon,
  SparklesIcon,
} from "../../studio/components/StudioIcons";

/*
 * Studio, mounted as a normal /next view instead of its own full-page route.
 *
 * Everything that actually runs a project — the store, the hooks, every
 * component under studio/components/ — is reused unchanged: it has no JSX
 * coupling to how the page around it is framed, and rewriting a tested
 * drag/resize/MIDI-editing engine from a static mockup would trade a working
 * timeline for a guess. What changes here is only the frame: this mounts
 * inside the /next shell's rail+topbar+player instead of covering the whole
 * viewport, and "back" is a nav click instead of a second router.
 */

const routeToHash = (assetId, projectId) =>
  `studio${assetId ? `/${encodeURIComponent(assetId)}` : ""}${
    projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""
  }`;

// A bare "Studio" nav click carries no assetId or projectId — there is
// nothing in the URL to say which project that should be. Remembering the
// last one this browser had open is what lets that click land in a live,
// already-populated editor instead of a "pick something first" lobby every
// single time.
const LAST_PROJECT_KEY = "rx-studio-last-project";

// Friendly names for the notification log — an unlabelled "generate" or
// "stem_extract_uvr" reads as debug output, not something that happened.
const JOB_LABELS = {
  stem_extract_uvr: "Stem extraction",
  render: "Mixdown export",
  render_stems: "Stems export",
  export_midi: "MIDI export",
  render_midi_clip: "Instrument render",
  resynthesize: "Vocal resynthesis",
  generate: "Generation",
  airgen_regen: "AI Regen (drums)",
};

const StudioViewInner = ({ assetId, projectId, onNavigate, active = true }) => {
  const { state, actions } = useStudioStore();
  const { notify, fail } = useToasts();
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [jobs, setJobs] = useState([]);
  const jobSubscriptionsRef = useRef(new Map());
  const [libraryQuery, setLibraryQuery] = useState("");
  const [timelineScrollTop, setTimelineScrollTop] = useState(0);
  /* One embedded VST3 editor at a time, shown in the Inspector's right panel — a lane's plugin
     picker (TrackList.js) sets which plugin to show here, Inspector.js owns the actual
     placeholder element + measures/reports its position, since only it knows where that element
     really sits on screen. Kept here, not in either component alone, because both need to agree
     on it: closing from Inspector's own "Close" button must be visible to TrackList's picker
     (so it shows "Open" again), and vice versa. */
  const [embeddedVstEditor, setEmbeddedVstEditor] = useState(null); // {pluginPath, pluginName, instanceId}
  /* Plugins whose fixed native GUI size doesn't fit the panel (Inspector.js measures this —
     only it knows the placeholder's real on-screen size) get auto-opened as their own standalone
     window instead, same as any real DAW falls back to a floating editor for a plugin that isn't
     built to be squeezed into a host-sized slot. Tracked separately from openVstInstances (which
     lives in TrackList.js, for the user's own manual "Open in separate window" toggle) because
     this one is driven by Inspector's fit check, not a direct user click. */
  const [fallbackVstInstances, setFallbackVstInstances] = useState({}); // {pluginPath: instanceId}

  const openEmbeddedVstEditor = useCallback(async (plugin) => {
    if (embeddedVstEditor?.instanceId) {
      try {
        await window.rhymixNative?.vst3?.close(embeddedVstEditor.instanceId);
      } catch {}
    }
    setEmbeddedVstEditor({ pluginPath: plugin.path, pluginName: plugin.name, instanceId: null });
  }, [embeddedVstEditor]);

  const closeEmbeddedVstEditor = useCallback(async () => {
    const current = embeddedVstEditor;
    setEmbeddedVstEditor(null);
    if (current?.instanceId) {
      try {
        await window.rhymixNative?.vst3?.close(current.instanceId);
      } catch {}
    }
  }, [embeddedVstEditor]);

  const handleEmbedDoesNotFit = useCallback(async (editor) => {
    setEmbeddedVstEditor(null);
    if (!editor?.pluginPath) return;
    try {
      const result = await window.rhymixNative?.vst3?.open(editor.pluginPath);
      if (result?.instanceId) {
        setFallbackVstInstances((prev) => ({ ...prev, [editor.pluginPath]: result.instanceId }));
      }
    } catch {}
  }, []);

  const closeFallbackVstInstance = useCallback(async (pluginPath) => {
    const instanceId = fallbackVstInstances[pluginPath];
    setFallbackVstInstances((prev) => {
      const next = { ...prev };
      delete next[pluginPath];
      return next;
    });
    if (instanceId) {
      try {
        await window.rhymixNative?.vst3?.close(instanceId);
      } catch {}
    }
  }, [fallbackVstInstances]);
  /* The right panel is the selected lane's effects. It has nothing to show until a lane or clip is
     picked, so then it isn't rendered at all (the timeline gets the width); it always shows while
     a plugin is embedded in it or a voice-tool drawer is open, since those live inside it.
     Otherwise the user can fold it to a thin rail — remembered across sessions. */
  const lastPanelSelectionRef = useRef(null);
  const [rightCollapsed, setRightCollapsedState] = useState(() => {
    try {
      return window.localStorage?.getItem("rx-studio-right-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const setRightCollapsed = (value) => {
    setRightCollapsedState(value);
    try {
      window.localStorage?.setItem("rx-studio-right-collapsed", value ? "1" : "0");
    } catch {
      // Storage unavailable — it just won't be remembered.
    }
  };
  /* "Match": every loop dropped in is brought onto the project's tempo, key and a whole number
     of bars (backend loop_match.py), so it lands in time and in tune instead of drifting against
     what's already there. On by default; the toolbar toggle turns it off for one-shots and
     samples you want untouched. */
  const [autoMatch, setAutoMatchState] = useState(() => {
    try {
      return window.localStorage?.getItem("rx-studio-auto-match") !== "0";
    } catch {
      return true;
    }
  });
  const setAutoMatch = (value) => {
    setAutoMatchState(value);
    try {
      window.localStorage?.setItem("rx-studio-auto-match", value ? "1" : "0");
    } catch {
      // Storage unavailable — it just won't be remembered.
    }
  };
  const trackScrollRef = useRef(null);
  const timelineCanvasRef = useRef(null);
  const didFitZoomRef = useRef(false);
  const suppressTrackHeaderScrollRef = useRef(false);
  const focusMode = Boolean(state.ui.focusMode);

  const playback = useStudioPlayback(state, actions);
  const isDirectStudioEntry = !assetId;

  // NextApp renders a permanent `.rx-player` slot next to the app-wide player
  // bar (see NextApp.js) — CSS shows whichever one matches the active view,
  // but both stay mounted the whole session, so this id lookup only ever has
  // to run once: the node it finds is never torn down and recreated the way
  // it would be if NextApp mounted/unmounted the slot along with Studio
  // itself. Studio's transport portals into it so there is exactly one bar
  // at the bottom of the screen, not two stacked on top of each other.
  const [playerSlot, setPlayerSlot] = useState(null);
  useEffect(() => {
    setPlayerSlot(document.getElementById("rx-studio-player-slot"));
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
        } else {
          // Bare entry — resume the last project this browser had open
          // rather than asking which one first; if it's gone (deleted, or
          // this is a first-ever visit) fall back to a fresh blank one, so
          // "Studio" always opens into a live editor, never an empty lobby.
          const lastProjectId = window.localStorage.getItem(LAST_PROJECT_KEY);
          if (lastProjectId) {
            try {
              data = await getProjectById(lastProjectId);
            } catch (err) {
              data = null;
            }
          }
          if (!data) data = await createProject();
          if (mounted && data?.project?.id) {
            onNavigate(routeToHash(null, data.project.id));
          }
        }
        if (!data) {
          if (mounted) setLoading(false);
          return;
        }
        if (!mounted) return;
        if (data.project?.id) {
          window.localStorage.setItem(LAST_PROJECT_KEY, data.project.id);
        }
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
  }, [assetId, projectId, actions, onNavigate]);

  useEffect(() => {
    /* Safe to capture: the Map is created once by useRef and never
       reassigned, only filled and emptied. So this local is the same Map the
       cleanup would have read anyway. */
    const subscriptions = jobSubscriptionsRef.current;
    return () => {
      subscriptions.forEach((unsubscribe) => unsubscribe());
      subscriptions.clear();
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
      masterVolume: prefs.masterVolume ?? state.ui.masterVolume,
      masterPan: prefs.masterPan ?? state.ui.masterPan,
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
      masterVolume: state.ui.masterVolume,
      masterPan: state.ui.masterPan,
    });
  }, [
    state.project?.id,
    state.ui.railCollapsed,
    state.ui.inspectorSection,
    state.ui.focusMode,
    state.ui.expandedAiCard,
    state.ui.drawerTool,
    state.ui.activityFilter,
    state.ui.masterVolume,
    state.ui.masterPan,
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

  // Mirrors the fields the autosave below patches — read by the flush-before-close handler further
  // down, which can fire at any time (not just when the debounce effect last ran), so it needs the
  // latest values without re-registering the IPC listener on every keystroke.
  const latestProjectStateRef = useRef(null);
  latestProjectStateRef.current = {
    project: state.project,
    lanes: state.lanes,
    clips: state.clips,
    assets: state.assets,
    metadata: state.metadata,
    scenes: state.scenes,
    clipSlots: state.clipSlots,
  };

  useEffect(() => {
    if (!state.project?.id) return;
    const timeout = setTimeout(() => {
      updateProject(state.project.id, latestProjectStateRef.current).catch((err) =>
        console.error("Failed to save project", err)
      );
    }, 800);
    return () => clearTimeout(timeout);
  }, [state.project, state.lanes, state.clips, state.assets, state.metadata, state.scenes, state.clipSlots]);

  // The debounce above means a window closed within 800ms of the last edit would otherwise drop
  // it silently — main.js blocks the actual close once and asks for this instead, so the last
  // change always makes it to the backend before the app actually quits.
  useEffect(() => {
    if (!window.rhymixNative?.app?.onFlushRequest) return;
    window.rhymixNative.app.onFlushRequest(async () => {
      const projectId = latestProjectStateRef.current?.project?.id;
      if (!projectId) return;
      try {
        await updateProject(projectId, latestProjectStateRef.current);
      } catch (err) {
        console.error("Failed to flush project save before close", err);
      }
    });
  }, []);

  // Studio now stays mounted (and its audio engine keeps running) after the user
  // navigates elsewhere — see NextApp.js — so these global shortcuts must stand
  // down while another view is on screen, or Space/Delete/1-2-3 would fire into
  // Studio from the Library or Train views instead of whatever is focused there.
  useStudioKeyboardShortcuts(playback, active);

  const assetList = useMemo(() => listAssets(state.assets), [state.assets]);

  const filteredAssets = useMemo(
    () => filterAssets(assetList, libraryQuery),
    [assetList, libraryQuery]
  );

  const selectedClip = useMemo(
    () => findSelectedClip(state.clips, state.selection),
    [state.clips, state.selection]
  );

  const selectionSourceClip = useMemo(
    () => findSelectionSourceClip(state.clips, state.selection),
    [state.clips, state.selection]
  );

  const selectedLane = useMemo(
    () => findSelectedLane(state.lanes, state.selection, selectedClip),
    [state.lanes, state.selection, selectedClip]
  );

  const activeJobs = useMemo(() => getActiveJobs(jobs), [jobs]);

  const currentJob = useMemo(() => getCurrentJob(jobs), [jobs]);

  const selectionSummary = useMemo(
    () =>
      describeSelection({
        selectedClip,
        selectedLane,
        selection: state.selection,
        lanes: state.lanes,
        clips: state.clips,
      }),
    [selectedClip, selectedLane, state.selection, state.lanes, state.clips]
  );

  /* Same span Timeline computes for itself. */
  const projectDurationSec = useMemo(
    () => getProjectDurationSec(state.project, state.clips),
    [state.project, state.clips]
  );

  const handleFitZoom = useCallback(() => {
    const width = timelineCanvasRef.current?.clientWidth;
    if (!width) return;
    actions.setUi({ zoom: fitZoom(projectDurationSec, width) });
  }, [actions, projectDurationSec]);

  /* A project opens framed. The zoom defaulted to 1 — 80px/s — so a
     three-minute track opened showing its first six seconds, and no position
     of the old slider could show more than a ninth of it. Fires once per
     project; after that the zoom belongs to the user. */
  useEffect(() => {
    if (didFitZoomRef.current) return;
    if (!state.project || !state.clips.length) return;
    const width = timelineCanvasRef.current?.clientWidth;
    if (!width) return;
    didFitZoomRef.current = true;
    actions.setUi({ zoom: fitZoom(projectDurationSec, width) });
  }, [state.project, state.clips.length, projectDurationSec, actions]);

  /* Keeps the address bar (and so Back/reload) pointed at whatever project is
     actually open — the same reason the old standalone router did this, just
     folded into /next's hash instead of a path segment. */
  const syncStudioRoute = useCallback(
    (nextProjectData) => {
      if (!onNavigate) return;
      onNavigate(routeToHash(assetId, nextProjectData?.project?.id || null));
    },
    [assetId, onNavigate]
  );

  const subscribeJob = (jobId) => {
    if (jobSubscriptionsRef.current.has(jobId)) return;
    const projectId = state.project?.id;
    const unsubscribe = subscribeJobEvents(jobId, (event) => {
      let updatedJob = null;
      setJobs((prev) => {
        const existing = prev.find((job) => job.id === jobId);
        const next = existing
          ? prev.map((job) =>
              job.id === jobId ? { ...job, ...event, status: event.status || job.status } : job
            )
          : [...prev, { id: jobId, ...event }];
        updatedJob = next.find((job) => job.id === jobId) || null;
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
        // The Inspector used to keep its own live "Activity / Recent Results"
        // list for this — removed in favour of the one place job outcomes
        // already collect for every other feature in the app, instead of a
        // second, Studio-only history nobody thought to check.
        const label = JOB_LABELS[updatedJob?.type] || updatedJob?.type || "Job";
        if (event.status === "completed") {
          notify(`${label} finished.`);
        } else {
          fail(`${label} failed${updatedJob?.error ? `: ${updatedJob.error}` : "."}`);
        }
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

  /* Left unwrapped, deliberately. transportActions below lists it and so
     rebuilds on every render — but that memo only assembles a short array of
     transport buttons, and making it truly memoise would mean wrapping this
     function plus subscribeJob, naming every piece of store state they read.
     That is a large, cascading change to save one small allocation per
     render. The warning is accurate; acting on it is not worth what it
     costs. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleStartJob = async (jobType, payload) => {
    if (!state.project?.id) return;
    const explicitClip = payload?.clipId
      ? state.clips.find((clip) => clip.id === payload.clipId)
      : null;
    const sourceClip = explicitClip || (jobType === "stem_extract_uvr" ? selectedClip || selectionSourceClip : null);
    let sourceAssetId = payload?.sourceAssetId || sourceClip?.sourceAssetId;
    if (!sourceAssetId && jobType === "stem_extract_uvr") {
      const instrumentalLane = state.lanes.find((lane) => lane.type === "instrumental");
      const instrumentalClip = state.clips.find((clip) => clip.laneId === instrumentalLane?.id);
      sourceAssetId = instrumentalClip?.sourceAssetId;
    }
    const response = await startAiJob(state.project.id, jobType, {
      sourceAssetId,
      ...(payload || {}),
    });
    setJobs((prev) => [...prev, { id: response.jobId, type: jobType, status: "queued", progress: 0 }]);
    subscribeJob(response.jobId);
    return response.jobId;
  };

  const {
    lyricsMap,
    lyricsSelection,
    updateLyricsText,
    removeLyricsEntry,
    restoreLyricsEntry,
    handleResynthesizeSelection,
  } = useLyricsActions({ handleStartJob });

  const handleRender = async (master) => {
    if (!state.project?.id) return;
    const response = await startRender(state.project.id, master);
    setJobs((prev) => [...prev, { id: response.jobId, type: "render", status: "queued", progress: 0 }]);
    subscribeJob(response.jobId);
  };

  const handleCancelJob = async (jobId) => {
    try {
      const data = await cancelJob(jobId);
      setJobs((prev) => prev.map((job) => (job.id === jobId ? { ...job, ...data } : job)));
    } catch (err) {
      console.error("Failed to cancel job", err);
      window.alert(err?.response?.data?.error || "Could not cancel the job.");
    }
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

  // Resolves to the asset to actually place: the matched copy, or the original when matching is off,
  // doesn't apply (soundfonts, an already-matched loop) or fails (the drop is never blocked by it).
  const matchDroppedAsset = async (assetId) => {
    const original = state.assets?.[assetId];
    const fallback = { assetId, durationSec: Number(original?.durationSec) || undefined };
    if (!autoMatch || !original?.url || original.kind === "soundfont" || original.matchedFrom) return fallback;
    if (!state.project?.id) return fallback;
    try {
      const { asset, info } = await matchAsset(state.project.id, assetId, {
        bpm: state.project.bpm || 120,
        key: state.project.key || null,
      });
      actions.registerAsset(asset);
      const parts = [`${Math.round(info.targetBpm)} BPM`];
      if (info.bars) parts.push(`${info.bars} bar${info.bars === 1 ? "" : "s"}`);
      if (info.semitones) parts.push(`${info.semitones > 0 ? "+" : ""}${info.semitones} st → ${info.targetKey}`);
      notify(`Matched: ${parts.join(" · ")}`);
      return { assetId: asset.id, durationSec: Number(asset.durationSec) || fallback.durationSec };
    } catch (err) {
      console.warn("Auto-match failed, using the original", err);
      notify("Couldn't match this loop — placed as is.");
      return fallback;
    }
  };

  const jobStatus = summarizeJob(currentJob, "Idle");
  const focusedLaneId = state.selection?.laneIds?.[0] || selectedClip?.laneId || null;
  const panelHasContent = Boolean(focusedLaneId || embeddedVstEditor || state.ui.drawerOpen);
  if (panelHasContent) lastPanelSelectionRef.current = state.selection;
  const panelCollapsed = rightCollapsed && !embeddedVstEditor && !state.ui.drawerOpen;

  if (loading) {
    return <div className="studio-page rx-studio" style={{ "--studio-lane-height": `${LANE_HEIGHT}px` }}>Loading Studio…</div>;
  }

  if (error) {
    return <div className="studio-page rx-studio" style={{ "--studio-lane-height": `${LANE_HEIGHT}px` }}>Error: {error}</div>;
  }

  if (!state.project) {
    return (
      <div className="studio-page rx-studio" style={{ "--studio-lane-height": `${LANE_HEIGHT}px` }}>
        <div className="studio-empty-page">
          <div className="studio-empty-card">
            <div className="studio-empty-glyph" aria-hidden="true">&#9835;</div>
            <h1 className="studio-empty-title">No project open</h1>
            <p className="studio-empty-text">
              Open an existing Studio project, start one from a track, or create a blank project.
            </p>
            <button className="studio-btn accent" onClick={() => setShowProjectManager(true)}>
              Browse projects
            </button>
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
    <div className="studio-page rx-studio" style={{ "--studio-lane-height": `${LANE_HEIGHT}px` }}>
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
            <div className="studio-context-strip">
              <div className="studio-context-main">
                <div className="studio-context-eyebrow">{state.project?.name || "Studio"}</div>
              </div>
              <div className="studio-context-meta">
                {activeJobs.length ? (
                  <div className="studio-context-chip">
                    {`${activeJobs.length} active job${activeJobs.length === 1 ? "" : "s"}`}
                  </div>
                ) : null}
                <div className="studio-view-mode-switch">
                  <button
                    type="button"
                    className={`studio-toggle-btn ${state.ui.workspaceSection !== "session" ? "active" : ""}`}
                    onClick={() => actions.setUi({ workspaceSection: "edit" })}
                  >
                    Timeline
                  </button>
                  <button
                    type="button"
                    className={`studio-toggle-btn ${state.ui.workspaceSection === "session" ? "active" : ""}`}
                    onClick={() => actions.setUi({ workspaceSection: "session" })}
                  >
                    Session
                  </button>
                </div>
                <button
                  className={`studio-toggle-btn ${focusMode ? "active" : ""}`}
                  aria-pressed={focusMode}
                  title={focusMode ? "Leave focus mode" : "Focus mode"}
                  onClick={() => actions.setUi({ focusMode: !focusMode })}
                >
                  <FocusIcon size={15} />
                  Focus
                </button>
              </div>
            </div>

            <div className="studio-panel studio-timeline-panel">
              <div className="studio-timeline-toolbar">
                {/* BPM/time signature/transpose already live in the
                    transport bar, editable — this repeated them, read-only,
                    next to a title ("Multitrack Timeline") that just restated
                    what the eye is already looking at. */}
                <div className="studio-toolbar-right">
                  <div className="studio-field-inline">
                    <label>Grid</label>
                    <Select
                      value={String(state.ui.gridDiv || 1)}
                      onChange={(next) => {
                        const gridDiv = Math.max(1, Number(next) || 1);
                        const bpm = state.project?.bpm || 120;
                        actions.setUi({ gridDiv, gridSec: 60 / bpm / gridDiv });
                      }}
                      options={[
                        { value: "1", label: "1/4", description: "Beat" },
                        { value: "2", label: "1/8", description: "Half beat" },
                        { value: "4", label: "1/16", description: "Quarter beat" },
                        { value: "8", label: "1/32", description: "Eighth beat" },
                      ]}
                      ariaLabel="Snap grid"
                      className="studio-inline-select"
                    />
                  </div>
                  <button
                    className={`studio-toggle-btn ${state.ui.snap ? "active" : ""}`}
                    aria-pressed={Boolean(state.ui.snap)}
                    title="Snap to grid"
                    onClick={() => actions.setUi({ snap: !state.ui.snap })}
                  >
                    <MagnetIcon size={15} />
                    Snap
                  </button>
                  <button
                    className={`studio-toggle-btn ${state.ui.metronome ? "active" : ""}`}
                    aria-pressed={Boolean(state.ui.metronome)}
                    title="Metronome"
                    onClick={() => actions.setUi({ metronome: !state.ui.metronome })}
                  >
                    <MetronomeIcon size={15} />
                    Click
                  </button>
                  <button
                    className={`studio-toggle-btn ${state.ui.loop ? "active" : ""}`}
                    aria-pressed={Boolean(state.ui.loop)}
                    title="Loop playback"
                    onClick={() => actions.setUi({ loop: !state.ui.loop })}
                  >
                    <LoopIcon size={15} />
                    Loop
                  </button>
                  <button
                    className={`studio-toggle-btn ${autoMatch ? "active" : ""}`}
                    aria-pressed={autoMatch}
                    title="Match: loops you drop in are fitted to the project's tempo, key and bar length"
                    onClick={() => setAutoMatch(!autoMatch)}
                  >
                    <SparklesIcon size={15} /> Match
                  </button>
                  <div className="studio-zoom">
                    <span>Zoom</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.001"
                      value={zoomToSlider(state.ui.zoom)}
                      onChange={(e) => actions.setUi({ zoom: sliderToZoom(e.target.value) })}
                    />
                    <button
                      className="studio-icon-btn"
                      onClick={handleFitZoom}
                      aria-label="Fit project in view"
                      title="Fit the whole project in view"
                    >
                      <FitIcon size={15} />
                    </button>
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
                    assets={state.assets}
                    embeddedVstInstanceId={embeddedVstEditor?.instanceId}
                    embeddedVstPluginPath={embeddedVstEditor?.pluginPath}
                    onOpenEmbeddedVst={openEmbeddedVstEditor}
                    onCloseEmbeddedVst={closeEmbeddedVstEditor}
                    fallbackVstInstances={fallbackVstInstances}
                    onCloseFallbackVst={closeFallbackVstInstance}
                    onUpdateLane={actions.updateLane}
                    onAddLane={actions.addLane}
                    onRemoveLane={actions.removeLane}
                    onDuplicateLane={actions.duplicateLane}
                    onReorderLanes={actions.reorderLanes}
                    onDeleteAllLanes={actions.deleteAllLanes}
                    compact
                    activeLaneId={state.selection?.laneIds?.[0] || selectedClip?.laneId || null}
                    onFocusLane={(laneId) => {
                      actions.setSelection({ range: null, laneIds: [laneId], clipIds: [] });
                      actions.setUi({ showDetailsPanel: true });
                    }}
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
                    onOpenLaneFx={(laneId) => {
                      actions.setSelection({ range: null, laneIds: [laneId], clipIds: [] });
                      actions.setUi({ showDetailsPanel: true });
                    }}
                  />
                </div>

                <div className="studio-timeline-canvas" ref={timelineCanvasRef}>
                  {state.ui.workspaceSection === "session" ? (
                    <SessionView
                      lanes={state.lanes}
                      scenes={state.scenes}
                      clipSlots={state.clipSlots}
                      assets={state.assets}
                      activeClipSlotIds={playback.activeClipSlotIds}
                      onAddScene={() => actions.addScene()}
                      onRenameScene={(sceneId, name) => actions.renameScene(sceneId, name)}
                      onRemoveScene={(sceneId) => actions.removeScene(sceneId)}
                      onTriggerScene={(sceneId) => playback.triggerScene(sceneId)}
                      onTriggerClipSlot={(slot) => playback.triggerClipSlot(slot)}
                      onStopClipSlot={(slotId) => playback.stopClipSlot(slotId)}
                      onClearClipSlot={(sceneId, laneId) => actions.clearClipSlot(sceneId, laneId)}
                      onStopAll={() => playback.stopAllClipSlots()}
                      recordingToTimeline={playback.recordingToTimeline}
                      onToggleRecordToTimeline={() => playback.toggleRecordToTimeline()}
                      bpm={state.project?.bpm}
                      onDropAssetOnSlot={async (sceneId, laneId, assetId) => {
                        const asset = state.assets?.[assetId];
                        if (!asset) return;
                        const placed = await matchDroppedAsset(assetId);
                        actions.setClipSlot({
                          sceneId,
                          laneId,
                          assetId: placed.assetId,
                          srcStartSec: 0,
                          srcEndSec: placed.durationSec || 4,
                          clipType: "audio",
                          label: asset.label || asset.id,
                        });
                      }}
                      onUpdateClipSlot={(slot, patch) => actions.setClipSlot({ ...slot, ...patch })}
                      onDuplicateClipSlot={(slot, targetSceneId) =>
                        actions.setClipSlot({ ...slot, sceneId: targetSceneId })
                      }
                      onGenerateIntoSlot={(sceneId, laneId) => {
                        // Full scope would be: open the AI panel, launch a generation job scoped
                        // to this lane, and auto-load the finished asset into the slot once the
                        // job completes. That last leg needs the slot target threaded through
                        // subscribeJob's completion handler, which isn't wired yet — documented
                        // as the known gap in the backlog doc. What this does today: selects the
                        // target lane and opens the same "Live VC"/generation drawer the rest of
                        // Studio uses, so generating something and dragging/picking it into the
                        // slot afterward is at least a two-click flow, not a context switch.
                        actions.setSelection({ range: null, laneIds: [laneId], clipIds: [] });
                        actions.setUi({ drawerTool: "live", drawerOpen: true, showDetailsPanel: true });
                      }}
                      onCreateMidiSlot={(sceneId, laneId) => {
                        // Same clip-slot shape triggerClipSlot already knows how to play
                        // (useStudioPlayback.js's clipType === "midi" branch) — this just gives the
                        // user a way to create one from Session instead of only via the Timeline's
                        // piano roll. A fresh 2-bar loop is an arbitrary but reasonable default
                        // length; SessionView's own "Start"/"End" trim controls (already wired for
                        // audio slots) resize it the same way afterward.
                        const projectBpm = Number(state.project?.bpm) || 120;
                        actions.setClipSlot({
                          sceneId,
                          laneId,
                          assetId: null,
                          srcStartSec: 0,
                          srcEndSec: secPerBar(projectBpm) * 2,
                          clipType: "midi",
                          midi: { notes: [], bpm: projectBpm, ppq: 480, soundfont: null },
                          label: "MIDI clip",
                        });
                      }}
                      onPreviewMidiNote={playback.previewMidiNote}
                    />
                  ) : (
                  <Timeline
                    active={active}
                    project={state.project}
                    lanes={state.lanes}
                    clips={state.clips}
                    assets={state.assets}
                    selection={state.selection}
                    currentTime={state.transport.currentTime}
                    lyricsMap={lyricsMap}
                    canTranscribeSelection={Boolean(lyricsSelection)}
                    onResynthesizeSelection={handleResynthesizeSelection}
                    onGenerate={(payload) => handleStartJob("generate", payload)}
                    onExtractStems={(sourceAssetId) =>
                      handleStartJob("stem_extract_uvr", {
                        sourceAssetId,
                        stemNames: ["vocals", "drums", "bass", "other"],
                      })
                    }
                    onExtractStem={(stem, sourceAssetId) =>
                      handleStartJob("stem_extract_uvr", { sourceAssetId, stemNames: [stem] })
                    }
                    onOpenTool={(tool) => actions.setUi({ drawerTool: tool, drawerOpen: true })}
                    onAirgenRegen={(selStart, selEnd) =>
                      handleStartJob("airgen_regen", { selStart, selEnd, mode: "fix_drums" })
                    }
                    onMatchDroppedAsset={autoMatch ? matchDroppedAsset : null}
                    onRenderMidiClip={(clipId, soundfont) =>
                      handleStartJob("render_midi_clip", { clipId, soundfont })
                    }
                    onClearSelection={() => actions.setSelection({ range: null, laneIds: null, clipIds: [] })}
                    onUpdateLyricsText={updateLyricsText}
                    onDeleteLyricsEntry={removeLyricsEntry}
                    onRestoreLyricsEntry={restoreLyricsEntry}
                    zoom={state.ui.zoom}
                    onZoomChange={(nextZoom) => actions.setUi({ zoom: nextZoom })}
                    snap={state.ui.snap}
                    gridSec={state.ui.gridSec}
                    bpm={state.project?.bpm || 120}
                    onAddClip={actions.addClip}
                    onAddMidiClip={actions.addMidiClip}
                    onAddLane={actions.addLane}
                    onRegisterAsset={actions.registerAsset}
                    onScrollY={setTimelineScrollTop}
                    scrollTopSync={timelineScrollTop}
                    onSelectClip={(clipId) => {
                      if (!clipId) {
                        actions.setSelection({ clipIds: [], range: null, laneIds: null });
                        return;
                      }
                      // A range matching the clip's own bounds too, not just
                      // clipIds — that's what lets the floating AI bar (which
                      // reads state.selection.range) open for a plain click,
                      // the same way it already does for a dragged range.
                      const clip = state.clips.find((item) => item.id === clipId);
                      const start = clip?.timelineStartSec ?? 0;
                      const end = start + (clip?.srcEndSec ?? 0) - (clip?.srcStartSec ?? 0);
                      actions.setSelection({
                        clipIds: [clipId],
                        range: { start, end },
                        laneIds: clip?.laneId ? [clip.laneId] : null,
                      });
                    }}
                    onToggleSelectClip={(clipId) => {
                      // Shift/Ctrl/Cmd-click: add or remove one clip from the
                      // existing selection instead of replacing it — the same
                      // model File Explorer/Finder use, and what lets a group
                      // of clips be dragged together afterward.
                      const current = state.selection?.clipIds || [];
                      const nextIds = current.includes(clipId)
                        ? current.filter((id) => id !== clipId)
                        : [...current, clipId];
                      if (!nextIds.length) {
                        actions.setSelection({ clipIds: [], range: null, laneIds: null });
                        return;
                      }
                      const selected = nextIds
                        .map((id) => state.clips.find((item) => item.id === id))
                        .filter(Boolean);
                      let start = Infinity;
                      let end = 0;
                      const laneSet = new Set();
                      selected.forEach((clip) => {
                        const clipStart = clip.timelineStartSec ?? 0;
                        const clipEnd = clipStart + (clip.srcEndSec ?? 0) - (clip.srcStartSec ?? 0);
                        start = Math.min(start, clipStart);
                        end = Math.max(end, clipEnd);
                        if (clip.laneId) laneSet.add(clip.laneId);
                      });
                      actions.setSelection({
                        clipIds: nextIds,
                        range: Number.isFinite(start) ? { start, end } : null,
                        laneIds: laneSet.size ? Array.from(laneSet) : null,
                      });
                    }}
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
                    onMoveClips={actions.moveClips}
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
                  )}
                </div>
              </div>
            </div>
          </div>

          {state.ui.showDetailsPanel && (
            /* Always mounted and animated (width, fade) instead of popping in and out, so the
               timeline beside it slides to its new width rather than jumping. `hidden` = nothing to
               show, `collapsed` = the thin rail; the content keeps its full width inside so it
               doesn't reflow while the column grows or shrinks. */
            <div
              className={`studio-right-column ${!panelHasContent ? "hidden" : panelCollapsed ? "collapsed" : ""}`}
              aria-hidden={!panelHasContent}
            >
              <button
                type="button"
                className="studio-right-rail"
                onClick={() => setRightCollapsed(false)}
                title="Show effects"
                tabIndex={panelCollapsed ? 0 : -1}
              >
                <span className="studio-right-rail-arrow">‹</span>
                <span className="studio-right-rail-label">Effects</span>
              </button>
              <div className="studio-right-inner">
              <div className="studio-panel studio-details-panel">
                <Inspector
                  onCollapse={embeddedVstEditor || state.ui.drawerOpen ? undefined : () => setRightCollapsed(true)}
                  project={state.project}
                  lanes={state.lanes}
                  clips={state.clips}
                  assets={state.assets}
                  selection={panelHasContent ? state.selection : lastPanelSelectionRef.current}
                  embeddedVstEditor={embeddedVstEditor}
                  onEmbeddedVstOpened={(instanceId) =>
                    setEmbeddedVstEditor((prev) => (prev ? { ...prev, instanceId } : prev))
                  }
                  onCloseEmbeddedVst={closeEmbeddedVstEditor}
                  onEmbedDoesNotFit={handleEmbedDoesNotFit}
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
                  studioActions={actions}
                  onRefreshProject={refreshProject}
                  activeWorkspaceLabel="Studio"
                  uiState={state.ui}
                />
              </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {playerSlot
        ? createPortal(
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
              jobCount={activeJobs.length}
              bpm={state.project?.bpm || 120}
              timeSignature={state.project?.timeSignature || "4/4"}
              transpose={state.project?.transpose || 0}
              musicalKey={state.project?.key || ""}
              onUpdateProject={handleProjectUpdate}
              selectionSummary={selectionSummary}
            />,
            playerSlot
          )
        : null}

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

      <JobToasts
        jobs={jobs}
        onDismiss={(jobId) => {
          const unsubscribe = jobSubscriptionsRef.current.get(jobId);
          if (unsubscribe) unsubscribe();
          jobSubscriptionsRef.current.delete(jobId);
          setJobs((prev) => prev.filter((job) => job.id !== jobId));
        }}
        onCancel={handleCancelJob}
      />
    </div>
  );
};

export default function StudioView({ assetId, projectId, onNavigate, active = true }) {
  return (
    <StudioProvider>
      <StudioViewInner assetId={assetId} projectId={projectId} onNavigate={onNavigate} active={active} />
    </StudioProvider>
  );
}
