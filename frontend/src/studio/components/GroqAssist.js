import React from "react";

export function StudioAssistButton({
  onRequest,
  loading = false,
  disabled = false,
}) {
  return (
    <button
      className={`studio-mini studio-assist-trigger${loading ? " active" : ""}`}
      type="button"
      onClick={onRequest}
      disabled={disabled || loading}
    >
      {loading ? "Thinking..." : "AI Assist"}
    </button>
  );
}

export function StudioAssistSuggestion({
  value,
  error,
  onUse,
  onReplace,
  onAppend,
  onCancel,
}) {
  if (!value && !error) return null;
  return (
    <div className="studio-assist-stack">
      {error ? <div className="studio-empty">{error}</div> : null}
      {value ? (
        <div className="studio-assist-card">
          <div className="studio-assist-label">AI Suggestion</div>
          <div className="studio-assist-copy">{value}</div>
          <div className="studio-actions-row studio-assist-actions">
            {onUse ? (
              <button className="studio-btn accent" type="button" onClick={onUse}>
                Use
              </button>
            ) : null}
            {onReplace ? (
              <button className="studio-btn accent" type="button" onClick={onReplace}>
                Replace
              </button>
            ) : null}
            {onAppend ? (
              <button className="studio-btn ghost" type="button" onClick={onAppend}>
                Append
              </button>
            ) : null}
            <button className="studio-btn ghost" type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
