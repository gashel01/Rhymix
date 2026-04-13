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
  advancedMode,
  promptEngine,
  showAceStepAdvanced,
  setShowAceStepAdvanced,
  initializeLm,
  mainModelPath,
  setMainModelPath,
  lmModelPath,
  setLmModelPath,
  lmBackend,
  setLmBackend,
  device,
  setDevice,
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
  const { Pill, Input, CheckRow, Modal, Hairline } = ui;
  const shortModel = String(mainModelPath || "").replace("acestep-", "").replace("v15-", "v1.5 ");
  const summary = advancedMode
    ? [
      shortModel ? `Model ${shortModel}` : null,
      initializeLm ? "LLM on" : "LLM off",
      device ? `Device ${device}` : null,
    ].filter(Boolean).join(" · ")
    : (shortModel ? `Model ${shortModel}` : "Default model");
  const showQualityLLM = promptEngine === "llm";
  const Label = ({ text, tip }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, color: t.subtext }}>
      <span>{text}</span>
      {tip && (
        <span
          title={tip}
          style={{
            width: 16,
            height: 16,
            borderRadius: 999,
            border: `1px solid ${t.hairline}`,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            fontWeight: 900,
            color: t.subtext,
            cursor: "help",
          }}
        >
          ?
        </span>
      )}
    </div>
  );
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div
        style={{
          padding: "6px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          cursor: "pointer",
          borderRadius: t.radiusSm,
          border: `1px solid ${t.hairline}`,
          background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
          boxShadow: t.shadowSoft,
        }}
        onClick={() => setShowAceStepAdvanced(true)}
      >
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ fontWeight: 850, color: t.text }}>ACE-Step 1.5</div>
          <div style={{ fontSize: 10, fontWeight: 650, color: t.subtext }}>
            {summary || "Default configuration"}
          </div>
        </div>
      </div>

      <Modal
        open={showAceStepAdvanced}
        onClose={() => setShowAceStepAdvanced(false)}
        title="Generation Model"
        footer={
          <Pill tone="primary" onClick={() => setShowAceStepAdvanced(false)}>
            Done
          </Pill>
        }
      >
        <div style={{ display: "grid", gap: 12 }}>
          {advancedMode ? (
            <>
              <div style={{ fontSize: 12, fontWeight: 650, color: t.subtext }}>
                Tune how ACE-Step runs. Defaults are safe; only adjust what you need.
              </div>
              <Hairline style={{ margin: "2px 0 4px 0" }} />
              <div style={{ fontWeight: 850, color: t.text }}>Models</div>
            </>
          ) : (
            <div style={{ fontSize: 12, fontWeight: 650, color: t.subtext }}>
              Pick the model used for generation.
            </div>
          )}
          <div className="cs-selectWrap">
            <Label text="Main model" tip="Select the ACE-Step checkpoint used for generation." />
            <select value={mainModelPath} onChange={(e) => setMainModelPath(e.target.value)} style={selectStyle(t)}>
              {ACESTEP_MAIN_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <div className="cs-selectChevron">▾</div>
          </div>
          {showQualityLLM && (
            <div className="cs-selectWrap">
              <Label text="LLM model" tip="Text-to-semantic model used when LLM is enabled." />
              <select value={lmModelPath} onChange={(e) => setLmModelPath(e.target.value)} disabled={!initializeLm} style={selectStyle(t)}>
                {ACESTEP_LM_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <div className="cs-selectChevron">▾</div>
            </div>
          )}
          {advancedMode && (
            <>
              <div className="cs-selectWrap">
                <Label text="LLM backend" tip="Backend used to run the LLM (vllm is recommended)." />
                <select value={lmBackend} onChange={(e) => setLmBackend(e.target.value)} disabled={!initializeLm} style={selectStyle(t)}>
                  <option value="vllm">vllm</option>
                  <option value="pt">pt</option>
                </select>
                <div className="cs-selectChevron">▾</div>
              </div>
              <div className="cs-selectWrap">
                <Label text="Device" tip="Auto picks GPU if available; CPU is slower." />
                <select value={device} onChange={(e) => setDevice(e.target.value)} style={selectStyle(t)}>
                  <option value="auto">auto</option>
                  <option value="cuda">cuda</option>
                  <option value="cpu">cpu</option>
                </select>
                <div className="cs-selectChevron">▾</div>
              </div>
              <Hairline style={{ margin: "6px 0" }} />
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 850, color: t.text }}>Generation Details</div>
                <div style={{ display: "grid", gap: 6 }}>
                  <Label text="DiT inference steps" tip="More steps can improve quality but take longer." />
                  <Input value={ditInferenceSteps} onChange={(v) => setDitInferenceSteps(String(v).replace(/[^\d]/g, ""))} placeholder="Optional" />
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <Label text="Shift" tip="Small adjustments to model conditioning; leave blank unless you know." />
                  <Input value={shift} onChange={(v) => setShift(String(v).replace(/[^\d.]/g, ""))} placeholder="Optional" />
                </div>
              </div>
              <Hairline style={{ margin: "6px 0" }} />
              <CheckRow label="Use flash attention" value={useFlashAttention} onChange={setUseFlashAttention} hint="Faster attention on supported GPUs." />
              <CheckRow label="Offload to CPU" value={offloadToCpu} onChange={setOffloadToCpu} hint="Reduces GPU memory use, slower." />
              <CheckRow label="Offload DiT to CPU" value={offloadDitToCpu} onChange={setOffloadDitToCpu} hint="Extra memory savings for the DiT model." />
              <CheckRow label="Compile model" value={compileModel} onChange={setCompileModel} hint="Compile for speed; may take longer to start." />
              <CheckRow label="Int8 quantization" value={int8Quantization} onChange={setInt8Quantization} hint="Lower memory, possible quality tradeoff." />
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
