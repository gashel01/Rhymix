import React, { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Collapse,
  Chip,
  Checkbox,
} from '@mui/material';
import AudiotrackIcon from '@mui/icons-material/AudiotrackOutlined';
import DeleteIcon from '@mui/icons-material/CloseOutlined';
import styles from './DatasetSelectionMode.module.css';

/**
 * Component for inference track selection mode UI
 */
function InferenceSelectionMode({
  trackPairs,
  selectedTracks,
  onToggleSelection,
  onSelectAll,
  onRemoveFromSelection,
  onInferenceWithTracks,
}) {
  const totalSelected = selectedTracks.length;

  const handleSelectAll = (event) => {
    if (event.target.checked) {
      onSelectAll();
    } else {
      // Clear all selections by removing each one
      selectedTracks.forEach(track => {
        onRemoveFromSelection(track);
      });
    }
  };

  return (
    <Collapse in={true} timeout={800} sx={{ mt: 0, transform: 'translateY(-1px)' }}>
      <Box className={styles.container}>
        {/* Selection actions */}
        <Box className={styles.actions}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <Checkbox
              checked={selectedTracks.length === trackPairs.length && trackPairs.length > 0}
              indeterminate={selectedTracks.length > 0 && selectedTracks.length < trackPairs.length}
              onChange={handleSelectAll}
            />
            <Typography variant="body2">
              Select All Tracks ({trackPairs.length})
            </Typography>
          </Box>

          {/* Instructions */}
          <Box sx={{ mb: 2, p: 2, bgcolor: 'background.paper', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              <strong>How to use:</strong>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              1. Select tracks you want to convert using the checkboxes below<br/>
              2. Click "Continue to Model Selection" to choose your trained voice model<br/>
              3. Configure conversion parameters and start the inference
            </Typography>
          </Box>

          {totalSelected > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2, bgcolor: 'primary.main', color: 'primary.contrastText', borderRadius: 2 }}>
              <Box>
                <Typography variant="h6">
                  {totalSelected} track{totalSelected !== 1 ? 's' : ''} selected
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.9 }}>
                  Ready for voice conversion
                </Typography>
              </Box>
              <Button
                variant="contained"
                color="secondary"
                size="large"
                startIcon={<AudiotrackIcon />}
                onClick={onInferenceWithTracks}
                sx={{
                  fontSize: '1.1rem',
                  py: 1.5,
                  px: 3,
                  boxShadow: 3,
                  '&:hover': {
                    boxShadow: 6,
                    transform: 'translateY(-2px)'
                  },
                  transition: 'all 0.2s ease'
                }}
              >
                Continue to Model Selection
              </Button>
            </Box>
          )}
        </Box>

        {/* Current selection display */}
        <Box className={styles.selectionDisplay}>
          {selectedTracks.length === 0 ? (
            <Typography color="text.secondary" variant="body2">
              Select tracks above to begin voice conversion. Choose the audio files
              you want to convert to your trained voice model.
            </Typography>
          ) : (
            <>
              {selectedTracks.map((track) => {
                const trackName = track.displayName || track.name || "Untitled track";
                return (
                  <Chip
                    key={track.id}
                    label={trackName}
                    color="primary"
                    variant="outlined"
                    onDelete={() => onRemoveFromSelection(track)}
                    deleteIcon={<DeleteIcon fontSize="small" />}
                    size="small"
                  />
                );
              })}
            </>
          )}
        </Box>
      </Box>
    </Collapse>
  );
}

export default InferenceSelectionMode;
