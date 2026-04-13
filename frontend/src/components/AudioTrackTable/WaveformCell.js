import React from 'react';
import { Box, Typography, Grid } from '@mui/material';
import AudioWaveform from '../AudioWaveform';
import { useVolume } from '../../contexts/VolumeContext';
import styles from './WaveformCell.module.css';
import { Theme } from '../Homeview/Theme';

/**
 * Cell component for displaying a single waveform
 */
function WaveformCell({
  url,
  isPlaying,
  isMuted,
  volume: volumeProp, // Keep prop for backward compatibility but prefer context
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
  darkMode,
}) {
  const { volumeRef } = useVolume();
  const { t } = Theme({ darkMode });
  // Use context volume ref if available, fallback to prop
  const volume = volumeRef?.current ?? volumeProp ?? 1;

  return (
    <Grid className={styles.container} sx={{ minWidth: 0 }}>
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
        <Box
          className={styles.emptyState}
          style={{
            backgroundColor: t.cardA,
            border: `1px dashed ${t.hairline}`
          }}
        >
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
  // volume is intentionally excluded - it's handled via context ref
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
  prev.otherWaveform === next.otherWaveform &&
  prev.darkMode === next.darkMode;

export default React.memo(WaveformCell, areEqual);
