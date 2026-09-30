import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import EffectsRack from "./EffectsRack";
import LiveInferencePanel from "./LiveInferencePanel";
import VoiceToMidiPanel from "./VoiceToMidiPanel";

import {
  DRAWER_TITLES,
  normalizeRange,
  resolveRightPanelContext,
} from "./inspectorModel";

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

const Inspector = ({
  project,
  lanes,
  clips,
  assets = {},
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
  playheadTime,
  onRefreshProject,
  activeWorkspaceLabel,
  uiState = {},
  embeddedVstEditor,
  onEmbeddedVstOpened,
  onCloseEmbeddedVst,
  onEmbedDoesNotFit,
  onCollapse,
}) => {
  const embeddedVstPlaceholderRef = useRef(null);
  const embeddedVstOpeningRef = useRef(false);
  const embeddedVstEditorRef = useRef(embeddedVstEditor);
  embeddedVstEditorRef.current = embeddedVstEditor;

  /* Opens once per instance (guarded on embeddedVstEditor.instanceId being unset — the request is
     already in flight or done the moment it's set), measuring the placeholder's real on-screen
     rect right before asking the native side to reparent the plugin's window into it. A
     ResizeObserver below keeps it aligned after that as the panel/window resizes. */
  useEffect(() => {
    if (!embeddedVstEditor || embeddedVstEditor.instanceId || embeddedVstOpeningRef.current) return undefined;
    const el = embeddedVstPlaceholderRef.current;
    if (!el || !window.rhymixNative?.vst3?.openEmbedded) return undefined;
    embeddedVstOpeningRef.current = true;
    // Clear any fixed-size styling a previous (non-resizable) plugin left behind before measuring
    // — otherwise a resizable plugin opened after a fixed-size one would inherit its leftover
    // explicit width/height instead of the normal 100%/480px CSS defaults.
    el.style.width = "";
    el.style.height = "";
    el.style.alignSelf = "";
    const requestedPath = embeddedVstEditor.pluginPath;
    const rect = el.getBoundingClientRect();
    window.rhymixNative.vst3
      .openEmbedded(requestedPath, { x: rect.left, y: rect.top, width: rect.width, height: rect.height })
      .then((result) => {
        if (!result?.instanceId) return;
        // The user may have closed (or switched to a different plugin) while open() was still
        // in flight — closeEmbeddedVstEditor already asked the *old* instanceId to close, which
        // is null at that point, so this now-orphaned instance needs its own explicit close
        // instead of silently staying reparented into a panel nothing references anymore.
        if (embeddedVstEditorRef.current?.pluginPath !== requestedPath) {
          window.rhymixNative.vst3.close(result.instanceId).catch(() => {});
          return;
        }
        // A fixed-size plugin GUI (canResize() === false, reported by the native side) never
        // actually fills a rect it's stretched into — it just keeps painting at its own native
        // size, leaving the rest of the placeholder as dead space. Size the placeholder to match
        // instead of the other way around; the ResizeObserver below picks up this style change
        // and sends one more (now-matching) reposition, which the native side simply centers
        // rather than re-stretching (see addon.cpp's canResize()/getSize() handling).
        //
        // But a fixed native size can also just be too big for the panel to ever hold sensibly —
        // wider than the column itself (the panel can't grow sideways, unlike height, which can
        // at least scroll), or so tall it swamps the whole right panel. A native HWND isn't
        // clipped by the placeholder's CSS box the way web content would be, so forcing it in
        // regardless doesn't fail quietly — it visibly spills out over whatever's behind the
        // panel. Real DAWs don't fight this: a plugin GUI that doesn't fit a fixed embedded slot
        // just opens as its own floating window instead. Same call here.
        const maxWidth = rect.width;
        const maxHeight = Math.max(rect.height, window.innerHeight - rect.top - 24);
        const tooBig =
          result.resizable === false &&
          result.width > 0 &&
          result.height > 0 &&
          (result.width > maxWidth + 4 || result.height > maxHeight + 4);
        if (tooBig) {
          window.rhymixNative.vst3.close(result.instanceId).catch(() => {});
          onEmbedDoesNotFit?.(embeddedVstEditorRef.current || { pluginPath: requestedPath });
          return;
        }
        if (result.resizable === false && result.width > 0 && result.height > 0) {
          el.style.width = `${result.width}px`;
          el.style.height = `${result.height}px`;
          el.style.alignSelf = "center";
        }
        onEmbeddedVstOpened?.(result.instanceId);
      })
      .catch((err) => {
        console.warn("Failed to open embedded VST3 editor", err);
        onCloseEmbeddedVst?.();
      })
      .finally(() => {
        embeddedVstOpeningRef.current = false;
      });
    return undefined;
  }, [embeddedVstEditor, onEmbeddedVstOpened, onCloseEmbeddedVst, onEmbedDoesNotFit]);

  useEffect(() => {
    const instanceId = embeddedVstEditor?.instanceId;
    const el = embeddedVstPlaceholderRef.current;
    if (!instanceId || !el || !window.rhymixNative?.vst3?.reposition) return undefined;
    const reposition = () => {
      const rect = el.getBoundingClientRect();
      window.rhymixNative.vst3.reposition(instanceId, {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
    };
    const observer = new ResizeObserver(reposition);
    observer.observe(el);
    window.addEventListener("resize", reposition);
    reposition();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reposition);
    };
  }, [embeddedVstEditor?.instanceId]);
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

  const [drawerOpen, setDrawerOpenState] = useState(Boolean(uiState?.drawerOpen));
  const [drawerTool, setDrawerToolState] = useState(uiState?.drawerTool || "live");
  const [mountedDrawerTools, setMountedDrawerTools] = useState(() => [uiState?.drawerTool || "live"]);

  const resolvedRightPanelContext = useMemo(
    () => resolveRightPanelContext(selectedRange, selectedClip),
    [selectedClip, selectedRange]
  );

  useEffect(() => {
    if (uiState?.drawerTool) {
      setDrawerToolState(uiState.drawerTool);
      setMountedDrawerTools((prev) => (prev.includes(uiState.drawerTool) ? prev : [...prev, uiState.drawerTool]));
    }
  }, [uiState?.drawerTool]);

  /* Lane FX used to only be reachable from a button in here — now the lane
     sidebar's own "⋯" menu can also ask to open it (TrackList.js, via
     studioActions.setUi), which needs this Inspector-owned drawer to react
     to an external "open" the same way openDrawer() itself would. */
  useEffect(() => {
    if (uiState?.drawerOpen) {
      setDrawerOpenState(true);
    }
  }, [uiState?.drawerOpen]);

  /* Wrapped so the two effects below can depend on it honestly. Unwrapped it
     was a new function every render, which is why it had to be omitted from
     their dependency lists — and an omitted dependency is a stale closure
     waiting to happen. */
  const setInspectorUi = useCallback(
    (patch) => studioActions?.setUi?.(patch),
    [studioActions]
  );

  useEffect(() => {
    setInspectorUi({ rightPanelContext: resolvedRightPanelContext });
  }, [resolvedRightPanelContext, setInspectorUi]);

  useEffect(() => {
    setInspectorUi({
      drawerOpen,
      drawerTool,
    });
  }, [drawerOpen, drawerTool, setInspectorUi]);

  const closeDrawer = () => setDrawerOpenState(false);

  return (
    <div className="studio-inspector-shell">
      <div className="studio-inspector studio-inspector-redesigned">
        <div className="studio-inspector-sticky">
          {/* This was a constant reading "STUDIO", printed above a panel that
              is inside the Studio, on a screen whose header also says Studio.
              The panel's own title carries the information. */}
          <div className="studio-inspector-topline">
            <div>
              <div className="studio-panel-title">{selectedLane ? `${selectedLane.name} · Effects` : "Effects"}</div>
              <div className="studio-subtext">
                {selectedLane
                  ? "Applied to everything on this lane."
                  : "Select a lane, or a clip, to edit its effects."}
              </div>
            </div>
            {onCollapse && (
              <button type="button" className="studio-panel-collapse" onClick={onCollapse} title="Collapse panel">
                ›
              </button>
            )}
          </div>
          {embeddedVstEditor && (
            <div className="studio-vst-embed">
              <div className="studio-vst-embed-head">
                <span className="studio-context-eyebrow">VST3 Plugin</span>
                <div className="studio-panel-title">{embeddedVstEditor.pluginName}</div>
                <button className="studio-btn ghost" onClick={() => onCloseEmbeddedVst?.()}>
                  Close
                </button>
              </div>
              {/* The plugin's real native window gets reparented on top of this exact element by
                  the main process (see native/shell's vst3:openEmbedded) — nothing is drawn here
                  by React itself. Its size IS the plugin's window size; empty until instanceId
                  resolves is intentional, not a loading bug. */}
              <div ref={embeddedVstPlaceholderRef} className="studio-vst-embed-surface" />
            </div>
          )}
        </div>
        <div className="studio-panel-content studio-right-panel-scroll">
          {/* Everything else that used to be here lives where it is used: BPM/Time/Key/Transpose
              in the transport bar, split/duplicate/delete/stems and the voice tools in the
              floating selection bar, a MIDI clip's instrument and "Render to Audio" on the clip,
              a lane's name/gain/mute/solo on its row. What has no other home is its effects. */}
          <EffectsRack lane={selectedLane} onUpdateLane={onUpdateLane} />
        </div>

        <RightDrawer
          open={drawerOpen}
          title={DRAWER_TITLES[drawerTool] || "Advanced"}
          onClose={closeDrawer}
        >
          {mountedDrawerTools.map((tool) => (
            <div key={tool} className={`studio-drawer-pane ${drawerTool === tool && drawerOpen ? "active" : ""}`}>
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
