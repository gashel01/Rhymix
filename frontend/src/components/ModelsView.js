import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "./common/PageHeader";


// keep your icons (unchanged)
import {
  CloudDownload as CloudDownloadIcon,
  CloudOff as CloudOffIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  Close as CloseIcon,
} from "@mui/icons-material";
import {Theme} from "./Homeview/Theme.js"
import {SearchInput} from "./ModelView/SearchInput.js"

import {Glass} from "./Homeview/Glass.js"
import {Hairline} from "./Homeview/Hairline.js"
import IconBtn from "./Homeview/IconBtn.js"
import {Modal} from "./Homeview/Modal.js"
import Btn from "./Homeview/Btn.js"
import {Pill} from "./ModelView/Pill.js"
 
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
  const [isOnlineSearchEnabled, setIsOnlineSearchEnabled] = useState(true);
  const [selected, setSelected] = useState(new Set());

  const [downloadJobs, setDownloadJobs] = useState({});
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

  const normalizeId = useCallback((value) => {
    if (!value) return "";
    return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  }, []);

  const selectionNames = useMemo(() => {
    return (selectedTracks || [])
      .map((track) => track?.displayName || track?.safeDisplayName || track?.originalName || track?.name || track?.fileId || track?.id)
      .filter(Boolean);
  }, [selectedTracks]);

  const selectionPreview = useMemo(() => {
    const list = selectionNames.slice(0, 3);
    const extra = selectionNames.length - list.length;
    const base = list.join(", ");
    return extra > 0 ? `${base} +${extra} more` : base;
  }, [selectionNames]);

  const handleBack = useCallback(() => {
    if (ctx?.source === "home") {
      if (onNavigate) {
        onNavigate("home");
        return;
      }
      onBack?.();
      return;
    }
    if (ctx?.source === "inference") {
      if (onNavigate) {
        onNavigate("inference");
        return;
      }
      onBack?.();
      return;
    }
    onBack?.();
  }, [ctx?.source, onBack, onNavigate]);

  const installedIds = useMemo(() => {
    const ids = new Set();
    localModels.forEach((model) => {
      if (model.modelId) ids.add(normalizeId(model.modelId));
      if (model.name) ids.add(normalizeId(model.name));
    });
    return ids;
  }, [localModels, normalizeId]);

  const localModelsMerged = useMemo(() => {
    const byId = new Map();
    localModels.forEach((model) => {
      const id = model.modelId || model.name;
      byId.set(normalizeId(id), { ...model, isOnline: false, status: model.status || "completed" });
    });

    Object.values(downloadJobs).forEach((job) => {
      const id = normalizeId(job.modelId || job.modelName);
      const existing = byId.get(id);
      if (existing) {
        if (job.status && job.status !== "completed") {
          byId.set(id, {
            ...existing,
            status: job.status,
            downloadProgress: job.progress ?? null,
            downloadError: job.error || existing.downloadError,
          });
        }
        return;
      }
      byId.set(id, {
        name: job.modelName || job.modelId || "New Model",
        modelId: job.modelId,
        status: job.status || "downloading",
        downloadProgress: job.progress ?? null,
        downloadError: job.error || null,
        checkpoints: [],
        size_mb: job.size_mb || null,
        created: job.started_at || new Date().toISOString(),
        isOnline: false,
      });
    });

    return Array.from(byId.values()).sort((a, b) => {
      const aTime = a.created ? Date.parse(a.created) : 0;
      const bTime = b.created ? Date.parse(b.created) : 0;
      return bTime - aTime;
    });
  }, [downloadJobs, localModels, normalizeId]);

  const filteredLocalModels = useMemo(() => {
    if (!searchQuery.trim()) return localModelsMerged;
    const q = searchQuery.trim().toLowerCase();
    const qUnderscore = q.replace(/\s+/g, "_");
    return localModelsMerged.filter((model) => {
      const name = model.name?.toLowerCase() || "";
      return name.includes(q) || name.includes(qUnderscore);
    });
  }, [localModelsMerged, searchQuery]);

  const selectableLocalModels = useMemo(
    () => filteredLocalModels.filter((model) => model.status === "completed"),
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
    }, 2000);
    return () => clearInterval(interval);
  }, [downloadJobs, fetchModels]);

  const handleCardClick = (model) => {
    if (model.isOnline) return;
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

  const normaliseModelName = (name) => {
    name = name.charAt(0).toUpperCase() + name.slice(1);
    return name.replace(/[^a-zA-Z0-9]/g, " ");
  };



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
          backdropFilter: isStuck ? "blur(20px)" : "none",

          // ✅ TRANSITION between “floating card” and “stuck bar”
          padding:  "12px 0 0 0" ,           // no left/right padding when stuck
          borderRadius: isStuck ? 0 : t.radiusLg,     // square corners when stuck
          border:  ` 1px solid ${t.hairline}`,
         
          margin: isStuck ? 0 : "24px 24px 24px 24px",

          background: `linear-gradient(180deg, ${t.glassA}, ${t.glassB})`,
          position: "sticky",
          top: 0,
          zIndex: 1000,
          boxShadow: isStuck ? t.shadowSoft : t.shadow,
          overflow: "visible",

          // ✅ smooth animation
          transition:
            "padding 180ms ease, border-radius 180ms ease, box-shadow 180ms ease, border-color 180ms ease",
        }}
        >
          <div style={{ paddingBottom: 10 }}>
          <Glass
            t={t}
            style={{
              padding: 14,
              marginBottom: 14,
              border:"none", 
              boxShadow:"none",
              background:"transparent",
              backgroundColor:"transparent",
              borderRadius:0,
              backdropFilter:"none",
            }}
          >
            <PageHeader
              title={isInferenceSelection ? "Select Model for Inference" : "TRAINED VOICE MODELS"}
              onBack={isInferenceSelection ? handleBack : null}
            
            />
            </Glass>


          </div>

          {isInferenceSelection && (
            <Glass
              t={t}
              style={{
                padding: 16,
                marginBottom: 14,
                border:"none", 
                boxShadow:"none",
                background:"transparent",
                backgroundColor:"transparent",
                borderRadius:0,
                backdropFilter:"none",
              }}
            >
              <div style={{ fontWeight: 900, color: t.text, marginBottom: 6 }}>Selection Summary</div>
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
            </Glass>
          )}

          <Glass
            t={t}
            style={{
              padding: 14,
              marginBottom: 14,
              border:"none", 
              boxShadow:"none",
              background:"transparent",
              backgroundColor:"transparent",
              borderRadius:0,
              backdropFilter:"none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              {!isInferenceSelection && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Btn t={t} variant="outline" onClick={onSelectAll} style={{ height: 44, padding: "0 14px" }}>
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
                    <Btn t={t} variant="outline" onClick={onClear} style={{ height: 44, padding: "0 14px" }}>
                      Clear
                    </Btn>
                  </div>
                </div>
              )}

              <div style={{ position: "relative", flex: "1 1 360px",  }} ref={dropdownRef}>
                <SearchInput
                  t={t}
                  value={searchQuery}
                  onChange={(val) => {
                    setSearchQuery(val);
                    setIsDropdownOpen(true);
                  }}
                  placeholder="Search models..."
                  leftIcon={<SearchIcon style={{ fontSize: 20 }} />}
                  rightNode={
                    <button
                  
                      type="button"
                      title={isOnlineSearchEnabled ? "Disable online search" : "Enable online search"}
                      onClick={(e) => {
                        e.preventDefault();
                        toggleOnlineSearch();
                      }}
                      onMouseDown={(e) => e.preventDefault()}
                      style={{
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        padding: "6px 8px",
                        borderRadius: 12,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {isOnlineSearchEnabled ? (
                        <CloudDownloadIcon style={{ fontSize: 20, color: t.primary }} />
                      ) : (
                        <CloudOffIcon style={{ fontSize: 20, color: t.subtext }} />
                      )}
                    </button>
                  }
                  onFocus={() => setIsDropdownOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      setIsDropdownOpen(true);
                    }
                  }}
                  inputRef={inputRef}
                />

                {isDropdownOpen && (
                  <div
                    onMouseDown={(e) => e.preventDefault()}
                    style={{
                      position: "absolute",
                      top: 52,
                      left: 0,
                      right: 0,
                      isolation: "isolate",
                      transform: "translateZ(0)",
                      background: `linear-gradient(180deg, ${t.glassA}, ${t.glassB})`,
                      backdropFilter: "blur(22px) saturate(140%)",
                      WebkitBackdropFilter: "blur(22px) saturate(140%)",
                      border: `1px solid ${t.hairline}`,
                      borderRadius: 16,
                      boxShadow: t.shadowSoft,
                      maxHeight: 320,
                      overflow: "hidden",
                      zIndex: 40,
                    }}
                  >
                    <div style={{ maxHeight: 280, overflowY: "auto" }}>
                      {!debouncedQuery && (
                        <div style={{ padding: 12, color: t.subtext, fontSize: 12, fontWeight: 700 }}>
                          Start typing to search online models.
                        </div>
                      )}

                      {debouncedQuery && !isOnlineSearchEnabled && (
                        <div style={{ padding: 12, color: t.subtext, fontSize: 12, fontWeight: 700 }}>
                          Online search is disabled. Click the cloud icon to enable it.
                        </div>
                      )}

                      {debouncedQuery && isOnlineSearchEnabled && isSearching && (
                        <div style={{ padding: 12, color: t.subtext, fontSize: 12, fontWeight: 700 }}>
                          Searching…
                        </div>
                      )}

                      {debouncedQuery && isOnlineSearchEnabled && searchError && (
                        <div style={{ padding: 12, color: t.danger, fontSize: 12, fontWeight: 700 }}>
                          {searchError}
                        </div>
                      )}

                      {debouncedQuery &&
                        isOnlineSearchEnabled &&
                        !isSearching &&
                        !searchError &&
                        onlineResults.length === 0 && (
                          <div style={{ padding: 12, color: t.subtext, fontSize: 12, fontWeight: 700 }}>
                            No results found.
                          </div>
                        )}

                      {isOnlineSearchEnabled &&
                        onlineResults.map((model) => {
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
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 12,
                                padding: "10px 12px",
                                borderBottom: `1px solid ${t.hairline}`,
                                backdropFilter: `blur(22px) saturate(140%)`,
                                WebkitBackdropFilter: `blur(22px) saturate(140%)`,
                              }}
                            >
                              <div style={{ minWidth: 0 }}>
                                <div style={{ color: t.text, fontWeight: 800, fontSize: 13 }}>
                                  {model.name}
                                </div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                                  {model.author && <Pill t={t} tone="neutral">{model.author}</Pill>}
                                  {model.size_mb && <Pill t={t} tone="neutral">{model.size_mb} MB</Pill>}
                                  {Array.isArray(model.tags) &&
                                    model.tags.map((tag) => (
                                      <Pill t={t} key={tag} tone="primary">
                                        {tag}
                                      </Pill>
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
                                style={{ height: 36, padding: "0 12px" }}
                              >
                                {isInstalled ? "Installed" : "Download"}
                              </Btn>
                            </div>
                          );
                        })}
                    </div>

                    {debouncedQuery && isOnlineSearchEnabled && onlineTotalPages > onlinePage && (
                      <div>
                        <Btn
                          t={t}
                          variant="outline"
                          onClick={() => {
                            const nextPage = onlinePage + 1;
                            setOnlinePage(nextPage);
                            performOnlineSearch(debouncedQuery, nextPage, true);
                          }}
                          style={{ width: "100%", borderRadius:0 }}
                        >
                          Load more
                        </Btn>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {!isInferenceSelection && (
                <div style={{ position: "relative" }}>
                  <IconBtn
                    t={t}
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
              )}
            </div>
          </Glass>
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
  
              const statusTone = isInferenceSelection
                ? "primary"
                : model.status === "completed"
                ? "success"
                : model.status === "failed" || model.status === "error"
                ? "danger"
                : "warning";
  
              const statusLabel = isInferenceSelection
                ? "SELECT MODEL"
                : model.status === "downloading"
                ? "DOWNLOADING"
                : model.status === "failed" || model.status === "error"
                ? "ERROR"
                : "READY";
  
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
                    background: `linear-gradient(180deg, ${t.cardA}, ${t.cardB})`,
                    boxShadow: t.shadowSoft,
                    padding: 16,
                    cursor: model.status === "downloading" ? "default" : "pointer",
                    position: "relative",
                    minHeight: 204,
                    display: "flex",
                    flexDirection: "column",
                    transition: "transform 160ms ease, box-shadow 160ms ease, background 160ms ease",
                    outline: "none",
                  }}
                >
                  {/* Progress overlay */}
                  {downloadPct !== null && model.status === "downloading" && (
                    <div style={{ position: "absolute", top: 10, left: 12, right: 12 }}>
                      <ProgressBar value={downloadPct} />
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
                      {normaliseModelName(model.name)}
                    </div>
  
                    <div style={{ color: t.subtext, fontSize: 12, fontWeight: 700 }}>
                      {model.created ? new Date(model.created).toLocaleDateString() : "Local"}
                    </div>
                  </div>
  
                  {/* Stats */}
                  <div style={{ marginTop: "auto" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 12, marginBottom: 12 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {model.checkpoints?.length > 0 && <Pill t={t} tone="primary">{model.checkpoints.length} CP</Pill>}
                    {model.sampleRate && <Pill t={t} tone="neutral">{model.sampleRate}hz</Pill>}
                  </div>
                  <Pill t={t} tone="neutral">{model.size_mb || "N/A"} MB</Pill>
                </div>
  
                    {model.checkpoints?.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ color: t.subtext, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
                          Latest Checkpoints:
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {model.checkpoints.slice(0, 3).map((cp, idx) => (
                            <Pill
                              key={idx} t={t}
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
  
                    <div style={{ display: "flex", justifyContent: "flex-start", alignItems: "center", gap: 8 }}>
                      <Pill
                        tone={statusTone}
                        t={t}
                        style={{
                          padding: "10px 14px",
                          borderRadius: 14,
                        }}
                      >
                        {statusLabel}
                      </Pill>
                      {model.status === "failed" && model.downloadError && (
                        <span style={{ fontSize: 11, color: t.danger }}>{model.downloadError}</span>
                      )}
                    </div>
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
    </>
   
  );
}

export default ModelsView;
