import React, { useCallback, useEffect, useMemo, useState, memo } from "react";
import { useVolume } from "../contexts/VolumeContext";
import LibraryMusicIcon from "@mui/icons-material/LibraryMusic";
import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import DeleteIcon from "@mui/icons-material/Delete";

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
import IconBtn from "./Homeview/IconBtn.js";
import MainHeader from "./Homeview/MainHeader.js";
import IconButton from "./Homeview/IconButton.js";

import { Theme } from "./Homeview/Theme.js";
import styles from "./HomeView.module.css";

import { useAudioPlayback } from "./Homeview/useAudioPlayback";

function HomeView({
  onOpenCreateDataset,
  onInferenceWithTracks,
  onCoverWithTracks,
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
  const [vocalModeByGroupKey, setVocalModeByGroupKey] = useState({});
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);

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

  const handleGroupVocalModeChange = useCallback((groupKey, nextSource) => {
    if (!groupKey || !nextSource) return;
    setVocalModeByGroupKey((prev) => ({ ...prev, [groupKey]: nextSource }));
  }, []);

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

  useEffect(() => {
    const validKeys = new Set(trackPairs.map((pair) => pair?.groupKey || pair?.runId || pair?.id).filter(Boolean));
    const defaultSource = vocalMode === "processed" ? "processed" : "original";
    setVocalModeByGroupKey((prev) => {
      const next = {};
      let changed = false;
      validKeys.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(prev, key)) next[key] = prev[key];
        else {
          next[key] = defaultSource;
          changed = true;
        }
      });
      if (Object.keys(prev).length !== validKeys.size) changed = true;
      return changed ? next : prev;
    });
  }, [trackPairs, vocalMode]);

  const handleRowModelSelection = useCallback(
    (pair, vocalSource) => {
      const fileId = pair?.fileId || pair?.trackId || pair?.id;
      if (!onInferenceWithTracks || !fileId) return;
      const track = {
        fileId,
        id: fileId,
        displayName: pair?.displayName || pair?.name || null,
        originalName: pair?.originalName || null,
        vocalFileType: vocalSource?.vocalsFileType || pair?.vocalFileType || vocalsFileType || "raw_vocals",
      };
      onInferenceWithTracks([track]);
    },
    [onInferenceWithTracks, vocalsFileType]
  );

  const filteredTrackPairs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return trackPairs;
    return trackPairs.filter((pair) => {
      const fields = [
        pair?.displayName,
        pair?.name,
        pair?.originalName,
        pair?.fileId,
        pair?.trackId,
      ];
      return fields.some((field) => String(field || "").toLowerCase().includes(query));
    });
  }, [searchQuery, trackPairs]);

  const hasAnyRows = trackPairs.length > 0;
  const showSpinner = loading && !hasAnyRows;

  // ---------- Render ----------
  return (
    <div className={styles.pageContainer}>
      <div className={styles.contentWrapper}>
        <Panel style={{ borderRadius: 0, border: "none", padding: 0, background: "transparent" }} t={t}>
          <TabPanel value={0} index={0} sx={{ p: 0, overflow: "visible", }}>
            {showSpinner ? (
              <div className={styles.spinnerContainer}>
                <Spinner size={34} t={t} />
                <div className={styles.loadingTitle} style={{ color: t.text }}>Loading singing data…</div>
                <div className={styles.loadingSubtitle} style={{ color: t.subtext }}>
                  Please wait while we fetch your audio files.
                </div>
              </div>
            ) : hasAnyRows ? (
              <ErrorBoundary>
                <div
                  className={styles.tableContainer}
                  style={{
                    borderRadius: t.radiusLg,
                    border: `1px solid ${t.hairline}`,
                  }}
                >


                  <AudioTrackTable
                    darkMode={darkMode}
                    trackPairs={filteredTrackPairs}
                    vocalModeType="home"
                    vocalMode={vocalMode}
                    handleVocalModeChange={handleVocalModeChangeWithCleanup}
                    handleDownload={handleDownload}
                    showVocalToggle={false}
                    enablePerFileVocalToggle
                    vocalsFileType={vocalsFileType}
                    vocalModeByGroupKey={vocalModeByGroupKey}
                    onGroupVocalModeChange={handleGroupVocalModeChange}
                    showDatasetButton={false}
                    handleTrainWithDataset={handleTrainWithDataset}
                    showInferenceButton={true}
                    handleInferenceWithTracks={onInferenceWithTracks}
                    onRowModelSelection={handleRowModelSelection}
                    handleCoverWithTracks={onCoverWithTracks}
                    hideActionBar
                    volume={volumeRef.current}
                    header={({ selectedCount, onSelectAll, onClear, onDelete }) => (
                      <div className={styles.headerWrapper}>
                        <div className={styles.headerFlex}>
                          <MainHeader title="Your Uploaded Files"  t={t} />

                          <IconButton
                            variant="primary"
                            onClick={handleCreateDatasetClick}
                            className={styles.createDatasetBtn}
                            title="Upload Files"
                            t={t}
                            icon={<AddIcon style={{ fontSize: 18 }} />}
                          />
                        </div>
                        <div className={styles.searchSection}>
                          <div
                            className={styles.searchCard}
                            style={{
                              border: `1px solid ${t.hairline}`,
                              background: t.cardA,
                            }}
                          >
                            <div className={styles.searchFlexCol}>
                              <div className={styles.searchFlexRow}>
                                <div className={styles.searchInputWrapperOuter}>
                                  <div
                                    className={styles.searchInputWrapper}
                                    style={{
                                      border: `1px solid ${isSearchFocused ? (t.isDark ? "rgba(255,255,255,0.2)" : t.primaryWash) : t.hairline}`,
                                      background: isSearchFocused ? (t.isDark ? "rgba(0,0,0,0.5)" : t.cardA) : (t.isDark ? "rgba(0,0,0,0.25)" : t.cardB),
                                    }}
                                  >
                                    <SearchIcon style={{ fontSize: 18, color: t.subtext }} />
                                    <input
                                      type="text"
                                      value={searchQuery}
                                      onChange={(e) => setSearchQuery(e.target.value)}
                                      onFocus={() => setIsSearchFocused(true)}
                                      onBlur={() => setTimeout(() => setIsSearchFocused(false), 180)}
                                      placeholder="Search your library or the community..."
                                      className={styles.searchInput}
                                      style={{ color: t.text }}
                                    />
                                    {searchQuery && (
                                      <button
                                        type="button"
                                        onClick={() => setSearchQuery("")}
                                        onMouseDown={(e) => e.preventDefault()}
                                        className={styles.clearSearchBtn}
                                        style={{ color: t.subtext }}
                                      >
                                        <CloseIcon style={{ fontSize: 16 }} />
                                      </button>
                                    )}
                                  </div>
                                </div>
                                <div className={styles.actionsRow}>
                                  <Btn t={t} variant="outline" onClick={onSelectAll} className={styles.selectAllBtn}>
                                    Select All
                                  </Btn>
                                  <div className={styles.clearSelectionWrapper} style={{ maxWidth: selectedCount > 0 ? 120 : 0, opacity: selectedCount > 0 ? 1 : 0 }}>
                                    <Btn t={t} variant="outline" onClick={onClear} className={styles.clearSelectionBtn}>
                                      Clear
                                    </Btn>
                                  </div>
                                  <div className={styles.divider} style={{ background: t.hairline }} />
                                  <div className={styles.deleteBtnOuter}>
                                    <IconBtn
                                      t={t}
                                      title="Delete selected"
                                      onClick={onDelete}
                                      disabled={selectedCount === 0}
                                      style={{
                                        borderColor: selectedCount > 0 ? "rgba(255,59,48,0.45)" : t.hairline,
                                        background:
                                          selectedCount > 0
                                            ? "linear-gradient(180deg, rgba(255,59,48,0.95), rgba(255,59,48,0.78))"
                                            : `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
                                        color: selectedCount > 0 ? "white" : t.subtext,
                                      }}
                                    >
                                      <DeleteIcon style={{ fontSize: 20 }} />
                                    </IconBtn>
                                    {selectedCount > 0 && (
                                      <div
                                        className={styles.deleteBadge}
                                        style={{
                                          border: `2px solid ${t.isDark ? "rgba(18,18,20,0.8)" : t.cardA}`,
                                          boxShadow: t.shadowSoft,
                                        }}
                                      >
                                        {selectedCount}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  />
                </div>
              </ErrorBoundary>
            ) : (
              <div className={styles.emptyStateContainer}>
                <div
                  className={styles.emptyStateIcon}
                  style={{
                    border: `1px solid ${t.hairline}`,
                    background: t.cardA,
                  }}
                >
                  <LibraryMusicIcon style={{ fontSize: 40, opacity: 0.75, color: t.text }} />
                </div>
                <div className={styles.emptyStateTitle} style={{ color: t.text }}>No Singing Data Files</div>
                <div className={styles.emptyStateMessage} style={{ color: t.subtext }}>
                  Upload and process audio files to create singing datasets for voice training.
                </div>

                <div className={styles.emptyStateAction}>
                  <Btn variant="primary" onClick={handleCreateDatasetClick} className={styles.emptyStateBtn} t={t}>
                    <span className={styles.emptyStateBtnInner}>
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
    prevProps.onCoverWithTracks === nextProps.onCoverWithTracks &&
    prevProps.handleTrainWithDataset === nextProps.handleTrainWithDataset &&
    prevProps.darkMode === nextProps.darkMode &&
    prevProps.optimisticTracks === nextProps.optimisticTracks &&
    prevProps.onOptimisticTracksChange === nextProps.onOptimisticTracksChange
  );
});
