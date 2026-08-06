import React, { useMemo, useState, useCallback, useEffect } from "react";
import {
  Box,
  Typography,
  Button,
  Container,
  Grid,
  Slider,
  FormControlLabel,
  Switch,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Paper,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from "@mui/material";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import TuneIcon from "@mui/icons-material/TuneOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMoreOutlined";
import AudioFileIcon from "@mui/icons-material/AudioFileOutlined";
import GraphicEqIcon from "@mui/icons-material/GraphicEqOutlined";
import SurroundSoundIcon from "@mui/icons-material/SurroundSoundOutlined";
import PaletteIcon from "@mui/icons-material/PaletteOutlined";
import { useTheme } from "@mui/material/styles";
import PageHeader from "./common/PageHeader";

function SectionAccordion({ icon, title, subtitle, children, defaultExpanded = false, gradient }) {
  const theme = useTheme();

  return (
    <Accordion
      defaultExpanded={defaultExpanded}
      sx={{
        backgroundColor: theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.02)" : "rgba(255, 255, 255, 0.8)",
        border: `1px solid ${
          theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)"
        }`,
        borderRadius: "12px !important",
        mb: 3,
        boxShadow: "none",
        "&:before": { display: "none" },
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        sx={{ px: 4, py: 3, "& .MuiAccordionSummary-content": { alignItems: "center", gap: 2 } }}
      >
        <Box
          sx={{
            width: 48,
            height: 48,
            borderRadius: 2,
            background: gradient,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {icon}
        </Box>

        <Box>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
            {title}
          </Typography>
          <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
            {subtitle}
          </Typography>
        </Box>
      </AccordionSummary>

      <AccordionDetails sx={{ px: 4, pb: 4 }}>{children}</AccordionDetails>
    </Accordion>
  );
}

function ParamCard({ children }) {
  const theme = useTheme();
  return (
    <Box
      sx={{
        p: 3,
        backgroundColor: theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.02)" : "rgba(0, 0, 0, 0.02)",
        borderRadius: 2,
        border: `1px solid ${
          theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)"
        }`,
      }}
    >
      {children}
    </Box>
  );
}

function TitleWithHelp({ title, help }) {
  const theme = useTheme();
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      {help ? (
        <Tooltip title={help}>
          <HelpOutlineIcon fontSize="small" sx={{ color: theme.palette.text.secondary }} />
        </Tooltip>
      ) : null}
    </Box>
  );
}

function LabeledSlider({
  label,
  help,
  value,
  onChange,
  min,
  max,
  step,
  marks,
  valueLabelDisplay = "auto",
  format = (v) => String(v),
}) {
  const theme = useTheme();
  return (
    <>
      <TitleWithHelp title={label} help={help} />
      <Box sx={{ px: 2 }}>
        <Slider
          value={typeof value === "number" ? value : 0}
          onChange={(_, v) => onChange(v)}
          min={min}
          max={max}
          step={step}
          marks={marks}
          valueLabelDisplay={valueLabelDisplay}
          sx={{
            "& .MuiSlider-markLabel": { fontSize: "0.75rem", color: theme.palette.text.secondary },
          }}
        />
      </Box>
      <Typography
        variant="caption"
        sx={{ display: "block", textAlign: "center", mt: 1, color: theme.palette.text.secondary }}
      >
        Current: {format(value)}
      </Typography>
    </>
  );
}

function SwitchTile({ label, checked, onChange, tooltip }) {
  const theme = useTheme();
  return (
    <Box
      sx={{
        p: 2,
        backgroundColor: theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.02)" : "rgba(0, 0, 0, 0.02)",
        borderRadius: 2,
        border: `1px solid ${
          theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.05)"
        }`,
      }}
    >
      <Tooltip title={tooltip || ""}>
        <FormControlLabel
          control={<Switch checked={!!checked} onChange={(e) => onChange(e.target.checked)} color="primary" />}
          label={label}
          sx={{ width: "100%", m: 0 }}
        />
      </Tooltip>
    </Box>
  );
}

const DEFAULT_PARAMS = {
  // Core
  pitch: 0, // semitones
  indexRate: 0.75,
  protectVoiced: 0.5,
  f0Method: "rmvpe",

  // Audio processing (toggles)
  splitAudio: false,
  autotune: false,
  autotuneStrength: 1.0,
  proposedPitch: false,
  proposedPitchThreshold: 155.0,
  cleanAudio: false,
  cleanStrength: 0.5,
  exportFormat: "WAV",

  // Volume envelope: UI as boolean, convert to numeric if needed
  volumeEnvelopeEnabled: true,

  // Formant shifting
  formantShifting: false,
  formantPreset: "none",
  formantQfrency: 1.0,
  formantTimbre: 1.0,

  // Post-processing
  postProcess: false,
  reverb: false,
  reverbRoomSize: 0.5,
  reverbDamping: 0.5,
  reverbWetGain: 0.33,
  reverbDryGain: 0.4,
  reverbWidth: 1.0,
  reverbFreezeMode: 0.0,

  pitchShift: false,
  pitchShiftSemitones: 0.0,

  limiter: false,
  limiterThreshold: -6.0,
  limiterReleaseTime: 0.05,

  gain: false,
  gainDb: 0.0,

  distortion: false,
  distortionGain: 25.0,

  chorus: false,
  chorusRate: 1.0,
  chorusDepth: 0.25,
  chorusCenterDelay: 7.0,
  chorusFeedback: 0.0,
  chorusMix: 0.5,

  bitcrush: false,
  bitcrushBitDepth: 8,

  clipping: false,
  clippingThreshold: -6.0,

  compressor: false,
  compressorThreshold: 0.0,
  compressorRatio: 1.0,
  compressorAttack: 1.0,
  compressorRelease: 100.0,

  delay: false,
  delaySeconds: 0.5,
  delayFeedback: 0.0,
  delayMix: 0.5,

  sid: 0,
};

export default function InferenceParams({ selectedModel, selectedTracks, onBack, onStartInference, navContext, onGoToModelSelection }) {
  const theme = useTheme();
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [resolvedModel, setResolvedModel] = useState(selectedModel);

  const trackCount = Array.isArray(selectedTracks) ? selectedTracks.length : 0;
  const effectiveModel = resolvedModel || selectedModel;
  const displayBaseName =
    typeof effectiveModel?.name === "string"
      ? effectiveModel.name
      : typeof effectiveModel?.modelName === "string"
        ? effectiveModel.modelName
        : "Model";
  const modelName = displayBaseName.split("_")[0];
  const modelEpoch =
    effectiveModel?.selectedCheckpoint?.epochs ??
    effectiveModel?.selectedCheckpoint?.epoch ??
    effectiveModel?.modelCheckpoint?.epoch ??
    "Unknown";
  const selectionNames = useMemo(
    () =>
      (selectedTracks || [])
        .map((track) => track?.displayName || track?.safeDisplayName || track?.originalName || track?.name || track?.fileId || track?.id)
        .filter(Boolean),
    [selectedTracks]
  );
  const selectionPreview = useMemo(() => {
    const list = selectionNames.slice(0, 4);
    const extra = selectionNames.length - list.length;
    const base = list.join(", ");
    return extra > 0 ? `${base} +${extra} more` : base;
  }, [selectionNames]);
  const hasModel = Boolean(
    effectiveModel?.name || effectiveModel?.modelName || effectiveModel?.id || effectiveModel?.modelId
  );

  // Tracks coming from the Inference view carry the run they were produced by,
  // which makes two different jobs possible: convert the original vocals again,
  // or stack this model on top of the previous conversion.
  const [sourceMode, setSourceMode] = useState("original");
  const layerableTracks = useMemo(
    () => (selectedTracks || []).filter((track) => track?.sourceRunId),
    [selectedTracks]
  );
  const canLayer = layerableTracks.length > 0;
  const previousModelName = useMemo(() => {
    const named = layerableTracks.find((track) => track?.sourceModelName);
    return named?.sourceModelName || null;
  }, [layerableTracks]);

  // A selection without any run behind it can only be re-inferred from source.
  useEffect(() => {
    if (!canLayer) setSourceMode("original");
  }, [canLayer]);

  useEffect(() => {
    let cancelled = false;

    const selectCheckpoint = (checkpoints, hint) => {
      if (!Array.isArray(checkpoints) || !checkpoints.length) return null;
      const hintEpochRaw = hint?.epoch ?? hint?.epochs;
      const hintEpoch = hintEpochRaw == null ? null : Number(hintEpochRaw);
      const hasHintEpoch = Number.isFinite(hintEpoch);
      const hintFile = hint?.pthFile || hint?.filename || null;
      if (hintFile) {
        const byFile = checkpoints.find(
          (cp) => cp?.filename === hintFile || (cp?.path && cp.path.endsWith(hintFile))
        );
        if (byFile) return byFile;
      }
      if (hasHintEpoch) {
        const byEpoch = checkpoints.find((cp) => Number(cp?.epochs) === hintEpoch);
        if (byEpoch) return byEpoch;
      }
      const best = checkpoints.find((cp) => cp?.isBest);
      return best || checkpoints[0];
    };

    const resolveModel = async () => {
      if (!selectedModel) {
        if (!cancelled) setResolvedModel(selectedModel);
        return;
      }

      const existingCheckpoint =
        selectedModel.selectedCheckpoint ||
        selectedModel.modelCheckpoint ||
        selectedModel.bestCheckpoint ||
        null;

      if (existingCheckpoint?.path) {
        if (!cancelled) setResolvedModel(selectedModel);
        return;
      }

      if (Array.isArray(selectedModel?.checkpoints) && selectedModel.checkpoints.length) {
        const picked = selectCheckpoint(selectedModel.checkpoints, existingCheckpoint);
        if (picked?.path) {
          if (!cancelled) setResolvedModel({ ...selectedModel, selectedCheckpoint: picked });
          return;
        }
      }

      try {
        const response = await fetch("/api/available-models");
        if (!response.ok) throw new Error("Failed to fetch available models");
        const data = await response.json();
        const models = data?.models || [];
        const targetId = selectedModel.id || selectedModel.modelId || null;
        const targetName = selectedModel.name || selectedModel.modelName || null;
        const matched = models.find((model) => {
          if (targetId && (model.modelId === targetId || model.name === targetId)) return true;
          if (targetName && (model.name === targetName || model.modelId === targetName)) return true;
          return false;
        });
        if (!matched) {
          if (!cancelled) setResolvedModel(selectedModel);
          return;
        }
        const picked = selectCheckpoint(matched.checkpoints, existingCheckpoint);
        const merged = {
          ...matched,
          ...selectedModel,
          selectedCheckpoint: picked || matched.bestCheckpoint || matched.checkpoints?.[0] || null,
        };
        if (!cancelled) setResolvedModel(merged);
      } catch (err) {
        if (!cancelled) setResolvedModel(selectedModel);
      }
    };

    resolveModel();
    return () => {
      cancelled = true;
    };
  }, [selectedModel]);

  const setField = useCallback((field, value) => {
    setParams((prev) => ({ ...prev, [field]: value }));
  }, []);

  const applyFormantPreset = useCallback((preset) => {
    setParams((prev) => {
      const next = { ...prev, formantPreset: preset };
      if (preset === "f2m") return { ...next, formantQfrency: 1.0, formantTimbre: 0.8 };
      if (preset === "m2f") return { ...next, formantQfrency: 1.0, formantTimbre: 1.2 };
      if (preset === "random") return { ...next, formantQfrency: 32.0, formantTimbre: 9.8 };
      return next;
    });
  }, []);

  const handleStartInference = () => {
    if (!onStartInference || !hasModel || trackCount === 0) return;

    // If your backend expects Applio numeric fields, map here:
    const payloadParams = {
      ...params,
      volumeEnvelope: params.volumeEnvelopeEnabled ? 1 : 0, // map UI boolean -> numeric
      // keep Applio name if needed: rms_mix_rate = volumeEnvelope maybe, etc.
    };

    // Only a layered run keeps sourceRunId — stripping it is what tells the
    // backend to go back to the original upload's vocals.
    const tracks = (Array.isArray(selectedTracks) ? selectedTracks : []).map((track) => {
      if (sourceMode === "layered" && track?.sourceRunId) return track;
      const { sourceRunId, ...rest } = track || {};
      return rest;
    });

    onStartInference({
      model: effectiveModel,
      tracks,
      params: payloadParams,
    });
  };

  return (
    <Container maxWidth="xl" sx={{ py: 6 }}>
      <PageHeader
        title="Configure Inference"
        subtitle="Fine-tune voice conversion parameters for optimal results"
        onBack={onBack}
      />

      {trackCount === 0 && (
        <Paper
          elevation={0}
          sx={{
            p: 3,
            mb: 4,
            backgroundColor: theme.palette.mode === "dark" ? "rgba(255, 193, 7, 0.08)" : "rgba(255, 193, 7, 0.06)",
            border: `1px solid ${theme.palette.mode === "dark" ? "rgba(255, 193, 7, 0.4)" : "rgba(255, 193, 7, 0.3)"}`,
            borderRadius: 3,
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            No selection found
          </Typography>
          <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
            Go back to select one or more tracks.
          </Typography>
        </Paper>
      )}

      {!hasModel && (
        <Paper
          elevation={0}
          sx={{
            p: 3,
            mb: 4,
            backgroundColor: theme.palette.mode === "dark" ? "rgba(255, 59, 48, 0.08)" : "rgba(255, 59, 48, 0.06)",
            border: `1px solid ${theme.palette.mode === "dark" ? "rgba(255, 59, 48, 0.4)" : "rgba(255, 59, 48, 0.3)"}`,
            borderRadius: 3,
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
            No model selected
          </Typography>
          <Typography variant="body2" sx={{ color: theme.palette.text.secondary, mb: 2 }}>
            Please select a model before running inference.
          </Typography>
          <Button variant="contained" onClick={onGoToModelSelection} disabled={!onGoToModelSelection}>
            Choose Model
          </Button>
        </Paper>
      )}

      {/* Model & Track Overview */}
      <Paper
        elevation={0}
        sx={{
          p: 4,
          mb: 6,
          backgroundColor: theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.02)" : "rgba(0, 0, 0, 0.02)",
          border: `1px solid ${
            theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)"
          }`,
          borderRadius: 3,
        }}
      >
        <Grid container spacing={4} alignItems="center">
          <Grid item xs={12} md={6}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 3, mb: 2 }}>
              <Box
                sx={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  background:
                    theme.palette.mode === "dark"
                      ? "linear-gradient(135deg, #0A84FF 0%, #0D47A1 100%)"
                      : "linear-gradient(135deg, #0A84FF 0%, #0A84FF 100%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow:
                    theme.palette.mode === "dark"
                      ? "0 4px 16px rgba(10, 132, 255, 0.3)"
                      : "0 4px 16px rgba(10, 132, 255, 0.2)",
                }}
              >
                <TuneIcon sx={{ fontSize: 28, color: "white" }} />
              </Box>
              <Box>
                <Typography variant="h5" sx={{ fontWeight: 600, color: theme.palette.text.primary, mb: 1 }}>
                  Voice Conversion Setup
                </Typography>
                <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
                  Configure advanced parameters for high-quality voice conversion
                </Typography>
              </Box>
            </Box>
          </Grid>

          <Grid item xs={12} md={6}>
            <Grid container spacing={3}>
              <Grid item xs={6}>
                <Box
                  sx={{
                    p: 3,
                    backgroundColor: theme.palette.mode === "dark" ? "rgba(144, 202, 249, 0.08)" : "rgba(10, 132, 255, 0.06)",
                    borderRadius: 2,
                    textAlign: "center",
                  }}
                >
                  <Typography variant="h4" sx={{ fontWeight: 700, color: theme.palette.primary.main, mb: 1 }}>
                    {trackCount}
                  </Typography>
                  <Typography variant="body2" sx={{ color: theme.palette.text.secondary, fontWeight: 500 }}>
                    Track{trackCount !== 1 ? "s" : ""} Selected
                  </Typography>
                  {trackCount > 0 && (
                    <Typography variant="caption" sx={{ color: theme.palette.text.secondary, mt: 1, display: "block" }}>
                      {selectionPreview}
                    </Typography>
                  )}
                </Box>
              </Grid>

              <Grid item xs={6}>
                <Box
                  sx={{
                    p: 3,
                    backgroundColor: theme.palette.mode === "dark" ? "rgba(52, 199, 89, 0.08)" : "rgba(52, 199, 89, 0.06)",
                    borderRadius: 2,
                    textAlign: "center",
                  }}
                >
                  <Typography variant="h4" sx={{ fontWeight: 700, color: theme.palette.success.main, mb: 1 }}>
                    {modelName}
                  </Typography>
                  <Typography variant="body2" sx={{ color: theme.palette.text.secondary, fontWeight: 500 }}>
                    Epoch {modelEpoch}
                  </Typography>
                  {navContext?.source && (
                    <Typography variant="caption" sx={{ color: theme.palette.text.secondary, mt: 1, display: "block" }}>
                      Source: {navContext.source}
                    </Typography>
                  )}
                </Box>
              </Grid>
            </Grid>
          </Grid>
        </Grid>
      </Paper>

      {/* Input source — only meaningful when the selection came from a past run */}
      {canLayer && (
        <Paper
          elevation={0}
          sx={{
            p: 3,
            mb: 3,
            borderRadius: 3,
            border: `1px solid ${theme.palette.divider}`,
            backgroundColor:
              theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.02)" : "rgba(255, 255, 255, 0.8)",
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
            Input source
          </Typography>
          <Typography variant="body2" sx={{ color: theme.palette.text.secondary, mb: 2 }}>
            {layerableTracks.length} of {trackCount} selected track{trackCount !== 1 ? "s" : ""} came from
            a previous conversion.
          </Typography>

          <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
            <Button
              variant={sourceMode === "original" ? "contained" : "outlined"}
              onClick={() => setSourceMode("original")}
              sx={{ textTransform: "none", flex: "1 1 260px", justifyContent: "flex-start", py: 1.5 }}
            >
              <Box sx={{ textAlign: "left" }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  Original vocals
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.8, display: "block" }}>
                  Convert the source track again, ignoring the earlier result
                </Typography>
              </Box>
            </Button>

            <Button
              variant={sourceMode === "layered" ? "contained" : "outlined"}
              onClick={() => setSourceMode("layered")}
              sx={{ textTransform: "none", flex: "1 1 260px", justifyContent: "flex-start", py: 1.5 }}
            >
              <Box sx={{ textAlign: "left" }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  Layered
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.8, display: "block" }}>
                  {previousModelName
                    ? `Stack ${modelName} on top of the ${previousModelName} result`
                    : `Stack ${modelName} on top of the previous result`}
                </Typography>
              </Box>
            </Button>
          </Box>
        </Paper>
      )}

      {/* Core Voice Conversion */}
      <SectionAccordion
        defaultExpanded
        title="Core Voice Conversion"
        subtitle="Fundamental voice transformation settings"
        icon={<GraphicEqIcon sx={{ fontSize: 24, color: "white" }} />}
        gradient={
          theme.palette.mode === "dark"
            ? "linear-gradient(135deg, #0A84FF 0%, #0D47A1 100%)"
            : "linear-gradient(135deg, #0A84FF 0%, #0A84FF 100%)"
        }
      >
        <Grid container spacing={4}>
          <Grid item xs={12} md={6}>
            <ParamCard>
              <LabeledSlider
                label="Pitch Shift"
                help="Adjust the pitch of the output voice in semitones"
                value={params.pitch}
                onChange={(v) => setField("pitch", v)}
                min={-12}
                max={12}
                step={0.1}
                marks={[
                  { value: -12, label: "-12" },
                  { value: 0, label: "0" },
                  { value: 12, label: "+12" },
                ]}
                format={(v) => `${Number(v).toFixed(1)} semitones`}
              />
            </ParamCard>
          </Grid>

          <Grid item xs={12} md={6}>
            <ParamCard>
              <TitleWithHelp
                title="Quality Settings"
                help="Advanced settings that affect voice conversion quality"
              />

              <Box sx={{ mb: 3 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    F0 Detection Method
                  </Typography>
                  <Tooltip title="RMVPE is fast; FCPE is high quality; Harvest is legacy.">
                    <HelpOutlineIcon fontSize="small" sx={{ color: theme.palette.text.secondary }} />
                  </Tooltip>
                </Box>

                <FormControl fullWidth size="small">
                  <Select value={params.f0Method} onChange={(e) => setField("f0Method", e.target.value)}>
                    <MenuItem value="rmvpe">RMVPE (Recommended)</MenuItem>
                    <MenuItem value="fcpe">FCPE (High Quality)</MenuItem>
                    <MenuItem value="harvest">Harvest (Legacy)</MenuItem>
                  </Select>
                </FormControl>
              </Box>

              <LabeledSlider
                label="Index Rate"
                help="Higher values = more faithful conversion"
                value={params.indexRate}
                onChange={(v) => setField("indexRate", v)}
                min={0}
                max={1}
                step={0.01}
                format={(v) => Number(v).toFixed(2)}
              />
            </ParamCard>
          </Grid>
        </Grid>
      </SectionAccordion>

      {/* Audio Processing */}
      <SectionAccordion
        title="Audio Processing"
        subtitle="Enhance audio quality and apply corrections"
        icon={<AudioFileIcon sx={{ fontSize: 24, color: "white" }} />}
        gradient={
          theme.palette.mode === "dark"
            ? "linear-gradient(135deg, #FF9F0A 0%, #D98200 100%)"
            : "linear-gradient(135deg, #FFB340 0%, #FF9F0A 100%)"
        }
      >
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: 2,
                mb: 3,
              }}
            >
              <SwitchTile
                label="Split Audio"
                checked={params.splitAudio}
                onChange={(v) => setField("splitAudio", v)}
                tooltip="Split audio into chunks for inference in some cases."
              />
              <SwitchTile
                label="Autotune"
                checked={params.autotune}
                onChange={(v) => setField("autotune", v)}
                tooltip="Soft autotune, recommended for singing."
              />
              <SwitchTile
                label="Proposed Pitch"
                checked={params.proposedPitch}
                onChange={(v) => setField("proposedPitch", v)}
                tooltip="Adjust input pitch to match the model range."
              />
              <SwitchTile
                label="Clean Audio"
                checked={params.cleanAudio}
                onChange={(v) => setField("cleanAudio", v)}
                tooltip="Noise cleaning algorithms."
              />
              <SwitchTile
                label="Volume Envelope"
                checked={params.volumeEnvelopeEnabled}
                onChange={(v) => setField("volumeEnvelopeEnabled", v)}
                tooltip="Automatically adjust volume levels for more natural results."
              />
            </Box>
          </Grid>

          {params.autotune && (
            <Grid item xs={12}>
              <ParamCard>
                <Typography variant="body2" gutterBottom>
                  Autotune Strength: {Number(params.autotuneStrength).toFixed(1)}
                </Typography>
                <Tooltip title="Higher values snap more strongly to the chromatic grid.">
                  <Slider
                    value={params.autotuneStrength}
                    onChange={(_, v) => setField("autotuneStrength", v)}
                    min={0}
                    max={1}
                    step={0.1}
                    size="small"
                  />
                </Tooltip>
                <Tooltip title="Higher values snap more strongly to the chromatic grid.">
                  <IconButton size="small">
                    <HelpOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </ParamCard>
            </Grid>
          )}

          <Grid item xs={12}>
            <ParamCard>
              <TitleWithHelp title="Protect Voiced" help="Protect voiced parts from unwanted changes." />
              <Slider
                value={params.protectVoiced}
                onChange={(_, v) => setField("protectVoiced", v)}
                min={0}
                max={1}
                step={0.01}
                valueLabelDisplay="auto"
                size="small"
              />
              <Typography
                variant="caption"
                sx={{ display: "block", textAlign: "center", mt: 1, color: theme.palette.text.secondary }}
              >
                Current: {params.protectVoiced.toFixed(2)}
              </Typography>
            </ParamCard>
          </Grid>

          <Grid item xs={12}>
            <ParamCard>
              <TitleWithHelp title="Export Format" help="Select the audio format for exported results." />
              <FormControl fullWidth size="small">
                <Select value={params.exportFormat} onChange={(e) => setField("exportFormat", e.target.value)}>
                  <MenuItem value="WAV">WAV (Lossless)</MenuItem>
                  <MenuItem value="MP3">MP3 (Compressed)</MenuItem>
                  <MenuItem value="FLAC">FLAC (Lossless)</MenuItem>
                  <MenuItem value="OGG">OGG (Compressed)</MenuItem>
                  <MenuItem value="M4A">M4A (AAC)</MenuItem>
                </Select>
              </FormControl>
            </ParamCard>
          </Grid>
        </Grid>
      </SectionAccordion>

      {/* Formant Shifting */}
      <SectionAccordion
        title="Formant Shifting"
        subtitle="Modify vocal characteristics and voice gender"
        icon={<PaletteIcon sx={{ fontSize: 24, color: "white" }} />}
        gradient={
          theme.palette.mode === "dark"
            ? "linear-gradient(135deg, #9C27B0 0%, #7B1FA2 100%)"
            : "linear-gradient(135deg, #BA68C8 0%, #9C27B0 100%)"
        }
      >
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <Tooltip title="Modify vocal characteristics to change voice gender or timbre">
              <FormControlLabel
                control={
                  <Switch
                    checked={params.formantShifting}
                    onChange={(e) => setField("formantShifting", e.target.checked)}
                    color="primary"
                  />
                }
                label="Enable Formant Shifting"
                sx={{ mb: 2 }}
              />
            </Tooltip>

            {params.formantShifting && (
              <>
                <Box sx={{ mb: 2 }}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Formant Preset</InputLabel>
                    <Select
                      value={params.formantPreset}
                      label="Formant Preset"
                      onChange={(e) => applyFormantPreset(e.target.value)}
                    >
                      <MenuItem value="none">None</MenuItem>
                      <MenuItem value="f2m">Female to Male (F2M)</MenuItem>
                      <MenuItem value="m2f">Male to Female (M2F)</MenuItem>
                      <MenuItem value="random">Random</MenuItem>
                    </Select>
                  </FormControl>
                </Box>

                <ParamCard>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    Manual Controls
                  </Typography>

                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" sx={{ mb: 1, display: "block", fontWeight: 500 }}>
                      Quefrency: {params.formantQfrency.toFixed(1)}
                      <Tooltip title="Higher values affect broader frequency ranges">
                        <HelpOutlineIcon fontSize="small" sx={{ ml: 1, color: theme.palette.text.secondary }} />
                      </Tooltip>
                    </Typography>
                    <Slider
                      value={params.formantQfrency}
                      onChange={(_, v) => setField("formantQfrency", v)}
                      min={0.1}
                      max={32.0}
                      step={0.1}
                      size="small"
                    />
                  </Box>

                  <Box>
                    <Typography variant="caption" sx={{ mb: 1, display: "block", fontWeight: 500 }}>
                      Timbre: {params.formantTimbre.toFixed(1)}
                      <Tooltip title=">1.0 more feminine, <1.0 more masculine">
                        <HelpOutlineIcon fontSize="small" sx={{ ml: 1, color: theme.palette.text.secondary }} />
                      </Tooltip>
                    </Typography>
                    <Slider
                      value={params.formantTimbre}
                      onChange={(_, v) => setField("formantTimbre", v)}
                      min={0.1}
                      max={10.0}
                      step={0.1}
                      size="small"
                    />
                  </Box>
                </ParamCard>
              </>
            )}
          </Grid>
        </Grid>
      </SectionAccordion>

      {/* Post-Processing Effects */}
      <SectionAccordion
        title="Post-Processing Effects"
        subtitle="Add audio effects to enhance the final sound"
        icon={<SurroundSoundIcon sx={{ fontSize: 24, color: "white" }} />}
        gradient={
          theme.palette.mode === "dark"
            ? "linear-gradient(135deg, #00BCD4 0%, #0097A7 100%)"
            : "linear-gradient(135deg, #4DD0E1 0%, #00BCD4 100%)"
        }
      >
        <Tooltip title="Enable additional audio effects after voice conversion">
          <FormControlLabel
            control={<Switch checked={params.postProcess} onChange={(e) => setField("postProcess", e.target.checked)} />}
            label="Enable Post-Processing"
            sx={{ mb: 2 }}
          />
        </Tooltip>

        {params.postProcess && (
          <Grid container spacing={2}>
            {[
              ["reverb", "Reverb", "Add room ambiance / echo"],
              ["pitchShift", "Pitch Shift", "Additional pitch adjustment"],
              ["limiter", "Limiter", "Prevent peaks / clipping"],
              ["gain", "Gain", "Boost/cut overall volume"],
              ["distortion", "Distortion", "Add harmonic grit"],
              ["chorus", "Chorus", "Thickening detuned layers"],
              ["bitcrush", "Bitcrush", "Lo-fi bit depth reduction"],
              ["compressor", "Compressor", "Even out dynamics"],
              ["delay", "Delay", "Echo repeats"],
            ].map(([key, label, tip]) => (
              <Grid item xs={6} key={key}>
                <Tooltip title={tip}>
                  <FormControlLabel
                    control={<Switch checked={!!params[key]} onChange={(e) => setField(key, e.target.checked)} size="small" />}
                    label={label}
                  />
                </Tooltip>
              </Grid>
            ))}

            {/* Keep your detailed effect sliders exactly as before (same keys) */}
            {/* You can copy-paste your existing blocks for reverb/pitchShift/etc here,
                replacing handleSliderChange(...) with setField(...) */}
          </Grid>
        )}
      </SectionAccordion>

      {/* Actions */}
      <Box
        sx={{
          display: "flex",
          gap: 3,
          justifyContent: "center",
          alignItems: "center",
          mt: 4,
          p: 4,
          backgroundColor: theme.palette.mode === "dark" ? "rgba(10, 132, 255, 0.08)" : "rgba(10, 132, 255, 0.06)",
          border: `1px solid ${
            theme.palette.mode === "dark" ? "rgba(10, 132, 255, 0.2)" : "rgba(10, 132, 255, 0.15)"
          }`,
          borderRadius: 3,
        }}
      >
        <Button
          variant="outlined"
          onClick={onBack}
          size="large"
          sx={{
            px: 4,
            py: 1.5,
            borderRadius: 2,
            fontWeight: 600,
            borderColor: theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.3)" : "rgba(0, 0, 0, 0.23)",
            "&:hover": {
              borderColor: theme.palette.primary.main,
              backgroundColor: theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.04)",
            },
          }}
        >
          Back
        </Button>

        <Button
          variant="contained"
          color="primary"
          onClick={handleStartInference}
          disabled={!hasModel || trackCount === 0}
          size="large"
          startIcon={<TuneIcon />}
          sx={{
            px: 6,
            py: 1.5,
            borderRadius: 2,
            fontWeight: 600,
            fontSize: "1.1rem",
            boxShadow: theme.palette.mode === "dark" ? "0 6px 20px rgba(10, 132, 255, 0.4)" : "0 6px 20px rgba(10, 132, 255, 0.3)",
            "&:hover": {
              boxShadow: theme.palette.mode === "dark" ? "0 8px 25px rgba(10, 132, 255, 0.5)" : "0 8px 25px rgba(10, 132, 255, 0.4)",
              transform: "translateY(-1px)",
            },
            transition: "all 0.2s ease",
          }}
        >
          Start Inference
        </Button>
      </Box>
    </Container>
  );
}
