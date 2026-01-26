import React from 'react';
import { Box, Typography, Grid } from '@mui/material';
import AudioWaveform from '../AudioWaveform';
import styles from './WaveformCell.module.css';

/**
 * Cell component for displaying a single waveform
 */
function WaveformCell({
  url,
  isPlaying,
  isMuted,
  onPlayPause,
  onDownload,
  onReady,
  onSeek,
  onFinish,
  otherWaveform,
  progressColor = "#1976d2",
  waveColor = "#9e9e9e",
  backgroundColor = "#2a2a2a",
  badgeText = null,
  isPrimary = false,
  emptyMessage = "No audio",
  volume = 1,
}) {
  return (
    <Grid  className={styles.container} sx={{ minWidth: 0 }}>
      {url ? (
        <AudioWaveform
          url={url}
          isPlaying={isPlaying}
          isMuted={isMuted}
          volume={volume}
          onPlayPause={onPlayPause}
          onDownload={onDownload}
          progressColor={progressColor}
          waveColor={waveColor}
          backgroundColor={backgroundColor}
          badgeText={badgeText}
          isPrimary={isPrimary}
          onReady={onReady}
          onSeek={onSeek}
          onFinish={onFinish}
          otherWaveform={otherWaveform}
        />
      ) : (
        <Box className={styles.emptyState}>
          <Typography variant="caption" color="text.secondary">
            {emptyMessage}
          </Typography>
        </Box>
      )}
    </Grid>
  );
}

export default WaveformCell;
