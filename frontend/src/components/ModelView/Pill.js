import React from 'react'
export const Pill = ({ children, tone = "neutral", style, t }) => {
    const toneMap = {
      neutral: { bg: t.isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)", fg: t.text, bd: t.hairline },
      primary: { bg: t.primaryWash, fg: t.primary, bd: "rgba(10,132,255,0.28)" },
      success: { bg: t.successWash, fg: t.success, bd: "rgba(52,199,89,0.28)" },
      danger: { bg: t.dangerWash, fg: t.danger, bd: "rgba(255,59,48,0.28)" },
      warning: { bg: "rgba(255,149,0,0.14)", fg: t.warning, bd: "rgba(255,149,0,0.28)" },
    }[tone];

    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: 0.2,
          background: toneMap.bg,
          color: toneMap.fg,
          border: `1px solid ${toneMap.bd}`,
          whiteSpace: "nowrap",
          ...style,
        }}
      >
        {children}
      </span>
    );
  };