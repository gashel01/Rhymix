import React from 'react';
import { Box, Typography, Button } from '@mui/material';
import styles from './SectionHeader.module.css';

/**
 * Reusable section header with title and optional action button
 */
function SectionHeader({ 
  title, 
  action, 
  actionLabel, 
  actionIcon, 
  onAction, 
  variant = 'h5' 
}) {
  return (
    <Box className={styles.container}>
      <Typography variant={variant} className={styles.title}>
        {title}
      </Typography>
      {(action || onAction) && (
        <Box className={styles.actionContainer}>
          {action || (
            <Button
              variant="contained"
              color="secondary"
              startIcon={actionIcon}
              onClick={onAction}
              className={styles.actionButton}
            >
              {actionLabel}
            </Button>
          )}
        </Box>
      )}
    </Box>
  );
}

export default SectionHeader;
