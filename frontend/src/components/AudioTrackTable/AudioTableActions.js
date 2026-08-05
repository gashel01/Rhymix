import React, { useMemo, useRef, useState, useEffect } from "react";
import {
  Delete as DeleteIcon,
  School as SchoolIcon,
  Psychology as PsychologyIcon,
  ArrowBack as ArrowBackIcon,
} from "@mui/icons-material";
import styles from "./AudioTableActions.module.css";

const AudioTableActions = ({
  selectedRows = [],
  trackPairs = [],
  handleTrainWithDataset,
  handleInferenceWithTracks,
  handleCoverWithTracks,
  showInferenceResultsActions,
  showHeaderWorkflowActions = true,
  // Views that render their own Select All / Clear / Delete (Home does, in its
  // custom header) turn this off so the bar doesn't duplicate them.
  showSelectionControls = true,
  hideActionBar = false,
  onReturnToModelSelection,
  onReturnToInferenceParams,
  onSelectAll,
  onClear,
  onDelete,
  defaultLabel,
  darkMode,
  children,
  header,
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
      text: isDark ? "rgba(255,255,255,0.92)" : "#0F172A",
      subtext: isDark ? "rgba(255,255,255,0.62)" : "#64748B",
      hairline: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.06)",
      glassA: isDark ? "rgba(18,18,20,0.62)" : "rgba(255,255,255,0.85)",
      glassB: isDark ? "rgba(26,26,28,0.56)" : "rgba(255,255,255,0.65)",
      cardA: isDark ? "rgba(255,255,255,0.07)" : "#FFFFFF",
      cardB: isDark ? "rgba(255,255,255,0.04)" : "#F8FAFC",
      shadow: isDark ? "0 14px 34px rgba(0,0,0,0.45)" : "0 20px 48px rgba(15,23,42,0.08)",
      shadowSoft: isDark ? "0 10px 24px rgba(0,0,0,0.35)" : "0 8px 24px rgba(15,23,42,0.04)",
      radiusLg: 18,
      radiusMd: 14,
      primary: isDark ? "rgba(10,132,255,1)" : "#2563EB",
      purple: "rgba(156,39,176,1)",
      danger: "rgba(255,59,48,1)",
    };
  }, [darkMode]);

  const getSelectedTracks = () =>
    selectedRows.map((id) => trackPairs.find((p) => p?.id === id)).filter(Boolean);

  // ✅ NEW: stuck detection
  const sentinelRef = useRef(null);
  const [isStuck, setIsStuck] = useState(false);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      ([entry]) => {
        // when sentinel is NOT visible, sticky header has reached the top
        setIsStuck(!entry.isIntersecting);
      },
      { threshold: 1 }
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const PillCount = () => (
    <div
      className={styles.pillCount}
      style={{
        color: "white",
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

  const Btn = ({ children, onClick, variant = "secondary", disabled, title, style, icon }) => {
    const v = {
      primary: { bg: `linear-gradient(135deg, ${t.primary} 0%, rgba(13,71,161,1) 100%)`, fg: "white", bd: "rgba(10,132,255,0.45)" },
      purple: { bg: `linear-gradient(135deg, ${t.purple} 0%, rgba(123,31,162,1) 100%)`, fg: "white", bd: "rgba(156,39,176,0.45)" },
      secondary: { bg: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`, fg: t.text, bd: t.hairline },
      outline: { bg: "transparent", fg: t.text, bd: t.hairline },
      danger: { bg: `linear-gradient(180deg, rgba(255,59,48,0.95), rgba(255,59,48,0.78))`, fg: "white", bd: "rgba(255,59,48,0.45)" },
    }[variant];

    return (
      <button
        type="button"
        title={title}
        onClick={onClick}
        disabled={disabled}
        className={styles.btnBase}
        style={{
          border: `1px solid ${v.bd}`,
          background: v.bg,
          color: v.fg,
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
        {icon ? <span className={styles.smallIcon}>{icon}</span> : null}
        {children}
      </button>
    );
  };

  const SmallIcon = ({ children }) => (
    <span className={styles.smallIcon}>
      {React.cloneElement(children, { style: { fontSize: 18 } })}
    </span>
  );

  return (
    <>
      {/* ✅ NEW: sentinel placed just before sticky header */}
      <div ref={sentinelRef} />

      <div
        className={styles.stickyHeader}
        style={{
          backdropFilter: isStuck ? "blur(20px)" : "none",

          // ✅ TRANSITION between “floating card” and “stuck bar”
          padding: isStuck ? "12px 24px" : "24px",           // dynamic padding when stuck
          borderRadius: isStuck ? 0 : t.radiusLg,     // square corners when stuck
          border: `1px solid ${t.hairline}`,
          margin: isStuck ? 0 : "24px 24px 0 24px",
          background: `linear-gradient(180deg, ${t.glassA}, ${t.glassB})`,
          boxShadow: isStuck ? t.shadowSoft : t.shadow,

          // ✅ smooth animation
          transition: "padding 180ms ease, border-radius 180ms ease, box-shadow 180ms ease, border-color 180ms ease",
        }}
      >

        <div style={{ display: header ? "block" : "none" }}>
          {header ? header : null}
        </div>
        {!hideActionBar ? (
          <div
            className={`${styles.ataGrid} ata-grid`}
            style={{
              gridTemplateColumns: ["1fr", showHeaderWorkflowActions && "auto", showSelectionControls && "auto"]
                .filter(Boolean)
                .join(" "),
              transition: "padding 180ms ease",
            }}
          >
            {/* Left */}
            <div className={styles.leftFlex}>
              {hasSelection ? <PillCount /> : null}

              <div className={styles.minWidthZero}>
                {hasSelection ? (
                  <div className={styles.selectedText} style={{ color: t.text }}>
                    {selectedRows.length} track{selectedRows.length !== 1 ? "s" : ""} selected
                  </div>
                ) : (
                  <div className={styles.defaultText} style={{ color: t.subtext }}>
                    {defaultLabel || "Select tracks to get started"}
                  </div>
                )}
              </div>
            </div>

            {/* Middle */}
            {showHeaderWorkflowActions ? (
              <div
                className={`${styles.middleActions} ata-actions`}
                style={{
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

                    {handleCoverWithTracks && (
                      <Btn
                        variant="primary"
                        title="Create Cover"
                        onClick={() => handleCoverWithTracks(getSelectedTracks())}
                        icon={
                          <SmallIcon>
                            <PsychologyIcon />
                          </SmallIcon>
                        }
                      >
                        Cover
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

                    {handleCoverWithTracks && (
                      <Btn
                        variant="primary"
                        title="Create Cover"
                        onClick={() => handleCoverWithTracks(getSelectedTracks())}
                        icon={
                          <SmallIcon>
                            <PsychologyIcon />
                          </SmallIcon>
                        }
                      >
                        Cover
                      </Btn>
                    )}
                  </>
                )}
              </div>
            ) : null}

            {/* Right */}
            {showSelectionControls ? (
              <div className={styles.rightFlex}>
                <Btn variant="outline" title="Select all" onClick={onSelectAll}>
                  Select All
                </Btn>

                {hasSelection ? (
                  <>
                    <Btn variant="outline" title="Clear selection" onClick={onClear}>
                      Clear
                    </Btn>

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
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* {children ? children : null} */}
      </div>
    </>
  );
};

export default AudioTableActions;
