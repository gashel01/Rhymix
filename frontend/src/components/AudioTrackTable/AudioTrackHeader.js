import React from 'react';
import { TableHead, TableRow, TableCell, Typography, Grid, Box, useTheme } from '@mui/material';
import VocalModeToggle from '../common/VocalModeToggle';
import styles from './AudioTrackHeader.module.css';

const AudioTrackHeader = ({
  vocalMode, handleVocalModeChange, showVocalToggle,
  datasetSelectionMode, inferenceSelectionMode, 
  vocalModeType = 'dataset'
}) => {
  const theme = useTheme();
  const isInf = vocalModeType === 'inference';

  // Dynamic labels based on mode
  const leftLabel = isInf ? "Original" : "Instrumental";
  const rightLabel = "Vocals";

  return (
    <TableHead>
      <TableRow sx={{
        height: 48,
        bgcolor: theme.palette.mode === 'dark' ? 'background.paper' : 'grey.50',
        borderBottom: `1px solid ${theme.palette.divider}`,
        '& .MuiTableCell-root': { borderBottom: 'none', color: 'text.primary', p: '8px 16px' }
      }}>
        <TableCell width="10%" className={styles.trackNameCell} sx={{ fontWeight: 600, fontSize: '1.1rem' }}>
          Track Name
        </TableCell>

        <TableCell className={styles.waveformsCell} sx={{
          width: (datasetSelectionMode || inferenceSelectionMode) ? "calc(90% - 40px)" : "90%",
          transition: "width 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
          p: "4px 8px", height: 40
        }}>
          <Grid container sx={{ width: '100%', m: 0, height: '100%', alignItems: 'center' }}>
            {/* Instrumental / Original Header */}
            <Grid item xs={12} md={5.5} sx={{ display: 'flex', justifyContent: 'center' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, fontSize: '0.95rem' }}>
                {leftLabel}
              </Typography>
            </Grid>

            {/* Spacer for TrackControls */}
            <Grid item xs={12} md={1} />

            {/* Vocals Header + Context Toggle */}
            <Grid item xs={12} md={5.5} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, fontSize: '0.95rem', flex: 1, textAlign: 'center' }}>
                {rightLabel}
              </Typography>
              
              {showVocalToggle && handleVocalModeChange && (
                <Box sx={{ ml: 1, flexShrink: 0 }}>
                  <VocalModeToggle
                    value={vocalMode}
                    onChange={handleVocalModeChange}
                    mode={vocalModeType} // 'inference' or 'dataset'
                  />
                </Box>
              )}
            </Grid>
          </Grid>
        </TableCell>
      </TableRow>
    </TableHead>
  );
};

export default AudioTrackHeader;