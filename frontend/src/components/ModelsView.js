import React, { useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "./common/PageHeader";

// keep your icons (unchanged)
import {
  CloudDownload as DownloadIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  CloudQueue as CloudIcon,
  CloudOff as CloudOffIcon,
  Close as CloseIcon,
} from "@mui/icons-material";

/**
 * ModelsView (no MUI)
 * - True responsive grid: multiple cards per row
 * - Dark + Light theme support via `darkMode` boolean OR CSS variables fallback
 * - Sticky header + search toolbar
 * - Fixed pagination bar (bottom)
 *
 * Props:
 *  - isInferenceSelection, selectedTracks, onBack, onModelSelected (same)
 * Optional:
 *  - darkMode (boolean) -> recommended; if omitted we infer from prefers-color-scheme
 */
function ModelsView({
  isInferenceSelection = false,
  selectedTracks = [],
  onBack,
  onModelSelected,
  darkMode, // optional
}) {
  // ---- Theme tokens ----
  const isDark = useMemo(() => {
    if (typeof darkMode === "boolean") return darkMode;
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false;
  }, [darkMode]);

  const t = useMemo(() => {
    return {
      isDark,
      text: isDark ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.90)",
      subtext: isDark ? "rgba(255,255,255,0.62)" : "rgba(0,0,0,0.55)",
      hairline: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)",
      glassA: isDark ? "rgba(18,18,20,0.62)" : "rgba(255,255,255,0.72)",
      glassB: isDark ? "rgba(26,26,28,0.56)" : "rgba(248,248,250,0.78)",
      cardA: isDark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.86)",
      cardB: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.70)",
      hoverA: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.95)",
      hoverB: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.78)",
      shadow: isDark ? "0 18px 44px rgba(0,0,0,0.55)" : "0 18px 46px rgba(0,0,0,0.14)",
      shadowSoft: isDark ? "0 10px 24px rgba(0,0,0,0.42)" : "0 12px 26px rgba(0,0,0,0.12)",
      primary: isDark ? "rgba(10,132,255,1)" : "rgba(0,122,255,1)",
      primaryWash: isDark ? "rgba(10,132,255,0.20)" : "rgba(0,122,255,0.16)",
      primaryWash2: isDark ? "rgba(10,132,255,0.10)" : "rgba(0,122,255,0.08)",
      success: "rgba(52,199,89,1)",
      successWash: isDark ? "rgba(52,199,89,0.18)" : "rgba(52,199,89,0.14)",
      warning: "rgba(255,149,0,1)",
      danger: "rgba(255,59,48,1)",
      dangerWash: isDark ? "rgba(255,59,48,0.20)" : "rgba(255,59,48,0.14)",
      radiusLg: 22,
      radiusMd: 16,
      radiusSm: 12,
      maxW: 1180,
      topSafe: 16,
      headerH: 132, // sticky area height (header + toolbar); used for scroll padding
      bottomBarH: 76, // fixed pagination bar height
    };
  }, [isDark]);

  // ---- Data state (same logic) ----
  const [models, setModels] = useState([]);
  const [onlineResults, setOnlineResults] = useState([]);
  const [showOnline, setShowOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState(new Set());

  const [downloadingProgress, setDownloadingProgress] = useState({});
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [activeDownloadModel, setActiveDownloadModel] = useState(null);
  const [customModelName, setCustomModelName] = useState("");
  const [downloadError, setDownloadError] = useState("");

  const [checkpointDialogOpen, setCheckpointDialogOpen] = useState(false);
  const [targetInferenceModel, setTargetInferenceModel] = useState(null);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchModels = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/available-models");
      const data = await res.json();
      setModels(data.models || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (searchQuery.trim() && showOnline) {
        performOnlineSearch(currentPage, controller.signal);
      } else {
        setOnlineResults([]);
        setTotalPages(1);
      }
    }, 800);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, currentPage, showOnline]);

  const performOnlineSearch = async (page, signal) => {
    try {
      const res = await fetch(
        `/api/search-online-models?query=${encodeURIComponent(searchQuery)}&page=${page}`,
        { signal }
      );
      const data = await res.json();
      setOnlineResults(data.models || []);
      setTotalPages(data.total_pages || 1);
    } catch (err) {
      if (err.name !== "AbortError") console.error(err);
    }
  };

  const displayModels = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const local = models
      .filter((m) => m.name.toLowerCase().includes(q))
      .map((m) => ({ ...m, isOnline: false }));

    const online = showOnline
      ? onlineResults
          .filter(
            (om) => !models.some((lm) => lm.name.toLowerCase() === om.name.toLowerCase())
          )
          .map((m) => ({ ...m, isOnline: true }))
      : [];

    return [...local, ...online];
  }, [models, onlineResults, showOnline, searchQuery]);

  const handleCardClick = (model) => {
    if (model.isOnline) return;

    if (isInferenceSelection) {
      setTargetInferenceModel(model);
      setSelectedCheckpoint(model.bestCheckpoint || (model.checkpoints ? model.checkpoints[0] : null));
      setCheckpointDialogOpen(true);
    } else {
      setSelected((prev) => {
        const n = new Set(prev);
        n.has(model.name) ? n.delete(model.name) : n.add(model.name);
        return n;
      });
    }
  };

  const executeDownload = async () => {
    const name = customModelName.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
    const url = activeDownloadModel?.url;
    if (!name) return setDownloadError("Please enter a name.");
    if (!url) return;

    setDownloadDialogOpen(false);
    setDownloadingProgress((prev) => ({ ...prev, [url]: 0 }));

    try {
      const progressTimer = setInterval(() => {
        setDownloadingProgress((prev) => {
          const current = prev[url] ?? 0;
          if (current >= 95) return prev;
          return { ...prev, [url]: current + (100 - current) * 0.2 };
        });
      }, 1000);

      const responsedownload = await fetch("/api/download-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, modelName: activeDownloadModel.name, userQuery: name }),
      });

      clearInterval(progressTimer);

      if (responsedownload.ok) {
        setDownloadingProgress((prev) => {
          const n = { ...prev };
          delete n[url];
          return n;
        });
        await fetchModels();
      } else {
        setDownloadingProgress((prev) => {
          const n = { ...prev };
          delete n[url];
          return n;
        });
      }
    } catch (err) {
      setDownloadingProgress((prev) => {
        const n = { ...prev };
        delete n[url];
        return n;
      });
    }
  };

  // ---- UI primitives ----
  const Glass = ({ children, style, className }) => (
    <div
      className={className}
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

  const Hairline = ({ style }) => <div style={{ height: 1, background: t.hairline, ...style }} />;

  const Pill = ({ children, tone = "neutral", style }) => {
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

  const Btn = ({ children, onClick, variant = "secondary", disabled, style, type = "button" }) => {
    const v = {
      primary: { bg: `linear-gradient(180deg, rgba(10,132,255,0.95), rgba(10,132,255,0.78))`, fg: "white", bd: "rgba(10,132,255,0.45)" },
      secondary: { bg: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`, fg: t.text, bd: t.hairline },
      outline: { bg: "transparent", fg: t.text, bd: t.hairline },
      danger: { bg: `linear-gradient(180deg, rgba(255,59,48,0.95), rgba(255,59,48,0.78))`, fg: "white", bd: "rgba(255,59,48,0.45)" },
    }[variant];

    return (
      <button
        type={type}
        onClick={onClick}
        disabled={disabled}
        style={{
          borderRadius: 14,
          border: `1px solid ${v.bd}`,
          background: v.bg,
          color: v.fg,
          padding: "10px 12px",
          fontWeight: 800,
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

  const IconBtn = ({ onClick, title, children, disabled, style }) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        width: 40,
        height: 40,
        borderRadius: 999,
        border: `1px solid ${t.hairline}`,
        background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
        color: t.text,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        boxShadow: t.shadowSoft,
        ...style,
      }}
    >
      {children}
    </button>
  );

  const Input = ({ value, onChange, placeholder, leftIcon, rightNode, autoFocus }) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 44,
        padding: "0 12px",
        borderRadius: 16,
        border: `1px solid ${t.hairline}`,
        background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
        boxShadow: t.shadowSoft,
        minWidth: 260,
        flex: "1 1 360px",
      }}
    >
      <span style={{ display: "inline-flex", color: t.subtext }}>{leftIcon}</span>
      <input
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          outline: "none",
          color: t.text,
          fontSize: 14,
          fontWeight: 650,
        }}
      />
      {rightNode}
    </div>
  );

  const ProgressBar = ({ value }) => (
    <div style={{ height: 4, borderRadius: 999, background: t.isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)", overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, value || 0))}%`, background: t.primary, transition: "width 220ms ease" }} />
    </div>
  );

  const Modal = ({ open, onClose, title, children, footer }) => {
    if (!open) return null;
    return (
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 2000,
          background: t.isDark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.30)",
          display: "grid",
          placeItems: "center",
          padding: 16,
        }}
      >
        <Glass style={{ width: "100%", maxWidth: 440, padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontWeight: 950, letterSpacing: -0.3, color: t.text }}>{title}</div>
            <IconBtn onClick={onClose} title="Close" style={{ width: 36, height: 36 }}>
              <CloseIcon style={{ fontSize: 18 }} />
            </IconBtn>
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

  // ---- Toolbar actions ----
  const selectedCount = selected.size;
  const onSelectAll = () => setSelected(new Set(models.map((m) => m.name)));
  const onClear = () => setSelected(new Set());
  const onDelete = () => setDeleteOpen(true);

  // ---- Layout helpers ----
  const bottomBarRef = useRef(null);

  // ---- Loading view ----
  if (loading) {
    return (
      <div style={{ padding: "90px 16px", textAlign: "center", color: t.text }}>
        <div style={{ display: "inline-flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 999,
              border: `3px solid ${t.isDark ? "rgba(255,255,255,0.20)" : "rgba(0,0,0,0.18)"}`,
              borderTopColor: t.primary,
              animation: "spin 0.9s linear infinite",
            }}
          />
          <div style={{ color: t.subtext, fontWeight: 750 }}>Loading models...</div>
        </div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "0 16px" }}>
      <div
        style={{
          width: "100%",
          maxWidth: t.maxW,
          paddingTop: t.topSafe,
          paddingBottom: t.bottomBarH + 18, // make room for fixed pagination
        }}
      >
        {/* Sticky header area */}
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 50,
            paddingTop: t.topSafe,
            marginTop: -t.topSafe,
            background: "transparent",
          }}
        >
          <div style={{ paddingBottom: 10 }}>
          <Glass
            style={{
              padding: 14,
              marginBottom: 14,
            }}
          >
            <PageHeader
              title={isInferenceSelection ? "Select Model for Inference" : "TRAINED VOICE MODELS"}
              onBack={isInferenceSelection ? onBack : null}
            />
            </Glass>
          </div>

          <Glass
            style={{
              padding: 14,
              marginBottom: 14,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              {!isInferenceSelection && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Btn variant="outline" onClick={onSelectAll} style={{ height: 44, padding: "0 14px" }}>
                    Select All
                  </Btn>
                  <div
                    style={{
                      maxWidth: selectedCount > 0 ? 200 : 0,
                      opacity: selectedCount > 0 ? 1 : 0,
                      overflow: "hidden",
                      transition: "all 180ms ease",
                    }}
                  >
                    <Btn variant="outline" onClick={onClear} style={{ height: 44, padding: "0 14px" }}>
                      Clear
                    </Btn>
                  </div>
                </div>
              )}

              <Input
                value={searchQuery}
                onChange={(val) => {
                   setSearchQuery(val);
                   setCurrentPage(1);
                
                }}
                placeholder="Search local and online models..."
                leftIcon={<SearchIcon style={{ fontSize: 20 }} />}
                rightNode={
                  <IconBtn
                    title={showOnline ? "Online search enabled" : "Online search disabled"}
                    onClick={() => setShowOnline(!showOnline)}
                    style={{
                      width: 36,
                      height: 36,
                      boxShadow: "none",
                      borderColor: showOnline ? "rgba(10,132,255,0.45)" : t.hairline,
                      color: showOnline ? t.primary : t.subtext,
                    }}
                  >
                    {showOnline ? <CloudIcon style={{ fontSize: 19 }} /> : <CloudOffIcon style={{ fontSize: 19 }} />}
                  </IconBtn>
                }
              />

              {!isInferenceSelection && (
                <div style={{ position: "relative" }}>
                  <IconBtn
                    title="Delete selected"
                    onClick={onDelete}
                    disabled={selectedCount === 0}
                    style={{
                      borderColor: selectedCount > 0 ? "rgba(255,59,48,0.45)" : t.hairline,
                      background:
                        selectedCount > 0
                          ? `linear-gradient(180deg, rgba(255,59,48,0.95), rgba(255,59,48,0.78))`
                          : `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
                      color: selectedCount > 0 ? "white" : t.subtext,
                    }}
                  >
                    <DeleteIcon style={{ fontSize: 20 }} />
                  </IconBtn>

                  {selectedCount > 0 && (
                    <div
                      style={{
                        position: "absolute",
                        top: -6,
                        right: -6,
                        width: 22,
                        height: 22,
                        borderRadius: 999,
                        background: t.danger,
                        color: "white",
                        display: "grid",
                        placeItems: "center",
                        fontSize: 12,
                        fontWeight: 950,
                        border: `2px solid ${t.isDark ? "rgba(18,18,20,0.8)" : "rgba(255,255,255,0.85)"}`,
                        boxShadow: t.shadowSoft,
                      }}
                    >
                      {selectedCount}
                    </div>
                  )}
                </div>
              )}
            </div>
          </Glass>
        </div>

        {/* True grid: multiple per row */}
        <div className="vf-grid">
          {displayModels.map((model, i) => {
            const isSelected = selected.has(model.name);
            const downloadPct = downloadingProgress[model.url];

            const statusTone = isInferenceSelection
              ? "primary"
              : model.status === "completed"
              ? "success"
              : "warning";

            const statusLabel = isInferenceSelection
              ? "SELECT MODEL"
              : model.status?.toUpperCase() || "COMPLETED";

            return (
              <div
                key={model.url || model.name || i}
                className="vf-card"
                role="button"
                tabIndex={0}
                onClick={() => handleCardClick(model)}
                onKeyDown={(e) => e.key === "Enter" && handleCardClick(model)}
                style={{
                  borderRadius: t.radiusLg,
                  border: `1px solid ${isSelected ? "rgba(10,132,255,0.45)" : t.hairline}`,
                  background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
                  backdropFilter: "blur(18px) saturate(140%)",
                  WebkitBackdropFilter: "blur(18px) saturate(140%)",
                  boxShadow: t.shadowSoft,
                  padding: 16,
                  cursor: model.isOnline ? "default" : "pointer",
                  position: "relative",
                  minHeight: 204,
                  display: "flex",
                  flexDirection: "column",
                  transition: "transform 160ms ease, box-shadow 160ms ease, background 160ms ease",
                  outline: "none",
                }}
              >
                {/* Progress overlay */}
                {downloadPct !== undefined && (
                  <div style={{ position: "absolute", top: 10, left: 12, right: 12 }}>
                    <ProgressBar value={downloadPct} />
                  </div>
                )}

                {/* Online badge */}
                {model.isOnline && (
                  <div style={{ position: "absolute", top: 12, right: 12 }}>
                    <Pill tone="primary" style={{ fontSize: 10, padding: "5px 9px" }}>
                      ONLINE
                    </Pill>
                  </div>
                )}

                {/* Title */}
                <div style={{ paddingRight: model.isOnline ? 64 : 0 }}>
                  <div
                    style={{
                      color: t.text,
                      fontWeight: 950,
                      letterSpacing: -0.35,
                      fontSize: 16,
                      lineHeight: 1.15,
                      marginBottom: 6,
                    }}
                    title={model.name}
                  >
                    {model.name}
                  </div>

                  <div style={{ color: t.subtext, fontSize: 12, fontWeight: 700 }}>
                    {model.isOnline
                      ? "From Cloud Search"
                      : model.created
                      ? new Date(model.created).toLocaleDateString()
                      : "Local"}
                  </div>
                </div>

                {/* Stats */}
                <div style={{ marginTop: "auto" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12, marginBottom: 12 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {model.checkpoints?.length > 0 && <Pill tone="primary">{model.checkpoints.length} CP</Pill>}
                      {model.sampleRate && <Pill tone="neutral">{model.sampleRate}hz</Pill>}
                    </div>
                    <Pill tone="neutral">{model.size_mb || "N/A"} MB</Pill>
                  </div>

                  {!model.isOnline && model.checkpoints?.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ color: t.subtext, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
                        Latest Checkpoints:
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {model.checkpoints.slice(0, 3).map((cp, idx) => (
                          <Pill
                            key={idx}
                            tone="neutral"
                            style={{
                              background: t.isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
                            }}
                          >
                            {cp.epochs}e
                          </Pill>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action area */}
                  {model.isOnline ? (
                    <Btn
                      variant="primary"
                      disabled={downloadPct !== undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveDownloadModel(model);
                        setCustomModelName("");
                        setDownloadError("");
                        setDownloadDialogOpen(true);
                      }}
                      style={{ width: "100%", height: 44 }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        {downloadPct !== undefined ? (
                          <>
                            <span
                              style={{
                                width: 14,
                                height: 14,
                                borderRadius: 999,
                                border: "2px solid rgba(255,255,255,0.35)",
                                borderTopColor: "white",
                                animation: "spin 0.9s linear infinite",
                              }}
                            />
                            Downloading {Math.round(downloadPct)}%
                          </>
                        ) : (
                          <>
                            <DownloadIcon style={{ fontSize: 18 }} />
                            Download
                          </>
                        )}
                      </span>
                    </Btn>
                  ) : (
                    <div style={{ display: "flex", justifyContent: "flex-start" }}>
                      <Pill
                        tone={statusTone}
                        style={{
                          padding: "10px 14px",
                          borderRadius: 14,
                        }}
                      >
                        {statusLabel}
                      </Pill>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Fixed pagination bar (bottom) */}
        {showOnline && totalPages > 1 && (
          <div
            ref={bottomBarRef}
            style={{
              position: "fixed",
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 60,
              padding: "10px 12px",
              display: "flex",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <Glass
              style={{
                width: "min(720px, calc(100% - 24px))",
                padding: 12,
                pointerEvents: "auto",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <Btn
                  variant="outline"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  style={{ minWidth: 110 }}
                >
                  Prev
                </Btn>

                <Pill tone="neutral" style={{ padding: "10px 12px", fontSize: 12 }}>
                  Page {currentPage} / {totalPages}
                </Pill>

                <Btn
                  variant="outline"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  style={{ minWidth: 110 }}
                >
                  Next
                </Btn>
              </div>
            </Glass>
          </div>
        )}

        {/* Checkpoint modal */}
        <Modal
          open={checkpointDialogOpen}
          onClose={() => setCheckpointDialogOpen(false)}
          title="Choose Checkpoint"
          footer={
            <>
              <Btn variant="outline" onClick={() => setCheckpointDialogOpen(false)}>
                Cancel
              </Btn>
              <Btn
                variant="primary"
                disabled={!selectedCheckpoint}
                onClick={() => onModelSelected({ ...targetInferenceModel, selectedCheckpoint }, selectedTracks)}
              >
                Use for Inference
              </Btn>
            </>
          }
        >
          <div style={{ color: t.subtext, fontSize: 13, fontWeight: 700, marginBottom: 14 }}>
            Select training epoch for{" "}
            <span style={{ color: t.text, fontWeight: 950 }}>{targetInferenceModel?.name}</span>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {targetInferenceModel?.checkpoints?.map((cp) => {
              const active = selectedCheckpoint?.filename === cp.filename;
              return (
                <button
                  key={cp.filename}
                  type="button"
                  onClick={() => setSelectedCheckpoint(cp)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    borderRadius: t.radiusMd,
                    border: `1px solid ${active ? "rgba(10,132,255,0.50)" : t.hairline}`,
                    background: active
                      ? `linear-gradient(135deg, ${t.primaryWash}, ${t.primaryWash2})`
                      : `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
                    padding: 12,
                    cursor: "pointer",
                    color: t.text,
                    boxShadow: active ? t.shadowSoft : "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontWeight: 950, letterSpacing: -0.2, fontSize: 14 }}>
                      {cp.epochs} Epochs
                    </div>
                    {cp.isBest && (
                      <Pill tone="success" style={{ fontSize: 10, padding: "5px 9px" }}>
                        BEST
                      </Pill>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </Modal>

        {/* Download modal */}
        <Modal
          open={downloadDialogOpen}
          onClose={() => setDownloadDialogOpen(false)}
          title="Name your model"
          footer={
            <>
              <Btn variant="outline" onClick={() => setDownloadDialogOpen(false)}>
                Cancel
              </Btn>
              <Btn variant="primary" onClick={executeDownload} style={{ padding: "10px 18px" }}>
                Confirm
              </Btn>
            </>
          }
        >
          <div style={{ display: "grid", gap: 10 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                height: 44,
                padding: "0 12px",
                borderRadius: 16,
                border: `1px solid ${downloadError ? "rgba(255,59,48,0.55)" : t.hairline}`,
                background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
                boxShadow: t.shadowSoft,
              }}
            >
              <span style={{ fontWeight: 950, color: t.subtext }}>Aa</span>
              <input
                autoFocus
                value={customModelName}
                onChange={(e) => {
                  setCustomModelName(e.target.value);
                  setDownloadError("");
                }}
                placeholder="e.g. My_Voice_V1"
                style={{
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: t.text,
                  fontSize: 14,
                  fontWeight: 650,
                }}
              />
            </div>

            {downloadError && (
              <div style={{ color: t.danger, fontWeight: 850, fontSize: 12 }}>{downloadError}</div>
            )}
          </div>
        </Modal>

        {/* Delete modal */}
        <Modal
          open={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          title="Confirm Deletion"
          footer={
            <>
              <Btn variant="outline" onClick={() => setDeleteOpen(false)}>
                Cancel
              </Btn>
              <Btn
                variant="danger"
                onClick={async () => {
                  await Promise.all(
                    Array.from(selected).map((n) =>
                      fetch(`/api/models/${encodeURIComponent(n)}`, { method: "DELETE" })
                    )
                  );
                  setSelected(new Set());
                  setDeleteOpen(false);
                  fetchModels();
                }}
              >
                Delete
              </Btn>
            </>
          }
        >
          <div style={{ color: t.text, fontWeight: 800 }}>
            Delete {selected.size} models?{" "}
            <span style={{ color: t.subtext, fontWeight: 700 }}>This cannot be undone.</span>
          </div>
        </Modal>

        <style>{`
          @keyframes spin{to{transform:rotate(360deg)}}

          /* True grid (multiple per row) */
          .vf-grid{
            display:grid;
            grid-template-columns: repeat(12, minmax(0, 1fr));
            gap:14px;
          }
          .vf-card{
            grid-column: span 12;
          }
          @media (min-width: 600px){
            .vf-card{ grid-column: span 6; }
          }
          @media (min-width: 900px){
            .vf-card{ grid-column: span 4; }
          }
          @media (min-width: 1200px){
            .vf-card{ grid-column: span 3; }
          }

          /* Hover + focus */
          .vf-card:hover{
            transform: translateY(-2px);
            box-shadow: ${t.shadow};
            background: linear-gradient(180deg, ${t.hoverA}, ${t.hoverB});
          }
          .vf-card:focus-visible{
            outline: 2px solid rgba(10,132,255,0.55);
            outline-offset: 2px;
          }
        `}</style>
      </div>
    </div>
  );
}

export default ModelsView;
