import React, { useCallback, useEffect, useMemo, useState } from "react";
import Select from "../../components/common/Select";
import { requestGroqAutofill } from "../../utils/groqAutofill";

const FOUNDATION_INSTRUMENT_OPTIONS = [
  "Keys",
  "Synth",
  "Strings",
  "Guitar",
  "Bass",
  "Brass",
  "Woodwinds",
  "Choir",
  "Pluck",
  "Pad",
  "FX",
];

const FX_PRESET_OPTIONS = [
  { value: "clean", label: "Clean" },
  { value: "wide_pop", label: "Wide Pop" },
  { value: "dream_wash", label: "Dream Wash" },
  { value: "echo_trail", label: "Echo Trail" },
  { value: "grit_drive", label: "Grit Drive" },
  { value: "dark_filter", label: "Dark Filter" },
  { value: "chorus_shimmer", label: "Chorus Shimmer" },
];

const KEY_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const SCALE_OPTIONS = ["major", "minor"];
const TOTAL_BAR_OPTIONS = [8, 12, 16, 24, 32, 40, 48, 64];

const normalizePlan = (rawPlan, fallbackBars) => {
  const plan = rawPlan && typeof rawPlan === "object" ? rawPlan : {};
  const global = plan.global && typeof plan.global === "object" ? plan.global : {};
  const roles = Array.isArray(plan.roles) ? plan.roles : [];
  const sections = Array.isArray(plan.sections) ? plan.sections : [];
  return {
    global: {
      bpm: Math.max(40, Math.min(240, Number(global.bpm) || 120)),
      keyNote: KEY_NOTES.includes(global.keyNote) ? global.keyNote : "C",
      scale: SCALE_OPTIONS.includes(String(global.scale || "").toLowerCase())
        ? String(global.scale).toLowerCase()
        : "major",
      totalBars: Math.max(4, Number(global.totalBars) || fallbackBars || 16),
      drumPrompt: String(global.drumPrompt || "").trim(),
    },
    roles: roles.map((role, index) => ({
      id: String(role?.id || `role_${index + 1}`),
      laneName: String(role?.laneName || role?.instrumentFamily || `Role ${index + 1}`),
      instrumentFamily: FOUNDATION_INSTRUMENT_OPTIONS.includes(role?.instrumentFamily)
        ? role.instrumentFamily
        : "Synth",
      basePrompt: String(role?.basePrompt || "").trim(),
      styleTags: String(role?.styleTags || "").trim(),
      fxTags: String(role?.fxTags || "").trim(),
      fxPreset: FX_PRESET_OPTIONS.some((item) => item.value === role?.fxPreset)
        ? role.fxPreset
        : "clean",
    })),
    sections: sections.map((section, sectionIndex) => ({
      id: String(section?.id || `section_${sectionIndex + 1}`),
      label: String(section?.label || `Section ${sectionIndex + 1}`),
      bars: [4, 8].includes(Number(section?.bars)) ? Number(section.bars) : 4,
      enabled: section?.enabled !== false,
      steps: (Array.isArray(section?.steps) ? section.steps : []).map((step, stepIndex) => ({
        id: String(step?.id || `${section?.id || `section_${sectionIndex + 1}`}_step_${stepIndex + 1}`),
        roleId: String(step?.roleId || roles[0]?.id || ""),
        enabled: step?.enabled !== false,
        prompt: String(step?.prompt || "").trim(),
        styleTags: String(step?.styleTags || "").trim(),
        fxTags: String(step?.fxTags || "").trim(),
      })),
    })),
  };
};

const getPlanStepLabels = (plan) => {
  if (!plan) return [];
  const roleNameById = new Map((plan.roles || []).map((role) => [role.id, role.laneName || role.id]));
  const labels = [];
  (plan.sections || []).forEach((section) => {
    if (section.enabled === false) return;
    (section.steps || []).forEach((step) => {
      if (step.enabled === false) return;
      labels.push(`${section.label} · ${roleNameById.get(step.roleId) || step.roleId}`);
    });
    labels.push(`${section.label} · Drums`);
  });
  return labels;
};

const getPlanErrors = (plan) => {
  const errors = [];
  if (!plan?.global || !Array.isArray(plan?.roles) || !Array.isArray(plan?.sections)) {
    return ["Generate a valid orchestration plan first."];
  }
  const enabledBars = plan.sections
    .filter((section) => section.enabled !== false)
    .reduce((sum, section) => sum + (Number(section.bars) || 0), 0);
  if (enabledBars !== Number(plan.global.totalBars || 0)) {
    errors.push(`Enabled sections add up to ${enabledBars} bars, but total bars is ${plan.global.totalBars}.`);
  }
  if (!plan.roles.length) {
    errors.push("Add at least one non-drum role.");
  }
  plan.roles.forEach((role, index) => {
    if (!role.basePrompt.trim()) errors.push(`Role ${index + 1} is missing a base prompt.`);
    if (!FOUNDATION_INSTRUMENT_OPTIONS.includes(role.instrumentFamily)) {
      errors.push(`Role ${role.laneName || index + 1} has an unsupported instrument.`);
    }
    if (!FX_PRESET_OPTIONS.some((item) => item.value === role.fxPreset)) {
      errors.push(`Role ${role.laneName || index + 1} has an unsupported FX preset.`);
    }
  });
  const roleIds = new Set(plan.roles.map((role) => role.id));
  plan.sections.forEach((section, sectionIndex) => {
    if (![4, 8].includes(Number(section.bars))) {
      errors.push(`Section ${section.label || sectionIndex + 1} must be 4 or 8 bars.`);
    }
    if (!Array.isArray(section.steps) || !section.steps.length) {
      errors.push(`Section ${section.label || sectionIndex + 1} needs at least one step.`);
      return;
    }
    section.steps.forEach((step, stepIndex) => {
      if (!roleIds.has(step.roleId)) {
        errors.push(`Section ${section.label || sectionIndex + 1}, step ${stepIndex + 1} references an unknown role.`);
      }
    });
    if (section.enabled !== false && !section.steps.some((step) => step.enabled !== false)) {
      errors.push(`Enabled section ${section.label || sectionIndex + 1} needs at least one enabled step.`);
    }
  });
  return errors;
};

const makeSection = (index) => ({
  id: `section_${Date.now()}_${index}`,
  label: `Section ${index + 1}`,
  bars: 4,
  enabled: true,
  steps: [],
});

const makeRole = (index) => ({
  id: `role_${Date.now()}_${index}`,
  laneName: `Role ${index + 1}`,
  instrumentFamily: "Synth",
  basePrompt: "",
  styleTags: "",
  fxTags: "",
  fxPreset: "clean",
});

const OrchestratorModal = ({
  open,
  onClose,
  transport,
  jobs = [],
  onStartAiJob,
  onFocusResult,
}) => {
  const [view, setView] = useState("brief");
  const [prompt, setPrompt] = useState("");
  const [totalBars, setTotalBars] = useState(16);
  const [plan, setPlan] = useState(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [planError, setPlanError] = useState("");
  const [activeJobId, setActiveJobId] = useState(null);

  const activeJob = useMemo(
    () => jobs.find((job) => job.id === activeJobId) || null,
    [activeJobId, jobs]
  );

  const stepLabels = useMemo(() => getPlanStepLabels(plan), [plan]);
  const completedSet = useMemo(
    () => new Set(Array.isArray(activeJob?.completedSteps) ? activeJob.completedSteps : []),
    [activeJob?.completedSteps]
  );
  const planErrors = useMemo(() => getPlanErrors(plan), [plan]);

  useEffect(() => {
    if (!activeJobId || !activeJob) return;
    if (activeJob.status === "completed" || activeJob.status === "failed") {
      setView("build");
    }
  }, [activeJob, activeJobId]);

  const updateRole = useCallback((roleId, patch) => {
    setPlan((prev) => ({
      ...prev,
      roles: prev.roles.map((role) => (role.id === roleId ? { ...role, ...patch } : role)),
    }));
  }, []);

  const updateSection = useCallback((sectionId, patch) => {
    setPlan((prev) => ({
      ...prev,
      sections: prev.sections.map((section) => (section.id === sectionId ? { ...section, ...patch } : section)),
    }));
  }, []);

  const updateStep = useCallback((sectionId, stepId, patch) => {
    setPlan((prev) => ({
      ...prev,
      sections: prev.sections.map((section) =>
        section.id !== sectionId
          ? section
          : {
              ...section,
              steps: section.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
            }
      ),
    }));
  }, []);

  const addRole = () => {
    setPlan((prev) => ({ ...prev, roles: [...prev.roles, makeRole(prev.roles.length)] }));
  };

  const removeRole = (roleId) => {
    setPlan((prev) => ({
      ...prev,
      roles: prev.roles.filter((role) => role.id !== roleId),
      sections: prev.sections.map((section) => ({
        ...section,
        steps: section.steps.filter((step) => step.roleId !== roleId),
      })),
    }));
  };

  const addSection = () => {
    setPlan((prev) => ({ ...prev, sections: [...prev.sections, makeSection(prev.sections.length)] }));
  };

  const removeSection = (sectionId) => {
    setPlan((prev) => ({ ...prev, sections: prev.sections.filter((section) => section.id !== sectionId) }));
  };

  const addStep = (sectionId) => {
    setPlan((prev) => ({
      ...prev,
      sections: prev.sections.map((section) =>
        section.id !== sectionId
          ? section
          : {
              ...section,
              steps: [
                ...section.steps,
                {
                  id: `${sectionId}_step_${Date.now()}`,
                  roleId: prev.roles[0]?.id || "",
                  enabled: true,
                  prompt: "",
                  styleTags: "",
                  fxTags: "",
                },
              ],
            }
      ),
    }));
  };

  const removeStep = (sectionId, stepId) => {
    setPlan((prev) => ({
      ...prev,
      sections: prev.sections.map((section) =>
        section.id !== sectionId
          ? section
          : { ...section, steps: section.steps.filter((step) => step.id !== stepId) }
      ),
    }));
  };

  const handleGeneratePlan = async () => {
    setLoadingPlan(true);
    setPlanError("");
    try {
      const response = await requestGroqAutofill("studio_orchestrator_plan", {
        prompt,
        totalBars,
        supportedInstruments: FOUNDATION_INSTRUMENT_OPTIONS,
        supportedFxPresets: FX_PRESET_OPTIONS.map((item) => item.value),
      });
      const nextPlan = normalizePlan(response?.suggestion?.plan, totalBars);
      setPlan(nextPlan);
      setView("review");
      setActiveJobId(null);
    } catch (error) {
      setPlanError(error?.message || "Failed to generate song plan.");
    } finally {
      setLoadingPlan(false);
    }
  };

  const handleBuild = async () => {
    if (!plan || planErrors.length) return;
    setPlanError("");
    try {
      const nextJobId = await onStartAiJob?.("orchestrate_song", {
        insertSec: Number(transport?.currentTime ?? 0),
        plan,
      });
      if (nextJobId) {
        setActiveJobId(nextJobId);
        setView("build");
      }
    } catch (error) {
      setPlanError(error?.message || "Failed to start orchestration.");
    }
  };

  const handleGoToArrangement = () => {
    if (!activeJob?.result) return;
    onFocusResult?.(activeJob.result);
  };

  if (!open) return null;

  return (
    <div className="studio-modal-backdrop" onClick={loadingPlan ? undefined : onClose}>
      <div className="studio-orchestrator-modal" onClick={(event) => event.stopPropagation()}>
        <div className="studio-orchestrator-head">
          <div>
            <div className="studio-context-eyebrow">Studio</div>
            <div className="studio-panel-title">AI Orchestrator</div>
            <div className="studio-subtext">
              Turn one brief into a multi-lane arrangement with Foundation-1, lane FX presets, and a final STAGE drum pass.
            </div>
          </div>
          <button className="studio-mini" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        {view === "brief" ? (
          <div className="studio-orchestrator-body">
            <div className="studio-field">
              <label>Song Prompt</label>
              <textarea
                rows={4}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="A summer vibe pop song with bright synths, warm bass, dreamy pads, and a catchy chorus"
              />
            </div>
            <div className="studio-field">
              <label>Total Bars</label>
              <Select
                value={String(totalBars)}
                onChange={(next) => setTotalBars(Number(next) || 16)}
                options={TOTAL_BAR_OPTIONS.map((value) => ({ value: String(value), label: `${value} bars` }))}
              />
            </div>
            {planError ? <div className="studio-empty">{planError}</div> : null}
            <div className="studio-actions-row">
              <button
                className="studio-btn accent"
                type="button"
                disabled={!prompt.trim() || loadingPlan}
                onClick={handleGeneratePlan}
              >
                {loadingPlan ? "Planning..." : "Generate Plan"}
              </button>
            </div>
          </div>
        ) : null}

        {view === "review" && plan ? (
          <div className="studio-orchestrator-body studio-orchestrator-scroll">
            <div className="studio-meta-block">
              <div className="studio-panel-title">Global</div>
              <div className="studio-inline">
                <div className="studio-field">
                  <label>BPM</label>
                  <input
                    type="number"
                    min="40"
                    max="240"
                    step="1"
                    value={plan.global.bpm}
                    onChange={(event) =>
                      setPlan((prev) => ({
                        ...prev,
                        global: { ...prev.global, bpm: Math.max(40, Math.min(240, Number(event.target.value) || 120)) },
                      }))
                    }
                  />
                </div>
                <div className="studio-field">
                  <label>Key</label>
                  <Select
                    value={plan.global.keyNote}
                    onChange={(next) => setPlan((prev) => ({ ...prev, global: { ...prev.global, keyNote: next } }))}
                    options={KEY_NOTES.map((value) => ({ value: value, label: value }))}
                  />
                </div>
                <div className="studio-field">
                  <label>Scale</label>
                  <Select
                    value={plan.global.scale}
                    onChange={(next) => setPlan((prev) => ({ ...prev, global: { ...prev.global, scale: next } }))}
                    options={SCALE_OPTIONS.map((value) => ({ value: value, label: value }))}
                  />
                </div>
                <div className="studio-field">
                  <label>Total Bars</label>
                  <input
                    type="number"
                    step="4"
                    min="4"
                    value={plan.global.totalBars}
                    onChange={(event) =>
                      setPlan((prev) => ({
                        ...prev,
                        global: { ...prev.global, totalBars: Math.max(4, Number(event.target.value) || 16) },
                      }))
                    }
                  />
                </div>
              </div>
              <div className="studio-field">
                <label>Drum Prompt</label>
                <textarea
                  rows={3}
                  value={plan.global.drumPrompt}
                  onChange={(event) =>
                    setPlan((prev) => ({ ...prev, global: { ...prev.global, drumPrompt: event.target.value } }))
                  }
                />
              </div>
            </div>

            <div className="studio-meta-block">
              <div className="studio-panel-title">Roles</div>
              {(plan.roles || []).map((role) => (
                <div key={role.id} className="studio-orchestrator-card">
                  <div className="studio-actions-row studio-orchestrator-card-head">
                    <div className="studio-panel-title">{role.laneName || role.id}</div>
                    <button className="studio-mini" type="button" onClick={() => removeRole(role.id)}>
                      Remove
                    </button>
                  </div>
                  <div className="studio-inline">
                    <div className="studio-field">
                      <label>Lane Name</label>
                      <input value={role.laneName} onChange={(event) => updateRole(role.id, { laneName: event.target.value })} />
                    </div>
                    <div className="studio-field">
                      <label>Instrument</label>
                      <Select
                        value={role.instrumentFamily}
                        onChange={(next) => updateRole(role.id, { instrumentFamily: next })}
                        options={FOUNDATION_INSTRUMENT_OPTIONS.map((value) => ({ value: value, label: value }))}
                      />
                    </div>
                    <div className="studio-field">
                      <label>FX Preset</label>
                      <Select
                        value={role.fxPreset}
                        onChange={(next) => updateRole(role.id, { fxPreset: next })}
                        options={FX_PRESET_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
                      />
                    </div>
                  </div>
                  <div className="studio-field">
                    <label>Base Prompt</label>
                    <textarea rows={2} value={role.basePrompt} onChange={(event) => updateRole(role.id, { basePrompt: event.target.value })} />
                  </div>
                  <div className="studio-inline">
                    <div className="studio-field">
                      <label>Style Tags</label>
                      <input value={role.styleTags} onChange={(event) => updateRole(role.id, { styleTags: event.target.value })} />
                    </div>
                    <div className="studio-field">
                      <label>FX Tags</label>
                      <input value={role.fxTags} onChange={(event) => updateRole(role.id, { fxTags: event.target.value })} />
                    </div>
                  </div>
                </div>
              ))}
              <div className="studio-actions-row">
                <button className="studio-btn ghost" type="button" onClick={addRole}>
                  Add Role
                </button>
              </div>
            </div>

            <div className="studio-meta-block">
              <div className="studio-panel-title">Sections</div>
              {(plan.sections || []).map((section) => (
                <div key={section.id} className="studio-orchestrator-card">
                  <div className="studio-actions-row studio-orchestrator-card-head">
                    <label className="studio-toggle">
                      <input
                        type="checkbox"
                        checked={section.enabled !== false}
                        onChange={(event) => updateSection(section.id, { enabled: event.target.checked })}
                      />
                      Enabled
                    </label>
                    <button className="studio-mini" type="button" onClick={() => removeSection(section.id)}>
                      Remove
                    </button>
                  </div>
                  <div className="studio-inline">
                    <div className="studio-field">
                      <label>Label</label>
                      <input value={section.label} onChange={(event) => updateSection(section.id, { label: event.target.value })} />
                    </div>
                    <div className="studio-field">
                      <label>Bars</label>
                      <Select
                        value={String(section.bars)}
                        onChange={(next) => updateSection(section.id, { bars: Number(next) || 4 })}
                        options={[{ value: String(4), label: "4 bars" }, { value: String(8), label: "8 bars" }]}
                      />
                    </div>
                  </div>
                  {(section.steps || []).map((step) => (
                    <div key={step.id} className="studio-orchestrator-step">
                      <div className="studio-actions-row studio-orchestrator-card-head">
                        <label className="studio-toggle">
                          <input
                            type="checkbox"
                            checked={step.enabled !== false}
                            onChange={(event) => updateStep(section.id, step.id, { enabled: event.target.checked })}
                          />
                          Enabled
                        </label>
                        <button className="studio-mini" type="button" onClick={() => removeStep(section.id, step.id)}>
                          Remove Step
                        </button>
                      </div>
                      <div className="studio-field">
                        <label>Role</label>
                        <Select
                          value={step.roleId}
                          onChange={(next) => updateStep(section.id, step.id, { roleId: next })}
                          options={plan.roles.map((role) => ({ value: role.id, label: role.laneName }))}
                        />
                      </div>
                      <div className="studio-field">
                        <label>Prompt Override</label>
                        <textarea rows={2} value={step.prompt} onChange={(event) => updateStep(section.id, step.id, { prompt: event.target.value })} />
                      </div>
                      <div className="studio-inline">
                        <div className="studio-field">
                          <label>Style Tags Override</label>
                          <input value={step.styleTags} onChange={(event) => updateStep(section.id, step.id, { styleTags: event.target.value })} />
                        </div>
                        <div className="studio-field">
                          <label>FX Tags Override</label>
                          <input value={step.fxTags} onChange={(event) => updateStep(section.id, step.id, { fxTags: event.target.value })} />
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="studio-actions-row">
                    <button className="studio-btn ghost" type="button" onClick={() => addStep(section.id)}>
                      Add Step
                    </button>
                  </div>
                </div>
              ))}
              <div className="studio-actions-row">
                <button className="studio-btn ghost" type="button" onClick={addSection}>
                  Add Section
                </button>
              </div>
            </div>

            {planErrors.length ? (
              <div className="studio-empty">
                {planErrors.map((error) => (
                  <div key={error}>{error}</div>
                ))}
              </div>
            ) : null}
            {planError ? <div className="studio-empty">{planError}</div> : null}

            <div className="studio-actions-row">
              <button className="studio-btn ghost" type="button" onClick={handleGeneratePlan} disabled={loadingPlan}>
                Regenerate
              </button>
              <button className="studio-btn accent" type="button" onClick={handleBuild} disabled={planErrors.length > 0}>
                Build Song
              </button>
            </div>
          </div>
        ) : null}

        {view === "build" ? (
          <div className="studio-orchestrator-body">
            <div className="studio-meta-block">
              <div className="studio-panel-title">Build Status</div>
              <div className="studio-subtext">
                {activeJob?.statusMessage || activeJob?.error || activeJob?.status || "Waiting for orchestration to start."}
              </div>
              <div className="studio-progress" style={{ marginTop: 10 }}>
                <div className="studio-progress-bar" style={{ width: `${Math.max(0, Math.min(100, activeJob?.progress ?? 0))}%` }} />
              </div>
              {activeJob?.error ? <div className="studio-empty" style={{ marginTop: 12 }}>{activeJob.error}</div> : null}
            </div>
            <div className="studio-meta-block">
              <div className="studio-panel-title">Execution Steps</div>
              <div className="studio-orchestrator-step-list">
                {stepLabels.map((label) => (
                  <div
                    key={label}
                    className={`studio-orchestrator-step-item${completedSet.has(label) ? " complete" : activeJob?.currentStepLabel === label ? " active" : ""}`}
                  >
                    <span>{label}</span>
                    <span>
                      {completedSet.has(label)
                        ? "Done"
                        : activeJob?.currentStepLabel === label
                          ? "Running"
                          : "Pending"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="studio-actions-row">
              <button className="studio-btn ghost" type="button" onClick={() => setView("review")} disabled={activeJob?.status === "running"}>
                Back to Plan
              </button>
              {activeJob?.status === "completed" ? (
                <button className="studio-btn accent" type="button" onClick={handleGoToArrangement}>
                  Go to Arrangement
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default OrchestratorModal;
