import React from 'react';
import { Box, IconButton, Tooltip, CircularProgress } from '@mui/material';
import PlayAllIcon from '@mui/icons-material/PlaylistPlay';
import PauseIcon from '@mui/icons-material/Pause';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import { Theme } from '../Homeview/Theme';
import styles from './TrackControls.module.css';

function TrackControls({
  instrumental,
  vocal,
  isPlaying,
  onPlayBoth,
  onDownloadFullSong,
  disabled = false,
  downloadDisabledReason,
  downloading = false,
  darkMode,
}) {
  const { t } = Theme({ darkMode });
  const missing = !instrumental || !vocal;
  const downloadDisabled = disabled || downloading || missing;
  const downloadTitle = downloadDisabledReason || (downloading ? "Preparing download..." : "Download full song");
  return (
    <Box
      className={styles.container}
      style={{
        backgroundColor: t.isDark ? "rgba(0, 0, 0, 0.4)" : t.cardB, // using cardB or darker
        border: t.isDark ? "none" : `1px solid ${t.hairline}`
      }}
    >
      <IconButton
        size="small"
        disabled={disabled || !instrumental || !vocal}
        onClick={onPlayBoth}
        color={isPlaying ? "primary" : "default"}
        className={styles.playButton}
        style={{ position: 'absolute' }} // Restored
      >
        {isPlaying ? <PauseIcon fontSize="small" /> : <PlayAllIcon fontSize="small" />}
      </IconButton>

      <Tooltip title={downloadTitle}>
        <IconButton
          className={styles.downloadButton}
          size="small"
          style={{ position: 'absolute' }} // Restored
          onClick={() => (onDownloadFullSong || (() => { }))()}
          disabled={downloadDisabled}
        >
          {downloading ? (
            <CircularProgress size={16} />
          ) : (
            <CloudDownloadIcon sx={{ fontSize: "0.9rem" }} />
          )}
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export default TrackControls;
