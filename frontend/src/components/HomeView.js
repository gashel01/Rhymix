import React, { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Paper,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  CircularProgress,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import LibraryMusicIcon from "@mui/icons-material/LibraryMusic";
import VoiceChatIcon from "@mui/icons-material/VoiceChat";
import AddIcon from "@mui/icons-material/Add";
import AudioTrackTable from "./AudioTrackTable";
import ErrorBoundary from "./ErrorBoundary";
import TabPanel from "./common/TabPanel";
import { useAudioPlayback } from "../hooks/useAudioPlayback";
import { useVocalMode } from "../hooks/useVocalMode";
import { useAvailableFiles } from "../hooks/useAvailableFiles";
import { downloadFile } from "../utils/audioUtils";
import { getAvailableTalkingDatasets } from "../utils/apiService";

function HomeView({
  onCreateSingingDataset,
  onCreateTalkingDataset,
  onInferenceWithTracks,
  handleTrainWithDataset,
}) {
  const [talkingDatasets, setTalkingDatasets] = useState([]);
  const [activeTab, setActiveTab] = useState(0);
  const [createDatasetModalOpen, setCreateDatasetModalOpen] = useState(false);

  // Use custom hooks
  const {
    availableFiles,
    rawVocals,
    loading,
  } = useAvailableFiles();

  const {
    vocalMode,
    handleVocalModeChange,
    vocalsFileType,
  } = useVocalMode("raw");

  const {
    playingFile,
    playingBoth,
    instrumentalWaveforms,
    vocalWaveforms,
    handlePlayPause,
    handlePlayBoth,
    handleInstrumentalWaveformReady,
    handleVocalWaveformReady,
    stopAllAudio,
  } = useAudioPlayback();

  // Handle tab change
  const handleTabChange = (event, newValue) => {
    setActiveTab(newValue);
  };

  const handleCreateDatasetClick = () => {
    setCreateDatasetModalOpen(true);
  };

  const handleCreateDatasetModalClose = () => {
    setCreateDatasetModalOpen(false);
  };

  const handleCreateSingingDataset = () => {
    setCreateDatasetModalOpen(false);
    onCreateSingingDataset && onCreateSingingDataset();
  };

  const handleCreateTalkingDataset = () => {
    setCreateDatasetModalOpen(false);
    onCreateTalkingDataset && onCreateTalkingDataset();
  };

  const handleDownload = async (fileType, filePath) => {
    await downloadFile(fileType, filePath, vocalMode);
  };

  const handleVocalModeChangeWithCleanup = (event, newMode) => {
    if (newMode !== null) {
      stopAllAudio();
      handleVocalModeChange(event, newMode);
    }
  };

  const getTrackPairs = () => {
    const sourceFiles = vocalMode === "processed" ? availableFiles : rawVocals;
    const isProcessed = vocalMode === "processed";

    return sourceFiles.map((pair, index) => ({
      instrumental: pair.instrumentalPath
        ? pair.instrumentalPath.split("/").pop()
        : null,
      vocal: pair.vocalPath ? pair.vocalPath.split("/").pop() : null,
      name: pair.name,
      instrumentalUrl: pair.instrumentalUrl,
      vocalUrl: pair.vocalUrl,
      vocalMode: vocalMode, // "processed" or "raw"
      isProcessed: isProcessed, // boolean for easier checking
      id: pair.id || pair.name || `${pair.instrumentalPath || ''}-${pair.vocalPath || ''}-${index}`, // Unique ID for selection
    }));
  };

  // Fetch talking datasets on component mount
  useEffect(() => {
    const fetchTalkingDatasets = async () => {
      try {
        const response = await getAvailableTalkingDatasets();

        if (response && response.datasets) {
          setTalkingDatasets(response.datasets);
        }
      } catch (error) {
        console.error("Failed to fetch talking datasets:", error);
      }
    };

    fetchTalkingDatasets();
  }, []);

  return (
    <Box>
      {/* Header with Create Dataset Button */}
      <Box sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        mb: 4,
        p: 3,
        background: "transparent",
        borderRadius: 4,
        border: "none",
      }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
            Your Data Files
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Select files for training or inference, or create new datasets
          </Typography>
        </Box>
        <Button
          variant="contained"
          size="large"
          startIcon={<AddIcon />}
          onClick={handleCreateDatasetClick}
          sx={{
            borderRadius: 3,
            px: 4,
            fontWeight: 600,
            boxShadow: theme => theme.palette.mode === 'dark'
              ? '0 8px 24px rgba(0,0,0,0.4)'
              : '0 8px 24px rgba(0,0,0,0.12)',
            '&:hover': {
              transform: 'translateY(-2px)',
              boxShadow: theme => theme.palette.mode === 'dark'
                ? '0 12px 32px rgba(0,0,0,0.5)'
                : '0 12px 32px rgba(0,0,0,0.15)',
            },
            transition: 'all 0.3s ease',
          }}
        >
          Create Dataset
        </Button>
      </Box>

      {/* Enhanced Data Files Header */}
      <Paper
        elevation={3}
        sx={{
          borderRadius: 2,
          overflow: 'hidden',
          background: theme => theme.palette.mode === 'dark'
            ? `linear-gradient(135deg, ${theme.palette.background.paper} 0%, ${theme.palette.background.default} 100%)`
            : `linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)`,
          boxShadow: theme => theme.palette.mode === 'dark'
            ? '0 8px 32px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.2)'
            : '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)',
          mb: 2,
        }}
      >
       

        {/* Dataset Toggle */}
        <Box sx={{
          p: 2,
          backgroundColor: theme => theme.palette.mode === 'dark'
            ? theme.palette.background.paper
            : theme.palette.background.default,
          borderTop: 1,
          borderColor: 'divider',
        }}>
          <Box sx={{
            display: 'flex',
            justifyContent: 'left',
          }}>
            <ToggleButtonGroup
              value={activeTab}
              exclusive
              onChange={(event, newValue) => {
                if (newValue !== null) {
                  handleTabChange(event, newValue);
                }
              }}
              sx={{
                '& .MuiToggleButtonGroup-grouped': {
                  borderRadius: 0,
                  border: '1px solid',
                  borderColor: 'divider',
                  color: 'text.secondary',
                  px: 3,
                  py: 1.5,
                  fontWeight: 500,
                  fontSize: '1rem',
                  textTransform: 'none',
                  minWidth: 160,
                  '&:first-of-type': {
                    borderTopLeftRadius: 16,
                    borderBottomLeftRadius: 16,
                  },
                  '&:last-of-type': {
                    borderTopRightRadius: 16,
                    borderBottomRightRadius: 16,
                  },
                  '&:not(:first-of-type)': {
                    borderLeft: 'none',
                    marginLeft: 0,
                  },
                  '&.Mui-selected': {
                    backgroundColor: 'primary.main',
                    color: 'primary.contrastText',
                    borderColor: 'primary.main',
                    boxShadow: theme => theme.palette.mode === 'dark'
                      ? '0 2px 8px rgba(25, 118, 210, 0.4)'
                      : '0 2px 8px rgba(25, 118, 210, 0.3)',
                    '&:hover': {
                      backgroundColor: 'primary.dark',
                      borderColor: 'primary.dark',
                    },
                  },
                  '&:hover': {
                    backgroundColor: theme => theme.palette.mode === 'dark'
                      ? 'rgba(255,255,255,0.08)'
                      : 'rgba(0,0,0,0.04)',
                  },
                  '& .MuiSvgIcon-root': {
                    fontSize: '1.25rem',
                    mr: 1,
                  },
                },
              }}
            >
              <ToggleButton value={0}>
                <LibraryMusicIcon />
                Singing Data
              </ToggleButton>
              <ToggleButton value={1}>
                <VoiceChatIcon />
                Talking Data
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </Box>

        {/* Singing Data Tab */}
        <TabPanel value={activeTab} index={0} sx={{ p: 0 }}>
          {loading ? (
            <Box sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              py: 8,
              px: 4
            }}>
              <CircularProgress size={64} sx={{ mb: 3 }} />
              <Typography variant="h6" sx={{ mb: 2 }}>
                Loading singing data files...
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Please wait while we fetch your audio files
              </Typography>
            </Box>
          ) : availableFiles.length > 0 ? (
            <ErrorBoundary>
              <AudioTrackTable
              trackPairs={getTrackPairs()}
              vocalMode={vocalMode}
              handleVocalModeChange={handleVocalModeChangeWithCleanup}
              handlePlayPause={handlePlayPause}
              handleDownload={handleDownload}
              handlePlayBoth={handlePlayBoth}
              handleInstrumentalWaveformReady={handleInstrumentalWaveformReady}
              handleVocalWaveformReady={handleVocalWaveformReady}
              playingFile={playingFile}
              playingBoth={playingBoth}
              instrumentalWaveforms={instrumentalWaveforms}
              vocalWaveforms={vocalWaveforms}
              showVocalToggle={true}
              enablePlayBoth={true}
              vocalsFileType={vocalsFileType}
              showDatasetButton={false}
              hasExports={availableFiles.length > 0}
              stopAllAudio={stopAllAudio}
              handleTrainWithDataset={handleTrainWithDataset}
              showInferenceButton={true}
              handleInferenceWithTracks={onInferenceWithTracks}
            />
            </ErrorBoundary>
          ) : (
            <Box sx={{
              textAlign: 'center',
              py: 8,
              px: 4
            }}>
              <LibraryMusicIcon sx={{
                fontSize: 80,
                color: 'text.secondary',
                mb: 3,
                opacity: 0.5
              }} />
              <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>
                No Singing Data Files
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 4, maxWidth: 400, mx: 'auto' }}>
                Upload and process audio files to create singing datasets for voice training.
              </Typography>
              <Button
                variant="contained"
                size="large"
                startIcon={<AddIcon />}
                onClick={handleCreateDatasetClick}
                sx={{ borderRadius: 3, px: 4 }}
              >
                Create Singing Dataset
              </Button>
            </Box>
          )}
        </TabPanel>

        {/* Talking Data Tab */}
        <TabPanel value={activeTab} index={1} sx={{ p: 3 }}>
          {talkingDatasets.length > 0 ? (
            <Box sx={{ textAlign: 'center', py: 8 }}>
              <VoiceChatIcon sx={{ fontSize: 64, color: 'success.main', mb: 3 }} />
              <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>
                Talking Datasets Available
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
                {talkingDatasets.length} talking dataset{talkingDatasets.length !== 1 ? 's' : ''} ready for training
              </Typography>
              <Button
                variant="contained"
                size="large"
                onClick={() => onCreateTalkingDataset && onCreateTalkingDataset()}
                sx={{ borderRadius: 3, px: 4 }}
              >
                Manage Talking Datasets
              </Button>
            </Box>
          ) : (
            <Box sx={{
              textAlign: 'center',
              py: 8,
              px: 4
            }}>
              <VoiceChatIcon sx={{
                fontSize: 80,
                color: 'text.secondary',
                mb: 3,
                opacity: 0.5
              }} />
              <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>
                No Talking Data Files
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 4, maxWidth: 400, mx: 'auto' }}>
                Create talking datasets from conversation recordings for voice training.
              </Typography>
              <Button
                variant="contained"
                size="large"
                startIcon={<AddIcon />}
                onClick={handleCreateDatasetClick}
                sx={{ borderRadius: 3, px: 4 }}
              >
                Create Talking Dataset
              </Button>
            </Box>
          )}
        </TabPanel>
      </Paper>

      {/* Create Dataset Modal */}
      <Dialog
        open={createDatasetModalOpen}
        onClose={handleCreateDatasetModalClose}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: { borderRadius: 3 }
        }}
      >
        <DialogTitle sx={{ pb: 1 }}>
          Create New Dataset
        </DialogTitle>
        <DialogContent sx={{ pb: 1 }}>
          <DialogContentText sx={{ mb: 3 }}>
            Choose the type of dataset you want to create:
          </DialogContentText>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Button
              fullWidth
              variant="outlined"
              onClick={handleCreateSingingDataset}
              sx={{
                p: 3,
                borderRadius: 3,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1,
                height: 'auto',
                '&:hover': {
                  borderColor: 'primary.main',
                  backgroundColor: 'primary.main',
                  color: 'primary.contrastText',
                }
              }}
            >
              <LibraryMusicIcon sx={{ fontSize: 48 }} />
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                Singing Dataset
              </Typography>
              <Typography variant="body2" sx={{ textAlign: 'center' }}>
                Process songs for voice training
              </Typography>
            </Button>

            <Button
              fullWidth
              variant="outlined"
              onClick={handleCreateTalkingDataset}
              sx={{
                p: 3,
                borderRadius: 3,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1,
                height: 'auto',
                '&:hover': {
                  borderColor: 'success.main',
                  backgroundColor: 'success.main',
                  color: 'success.contrastText',
                }
              }}
            >
              <VoiceChatIcon sx={{ fontSize: 48 }} />
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                Talking Dataset
              </Typography>
              <Typography variant="body2" sx={{ textAlign: 'center' }}>
                Process conversations for voice training
              </Typography>
            </Button>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleCreateDatasetModalClose} sx={{ borderRadius: 2 }}>
            Cancel
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default HomeView;