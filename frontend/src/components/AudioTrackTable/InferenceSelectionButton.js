import React from 'react';
import { Box, Typography, Button } from '@mui/material';
import styles from './DatasetSelectionButton.module.css';

/**
 * Animated button for toggling inference selection mode
 */
function InferenceSelectionButton({
  isActive,
  onToggle,
  onClose
}) {
  return (
    <Box
      className={`${styles.container} ${isActive ? styles.active : ''}`}
      onClick={!isActive ? onToggle : undefined}
    >
      <Box className={styles.innerContainer}>
        <Box
          className={`${styles.textContainer} ${isActive ? styles.textActive : ''}`}
        >
          <Typography variant="h6" className={styles.text}>
            🎵 Run Voice Conversion
          </Typography>
        </Box>

        <Box
          className={`${styles.closeContainer} ${isActive ? styles.closeActive : ''}`}
        >
          <Button
            variant="outlined"
            color="secondary"
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className={styles.closeButton}
          >
            Close
          </Button>
        </Box>
      </Box>
    </Box>
  );
}

export default InferenceSelectionButton;