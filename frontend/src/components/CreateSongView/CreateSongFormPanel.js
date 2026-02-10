import React, { useState } from "react";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import LyricsIcon from "@mui/icons-material/Lyrics";
import { AceStepSection } from "./AceStepSection";
import { OptionsBlock, CustomizeContent } from "./OptionsBlock";

export function CreateSongFormPanel({
  ui,
  t,
  title,
  setTitle,
  duration,
  durationInput,
  autoDuration,
  syncDuration,
  setDurationInput,
  setAutoDuration,
  promptEngine,
  captionOverride,
  setCaptionOverride,
  enhanceVocals,
  setEnhanceVocals,
  instrumentalOnly,
  setInstrumentalOnly,
  mode,
  setMode,
  prompt,
  setPrompt,
  lyrics,
  setLyrics,
  aceStepProps,
  genreText,
  setGenreText,
  genreTokens,
  usedGenreKeys,
  addGenreToken,
  removeGenreToken,
  loadingModels,
  availableModels,
  selectedModel,
  selectedCheckpoint,
  setSelectedModel,
  setSelectedCheckpoint,
  generating,
  progress,
  statusMessage,
  canGenerate,
  onGenerate,
}) {
  const { Panel, Btn, Input } = ui;
  const [customizeOpen, setCustomizeOpen] = useState(false);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel style={{ padding: 28 }}>
        <div style={{ display: "grid", gap: 20 }}>
          <div>
            <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: t.subtext, marginBottom: 6 }}>Song name</label>
            <Input
              value={title}
              onChange={setTitle}
              placeholder="e.g. Summer Nights"
            />
          </div>

          <div>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <button
                type="button"
                onClick={() => setMode("prompt")}
                style={{
                  flex: 1,
                  padding: "12px 16px",
                  borderRadius: t.radiusSm,
                  border: `1px solid ${mode === "prompt" ? t.primary : t.hairline}`,
                  background: mode === "prompt" ? t.primaryWash : "transparent",
                  color: mode === "prompt" ? t.primary : t.text,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <MusicNoteIcon style={{ fontSize: 18 }} /> Describe
              </button>
              <button
                type="button"
                onClick={() => setMode("lyrics")}
                style={{
                  flex: 1,
                  padding: "12px 16px",
                  borderRadius: t.radiusSm,
                  border: `1px solid ${mode === "lyrics" ? t.primary : t.hairline}`,
                  background: mode === "lyrics" ? t.primaryWash : "transparent",
                  color: mode === "lyrics" ? t.primary : t.text,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <LyricsIcon style={{ fontSize: 18 }} /> Lyrics
              </button>
            </div>

            {mode === "prompt" ? (
              <div>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: t.subtext, marginBottom: 6 }}>Prompt</label>
                <Input
                  multiline
                  rows={5}
                  value={prompt}
                  onChange={setPrompt}
                  placeholder="e.g. Upbeat pop with catchy hooks, electric guitar and warm synths…"
                />
              </div>
            ) : (
              <div style={{ display: "grid", gap: 14 }}>
                <div>
                  <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: t.subtext, marginBottom: 6 }}>Style prompt</label>
                  <Input
                    multiline
                    rows={4}
                    value={prompt}
                    onChange={setPrompt}
                    placeholder="Describe the vibe/style for these lyrics…"
                  />
                  <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: t.subtext }}>Required for lyrics generation.</div>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: t.subtext, marginBottom: 6 }}>Lyrics</label>
                  <Input
                    multiline
                    rows={8}
                    mono
                    value={lyrics}
                    onChange={setLyrics}
                    disabled={instrumentalOnly}
                    placeholder="Paste or write your lyrics here…"
                  />
                </div>
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <button
              type="button"
              onClick={() => setInstrumentalOnly((v) => !v)}
              style={{
                padding: "6px 0",
                border: "none",
                background: "none",
                color: instrumentalOnly ? t.primary : t.subtext,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                textDecoration: instrumentalOnly ? "underline" : "none",
              }}
            >
              {instrumentalOnly ? "✓ Instrumental only" : "Instrumental only (no vocals)"}
            </button>
          </div>

          <AceStepSection ui={ui} t={t} {...aceStepProps} />

          {["caption", "assist", "expand"].includes(promptEngine) && (
            <div>
              <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: t.subtext, marginBottom: 6 }}>Caption</label>
              <Input
                multiline
                rows={3}
                value={captionOverride}
                onChange={setCaptionOverride}
                placeholder={promptEngine === "assist" ? "Paste a draft caption…" : promptEngine === "expand" ? "Short caption to expand…" : "Exact caption…"}
              />
            </div>
          )}
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
              <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.95)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {statusMessage || "Creating…"}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.95)" }}>{progress}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.25)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, progress))}%`, background: "#fff", borderRadius: 999, transition: "width 0.2s ease" }} />
            </div>
          </div>
        ) : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <AutoAwesomeIcon style={{ fontSize: 20 }} />
            Create song
          </span>
        )}
      </Btn>

      <OptionsBlock open={customizeOpen} onToggle={() => setCustomizeOpen((v) => !v)} label="Customize" ui={ui} t={t}>
        <CustomizeContent
          ui={ui}
          t={t}
          duration={duration}
          durationInput={durationInput}
          autoDuration={autoDuration}
          onDurationChange={syncDuration}
          onDurationInputChange={setDurationInput}
          onAutoDurationChange={setAutoDuration}
          genreText={genreText}
          genreTokens={genreTokens}
          usedGenreKeys={usedGenreKeys}
          onGenreTextChange={setGenreText}
          addGenreToken={addGenreToken}
          removeGenreToken={removeGenreToken}
          enhanceVocals={enhanceVocals}
          setEnhanceVocals={setEnhanceVocals}
          instrumentalOnly={instrumentalOnly}
          loadingModels={loadingModels}
          availableModels={availableModels}
          selectedModel={selectedModel}
          selectedCheckpoint={selectedCheckpoint}
          onSelectModel={setSelectedModel}
          onSelectCheckpoint={setSelectedCheckpoint}
          onClearPersona={() => { setSelectedModel(null); setSelectedCheckpoint(null); }}
        />
      </OptionsBlock>
    </div>
  );
}
