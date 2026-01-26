import React from 'react';
import { Box } from '@mui/material';
import styles from './ActionToolbar.module.css';

/**
 * Reusable action toolbar for grouping buttons/actions
 */
function ActionToolbar({ 
  children, 
  align = 'right', // 'left', 'right', 'center', 'space-between'
  spacing = 1,
  className = '' 
}) {
  const alignmentClass = styles[`align${align.charAt(0).toUpperCase() + align.slice(1).replace('-', '')}`] || '';
  
  return (
    <Box 
      className={`${styles.container} ${alignmentClass} ${className}`}
      sx={{ gap: spacing }}
    >
      {children}
    </Box>
  );
}

export default ActionToolbar;
