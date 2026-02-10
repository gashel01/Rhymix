import React from "react";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import { PersonaPanel } from "./PersonaPanel";

export function CoverFormPanel({
  ui,
  t,
  title,
  setTitle,
  pitchShift,
  setPitchShift,
  coverStrength,
  coverStrengthInput,
  onCoverStrengthChange,
  onCoverStrengthInputChange,
  strongAudioConditioning,
  setStrongAudioConditioning,
  lyrics,
  setLyrics,
  onTranscribe,
  transcribing,
  transcribeError,
  canTranscribe,
  transcribeEngine,
  setTranscribeEngine,
  coverMode,
  setCoverMode,
  stylePrompt,
  setStylePrompt,
  preserveTempo,
  setPreserveTempo,
  loadingModels,
  availableModels,
  selectedModel,
  selectedCheckpoint,
  onSelectModel,
  onSelectCheckpoint,
  onClearPersona,
  generating,
  progress,
  statusMessage,
  canGenerate,
  onGenerate,
}) {
  const { Panel, Btn, Input, CheckRow, Slider, Alert, Spinner } = ui;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel style={{ padding: 28 }}>
        <div style={{ display: "grid", gap: 16 }}>
          <div>
            <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: t.subtext, marginBottom: 6 }}>Cover title</label>
            <Input value={title} onChange={setTitle} placeholder="e.g. Midnight Lights (Cover)" />
          </div>

          <div>
            <div style={{ display: "block", fontSize: 14, fontWeight: 600, color: t.subtext, marginBottom: 6 }}>Target voice persona (optional)</div>
            <PersonaPanel
              ui={ui}
              t={t}
              loadingModels={loadingModels}
              availableModels={availableModels}
              selectedModel={selectedModel}
              selectedCheckpoint={selectedCheckpoint}
              onSelectModel={onSelectModel}
              onSelectCheckpoint={onSelectCheckpoint}
              onClearPersona={onClearPersona}
            />
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            <div>
              <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: t.subtext, marginBottom: 6 }}>Pitch shift (semitones)</label>
              <Input
                value={pitchShift}
                onChange={(v) => setPitchShift(String(v).replace(/[^\d-]/g, ""))}
                placeholder="Optional (e.g. -2, 0, +2)"
              />
            </div>
            <CheckRow
              label="Preserve tempo"
              value={preserveTempo}
              onChange={setPreserveTempo}
              hint="Keep original tempo while applying pitch shift."
            />
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontWeight: 700, color: t.subtext }}>Cover strength</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: t.subtext }}>{coverStrength.toFixed(2)}</div>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              <Slider value={coverStrength} min={0.1} max={1.0} step={0.05} onChange={onCoverStrengthChange} />
              <Input
                value={coverStrengthInput}
                onChange={onCoverStrengthInputChange}
                placeholder="0.10–1.00"
              />
              <div style={{ fontSize: 12, fontWeight: 650, color: t.subtext }}>
                Higher values follow the source more closely.
              </div>
            </div>
          </div>

          <CheckRow
            label="Strong audio conditioning (preserve vocals)"
            value={strongAudioConditioning}
            onChange={setStrongAudioConditioning}
            hint="Push the model to follow the source vocal phrasing instead of re-singing."
          />

          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: t.subtext, marginBottom: 6 }}>
              Lyrics (optional)
            </label>
            <Input
              multiline
              rows={6}
              value={lyrics}
              onChange={setLyrics}
              placeholder="Paste or transcribe lyrics from the source song"
            />
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <select
                value={transcribeEngine}
                onChange={(e) => setTranscribeEngine(e.target.value)}
                style={{
                  height: 44,
                  borderRadius: 12,
                  border: `1px solid ${t.hairline}`,
                  background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
                  color: t.text,
                  padding: "0 10px",
                  fontWeight: 700,
                  boxShadow: t.shadowSoft,
                  outline: "none",
                  appearance: "none",
                }}
              >
                <option value="whisperx">WhisperX</option>
                <option value="whisper">Whisper</option>
              </select>
              <Btn
                variant="secondary"
                onClick={onTranscribe}
                disabled={!canTranscribe || transcribing}
                style={{ height: 44 }}
              >
                {transcribing ? "Transcribing..." : "Transcribe from source"}
              </Btn>
              {transcribing && <Spinner size={14} />}
            </div>
            {transcribeError && <Alert kind="error">{transcribeError}</Alert>}
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: t.subtext, marginBottom: 6 }}>
              Cover type
            </label>
            <select
              value={coverMode}
              onChange={(e) => setCoverMode(e.target.value)}
              style={{
                height: 44,
                borderRadius: 12,
                border: `1px solid ${t.hairline}`,
                background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
                color: t.text,
                padding: "0 10px",
                fontWeight: 700,
                boxShadow: t.shadowSoft,
                outline: "none",
                appearance: "none",
              }}
            >
              <option value="full">Full cover (vocals + instrumental)</option>
              <option value="vocal_only">Vocal re-performance (keep instrumental)</option>
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: t.subtext, marginBottom: 6 }}>Style prompt</label>
            <Input
              multiline
              rows={4}
              value={stylePrompt}
              onChange={setStylePrompt}
              placeholder="Optional instructions (mood, arrangement, vocal style)"
            />
          </div>
        </div>
      </Panel>

      <Btn
        variant="primary"
        onClick={onGenerate}
        disabled={!canGenerate}
        style={{
          width: "100%",
          height: generating ? 72 : 56,
          borderRadius: t.radiusMd,
          fontSize: 16,
          fontWeight: 700,
          textTransform: "none",
        }}
      >
        {generating ? (
          <div style={{ width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.95)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {statusMessage || "Creating cover…"}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.95)" }}>{progress}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.25)", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${Math.max(0, Math.min(100, progress))}%`,
                  background: "#fff",
                  borderRadius: 999,
                  transition: "width 0.2s ease",
                }}
              />
            </div>
          </div>
        ) : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <AutoAwesomeIcon style={{ fontSize: 20 }} />
            Create cover
          </span>
        )}
      </Btn>
    </div>
  );
}
