import React from 'react';
import { Paper, Typography } from '@mui/material';
import styles from './EmptyState.module.css';

/**
 * Reusable empty state component
 */
function EmptyState({ message = 'No data available.' }) {
  return (
    <Paper className={styles.container}>
      <Typography variant="h6" color="text.secondary">
        {message}
      </Typography>
    </Paper>
  );
}

export default EmptyState;
