import React from 'react';
import { Grid, Card, CardContent, Typography, Box } from '@mui/material';

const UpperCard = ({ inferenceData }) => {
  return (
<Grid item xs={12}>
<Card sx={{
 
  cursor: 'default',
}}>
  <CardContent sx={{ p: 2 }}>
    <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
      Inference Configuration
    </Typography>
    <Grid container spacing={2}>
      <Grid item xs={12} md={6} lg={3}>
        <Box sx={{
          p: 1.5,
          borderRadius: 2,
          bgcolor: 'background.paper',
          border: theme => `1px solid ${theme.palette.divider}`,
        }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            AI Model
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 600, color: 'primary.main' }}>
            {inferenceData.model.name}
          </Typography>
        </Box>
      </Grid>
      <Grid item xs={12} md={6} lg={3}>
        <Box sx={{
          p: 1.5,
          borderRadius: 2,
          bgcolor: 'background.paper',
          border: theme => `1px solid ${theme.palette.divider}`,
        }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Pitch Adjustment
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {inferenceData.params.pitch > 0 ? '+' : ''}{inferenceData.params.pitch} semitones
          </Typography>
        </Box>
      </Grid>
      <Grid item xs={12} md={6} lg={3}>
        <Box sx={{
          p: 1.5,
          borderRadius: 2,
          bgcolor: 'background.paper',
          border: theme => `1px solid ${theme.palette.divider}`,
        }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Voice Detection
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {inferenceData.params.f0Method.toUpperCase()}
          </Typography>
        </Box>
      </Grid>
      <Grid item xs={12} md={6} lg={3}>
        <Box sx={{
          p: 1.5,
          borderRadius: 2,
          bgcolor: 'background.paper',
          border: theme => `1px solid ${theme.palette.divider}`,
        }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Voice Similarity
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {Math.round(inferenceData.params.indexRate * 100)}%
          </Typography>
        </Box>
      </Grid>
    </Grid>
  </CardContent>
</Card>
</Grid>
);
}

export default UpperCard;