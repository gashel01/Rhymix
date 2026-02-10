import React from "react";
import { ACESTEP_MAIN_MODELS, ACESTEP_LM_MODELS } from "./constants";

const selectStyle = (t) => ({
  width: "100%",
  height: 44,
  borderRadius: 16,
  border: `1px solid ${t.hairline}`,
  background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
  color: t.text,
  padding: "0 12px",
  fontWeight: 700,
  boxShadow: t.shadowSoft,
  outline: "none",
  appearance: "none",
});

export function AceStepSection({
  ui,
  t,
  showAceStepAdvanced,
  setShowAceStepAdvanced,
  promptEngine,
  setPromptEngine,
  useLmCodes,
  setUseLmCodes,
  setLmCodesTouched,
  mergeMetaIntoCaption,
  setMergeMetaIntoCaption,
  constraintRapOnly,
  setConstraintRapOnly,
  constraintNoSinging,
  setConstraintNoSinging,
  constraintNoHook,
  setConstraintNoHook,
  useNegativePrompt,
  setUseNegativePrompt,
  negativePrompt,
  setNegativePrompt,
  initializeLm,
  mainModelPath,
  setMainModelPath,
  lmModelPath,
  setLmModelPath,
  lmBackend,
  setLmBackend,
  device,
  setDevice,
  bpm,
  setBpm,
  keyscale,
  setKeyscale,
  timeSignature,
  setTimeSignature,
  ditInferenceSteps,
  setDitInferenceSteps,
  shift,
  setShift,
  useFlashAttention,
  setUseFlashAttention,
  offloadToCpu,
  setOffloadToCpu,
  offloadDitToCpu,
  setOffloadDitToCpu,
  compileModel,
  setCompileModel,
  int8Quantization,
  setInt8Quantization,
}) {
  const { Panel, Pill, Input, CheckRow, Segmented } = ui;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ fontWeight: 950, letterSpacing: -0.2, color: t.text }}>Generation Model</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontWeight: 800, color: t.text }}>ACE-Step 1.5</div>
        <Pill
          tone={showAceStepAdvanced ? "primary" : "neutral"}
          onClick={() => setShowAceStepAdvanced((v) => !v)}
          title="Show advanced ACE-Step settings"
        >
          {showAceStepAdvanced ? "Advanced ✓" : "Advanced"}
        </Pill>
      </div>
      <div style={{ fontSize: 12, fontWeight: 650, color: t.subtext }}>
        Defaults tuned for RTX 3070 Ti. Advanced options control LM, offload, and quantization.
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontWeight: 850, color: t.text }}>Prompt Engine</div>
        <Segmented
          value={promptEngine}
          onChange={(v) => v && setPromptEngine(v)}
          options={[
            { value: "llm", label: "LLM (Best)" },
            { value: "fast", label: "Fast (No LLM)" },
            { value: "caption", label: "Direct Caption" },
            { value: "assist", label: "LLM Assist" },
            { value: "expand", label: "LLM Expand" },
          ]}
        />
        <div style={{ fontSize: 12, fontWeight: 650, color: t.subtext }}>
          Fast and Direct Caption skip LLM init. Assist/Expand use LLM to rewrite your caption.
        </div>
      </div>

      <CheckRow
        label="Use LLM for audio codes (slower, more faithful)"
        value={useLmCodes}
        onChange={(v) => { setUseLmCodes(v); setLmCodesTouched(true); }}
        hint="Enable if you want stronger semantic adherence, even in Direct Caption mode."
      />
      <CheckRow
        label="Merge BPM/Key/Time/Genres into caption"
        value={mergeMetaIntoCaption}
        onChange={setMergeMetaIntoCaption}
        hint="Appends your BPM/key/time/genres to the caption for stronger control."
      />

      <div style={{ fontWeight: 850, color: t.text, marginTop: 2 }}>Hard Constraints</div>
      <CheckRow label="Rap vocals only" value={constraintRapOnly} onChange={setConstraintRapOnly} />
      <CheckRow label="No singing / melodic chorus" value={constraintNoSinging} onChange={setConstraintNoSinging} />
      <CheckRow label="No hooks / sung chorus" value={constraintNoHook} onChange={setConstraintNoHook} />

      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontWeight: 850, color: t.text }}>Negative Prompt</div>
        <CheckRow
          label="Use negative prompt"
          value={useNegativePrompt}
          onChange={setUseNegativePrompt}
          hint="Optional: tell the model what to avoid."
        />
        <Input
          value={negativePrompt}
          onChange={setNegativePrompt}
          disabled={!useNegativePrompt}
          placeholder="Avoid: singing, melodic chorus, pop hooks, female vocals..."
        />
        <div style={{ fontSize: 12, fontWeight: 650, color: t.subtext }}>
          Used for LLM CFG control when LLM codes are enabled.
        </div>
      </div>

      {showAceStepAdvanced && (
        <div style={{ display: "grid", gap: 10 }}>
          <div className="cs-selectWrap">
            <select value={mainModelPath} onChange={(e) => setMainModelPath(e.target.value)} style={selectStyle(t)}>
              {ACESTEP_MAIN_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <div className="cs-selectChevron">▾</div>
          </div>
          <div className="cs-selectWrap">
            <select value={lmModelPath} onChange={(e) => setLmModelPath(e.target.value)} disabled={!initializeLm} style={selectStyle(t)}>
              {ACESTEP_LM_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <div className="cs-selectChevron">▾</div>
          </div>
          <div className="cs-selectWrap">
            <select value={lmBackend} onChange={(e) => setLmBackend(e.target.value)} disabled={!initializeLm} style={selectStyle(t)}>
              <option value="vllm">vllm</option>
              <option value="pt">pt</option>
            </select>
            <div className="cs-selectChevron">▾</div>
          </div>
          <div className="cs-selectWrap">
            <select value={device} onChange={(e) => setDevice(e.target.value)} style={selectStyle(t)}>
              <option value="auto">auto</option>
              <option value="cuda">cuda</option>
              <option value="cpu">cpu</option>
            </select>
            <div className="cs-selectChevron">▾</div>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 850, color: t.text }}>Generation Details</div>
            <Input value={bpm} onChange={(v) => setBpm(String(v).replace(/[^\d.]/g, ""))} placeholder="BPM (optional)" />
            <Input value={keyscale} onChange={setKeyscale} placeholder="Key scale (optional) e.g. C Major" />
            <Input value={timeSignature} onChange={setTimeSignature} placeholder="Time signature (optional) e.g. 4" />
            <Input value={ditInferenceSteps} onChange={(v) => setDitInferenceSteps(String(v).replace(/[^\d]/g, ""))} placeholder="DiT inference steps (optional)" />
            <Input value={shift} onChange={(v) => setShift(String(v).replace(/[^\d.]/g, ""))} placeholder="Shift (optional)" />
          </div>
          <CheckRow label="Use flash attention" value={useFlashAttention} onChange={setUseFlashAttention} />
          <CheckRow label="Offload to CPU" value={offloadToCpu} onChange={setOffloadToCpu} />
          <CheckRow label="Offload DiT to CPU" value={offloadDitToCpu} onChange={setOffloadDitToCpu} />
          <CheckRow label="Compile model" value={compileModel} onChange={setCompileModel} />
          <CheckRow label="Int8 quantization" value={int8Quantization} onChange={setInt8Quantization} />
        </div>
      )}
    </div>
  );
}
