import React, { useMemo } from "react";
import CloseIcon from "@mui/icons-material/Close";

export function useThemedUI(t) {
  return useMemo(() => {
    const Glass = ({ children, style }) => (
      <div
        style={{
          borderRadius: t.radiusLg,
          border: `1px solid ${t.hairline}`,
          background: `linear-gradient(180deg, ${t.glassA}, ${t.glassB})`,
          backdropFilter: "blur(22px) saturate(140%)",
          WebkitBackdropFilter: "blur(22px) saturate(140%)",
          boxShadow: t.shadow,
          ...style,
        }}
      >
        {children}
      </div>
    );

    const Panel = ({ children, style }) => (
      <div
        style={{
          borderRadius: t.radiusLg,
          border: `1px solid ${t.hairline}`,
          background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
          boxShadow: t.shadowSoft,
          padding: 18,
          ...style,
        }}
      >
        {children}
      </div>
    );

    const Hairline = ({ style }) => <div style={{ height: 1, background: t.hairline, ...style }} />;

    const Pill = ({ children, tone = "neutral", onClick, onDelete, title: tt, style }) => {
      const toneMap = {
        neutral: { bg: t.isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)", fg: t.text, bd: t.hairline },
        primary: { bg: t.primaryWash, fg: t.primary, bd: "rgba(10,132,255,0.28)" },
        success: { bg: t.successWash, fg: t.success, bd: "rgba(52,199,89,0.28)" },
        danger: { bg: t.dangerWash, fg: t.danger, bd: "rgba(255,59,48,0.28)" },
        warning: { bg: "rgba(255,149,0,0.14)", fg: t.warning, bd: "rgba(255,149,0,0.28)" },
      }[tone];
      const clickable = !!onClick;
      return (
        <span
          title={tt}
          role={clickable ? "button" : undefined}
          tabIndex={clickable ? 0 : undefined}
          onClick={onClick}
          onKeyDown={(e) => clickable && e.key === "Enter" && onClick()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 10px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 850,
            letterSpacing: 0.2,
            background: toneMap.bg,
            color: toneMap.fg,
            border: `1px solid ${toneMap.bd}`,
            whiteSpace: "nowrap",
            userSelect: "none",
            cursor: clickable ? "pointer" : "default",
            ...style,
          }}
        >
          {children}
          {onDelete && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              style={{
                width: 18, height: 18, borderRadius: 999, border: `1px solid ${t.hairline}`,
                background: "transparent", color: t.subtext, display: "grid", placeItems: "center", cursor: "pointer",
              }}
              title="Remove"
              aria-label="Remove"
            >
              ×
            </button>
          )}
        </span>
      );
    };

    const Btn = ({ children, onClick, variant = "secondary", disabled, style, type = "button", title: tt }) => {
      const v = {
        primary: { bg: "linear-gradient(180deg, rgba(10,132,255,0.95), rgba(10,132,255,0.78))", fg: "white", bd: "rgba(10,132,255,0.45)" },
        secondary: { bg: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`, fg: t.text, bd: t.hairline },
        outline: { bg: "transparent", fg: t.text, bd: t.hairline },
        danger: { bg: "linear-gradient(180deg, rgba(255,59,48,0.95), rgba(255,59,48,0.78))", fg: "white", bd: "rgba(255,59,48,0.45)" },
      }[variant];
      return (
        <button
          type={type}
          title={tt}
          onClick={onClick}
          disabled={disabled}
          style={{
            borderRadius: 14, border: `1px solid ${v.bd}`, background: v.bg, color: v.fg,
            padding: "10px 12px", fontWeight: 900, letterSpacing: -0.1,
            cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1,
            boxShadow: disabled ? "none" : t.shadowSoft, transition: "transform 120ms ease, opacity 160ms ease",
            ...style,
          }}
          onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = "scale(0.985)"; }}
          onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
          onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
        >
          {children}
        </button>
      );
    };

    const IconBtn = ({ onClick, title: tt, children, disabled, style }) => (
      <button
        type="button"
        onClick={onClick}
        title={tt}
        disabled={disabled}
        style={{
          width: 40, height: 40, borderRadius: 14, border: `1px solid ${t.hairline}`,
          background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`, color: t.text,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1, boxShadow: t.shadowSoft,
          ...style,
        }}
      >
        {children}
      </button>
    );

    const Input = ({ value, onChange, placeholder, multiline, rows = 4, mono, disabled, rightNode }) => (
      <div style={{ borderRadius: 16, border: `1px solid ${t.hairline}`, background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`, boxShadow: t.shadowSoft, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: multiline ? "stretch" : "center" }}>
          {multiline ? (
            <textarea
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              disabled={disabled}
              rows={rows}
              style={{
                width: "100%", resize: "vertical", border: "none", outline: "none", background: "transparent",
                color: t.text, padding: 12, fontSize: 14, fontWeight: 650, lineHeight: 1.35,
                fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" : "inherit",
                opacity: disabled ? 0.55 : 1,
              }}
            />
          ) : (
            <input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              disabled={disabled}
              style={{ width: "100%", border: "none", outline: "none", background: "transparent", color: t.text, padding: "12px 12px", fontSize: 14, fontWeight: 650, opacity: disabled ? 0.55 : 1 }}
            />
          )}
          {rightNode && <div style={{ padding: 8, display: "grid", placeItems: "center" }}>{rightNode}</div>}
        </div>
      </div>
    );

    const CheckRow = ({ label, value, onChange, hint }) => (
      <div style={{ display: "grid", gap: 6 }}>
        <label
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
            padding: "10px 12px", borderRadius: 14, border: `1px solid ${t.hairline}`,
            background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`, boxShadow: t.shadowSoft, color: t.text, fontWeight: 800,
          }}
        >
          <span>{label}</span>
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: t.primary }} />
        </label>
        {hint && <div style={{ fontSize: 12, fontWeight: 650, color: t.subtext }}>{hint}</div>}
      </div>
    );

    const Segmented = ({ value, onChange, options }) => (
      <div style={{ display: "inline-flex", padding: 4, borderRadius: 16, border: `1px solid ${t.hairline}`, background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`, boxShadow: t.shadowSoft, gap: 6 }}>
        {options.map((opt) => {
          const active = value === opt.value;
          const disabled = !!opt.disabled;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => !disabled && onChange(opt.value)}
              disabled={disabled}
              style={{
                border: `1px solid ${active ? "rgba(10,132,255,0.45)" : "transparent"}`,
                background: active ? `linear-gradient(135deg, ${t.primaryWash}, ${t.primaryWash2})` : "transparent",
                color: disabled ? t.subtext : t.text,
                borderRadius: 12, padding: "10px 12px", fontWeight: 850, letterSpacing: -0.1,
                display: "inline-flex", alignItems: "center", gap: 8, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
              }}
            >
              {opt.icon}
              {opt.label}
            </button>
          );
        })}
      </div>
    );

    const Slider = ({ value, min, max, step, onChange, disabled }) => (
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        style={{ width: "100%", accentColor: t.primary, opacity: disabled ? 0.5 : 1 }}
      />
    );

    const ProgressBar = ({ value }) => (
      <div style={{ height: 6, borderRadius: 999, background: t.isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.08)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, value || 0))}%`, background: t.primary, borderRadius: 999, transition: "width 220ms ease" }} />
      </div>
    );

    const Alert = ({ kind = "error", children, onClose }) => {
      const tone = kind === "error" ? "danger" : kind === "success" ? "success" : "warning";
      return (
        <div
          style={{
            borderRadius: 16, border: `1px solid ${t.hairline}`,
            background: tone === "danger" ? t.dangerWash : tone === "success" ? t.successWash : "rgba(255,149,0,0.14)",
            padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, color: t.text, fontWeight: 750,
          }}
        >
          <div style={{ color: tone === "danger" ? t.danger : tone === "success" ? t.success : t.warning }}>{children}</div>
          {onClose && (
            <IconBtn onClick={onClose} title="Dismiss" style={{ width: 34, height: 34, boxShadow: "none" }}><span style={{ fontWeight: 950 }}>×</span></IconBtn>
          )}
        </div>
      );
    };

    const Spinner = ({ size = 16 }) => (
      <span
        style={{
          width: size, height: size, borderRadius: 999,
          border: `2px solid ${t.isDark ? "rgba(255,255,255,0.20)" : "rgba(0,0,0,0.18)"}`,
          borderTopColor: t.primary, display: "inline-block", animation: "spin 0.9s linear infinite",
        }}
      />
    );

    const Wave = ({ active }) => {
      const bars = useMemo(() => Array.from({ length: 44 }, () => Math.random() * 0.65 + 0.25), []);
      return (
        <div style={{ marginTop: 12, height: 44, borderRadius: 14, border: `1px solid ${t.hairline}`, background: t.isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)", display: "flex", alignItems: "center", padding: "0 10px", gap: 6, overflow: "hidden" }}>
          {bars.map((h, i) => (
            <div
              key={i}
              style={{
                width: 3, height: `${Math.round(h * 100)}%`, borderRadius: 6,
                background: active ? "rgba(10,132,255,0.90)" : t.isDark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.16)",
                transition: "background .2s ease",
              }}
            />
          ))}
        </div>
      );
    };

    const Modal = ({ open, onClose, title, children, footer }) => {
      if (!open) return null;
      return (
        <div
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
          style={{ position: "fixed", inset: 0, zIndex: 2000, background: t.isDark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.30)", display: "grid", placeItems: "center", padding: 16 }}
        >
          <Glass style={{ width: "100%", maxWidth: 520, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontWeight: 950, letterSpacing: -0.3, color: t.text }}>{title}</div>
              <IconBtn onClick={onClose} title="Close" style={{ width: 36, height: 36, boxShadow: "none" }}><CloseIcon style={{ fontSize: 18 }} /></IconBtn>
            </div>
            <Hairline style={{ margin: "10px 0 12px 0" }} />
            <div style={{ color: t.text }}>{children}</div>
            {footer && (
              <>
                <Hairline style={{ margin: "12px 0 10px 0" }} />
                <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>{footer}</div>
              </>
            )}
          </Glass>
        </div>
      );
    };

    return { Glass, Panel, Hairline, Pill, Btn, IconBtn, Input, CheckRow, Segmented, Slider, ProgressBar, Alert, Spinner, Wave, Modal };
  }, [t]);
}
