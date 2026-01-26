import React from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import PlayAllIcon from '@mui/icons-material/PlaylistPlay';
import PauseIcon from '@mui/icons-material/Pause';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import styles from './TrackControls.module.css';

function TrackControls({ instrumental, vocal, isPlaying, onPlayBoth, onDownloadFullSong, disabled = false }) {
  return (
    <Box className={styles.container}>
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

      <Tooltip title="Download full song">
        <IconButton
          className={styles.downloadButton}
          size="small"
          style={{ position: 'absolute' }} // Restored
          onClick={() => (onDownloadFullSong || (() => {}))(instrumental, vocal)}
          disabled={disabled}
        >
          <CloudDownloadIcon sx={{ fontSize: "0.9rem" }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export default TrackControls;