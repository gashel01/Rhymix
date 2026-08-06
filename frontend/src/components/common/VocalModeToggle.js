import React from 'react';
import { Box, ToggleButtonGroup, ToggleButton } from '@mui/material';
import styles from './VocalModeToggle.module.css';

/**
 * Toggle component for switching between vocal modes
 * Supports both "raw/processed" (for dataset) and "converted/original" (for inference results)
 */
function VocalModeToggle({ value, onChange, show = true, mode = 'inference' }) {
  if (!show) return null;

  const handleChange = (event, newValue) => {
    if (newValue !== null && onChange) {
      onChange(event, newValue);
    }
  };

  // Define button labels based on mode
  const buttonLabels = mode === 'dataset' ? {
    left: 'raw',
    right: 'processed'
  } : {
    left: 'converted',
    right: 'original'
  };

  // Map values based on mode
  const valueMapping = mode === 'dataset' ? {
    'raw': 'raw',
    'processed': 'processed'
  } : {
    'converted': 'converted',
    'original': 'original'
  };

  return (
    <Box className={styles.container}>
      <ToggleButtonGroup
        value={value}
        exclusive
        onChange={handleChange}
        size="small"
      >
        <ToggleButton value={mode === 'dataset' ? 'raw' : 'converted'} sx={{ py: 0.5, px: 1 }}>
          {buttonLabels.left}
        </ToggleButton>
        <ToggleButton value={mode === 'dataset' ? 'processed' : 'original'} sx={{ py: 0.5, px: 1 , backgroundColor:"rgba(0,0,0,0.2)" }}>
          {buttonLabels.right}
        </ToggleButton>
      </ToggleButtonGroup>
    </Box>
  );
}

export default VocalModeToggle;
