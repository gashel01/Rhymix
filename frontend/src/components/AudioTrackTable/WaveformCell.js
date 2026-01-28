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
  volume,
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

const areEqual = (prev, next) =>
  prev.url === next.url &&
  prev.isPlaying === next.isPlaying &&
  prev.isMuted === next.isMuted &&
  prev.volume === next.volume &&
  prev.progressColor === next.progressColor &&
  prev.waveColor === next.waveColor &&
  prev.backgroundColor === next.backgroundColor &&
  prev.badgeText === next.badgeText &&
  prev.isPrimary === next.isPrimary &&
  prev.emptyMessage === next.emptyMessage &&
  prev.onPlayPause === next.onPlayPause &&
  prev.onDownload === next.onDownload &&
  prev.onReady === next.onReady &&
  prev.onSeek === next.onSeek &&
  prev.onFinish === next.onFinish &&
  prev.otherWaveform === next.otherWaveform;

export default React.memo(WaveformCell, areEqual);
