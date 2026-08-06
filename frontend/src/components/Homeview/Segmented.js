import React from "react";

export const Segmented = ({ value, onChange, options, t }) => (
  <div style={{
    display: "inline-flex", gap: 6, padding: 4, borderRadius: 16,
    border: `1px solid ${t.hairline}`,
    background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
    boxShadow: t.shadowSoft,
  }}>
    {options.map(o => {
      const a = value === o.value;
      return (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          style={{
            minWidth: 160, padding: "10px 12px", borderRadius: 12,
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
            cursor: "pointer", fontWeight: 900, letterSpacing: -0.1, color: t.text,
            border: `1px solid ${a ? "rgba(10,132,255,.45)" : "transparent"}`,
            background: a
              ? `linear-gradient(135deg, ${t.primaryWash}, ${t.primaryWash2})`
              : "transparent",
          }}
        >
          {o.icon}{o.label}
        </button>
      );
    })}
  </div>
);

export default Segmented;
