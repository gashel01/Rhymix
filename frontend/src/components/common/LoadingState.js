import React from 'react';
import { Paper, CircularProgress, Typography } from '@mui/material';
import styles from './LoadingState.module.css';

/**
 * Reusable loading state component
 */
function LoadingState({ message = 'Loading...' }) {
  return (
    <Paper className={styles.container}>
      <CircularProgress size={40} className={styles.spinner} />
      <Typography variant="h6" color="text.secondary">
        {message}
      </Typography>
    </Paper>
  );
}

export default LoadingState;
