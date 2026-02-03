import React, { useCallback, useEffect, useMemo, memo } from "react";
import { useVolume } from "../contexts/VolumeContext";
import LibraryMusicIcon from "@mui/icons-material/LibraryMusic";
import AddIcon from "@mui/icons-material/Add";

import AudioTrackTable from "./AudioTrackTable";
import ErrorBoundary from "./ErrorBoundary";
import TabPanel from "./common/TabPanel";
import { useVocalMode } from "../hooks/useVocalMode";
import { useAvailableFiles } from "../hooks/useAvailableFiles";
import { downloadFile } from "../utils/audioUtils";
import {
  mergeProcessingUpdate,
  processingEquals,
  isTerminalProcessingState,
} from "../utils/processingStatus";
import Spinner from "./Homeview/Spinner.js";
import Panel from "./Homeview/Panel.js";
import Btn from "./Homeview/Btn.js";
import MainHeader from "./Homeview/MainHeader.js";
import IconButton from "./Homeview/IconButton.js";

import { Theme  } from "./Homeview/Theme.js";

import { useAudioPlayback  }  from "./Homeview/useAudioPlayback";

function HomeView({
  onOpenCreateDataset,
  onInferenceWithTracks,
  handleTrainWithDataset,
  darkMode,
  optimisticTracks = [],
  onOptimisticTracksChange,
}) {
  const { volumeRef } = useVolume();
  // ---------- Theme tokens (same “new style”) ----------
 const t = Theme({ darkMode }).t;
 


  // ---------- Hooks (unchanged logic) ----------
  const { availableFiles, rawVocals, loading, refetch } = useAvailableFiles();

  const { vocalMode, handleVocalModeChange, vocalsFileType } = useVocalMode("raw");

  const { trackPairs } = useAudioPlayback({ rawVocals, availableFiles, vocalMode, optimisticTracks });

  const handleCreateDatasetClick = () => onOpenCreateDataset?.();

  const handleDownload = useCallback(
    async (fileType, filePath, downloadName) => {
      await downloadFile(fileType, filePath, vocalMode, downloadName);
    },
    [vocalMode]
  );

  const handleVocalModeChangeWithCleanup = useCallback(
    (event, newMode) => {
      if (newMode !== null) {
        handleVocalModeChange(event, newMode);
      }
    },
    [handleVocalModeChange]
  );

  const hasProcessing = useMemo(
    () =>
      trackPairs.some((pair) => {
        const state = pair?.processing?.state;
        return state && state !== "ready" && state !== "error";
      }),
    [trackPairs]
  );

  useEffect(() => {
    if (!hasProcessing) return;
    const interval = setInterval(() => {
      refetch();
    }, 2000);
    return () => clearInterval(interval);
  }, [hasProcessing, refetch]);

  useEffect(() => {
    if (!onOptimisticTracksChange || !optimisticTracks.length) return;
    const serverById = new Map(availableFiles.map((file) => [file.fileId, file]));

    let changed = false;
    const next = optimisticTracks
      .map((track) => {
        const trackId = track.trackId || track.fileId;
        if (!trackId) return track;
        const server = serverById.get(trackId);
        if (!server) return track;
        const prevProcessing = track.processing || null;
        const nextProcessing = mergeProcessingUpdate(
          prevProcessing,
          server.processing || null
        );
        const serverTerminal = isTerminalProcessingState(server.processing?.state);
        const mergedTerminal = isTerminalProcessingState(nextProcessing?.state);

        if ((serverTerminal || !server.processing) && mergedTerminal) {
          changed = true;
          return null;
        }

        if (!processingEquals(prevProcessing, nextProcessing)) {
          changed = true;
          return {
            ...track,
            processing: nextProcessing,
          };
        }
        return track;
      })
      .filter(Boolean);

    if (changed) {
      onOptimisticTracksChange(next);
    }
  }, [availableFiles, onOptimisticTracksChange, optimisticTracks]);

  const hasRows = trackPairs.length > 0;
  const showSpinner = loading && !hasRows;

  // ---------- Render ----------
  return (
    <div style={{ minHeight: "100vh", }}>
      <div style={{ margin: "0 auto" }}>
        <Panel style={{ borderRadius: 0, border: "none", padding: 0, background: "transparent" }} t={t}>
          <TabPanel value={0} index={0} sx={{ p: 0, overflow: "visible", }}>
            {showSpinner ? (
              <div style={{ display: "grid", placeItems: "center", padding: "48px 12px", textAlign: "center" }}>
                <Spinner size={34} t={t} />
                <div style={{ marginTop: 12, fontSize: 14, fontWeight: 900, color: t.text }}>Loading singing data…</div>
                <div style={{ marginTop: 6, fontSize: 13, fontWeight: 650, color: t.subtext }}>
                  Please wait while we fetch your audio files.
                </div>
              </div>
            ) : hasRows ? (
              <ErrorBoundary>
                <div
                  style={{
                    borderRadius: t.radiusLg,
                    border: `1px solid ${t.hairline}`,
                    overflow: "visible",
                    border: "none",
                    padding: 0,

                  }}
                >


                  <AudioTrackTable
                  darkMode={darkMode}
                    trackPairs={trackPairs}
                    vocalMode={vocalMode}
                    handleVocalModeChange={handleVocalModeChangeWithCleanup}
                    handleDownload={handleDownload}
                    showVocalToggle={true}
                    vocalsFileType={vocalsFileType}
                    showDatasetButton={false}
                    handleTrainWithDataset={handleTrainWithDataset}
                    showInferenceButton={true}
                    handleInferenceWithTracks={onInferenceWithTracks}
                    volume={volumeRef.current}
                    header={
                      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "0px 0px 10px 0px" }}>
                        <MainHeader title="Your Uploaded Files" subtitle="Select files for training or inference, or create new datasets." t={t} />

                        <IconButton
                          variant="primary"
                          onClick={handleCreateDatasetClick}
                          style={{ height: 40, padding: "0 14px", alignItems: "center", display: "flex", justifyContent: "center" }}
                          title="Create Dataset"
                          t={t}
                          icon={<AddIcon style={{ fontSize: 18 }} />}
                        />
                      </div>
                    }
                  />
                </div>
              </ErrorBoundary>
            ) : (
              <div style={{ textAlign: "center", padding: "44px 12px" }}>
                <div
                  style={{
                    width: 84,
                    height: 84,
                    borderRadius: 999,
                    margin: "0 auto 14px auto",
                    display: "grid",
                    placeItems: "center",
                    border: `1px solid ${t.hairline}`,
                    background: t.isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.03)",
                  }}
                >
                  <LibraryMusicIcon style={{ fontSize: 40, opacity: 0.75, color: t.text }} />
                </div>
                <div style={{ fontSize: 18, fontWeight: 950, color: t.text }}>No Singing Data Files</div>
                <div style={{ marginTop: 8, fontSize: 13, fontWeight: 650, color: t.subtext, maxWidth: 520, marginInline: "auto" }}>
                  Upload and process audio files to create singing datasets for voice training.
                </div>

                <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
                  <Btn variant="primary" onClick={handleCreateDatasetClick} style={{ height: 44, padding: "0 16px" }} t={t}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                      <AddIcon style={{ fontSize: 18 }} />
                      Create Singing Dataset
                    </span>
                  </Btn>
                </div>
              </div>
            )}
          </TabPanel>
        </Panel>


      </div>
    </div>
  );
}

// Memoize with custom comparison to ignore volume changes
// Volume is accessed via context ref, so it doesn't cause re-renders
export default memo(HomeView, (prevProps, nextProps) => {
  return (
    prevProps.onOpenCreateDataset === nextProps.onOpenCreateDataset &&
    prevProps.onInferenceWithTracks === nextProps.onInferenceWithTracks &&
    prevProps.handleTrainWithDataset === nextProps.handleTrainWithDataset &&
    prevProps.darkMode === nextProps.darkMode &&
    prevProps.optimisticTracks === nextProps.optimisticTracks &&
    prevProps.onOptimisticTracksChange === nextProps.onOptimisticTracksChange
  );
});
