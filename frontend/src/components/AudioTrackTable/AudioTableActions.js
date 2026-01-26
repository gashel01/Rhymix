import React from "react";
import { Box, Typography, Button, Tooltip, Fade, useTheme } from "@mui/material";
import { 
  Delete as DeleteIcon, 
  School as SchoolIcon, 
  Psychology as PsychologyIcon, 
  ArrowBack as ArrowBackIcon 
} from "@mui/icons-material";

const AudioTableActions = ({
  selectedRows, trackPairs, handleTrainWithDataset, handleInferenceWithTracks,
  showInferenceResultsActions, onReturnToModelSelection, onReturnToInferenceParams,
  onSelectAll, onClear, onDelete, defaultLabel
}) => {
  const theme = useTheme();
  const hasSelection = selectedRows.length > 0;

  // Helper to get track objects from IDs
  const getSelectedTracks = () => 
    selectedRows.map(id => trackPairs.find(p => p.id === id)).filter(Boolean);

  const ActionButton = ({ title, icon, onClick, label, color = "primary", gradient }) => (
    <Tooltip title={title} placement="top">
      <Button
        variant="contained" color={color} size="small" startIcon={icon} onClick={onClick}
        sx={{
          borderRadius: 2, px: 2, py: 1, fontWeight: 600, fontSize: '0.85rem',
          boxShadow: `0 4px 12px ${theme.palette[color].main}66`,
          background: gradient,
          '&:hover': { transform: 'translateY(-1px)', boxShadow: `0 6px 16px ${theme.palette[color].main}80` },
          transition: 'all 0.2s ease',
        }}
      >
        {label}
      </Button>
    </Tooltip>
  );

  return (
    <Box sx={{
      mb: 3, p: 2, borderRadius: 2, border: `1px solid ${theme.palette.divider}`,
      background: theme.palette.mode === 'dark'
        ? `linear-gradient(135deg, ${theme.palette.background.paper} 0%, ${theme.palette.background.default} 100%)`
        : `linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)`,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', position: 'relative', minHeight: 48 }}>
        
        {/* Selection Info */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, zIndex: 2 }}>
          {hasSelection ? (
            <Fade in={true}><Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box sx={{ 
                  bgcolor: theme.palette.mode === 'dark' ? 'primary.main' : 'primary.dark',
                  borderRadius: '50%', width: 32, height: 32, display: 'flex', 
                  alignItems: 'center', justifyContent: 'center', color: 'primary.contrastText' 
                }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{selectedRows.length}</Typography>
                </Box>
                <Typography variant="body1" sx={{ fontWeight: 600 }}>Track{selectedRows.length !== 1 ? 's' : ''} selected</Typography>
            </Box></Fade>
          ) : (
            <Typography variant="body1" sx={{ color: 'text.secondary' }}>{defaultLabel || 'Select tracks to get started'}</Typography>
          )}
        </Box>

        {/* Center Actions */}
        <Fade in={hasSelection}>
          <Box sx={{ display: 'flex', gap: 2, position: 'absolute', left: '50%', transform: 'translateX(-50%)', zIndex: 1 }}>
            {showInferenceResultsActions ? (
              <>
                {onReturnToModelSelection && <ActionButton title="Model Selection" label="Model Selection" icon={<PsychologyIcon />} onClick={onReturnToModelSelection} gradient="linear-gradient(135deg, #1976D2 0%, #0D47A1 100%)" />}
                {onReturnToInferenceParams && <ActionButton title="Inference Params" label="Inference Params" color="secondary" icon={<ArrowBackIcon />} onClick={onReturnToInferenceParams} gradient="linear-gradient(135deg, #9C27B0 0%, #7B1FA2 100%)" />}
              </>
            ) : (
              <>
                {handleTrainWithDataset && <ActionButton title="Train Model" label="Train Model" icon={<SchoolIcon />} onClick={() => handleTrainWithDataset(getSelectedTracks())} gradient="linear-gradient(135deg, #1976D2 0%, #0D47A1 100%)" />}
                {handleInferenceWithTracks && <ActionButton title="Run Inference" label="Run Inference" color="secondary" icon={<PsychologyIcon />} onClick={() => handleInferenceWithTracks(getSelectedTracks())} gradient="linear-gradient(135deg, #9C27B0 0%, #7B1FA2 100%)" />}
              </>
            )}
          </Box>
        </Fade>

        {/* Right Buttons */}
        <Box sx={{ ml: 'auto', display: 'flex', gap: 1, alignItems: 'center', zIndex: 2 }}>
          <Box sx={{ 
            transform: hasSelection ? 'translateX(-120px)' : 'translateX(0)', 
            transition: 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)' 
          }}>
            <Button variant="outlined" size="small" onClick={onSelectAll} sx={{ borderRadius: 2 }}>Select All</Button>
          </Box>

          <Fade in={hasSelection}>
            <Box sx={{ display: 'flex', gap: 1, position: 'absolute', right: 0 }}>
              <Button variant="outlined" size="small" onClick={onClear} sx={{ borderRadius: 2 }}>Clear</Button>
              <Box sx={{ position: 'relative' }}>
                <Tooltip title="Delete selected files"><Button variant="contained" color="error" size="small" onClick={onDelete} sx={{ borderRadius: 2, minWidth: 'auto', px: 1.5 }}><DeleteIcon sx={{ fontSize: '1.1rem' }} /></Button></Tooltip>
                <Box sx={{ position: 'absolute', top: -8, right: -8, bgcolor: 'error.light', color: 'white', borderRadius: '50%', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, border: '2px solid white' }}>{selectedRows.length}</Box>
              </Box>
            </Box>
          </Fade>
        </Box>
      </Box>
    </Box>
  );
};

export default AudioTableActions;