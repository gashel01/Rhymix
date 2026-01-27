import React, { useMemo } from "react";
import {
  Delete as DeleteIcon,
  School as SchoolIcon,
  Psychology as PsychologyIcon,
  ArrowBack as ArrowBackIcon,
} from "@mui/icons-material";

/**
 * New-style (no MUI) AudioTableActions
 * - Keeps same props/signature
 * - Frosted/glass look + dark/light
 * - Sticky-friendly (no absolute center weirdness)
 * - Works well inside your new table header area
 */
const AudioTableActions = ({
  selectedRows = [],
  trackPairs = [],
  handleTrainWithDataset,
  handleInferenceWithTracks,
  showInferenceResultsActions,
  onReturnToModelSelection,
  onReturnToInferenceParams,
  onSelectAll,
  onClear,
  onDelete,
  defaultLabel,
  // optional: allow parent to pass darkMode explicitly (same pattern as your other views)
  darkMode,
}) => {
  const hasSelection = selectedRows.length > 0;

  const t = useMemo(() => {
    const isDark =
      typeof darkMode === "boolean"
        ? darkMode
        : typeof window !== "undefined"
        ? window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false
        : false;

    return {
      isDark,
      text: isDark ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.90)",
      subtext: isDark ? "rgba(255,255,255,0.62)" : "rgba(0,0,0,0.55)",
      hairline: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)",
      glassA: isDark ? "rgba(18,18,20,0.62)" : "rgba(255,255,255,0.72)",
      glassB: isDark ? "rgba(26,26,28,0.56)" : "rgba(248,248,250,0.78)",
      cardA: isDark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.86)",
      cardB: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.70)",
      shadow: isDark ? "0 14px 34px rgba(0,0,0,0.45)" : "0 12px 26px rgba(0,0,0,0.10)",
      shadowSoft: isDark ? "0 10px 24px rgba(0,0,0,0.35)" : "0 10px 22px rgba(0,0,0,0.08)",
      radiusLg: 18,
      radiusMd: 14,
      primary: isDark ? "rgba(10,132,255,1)" : "rgba(0,122,255,1)",
      primaryWash: isDark ? "rgba(10,132,255,0.18)" : "rgba(0,122,255,0.12)",
      purple: "rgba(156,39,176,1)",
      purpleWash: isDark ? "rgba(156,39,176,0.18)" : "rgba(156,39,176,0.12)",
      danger: "rgba(255,59,48,1)",
      dangerWash: isDark ? "rgba(255,59,48,0.20)" : "rgba(255,59,48,0.14)",
      success: "rgba(52,199,89,1)",
      successWash: isDark ? "rgba(52,199,89,0.18)" : "rgba(52,199,89,0.12)",
    };
  }, [darkMode]);

  const getSelectedTracks = () =>
    selectedRows
      .map((id) => trackPairs.find((p) => p?.id === id))
      .filter(Boolean);

  const PillCount = () => (
    <div
      style={{
        width: 30,
        height: 30,
        borderRadius: 999,
        display: "grid",
        placeItems: "center",
        color: "white",
        fontWeight: 950,
        fontSize: 12,
        background: `linear-gradient(180deg, ${t.primary}, rgba(10,132,255,0.78))`,
        boxShadow: t.shadowSoft,
        border: `1px solid rgba(10,132,255,0.35)`,
      }}
      aria-label={`${selectedRows.length} selected`}
      title={`${selectedRows.length} selected`}
    >
      {selectedRows.length}
    </div>
  );

  const Btn = ({
    children,
    onClick,
    variant = "secondary",
    disabled,
    title,
    style,
    icon,
  }) => {
    const v = {
      primary: {
        bg: `linear-gradient(135deg, ${t.primary} 0%, rgba(13,71,161,1) 100%)`,
        fg: "white",
        bd: "rgba(10,132,255,0.45)",
      },
      purple: {
        bg: `linear-gradient(135deg, ${t.purple} 0%, rgba(123,31,162,1) 100%)`,
        fg: "white",
        bd: "rgba(156,39,176,0.45)",
      },
      secondary: {
        bg: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
        fg: t.text,
        bd: t.hairline,
      },
      outline: {
        bg: "transparent",
        fg: t.text,
        bd: t.hairline,
      },
      danger: {
        bg: `linear-gradient(180deg, rgba(255,59,48,0.95), rgba(255,59,48,0.78))`,
        fg: "white",
        bd: "rgba(255,59,48,0.45)",
      },
    }[variant];

    return (
      <button
        type="button"
        title={title}
        onClick={onClick}
        disabled={disabled}
        style={{
          height: 36,
          padding: "0 12px",
          borderRadius: 12,
          border: `1px solid ${v.bd}`,
          background: v.bg,
          color: v.fg,
          fontWeight: 900,
          fontSize: 12,
          letterSpacing: -0.1,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.55 : 1,
          boxShadow: disabled ? "none" : t.shadowSoft,
          transition: "transform 120ms ease, opacity 160ms ease",
          userSelect: "none",
          ...style,
        }}
        onMouseDown={(e) => {
          if (disabled) return;
          e.currentTarget.style.transform = "scale(0.985)";
        }}
        onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      >
        {icon ? <span style={{ display: "grid", placeItems: "center" }}>{icon}</span> : null}
        {children}
      </button>
    );
  };

  const SmallIcon = ({ children }) => (
    <span style={{ display: "grid", placeItems: "center" }}>
      {React.cloneElement(children, { style: { fontSize: 18 } })}
    </span>
  );

  return (
    <div
      style={{
        marginBottom: 14,
        padding: 12,
        borderRadius: t.radiusLg,
        border: `1px solid ${t.hairline}`,
        background: `linear-gradient(180deg, ${t.glassA}, ${t.glassB})`,
        backdropFilter: "blur(18px) saturate(140%)",
        WebkitBackdropFilter: "blur(18px) saturate(140%)",
        boxShadow: t.shadow,
      }}
    >
      <div
        className="ata-grid"
        style={{
          display: "grid",
          gap: 10,
          alignItems: "center",
          gridTemplateColumns: "1fr auto auto",
        }}
      >
        {/* Left: selection info */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          {hasSelection ? <PillCount /> : null}

          <div style={{ minWidth: 0 }}>
            {hasSelection ? (
              <div style={{ color: t.text, fontWeight: 950, letterSpacing: -0.2, lineHeight: 1.1 }}>
                {selectedRows.length} track{selectedRows.length !== 1 ? "s" : ""} selected
              </div>
            ) : (
              <div style={{ color: t.subtext, fontWeight: 750 }}>
                {defaultLabel || "Select tracks to get started"}
              </div>
            )}
          </div>
        </div>

        {/* Middle: primary actions */}
        <div
          className="ata-actions"
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "center",
            flexWrap: "wrap",
            opacity: hasSelection ? 1 : 0,
            pointerEvents: hasSelection ? "auto" : "none",
            transition: "opacity 160ms ease",
          }}
        >
          {showInferenceResultsActions ? (
            <>
              {onReturnToModelSelection && (
                <Btn
                  variant="primary"
                  title="Model Selection"
                  onClick={onReturnToModelSelection}
                  icon={
                    <SmallIcon>
                      <PsychologyIcon />
                    </SmallIcon>
                  }
                >
                  Model Selection
                </Btn>
              )}

              {onReturnToInferenceParams && (
                <Btn
                  variant="purple"
                  title="Inference Params"
                  onClick={onReturnToInferenceParams}
                  icon={
                    <SmallIcon>
                      <ArrowBackIcon />
                    </SmallIcon>
                  }
                >
                  Inference Params
                </Btn>
              )}
            </>
          ) : (
            <>
              {handleTrainWithDataset && (
                <Btn
                  variant="primary"
                  title="Train Model"
                  onClick={() => handleTrainWithDataset(getSelectedTracks())}
                  icon={
                    <SmallIcon>
                      <SchoolIcon />
                    </SmallIcon>
                  }
                >
                  Train Model
                </Btn>
              )}

              {handleInferenceWithTracks && (
                <Btn
                  variant="purple"
                  title="Run Inference"
                  onClick={() => handleInferenceWithTracks(getSelectedTracks())}
                  icon={
                    <SmallIcon>
                      <PsychologyIcon />
                    </SmallIcon>
                  }
                >
                  Run Inference
                </Btn>
              )}
            </>
          )}
        </div>

        {/* Right: utility actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <Btn variant="outline" title="Select all" onClick={onSelectAll}>
            Select All
          </Btn>

          {hasSelection ? (
            <>
              <Btn variant="outline" title="Clear selection" onClick={onClear}>
                Clear
              </Btn>

              <div style={{ position: "relative" }}>
                <Btn
                  variant="danger"
                  title="Delete selected"
                  onClick={onDelete}
                  icon={
                    <SmallIcon>
                      <DeleteIcon />
                    </SmallIcon>
                  }
                  style={{ padding: "0 10px" }}
                >
                  Delete
                </Btn>

                <div
                  style={{
                    position: "absolute",
                    top: -8,
                    right: -8,
                    width: 18,
                    height: 18,
                    borderRadius: 999,
                    display: "grid",
                    placeItems: "center",
                    fontSize: 10,
                    fontWeight: 950,
                    color: "white",
                    background: t.danger,
                    border: `2px solid ${t.isDark ? "rgba(10,10,12,0.95)" : "rgba(255,255,255,0.95)"}`,
                    boxShadow: t.shadowSoft,
                  }}
                  title={`${selectedRows.length} selected`}
                >
                  {selectedRows.length}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>

      <style>{`
        @media (max-width: 900px){
          .ata-grid{
            grid-template-columns: 1fr;
            gap: 12px;
          }
          .ata-actions{
            justify-content: flex-start !important;
          }
        }
      `}</style>
    </div>
  );
};

export default AudioTableActions;
