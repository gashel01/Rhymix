import React, { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Collapse,
  Chip,
  Checkbox,
} from '@mui/material';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import DeleteIcon from '@mui/icons-material/Close';
import SchoolIcon from '@mui/icons-material/School';
import { downloadDataset } from '../utils/audioUtils';
import styles from './DatasetSelectionMode.module.css';

/**
 * Component for dataset selection mode UI
 */
function DatasetSelectionMode({
  trackPairs,
  vocalMode,
  selectedProcessedVocals,
  selectedRawVocals,
  onToggleSelection,
  onSelectAllProcessed,
  onSelectAllRaw,
  onRemoveFromSelection,
  onTrainWithDataset,
  onDownloadDataset,
}) {
  const totalSelectedVocals =
    selectedProcessedVocals.length + selectedRawVocals.length;

  const handleDownload = async () => {
    const normalize = (item) => (typeof item === "string" ? item : item?.fileId || item?.id);
    const selectedDataset = {
      processed: selectedProcessedVocals.map(normalize).filter(Boolean),
      raw: selectedRawVocals.map(normalize).filter(Boolean),
    };

    try {
      await downloadDataset(selectedDataset);
      if (onDownloadDataset) {
        onDownloadDataset(selectedDataset);
      }
    } catch (error) {
      // Error is already handled in downloadDataset
    }
  };

  return (
    <Collapse in={true} timeout={800} sx={{ mt: 0, transform: 'translateY(-1px)' }}>
      <Box className={styles.container}>
        {/* Selection actions */}
        <Box className={styles.actions}>
          <Button
            variant="outlined"
            color="secondary"
            size="small"
            onClick={onSelectAllProcessed}
          >
            Select all processed vocals
          </Button>
          <Button
            variant="outlined"
            color="secondary"
            size="small"
            onClick={onSelectAllRaw}
          >
            Select all raw vocals
          </Button>

          {totalSelectedVocals > 0 && (
            <>
              <Button
                variant="contained"
                color="secondary"
                startIcon={<CloudDownloadIcon />}
                onClick={handleDownload}
                sx={{ ml: 'auto' }}
              >
                Download selected ({totalSelectedVocals})
              </Button>
              <Button
                variant="contained"
                color="primary"
                startIcon={<SchoolIcon />}
                onClick={() => {
                  if (onTrainWithDataset) {
                    const normalize = (item) => (typeof item === "string" ? item : item?.fileId || item?.id);
                    onTrainWithDataset({
                      processed: selectedProcessedVocals.map(normalize).filter(Boolean),
                      raw: selectedRawVocals.map(normalize).filter(Boolean),
                    });
                  }
                }}
              >
                Train with selected
              </Button>
            </>
          )}
        </Box>

        {/* Current selection display */}
        <Box className={styles.selectionDisplay}>
          {selectedProcessedVocals.length === 0 &&
          selectedRawVocals.length === 0 ? (
            <Typography color="text.secondary" variant="body2">
              No vocals selected yet. Use the checkboxes next to each vocal track
              to add to your dataset.
            </Typography>
          ) : (
            <>
              {selectedProcessedVocals.map((vocal) => {
                const label = typeof vocal === "string" ? vocal : vocal?.displayName || vocal?.originalName || "Track";
                const key = typeof vocal === "string" ? vocal : vocal?.fileId || vocal?.id || label;
                return (
                <Chip
                  key={`processed-${key}`}
                  label={`${label} (processed)`}
                  color="secondary"
                  variant="outlined"
                  onDelete={() => onRemoveFromSelection(vocal, true)}
                  deleteIcon={<DeleteIcon fontSize="small" />}
                  size="small"
                />
              );
            })}
              {selectedRawVocals.map((vocal) => {
                const label = typeof vocal === "string" ? vocal : vocal?.displayName || vocal?.originalName || "Track";
                const key = typeof vocal === "string" ? vocal : vocal?.fileId || vocal?.id || label;
                return (
                <Chip
                  key={`raw-${key}`}
                  label={`${label} (raw)`}
                  color="primary"
                  variant="outlined"
                  onDelete={() => onRemoveFromSelection(vocal, false)}
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

export default DatasetSelectionMode;
