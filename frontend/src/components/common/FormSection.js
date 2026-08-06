import React from 'react';
import { Grid, Typography, Box } from '@mui/material';
import styles from './FormSection.module.css';

/**
 * Reusable form section with label and description
 */
function FormSection({ 
  label, 
  description, 
  children, 
  fullWidth = false,
  xs = 12,
  md = 6 
}) {
  return (
    <Grid item xs={xs} md={md} className={fullWidth ? styles.fullWidth : ''}>
      {label && (
        <Typography gutterBottom className={styles.label}>
          {label}
        </Typography>
      )}
      {children}
      {description && (
        <Typography variant="body2" color="text.secondary" className={styles.description}>
          {description}
        </Typography>
      )}
    </Grid>
  );
}

export default FormSection;
