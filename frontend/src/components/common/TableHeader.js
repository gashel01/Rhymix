import React from 'react';
import { TableHead, TableRow, TableCell, Typography } from '@mui/material';
import styles from './TableHeader.module.css';

/**
 * Reusable table header component
 */
function TableHeader({ 
  columns, 
  className = '',
  sticky = false 
}) {
  return (
    <TableHead className={sticky ? styles.sticky : ''}>
      <TableRow className={styles.row}>
        {columns.map((column, index) => (
          <TableCell
            key={index}
            className={styles.cell}
            width={column.width}
            align={column.align || 'left'}
            sx={column.sx}
          >
            {typeof column.label === 'string' ? (
              <Typography 
                variant={column.variant || 'subtitle1'} 
                className={styles.label}
                sx={column.labelSx}
              >
                {column.label}
              </Typography>
            ) : (
              column.label
            )}
          </TableCell>
        ))}
      </TableRow>
    </TableHead>
  );
}

export default TableHeader;
