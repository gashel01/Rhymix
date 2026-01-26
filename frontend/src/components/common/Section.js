import React from 'react';
import { Paper, Typography, Divider, Box } from '@mui/material';
import styles from './Section.module.css';

/**
 * Reusable section container with title and optional divider
 */
function Section({ 
  title, 
  children, 
  variant = 'h6', 
  showDivider = false,
  padding = 3,
  className = ''
}) {
  return (
    <Paper className={`${styles.container} ${className}`} sx={{ p: padding }}>
      {title && (
        <>
          <Typography variant={variant} className={styles.title}>
            {title}
          </Typography>
          {showDivider && <Divider className={styles.divider} />}
        </>
      )}
      <Box className={styles.content}>{children}</Box>
    </Paper>
  );
}

export default Section;
