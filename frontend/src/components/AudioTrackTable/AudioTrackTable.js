import React, { useMemo, useState, useEffect, useRef } from "react";
import { Box, Table, TableBody, TableContainer, Paper, Alert, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Button } from "@mui/material";
import { useVirtualizer } from "@tanstack/react-virtual";
import AudioTrackHeader from "./AudioTrackHeader";
import AudioTrackRow from "./AudioTrackRow";
import AudioTableActions from "./AudioTableActions";
import { useWaveformSync } from "../../hooks/useWaveformSync";
import { downloadFullSong } from "../../utils/audioUtils";
import { safeSetMuted, getFileNameFromPath, getCleanFileName, getCleanFileNameAndModelForInference } from "./utils";
import { deleteFiles } from "../../utils/apiService";
import styles from "./AudioTrackTable.module.css";


const AudioTrackTable = (props) => {
  const {
    trackPairs = [],
    pageSize: pageSizeProp = 10,
    vocalMode = "raw",
    instrumentalWaveforms = {},
    vocalWaveforms = {},
    vocalsFileType = "processed_vocals",
    stopAllAudio,
    volume,
    playingFile,
    playingBoth: playingBothProp,
    handleVocalModeChange,
    vocalModeType,
    handleDownload,
    handleDownloadFullSong,
    handleInstrumentalWaveformReady,
    handleVocalWaveformReady,
    showVocalToggle,
    enablePlayBoth,
    showDatasetButton,
    showInferenceButton,
    hasExports,
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
    mutedInstrumentals,
    mutedVocals,
    header,
  } = props;

  const [mutes, setMutes] = useState({ instrumental: {}, vocal: {} });
  const [playingBoth, setPlayingBoth] = useState(playingBothProp);
  const [internalSelectedRows, setInternalSelectedRows] = useState([]);
  const [deleteState, setDeleteState] = useState({ open: false, loading: false, result: null });
  const [page, setPage] = useState(1);
  const lastSeekedRef = useRef({});
  const parentRef = useRef(null);

  const selectedRows = externalSelectedRows ?? internalSelectedRows;
  const setSelectedRows = onRowSelect ? () => { } : setInternalSelectedRows;

  const pageSize = Math.max(1, Number(pageSizeProp) || 10);
  const totalPages = Math.max(1, Math.ceil(trackPairs.length / pageSize));

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
    if (!Array.isArray(trackPairs) || trackPairs.length === 0) return [];
    const start = (page - 1) * pageSize;
    return trackPairs.slice(start, start + pageSize);
  }, [trackPairs, page, pageSize]);

  const getWaveform = (type, pair) => {
    const key = pair[type];
    const waveforms = type === "instrumental" ? instrumentalWaveforms : vocalWaveforms;
    return waveforms[key] || waveforms[getFileNameFromPath(key)];
  };

  const handlePlayBothInternal = (inst, vocal) => {
    const instKey = getFileNameFromPath(inst), vocalKey = getFileNameFromPath(vocal);
    const id = `${instKey}-${vocalKey}`;
    const isPlaying = playingBoth?.id === id;
    const pair = trackPairs.find(p => getFileNameFromPath(p.instrumental) === instKey);

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
      trackPairs.forEach(pair => {
        const [iw, vw] = [getWaveform('instrumental', pair), getWaveform('vocal', pair)];
        if (iw && vw) {
          const [it, vt] = [iw.getCurrentTime() || 0, vw.getCurrentTime() || 0];
          if (Math.abs(it - vt) > 0.05) {
            lastSeekedRef.current[`${pair.instrumental}-${pair.vocal}`] === 'vocal' ? iw.setCurrentTime(vt) : vw.setCurrentTime(it);
          }
        }
      });
    }, 50);
    return () => clearInterval(interval);
  }, [trackPairs, instrumentalWaveforms, vocalWaveforms]);

  useWaveformSync(playingBoth, instrumentalWaveforms, vocalWaveforms, () => {
    setPlayingBoth(null);
    stopAllAudio?.();
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
        trackPairs={trackPairs}
        onSelectAll={() => (onSelectAll ? onSelectAll() : setSelectedRows(trackPairs.map((p) => p.id)))}
        onClear={() => (onDeselectAll ? onDeselectAll() : setSelectedRows([]))}
        onDelete={() => (onDeleteSelected ? onDeleteSelected() : setDeleteState((p) => ({ ...p, open: true })))}
        vocalMode={vocalMode}
        handleVocalModeChange={handleVocalModeChange}
        showVocalToggle={showVocalToggle}
        vocalModeType={vocalModeType}
        showDatasetButton={showDatasetButton}
        showInferenceButton={showInferenceButton}
        handleDownloadDataset={handleDownloadDataset}
        hasExports={hasExports}
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
                  const pairId = `${getFileNameFromPath(pair.instrumental)}-${getFileNameFromPath(pair.vocal)}`;
                  const isPlaying = playingBoth?.id === pairId;
                  return (
                    <AudioTrackRow
                      key={pair.id || globalIndex}
                      pair={pair}
                      index={globalIndex}
                      status={pair.status || "completed"}
                      name={vocalModeType === "inference" ? getCleanFileNameAndModelForInference(pair.instrumental).name : getCleanFileName(pair.instrumental)}
                      modelUsed={vocalModeType === "inference" ? getCleanFileNameAndModelForInference(pair.instrumental).model : null}
                      instrumentalUrl={pair.instrumentalUrl || `/api/download/instrumental/${pair.instrumental}`}
                      vocalUrl={pair.vocalUrl || `/api/download/${vocalsFileType}/${pair.vocal}`}
                      playingBoth={playingBoth}
                      vocalMode={vocalMode}
                      vocalsFileType={vocalsFileType}
                      isInstrumentalPlaying={isPlaying || getFileNameFromPath(playingFile?.name) === getFileNameFromPath(pair.instrumental)}
                      isVocalPlaying={isPlaying || getFileNameFromPath(playingFile?.name) === getFileNameFromPath(pair.vocal)}
                      internalMutedInstrumentals={mutedInstrumentals || mutes.instrumental}
                      internalMutedVocals={mutedVocals || mutes.vocal}
                      volume={volume}
                      handlePlayPauseModified={handlePlayPauseModified}
                      handlePlayBothModified={handlePlayBothInternal}
                      handleDownload={handleDownload}
                      handleInstrumentalWaveformReady={handleInstrumentalWaveformReady}
                      handleVocalWaveformReady={handleVocalWaveformReady}
                      handleDownloadFullSong={handleDownloadFullSong || downloadFullSong}
                      isSelected={selectedRows.includes(pair.id)}
                      onRowSelect={handleRowSelect}

                    />
                  );
                })}

              </TableBody>
            </Table>
          </TableContainer>


        </div>

        {trackPairs.length > pageSize && (
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
              const files = trackPairs.filter(p => selectedRows.includes(p.id)).flatMap(p => [p.vocal, p.instrumental]);
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
