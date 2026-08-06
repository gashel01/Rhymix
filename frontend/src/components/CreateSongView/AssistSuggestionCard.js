import React from "react";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesomeOutlined";

export function AssistActionRow({
  t,
  label,
  onRequest,
  loading = false,
  disabled = false,
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: t.text }}>{label}</div>
      <button
        type="button"
        onClick={onRequest}
        disabled={disabled || loading}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderRadius: 999,
          border: `1px solid ${t.hairline}`,
          background: loading ? t.primaryWash : "transparent",
          color: loading ? t.primary : t.subtext,
          fontSize: 12,
          fontWeight: 800,
          cursor: disabled || loading ? "not-allowed" : "pointer",
          opacity: disabled || loading ? 0.7 : 1,
        }}
      >
        <AutoAwesomeIcon style={{ fontSize: 15 }} />
        {loading ? "Thinking..." : "AI Assist"}
      </button>
    </div>
  );
}

export function AssistSuggestionCard({
  ui,
  t,
  value,
  error,
  onUse,
  onReplace,
  onAppend,
  onCancel,
}) {
  const { Alert, Btn } = ui;

  if (!value && !error) return null;

  return (
    <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
      {error ? <Alert kind="error">{error}</Alert> : null}
      {value ? (
        <div
          style={{
            borderRadius: 16,
            border: `1px solid ${t.hairline}`,
            background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
            boxShadow: t.shadowSoft,
            padding: 12,
            display: "grid",
            gap: 10,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 800, color: t.primary, letterSpacing: 0.3 }}>
            AI SUGGESTION
          </div>
          <div
            style={{
              color: t.text,
              fontSize: 14,
              fontWeight: 650,
              lineHeight: 1.45,
              whiteSpace: "pre-wrap",
            }}
          >
            {value}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {onUse ? <Btn variant="primary" onClick={onUse}>Use</Btn> : null}
            {onReplace ? <Btn variant="primary" onClick={onReplace}>Replace</Btn> : null}
            {onAppend ? <Btn variant="secondary" onClick={onAppend}>Append</Btn> : null}
            <Btn variant="outline" onClick={onCancel}>Cancel</Btn>
          </div>
        </div>
      ) : null}
    </div>
  );
}
