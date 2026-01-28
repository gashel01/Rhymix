import React, { useState, useEffect, useRef } from "react";
import { Box, Table, TableBody, TableContainer, Paper, Alert, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Button } from "@mui/material";
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
  } = props;

  const [mutes, setMutes] = useState({ instrumental: {}, vocal: {} });
  const [playingBoth, setPlayingBoth] = useState(playingBothProp);
  const [internalSelectedRows, setInternalSelectedRows] = useState([]);
  const [deleteState, setDeleteState] = useState({ open: false, loading: false, result: null });
  const lastSeekedRef = useRef({});

  const selectedRows = externalSelectedRows ?? internalSelectedRows;
  const setSelectedRows = onRowSelect ? () => {} : setInternalSelectedRows;

  const getWaveform = (type, pair) => {
    const key = pair[type];
    return props[`${type}Waveforms`][key] || props[`${type}Waveforms`][getFileNameFromPath(key)];
  };

  const handlePlayBothInternal = (inst, vocal) => {
    const instKey = getFileNameFromPath(inst), vocalKey = getFileNameFromPath(vocal);
    const id = `${instKey}-${vocalKey}`;
    const isPlaying = playingBoth?.id === id;
    const pair = trackPairs.find(p => getFileNameFromPath(p.instrumental) === instKey);

    [getWaveform('instrumental', pair), getWaveform('vocal', pair)].forEach(wf => {
      if (!wf) return;
      isPlaying ? wf.pause() : wf.play();
      wf.setMuted?.(false);
    });

    setMutes(prev => ({ 
      instrumental: { ...prev.instrumental, [inst]: false }, 
      vocal: { ...prev.vocal, [vocal]: false } 
    }));
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

  return (
    <Box className={styles.container}>
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
      />

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

      <TableContainer component={Paper} variant="outlined" className={styles.tableContainer}>
        <Table className={styles.table}>
          <AudioTrackHeader
            vocalMode={vocalMode}
            handleVocalModeChange={handleVocalModeChange}
            showVocalToggle={showVocalToggle}
            vocalModeType={vocalModeType}
            showDeleteColumn
          />
          <TableBody>
            {trackPairs.map((pair, i) => {
              const pairId = `${getFileNameFromPath(pair.instrumental)}-${getFileNameFromPath(pair.vocal)}`;
              const isPlaying = playingBoth?.id === pairId;
              return (
                <AudioTrackRow 
                  key={pair.id || i} 
                  pair={pair} 
                  index={i}
                  status={pair.status || "completed"} 
                  name={ vocalModeType === "inference" ? getCleanFileNameAndModelForInference(pair.instrumental).name : getCleanFileName(pair.instrumental)}
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
                  handleDownloadFullSong={handleDownloadFullSong || downloadFullSong}
                  isSelected={selectedRows.includes(pair.id)}
                  onRowSelect={handleRowSelect}
                />
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

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
    </Box>
  );
};

export default AudioTrackTable;
