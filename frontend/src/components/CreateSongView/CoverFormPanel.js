import React, { useEffect, useMemo, useRef, useState } from "react";
import PersonIcon from "@mui/icons-material/PersonOutlined";
import { GENRE_RECS, normalize, toKey } from "./constants";
import { Segmented } from "../Homeview/Segmented";
import { AssistActionRow, AssistSuggestionCard } from "./AssistSuggestionCard";

export function CoverFormPanel({
  ui,
  t,
  title,
  setTitle,
  pitchShift,
  setPitchShift,
  coverStrength,
  onCoverStrengthChange,
  lyrics,
  setLyrics,
  lyricsMode,
  setLyricsMode,
  onTranscribe,
  transcribing,
  transcribeError,
  canTranscribe,
  transcribeEngine,
  setTranscribeEngine,
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
  isStuck,
  generating,
  progress,
  statusMessage,
  canGenerate,
  onGenerate,
  styleAssist,
}) {
  const { Panel, Input, Slider, Alert, Modal, Pill } = ui;
  const [personaModalOpen, setPersonaModalOpen] = useState(false);
  const [personaQuery, setPersonaQuery] = useState("");
  const [personaPage, setPersonaPage] = useState(1);
  const [transcribeMenuOpen, setTranscribeMenuOpen] = useState(false);
  const transcribeBtnRef = useRef(null);
  const transcribeMenuRef = useRef(null);
  const genreTokens = useMemo(
    () => String(stylePrompt || "").split(",").map(normalize).filter(Boolean),
    [stylePrompt]
  );
  const usedGenreKeys = useMemo(() => new Set(genreTokens.map(toKey)), [genreTokens]);

  const addGenreToken = (token) => {
    const tt = normalize(token);
    if (!tt) return;
    const current = String(stylePrompt || "").split(",").map(normalize).filter(Boolean);
    const exists = current.some((x) => toKey(x) === toKey(tt));
    const next = exists ? current : [...current, tt];
    setStylePrompt(next.join(", "));
  };

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

  const pickBestCheckpoint = (model) => {
    if (!model?.checkpoints?.length) return null;
    return model.checkpoints.find((c) => c.isBest) || model.checkpoints[0] || null;
  };

  const handleSelectPersona = (model, checkpoint) => {
    if (!model || !checkpoint) return;
    onSelectModel?.(model);
    onSelectCheckpoint?.(checkpoint);
    setPersonaModalOpen(false);
  };

  const personaSummary = selectedModel && selectedCheckpoint
    ? `${selectedModel.name} · ${selectedCheckpoint.epochs}e`
    : "Add persona (optional)";

  const pitchShiftValue = Number(pitchShift);
  const pitchShiftSafe = Number.isFinite(pitchShiftValue) ? pitchShiftValue : 0;

  useEffect(() => {
    if (!transcribeMenuOpen) return;
    const handleClick = (e) => {
      if (transcribeBtnRef.current && transcribeBtnRef.current.contains(e.target)) return;
      if (transcribeMenuRef.current && transcribeMenuRef.current.contains(e.target)) return;
      setTranscribeMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [transcribeMenuOpen]);

  return (
    <div style={{ display: "grid", gap: 16 , }}>
      <Panel style={{ padding: 28, borderRadius: isStuck ? "0px" : "24px" }}>
        <div style={{ display: "grid", gap: 16 }}>
          <div>
            <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: t.subtext, marginBottom: 6 }}>Cover title</label>
            <Input value={title} onChange={setTitle} placeholder="e.g. Midnight Lights (Cover)" />
          </div>

          

          

          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: t.subtext }}>
              Lyrics
            </label>
            <div
              style={{
                borderRadius: 16,
                border: `1px solid ${t.hairline}`,
                background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
                boxShadow: t.shadowSoft,
                overflow: "hidden",
              }}
            >
              <div style={{  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <Segmented
                  ui={ui}
                  t={t}
                  options={[
                    { label: "Instrumental", value: "instrumental" },
                    { label: "Lyrics", value: "lyrics" },
                  ]}
                  value={lyricsMode}
                  onChange={setLyricsMode}
                />
                {lyricsMode === "lyrics" && (
                  <div style={{ position: "relative" }}>
                    <button
                      ref={transcribeBtnRef}
                      type="button"
                      onClick={() => {
                        if (!canTranscribe || transcribing) return;
                        setTranscribeMenuOpen((v) => !v);
                      }}
                      disabled={!canTranscribe || transcribing}
                      style={{
                        height: 50,
                        padding: "0 12px",
                        borderRadius: 12,
                        border: `1px solid ${t.hairline}`,
                        background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
                        color: !canTranscribe || transcribing ? t.subtext : t.text,
                        fontWeight: 800,
                        cursor: !canTranscribe || transcribing ? "not-allowed" : "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                      title="Transcribe lyrics from source"
                    >
                      {transcribing ? "Transcribing..." : "Transcribe"}
                      <span style={{ fontSize: 12, transform: transcribeMenuOpen ? "rotate(180deg)" : "none", transition: "transform 120ms ease" }}>
                        ▾
                      </span>
                    </button>
                    {transcribeMenuOpen && (
                      <div
                        ref={transcribeMenuRef}
                        style={{
                          position: "absolute",
                          right: 0,
                          top: "calc(100% + 6px)",
                          minWidth: 180,
                          borderRadius: 12,
                          border: `1px solid ${t.hairline}`,
                          background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
                          boxShadow: t.shadow,
                          zIndex: 20,
                          overflow: "hidden",
                        }}
                      >
                        {[
                          { value: "whisperx", label: "WhisperX" },
                          { value: "whisper", label: "Whisper" },
                        ].map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => {
                              setTranscribeEngine(opt.value);
                              setTranscribeMenuOpen(false);
                              onTranscribe?.();
                            }}
                            style={{
                              width: "100%",
                              textAlign: "left",
                              padding: "10px 12px",
                              background: "transparent",
                              border: "none",
                              color: t.text,
                              fontWeight: 700,
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 8,
                            }}
                          >
                            <span>{opt.label}</span>
                            {transcribeEngine === opt.value && (
                              <span style={{ fontSize: 12, fontWeight: 900, color: t.primary }}>✓</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {lyricsMode === "lyrics" ? (
                <>
             
                  <textarea
                    value={lyrics}
                    onChange={(e) => setLyrics(e.target.value)}
                    placeholder="Paste or transcribe lyrics from the source song"
                    rows={6}
                    style={{
                      width: "100%",
                      resize: "vertical",
                      border: "none",
                      outline: "none",
                      background: "transparent",
                      color: t.text,
                      padding: 12,
                      fontSize: 14,
                      fontWeight: 650,
                      lineHeight: 1.35,
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                    }}
                  />
                </>
              ) : (
                <div style={{ padding: "12px 12px 16px 12px", fontSize: 13, fontWeight: 600, color: t.subtext }}>
                  Instrumental cover only — no lyrics will be used.
                </div>
              )}
            </div>
            {lyricsMode === "lyrics" && transcribeError && <Alert kind="error">{transcribeError}</Alert>}
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            <AssistActionRow
              t={t}
              label="Genre & style"
              loading={styleAssist?.loading}
              onRequest={styleAssist?.onRequest}
            />
            <div style={{ display: "flex", flexWrap: "nowrap", overflowX: "auto", gap: 8 }}>
              {GENRE_RECS.filter((r) => !usedGenreKeys.has(toKey(r))).map((r) => (
                <Pill key={r} tone="primary" onClick={() => addGenreToken(r)} title="Add genre">
                  {r}
                </Pill>
              ))}
            </div>
            <Input
              value={stylePrompt}
              onChange={setStylePrompt}
              placeholder="Type genres/styles… e.g., Synthwave, Electro-pop"
            />
            <AssistSuggestionCard
              ui={ui}
              t={t}
              value={styleAssist?.suggestion}
              error={styleAssist?.error}
              onUse={styleAssist?.onUse}
              onCancel={styleAssist?.onCancel}
            />
          </div>







          {lyricsMode !== "instrumental" && (
            <div>
              <div style={{ display: "block", fontSize: 14, fontWeight: 600, color: t.subtext, marginBottom: 6 }}>Target voice persona (optional)</div>
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
                      onClick={onClearPersona}
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
                {loadingModels && (
                  <div style={{ fontSize: 12, fontWeight: 650, color: t.subtext }}>
                    Loading persona models...
                  </div>
                )}
              </div>
            </div>
          )}

          {selectedModel && selectedCheckpoint && (
            <div
              style={{
                borderRadius: 16,
                border: `1px solid ${t.hairline}`,
                background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
                boxShadow: t.shadowSoft,
                padding: 12,
                display: "grid",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                <label style={{ fontSize: 14, fontWeight: 700, color: t.subtext }}>Pitch shift (semitones)</label>
                <div style={{ fontSize: 12, fontWeight: 800, color: t.subtext }}>
                  {pitchShiftSafe > 0 ? `+${pitchShiftSafe}` : String(pitchShiftSafe)}
                </div>
              </div>
              <Slider
                value={pitchShiftSafe}
                min={-12}
                max={12}
                step={1}
                onChange={(v) => setPitchShift(String(v))}
              />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "end", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setPreserveTempo(!preserveTempo)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 999,
                    border: `1px solid ${preserveTempo ? t.primary : t.hairline}`,
                    background: preserveTempo ? t.primaryWash : "transparent",
                    color: preserveTempo ? t.primary : t.subtext,
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  {preserveTempo ? "Preserve tempo ✓" : "Preserve tempo"}
                </button>
              </div>
            </div>
          )}


          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontWeight: 700, color: t.subtext , fontSize: "14px"}}>Cover fidelity</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: t.subtext }}>{coverStrength.toFixed(2)}</div>
            </div>
                <div style={{ display: "grid", gap: 8 }}>
                  <Slider value={coverStrength} min={0.1} max={1.0} step={0.05} onChange={onCoverStrengthChange} />

                </div>
          </div>
        </div>
      </Panel>

     

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
              onClearPersona?.();
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
