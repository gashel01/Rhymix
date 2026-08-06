import React from 'react';
import { Chip } from '@mui/material';
import styles from './StatusBadge.module.css';

/**
 * Reusable status badge component
 */
function StatusBadge({ 
  label, 
  status = 'default', // 'success', 'error', 'warning', 'info', 'default'
  variant = 'outlined',
  icon,
  size = 'medium',
  className = '' 
}) {
  const colorMap = {
    success: 'success',
    error: 'error',
    warning: 'warning',
    info: 'info',
    default: 'default',
  };

  return (
    <Chip
      label={label}
      color={colorMap[status] || 'default'}
      variant={variant}
      icon={icon}
      size={size}
      className={`${styles.badge} ${className}`}
    />
  );
}

export default StatusBadge;
