import React, { useEffect, useMemo, useRef, useState } from "react";
import "./StudioPage.css";
import { StudioProvider, useStudioStore } from "./store";
import {
  getOrCreateProjectByAsset,
  getProjectById,
  resetProject,
  startAiJob,
  startRender,
  subscribeJobEvents,
  transcribeStudioSelection,
  updateProject,
} from "./api";
import Transport from "./components/Transport";
import TrackList from "./components/TrackList";
import Timeline from "./components/Timeline";
import Inspector from "./components/Inspector";
import CreationDashboard from "./components/CreationDashboard";
import LibraryPanel from "./components/LibraryPanel";
import JobToasts from "./components/JobToasts";
import ProjectManagerModal from "./components/ProjectManagerModal";

import { useStudioPlayback } from './hooks/useStudioPlayback';
import { useLyricsActions } from './hooks/useLyricsActions';
import { useStudioKeyboardShortcuts } from './hooks/useStudioKeyboardShortcuts';
const StudioPageInner = ({ assetId }) => {
  const { state, actions } = useStudioStore();
  const [showProjectManager, setShowProjectManager] = useState(false);
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
  const transcribeTokenRef = useRef(0);

  const playback = useStudioPlayback(state, actions);

  useEffect(() => {
    let mounted = true;
    const loadProject = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getOrCreateProjectByAsset(assetId);
        if (!mounted) return;
        actions.setProject(data);
      } catch (err) {
        if (!mounted) return;
        setError(err.message || "Failed to load project");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    if (assetId) loadProject();
    return () => {
      mounted = false;
    };
  }, [assetId, actions]);

  useEffect(() => {
    return () => {
      jobSubscriptionsRef.current.forEach((unsubscribe) => unsubscribe());
      jobSubscriptionsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!trackScrollRef.current) return;
    if (Math.abs(trackScrollRef.current.scrollTop - timelineScrollTop) < 1) return;
    trackScrollRef.current.scrollTop = timelineScrollTop;
  }, [timelineScrollTop]);

  useEffect(() => {
    if (!state.project?.id) return;
    const timeout = setTimeout(() => {
      updateProject(state.project.id, {
        project: state.project,
        lanes: state.lanes,
        clips: state.clips,
        metadata: state.metadata,
      }).catch((err) => console.error("Failed to save project", err));
    }, 800);
    return () => clearTimeout(timeout);
  }, [state.project, state.lanes, state.clips, state.metadata]);

  useStudioKeyboardShortcuts(playback);

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

  const createPrompt = useMemo(
    () => [style, lyrics].filter(Boolean).join("\n").trim(),
    [style, lyrics]
  );

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
      if (event?.status === "completed" && projectId) {
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
  };

  const {
    lyricsMap,
    lyricsSelection,
    selectionLyricsEntry,
    buildSegmentsFromText,
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
    if (!state.clips.length) {
      list.push({
        id: "open-library",
        label: "Open Library",
        variant: "ghost",
        onClick: () => actions.setUi({ showLibraryPanel: true }),
      });
      list.push({
        id: "create-song",
        label: "Create Song",
        variant: "accent",
        onClick: () => actions.setUi({ showCreatePanel: true }),
      });
      return list;
    }
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
  }, [state.clips, state.selection, selectedClip, actions, handleStartJob]);

  const lyricsEntry = selectionLyricsEntry;

  const jobStatus = jobs.length ? `${jobs[jobs.length - 1].type}: ${jobs[jobs.length - 1].status}` : "Idle";

  if (loading) {
    return <div className="studio-page">Loading Studio...</div>;
  }

  if (error) {
    return <div className="studio-page">Error: {error}</div>;
  }

  return (
    <div className="studio-page">
      <div className="studio-shell">
        <div className={`studio-rail ${state.ui.railCollapsed ? "collapsed" : ""}`}>
          <button
            className="studio-rail-toggle"
            onClick={() => actions.setUi({ railCollapsed: !state.ui.railCollapsed })}
          >
            ☰
          </button>
          <button
            className={`studio-rail-btn ${state.ui.showCreatePanel ? "active" : ""}`}
            onClick={() => actions.setUi({ showCreatePanel: !state.ui.showCreatePanel })}
          >
            Create
          </button>
          <button className="studio-rail-btn active">Studio</button>
          <button
            className={`studio-rail-btn ${state.ui.showLibraryPanel ? "active" : ""}`}
            onClick={() => actions.setUi({ showLibraryPanel: !state.ui.showLibraryPanel })}
          >
            Library
          </button>
        </div>

        <div className="studio-workspace">
          {(state.ui.showCreatePanel || state.ui.showLibraryPanel) && (
            <div className="studio-left-column">
              {state.ui.showCreatePanel && (
                <CreationDashboard
                  createMode={createMode}
                  setCreateMode={setCreateMode}
                  lyrics={lyrics}
                  setLyrics={setLyrics}
                  style={style}
                  setStyle={setStyle}
                  model={model}
                  setModel={setModel}
                  createPrompt={createPrompt}
                  handleStartJob={handleStartJob}
                />
              )}

              {state.ui.showLibraryPanel && (
                <LibraryPanel
                  libraryQuery={libraryQuery}
                  setLibraryQuery={setLibraryQuery}
                  filteredAssets={filteredAssets}
                  lanes={state.lanes}
                  actions={actions}
                  currentTime={state.transport.currentTime}
                  onOpenProjectManager={() => setShowProjectManager(true)}
                />
              )}
            </div>
          )}

          <div className="studio-center-column">
            <div className="studio-panel studio-timeline-panel">
              <div className="studio-timeline-toolbar">
                <div className="studio-toolbar-left">
                  <div className="studio-panel-title">Multitrack Timeline</div>
                  <div className="studio-subtext">
                    Bars & Beats · {state.project?.bpm || 120} BPM
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
                  <label className="studio-toggle">
                    <input type="checkbox" checked={state.ui.snap} onChange={() => actions.setUi({ snap: !state.ui.snap })} />
                    Snap
                  </label>
                  <label className="studio-toggle">
                    <input
                      type="checkbox"
                      checked={state.ui.metronome}
                      onChange={() => actions.setUi({ metronome: !state.ui.metronome })}
                    />
                    Metronome
                  </label>
                  <label className="studio-toggle">
                    <input type="checkbox" checked={state.ui.loop} onChange={() => actions.setUi({ loop: !state.ui.loop })} />
                    Loop
                  </label>
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
                  onScroll={() => setTimelineScrollTop(trackScrollRef.current?.scrollTop || 0)}
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
        onReset={handleResetProject}
        jobStatus={jobStatus}
        contextActions={transportActions}
      />


      <ProjectManagerModal
        open={showProjectManager}
        onClose={() => setShowProjectManager(false)}
        assetId={assetId}
        currentProjectId={state.project?.id}
        onSwitchProject={(newProjectData) => {
          actions.setProject(newProjectData);
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

const StudioPage = ({ assetId }) => (
  <StudioProvider>
    <StudioPageInner assetId={assetId} />
  </StudioProvider>
);

export default StudioPage;
