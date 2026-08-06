import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { Box, Table, TableBody, TableContainer, Paper, Alert, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Button } from "@mui/material";
import { useVirtualizer } from "@tanstack/react-virtual";
import AudioTrackHeader from "./AudioTrackHeader";
import AudioTrackRow from "./AudioTrackRow";
import AudioTableActions from "./AudioTableActions";
import { useWaveformSync } from "../../hooks/useWaveformSync";
import { downloadMergedAudio } from "../../utils/audioUtils";
import { safeSetMuted, getCleanFileName } from "./utils";
import { deleteFiles } from "../../utils/apiService";
import { Theme } from "../Homeview/Theme";
import styles from "./AudioTrackTable.module.css";

const parseCreatedAt = (value) => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};


const AudioTrackTable = (props) => {
  const {
    trackPairs = [],
    pageSize: pageSizeProp = 10,
    vocalMode = "raw",

    vocalsFileType = "processed_vocals",
    volume,
    playingBoth: playingBothProp,
    handleVocalModeChange,
    vocalModeType,
    handleDownload,
    showVocalToggle,
    enablePerFileVocalToggle = false,
    showDatasetButton,
    showInferenceButton,
    handleTrainWithDataset,
    handleInferenceWithTracks,
    showInferenceResultsActions,
    showHeaderWorkflowActions,
    showSelectionControls,
    hideActionBar,
    onReturnToModelSelection,
    onRowModelSelection,
    onReturnToInferenceParams,
    onRowInferenceParams,
    externalSelectedRows,
    onRowSelect,
    onSelectAll,
    onDeselectAll,
    onDeleteSelected,
    handleCoverWithTracks,
    handleDownloadDataset,
    externalDeleteResult,
    onClearDeleteResult,
    defaultLabel,
    header,
    enableGrouping = false,
    onSetReaction,
    reactionPendingByRunId,
    darkMode,
    vocalModeByGroupKey = {},
    onGroupVocalModeChange,
  } = props;

  const resolvedVocalsFileType =
    typeof vocalsFileType === "function" ? vocalsFileType(vocalMode) : vocalsFileType;
  const effectiveVocalsFileType = resolvedVocalsFileType || "processed_vocals";

  const { t } = Theme({ darkMode });

  const [mutes, setMutes] = useState({ instrumental: {}, vocal: {} });
  const [playingBoth, setPlayingBoth] = useState(playingBothProp);
  const [internalSelectedRows, setInternalSelectedRows] = useState([]);
  const [deleteState, setDeleteState] = useState({ open: false, loading: false, result: null });
  const [page, setPage] = useState(1);
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const lastSeekedRef = useRef({});
  const parentRef = useRef(null);
  const { instrumentalWaveforms = {}, vocalWaveforms = {} } = {};
  const { playingFile } = {}

  const selectedRows = externalSelectedRows ?? internalSelectedRows;
  const setSelectedRows = onRowSelect ? () => { } : setInternalSelectedRows;

  const pageSize = Math.max(1, Number(pageSizeProp) || 10);

  const handleToggleGroup = useCallback((groupKey) => {
    if (!groupKey) return;
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!enableGrouping) return;
    const keys = new Set(trackPairs.map((pair) => pair.groupKey).filter(Boolean));
    setExpandedGroups((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set([...prev].filter((key) => keys.has(key)));
      return next.size === prev.size ? prev : next;
    });
  }, [enableGrouping, trackPairs]);

  const displayTrackPairs = useMemo(() => {
    if (!enableGrouping) return trackPairs;

    const isInferenceMode = vocalModeType === "inference";
    const groups = new Map();
    const order = [];

    trackPairs.forEach((pair) => {
      const key = pair.groupKey || pair.runId || pair.id;
      if (!groups.has(key)) {
        groups.set(key, []);
        order.push(key);
      }
      groups.get(key).push(pair);
    });

    const output = [];
    order.forEach((key) => {
      const versions = [...(groups.get(key) || [])].sort(
        (a, b) => parseCreatedAt(b.createdAt) - parseCreatedAt(a.createdAt)
      );
      if (versions.length === 0) return;
      const latest = versions[0];
      const favoriteCount = versions.filter((v) => (v.reaction || "none") === "favorite").length;
      const isExpanded = expandedGroups.has(key);
      output.push({
        ...latest,
        isGroupHeader: !isInferenceMode && versions.length > 1,
        isGroupExpanded: !isInferenceMode && isExpanded,
        groupKey: key,
        versionCount: versions.length,
        favoriteCount,
      });
      if (!isInferenceMode && isExpanded && versions.length > 1) {
        versions.slice(1).forEach((version, index) => {
          output.push({
            ...version,
            isGroupedVersion: true,
            groupKey: key,
            versionIndex: index + 1,
            versionCount: versions.length,
          });
        });
      }
    });

    return output;
  }, [enableGrouping, expandedGroups, trackPairs, vocalModeType]);

  /* The pagination sits at the bottom of the list and the selection bar is
     fixed to the bottom of the viewport, so without this they land on each
     other. A sticky element cannot be pushed above its own static position, so the bar
     is the one that moves: publish how much room the pagination needs and let
     it offset itself by that. */
  const paginationVisible = displayTrackPairs.length > pageSize;
  useEffect(() => {
    if (!paginationVisible) {
      document.body.style.removeProperty("--rhymix-pagination-h");
      return undefined;
    }
    document.body.style.setProperty("--rhymix-pagination-h", "60px");
    return () => document.body.style.removeProperty("--rhymix-pagination-h");
  }, [paginationVisible]);


  const versionsByGroupKey = useMemo(() => {
    const groups = new Map();
    (trackPairs || []).forEach((pair) => {
      const key = pair?.groupKey || pair?.runId || pair?.id;
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(pair);
    });
    groups.forEach((versions, key) => {
      groups.set(
        key,
        [...versions].sort((a, b) => parseCreatedAt(b?.createdAt) - parseCreatedAt(a?.createdAt))
      );
    });
    return groups;
  }, [trackPairs]);

  const selectableTrackPairs = useMemo(
    () => displayTrackPairs.filter((pair) => pair.status !== "processing" && pair.status !== "failed"),
    [displayTrackPairs]
  );

  const totalPages = Math.max(1, Math.ceil(displayTrackPairs.length / pageSize));

  // Keep page in range if data/pageSize changes
  useEffect(() => {
    setPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [totalPages]);

  // Scroll to top when changing page
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    if (typeof el.scrollTo === "function") el.scrollTo({ top: 0, left: 0, behavior: "auto" });
    else el.scrollTop = 0;
  }, [page]);

  const paginatedTrackPairs = useMemo(() => {
    if (!Array.isArray(displayTrackPairs) || displayTrackPairs.length === 0) return [];
    const start = (page - 1) * pageSize;
    return displayTrackPairs.slice(start, start + pageSize);
  }, [displayTrackPairs, page, pageSize]);

  const handleSelectAllAction = useCallback(() => {
    if (onSelectAll) {
      onSelectAll();
      return;
    }
    setSelectedRows(selectableTrackPairs.map((p) => p.id));
  }, [onSelectAll, selectableTrackPairs, setSelectedRows]);

  const handleClearAction = useCallback(() => {
    if (onDeselectAll) {
      onDeselectAll();
      return;
    }
    setSelectedRows([]);
  }, [onDeselectAll, setSelectedRows]);

  const handleDeleteAction = useCallback(() => {
    if (onDeleteSelected) {
      onDeleteSelected();
      return;
    }
    setDeleteState((prev) => ({ ...prev, open: true }));
  }, [onDeleteSelected]);

  const resolvedHeader =
    typeof header === "function"
      ? header({
        selectedRows,
        selectedCount: selectedRows.length,
        onSelectAll: handleSelectAllAction,
        onClear: handleClearAction,
        onDelete: handleDeleteAction,
      })
      : header;

  const getWaveform = (type, pair) => {
    const key = type === "instrumental" ? pair.instrumentalKey : pair.vocalKey;
    const waveforms = type === "instrumental" ? instrumentalWaveforms : vocalWaveforms;
    return waveforms[key];
  };

  const handlePlayBothInternal = (pairId) => {
    const id = pairId;
    const isPlaying = playingBoth?.id === id;
    const pair = displayTrackPairs.find(p => p.id === pairId);

    [getWaveform('instrumental', pair), getWaveform('vocal', pair)].forEach(wf => {
      if (!wf) return;
      isPlaying ? wf.pause() : wf.play();
    });
    setPlayingBoth(isPlaying ? null : { id });
  };

  const handlePlayPauseModified = React.useCallback((type, name, refs) => {
    const isInst = type === "instrumental";
    const targetKey = isInst ? "instrumental" : "vocal";

    setMutes((prev) => {
      const currentMuted = !!prev[targetKey][name];
      const nextMuted = !currentMuted;
      safeSetMuted(isInst ? refs.instrumental : refs.vocal, nextMuted);

      return {
        ...prev,
        [targetKey]: {
          ...prev[targetKey],
          [name]: nextMuted,
        },
      };
    });
  }, []);


  // Sync Interval
  useEffect(() => {
    const interval = setInterval(() => {
      displayTrackPairs.forEach(pair => {
        const [iw, vw] = [getWaveform('instrumental', pair), getWaveform('vocal', pair)];
        if (iw && vw) {
          const [it, vt] = [iw.getCurrentTime() || 0, vw.getCurrentTime() || 0];
          if (Math.abs(it - vt) > 0.05) {
            lastSeekedRef.current[pair.id] === 'vocal' ? iw.setCurrentTime(vt) : vw.setCurrentTime(it);
          }
        }
      });
    }, 50);
    return () => clearInterval(interval);
  }, [displayTrackPairs, instrumentalWaveforms, vocalWaveforms]);

  useWaveformSync(playingBoth, instrumentalWaveforms, vocalWaveforms, () => {
    setPlayingBoth(null);
  });

  useEffect(() => {
    setPlayingBoth(playingBothProp ?? null);
  }, [playingBothProp]);

  const handleRowSelect = React.useCallback(
    (id, checked) => {
      if (onRowSelect) {
        onRowSelect(id, checked);
        return;
      }
      setSelectedRows((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));
    },
    [onRowSelect, setSelectedRows]
  );

  const handleOpenStudio = useCallback((pair) => {
    // For inference rows: use `run:<runId>` so the backend resolves the inferred vocal,
    // and pass the original upload's fileId so the instrumental can be resolved too.
    let assetId;
    let searchParams = "";
    if (pair?.runId) {
      assetId = `run:${pair.runId}`;
      const sourceFileId = pair?.fileId || pair?.result?.inputFileId || pair?.result?.fileId || null;
      if (sourceFileId) searchParams = `?sourceFileId=${encodeURIComponent(sourceFileId)}`;
    } else {
      assetId = pair?.fileId || pair?.id || pair?.trackId;
    }
    if (!assetId) return;
    const url = `/studio/${encodeURIComponent(assetId)}${searchParams}`;
    window.history.pushState({}, "", url);
    try {
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (err) {
      window.dispatchEvent(new Event("popstate"));
    }
  }, []);

  const resolveVocalSourceForRow = useCallback(
    (pair) => {
      const groupKey = pair?.groupKey || pair?.runId || pair?.id;
      const requested = vocalModeByGroupKey?.[groupKey];
      if (vocalModeType === "inference") {
        const versions =
          versionsByGroupKey.get(groupKey) ||
          (pair ? [pair] : []);
        const originalType = pair?.vocalFileType || effectiveVocalsFileType || "processed_vocals";
        const originalId = pair?.originalVocalId || pair?.fileId || pair?.result?.inputFileId || null;
        const originalUrl =
          pair?.originalVocalUrl ||
          (originalId ? `/api/download/${originalType}/${originalId}` : null);

        if (requested === "original") {
          const inferredOptions = versions
            .filter((v) => (v?.runId || v?.id))
            .map((v, idx) => ({
              value: v?.runId || v?.id,
              label: v?.modelName || `Inferred ${idx + 1}`,
            }));
          return {
            vocalMode: "original",
            vocalsFileType: originalType,
            vocalPath: originalId || pair?.vocal || pair?.runId || null,
            vocalUrl: originalUrl || pair?.vocalUrl || null,
            activeMetadataPair: pair,
            selectedVocalSource: "original",
            activeConvertedLabel: null,
            vocalSourceOptions: inferredOptions.length
              ? inferredOptions
              : [
                {
                  value: pair?.runId || pair?.id || "inferred",
                  label: pair?.modelName || "Inferred",
                },
              ],
            showToggle: enablePerFileVocalToggle,
          };
        }

        let selectedVersion = versions[0] || pair;
        if (requested && requested !== "converted") {
          const match = versions.find((v) => String(v?.runId || v?.id) === String(requested));
          if (match) selectedVersion = match;
        }

        const convertedPath =
          selectedVersion?.convertedVocalId ||
          selectedVersion?.runId ||
          selectedVersion?.vocal ||
          pair?.convertedVocalId ||
          pair?.runId ||
          pair?.vocal ||
          null;
        const convertedUrl =
          selectedVersion?.convertedVocalUrl ||
          selectedVersion?.vocalUrl ||
          pair?.convertedVocalUrl ||
          pair?.vocalUrl ||
          null;

        return {
          vocalMode: "converted",
          vocalsFileType: "inference",
          vocalPath: convertedPath,
          vocalUrl: convertedUrl,
          activeMetadataPair: selectedVersion || pair,
          selectedVocalSource: selectedVersion?.runId || selectedVersion?.id || "converted",
          activeConvertedLabel: selectedVersion?.modelName || pair?.modelName || "Inferred",
          vocalSourceOptions: versions
            .filter((v) => (v?.runId || v?.id))
            .map((v, idx) => ({
              value: v?.runId || v?.id,
              label: v?.modelName || `Inferred ${idx + 1}`,
            })),
          showToggle: enablePerFileVocalToggle,
        };
      }

      const rawVocalUrl =
        pair?.rawVocalUrl ||
        pair?.originalVocalUrl ||
        null;
      const processedVocalUrl =
        pair?.processedVocalUrl ||
        pair?.convertedVocalUrl ||
        pair?.vocalUrl ||
        null;
      const rawVocalPath =
        pair?.rawVocalPath ||
        pair?.originalVocalId ||
        pair?.fileId ||
        null;
      const processedVocalPath =
        pair?.processedVocalPath ||
        pair?.convertedVocalId ||
        pair?.fileId ||
        null;
      const hasRaw = Boolean(rawVocalUrl || rawVocalPath);
      const hasProcessed = Boolean(processedVocalUrl || processedVocalPath);
      const canToggle = Boolean(enablePerFileVocalToggle && hasRaw && hasProcessed);
      const defaultSource = requested || (vocalMode === "processed" ? "processed" : "original");
      let selectedSource = defaultSource;
      if (selectedSource === "original" && !hasRaw && hasProcessed) selectedSource = "processed";
      if (selectedSource === "processed" && !hasProcessed && hasRaw) selectedSource = "original";
      if (!hasRaw && !hasProcessed) selectedSource = "original";
      const isOriginal = selectedSource === "original";
      const activeUrl = isOriginal ? rawVocalUrl : processedVocalUrl;
      const activePath = isOriginal ? rawVocalPath : processedVocalPath;
      const activeType = isOriginal ? "raw_vocals" : "processed_vocals";

      return {
        vocalMode: isOriginal ? "original" : "converted",
        vocalsFileType: activeType,
        vocalPath: activePath || pair?.vocal || pair?.fileId || null,
        vocalUrl: activeUrl || pair?.vocalUrl || null,
        activeMetadataPair: pair,
        selectedVocalSource: isOriginal ? "original" : "processed",
        activeConvertedLabel: "processed",
        vocalSourceOptions: hasProcessed
          ? [{ value: "processed", label: "processed" }]
          : [],
        showToggle: canToggle,
      };
    },
    [effectiveVocalsFileType, enablePerFileVocalToggle, versionsByGroupKey, vocalMode, vocalModeByGroupKey, vocalModeType]
  );

  const virtualizer = useVirtualizer({
    count: paginatedTrackPairs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 5,
  });

  const pageItems = useMemo(() => {
    // Show: 1 ... (p-1) p (p+1) ... last
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const items = new Set([1, totalPages, page - 1, page, page + 1]);
    const filtered = [...items].filter((x) => x >= 1 && x <= totalPages).sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < filtered.length; i++) {
      out.push(filtered[i]);
      if (i < filtered.length - 1 && filtered[i + 1] - filtered[i] > 1) out.push("…");
    }
    return out;
  }, [page, totalPages]);

  return (
    <Box className={styles.container} style={{ border: "none" }} >
      <AudioTableActions
        darkMode={darkMode}
        selectedRows={selectedRows}
        trackPairs={selectableTrackPairs}
        onSelectAll={handleSelectAllAction}
        onClear={handleClearAction}
        onDelete={handleDeleteAction}
        vocalMode={vocalMode}
        handleVocalModeChange={handleVocalModeChange}
        showVocalToggle={showVocalToggle}
        vocalModeType={vocalModeType}
        showDatasetButton={showDatasetButton}
        showInferenceButton={showInferenceButton}
        handleDownloadDataset={handleDownloadDataset}
        handleTrainWithDataset={handleTrainWithDataset}
        handleInferenceWithTracks={handleInferenceWithTracks}
        handleCoverWithTracks={handleCoverWithTracks}
        showInferenceResultsActions={showInferenceResultsActions}
        showHeaderWorkflowActions={showHeaderWorkflowActions}
        showSelectionControls={showSelectionControls}
        hideActionBar={hideActionBar}
        onReturnToModelSelection={onReturnToModelSelection}
        onReturnToInferenceParams={onReturnToInferenceParams}
        defaultLabel={defaultLabel}
        children={<AudioTrackHeader
          vocalMode={vocalMode}
          handleVocalModeChange={handleVocalModeChange}
          showVocalToggle={showVocalToggle}
          vocalModeType={vocalModeType}
          showDeleteColumn
        />
        }

        header={resolvedHeader}
      />


      <div style={{ padding: "24px" }}>
        {(externalDeleteResult || deleteState.result) && (
          <Alert
            severity={(externalDeleteResult || deleteState.result).error ? "error" : "success"}
            sx={{ mb: 2 }}
            onClose={() => {
              if (externalDeleteResult) {
                onClearDeleteResult?.();
                return;
              }
              setDeleteState((p) => ({ ...p, result: null }));
            }}
          >
            {(externalDeleteResult || deleteState.result).error
              ? `Error: ${(externalDeleteResult || deleteState.result).error}`
              : `Deleted ${(externalDeleteResult || deleteState.result).total_deleted} files.`}
          </Alert>
        )}

        <div className={styles.tableWrapper}>
          <TableContainer
            component={Paper}
            variant="outlined"
            className={styles.tableContainer}
            ref={parentRef}
            sx={{
              overflowX: "auto",
              overflowY: "scroll",

              border: "none",
              boxShadow: "none",
              background: "transparent",

            }}
          >
            <Table className={styles.table} stickyHeader>

              <TableBody
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  position: 'relative',
                }}
              >
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const pair = paginatedTrackPairs[virtualRow.index];
                  if (!pair) return null;
                  const globalIndex = (page - 1) * pageSize + virtualRow.index;
                  const pairId = pair.id;
                  const isPlaying = playingBoth?.id === pairId;
                  const groupKey = pair?.groupKey || pair?.runId || pair?.id;
                  const vocalSource = resolveVocalSourceForRow(pair);
                  const activeMeta = vocalSource.activeMetadataPair || pair;
                  const trackForCover =
                    pair?.result?.track ||
                    pair?.track ||
                    (pair?.fileId
                      ? {
                        fileId: pair.fileId,
                        id: pair.fileId,
                        displayName: pair?.displayName || pair?.name || null,
                        originalName: pair?.originalName || null,
                        vocalFileType: vocalSource.vocalsFileType || pair?.vocalFileType || pair?.result?.vocalFileType || null,
                      }
                      : null);
                  return (
                    <AudioTrackRow
                      key={pair.id || globalIndex}
                      pair={pair}
                      index={globalIndex}
                      status={pair.status || "completed"}
                      name={pair.displayName || pair.name || (vocalModeType === "inference" ? "Unknown Track" : getCleanFileName(pair.instrumental))}
                      modelUsed={
                        vocalModeType === "inference"
                          ? (vocalSource.activeConvertedLabel || activeMeta.modelName || pair.modelName || null)
                          : null
                      }
                      instrumentalUrl={pair.instrumentalUrl || (pair.fileId ? `/api/download/instrumental/${pair.fileId}` : undefined)}
                      vocalUrl={vocalSource.vocalUrl || pair.vocalUrl || (pair.fileId ? `/api/download/${effectiveVocalsFileType}/${pair.fileId}` : undefined)}
                      playingBoth={playingBoth}
                      vocalMode={vocalSource.vocalMode}
                      vocalModeType={vocalModeType}
                      vocalsFileType={vocalSource.vocalsFileType || effectiveVocalsFileType}
                      showPerFileVocalToggle={Boolean(vocalSource.showToggle)}
                      vocalPathOverride={vocalSource.vocalPath}
                      vocalUrlOverride={vocalSource.vocalUrl}
                      vocalSourceOptions={vocalSource.vocalSourceOptions}
                      selectedVocalSource={vocalSource.selectedVocalSource}
                      activeConvertedLabel={vocalSource.activeConvertedLabel}
                      onVocalSourceChange={
                        vocalSource.showToggle && onGroupVocalModeChange
                          ? (nextSource) => onGroupVocalModeChange(groupKey, nextSource)
                          : undefined
                      }
                      isInstrumentalPlaying={isPlaying || playingFile?.name === pair.instrumentalKey}
                      isVocalPlaying={isPlaying || playingFile?.name === pair.vocalKey}
                      internalMutedInstrumentals={mutes.instrumental}
                      internalMutedVocals={mutes.vocal}
                      volume={volume}
                      handlePlayPauseModified={handlePlayPauseModified}
                      handlePlayBothModified={handlePlayBothInternal}
                      handleDownload={handleDownload}
                      handleDownloadFullSong={downloadMergedAudio}
                      isSelected={selectedRows.includes(pair.id)}
                      onRowSelect={handleRowSelect}
                      isNew={pair.isNew}
                      paramsSummary={activeMeta.paramsSummary || pair.paramsSummary}
                      processing={pair.processing}
                      createdAt={activeMeta.createdAt || pair.createdAt}
                      groupKey={pair.groupKey}
                      isGroupHeader={pair.isGroupHeader}
                      isGroupExpanded={pair.isGroupExpanded}
                      isGroupedVersion={pair.isGroupedVersion}
                      versionCount={pair.versionCount}
                      favoriteCount={pair.favoriteCount}
                      reaction={activeMeta.reaction || pair.reaction || "none"}
                      reactionRunId={activeMeta.runId || pair.runId || null}
                      reactionPending={Boolean(reactionPendingByRunId?.[activeMeta.runId || pair.runId])}
                      onToggleGroup={enableGrouping ? handleToggleGroup : undefined}
                      onSetReaction={onSetReaction}
                      onOpenStudio={handleOpenStudio}
                      onMenuModelSelection={
                        onRowModelSelection
                          ? () => onRowModelSelection(pair, vocalSource)
                          : onReturnToModelSelection
                      }
                      onMenuInferenceParams={
                        onRowInferenceParams
                          ? () => onRowInferenceParams(pair)
                          : onReturnToInferenceParams
                      }
                      onMenuCover={trackForCover && handleCoverWithTracks ? () => handleCoverWithTracks([trackForCover]) : undefined}
                      onMenuDelete={() => {
                        handleRowSelect(pair.id, true);
                        if (onDeleteSelected) {
                          onDeleteSelected();
                          return;
                        }
                        setDeleteState((prev) => ({ ...prev, open: true }));
                      }}
                      darkMode={darkMode}
                    />
                  );
                })}

              </TableBody>
            </Table>
          </TableContainer>


        </div>

        {displayTrackPairs.length > pageSize && (
          <div
            role="navigation"
            aria-label="Audio track pagination"
            className={styles.paginationOverlay}
            style={{
              border: `1px solid ${t.hairline}`,
              background: t.isDark ? "rgba(20, 20, 22, 0.72)" : "rgba(255, 255, 255, 0.4)",
            }}
          >
            <Button
              size="small"
              variant="text"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              sx={{ minWidth: 0, color: t.text }}
            >
              Prev
            </Button>

            <div className={styles.paginationPages} aria-label={`Page ${page} of ${totalPages}`}>
              {pageItems.map((it, idx) =>
                it === "…" ? (
                  <span
                    key={`ellipsis-${idx}`}
                    className={styles.paginationEllipsis}
                    style={{ color: t.subtext }}
                  >
                    …
                  </span>
                ) : (
                  <button
                    key={it}
                    type="button"
                    onClick={() => setPage(it)}
                    className={styles.pageBtn}
                    style={{
                      border: `1px solid ${it === page ? (t.isDark ? "rgba(255, 255, 255, 0.28)" : t.primaryWash) : t.hairline}`,
                      background: it === page
                        ? (t.isDark ? "rgba(255, 255, 255, 0.22)" : "rgba(255,255,255,0.9)")
                        : t.isDark ? "rgba(255, 255, 255, 0.08)" : t.cardB,
                      color: t.text,
                      fontWeight: it === page ? 700 : 500,
                    }}
                    aria-current={it === page ? "page" : undefined}
                  >
                    {it}
                  </button>
                )
              )}
            </div>

            <Button
              size="small"
              variant="text"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              sx={{ minWidth: 0, color: t.text }}
            >
              Next
            </Button>
          </div>
        )}



        <Dialog open={deleteState.open} onClose={() => setDeleteState(p => ({ ...p, open: false }))}>
          <DialogTitle>Delete Tracks</DialogTitle>
          <DialogContent>Permanently remove {selectedRows.length} tracks?</DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleteState(p => ({ ...p, open: false }))}>Cancel</Button>
            <Button onClick={async () => {
              setDeleteState(p => ({ ...p, loading: true }));
              const files = displayTrackPairs
                .filter(p => selectedRows.includes(p.id))
                .map(p => p.fileId || p.id)
                .filter(Boolean);
              const res = await deleteFiles(files);
              setDeleteState({ open: false, loading: false, result: res });
              setSelectedRows([]);
              window.location.reload();
            }} color="error" variant="contained" disabled={deleteState.loading}>Delete</Button>
          </DialogActions>
        </Dialog>

      </div>
    </Box>
  );
};

export default AudioTrackTable;
