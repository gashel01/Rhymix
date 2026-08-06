import React from 'react';
import { Box, Button } from '@mui/material';
import styles from './ButtonGroup.module.css';

/**
 * Reusable button group component for related actions
 */
function ButtonGroup({ 
  buttons, 
  variant = 'contained',
  color = 'primary',
  size = 'medium',
  orientation = 'horizontal', // 'horizontal' or 'vertical'
  fullWidth = false,
  className = '' 
}) {
  return (
    <Box 
      className={`${styles.container} ${styles[orientation]} ${fullWidth ? styles.fullWidth : ''} ${className}`}
    >
      {buttons.map((button, index) => (
        <Button
          key={index}
          variant={button.variant || variant}
          color={button.color || color}
          size={button.size || size}
          startIcon={button.icon}
          endIcon={button.endIcon}
          onClick={button.onClick}
          disabled={button.disabled}
          className={styles.button}
          sx={button.sx}
        >
          {button.label}
        </Button>
      ))}
    </Box>
  );
}

export default ButtonGroup;
