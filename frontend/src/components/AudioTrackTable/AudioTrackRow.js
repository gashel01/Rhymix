import React, { useRef, useMemo, useCallback } from 'react';
import { TableRow, TableCell, Checkbox, Grid, Typography, LinearProgress, Box } from '@mui/material';
import ErrorIcon from '@mui/icons-material/Error';
import TextOverflow from '../TextOverflow.tsx';
import WaveformCell from './WaveformCell';
import TrackControls from './TrackControls';
import { getCleanFileName, getFileNameFromPath } from './utils';
import styles from './AudioTrackRow.module.css';
const AudioTrackRow = (props) => {
  const { pair, index, vocalMode, vocalsFileType, isInstrumentalPlaying, isVocalPlaying, 
    internalMutedInstrumentals, internalMutedVocals, isSelected, onRowSelect, name , modelUsed,
    handlePlayPauseModified, handlePlayBothModified, handleDownload, playingBoth, status = "completed" } = props;

  const iwRef = useRef(null);
  const vwRef = useRef(null);

  // Compatibility: Handle different schemas
  const instPath = pair.instrumental || pair.original;
  const vocalPath = pair.vocal || pair.converted;
  const trackPairId = `${getFileNameFromPath(instPath)}-${getFileNameFromPath(vocalPath)}`;
  const isCurrentlyPlayingBoth = Boolean(playingBoth && playingBoth.id === trackPairId);

  // Handler for when vocal waveform is ready - sync position with instrumental
  const handleVocalReady = useCallback((wf) => {
    vwRef.current = wf;
    // Sync vocal position with instrumental if instrumental exists and has a valid position
    if (iwRef.current?.getCurrentTime) {
      const instTime = iwRef.current.getCurrentTime();
      if (instTime > 0 && wf?.setCurrentTime) {
        wf.setCurrentTime(instTime);
      }
    }
  }, []);

  // Handler for when instrumental waveform is ready
  const handleInstReady = useCallback((wf) => {
    iwRef.current = wf;
  }, []);

  const renderWaveform = (type, path, isPlaying, isMuted, color, onSeek) => {
    if (status === "processing") return <LinearProgress sx={{ width: '100%', height: 70, borderRadius: '4px', bgcolor: '#333', '& .MuiLinearProgress-bar': { bgcolor: color } }} />;
    if (status === "failed") return <Box sx={{ height: 60, bgcolor: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 1 }}><ErrorIcon color="error" /></Box>;
    
    const url = type === 'inst' 
      ? (pair.instrumentalUrl || `/api/download/instrumental/${path}`)
      : (pair.vocalUrl || `/api/download/${vocalsFileType}/${path}`);

    return (
      <WaveformCell 
        url={url} isPlaying={isPlaying} isMuted={isMuted} progressColor={color}
        onPlayPause={() => handlePlayPauseModified(type === 'inst' ? "instrumental" : vocalsFileType, path, { instrumental: iwRef.current, vocal: vwRef.current })}
        onDownload={() => handleDownload(type === 'inst' ? 'instrumental' : vocalsFileType, path)}
        onReady={type === 'inst' ? handleInstReady : handleVocalReady}
        onSeek={onSeek} badgeText={type === 'vocal' ? vocalMode : null}
      />
    );
  };

  return (
    <TableRow className={styles.row}>
      <TableCell width="10%" className={styles.trackNameCell}>
        <TextOverflow text={props.name || getCleanFileName(props.name) || `Track ${index + 1}`} style={{ fontWeight: 600 }} />
        {modelUsed && <Typography
            variant="body2"
            color="#34C759"
            sx={{
              fontSize: '0.6rem',
              // Spacing
              px: '8px',               // padding-left & padding-right: 12px
              py: '4px',                // padding-top & padding-bottom: 4px
              borderRadius: '6px',      // border-radius: 9px
              
              // Layout
              display: 'flex',
              alignItems: 'left',
              whiteSpace: 'nowrap',
              
              // Visuals
              backgroundColor: 'rgba(76, 175, 80, 0.15)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              
              // Ensure width fits content since it's a flex item
              width: 'fit-content' 
            }}
          >
            {modelUsed}
          </Typography>}
      </TableCell>

      <TableCell className={styles.waveformsCell} sx={{ position: 'relative', p: 1 }}>
        <Grid container spacing={1} sx={{ pr: 6, alignItems: 'center' }}>
          <Grid item xs={12} md={5.5}>
            {renderWaveform('inst', instPath, isInstrumentalPlaying, internalMutedInstrumentals[instPath], "#ff9800", (t) => vwRef.current?.setCurrentTime?.(t))}
          </Grid>
          
          <Grid item xs={12} md={1} className={styles.controlsSpacer} sx={{ display: 'flex', justifyContent: 'center' }}>
            <TrackControls 
              instrumental={instPath} vocal={vocalPath} 
              isPlaying={isCurrentlyPlayingBoth} // FIXED: Drives the Toggle
              onPlayBoth={() => handlePlayBothModified(instPath, vocalPath, vocalsFileType)}
              onDownloadFullSong={props.handleDownloadFullSong} 
              disabled={status === "processing"} 
            />
          </Grid>

          <Grid item xs={12} md={5.5}>
            {renderWaveform('vocal', vocalPath, isVocalPlaying, internalMutedVocals[vocalPath], "#1976d2", (t) => iwRef.current?.setCurrentTime?.(t))}
          </Grid>
        </Grid>
        <Checkbox checked={isSelected} onChange={(e) => onRowSelect?.(pair.id, e.target.checked)} size="small" sx={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }} />
      </TableCell>
    </TableRow>
  );
};

export default AudioTrackRow;