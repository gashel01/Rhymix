import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "./common/PageHeader";


// keep your icons (unchanged)
import {
  CloudDownload as CloudDownloadIcon,
  CloudOff as CloudOffIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  Close as CloseIcon,
  Mic as MicIcon,
  Layers as LayersIcon,
  Public as PublicIcon,
} from "@mui/icons-material";
import {Theme} from "./Homeview/Theme.js"
import IconBtn from "./Homeview/IconBtn.js"
import {Modal} from "./Homeview/Modal.js"
import Btn from "./Homeview/Btn.js"
import {Pill} from "./ModelView/Pill.js"
import {
  describeDownload,
  describeTraining,
  downloadPhaseLabel,
  filterModels,
  formatSampleRate,
  formatSelectionPreview,
  getCardGradient,
  getInstalledIds,
  getSelectableModels,
  getSelectionNames,
  mergeModelCatalog,
  normaliseModelName,
  normalizeId,
  resolveBackTarget,
  trainingPhaseLabel,
} from "./modelsCatalog";

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
  navContext,
  onNavigate,
  onResumeTraining,
  darkMode, // optional
}) {
  // ---- Theme tokens ----
  const { t } = Theme({ darkMode });
  const [ctx, setCtx] = useState(navContext || null);

  useEffect(() => {
    if (navContext) setCtx(navContext);
  }, [navContext]);

  // ---- Data state (same logic) ----
  const [localModels, setLocalModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [onlineResults, setOnlineResults] = useState([]);
  const [onlinePage, setOnlinePage] = useState(1);
  const [onlineTotalPages, setOnlineTotalPages] = useState(1);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isOnlineSearchEnabled, setIsOnlineSearchEnabled] = useState(true);
  const [selected, setSelected] = useState(new Set());

  const [downloadJobs, setDownloadJobs] = useState({});
  const [trainingJobs, setTrainingJobs] = useState([]);
  const [cancellingJobId, setCancellingJobId] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [activeDownloadModel, setActiveDownloadModel] = useState(null);
  const [customModelName, setCustomModelName] = useState("");
  const [downloadError, setDownloadError] = useState("");

  const [checkpointDialogOpen, setCheckpointDialogOpen] = useState(false);
  const [targetInferenceModel, setTargetInferenceModel] = useState(null);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState(null);

  const searchAbortRef = useRef(null);
  const dropdownRef = useRef(null);
  const inputRef = useRef(null);
  useEffect(() => {
    fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchModels = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/available-models");
      const data = await res.json();
      setLocalModels(data.models || []);
    } finally {
      setLoading(false);
    }
  }, []);

  // A training run outlives the view that started it, so the list owns showing
  // it. The backend is the source of truth: this survives a page reload, which
  // matters when a run takes tens of minutes.
  const fetchTrainingJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/training-jobs");
      if (!res.ok) return;
      const data = await res.json();
      setTrainingJobs(data.jobs || []);
    } catch {
      // a failed poll just means no refresh this tick
    }
  }, []);

  useEffect(() => {
    fetchTrainingJobs();
  }, [fetchTrainingJobs]);

  useEffect(() => {
    const active = trainingJobs.some(
      (job) => job.status && !["completed", "failed", "cancelled", "interrupted"].includes(job.status)
    );
    if (!active) return;
    const interval = setInterval(fetchTrainingJobs, 2000);
    return () => clearInterval(interval);
  }, [trainingJobs, fetchTrainingJobs]);

  // Bring a finished run into the library without waiting for a manual refresh.
  const finishedTrainingCount = trainingJobs.filter((job) => job.status === "completed").length;
  useEffect(() => {
    if (finishedTrainingCount > 0) fetchModels();
  }, [finishedTrainingCount, fetchModels]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 320);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const performOnlineSearch = useCallback(async (query, page, append = false) => {
    if (!query) return;
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
    }
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setIsSearching(true);
    setSearchError("");
    try {
      const res = await fetch(
        `/api/search-online-models?query=${encodeURIComponent(query)}&page=${page}`,
        { signal: controller.signal }
      );
      const data = await res.json();
      const nextModels = data.models || [];
      setOnlineResults((prev) => (append ? [...prev, ...nextModels] : nextModels));
      setOnlineTotalPages(data.total_pages || 1);
    } catch (err) {
      if (err.name !== "AbortError") {
        setSearchError(err.message || "Search failed");
      }
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!debouncedQuery) {
      setOnlineResults([]);
      setOnlinePage(1);
      setOnlineTotalPages(1);
      setSearchError("");
      return;
    }
    if (!isOnlineSearchEnabled) {
      setOnlineResults([]);
      setOnlinePage(1);
      setOnlineTotalPages(1);
      setSearchError("");
      setIsSearching(false);
      return;
    }
    setOnlinePage(1);
    performOnlineSearch(debouncedQuery, 1, false);
  }, [debouncedQuery, performOnlineSearch, isOnlineSearchEnabled]);

  useEffect(() => {
    const onPointerDown = (event) => {
      const el = event.target;
      const dropdownEl = dropdownRef.current;
      const inputEl = inputRef.current;
      const clickedInDropdown = dropdownEl && dropdownEl.contains(el);
      const clickedInInput = inputEl && inputEl.contains(el);
      if (!clickedInDropdown && !clickedInInput) {
        setIsDropdownOpen(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setIsDropdownOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const toggleOnlineSearch = useCallback(() => {
    setIsOnlineSearchEnabled((prev) => {
      const next = !prev;
      if (!next) {
        setIsDropdownOpen(false);
        setIsSearching(false);
        setOnlineResults([]);
        setOnlinePage(1);
        setOnlineTotalPages(1);
        setSearchError("");
      } else if (searchQuery.trim()) {
        setIsDropdownOpen(true);
      }
      return next;
    });
  }, [searchQuery]);

  const selectionNames = useMemo(() => getSelectionNames(selectedTracks), [selectedTracks]);
  const selectionPreview = useMemo(() => formatSelectionPreview(selectionNames), [selectionNames]);

  const handleBack = useCallback(() => {
    const target = resolveBackTarget(ctx?.source);
    if (target && onNavigate) {
      onNavigate(target);
      return;
    }
    onBack?.();
  }, [ctx?.source, onBack, onNavigate]);

  const installedIds = useMemo(() => getInstalledIds(localModels), [localModels]);

  const localModelsMerged = useMemo(
    () => mergeModelCatalog({ localModels, downloadJobs, trainingJobs }),
    [downloadJobs, localModels, trainingJobs]
  );

  const filteredLocalModels = useMemo(
    () => filterModels(localModelsMerged, searchQuery),
    [localModelsMerged, searchQuery]
  );

  const selectableLocalModels = useMemo(
    () => getSelectableModels(filteredLocalModels),
    [filteredLocalModels]
  );

  useEffect(() => {
    const pendingJobs = Object.values(downloadJobs).filter(
      (job) => job.status && !["completed", "failed"].includes(job.status)
    );
    if (!pendingJobs.length) return;
    const interval = setInterval(async () => {
      await Promise.all(
        pendingJobs.map(async (job) => {
          try {
            const res = await fetch(`/api/models/download/status/${encodeURIComponent(job.jobId)}`);
            if (!res.ok) return;
            const data = await res.json();
            setDownloadJobs((prev) => ({
              ...prev,
              [job.jobId]: {
                ...prev[job.jobId],
                ...data,
              },
            }));
            if (data.status === "completed") {
              fetchModels();
            }
          } catch (err) {
            // ignore polling errors
          }
        })
      );
      // 1s rather than 2s: a progress bar that only moves every other second
      // reads as stalled. The endpoint is a local dict lookup, so it's cheap.
    }, 1000);
    return () => clearInterval(interval);
  }, [downloadJobs, fetchModels]);

  const handleCancelTraining = useCallback(
    async (model) => {
      const jobId = model?.trainingJobId;
      if (!jobId || cancellingJobId) return;
      setCancellingJobId(jobId);
      try {
        await fetch(`/api/training-jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
      } catch {
        // the next poll reports whatever actually happened
      } finally {
        setCancellingJobId(null);
        fetchTrainingJobs();
        fetchModels();
      }
    },
    [cancellingJobId, fetchTrainingJobs, fetchModels]
  );

  const handleCardClick = (model) => {
    if (model.isOnline) return;
    // A run in progress reopens where it is, instead of being a dead card.
    if (model.status === "training" && model.trainingJobId) {
      onResumeTraining?.(model.trainingJobId);
      return;
    }
    if (model.status && ["downloading", "failed"].includes(model.status)) return;

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

    try {
      const response = await fetch("/api/download-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          modelName: activeDownloadModel.name,
          userQuery: name,
          modelId: activeDownloadModel.modelId,
          files: activeDownloadModel.files || {},
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setDownloadError(data.error || "Download failed");
        return;
      }

      const jobId = data.jobId;
      const modelId = data.modelId || name;
      setDownloadJobs((prev) => ({
        ...prev,
        [jobId]: {
          jobId,
          modelId,
          modelName: data.modelName || activeDownloadModel.name || name,
          status: data.status || "downloading",
          progress: data.progress ?? 0,
          started_at: data.started_at || new Date().toISOString(),
          error: null,
        },
      }));
    } catch (err) {
      setDownloadError(err.message || "Download failed");
    }
  };

  // ---- UI primitives ----
  
  
  
  

  const ProgressBar = ({ value }) => (
    <div style={{ height: 4, borderRadius: 999, background: t.isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)", overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, value || 0))}%`, background: t.primary, transition: "width 220ms ease" }} />
    </div>
  );

  
  // ---- Toolbar actions ----
  const selectedCount = selected.size;
  const onSelectAll = () => setSelected(new Set(selectableLocalModels.map((m) => m.name)));
  const onClear = () => setSelected(new Set());
  const onDelete = () => setDeleteOpen(true);

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



  // ---- Layout helpers ----

  
  return (
   <>
        <div ref={sentinelRef} height={1}> </div>
        {/* Sticky header area */}
        <div
       
         style={{
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",

          // ✅ TRANSITION between “floating card” and “stuck bar”
          padding: isStuck ? "16px 24px 20px" : "32px 32px 24px",
          borderRadius: isStuck ? 0 : t.radiusLg,
          borderBottom: `1px solid ${t.hairline}`,
          margin: isStuck ? 0 : "24px 24px 24px 24px",
          background: `linear-gradient(180deg, ${t.glassA}, ${t.glassB})`,
          position: "sticky",
          top: 0,
          zIndex: 1000,
          boxShadow: isStuck ? "0 4px 20px rgba(0,0,0,0.15)" : t.shadow,
          overflow: "visible",

          // ✅ smooth animation
          transition:
            "padding 180ms ease, margin 180ms ease, border-radius 180ms ease, box-shadow 180ms ease, border-color 180ms ease",
        }}
        >
          {/* Row 1: Title + Import */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 }}>
            <div>
              {isInferenceSelection ? (
                <PageHeader title="Select Model for Inference" onBack={handleBack} />
              ) : (
                <h1 style={{ fontSize: 22, fontWeight: 650, letterSpacing: "-0.02em", color: t.text, margin: 0, lineHeight: 1.2 }}>
                  Trained voice models
                </h1>
              )}
            </div>
            {!isInferenceSelection && (
              <button
                type="button"
                onClick={() => inputRef.current?.focus()}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 20px",
                  borderRadius: 12,
                  border: "none",
                  background: t.isDark ? "#fff" : t.primary,
                  color: t.isDark ? "#000" : "#fff",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  boxShadow: t.isDark ? "0 0 20px rgba(255,255,255,0.2)" : "0 4px 14px rgba(0,122,255,0.35)",
                }}
              >
                <CloudDownloadIcon style={{ fontSize: 18 }} /> Import Model
              </button>
            )}
          </div>

          {isInferenceSelection && (
            <div style={{ marginBottom: 20, padding: 16, borderRadius: 12, background: t.isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)", border: `1px solid ${t.hairline}` }}>
              <div style={{ fontWeight: 900, color: t.text, marginBottom: 8 }}>Selection Summary</div>
              {selectionNames.length === 0 ? (
                <div style={{ color: t.subtext, fontSize: 13, fontWeight: 650, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span>No selection found. Go back to select tracks.</span>
                  <Btn  t={t} variant="outline" onClick={handleBack} style={{ height: 32, padding: "0 10px" }}>
                    Go Back
                  </Btn>
                </div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <Pill t={t} tone="primary">{selectionNames.length} track{selectionNames.length !== 1 ? "s" : ""}</Pill>
                  <div style={{ color: t.subtext, fontSize: 12, fontWeight: 700 }}>{selectionPreview}</div>
                  {ctx?.selectedModelName && (
                    <Pill t={t} tone="success">Model: {ctx.selectedModelName}</Pill>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Unified control strip - search omnibar + actions */}
          <div
            style={{
              padding: 8,
              borderRadius: 16,
              border: `1px solid ${t.hairline}`,
              background: t.isDark ? "rgba(28,28,33,0.8)" : "rgba(255,255,255,0.9)",
              boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
                <div style={{ position: "relative", flex: "1 1 280px", minWidth: 0 }} ref={dropdownRef}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: `1px solid ${(isSearchFocused || isDropdownOpen) ? (t.isDark ? "rgba(255,255,255,0.2)" : t.primaryWash) : t.hairline}`,
                    background: (isSearchFocused || isDropdownOpen) ? (t.isDark ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.04)") : (t.isDark ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.03)"),
                    transition: "border-color 180ms, background 180ms",
                  }}
                >
                  <SearchIcon style={{ fontSize: 18, color: t.subtext }} />
                  <input
                    ref={inputRef}
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setIsDropdownOpen(true); }}
                    onFocus={() => { setIsSearchFocused(true); setIsDropdownOpen(true); }}
                    onBlur={() => setTimeout(() => setIsSearchFocused(false), 180)}
                    placeholder="Search your library or the community..."
                    style={{
                      flex: 1,
                      background: "transparent",
                      border: "none",
                      outline: "none",
                      color: t.text,
                      fontSize: 14,
                      fontWeight: 600,
                      minWidth: 0,
                    }}
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      onMouseDown={(e) => e.preventDefault()}
                      style={{ padding: 4, border: "none", background: "transparent", cursor: "pointer", color: t.subtext, display: "flex" }}
                    >
                      <CloseIcon style={{ fontSize: 16 }} />
                    </button>
                  )}
                  <button
                    type="button"
                    title={isOnlineSearchEnabled ? "Disable online search" : "Enable online search"}
                    onClick={(e) => { e.preventDefault(); toggleOnlineSearch(); }}
                    onMouseDown={(e) => e.preventDefault()}
                    style={{ padding: "4px 6px", border: "none", background: "transparent", cursor: "pointer", display: "flex" }}
                  >
                    {isOnlineSearchEnabled ? (
                      <CloudDownloadIcon style={{ fontSize: 18, color: t.primary }} />
                    ) : (
                      <CloudOffIcon style={{ fontSize: 18, color: t.subtext }} />
                    )}
                  </button>
                </div>

                {isDropdownOpen && (
                  <div
                    onMouseDown={(e) => e.preventDefault()}
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      marginTop: 12,
                      borderRadius: 16,
                      border: `1px solid ${t.hairline}`,
                      boxShadow: t.isDark ? "0 20px 50px rgba(0,0,0,0.5)" : "0 20px 40px rgba(0,0,0,0.12)",
                      background: t.isDark ? "rgba(28,28,33,0.97)" : "rgba(255,255,255,0.98)",
                      backdropFilter: "blur(20px)",
                      WebkitBackdropFilter: "blur(20px)",
                      maxHeight: "60vh",
                      overflow: "hidden",
                      display: "flex",
                      flexDirection: "column",
                      zIndex: 50,
                    }}
                  >
                    <div style={{ flex: 1, overflowY: "auto", maxHeight: "50vh" }}>
                      {/* Section: In Your Library */}
                      {filteredLocalModels.length > 0 && (
                        <div style={{ padding: 12, borderBottom: `1px solid ${t.hairline}` }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, paddingLeft: 8 }}>
                            <LayersIcon style={{ fontSize: 14, color: t.subtext }} />
                            <span style={{ fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.15em", color: t.subtext }}>In Your Library</span>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {filteredLocalModels.slice(0, 8).map((m, idx) => (
                              <div
                                key={m.modelId || m.name || idx}
                                onClick={() => { setIsDropdownOpen(false); handleCardClick(m); }}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  padding: "10px 12px",
                                  borderRadius: 12,
                                  cursor: m.status === "downloading" ? "default" : "pointer",
                                  background: "transparent",
                                }}
                                onMouseEnter={(e) => { if (m.status !== "downloading") e.currentTarget.style.background = t.isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                  <div style={{ width: 32, height: 32, borderRadius: 8, background: getCardGradient(idx), display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    <MicIcon style={{ fontSize: 14, color: "#fff" }} />
                                  </div>
                                  <span style={{ fontSize: 14, fontWeight: 700, color: t.text }}>{normaliseModelName(m.name)}</span>
                                </div>
                                <span style={{ fontSize: 10, fontWeight: 700, padding: "4px 8px", borderRadius: 8, background: t.isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)", color: t.subtext }}>Loaded</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Section: Community Discover */}
                      <div style={{ padding: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, paddingLeft: 8 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <PublicIcon style={{ fontSize: 14, color: t.primary }} />
                            <span style={{ fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.15em", color: t.primary }}>Community Discover</span>
                          </div>
                          {isSearching && <span style={{ width: 14, height: 14, border: `2px solid ${t.primary}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />}
                        </div>
                        {!debouncedQuery && (
                          <div style={{ padding: "12px 16px", color: t.subtext, fontSize: 12, fontWeight: 700 }}>Start typing to search online models.</div>
                        )}
                        {debouncedQuery && !isOnlineSearchEnabled && (
                          <div style={{ padding: "12px 16px", color: t.subtext, fontSize: 12, fontWeight: 700 }}>Online search is disabled. Click the cloud icon to enable.</div>
                        )}
                        {debouncedQuery && isOnlineSearchEnabled && searchError && (
                          <div style={{ padding: "12px 16px", color: t.danger, fontSize: 12, fontWeight: 700 }}>{searchError}</div>
                        )}
                        {debouncedQuery && isOnlineSearchEnabled && !isSearching && !searchError && onlineResults.length === 0 && (
                          <div style={{ padding: "12px 16px", color: t.subtext, fontSize: 12, fontWeight: 700 }}>No results found.</div>
                        )}
                        {debouncedQuery && isOnlineSearchEnabled && !isSearching && (
                          <>
                            {onlineResults.map((model) => {
                          const modelId = model.modelId || model.name;
                          const normalized = normalizeId(modelId);
                          const isInstalled = installedIds.has(normalized);
                          const job = Object.values(downloadJobs).find(
                            (j) => normalizeId(j.modelId || j.modelName) === normalized
                          );
                          const isDownloading = job && job.status !== "completed" && job.status !== "failed";

                          return (
                            <div
                              key={modelId}
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 12,
                                padding: 12,
                                borderRadius: 12,
                                background: "transparent",
                                marginBottom: 4,
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = t.isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                            >
                              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <h4 style={{ color: t.text, fontWeight: 700, fontSize: 13, margin: 0, marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {model.name}
                                  </h4>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                                    {model.author && (
                                      <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: t.isDark ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0.06)", border: `1px solid ${t.hairline}`, color: t.subtext }}>
                                        {model.author}
                                      </span>
                                    )}
                                    {model.size_mb && <span style={{ fontSize: 10, fontFamily: "monospace", fontWeight: 600, color: t.subtext }}>{model.size_mb} MB</span>}
                                    {Array.isArray(model.tags) && model.tags.map((tag) => (
                                      <span key={tag} style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", padding: "2px 6px", borderRadius: 4, background: t.primaryWash, color: t.primary }}>{tag}</span>
                                    ))}
                                    {isInstalled && <Pill t={t} tone="success">Installed</Pill>}
                                    {isDownloading && <Pill t={t} tone="warning">Downloading</Pill>}
                                  </div>
                                </div>
                                <Btn
                                  t={t}
                                  variant="primary"
                                  disabled={isInstalled || isDownloading}
                                  onClick={() => {
                                    setActiveDownloadModel(model);
                                    setCustomModelName("");
                                    setDownloadError("");
                                    setDownloadDialogOpen(true);
                                  }}
                                  style={{ height: 36, padding: "0 12px", flexShrink: 0 }}
                                >
                                  {isInstalled ? "Installed" : "Download"}
                                </Btn>
                              </div>
                            </div>
                          );
                        })}
                          </>
                        )}
                      </div>

                    {debouncedQuery && isOnlineSearchEnabled && onlineTotalPages > onlinePage && (
                      <button
                        type="button"
                        onClick={() => {
                          const nextPage = onlinePage + 1;
                          setOnlinePage(nextPage);
                          performOnlineSearch(debouncedQuery, nextPage, true);
                        }}
                        style={{
                          width: "100%",
                          padding: "12px 16px",
                          border: "none",
                          borderTop: `1px solid ${t.hairline}`,
                          background: t.isDark ? "rgba(24,24,30,1)" : "rgba(248,250,252,1)",
                          color: t.subtext,
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.15em",
                          cursor: "pointer",
                          transition: "color 160ms, background 160ms",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = t.text; e.currentTarget.style.background = t.isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = t.subtext; e.currentTarget.style.background = t.isDark ? "rgba(24,24,30,1)" : "rgba(248,250,252,1)"; }}
                      >
                        Load more results
                      </button>
                    )}
                  </div>
                </div>
                )}
                </div>

                {!isInferenceSelection && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Btn t={t} variant="outline" onClick={onSelectAll} style={{ height: 40, padding: "0 16px", fontSize: 12, fontWeight: 700 }}>
                      Select All
                    </Btn>
                    <div style={{ maxWidth: selectedCount > 0 ? 120 : 0, opacity: selectedCount > 0 ? 1 : 0, overflow: "hidden", transition: "all 180ms ease" }}>
                      <Btn t={t} variant="outline" onClick={onClear} style={{ height: 40, padding: "0 14px" }}>Clear</Btn>
                    </div>
                    <div style={{ width: 1, height: 20, background: t.hairline }} />
                    <div style={{ position: "relative" }}>
                  <IconBtn
                    t={t}
                    title="Delete selected"
                    onClick={onDelete}
                    disabled={selectedCount === 0}
                    style={{
                      borderColor: selectedCount > 0 ? "rgba(255,69,58,0.28)" : t.hairline,
                      background:
                        selectedCount > 0
                          ? `transparent`
                          : `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
                      color: selectedCount > 0 ? "rgba(255,105,97,0.92)" : t.subtext,
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
                        background: "red",
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
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* True grid: multiple per row */}

        {loading ? (



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
        ):
        (
          <div className="vf-grid" style={{ padding: "0 24px" }}>
            {filteredLocalModels.map((model, i) => {
              const isSelected = selected.has(model.name);
              const downloadPct = typeof model.downloadProgress === "number" ? model.downloadProgress : null;
              const trainingPct = typeof model.trainingProgress === "number" ? model.trainingProgress : null;
  
              return (
                <div
                  key={model.modelId || model.name || i}
                  className="vf-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => handleCardClick(model)}
                  onKeyDown={(e) => e.key === "Enter" && handleCardClick(model)}
                  style={{
                    borderRadius: t.radiusLg,
                    border: `1px solid ${isSelected ? "rgba(10,132,255,0.45)" : t.hairline}`,
                    background: t.isDark ? "#16161a" : t.cardB,
                    boxShadow: t.shadowSoft,
                    padding: 0,
                    cursor: model.status === "downloading" ? "default" : "pointer",
                    position: "relative",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    transition: "transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease",
                    outline: "none",
                  }}
                >
                  {/* Gradient header */}
                  <div
                    style={{
                      height: 96,
                      background: getCardGradient(i),
                      position: "relative",
                      padding: 16,
                      display: "flex",
                      alignItems: "flex-end",
                      justifyContent: "space-between",
                    }}
                  >
                    <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.2)", pointerEvents: "none" }} />
                    <div
                      style={{
                        position: "relative",
                        zIndex: 1,
                        width: 48,
                        height: 48,
                        borderRadius: 12,
                        background: "rgba(255,255,255,0.2)",
                        backdropFilter: "blur(8px)",
                        border: "1px solid rgba(255,255,255,0.2)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <MicIcon style={{ color: "#fff", fontSize: 24 }} />
                    </div>
                    {model.status === "downloading" && (
                      <span
                        style={{
                          position: "relative",
                          zIndex: 1,
                          padding: "4px 8px",
                          background: "#f59e0b",
                          color: "#000",
                          fontSize: 10,
                          fontWeight: 800,
                          textTransform: "uppercase",
                          letterSpacing: "0.02em",
                          borderRadius: 8,
                          whiteSpace: "nowrap",
                          animation: "pulse 1.5s ease-in-out infinite",
                        }}
                      >
                        {describeDownload(model.downloadPhase, downloadPct)}
                      </span>
                    )}
                    {model.status === "training" && (
                      <span
                        style={{
                          position: "relative",
                          zIndex: 1,
                          padding: "4px 8px",
                          background: "#22c55e",
                          color: "#000",
                          fontSize: 10,
                          fontWeight: 800,
                          textTransform: "uppercase",
                          letterSpacing: "0.02em",
                          borderRadius: 8,
                          whiteSpace: "nowrap",
                          animation: "pulse 1.5s ease-in-out infinite",
                        }}
                      >
                        {describeTraining(model.trainingPhase, trainingPct)}
                      </span>
                    )}
                    {(model.status === "failed" || model.status === "error") && (
                      <span
                        style={{
                          position: "relative",
                          zIndex: 1,
                          padding: "4px 8px",
                          background: "rgba(239,68,68,0.9)",
                          color: "#fff",
                          fontSize: 10,
                          fontWeight: 800,
                          textTransform: "uppercase",
                          letterSpacing: "0.02em",
                          borderRadius: 8,
                        }}
                      >
                        Error
                      </span>
                    )}
                  </div>

                  {/* Body */}
                  <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>
                    <div>
                      <h3
                        style={{
                          color: t.text,
                          fontWeight: 700,
                          fontSize: 18,
                          lineHeight: 1.2,
                          margin: 0,
                          marginBottom: 4,
                        }}
                        title={model.name}
                      >
                        {normaliseModelName(model.name)}
                      </h3>
                      <p style={{ color: t.subtext, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.15em", margin: 0 }}>
                        Voice Model
                      </p>
                      {/* Published name, shown raw — normaliseModelName strips
                          accents and brackets, which mangles community titles. */}
                      {model.sourceName && (
                        <p
                          title={model.sourceName}
                          style={{
                            color: t.subtext,
                            fontSize: 12,
                            margin: 0,
                            marginTop: 6,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {model.sourceName}
                        </p>
                      )}
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div
                        style={{
                          background: t.isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
                          borderRadius: 8,
                          padding: 8,
                          border: `1px solid ${t.hairline}`,
                        }}
                      >
                        <p style={{ fontSize: 10, color: t.subtext, fontWeight: 700, textTransform: "uppercase", margin: 0, marginBottom: 4 }}>Sample Rate</p>
                        <p style={{ fontSize: 14, fontFamily: "monospace", color: t.primary, margin: 0 }}>{formatSampleRate(model.sampleRate)}</p>
                      </div>
                      <div
                        style={{
                          background: t.isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
                          borderRadius: 8,
                          padding: 8,
                          border: `1px solid ${t.hairline}`,
                        }}
                      >
                        <p style={{ fontSize: 10, color: t.subtext, fontWeight: 700, textTransform: "uppercase", margin: 0, marginBottom: 4 }}>Size</p>
                        <p style={{ fontSize: 14, fontFamily: "monospace", color: t.primary, margin: 0 }}>{model.size_mb != null ? `${model.size_mb} MB` : "—"}</p>
                      </div>
                    </div>

                    {model.status === "downloading" && (
                      <div style={{ marginTop: -4, display: "flex", flexDirection: "column", gap: 6 }}>
                        <ProgressBar value={downloadPct ?? 0} />
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: t.subtext }}>
                          <span>{downloadPhaseLabel(model.downloadPhase)}</span>
                          <span style={{ fontFamily: "monospace" }}>
                            {downloadPct !== null ? `${downloadPct}%` : "—"}
                          </span>
                        </div>
                      </div>
                    )}

                    {model.status === "training" && (
                      <div style={{ marginTop: -4, display: "flex", flexDirection: "column", gap: 6 }}>
                        <ProgressBar value={trainingPct ?? 0} />
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: t.subtext }}>
                          <span>{trainingPhaseLabel(model.trainingPhase)}</span>
                          <span style={{ fontFamily: "monospace" }}>
                            {trainingPct !== null ? `${trainingPct}%` : "—"}
                          </span>
                        </div>
                      </div>
                    )}

                    {model.status === "failed" && (model.downloadError || model.trainingError) && (
                      <span style={{ fontSize: 11, color: t.danger }}>
                        {model.downloadError || model.trainingError}
                      </span>
                    )}

                    {/* A run in progress can't be selected — offer the way out
                        instead. Without this a training model is unstoppable
                        from the UI and keeps the GPU until the process dies. */}
                    {model.status === "training" && model.trainingJobId && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleCancelTraining(model); }}
                        disabled={cancellingJobId === model.trainingJobId}
                        style={{
                          width: "100%",
                          padding: "10px 12px",
                          marginBottom: 8,
                          background: "rgba(239,68,68,0.12)",
                          border: "1px solid rgba(239,68,68,0.45)",
                          borderRadius: 12,
                          color: "#ef4444",
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.1em",
                          cursor: cancellingJobId === model.trainingJobId ? "default" : "pointer",
                        }}
                      >
                        {cancellingJobId === model.trainingJobId ? "Cancelling…" : "Cancel training"}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleCardClick(model); }}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        background: t.isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)",
                        border: `1px solid ${t.hairline}`,
                        borderRadius: 12,
                        color: t.subtext,
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        cursor: model.status === "downloading" ? "default" : "pointer",
                        transition: "background 160ms ease, color 160ms ease",
                      }}
                      onMouseEnter={(e) => { if (model.status !== "downloading") { e.currentTarget.style.background = t.isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"; e.currentTarget.style.color = t.text; } }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = t.isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)"; e.currentTarget.style.color = t.subtext; }}
                    >
                      {isInferenceSelection ? "Use for Inference" : isSelected ? "Deselect" : "Select"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          ) }
    
        {/* Online results pagination is handled inside the dropdown */}

        {/* Checkpoint modal */}
        <Modal
          t={t}
          open={checkpointDialogOpen}
          onClose={() => setCheckpointDialogOpen(false)}
          title="Choose Checkpoint"
          footer={
            <>
              <Btn t={t} variant="outline" onClick={() => setCheckpointDialogOpen(false)}>
                Cancel
              </Btn>
              <Btn
                t={t}
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
                      <Pill t={t} tone="success" style={{ fontSize: 10, padding: "5px 9px" }}>
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
          t={t}
          open={downloadDialogOpen}
          onClose={() => setDownloadDialogOpen(false)}
          title="Name your model"
          footer={
            <>
              <Btn t={t} variant="outline" onClick={() => setDownloadDialogOpen(false)}>
                Cancel
              </Btn>
              <Btn t={t} variant="primary" onClick={executeDownload} style={{ padding: "10px 18px" }}>
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
          t={t}
          open={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          title="Confirm Deletion"
          footer={
            <>
              <Btn t={t} variant="outline" onClick={() => setDeleteOpen(false)}>
                Cancel
              </Btn>
              <Btn
                variant="danger"
                t={t}
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
          @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.7}}

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
            background: linear-gradient(180deg, ${t.cardA}, ${t.cardB});
          }
          .vf-card:focus-visible{
            outline: 2px solid rgba(10,132,255,0.55);
            outline-offset: 2px;
          }
        `}</style>
    </>
   
  );
}

export default ModelsView;
