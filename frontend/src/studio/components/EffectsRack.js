import React, { useState } from "react";

/* The right panel: the selected lane's effects, as a rack of cards. Each card is one effect with a
   plain-language line saying what it does, a power switch, and — once it's on — its controls with
   readable values ("250 ms", "35%", "3.5 kHz") instead of bare sliders. Adding an effect to the
   rack is adding an entry to EFFECTS; whatever plays or renders it lives in audioMath.js /
   useStudioPlayback.js / the backend render, keyed by the same `key`. */

const pct = (v) => `${Math.round(v * 100)}%`;

const EFFECTS = [
  {
    key: "pitch",
    icon: "♯",
    title: "Pitch",
    hint: "Shift everything on this lane up or down",
    alwaysOn: true,
    params: [
      { key: "semitones", label: "Shift", min: -12, max: 12, step: 1, def: 0, fmt: (v) => `${v > 0 ? "+" : ""}${v} st` },
    ],
  },
  {
    key: "echo",
    icon: "↺",
    title: "Echo",
    hint: "Repeats the sound, fading out",
    params: [
      { key: "time", label: "Time", min: 0.05, max: 1.5, step: 0.01, def: 0.25, fmt: (v) => `${Math.round(v * 1000)} ms` },
      { key: "feedback", label: "Repeats", min: 0, max: 0.85, step: 0.01, def: 0.3, fmt: pct },
      { key: "mix", label: "Amount", min: 0, max: 1, step: 0.01, def: 0.25, fmt: pct },
    ],
  },
  {
    key: "reverb",
    icon: "◎",
    title: "Reverb",
    hint: "Puts the sound in a room",
    params: [
      { key: "decay", label: "Size", min: 0.5, max: 8, step: 0.1, def: 2.5, fmt: (v) => `${v.toFixed(1)} s` },
      { key: "mix", label: "Amount", min: 0, max: 1, step: 0.01, def: 0.25, fmt: pct },
    ],
  },
  {
    key: "distortion",
    icon: "ϟ",
    title: "Distortion",
    hint: "Adds grit and warmth",
    params: [{ key: "drive", label: "Drive", min: 0, max: 100, step: 1, def: 20, fmt: (v) => `${Math.round(v)}%` }],
  },
  {
    key: "chorus",
    icon: "≈",
    title: "Chorus",
    hint: "Thickens the sound with a slow wobble",
    params: [
      { key: "rate", label: "Speed", min: 0.1, max: 5, step: 0.1, def: 0.8, fmt: (v) => `${v.toFixed(1)} Hz` },
      { key: "depth", label: "Depth", min: 0, max: 0.03, step: 0.001, def: 0.012, fmt: (v) => `${Math.round((v / 0.03) * 100)}%` },
      { key: "mix", label: "Amount", min: 0, max: 1, step: 0.01, def: 0.3, fmt: pct },
    ],
  },
  {
    key: "lowpass",
    icon: "◢",
    title: "Low-pass filter",
    hint: "Cuts the highs — muffled, far away, underwater",
    params: [
      {
        key: "cutoff",
        label: "Cutoff",
        min: 200,
        max: 20000,
        step: 10,
        def: 12000,
        fmt: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`),
      },
    ],
  },
];

const EffectCard = ({ effect, fx, open, onToggleOpen, onChange }) => {
  const state = fx?.[effect.key] || {};
  const enabled = effect.alwaysOn ? Number(state[effect.params[0].key] ?? 0) !== 0 : !!state.enabled;
  const isOpen = effect.alwaysOn || open;

  return (
    <div className={`studio-fx-card ${enabled ? "on" : ""}`}>
      <div className="studio-fx-head">
        <button
          type="button"
          className="studio-fx-headmain"
          onClick={effect.alwaysOn ? undefined : onToggleOpen}
          aria-expanded={isOpen}
          disabled={effect.alwaysOn}
        >
          <span className="studio-fx-icon" aria-hidden="true">
            {effect.icon}
          </span>
          <span className="studio-fx-copy">
            <span className="studio-fx-title">{effect.title}</span>
            <span className="studio-fx-hint">{effect.hint}</span>
          </span>
          {!effect.alwaysOn && (
            <span className={`studio-fx-chevron ${isOpen ? "open" : ""}`} aria-hidden="true">
              ›
            </span>
          )}
        </button>
        {effect.alwaysOn ? (
          enabled ? (
            <button
              type="button"
              className="studio-fx-reset"
              onClick={() => onChange(effect.key, { [effect.params[0].key]: 0 })}
            >
              Reset
            </button>
          ) : null
        ) : (
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={`${effect.title} ${enabled ? "on" : "off"}`}
            className={`studio-fx-switch ${enabled ? "on" : ""}`}
            onClick={() => {
              onChange(effect.key, { enabled: !enabled });
            }}
          >
            <span className="studio-fx-switch-knob" />
          </button>
        )}
      </div>
      {isOpen && (
        <div className="studio-fx-body">
          {effect.params.map((param) => {
            const value = Number(state[param.key] ?? param.def);
            return (
              <label key={param.key} className={`studio-fx-row ${enabled ? "" : "dim"}`}>
                <span className="studio-fx-row-top">
                  <span>{param.label}</span>
                  <span className="studio-fx-value">{param.fmt(value)}</span>
                </span>
                <input
                  type="range"
                  min={param.min}
                  max={param.max}
                  step={param.step}
                  value={value}
                  onChange={(e) => onChange(effect.key, { [param.key]: Number(e.target.value) })}
                  onDoubleClick={() => onChange(effect.key, { [param.key]: param.def })}
                  title="Double-click to reset"
                />
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
};

const EffectsRack = ({ lane, onUpdateLane }) => {
  const [openKeys, setOpenKeys] = useState({});

  if (!lane) {
    return (
      <div className="studio-fx-empty">
        <div className="studio-fx-empty-glyph" aria-hidden="true">
          ✦
        </div>
        <div className="studio-fx-empty-title">No lane selected</div>
        <div className="studio-fx-empty-text">
          Click a lane, or a clip on it, to shape its sound: echo, reverb, filter and more.
        </div>
      </div>
    );
  }

  const change = (key, patch) => {
    const current = lane.fx?.[key] || {};
    // Turning an effect on shows its controls; they stay open until closed.
    if (patch.enabled) setOpenKeys((prev) => ({ ...prev, [key]: true }));
    onUpdateLane?.(lane.id, { fx: { ...(lane.fx || {}), [key]: { ...current, ...patch } } });
  };

  const activeCount = EFFECTS.filter((effect) =>
    effect.alwaysOn ? Number(lane.fx?.[effect.key]?.[effect.params[0].key] ?? 0) !== 0 : lane.fx?.[effect.key]?.enabled
  ).length;

  return (
    <div className="studio-fx-rack">
      <div className="studio-fx-summary">
        <span className="studio-fx-summary-dot" style={{ background: lane.color || "#2b3a45" }} />
        <span>{activeCount ? `${activeCount} effect${activeCount === 1 ? "" : "s"} on` : "No effects on"}</span>
        {activeCount > 0 && (
          <button
            type="button"
            className="studio-fx-reset"
            onClick={() => {
              const off = {};
              EFFECTS.forEach((effect) => {
                if (effect.alwaysOn) off[effect.key] = { ...(lane.fx?.[effect.key] || {}), [effect.params[0].key]: 0 };
                else off[effect.key] = { ...(lane.fx?.[effect.key] || {}), enabled: false };
              });
              onUpdateLane?.(lane.id, { fx: { ...(lane.fx || {}), ...off } });
            }}
          >
            Turn all off
          </button>
        )}
      </div>
      {EFFECTS.map((effect) => (
        <EffectCard
          key={effect.key}
          effect={effect}
          fx={lane.fx}
          open={!!openKeys[effect.key]}
          onToggleOpen={() => setOpenKeys((prev) => ({ ...prev, [effect.key]: !prev[effect.key] }))}
          onChange={change}
        />
      ))}
    </div>
  );
};

export default EffectsRack;
