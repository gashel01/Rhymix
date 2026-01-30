import React from "react";

export const Btn = ({ children, onClick, variant = "secondary", disabled, style, type = "button", title ,t}) => {
    const v = {
      primary: {
        bg: `linear-gradient(180deg, rgba(10,132,255,0.95), rgba(10,132,255,0.78))`,
        fg: "white",
        bd: "rgba(10,132,255,0.45)",
      },
      secondary: { bg: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`, fg: t.text, bd: t.hairline },
      outline: { bg: "transparent", fg: t.text, bd: t.hairline },
      success: {
        bg: `linear-gradient(180deg, rgba(52,199,89,0.95), rgba(52,199,89,0.78))`,
        fg: "white",
        bd: "rgba(52,199,89,0.45)",
      },
    }[variant];

    return (
      <button
        type={type}
        title={title}
        onClick={onClick}
        disabled={disabled}
        style={{
          borderRadius: 14,
          border: `1px solid ${v.bd}`,
          background: v.bg,
          color: v.fg,
          padding: "10px 12px",
          fontWeight: 900,
          letterSpacing: -0.1,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.55 : 1,
          boxShadow: disabled ? "none" : t.shadowSoft,
          transition: "transform 120ms ease, opacity 160ms ease",
          ...style,
        }}
        onMouseDown={(e) => {
          if (disabled) return;
          e.currentTarget.style.transform = "scale(0.985)";
        }}
        onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      >
        {children}
      </button>
    );
  };

export default Btn;