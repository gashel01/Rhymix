import React from 'react'
export const Pill = ({ children, tone = "neutral", style, t }) => {
    const toneMap = {
      neutral: { bg: t.isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)", fg: t.text, bd: t.hairline },
      primary: { bg: t.primaryWash, fg: t.primary, bd: "rgba(10,132,255,0.28)" },
      success: { bg: t.successWash, fg: t.success, bd: "rgba(52,199,89,0.28)" },
      danger: { bg: t.dangerWash, fg: t.danger, bd: "rgba(255,59,48,0.28)" },
      warning: { bg: "rgba(255,149,0,0.14)", fg: t.warning, bd: "rgba(255,149,0,0.28)" },
      //green
      meta: { bg: t.isDark ? "rgba(52,199,89,0.28)" : "rgba(52,199,89,0.28)", fg: t.success, bd: "rgba(52,199,89,0.28)" },
      processing: { bg: t.isDark ? "rgba(10,132,255,0.2)" : "rgba(0,122,255,0.12)", fg: t.primary, bd: "rgba(10,132,255,0.28)" },
      error: { bg: t.isDark ? "rgba(255,59,48,0.2)" : "rgba(255,59,48,0.12)", fg: t.danger, bd: "rgba(255,59,48,0.28)" },
      new: { bg: t.isDark ? "rgba(0,122,255,0.2)" : "rgba(0,122,255,0.12)", fg: t.primary, bd: "rgba(0,122,255,0.28)" },
      version: { bg: t.isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)", fg: t.text, bd: t.hairline },
      favorite: { bg: t.isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)", fg: t.text, bd: t.hairline },
      queued: { bg: t.isDark ? "rgba(10,132,255,0.2)" : "rgba(0,122,255,0.12)", fg: t.primary, bd: "rgba(10,132,255,0.28)" },
      uploading: { bg: t.isDark ? "rgba(10,132,255,0.2)" : "rgba(0,122,255,0.12)", fg: t.primary, bd: "rgba(10,132,255,0.28)" },
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