import React, { useState, useEffect, useMemo } from "react";
import {
  Box, Typography, Grid, Chip, Button, CircularProgress, IconButton,
  Container, Dialog, DialogTitle, DialogContent, DialogActions, Fade,
  TextField, InputAdornment, Stack, Pagination, LinearProgress
} from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import {
  CloudDownload as DownloadIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  CloudQueue as CloudIcon,
  CloudOff as CloudOffIcon,
  ArrowBack as ArrowBackIcon
} from "@mui/icons-material";

// --- Original Sub-components (Design Preserved) ---

const StatPill = ({ label, color, theme, style }) => (
  <Box sx={{
    px: 1.4,
    py: 0.45,
    borderRadius: 999,
    display: 'flex',
    alignItems: 'center',
    backgroundColor: alpha(color || theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.14 : 0.08),
    border: `1px solid ${alpha(color || theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.18 : 0.1)}`,
    whiteSpace: 'nowrap',
    ...style
  }}>
    <Typography variant="caption" sx={{ fontWeight: 600, color: color || 'text.primary', fontSize: '0.72rem', letterSpacing: 0.2 }}>
      {label}
    </Typography>
  </Box>
);

const ActionToolbar = ({
  searchQuery, setSearchQuery, showOnline, setShowOnline,
  selectedCount, onClear, onDelete, onSelectAll, theme, isInferenceSelection
}) => (
  <Box sx={{
    p: 2,
    mb: 3,
    borderRadius: 999,
    border: `1px solid ${alpha(theme.palette.primary.main, 0.35)}`,
    background: theme.palette.mode === 'dark'
      ? 'linear-gradient(135deg, rgba(14,16,24,0.9), rgba(20,22,32,0.8))'
      : 'linear-gradient(135deg, #ffffff, #f2f5ff)',
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    minHeight: 64,
    boxShadow: theme.palette.mode === 'dark'
      ? '0 12px 30px rgba(4,10,30,0.55)'
      : '0 12px 30px rgba(30,60,130,0.08)',
    transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
  }}>
    {/* Bulk Selection (Hidden in Inference Mode to keep it clean) */}
    {!isInferenceSelection && (
      <Stack direction="row" spacing={1} alignItems="center">
        <Button
          variant="outlined"
          size="small"
          onClick={onSelectAll}
          sx={{
            borderRadius: 999,
            height: 38,
            px: 2,
            whiteSpace: 'nowrap',
            borderColor: alpha(theme.palette.primary.main, 0.45),
            color: theme.palette.primary.main,
            backgroundColor: alpha(theme.palette.primary.main, 0.08),
            '&:hover': {
              borderColor: theme.palette.primary.main,
              backgroundColor: alpha(theme.palette.primary.main, 0.18),
            },
          }}
        >
          Select All
        </Button>
        <Fade in={selectedCount > 0} unmountOnExit>
          <Button
            variant="outlined"
            size="small"
            onClick={onClear}
            sx={{
              borderRadius: 999,
              height: 38,
              borderColor: alpha(theme.palette.text.secondary, 0.5),
              color: theme.palette.text.secondary,
              '&:hover': { borderColor: theme.palette.text.primary, color: theme.palette.text.primary },
            }}
          >
            Clear
          </Button>
        </Fade>
      </Stack>
    )}

    {/* Search & Cloud Toggle (Identical to Original Design) */}
    <TextField
      fullWidth size="small"
      placeholder="Search local and online models..."
      value={searchQuery}
      onChange={e => setSearchQuery(e.target.value)}
      sx={{
        '& .MuiOutlinedInput-root': {
          borderRadius: 999,
          bgcolor: alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.35 : 0.03),
          border: `1px solid ${alpha(theme.palette.primary.main, 0.35)}`,
          boxShadow: theme.palette.mode === 'dark'
            ? 'inset 0 0 0 1px rgba(70,140,255,0.2)'
            : 'inset 0 0 0 1px rgba(70,140,255,0.1)',
          '& fieldset': { border: 'none' },
        },
      }}
      InputProps={{
        startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment>,
        endAdornment: (
          <InputAdornment position="end">
            <IconButton
              onClick={() => setShowOnline(!showOnline)}
              size="small"
              sx={{
                color: showOnline ? theme.palette.primary.main : theme.palette.text.secondary,
                backgroundColor: alpha(theme.palette.primary.main, showOnline ? 0.18 : 0.06),
                borderRadius: 2,
                '&:hover': { backgroundColor: alpha(theme.palette.primary.main, 0.28) },
              }}
            >
              {showOnline ? <CloudIcon /> : <CloudOffIcon />}
            </IconButton>
          </InputAdornment>
        )
      }}
    />

    {/* Delete Action (Hidden in Inference Mode) */}
    {!isInferenceSelection && (
      <Box sx={{ position: 'relative', flexShrink: 0 }}>
        <IconButton
          onClick={onDelete} disabled={selectedCount === 0}
          sx={{
            width: 40,
            height: 40,
            bgcolor: selectedCount > 0 ? 'error.main' : alpha(theme.palette.error.main, 0.12),
            color: selectedCount > 0 ? 'white' : theme.palette.text.disabled,
            borderRadius: '50%',
            '&:hover': { bgcolor: 'error.dark' },
            transition: 'all 0.3s ease'
          }}
        >
          <DeleteIcon sx={{ fontSize: '1.25rem' }} />
        </IconButton>
        <Fade in={selectedCount > 0}>
          <Box sx={{
            position: 'absolute', top: -5, right: -5, width: 22, height: 22, bgcolor: 'error.light',
            color: 'white', borderRadius: '50%', display: 'grid', placeItems: 'center', 
            fontSize: '0.75rem', fontWeight: 700, border: `2px solid ${theme.palette.background.paper}`, boxShadow: 2
          }}>
            {selectedCount}
          </Box>
        </Fade>
      </Box>
    )}
  </Box>
);

// --- Main View ---

function ModelsView({ 
  isInferenceSelection = false, 
  selectedTracks = [], 
  onBack, 
  onModelSelected 
}) {
  const theme = useTheme();
  
  // State: Management & Display
  const [models, setModels] = useState([]);
  const [onlineResults, setOnlineResults] = useState([]);
  const [showOnline, setShowOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState(new Set());
  
  // State: Downloads & Progress
  const [downloadingProgress, setDownloadingProgress] = useState({}); // { [url]: progress_number }
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [activeDownloadModel, setActiveDownloadModel] = useState(null);
  const [customModelName, setCustomModelName] = useState("");
  const [downloadError, setDownloadError] = useState("");

  // State: Inference Selection
  const [checkpointDialogOpen, setCheckpointDialogOpen] = useState(false);
  const [targetInferenceModel, setTargetInferenceModel] = useState(null);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // --- Logic ---

  useEffect(() => { fetchModels(); }, []);

  const fetchModels = async () => {
    try {
      const res = await fetch('/api/available-models');
      const data = await res.json();
      setModels(data.models || []);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (searchQuery.trim() && showOnline) {
        performOnlineSearch(currentPage, controller.signal);
      } else {
        setOnlineResults([]);
        setTotalPages(1);
      }
    }, 800);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [searchQuery, currentPage, showOnline]);

  const performOnlineSearch = async (page, signal) => {
    try {
      const res = await fetch(`/api/search-online-models?query=${encodeURIComponent(searchQuery)}&page=${page}`, { signal });
      const data = await res.json();
      setOnlineResults(data.models || []);
      setTotalPages(data.total_pages || 1);
    } catch (err) { if (err.name !== 'AbortError') console.error(err); }
  };

  const handleCardClick = (model) => {
    if (model.isOnline) return; // Must use download button

    if (isInferenceSelection) {
      setTargetInferenceModel(model);
      setSelectedCheckpoint(model.bestCheckpoint || (model.checkpoints ? model.checkpoints[0] : null));
      setCheckpointDialogOpen(true);
    } else {
      setSelected(prev => {
        const n = new Set(prev);
        n.has(model.name) ? n.delete(model.name) : n.add(model.name);
        return n;
      });
    }
  };

  const executeDownload = async () => {
    const name = customModelName.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const url = activeDownloadModel.url;
    if (!name) return setDownloadError("Please enter a name.");
    
    setDownloadDialogOpen(false);
    setDownloadingProgress(prev => ({ ...prev, [url]: 0 }));

    try {
      // Simulate real-time progress increments while the fetch handles the stream
      const progressTimer = setInterval(() => {
        setDownloadingProgress(prev => {
          const current = prev[url] ?? 0;
          if (current >= 95) return prev;
          return { ...prev, [url]: current + (100 - current) * 0.2 };
        });
      }, 1000);

      const responsedownload =  await fetch('/api/download-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, modelName: activeDownloadModel.name, userQuery: name })
      });

      if(responsedownload.ok){

        setDownloadingProgress(prev => {
          const newState = { ...prev };
          delete newState[url];
          return newState;
        });
  
        // 2. TRIGGER REFRESH: This brings the new model into the 'local' list
        await fetchModels();
      }
    } catch (err) {
      setDownloadingProgress(prev => { const n = { ...prev }; delete n[url]; return n; });
    }
  };

  const displayModels = useMemo(() => {
    const local = models
      .filter(m => m.name.toLowerCase().includes(searchQuery.toLowerCase()))
      .map(m => ({ ...m, isOnline: false }));
    
    const online = showOnline 
      ? onlineResults
          // Filter out online models that already exist in your local list
          .filter(om => !models.some(lm => lm.name.toLowerCase() === om.name.toLowerCase()))
          .map(m => ({ ...m, isOnline: true })) 
      : [];
      
    return [...local, ...online];
  }, [models, onlineResults, showOnline, searchQuery]);

  if (loading) return <Box sx={{ py: 10, textAlign: 'center' }}><CircularProgress /><Typography mt={2}>Loading models...</Typography></Box>;

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Box
        sx={{
          borderRadius: 4,
          border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
          background: theme.palette.mode === 'dark'
            ? 'linear-gradient(160deg, rgba(18,20,30,0.92), rgba(10,10,14,0.95))'
            : 'linear-gradient(160deg, #f8f9ff, #eef2ff)',
          boxShadow: theme.palette.mode === 'dark'
            ? '0 30px 80px rgba(0,0,0,0.45)'
            : '0 30px 80px rgba(30,60,120,0.12)',
          p: { xs: 2.5, md: 4 },
          backdropFilter: 'blur(24px)',
        }}
      >
        <Box
          sx={{
            mb: 3,
            borderRadius: 3,
            p: 2.5,
            background: theme.palette.mode === 'dark'
              ? 'linear-gradient(135deg, rgba(23,25,40,0.92), rgba(16,18,28,0.92))'
              : 'linear-gradient(135deg, #ffffff, #f5f8ff)',
            border: `1px solid ${alpha(theme.palette.primary.main, 0.18)}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
          }}
        >
          {isInferenceSelection ? (
            <IconButton
              onClick={onBack}
              sx={{
                borderRadius: 2,
                color: theme.palette.text.secondary,
                backgroundColor: alpha(theme.palette.primary.main, 0.08),
                '&:hover': { color: theme.palette.primary.main, backgroundColor: alpha(theme.palette.primary.main, 0.18) },
              }}
            >
              <ArrowBackIcon />
            </IconButton>
          ) : (
            <Box sx={{ width: 40 }} />
          )}
          <Typography
            variant="h5"
            sx={{
              fontWeight: 600,
              textAlign: 'center',
              flex: 1,
              letterSpacing: 0.4,
            }}
          >
            {isInferenceSelection ? "Select Model for Inference" : "Trained Voice Models"}
          </Typography>
          <Box sx={{ width: 40 }} />
        </Box>

      <ActionToolbar
        searchQuery={searchQuery} setSearchQuery={(val) => { setSearchQuery(val); setCurrentPage(1); }}
        showOnline={showOnline} setShowOnline={setShowOnline}
        selectedCount={selected.size} 
        onSelectAll={() => setSelected(new Set(models.map(m => m.name)))}
        onClear={() => setSelected(new Set())}
        onDelete={() => setDeleteOpen(true)}
        theme={theme}
        isInferenceSelection={isInferenceSelection}
      />

      <Grid container spacing={2.5}>
        {displayModels.map((model, i) => {
          const isSelected = selected.has(model.name);
          const downloadPct = downloadingProgress[model.url];

          return (
            <Grid item xs={12} sm={6} md={4} key={model.url || model.name || i}>
              <Box
                onClick={() => handleCardClick(model)}
                sx={{
                  p: 2.5,
                  borderRadius: 3,
                  transition: '0.3s',
                  cursor: model.isOnline ? 'default' : 'pointer',
                  border: `1px solid ${isSelected ? alpha(theme.palette.primary.main, 0.7) : 'rgba(255, 255, 255, 0.08)'}`,
                  background: theme.palette.mode === 'dark'
                    ? 'linear-gradient(160deg, rgba(28,30,40,0.9), rgba(12,12,16,0.9))'
                    : 'linear-gradient(160deg, #ffffff, #f1f5ff)',
                  position: 'relative',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  boxShadow: isSelected
                    ? '0 0 0 1px rgba(72,130,255,0.4), 0 20px 40px rgba(20,40,90,0.35)'
                    : '0 16px 30px rgba(0,0,0,0.25)',
                  '&:hover': {
                    transform: 'translateY(-3px)',
                    boxShadow: isSelected
                      ? '0 0 0 1px rgba(72,130,255,0.5), 0 24px 50px rgba(20,40,90,0.4)'
                      : '0 20px 40px rgba(0,0,0,0.3)',
                  }
                }}
              >
                {/* Download Progress Bar Overlay */}
                {downloadPct !== undefined && (
                  <Box sx={{ position: 'absolute', top: 0, left: 0, width: '100%', px: 1 }}>
                    <LinearProgress variant="determinate" value={downloadPct} sx={{ height: 4, borderRadius: 2 }} />
                  </Box>
                )}

                {model.isOnline && (
                  <Chip
                    label="Online"
                    size="small"
                    sx={{
                      position: 'absolute',
                      top: 12,
                      right: 12,
                      height: 20,
                      fontSize: '0.6rem',
                      bgcolor: 'primary.main',
                      color: 'white',
                      fontWeight: 700
                    }}
                  />
                )}

                <Box sx={{ mb: 1 }}>
                  <Typography variant="h6" fontWeight={600} sx={{ pr: model.isOnline ? 5 : 0, lineHeight: 1.2, mb: 0.5 }}>{model.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {model.isOnline ? "From Cloud Search" : (model.created ? new Date(model.created).toLocaleDateString() : 'Local')}
                  </Typography>
                </Box>

                <Stack direction="row" justifyContent="space-between" spacing={1} mb={2} mt="auto">
                  <Stack direction="row" spacing={1} flexWrap="wrap">
                    {model.checkpoints?.length > 0 && <StatPill label={`${model.checkpoints.length} CP`} color={theme.palette.primary.main} theme={theme} />}
                    {model.sampleRate && <StatPill label={`${model.sampleRate}hz`} theme={theme} />}
                  </Stack>
                  <StatPill label={`${model.size_mb || 'N/A'} MB`} theme={theme} />
                </Stack>
          
                {!model.isOnline && model.checkpoints && model.checkpoints.length > 0 && (
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Latest Checkpoints:</Typography>
                    <Stack direction="row" spacing={1}>
                      {model.checkpoints.slice(0, 3).map((cp, idx) => (
                        <StatPill
                          key={idx}
                          label={`${cp.epochs}e`}
                          color={'#fff'}
                          theme={theme}
                          style={{
                            bgcolor: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,255,255,0.08)',
                          }}
                        />
                      ))}
                    </Stack>
                  </Box>
                )}

                {model.isOnline ? (
                  <Button
                    fullWidth
                    variant="contained"
                    disabled={downloadPct !== undefined}
                    onClick={(e) => { e.stopPropagation(); setActiveDownloadModel(model); setDownloadDialogOpen(true); }}
                    startIcon={downloadPct !== undefined ? <CircularProgress size={16} color="inherit" /> : <DownloadIcon />}
                    sx={{
                      borderRadius: 999,
                      textTransform: 'none',
                      background: 'linear-gradient(135deg, #2f6bff, #1b4ddb)',
                      boxShadow: '0 12px 24px rgba(35,78,170,0.45)',
                    }}
                  >
                    {downloadPct !== undefined ? `Downloading ${Math.round(downloadPct)}%` : 'Download'}
                  </Button>
                ) : (
                  <Chip
                    label={isInferenceSelection ? "SELECT MODEL" : (model.status?.toUpperCase() || "COMPLETED")}
                    sx={{
                      height: 'auto',
                      borderRadius: '12px',
                      bgcolor: isInferenceSelection ? 'primary.main' : 'rgba(76, 175, 80, 0.15)',
                      color: isInferenceSelection ? '#fff' : (model.status === 'completed' ? '#34C759' : '#FF9500'),
                      fontWeight: 600, '& .MuiChip-label': { px: 2, py: 0.8, fontSize: '0.65rem' },
                    }}
                  />
                )}
              </Box>
            </Grid>
          );
        })}
      </Grid>

      {/* Pagination */}
      {showOnline && totalPages > 1 && (
        <Box sx={{ mt: 4, display: 'flex', justifyContent: 'center' }}>
          <Pagination count={totalPages} page={currentPage} onChange={(e, val) => setCurrentPage(val)} color="primary" />
        </Box>
      )}

      {/* --- Checkpoint Dialog (Inference Mode) --- */}
      <Dialog open={checkpointDialogOpen} onClose={() => setCheckpointDialogOpen(false)} fullWidth maxWidth="xs" PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ fontWeight: 700 }}>Choose Checkpoint</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={3}>Select training epoch for <b>{targetInferenceModel?.name}</b></Typography>
          <Stack spacing={1.5}>
            {targetInferenceModel?.checkpoints?.map((cp) => (
              <Box 
                key={cp.filename}
                onClick={() => setSelectedCheckpoint(cp)}
                sx={{
                  p: 2, borderRadius: 2, cursor: 'pointer',
                  border: `2px solid ${selectedCheckpoint?.filename === cp.filename ? theme.palette.primary.main : alpha(theme.palette.divider, 0.1)}`,
                  bgcolor: selectedCheckpoint?.filename === cp.filename ? alpha(theme.palette.primary.main, 0.05) : 'transparent',
                }}
              >
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" fontWeight={600}>{cp.epochs} Epochs</Typography>
                  {cp.isBest && <Chip label="BEST" size="small" color="success" sx={{ height: 20, fontSize: '0.6rem' }} />}
                </Stack>
              </Box>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setCheckpointDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!selectedCheckpoint} onClick={() => onModelSelected({ ...targetInferenceModel, selectedCheckpoint }, selectedTracks)}>
            Use for Inference
          </Button>
        </DialogActions>
      </Dialog>

      {/* --- Download & Delete Dialogs --- */}
      <Dialog open={downloadDialogOpen} onClose={() => setDownloadDialogOpen(false)} PaperProps={{ sx: { borderRadius: 3, width: '100%', maxWidth: 400 } }}>
        <DialogTitle sx={{ textAlign: 'center' }}>Name your model</DialogTitle>
        <DialogContent>
            <TextField
                fullWidth autoFocus placeholder="e.g. My_Voice_V1" value={customModelName}
                onChange={(e) => { setCustomModelName(e.target.value); setDownloadError(""); }}
                error={!!downloadError} helperText={downloadError} variant="outlined"
            />
        </DialogContent>
        <DialogActions sx={{ p: 2, justifyContent: 'center', gap: 1 }}>
          <Button onClick={() => setDownloadDialogOpen(false)}>Cancel</Button>
          <Button onClick={executeDownload} variant="contained" sx={{ px: 4 }}>Confirm</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle>Confirm Deletion</DialogTitle>
        <DialogContent><Typography>Delete {selected.size} models? This cannot be undone.</Typography></DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button onClick={async () => {
            await Promise.all(Array.from(selected).map(n => fetch(`/api/models/${encodeURIComponent(n)}`, { method: 'DELETE' })));
            setSelected(new Set()); setDeleteOpen(false); fetchModels();
          }} variant="contained" color="error">Delete</Button>
        </DialogActions>
      </Dialog>
      </Box>
    </Container>
  );
}

export default ModelsView;
