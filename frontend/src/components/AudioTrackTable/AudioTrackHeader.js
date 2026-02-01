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
    <div  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%",  background:"rgba(255,255,255,0.1)",  padding: "5px 5px" , marginTop:"10px"}}>
      <TableRow sx={{
       
        width: "100%",
        bgcolor: theme.palette.mode === 'dark' ? 'background.paper' : 'grey.50',
        '& .MuiTableCell-root': { borderBottom: 'none', color: 'text.primary' }
      }}>
        

        <div className={styles.waveformsCell} sx={{
          width: (datasetSelectionMode || inferenceSelectionMode) ? "calc(90% - 40px)" : "90%",
          transition: "width 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
          p: "4px 8px", height: 40, width: "100%",
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
  <Box 
    sx={{ flexShrink: 0, mr: 1 }} 
    onClick={(e) => e.stopPropagation()} // Prevents the click from bubbling to the table
    onMouseDown={(e) => e.stopPropagation()}
  >
    <VocalModeToggle
      value={vocalMode}
      onChange={handleVocalModeChange}
      mode={vocalModeType} 
    />
  </Box>
)}
            </Grid>
          </Grid>
        </div>
      </TableRow>
    </div>
  );
};

export default AudioTrackHeader;