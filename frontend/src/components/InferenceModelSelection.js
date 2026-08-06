import React, { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Button,
  Paper,
  IconButton,
  Container,
  Grid,
  Card,
  CardContent,
  CardActions,
  Chip,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  RadioGroup,
  FormControlLabel,
  Radio,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import ArrowBackIcon from "@mui/icons-material/ArrowBackOutlined";
import ModelTrainingIcon from "@mui/icons-material/ModelTrainingOutlined";
import AccessTimeIcon from "@mui/icons-material/AccessTimeOutlined";
import PageHeader from "./common/PageHeader";
import Section from "./common/Section";

function InferenceModelSelection({ selectedTracks, onBack, onModelSelected }) {
  const theme = useTheme();
  const [availableModels, setAvailableModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedModel, setSelectedModel] = useState(null);
  const [checkpointDialogOpen, setCheckpointDialogOpen] = useState(false);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState(null);

  useEffect(() => {
    fetchAvailableModels();
  }, []);

  const fetchAvailableModels = async () => {
    try {
      setLoading(true);
      // This would be replaced with actual API call to get available models
      const response = await fetch("/api/available-models");
      if (!response.ok) {
        throw new Error("Failed to fetch available models");
      }
      const data = await response.json();
      setAvailableModels(data.models || []);
    } catch (err) {
      // Don't log AbortError as it's expected when component unmounts
      if (err.name !== 'AbortError') {
        console.error("Error fetching models:", err);
        setError(err.message);
      }
      // For now, show some mock models
      setAvailableModels([
        {
          name: "test_model",
          created: "2024-01-18T18:45:00Z",
          epochs: 5,
          sampleRate: 48000,
          status: "completed"
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleModelSelect = (model) => {
    setSelectedModel(model);
    setSelectedCheckpoint(model.bestCheckpoint);
    setCheckpointDialogOpen(true);
  };

  const handleContinue = () => {
    if (selectedModel && selectedCheckpoint && onModelSelected) {
      // Create a model object with the selected checkpoint
      const modelWithCheckpoint = {
        ...selectedModel,
        selectedCheckpoint: selectedCheckpoint
      };
      onModelSelected(modelWithCheckpoint, selectedTracks);
      setCheckpointDialogOpen(false);
    }
  };

  const handleCheckpointChange = (checkpoint) => {
    setSelectedCheckpoint(checkpoint);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 6 }}>
        <PageHeader title="Select Model for Inference" onBack={onBack} />
        <Box sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          py: 12,
          gap: 3
        }}>
          <Box sx={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: theme => theme.palette.mode === 'dark'
              ? 'linear-gradient(135deg, rgba(144, 202, 249, 0.1), rgba(144, 202, 249, 0.05))'
              : 'linear-gradient(135deg, rgba(10, 132, 255, 0.08), rgba(10, 132, 255, 0.04))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: theme => `1px solid ${theme.palette.mode === 'dark' ? 'rgba(144, 202, 249, 0.2)' : 'rgba(10, 132, 255, 0.15)'}`,
          }}>
            <CircularProgress size={40} thickness={2} />
          </Box>
          <Typography variant="body1" color="text.secondary" sx={{ fontWeight: 500 }}>
            Loading available models...
          </Typography>
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <PageHeader title="Select Model for Inference" onBack={onBack} />

      {/* Selected Tracks Summary - Compact */}
      <Box sx={{
        mb: 4,
        p: 3,
        backgroundColor: theme.palette.mode === 'dark'
          ? 'rgba(255, 255, 255, 0.02)'
          : 'rgba(0, 0, 0, 0.02)',
        borderRadius: 2,
        border: theme => `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)'}`,
      }}>
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" sx={{
            fontWeight: 600,
            color: theme.palette.text.primary,
            fontSize: '1.1rem',
            display: 'inline',
          }}>
            Selected Tracks
          </Typography>
          <Typography variant="body2" sx={{
            color: theme.palette.text.secondary,
            fontSize: '0.875rem',
            display: 'inline',
            ml: 1,
          }}>
            • {selectedTracks.length} track{selectedTracks.length !== 1 ? 's' : ''} ready for inference
          </Typography>
        </Box>
        <Box sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1,
          mb: 1
        }}>
          {selectedTracks.map((track) => {
            const trackName = track.displayName || track.name || "Untitled track";
            return (
              <Box
                key={track.id}
                sx={{
                  px: 1.5,
                  py: 0.75,
                  backgroundColor: theme.palette.mode === 'dark'
                    ? 'rgba(144, 202, 249, 0.1)'
                    : 'rgba(10, 132, 255, 0.08)',
                  border: theme => `1px solid ${theme.palette.mode === 'dark' ? 'rgba(144, 202, 249, 0.2)' : 'rgba(10, 132, 255, 0.15)'}`,
                  borderRadius: 1.5,
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                <Typography variant="body2" sx={{
                  fontWeight: 500,
                  color: theme.palette.primary.main,
                  fontSize: '0.8rem',
                }}>
                  {trackName}
                </Typography>
              </Box>
            );
          })}
        </Box>
       
      </Box>

      {/* Available Models - Compact Grid */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{
          mb: 3,
          fontWeight: 600,
          color: theme.palette.text.primary,
          fontSize: '1.25rem',
          textAlign: 'center',
        }}>
          Available Models
        </Typography>

        {error && (
          <Box sx={{
            p: 3,
            mb: 4,
            backgroundColor: theme.palette.mode === 'dark'
              ? 'rgba(255, 69, 58, 0.1)'
              : 'rgba(255, 69, 58, 0.05)',
            border: theme => `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255, 69, 58, 0.2)' : 'rgba(255, 69, 58, 0.15)'}`,
            borderRadius: 2,
          }}>
            <Typography variant="body2" color="error.main">
              Error loading models: {error}
            </Typography>
          </Box>
        )}

        {availableModels.length === 0 ? (
          <Box sx={{
            textAlign: 'center',
            py: 8,
            px: 4,
          }}>
            <Box sx={{
              width: 120,
              height: 120,
              borderRadius: '50%',
              backgroundColor: theme.palette.mode === 'dark'
                ? 'rgba(255, 255, 255, 0.05)'
                : 'rgba(0, 0, 0, 0.05)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 3',
              border: theme => `2px solid ${theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'}`,
            }}>
              <ModelTrainingIcon sx={{
                fontSize: 48,
                color: theme.palette.text.disabled,
              }} />
            </Box>
            <Typography variant="h6" sx={{
              mb: 2,
              color: theme.palette.text.secondary,
              fontWeight: 500,
            }}>
              No trained models available
            </Typography>
            <Typography variant="body2" sx={{
              color: theme.palette.text.secondary,
              maxWidth: 400,
              mx: 'auto',
              lineHeight: 1.6,
            }}>
              Train a voice model first to use inference features. Models will appear here once training is complete.
            </Typography>
          </Box>
        ) : (
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 2,
        }}>
            {availableModels.map((model) => (
            <Box
              key={model.name}
              onClick={() => handleModelSelect(model)}
              sx={{
                p: 2.5,
                backgroundColor: selectedModel?.name === model.name
                  ? theme.palette.mode === 'dark'
                    ? 'rgba(144, 202, 249, 0.08)'
                    : 'rgba(10, 132, 255, 0.06)'
                  : theme.palette.mode === 'dark'
                    ? 'rgba(255, 255, 255, 0.02)'
                    : 'rgba(255, 255, 255, 0.8)',
                border: selectedModel?.name === model.name
                  ? `2px solid ${theme.palette.primary.main}`
                  : theme.palette.mode === 'dark'
                    ? '1px solid rgba(255, 255, 255, 0.08)'
                    : '1px solid rgba(0, 0, 0, 0.08)',
                borderRadius: 2,
                cursor: 'pointer',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                '&:hover': {
                  backgroundColor: selectedModel?.name === model.name
                    ? theme.palette.mode === 'dark'
                      ? 'rgba(144, 202, 249, 0.12)'
                      : 'rgba(10, 132, 255, 0.08)'
                    : theme.palette.mode === 'dark'
                      ? 'rgba(255, 255, 255, 0.05)'
                      : 'rgba(0, 0, 0, 0.02)',
                  transform: 'translateY(-1px)',
                  boxShadow: theme.palette.mode === 'dark'
                    ? '0 4px 12px rgba(0, 0, 0, 0.15)'
                    : '0 4px 12px rgba(0, 0, 0, 0.08)',
                },
              }}
            >
                {/* Model Header - Inline */}
                <Box sx={{
                  mb: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}>
                  <Typography variant="h6" sx={{
                    fontWeight: 600,
                    color: theme.palette.text.primary,
                    fontSize: '1.1rem',
                    flex: 1,
                  }}>
                    {model.name}
                  </Typography>
                  <Box sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                  }}>
                    <AccessTimeIcon sx={{
                      fontSize: 14,
                      color: theme.palette.text.secondary,
                    }} />
                    <Typography variant="caption" sx={{
                      color: theme.palette.text.secondary,
                      fontSize: '0.75rem',
                    }}>
                      {formatDate(model.created)}
                    </Typography>
                  </Box>
                </Box>

                {/* Model Stats - Centered Pills */}
                <Box sx={{
                  display: 'flex',
                  gap: 0.75,
                  mb: 1,
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}>
                  <Box sx={{
                    px: 1.5,
                    py: 0.5,
                    backgroundColor: theme.palette.mode === 'dark'
                      ? 'rgba(255, 255, 255, 0.08)'
                      : 'rgba(0, 0, 0, 0.06)',
                    borderRadius: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: 24,
                  }}>
                    <Typography variant="caption" sx={{
                      fontWeight: 500,
                      color: theme.palette.text.primary,
                      fontSize: '0.75rem',
                      lineHeight: 1,
                    }}>
                      {model.epochs}e
                    </Typography>
                  </Box>
                  <Box sx={{
                    px: 1.5,
                    py: 0.5,
                    backgroundColor: theme.palette.mode === 'dark'
                      ? 'rgba(255, 255, 255, 0.08)'
                      : 'rgba(0, 0, 0, 0.06)',
                    borderRadius: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: 24,
                  }}>
                    <Typography variant="caption" sx={{
                      fontWeight: 500,
                      color: theme.palette.text.primary,
                      fontSize: '0.75rem',
                      lineHeight: 1,
                    }}>
                      {model.sampleRate}Hz
                    </Typography>
                  </Box>
                  <Box sx={{
                    px: 1.5,
                    py: 0.5,
                    backgroundColor: theme.palette.mode === 'dark'
                      ? 'rgba(10, 132, 255, 0.15)'
                      : 'rgba(10, 132, 255, 0.12)',
                    borderRadius: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: 24,
                  }}>
                    <Typography variant="caption" sx={{
                      fontWeight: 500,
                      color: theme.palette.primary.main,
                      fontSize: '0.75rem',
                      lineHeight: 1,
                    }}>
                      {model.checkpoints?.length || 0}ckpt
                    </Typography>
                  </Box>
                </Box>

                {/* Checkpoints Preview */}
                {model.checkpoints && model.checkpoints.length > 0 && (
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" sx={{
                      color: theme.palette.text.secondary,
                      fontSize: '0.8rem',
                      mb: 1,
                      fontWeight: 500,
                    }}>
                      Latest Checkpoints
                    </Typography>
                    <Box sx={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      marginTop:'10px',
                      gap: 0.5,
                    }}>
                      {model.checkpoints.slice(0, 3).map((checkpoint, idx) => (
                        <Box
                          key={idx}
                          sx={{
                            px: 1,
                            py: 0.25,
                            backgroundColor: checkpoint.isBest
                              ? theme.palette.mode === 'dark'
                                ? 'rgba(52, 199, 89, 0.15)'
                                : 'rgba(52, 199, 89, 0.08)'
                              : theme.palette.mode === 'dark'
                                ? 'rgba(255, 255, 255, 0.03)'
                                : 'rgba(0, 0, 0, 0.03)',
                            border: checkpoint.isBest
                              ? `1px solid ${theme.palette.success.main}`
                              : theme.palette.mode === 'dark'
                                ? '1px solid rgba(255, 255, 255, 0.08)'
                                : '1px solid rgba(0, 0, 0, 0.08)',
                            borderRadius: 0.75,
                            alignItems:'center',
                          }}
                        >
                          <Typography variant="caption" sx={{
                            fontWeight: checkpoint.isBest ? 600 : 500,
                            color: checkpoint.isBest
                              ? theme.palette.success.main
                              : theme.palette.text.primary,
                            fontSize: '0.65rem',
                          }}>
                            {checkpoint.epochs}e{checkpoint.isBest ? '★' : ''}
                          </Typography>
                        </Box>
                      ))}
                      {model.checkpoints.length > 3 && (
                        <Box sx={{
                          px: 1.5,
                          py: 0.75,
                          backgroundColor: theme.palette.mode === 'dark'
                            ? 'rgba(255, 255, 255, 0.03)'
                            : 'rgba(0, 0, 0, 0.03)',
                          borderRadius: 1,
                        }}>
                          <Typography variant="caption" sx={{
                            color: theme.palette.text.secondary,
                            fontSize: '0.75rem',
                            display:'flex',
                      alignSelf:'center',
                          }}>
                            +{model.checkpoints.length - 3}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </Box>
                )}

                {/* Status Badge */}
                <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  mt: 1,
                }}>
                  <Box sx={{
                    px: 1.5,
                    py:1,
                    backgroundColor: model.status === 'completed'
                      ? theme.palette.mode === 'dark'
                        ? 'rgba(52, 199, 89, 0.15)'
                        : 'rgba(52, 199, 89, 0.08)'
                      : theme.palette.mode === 'dark'
                        ? 'rgba(255, 159, 10, 0.15)'
                        : 'rgba(255, 159, 10, 0.08)',
                    borderRadius: 1,
                  }}>
                    <Typography variant="caption" sx={{
                      fontWeight: 600,
                      color: model.status === 'completed'
                        ? theme.palette.success.main
                        : theme.palette.warning.main,
                      fontSize: '0.7rem',
                      textTransform: 'capitalize',
                      display:'flex',
                      alignSelf:'center',
                    }}>
                      {model.status}
                    </Typography>
                  </Box>

                  <Box sx={{
                    px: 2,
                    py: 0.75,
                    backgroundColor: selectedModel?.name === model.name
                      ? theme.palette.primary.main
                      : theme.palette.mode === 'dark'
                        ? 'rgba(255, 255, 255, 0.08)'
                        : 'rgba(0, 0, 0, 0.06)',
                    borderRadius: 1.5,
                    border: selectedModel?.name === model.name
                      ? 'none'
                      : theme.palette.mode === 'dark'
                        ? '1px solid rgba(255, 255, 255, 0.1)'
                        : '1px solid rgba(0, 0, 0, 0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: 60,
                  }}>
                    <Typography variant="caption" sx={{
                      color: selectedModel?.name === model.name
                        ? 'white'
                        : theme.palette.text.primary,
                      fontWeight: selectedModel?.name === model.name ? 600 : 500,
                      fontSize: '0.75rem',
                      display:'flex',
                      alignSelf:'center',
                    }}>
                      {selectedModel?.name === model.name ? 'Selected' : 'Select'}
                    </Typography>
                  </Box>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {/* Continue Section */}
      {selectedModel && (
        <Box sx={{
          mt: 4,
          p: 3,
          backgroundColor: theme.palette.mode === 'dark'
            ? 'rgba(144, 202, 249, 0.06)'
            : 'rgba(10, 132, 255, 0.04)',
          border: theme => `1px solid ${theme.palette.mode === 'dark' ? 'rgba(144, 202, 249, 0.15)' : 'rgba(10, 132, 255, 0.1)'}`,
          borderRadius: 2,
          textAlign: 'center',
        }}>
          <Typography variant="h6" sx={{
            mb: 2,
            fontWeight: 600,
            color: theme.palette.text.primary,
            fontSize: '1.1rem',
          }}>
            Ready to Continue
          </Typography>
          <Typography variant="body2" sx={{
            mb: 3,
            color: theme.palette.text.secondary,
            maxWidth: 400,
            mx: 'auto',
            lineHeight: 1.5,
            fontSize: '0.875rem',
          }}>
            You've selected "{selectedModel.name}" with {selectedModel.checkpoints?.length || 0} checkpoints.
            Choose your preferred checkpoint to proceed.
          </Typography>
          <Button
            variant="contained"
            color="primary"
            onClick={() => setCheckpointDialogOpen(true)}
            size="small"
            sx={{
              px: 4,
              py: 1,
              borderRadius: 2,
              fontWeight: 600,
              fontSize: '0.9rem',
              boxShadow: theme.palette.mode === 'dark'
                ? '0 4px 16px rgba(10, 132, 255, 0.3)'
                : '0 4px 16px rgba(10, 132, 255, 0.2)',
              '&:hover': {
                boxShadow: theme.palette.mode === 'dark'
                  ? '0 6px 20px rgba(10, 132, 255, 0.4)'
                  : '0 6px 20px rgba(10, 132, 255, 0.3)',
                transform: 'translateY(-1px)',
              },
              transition: 'all 0.2s ease',
            }}
          >
            Choose Checkpoint
          </Button>
        </Box>
      )}

      {/* Checkpoint Selection Dialog - Fixed Header/Footer */}
      <Dialog
        open={checkpointDialogOpen}
        onClose={() => setCheckpointDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        sx={{
          '& .MuiDialog-paper': {
            borderRadius: 3,
            boxShadow: theme.palette.mode === 'dark'
              ? '0 25px 50px rgba(0, 0, 0, 0.4)'
              : '0 25px 50px rgba(0, 0, 0, 0.15)',
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column',
          },
        }}
      >
        {/* Fixed Header */}
        <Box sx={{
          p: 3,
          pb: 2,
          borderBottom: theme => `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)'}`,
          flexShrink: 0,
        }}>
          <Typography variant="h5" sx={{
            fontWeight: 600,
            color: theme.palette.text.primary,
            mb: 1,
            fontSize: '1.25rem',
          }}>
            Choose Checkpoint
          </Typography>
          <Typography variant="body2" sx={{
            color: theme.palette.text.secondary,
            lineHeight: 1.5,
            fontSize: '0.875rem',
          }}>
            Select which training checkpoint to use for inference.
          </Typography>
        </Box>

        {/* Scrollable Content */}
        <Box sx={{
          flex: 1,
          overflow: 'auto',
          px: 3,
          py: 1,
        }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {selectedModel?.checkpoints?.map((checkpoint) => (
              <Box
                key={checkpoint.filename}
                onClick={() => setSelectedCheckpoint(checkpoint)}
                sx={{
                  p: 2,
                  border: selectedCheckpoint?.filename === checkpoint.filename
                    ? `2px solid ${theme.palette.primary.main}`
                    : theme.palette.mode === 'dark'
                      ? '1px solid rgba(255, 255, 255, 0.08)'
                      : '1px solid rgba(0, 0, 0, 0.08)',
                  borderRadius: 2,
                  backgroundColor: selectedCheckpoint?.filename === checkpoint.filename
                    ? theme.palette.mode === 'dark'
                      ? 'rgba(144, 202, 249, 0.08)'
                      : 'rgba(10, 132, 255, 0.06)'
                    : 'transparent',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    backgroundColor: selectedCheckpoint?.filename === checkpoint.filename
                      ? theme.palette.mode === 'dark'
                        ? 'rgba(144, 202, 249, 0.12)'
                        : 'rgba(10, 132, 255, 0.08)'
                      : theme.palette.mode === 'dark'
                        ? 'rgba(255, 255, 255, 0.02)'
                        : 'rgba(0, 0, 0, 0.02)',
                  },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Box sx={{
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      border: selectedCheckpoint?.filename === checkpoint.filename
                        ? `2px solid ${theme.palette.primary.main}`
                        : theme.palette.mode === 'dark'
                          ? '2px solid rgba(255, 255, 255, 0.3)'
                          : '2px solid rgba(0, 0, 0, 0.3)',
                      backgroundColor: selectedCheckpoint?.filename === checkpoint.filename
                        ? theme.palette.primary.main
                        : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      {selectedCheckpoint?.filename === checkpoint.filename && (
                        <Box sx={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          backgroundColor: 'white',
                        }} />
                      )}
                    </Box>
                    <Box>
                      <Typography variant="body1" sx={{
                        fontWeight: 500,
                        color: theme.palette.text.primary,
                        mb: 0.5,
                      }}>
                        {checkpoint.epochs} epoch{checkpoint.epochs !== 1 ? 's' : ''}
                      </Typography>
                      <Typography variant="caption" sx={{
                        color: theme.palette.text.secondary,
                      }}>
                        {formatDate(checkpoint.created)}
                      </Typography>
                    </Box>
                  </Box>
                  {checkpoint.isBest && (
                    <Box sx={{
                      px: 1.5,
                      py: 0.5,
                      backgroundColor: theme.palette.mode === 'dark'
                        ? 'rgba(52, 199, 89, 0.15)'
                        : 'rgba(52, 199, 89, 0.08)',
                      border: `1px solid ${theme.palette.success.main}`,
                      borderRadius: 1,
                    }}>
                      <Typography variant="caption" sx={{
                        fontWeight: 600,
                        color: theme.palette.success.main,
                        fontSize: '0.7rem',
                      }}>
                        BEST
                      </Typography>
                    </Box>
                  )}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>

        {/* Fixed Footer */}
        <Box sx={{
          p: 3,
          pt: 2,
          pb:2,
          borderTop: theme => `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)'}`,
          display: 'flex',
          gap: 2,
          justifyContent: 'flex-end',
          flexShrink: 0,
        }}>
          <Button
            onClick={() => setCheckpointDialogOpen(false)}
            sx={{
              px: 3,
              py: 1,
              borderRadius: 2,
              fontWeight: 500,
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleContinue}
            variant="contained"
            disabled={!selectedCheckpoint}
            sx={{
              px: 4,
              py: 1,
              borderRadius: 2,
              fontWeight: 600,
              background: theme.palette.mode === 'dark'
                ? 'linear-gradient(135deg, #0A84FF 0%, #0D47A1 100%)'
                : 'linear-gradient(135deg, #0A84FF 0%, #0A84FF 100%)',
              boxShadow: theme.palette.mode === 'dark'
                ? '0 4px 16px rgba(10, 132, 255, 0.3)'
                : '0 4px 16px rgba(10, 132, 255, 0.2)',
              '&:hover': {
                boxShadow: theme.palette.mode === 'dark'
                  ? '0 6px 20px rgba(10, 132, 255, 0.4)'
                  : '0 6px 20px rgba(10, 132, 255, 0.3)',
                transform: 'translateY(-1px)',
              },
              transition: 'all 0.2s ease',
            }}
          >
            Continue
          </Button>
        </Box>
      </Dialog>
    </Container>
  );
}

export default InferenceModelSelection;
