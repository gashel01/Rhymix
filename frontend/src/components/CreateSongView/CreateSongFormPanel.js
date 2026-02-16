import React, { useState } from "react";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import LyricsIcon from "@mui/icons-material/Lyrics";
import PersonIcon from "@mui/icons-material/Person";
import { AceStepSection } from "./AceStepSection";
import { CustomizeContent } from "./OptionsBlock";
import { GENRE_RECS, toKey } from "./constants";
import { Segmented } from "../Homeview/Segmented";
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
  advancedMode,
  setAdvancedMode,
  promptEngine,
  setPromptEngine,
  captionOverride,
  setCaptionOverride,
  bpm,
  setBpm,
  keyscale,
  setKeyscale,
  timeSignature,
  setTimeSignature,
  enhanceVocals,
  setEnhanceVocals,
  instrumentalOnly,
  setInstrumentalOnly,
  mode,
  setMode,
  describePrompt,
  setDescribePrompt,
  useNegativePrompt,
  setUseNegativePrompt,
  negativePrompt,
  setNegativePrompt,
  lyrics,
  setLyrics,
  aceStepProps,
  genreText,
  setGenreText,
  genreTokens,
  usedGenreKeys,
  addGenreToken,
  removeGenreToken,
  availableModels,
  selectedModel,
  selectedCheckpoint,
  setSelectedModel,
  setSelectedCheckpoint,
  isStuck,
}) {
  const { Panel, Input, Modal, Pill } = ui;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [personaModalOpen, setPersonaModalOpen] = useState(false);
  const [personaQuery, setPersonaQuery] = useState("");
  const [personaPage, setPersonaPage] = useState(1);

  const pickBestCheckpoint = (model) => {
    if (!model?.checkpoints?.length) return null;
    return model.checkpoints.find((c) => c.isBest) || model.checkpoints[0] || null;
  };

  const handleSelectPersona = (model, checkpoint) => {
    if (!model || !checkpoint) return;
    setSelectedModel(model);
    setSelectedCheckpoint(checkpoint);
    setEnhanceVocals(true);
    setPersonaModalOpen(false);
  };

  const handleClearPersona = () => {
    setSelectedModel(null);
    setSelectedCheckpoint(null);
    setEnhanceVocals(false);
  };

  const personaSummary = selectedModel && selectedCheckpoint
    ? `${selectedModel.name} · ${selectedCheckpoint.epochs}e`
    : "Add persona (optional)";

  const personaPageSize = 6;
  const filteredPersonas = availableModels.filter((model) => {
    if (!personaQuery.trim()) return true;
    return String(model.name || "").toLowerCase().includes(personaQuery.trim().toLowerCase());
  });
  const personaTotalPages = Math.max(1, Math.ceil(filteredPersonas.length / personaPageSize));
  const personaModels = filteredPersonas.slice(
    (personaPage - 1) * personaPageSize,
    personaPage * personaPageSize
  );

  return (
    <div style={{ display: "grid", gap: 16  }}>
      <Panel style={{ padding: 28 , borderRadius: isStuck ? "0px" : "24px" }}>
        <div style={{ display: "grid", gap: 20 }}>
          <div>
            <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: t.subtext }}>
              
                  <AceStepSection ui={ui} t={t} advancedMode={advancedMode} promptEngine={promptEngine} {...aceStepProps} />
            
              </div>
             
              <button
                type="button"
                onClick={() => {
                  if (!advancedMode) setAdvancedMode(true);
                  setAdvancedOpen(true);
                }}
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  border: `1px solid ${advancedMode ? t.primary : t.hairline}`,
                  background: advancedMode ? t.primaryWash : "transparent",
                  color: advancedMode ? t.primary : t.subtext,
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                {advancedMode ? "Advanced ✓" : "Advanced"} ▾
              </button>
            </div>
            <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: t.subtext, marginBottom: 6 }}>Song name</label>
            <Input
              value={title}
              onChange={setTitle}
              placeholder="e.g. Summer Nights"
            />
          </div>

          <div>
            

            {mode === "prompt" ? (
              <div>
                 <div
                  style={{
                    borderRadius: 16,
                    border: `1px solid ${t.hairline}`,
                    background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
                    boxShadow: t.shadowSoft,
                    overflow: "hidden",
                  }}
                >
                  <div style={{ position: "relative" }}>

                  <Segmented ui={ui} t={t} options={[{ label: "Describe", value: "prompt" }, { label: "Lyrics", value: "lyrics" }]} value={mode} onChange={setMode} />
          
                    <textarea
                      value={describePrompt}
                      onChange={(e) => setDescribePrompt(e.target.value)}
                      placeholder="e.g. Upbeat pop with catchy hooks, electric guitar and warm synths…"
                      rows={5}
                      style={{
                        width: "100%",
                        resize: "vertical",
                        border: "none",
                        outline: "none",
                        background: "transparent",
                        color: t.text,
                        padding: 12,
                        paddingRight: 92,
                        paddingBottom: 32,
                        fontSize: 14,
                        fontWeight: 650,
                        lineHeight: 1.35,
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setInstrumentalOnly((v) => !v)}
                      style={{
                        position: "absolute",
                        top: 10,
                        right: 10,
                        padding: "4px 10px",
                        borderRadius: 999,
                        border: `1px solid ${instrumentalOnly ? t.primary : t.hairline}`,
                        background: instrumentalOnly ? t.primaryWash : "transparent",
                        color: instrumentalOnly ? t.primary : t.subtext,
                        fontSize: 12,
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      {instrumentalOnly ? "✓ Instrumental only" : "Instrumental only"}
                    </button>
                    {advancedMode && (
                      <button
                        type="button"
                        onClick={() => setUseNegativePrompt((v) => !v)}
                        style={{
                          position: "absolute",
                          bottom: 8,
                          right: 10,
                          padding: "4px 10px",
                          borderRadius: 999,
                          border: `1px solid ${useNegativePrompt ? t.primary : t.hairline}`,
                          background: useNegativePrompt ? t.primaryWash : "transparent",
                          color: useNegativePrompt ? t.primary : t.subtext,
                          fontSize: 12,
                          fontWeight: 800,
                          cursor: "pointer",
                        }}
                      >
                        {useNegativePrompt ? "Negative ✓" : "Negative"}
                      </button>
                    )}
                  </div>
                  {advancedMode && useNegativePrompt && (
                    <>
                      <div style={{ height: 1, background: t.hairline }} />
                      <textarea
                        value={negativePrompt}
                        onChange={(e) => setNegativePrompt(e.target.value)}
                        placeholder="Negative prompt (e.g. avoid: pop hooks, bright synths...)"
                        rows={3}
                        style={{
                          width: "100%",
                          resize: "vertical",
                          border: "none",
                          outline: "none",
                          background: "transparent",
                          color: t.text,
                          padding: 12,
                          fontSize: 13,
                          fontWeight: 650,
                          lineHeight: 1.35,
                        }}
                      />
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 14 }}>
                <div>
              
                  <div
                    style={{
                      borderRadius: 16,
                      border: `1px solid ${t.hairline}`,
                      background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
                      boxShadow: t.shadowSoft,
                      overflow: "hidden",
                    }}
                  >
                     <Segmented ui={ui} t={t} options={[{ label: "Describe", value: "prompt" }, { label: "Lyrics", value: "lyrics" }]} value={mode} onChange={setMode} />
          
                    <div style={{ position: "relative" }}>
                      <textarea
                        value={lyrics}
                        onChange={(e) => setLyrics(e.target.value)}
                        placeholder="Paste or write your lyrics here…"
                        rows={8}
                        style={{
                          width: "100%",
                          resize: "vertical",
                          border: "none",
                          outline: "none",
                          background: "transparent",
                          color: t.text,
                          padding: 12,
                          paddingRight: 92,
                          paddingBottom: 32,
                          fontSize: 14,
                          fontWeight: 650,
                          lineHeight: 1.35,
                          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                        }}
                      />
                      {advancedMode && (
                        <button
                          type="button"
                          onClick={() => setUseNegativePrompt((v) => !v)}
                          style={{
                            position: "absolute",
                            bottom: 8,
                            right: 10,
                            padding: "4px 10px",
                            borderRadius: 999,
                            border: `1px solid ${useNegativePrompt ? t.primary : t.hairline}`,
                            background: useNegativePrompt ? t.primaryWash : "transparent",
                            color: useNegativePrompt ? t.primary : t.subtext,
                            fontSize: 12,
                            fontWeight: 800,
                            cursor: "pointer",
                          }}
                        >
                          {useNegativePrompt ? "Negative ✓" : "Negative"}
                        </button>
                      )}
                    </div>
                    {advancedMode && useNegativePrompt && (
                      <>
                        <div style={{ height: 1, background: t.hairline }} />
                        <textarea
                          value={negativePrompt}
                          onChange={(e) => setNegativePrompt(e.target.value)}
                          placeholder="Negative prompt (e.g. avoid: pop hooks, bright synths...)"
                          rows={3}
                          style={{
                            width: "100%",
                            resize: "vertical",
                            border: "none",
                            outline: "none",
                            background: "transparent",
                            color: t.text,
                            padding: 12,
                            fontSize: 13,
                            fontWeight: 650,
                            lineHeight: 1.35,
                          }}
                        />
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {mode === "lyrics" && (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: t.text,  }}>Genre &amp; style</div>
                {advancedMode && (
                  <Pill
                    tone={promptEngine === "caption" ? "primary" : "neutral"}
                    onClick={() => setPromptEngine(promptEngine === "caption" ? "llm" : "caption")}
                    title={promptEngine === "caption" ? "Use style and genre guidance" : "Override with a direct caption"}
                  >
                    {promptEngine === "caption" ? "Use style & genre" : "Use direct caption"}
                  </Pill>
                )}
              </div>

              {advancedMode && promptEngine === "caption" ? (
                <Input
                  value={captionOverride}
                  onChange={setCaptionOverride}
                  placeholder="Direct caption (overrides style & genre)"
                  multiline
                  rows={4}
                />
              ) : (
                <>
                  {/* {genreTokens.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "nowrap", overflowX: "auto", gap: 8 }}>
                      {genreTokens.map((g) => (
                        <Pill key={g} tone="neutral" onDelete={() => removeGenreToken(g)}>
                          {g}
                        </Pill>
                      ))}
                    </div>
                  )} */}
                  <div style={{ display: "flex", flexWrap: "nowrap", overflowX: "auto", gap: 8 }}>
                    {GENRE_RECS.filter((r) => !usedGenreKeys.has(toKey(r))).map((r) => (
                      <Pill key={r} tone="primary" onClick={() => addGenreToken(r)} title="Add genre">
                        {r}
                      </Pill>
                    ))}
                  </div>
                  <Input
                    value={genreText}
                    onChange={setGenreText}
                    placeholder="Type genres/styles… e.g., Synthwave, Electro-pop"
                  />
                </>
              )}
            </div>
          )}

          {!instrumentalOnly && (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button
                  type="button"
                  onClick={() => setPersonaModalOpen(true)}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 999,
                    border: `1px dashed ${t.hairline}`,
                    background: "transparent",
                    color: t.subtext,
                    display: "grid",
                    placeItems: "center",
                    cursor: "pointer",
                  }}
                  title="Add persona"
                >
                  {selectedModel ? <PersonIcon style={{ fontSize: 18 }} /> : <span style={{ fontSize: 20, fontWeight: 900 }}>+</span>}
                </button>
                <div style={{ display: "grid", gap: 2 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: t.text }}>Add persona</div>
                  <div style={{ fontSize: 12, fontWeight: 650, color: t.subtext }}>
                    {personaSummary}
                  </div>
                </div>
                {selectedModel && (
                  <button
                    type="button"
                    onClick={handleClearPersona}
                    style={{
                      marginLeft: "auto",
                      padding: "4px 10px",
                      borderRadius: 999,
                      border: `1px solid ${t.hairline}`,
                      background: "transparent",
                      color: t.subtext,
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}

        </div>
      </Panel>

      <Modal
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        title="Advanced Options"
        footer={
          <>
            {advancedMode && (
              <Pill
                tone="neutral"
                onClick={() => {
                  setAdvancedMode(false);
                  setAdvancedOpen(false);
                }}
              >
                Disable advanced
              </Pill>
            )}
            <Pill tone="primary" onClick={() => setAdvancedOpen(false)}>
              Done
            </Pill>
          </>
        }
      >
        <CustomizeContent
          ui={ui}
          t={t}
          duration={duration}
          durationInput={durationInput}
          autoDuration={autoDuration}
          onDurationChange={syncDuration}
          onDurationInputChange={setDurationInput}
          onAutoDurationChange={setAutoDuration}
          bpm={bpm}
          setBpm={setBpm}
          keyscale={keyscale}
          setKeyscale={setKeyscale}
          timeSignature={timeSignature}
          setTimeSignature={setTimeSignature}
        />
      </Modal>

      <Modal
        open={personaModalOpen}
        onClose={() => setPersonaModalOpen(false)}
        title="Select Persona"
        footer={
          <Pill tone="primary" onClick={() => setPersonaModalOpen(false)}>
            Done
          </Pill>
        }
      >
        <div style={{ display: "grid", gap: 12 }}>
          <Input
            value={personaQuery}
            onChange={(val) => {
              setPersonaQuery(val);
              setPersonaPage(1);
            }}
            placeholder="Search persona models..."
          />

          <button
            type="button"
            onClick={() => {
              handleClearPersona();
              setPersonaModalOpen(false);
            }}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "10px 12px",
              borderRadius: 12,
              border: `1px solid ${t.hairline}`,
              background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
              color: t.text,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            No persona (original voice)
          </button>

          {!availableModels.length && (
            <div style={{ fontSize: 12, fontWeight: 650, color: t.subtext }}>
              No persona models available yet.
            </div>
          )}

          {availableModels.length > 0 && filteredPersonas.length === 0 && (
            <div style={{ fontSize: 12, fontWeight: 650, color: t.subtext }}>
              No persona models match your search.
            </div>
          )}

          {personaModels.map((model) => {
            const checkpoints = model.checkpoints || [];
            const best = pickBestCheckpoint(model);
            return (
              <div
                key={model.name}
                style={{
                  borderRadius: 14,
                  border: `1px solid ${t.hairline}`,
                  background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
                  padding: 12,
                  display: "grid",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontWeight: 800, color: t.text }}>{model.name}</div>
                  {best && (
                    <button
                      type="button"
                      onClick={() => handleSelectPersona(model, best)}
                      style={{
                        padding: "4px 10px",
                        borderRadius: 999,
                        border: `1px solid ${t.primary}`,
                        background: t.primaryWash,
                        color: t.primary,
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      Use best
                    </button>
                  )}
                </div>
                {checkpoints.length ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {checkpoints.map((cp) => (
                      <button
                        key={cp.filename}
                        type="button"
                        onClick={() => handleSelectPersona(model, cp)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 999,
                          border: `1px solid ${t.hairline}`,
                          background: selectedCheckpoint?.filename === cp.filename && selectedModel?.name === model.name
                            ? t.primaryWash
                            : "transparent",
                          color: selectedCheckpoint?.filename === cp.filename && selectedModel?.name === model.name
                            ? t.primary
                            : t.text,
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: "pointer",
                        }}
                        title={cp.isBest ? "Best checkpoint" : undefined}
                      >
                        {cp.epochs}e{cp.isBest ? " · best" : ""}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, fontWeight: 650, color: t.subtext }}>
                    No checkpoints available.
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {filteredPersonas.length > 0 && personaTotalPages > 1 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12 }}>
            <button
              type="button"
              onClick={() => setPersonaPage((p) => Math.max(1, p - 1))}
              disabled={personaPage === 1}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                border: `1px solid ${t.hairline}`,
                background: "transparent",
                color: personaPage === 1 ? t.subtext : t.text,
                fontWeight: 700,
                cursor: personaPage === 1 ? "not-allowed" : "pointer",
              }}
            >
              Prev
            </button>
            <div style={{ fontSize: 12, fontWeight: 700, color: t.subtext }}>
              Page {personaPage} of {personaTotalPages}
            </div>
            <button
              type="button"
              onClick={() => setPersonaPage((p) => Math.min(personaTotalPages, p + 1))}
              disabled={personaPage === personaTotalPages}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                border: `1px solid ${t.hairline}`,
                background: "transparent",
                color: personaPage === personaTotalPages ? t.subtext : t.text,
                fontWeight: 700,
                cursor: personaPage === personaTotalPages ? "not-allowed" : "pointer",
              }}
            >
              Next
            </button>
          </div>
        )}
      </Modal>

    </div>
  );
}
