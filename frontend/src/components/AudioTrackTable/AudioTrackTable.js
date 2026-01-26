import React, { useState, useEffect, useRef, useMemo } from "react";
import { Box, Table, TableBody, TableContainer, Paper, Alert, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Button } from "@mui/material";
import AudioTrackHeader from "./AudioTrackHeader";
import AudioTrackRow from "./AudioTrackRow";
import AudioTableActions from "./AudioTableActions";
import { useWaveformSync } from "../../hooks/useWaveformSync";
import { downloadFullSong } from "../../utils/audioUtils";
import { safePlay, safePause, safeSetMuted, getFileNameFromPath, getCleanFileName, getCleanFileNameAndModelForInference } from "./utils";
import { deleteFiles } from "../../utils/apiService";
import styles from "./AudioTrackTable.module.css";


const AudioTrackTable = (props) => {
  const { trackPairs = [], vocalMode = "raw", instrumentalWaveforms = {}, vocalWaveforms = {}, vocalsFileType = "processed_vocals", stopAllAudio } = props;

  const [mutes, setMutes] = useState({ instrumental: {}, vocal: {} });
  const [playingBoth, setPlayingBoth] = useState(props.playingBoth);
  const [internalSelectedRows, setInternalSelectedRows] = useState([]);
  const [deleteState, setDeleteState] = useState({ open: false, loading: false, result: null });
  const lastSeekedRef = useRef({});

  const selectedRows = props.externalSelectedRows ?? internalSelectedRows;
  const setSelectedRows = props.onRowSelect ? () => {} : setInternalSelectedRows;

  const getWaveform = (type, pair) => {
    const key = pair[type];
    return props[`${type}Waveforms`][key] || props[`${type}Waveforms`][getFileNameFromPath(key)];
  };

  const handlePlayBoth = (inst, vocal) => {
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

  return (
    <Box className={styles.container}>
      <AudioTableActions {...props} selectedRows={selectedRows} 
        onSelectAll={() => props.onSelectAll ? props.onSelectAll() : setSelectedRows(trackPairs.map(p => p.id))}
        onClear={() => props.onDeselectAll ? props.onDeselectAll() : setSelectedRows([])}
        onDelete={() => props.onDeleteSelected ? props.onDeleteSelected() : setDeleteState(p => ({ ...p, open: true }))}
      />

      {deleteState.result && (
        <Alert severity={deleteState.result.error ? "error" : "success"} sx={{ mb: 2 }} onClose={() => setDeleteState(p => ({ ...p, result: null }))}>
          {deleteState.result.error ? `Error: ${deleteState.result.error}` : `Deleted ${deleteState.result.total_deleted} files.`}
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined" className={styles.tableContainer}>
        <Table className={styles.table}>
          <AudioTrackHeader vocalMode={vocalMode} handleVocalModeChange={props.handleVocalModeChange} showVocalToggle={props.showVocalToggle} vocalModeType={props.vocalModeType} showDeleteColumn />
          <TableBody>
            {trackPairs.map((pair, i) => {
              const pairId = `${getFileNameFromPath(pair.instrumental)}-${getFileNameFromPath(pair.vocal)}`;
              const isPlaying = playingBoth?.id === pairId;
              return (
                <AudioTrackRow 
                  {...props}
                  key={pair.id || i} 
                  pair={pair} 
                  index={i}
                  status={pair.status || "completed"} 
                  name={ props.vocalModeType === "inference" ? getCleanFileNameAndModelForInference(pair.instrumental).name : getCleanFileName(pair.instrumental)}
                  modelUsed={props.vocalModeType === "inference" ? getCleanFileNameAndModelForInference(pair.instrumental).model : null}
                  instrumentalUrl={pair.instrumentalUrl || `/api/download/instrumental/${pair.instrumental}`}
                  vocalUrl={pair.vocalUrl || `/api/download/${vocalsFileType}/${pair.vocal}`}
                  playingBoth={playingBoth}
                  isInstrumentalPlaying={isPlaying || getFileNameFromPath(props.playingFile?.name) === getFileNameFromPath(pair.instrumental)}
                  isVocalPlaying={isPlaying || getFileNameFromPath(props.playingFile?.name) === getFileNameFromPath(pair.vocal)}
                  internalMutedInstrumentals={mutes.instrumental}
                  internalMutedVocals={mutes.vocal}
                  handlePlayPauseModified={(type, name, refs) => {
                    const isInst = type === "instrumental";
                    const newState = !mutes[isInst ? 'instrumental' : 'vocal'][name];
                    setMutes(prev => ({ ...prev, [isInst ? 'instrumental' : 'vocal']: { ...prev[isInst ? 'instrumental' : 'vocal'], [name]: newState } }));
                    safeSetMuted(isInst ? refs.instrumental : refs.vocal, newState);
                  }}
                  handlePlayBothModified={handlePlayBoth}
                  handleDownloadFullSong={downloadFullSong}
                  isSelected={selectedRows.includes(pair.id)}
                  onRowSelect={(id, checked) => props.onRowSelect ? props.onRowSelect(id, checked) : setSelectedRows(prev => checked ? [...prev, id] : prev.filter(x => x !== id))}
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