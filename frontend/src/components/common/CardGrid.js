import React from 'react';
import { Grid } from '@mui/material';
import styles from './CardGrid.module.css';

/**
 * Reusable grid container for cards with consistent spacing
 */
function CardGrid({ 
  children, 
  spacing = 2, 
  xs = 12, 
  sm = 6, 
  md = 4,
  lg,
  className = '' 
}) {
  return (
    <Grid 
      container 
      spacing={spacing} 
      className={`${styles.container} ${className}`}
    >
      {React.Children.map(children, (child, index) => (
        <Grid 
          item 
          xs={xs} 
          sm={sm} 
          md={md} 
          lg={lg}
          key={index}
        >
          {child}
        </Grid>
      ))}
    </Grid>
  );
}

export default CardGrid;
