import React, { useCallback, useState } from "react";
import Select from "../../components/common/Select";
import { requestGroqAutofill } from "../../utils/groqAutofill";
import { StudioAssistButton, StudioAssistSuggestion } from "./GroqAssist";

const CreationDashboard = ({
  createMode,
  setCreateMode,
  lyrics,
  setLyrics,
  style,
  setStyle,
  model,
  setModel,
  createPrompt,
  handleStartJob,
  onOpenOrchestrator,
  embedded = false,
}) => {
  const [assistLoading, setAssistLoading] = useState({ lyrics: false, style: false });
  const [assistError, setAssistError] = useState({ lyrics: "", style: "" });
  const [assistSuggestion, setAssistSuggestion] = useState({ lyrics: "", style: "" });

  const runAssist = useCallback(async (slot, task, context) => {
    setAssistLoading((prev) => ({ ...prev, [slot]: true }));
    setAssistError((prev) => ({ ...prev, [slot]: "" }));
    setAssistSuggestion((prev) => ({ ...prev, [slot]: "" }));
    try {
      const data = await requestGroqAutofill(task, context);
      const suggestion = data?.suggestion?.lyrics || data?.suggestion?.styleText || "";
      if (!String(suggestion).trim()) {
        throw new Error("Groq returned an empty suggestion.");
      }
      setAssistSuggestion((prev) => ({ ...prev, [slot]: String(suggestion).trim() }));
    } catch (error) {
      setAssistError((prev) => ({ ...prev, [slot]: error?.message || "Autofill failed." }));
    } finally {
      setAssistLoading((prev) => ({ ...prev, [slot]: false }));
    }
  }, []);

  const clearAssist = useCallback((slot) => {
    setAssistError((prev) => ({ ...prev, [slot]: "" }));
    setAssistSuggestion((prev) => ({ ...prev, [slot]: "" }));
  }, []);

  const requestLyricsAssist = useCallback(() => {
    runAssist("lyrics", "studio_creation_lyrics", {
      style,
      lyrics,
      model,
    });
  }, [lyrics, model, runAssist, style]);

  const requestStyleAssist = useCallback(() => {
    runAssist("style", "studio_creation_style", {
      style,
      lyrics,
      model,
    });
  }, [lyrics, model, runAssist, style]);

  return (
    <div className={embedded ? "studio-create-panel studio-create-panel-embedded" : "studio-panel studio-create-panel"}>
      <div className="studio-panel-title">{embedded ? "Create" : "Creation Dashboard"}</div>
      <div className="studio-toggle-group">
        <button
          className={`studio-mini ${createMode === "custom" ? "active" : ""}`}
          onClick={() => setCreateMode("custom")}
        >
          Custom Mode
        </button>
        <button
          className={`studio-mini ${createMode === "simple" ? "active" : ""}`}
          onClick={() => setCreateMode("simple")}
        >
          Simple Mode
        </button>
      </div>
      {createMode === "custom" && (
        <div className="studio-field">
          <div className="studio-field-head">
            <label>Lyrics</label>
            <StudioAssistButton
              onRequest={requestLyricsAssist}
              loading={assistLoading.lyrics}
            />
          </div>
          <textarea value={lyrics} onChange={(e) => setLyrics(e.target.value)} rows={4} />
          <StudioAssistSuggestion
            value={assistSuggestion.lyrics}
            error={assistError.lyrics}
            onReplace={() => {
              if (!assistSuggestion.lyrics) return;
              setLyrics(assistSuggestion.lyrics);
              clearAssist("lyrics");
            }}
            onAppend={() => {
              const nextValue = String(assistSuggestion.lyrics || "").trim();
              if (!nextValue) return;
              setLyrics((prev) => {
                const current = String(prev || "").trim();
                return current ? `${current}\n\n${nextValue}` : nextValue;
              });
              clearAssist("lyrics");
            }}
            onCancel={() => clearAssist("lyrics")}
          />
        </div>
      )}
      <div className="studio-field">
        <div className="studio-field-head">
          <label>Style of Music</label>
          <StudioAssistButton
            onRequest={requestStyleAssist}
            loading={assistLoading.style}
          />
        </div>
        <input value={style} onChange={(e) => setStyle(e.target.value)} />
        <StudioAssistSuggestion
          value={assistSuggestion.style}
          error={assistError.style}
          onUse={() => {
            if (!assistSuggestion.style) return;
            setStyle(assistSuggestion.style);
            clearAssist("style");
          }}
          onCancel={() => clearAssist("style")}
        />
      </div>
      <div className="studio-field">
        <label>Model</label>
        <Select
          value={model}
          onChange={setModel}
          options={[{ value: "v3.5", label: "v3.5" }, { value: "v4", label: "v4" }, { value: "v5", label: "v5" }]}
        />
      </div>
      <div className="studio-actions-row">
        <button
          className="studio-btn accent"
          disabled={!createPrompt}
          onClick={() =>
            handleStartJob("add_layer", {
              prompt: createPrompt,
              durationSec: 30,
              model,
            })
          }
        >
          Generate
        </button>
        {embedded && onOpenOrchestrator ? (
          <button className="studio-btn ghost" type="button" onClick={onOpenOrchestrator}>
            AI Orchestrator
          </button>
        ) : null}
      </div>
      {/* Upload Audio / Record / Add Persona used to sit here as three
          full-width buttons that were hard-coded `disabled` — they had no
          handler and no path to ever becoming enabled. Three dead controls at
          the foot of the panel read as "this app is unfinished", and uploading
          and recording are both already reachable (the library panel and Live
          VC). Removed rather than left greyed out. */}
    </div>
  );
};

export default CreationDashboard;
