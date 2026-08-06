import React from 'react';
import { Box, Typography, IconButton } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBackOutlined';
import styles from './PageHeader.module.css';

/**
 * Reusable page header with back button and title
 */
function PageHeader({ title, onBack, children, variant = 'h4' }) {
  return (
    <Box className={styles.container}>
      {onBack && (
        <IconButton onClick={onBack} className={styles.backButton}>
          <ArrowBackIcon />
        </IconButton>
      )}
      <Typography variant={variant} component="h1" className={styles.title}>
        {title}
      </Typography>
      {children && <Box className={styles.actions}>{children}</Box>}
    </Box>
  );
}

export default PageHeader;
