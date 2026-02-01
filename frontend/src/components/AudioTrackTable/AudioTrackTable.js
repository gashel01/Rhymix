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
    showDatasetButton,
    showInferenceButton,
    handleTrainWithDataset,
    handleInferenceWithTracks,
    showInferenceResultsActions,
    onReturnToModelSelection,
    onReturnToInferenceParams,
    externalSelectedRows,
    onRowSelect,
    onSelectAll,
    onDeselectAll,
    onDeleteSelected,
    handleDownloadDataset,
    externalDeleteResult,
    onClearDeleteResult,
    defaultLabel,
    header,
    enableGrouping = false,
    onToggleFavorite,
  } = props;

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
      const favoriteCount = versions.filter((v) => v.isFavorite).length;
      const isExpanded = expandedGroups.has(key);
      output.push({
        ...latest,
        isGroupHeader: versions.length > 1,
        isGroupExpanded: isExpanded,
        groupKey: key,
        versionCount: versions.length,
        favoriteCount,
      });
      if (isExpanded && versions.length > 1) {
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
  }, [enableGrouping, expandedGroups, trackPairs]);

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
        selectedRows={selectedRows}
        trackPairs={selectableTrackPairs}
        onSelectAll={() =>
          onSelectAll ? onSelectAll() : setSelectedRows(selectableTrackPairs.map((p) => p.id))
        }
        onClear={() => (onDeselectAll ? onDeselectAll() : setSelectedRows([]))}
        onDelete={() => (onDeleteSelected ? onDeleteSelected() : setDeleteState((p) => ({ ...p, open: true })))}
        vocalMode={vocalMode}
        handleVocalModeChange={handleVocalModeChange}
        showVocalToggle={showVocalToggle}
        vocalModeType={vocalModeType}
        showDatasetButton={showDatasetButton}
        showInferenceButton={showInferenceButton}
        handleDownloadDataset={handleDownloadDataset}
        handleTrainWithDataset={handleTrainWithDataset}
        handleInferenceWithTracks={handleInferenceWithTracks}
        showInferenceResultsActions={showInferenceResultsActions}
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

        header={header}
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
              overflow: 'auto',
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
                  return (
                    <AudioTrackRow
                      key={pair.id || globalIndex}
                      pair={pair}
                      index={globalIndex}
                      status={pair.status || "completed"}
                      name={pair.displayName || pair.name || (vocalModeType === "inference" ? "Unknown Track" : getCleanFileName(pair.instrumental))}
                      modelUsed={vocalModeType === "inference" ? (pair.modelName ?? null) : null}
                      instrumentalUrl={pair.instrumentalUrl || (pair.fileId ? `/api/download/instrumental/${pair.fileId}` : undefined)}
                      vocalUrl={pair.vocalUrl || (pair.fileId ? `/api/download/${vocalsFileType}/${pair.fileId}` : undefined)}
                      playingBoth={playingBoth}
                      vocalMode={vocalMode}
                      vocalModeType={vocalModeType}
                      vocalsFileType={vocalsFileType}
                      isInstrumentalPlaying={isPlaying || playingFile?.name === pair.instrumentalKey}
                      isVocalPlaying={isPlaying || playingFile?.name === pair.vocalKey}
                      internalMutedInstrumentals={mutes.instrumental}
                      internalMutedVocals={ mutes.vocal}
                      volume={volume}
                      handlePlayPauseModified={handlePlayPauseModified}
                      handlePlayBothModified={handlePlayBothInternal}
                      handleDownload={handleDownload}
                      handleDownloadFullSong={downloadMergedAudio}
                      isSelected={selectedRows.includes(pair.id)}
                      onRowSelect={handleRowSelect}
                      isNew={pair.isNew}
                      paramsSummary={pair.paramsSummary}
                      processing={pair.processing}
                      createdAt={pair.createdAt}
                      groupKey={pair.groupKey}
                      isGroupHeader={pair.isGroupHeader}
                      isGroupExpanded={pair.isGroupExpanded}
                      isGroupedVersion={pair.isGroupedVersion}
                      versionCount={pair.versionCount}
                      favoriteCount={pair.favoriteCount}
                      isFavorite={pair.isFavorite}
                      onToggleGroup={enableGrouping ? handleToggleGroup : undefined}
                      onToggleFavorite={onToggleFavorite}
                    />
                  );
                })}

              </TableBody>
            </Table>
          </TableContainer>


        </div>

        {displayTrackPairs.length > pageSize && (
          <div className={styles.paginationOverlay} role="navigation" aria-label="Audio track pagination">
            <Button
              size="small"
              variant="text"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className={styles.paginationBtn}
            >
              Prev
            </Button>

            <div className={styles.paginationPages} aria-label={`Page ${page} of ${totalPages}`}>
              {pageItems.map((it, idx) =>
                it === "…" ? (
                  <span key={`ellipsis-${idx}`} className={styles.paginationEllipsis}>
                    …
                  </span>
                ) : (
                  <button
                    key={it}
                    type="button"
                    onClick={() => setPage(it)}
                    className={`${styles.pageBtn} ${it === page ? styles.pageBtnActive : ""}`}
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
              className={styles.paginationBtn}
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
